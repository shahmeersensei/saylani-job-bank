import 'server-only';
import { createHash } from 'node:crypto';
import { homePathFor, type Permission, type Role } from '@jobbank/shared';
import { schema } from '@jobbank/db';
import { APIError } from 'better-auth/api';
import { verifyPassword } from 'better-auth/crypto';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { recordAudit, type RequestContext } from '@/domains/shared/audit';
import {
  DomainError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from '@/domains/shared/errors';
import { maskEmail, maskPhone } from '@/domains/shared/masking';
import { enforceRateLimit, enforceRateLimitByIp } from '@/domains/shared/rate-limit';
import type { Actor } from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { normalizePkMobile } from '@/lib/format/phone';
import { ACTIVE_BRANCH_COOKIE, loadActor, type SessionUser } from './actor';
import { getAuth, isPlaceholderEmail, SESSION_TTL_SECONDS } from './auth';
import { issueOtp, OTP_TTL_SECONDS } from './otp';
import { betterAuthUserMessage } from './auth-messages';
import { createTwoFactorSetupToken } from './setup-token';

export const RESEND_AFTER_SECONDS = 60;

export class AccountBlockedError extends DomainError {
  constructor(reason: 'DISABLED' | 'INVITED') {
    super(
      'FORBIDDEN',
      403,
      reason === 'INVITED'
        ? 'Finish setting up your account using the invitation link we emailed you.'
        : 'This account has been disabled. Please contact your Job Bank branch.',
      { reason: reason === 'INVITED' ? 'ACCOUNT_INVITED' : 'ACCOUNT_DISABLED' },
    );
  }
}

export interface SignInResult {
  kind: 'signed_in';
  user: SessionUser;
  roles: Role[];
  homePath: string;
  /** Set-Cookie values to forward to the browser. */
  cookies: string[];
}

/** Password was right; an authenticator (or backup) code is needed to finish. */
export interface TwoFactorChallenge {
  kind: 'two_factor_required';
  methods: string[];
  cookies: string[];
  /**
   * Whether the client may offer "trust this device". Always true: a checked
   * box trusts this browser for 30 days. 2FA stays mandatory on every other
   * browser, and disabling the account or resetting 2FA clears the trust.
   */
  trustDeviceAllowed: boolean;
}

/**
 * Audit 2026-11-11 (H-02): the password was right, but the account's role
 * requires 2FA and none is enrolled yet — so NO session is issued. The client
 * gets a short-lived, non-session setup token instead, usable only to start
 * enrolment (POST /api/v1/account/2fa/enroll with `setupToken`). It cannot
 * call any other route, and it dies the moment enrolment completes.
 */
export interface TwoFactorSetupRequired {
  kind: 'two_factor_setup_required';
  setupToken: string;
  expiresInSeconds: number;
  /** Always empty for this kind — no session cookies are issued. */
  cookies: string[];
}

/**
 * Better Auth throws APIError from more than one bundled copy of the class (better-auth vs
 * @better-auth/core), so `instanceof` alone is unreliable — also match on the error name.
 */
function isAuthApiError(error: unknown): error is Error & { body?: { code?: string } | undefined } {
  return error instanceof APIError || (error instanceof Error && error.name === 'APIError');
}

function apiErrorCode(error: unknown): string | undefined {
  return isAuthApiError(error) ? error.body?.code : undefined;
}

type UserRow = typeof schema.users.$inferSelect;

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: isPlaceholderEmail(row.email) ? null : row.email,
    phoneNumber: row.phoneNumber,
    title: row.title,
    twoFactorEnabled: row.twoFactorEnabled,
  };
}

async function rateLimitByIp(
  ctx: RequestContext,
  name: string,
  limit: number,
  windowSeconds: number,
) {
  // Fail-closed: a null IP is limited under the shared 'untrusted' subject
  // instead of skipping the limit (see enforceRateLimitByIp).
  await enforceRateLimitByIp(ctx.ip, name, { limit, windowSeconds });
}

function requirePkMobile(raw: string): string {
  const phone = normalizePkMobile(raw);
  if (!phone) {
    throw new ValidationError([
      { path: 'phone', message: 'Enter a valid Pakistani mobile number' },
    ]);
  }
  return phone;
}

async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, email.trim().toLowerCase()));
  return user;
}

/** Completes a successful sign-in: audit + response shape. */
async function signedIn(
  ctx: RequestContext,
  userId: string,
  method: string,
  cookies: string[],
  actor?: Actor,
): Promise<SignInResult> {
  const loaded = actor ?? (await loadActor(userId));
  await recordAudit(
    { ...ctx, actor: loaded },
    { action: 'auth.login', entityType: 'user', entityId: userId, metadata: { method } },
  );
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  return {
    kind: 'signed_in',
    user: toSessionUser(row!),
    roles: [...loaded.roles],
    homePath: homePathFor(loaded.roles),
    cookies,
  };
}

// ─── Applicants: phone + SMS code ──────────────────────────────────────

export async function requestOtp(ctx: RequestContext, rawPhone: string) {
  const phone = requirePkMobile(rawPhone);
  await enforceRateLimit(
    'otp-resend',
    phone,
    { limit: 1, windowSeconds: RESEND_AFTER_SECONDS },
    'Please wait a minute before requesting another code.',
  );
  await enforceRateLimit(
    'otp-phone',
    phone,
    { limit: 5, windowSeconds: 3600 },
    'Too many codes requested for this number. Try again in an hour.',
  );
  await rateLimitByIp(ctx, 'otp-ip', 20, 3600);

  await issueOtp(phone, ctx.ip);
  await recordAudit(ctx, {
    action: 'auth.otp_requested',
    entityType: 'phone',
    metadata: { phoneMasked: maskPhone(phone) },
  });
  return { expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: RESEND_AFTER_SECONDS };
}

export async function verifyOtp(
  ctx: RequestContext,
  rawPhone: string,
  code: string,
  requestHeaders: Headers,
): Promise<SignInResult> {
  const phone = requirePkMobile(rawPhone);
  await rateLimitByIp(ctx, 'otp-verify-ip', 30, 900);

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.phoneNumber, phone));

  let result;
  try {
    result = await getAuth().api.verifyPhoneNumber({
      body: { phoneNumber: phone, code },
      headers: requestHeaders,
      returnHeaders: true,
    });
  } catch (error) {
    if (!isAuthApiError(error)) throw error;
    const reason = apiErrorCode(error);
    await recordAudit(ctx, {
      action: reason === 'ACCOUNT_DISABLED' ? 'auth.login_blocked' : 'auth.login_failed',
      entityType: 'user',
      entityId: existing?.id ?? null,
      metadata: { method: 'otp', reason: reason ?? 'INVALID_OTP', phoneMasked: maskPhone(phone) },
    });
    if (reason === 'ACCOUNT_DISABLED') throw new AccountBlockedError('DISABLED');
    if (reason === 'OTP_LOCKED') {
      throw new UnauthenticatedError('Too many incorrect attempts. Request a new code.');
    }
    throw new UnauthenticatedError('The code is incorrect or has expired.');
  }

  const userId = result.response.user.id;
  if (!existing) {
    await recordAudit(
      { ...ctx, actor: await loadActor(userId) },
      { action: 'auth.register_applicant', entityType: 'user', entityId: userId },
    );
  }
  // Phone + SMS is applicant-only. A user row with a phone number and any other
  // role (e.g. a staff member whose number was added later) must never sign in
  // with SMS alone — that would bypass both the password and mandatory TOTP.
  // Currently latent (no code path sets a phone on internal users), but the gate
  // is cheap and fail-closed: exactly APPLICANT, nothing else.
  const actor = await loadActor(userId);
  if (actor.roles.length !== 1 || actor.roles[0] !== 'APPLICANT') {
    await recordAudit(ctx, {
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: userId,
      metadata: { method: 'otp', reason: 'OTP_ROLE_NOT_ALLOWED', phoneMasked: maskPhone(phone) },
    });
    throw new UnauthenticatedError(
      'Phone sign-in is only for job seekers. Staff and employers sign in with email and password.',
    );
  }
  return signedIn(ctx, userId, 'otp', result.headers.getSetCookie(), actor);
}

// ─── Staff & employers: email + password (+ authenticator app) ─────────

export async function loginWithPassword(
  ctx: RequestContext,
  rawEmail: string,
  password: string,
  requestHeaders: Headers,
): Promise<SignInResult | TwoFactorChallenge | TwoFactorSetupRequired> {
  const email = rawEmail.trim().toLowerCase();
  // Audit 2026-11-11 (L-16): only FAILED attempts count toward the
  // per-email bucket (consumed in `failed` below) — a user signing in 5
  // times in 15 minutes across devices must not lock themselves out, and
  // successes never spend the budget. The per-IP bucket still gates before
  // verification, so brute force is throttled either way.
  await rateLimitByIp(ctx, 'login-ip', 30, 900);

  const user = await findUserByEmail(email);
  const failed = async (reason: string) => {
    await enforceRateLimit(
      'login-email',
      email,
      { limit: 5, windowSeconds: 900 },
      'Too many sign-in attempts. Try again in 15 minutes.',
    );
    await recordAudit(ctx, {
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user?.id ?? null,
      metadata: { method: 'password', reason, emailMasked: maskEmail(email) },
    });
    return new UnauthenticatedError(betterAuthUserMessage(reason, 'Incorrect email or password'));
  };

  // Blocked accounts are only revealed to someone who knows the password.
  if (user && user.status !== 'ACTIVE') {
    const [account] = await db
      .select({ password: schema.accounts.password })
      .from(schema.accounts)
      .where(
        and(eq(schema.accounts.userId, user.id), eq(schema.accounts.providerId, 'credential')),
      );
    if (account?.password && (await verifyPassword({ hash: account.password, password }))) {
      await recordAudit(ctx, {
        action: 'auth.login_blocked',
        entityType: 'user',
        entityId: user.id,
        metadata: { method: 'password', reason: user.status },
      });
      throw new AccountBlockedError(user.status);
    }
    throw await failed('BAD_CREDENTIALS');
  }

  let result;
  try {
    result = await getAuth().api.signInEmail({
      body: { email, password, rememberMe: true },
      headers: requestHeaders,
      returnHeaders: true,
    });
  } catch (error) {
    if (isAuthApiError(error)) throw await failed(apiErrorCode(error) ?? 'BAD_CREDENTIALS');
    throw error;
  }

  const response = result.response as
    { twoFactorRedirect: true; twoFactorMethods?: string[] } | { user: { id: string } };
  if ('twoFactorRedirect' in response) {
    await recordAudit(ctx, {
      action: 'auth.login_2fa_challenge',
      entityType: 'user',
      entityId: user?.id ?? null,
      metadata: { method: 'password' },
    });
    // A checked "trust this device" box is honored for every role. Fail closed
    // only when the user row is somehow missing.
    const trustDeviceAllowed = Boolean(user);
    return {
      kind: 'two_factor_required',
      methods: response.twoFactorMethods ?? ['totp'],
      cookies: result.headers.getSetCookie(),
      trustDeviceAllowed,
    };
  }
  const actor = await loadActor(response.user.id);
  if (actor.twoFactorPending) {
    // Audit 2026-11-11 (H-02): this role requires 2FA but none is enrolled.
    // Better Auth has already created a session for this sign-in — revoke it
    // before anything leaves the server, so a password-only admin never holds
    // a live session. The caller gets a short-lived, non-session setup token
    // instead (usable only to start enrolment). Downstream twoFactorPending
    // gates stay in place as defence-in-depth.
    await revokeSessionFromSetCookies(result.headers.getSetCookie());
    await recordAudit(ctx, {
      action: 'auth.login_2fa_setup_required',
      entityType: 'user',
      entityId: user?.id ?? null,
      metadata: { method: 'password' },
    });
    const { token, expiresInSeconds } = createTwoFactorSetupToken(response.user.id);
    return { kind: 'two_factor_setup_required', setupToken: token, expiresInSeconds, cookies: [] };
  }
  return signedIn(ctx, response.user.id, 'password', result.headers.getSetCookie(), actor);
}

/**
 * Deletes the session behind a set of Set-Cookie values (best effort: if the
 * sign-out fails the session stays pending-gated and can never be used for
 * API access, but the login still returns the setup challenge, not a session).
 */
async function revokeSessionFromSetCookies(setCookies: string[]): Promise<void> {
  const cookieHeader = setCookies
    .map((c) => c.split(';')[0]?.trim())
    .filter((c): c is string => Boolean(c))
    .join('; ');
  if (!cookieHeader) return;
  try {
    await getAuth().api.signOut({
      headers: new Headers({ cookie: cookieHeader }),
      returnHeaders: true,
    });
  } catch {
    // Best effort — see above.
  }
}

/**
 * Identifies the in-flight 2FA challenge from the request cookies, so failed
 * codes can be limited per challenge (which is per user: one challenge cookie
 * belongs to exactly one user) rather than per IP only. Better Auth names the
 * cookie `<prefix>.two_factor` (`__Secure-` prefixed on HTTPS); the value is
 * opaque to us, so it is hashed before use as a rate-limit subject.
 */
function twoFactorChallengeSubject(requestHeaders: Headers): string | null {
  const cookie = requestHeaders.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name?.endsWith('two_factor')) {
      const value = rest.join('=');
      if (value) return createHash('sha256').update(value).digest('hex');
    }
  }
  return null;
}

/**
 * Deletes every trusted-device record for a user. Better Auth stores trust as a
 * signed cookie plus a server-side verification row (identifier `trust-device-*`,
 * value = userId); deleting the rows makes any outstanding trust cookie useless
 * on the next sign-in, even if the browser still holds it.
 */
export async function clearTrustedDevices(userId: string): Promise<void> {
  await db
    .delete(schema.verifications)
    .where(
      and(
        like(schema.verifications.identifier, 'trust-device-%'),
        eq(schema.verifications.value, userId),
      ),
    );
}

/** Second step after a password: authenticator-app code, or a one-time backup code. */
export async function verifySecondFactor(
  ctx: RequestContext,
  input: { code?: string; backupCode?: string; trustDevice?: boolean },
  requestHeaders: Headers,
): Promise<SignInResult> {
  await rateLimitByIp(ctx, 'two-factor-ip', 30, 900);
  // Per-challenge limit: 5 wrong codes per 15 minutes locks this challenge.
  // The IP limit alone is not enough — it is shared and spoofable — and a
  // per-account limit needs the user, who is only known after a correct code.
  // A fresh challenge needs a fresh password sign-in, which is itself
  // rate-limited (login-email 5/900s), so the counter cannot be reset freely.
  const challengeSubject = twoFactorChallengeSubject(requestHeaders);
  if (challengeSubject) {
    try {
      await enforceRateLimit(
        'two-factor-challenge',
        challengeSubject,
        { limit: 5, windowSeconds: 900 },
        'Too many incorrect codes. Try again in 15 minutes.',
      );
    } catch (error) {
      if (error instanceof RateLimitedError) {
        await recordAudit(ctx, {
          action: 'auth.login_failed',
          entityType: 'user',
          metadata: {
            method: input.backupCode ? 'backup_code' : 'totp',
            reason: 'RATE_LIMITED',
          },
        });
      }
      throw error;
    }
  }
  let result;
  try {
    result = input.backupCode
      ? await getAuth().api.verifyBackupCode({
          body: { code: input.backupCode, trustDevice: input.trustDevice },
          headers: requestHeaders,
          returnHeaders: true,
        })
      : await getAuth().api.verifyTOTP({
          body: { code: input.code ?? '', trustDevice: input.trustDevice },
          headers: requestHeaders,
          returnHeaders: true,
        });
  } catch (error) {
    if (!isAuthApiError(error)) throw error;
    await recordAudit(ctx, {
      action: 'auth.login_failed',
      entityType: 'user',
      metadata: {
        method: input.backupCode ? 'backup_code' : 'totp',
        reason: apiErrorCode(error) ?? 'INVALID',
      },
    });
    throw new UnauthenticatedError(
      betterAuthUserMessage(apiErrorCode(error), 'That code is not correct.'),
    );
  }
  const userId = (result.response as { user: { id: string } }).user.id;
  const cookies = result.headers.getSetCookie();
  const actor = await loadActor(userId);
  // trustDevice is passed through to Better Auth above. When it is true, the
  // plugin writes a signed trust-device cookie (Secure when the public URL is
  // https) plus a verification row. Production terminates TLS at Cloudflare
  // and reaches this process over HTTP via Caddy; the browser still stores
  // the Secure cookie because the page is https. The next password sign-in
  // reads that cookie and skips 2FA until the row expires or is cleared.
  return signedIn(
    ctx,
    userId,
    input.backupCode ? 'password+backup_code' : 'password+totp',
    cookies,
    actor,
  );
}

// ─── Session ───────────────────────────────────────────────────────────

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  const secure = process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export async function logout(ctx: RequestContext, requestHeaders: Headers): Promise<string[]> {
  let cookies: string[] = [];
  try {
    const result = await getAuth().api.signOut({ headers: requestHeaders, returnHeaders: true });
    cookies = result.headers.getSetCookie();
  } catch {
    // No valid session — still clear our cookies below.
  }
  if (ctx.actor) {
    await recordAudit(ctx, {
      action: 'auth.logout',
      entityType: 'user',
      entityId: ctx.actor.userId,
    });
  }
  return [...cookies, cookie(ACTIVE_BRANCH_COOKIE, '', 0)];
}

/** Ends every session a user has (password reset, disable, 2FA reset). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

/** Super Admin branch switcher. null = oversight of all branches. Audited (PRD M15). */
export async function switchActiveBranch(
  ctx: RequestContext & { actor: Actor },
  branchId: string | null,
): Promise<string> {
  if (branchId) {
    const [branch] = await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(and(eq(schema.branches.id, branchId), eq(schema.branches.isActive, true)));
    if (!branch) throw new NotFoundError('Branch', branchId);
  }
  await recordAudit(ctx, {
    action: 'auth.scope_switch',
    entityType: 'branch',
    entityId: branchId,
    branchId,
    before: { activeBranchId: ctx.actor.activeBranchId },
    after: { activeBranchId: branchId },
  });
  return branchId
    ? cookie(ACTIVE_BRANCH_COOKIE, branchId, SESSION_TTL_SECONDS)
    : cookie(ACTIVE_BRANCH_COOKIE, '', 0);
}

export interface MeView {
  user: SessionUser;
  roles: Role[];
  permissions: Permission[];
  branches: { id: string; code: string; name: string }[];
  activeBranchId: string | null;
  homePath: string;
  twoFactorPending: boolean;
}

export async function describeMe(user: SessionUser, actor: Actor): Promise<MeView> {
  const branches = actor.branchIds.length
    ? await db
        .select({ id: schema.branches.id, code: schema.branches.code, name: schema.branches.name })
        .from(schema.branches)
        .where(inArray(schema.branches.id, [...actor.branchIds]))
        .orderBy(schema.branches.name)
    : [];
  return {
    user,
    roles: [...actor.roles],
    permissions: [...actor.permissions].sort(),
    branches,
    activeBranchId: actor.activeBranchId,
    homePath: homePathFor(actor.roles),
    twoFactorPending: actor.twoFactorPending,
  };
}
