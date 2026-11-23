import 'server-only';
import { createHash } from 'node:crypto';
import { schema } from '@jobbank/db';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { recordAudit, type RequestContext } from '@/domains/shared/audit';
import { ForbiddenError, RateLimitedError, UnauthenticatedError } from '@/domains/shared/errors';
import { enforceRateLimit, enforceRateLimitByIp } from '@/domains/shared/rate-limit';
import type { Actor } from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { loadActor, requiresTwoFactor } from './actor';
import { getAuth } from './auth';
import { verifyTwoFactorSetupToken } from './setup-token';
import { betterAuthUserMessage } from './auth-messages';
import { clearTrustedDevices, revokeAllSessions } from './service';

type SignedIn = RequestContext & { actor: Actor };

export interface EnrollmentStart {
  /** SVG markup generated server-side from the otpauth:// URI. */
  qrSvg: string;
  /** Base32 key for people who cannot scan (typed into the authenticator app). */
  manualKey: string;
  /** One-time recovery codes — shown once, the user must store them. */
  backupCodes: string[];
}

function authApiCode(error: unknown): string | undefined {
  const body = (error as { body?: { code?: string } }).body;
  return typeof body?.code === 'string' ? body.code : undefined;
}

function authApiMessage(error: unknown): string | undefined {
  return error instanceof Error && error.name === 'APIError' ? error.message : undefined;
}

/** Step 1: confirm the password, create an (unverified) secret, return QR + backup codes. */
export async function startTwoFactorEnrollment(
  ctx: SignedIn,
  password: string,
  requestHeaders: Headers,
): Promise<EnrollmentStart> {
  let enabled: Awaited<ReturnType<ReturnType<typeof getAuth>['api']['enableTwoFactor']>>;
  try {
    enabled = await getAuth().api.enableTwoFactor({ body: { password }, headers: requestHeaders });
  } catch (error) {
    if (authApiMessage(error)) throw new UnauthenticatedError('Incorrect password');
    throw error;
  }
  // Only the authenticator-app (TOTP) method is configured, so a URI is always returned.
  if (!('totpURI' in enabled)) throw new Error('Two-factor plugin did not return a TOTP setup');
  const result = enabled;
  const manualKey = new URL(result.totpURI).searchParams.get('secret') ?? '';
  const qrSvg = await QRCode.toString(result.totpURI, { type: 'svg', margin: 1, width: 200 });
  await recordAudit(ctx, {
    action: 'auth.2fa_enrollment_started',
    entityType: 'user',
    entityId: ctx.actor.userId,
  });
  return { qrSvg, manualKey, backupCodes: result.backupCodes };
}

/**
 * Setup-token path for POST /api/v1/account/2fa/enroll (audit 2026-11-11,
 * H-02). The caller has no session — only the short-lived token login issued
 * after a password check. The token is verified (and rate-limited per token),
 * the password is checked again via a fresh Better Auth sign-in, and the
 * pending session that sign-in creates is used for enableTwoFactor and
 * returned as cookies, so the confirm step works exactly as in the
 * session-based flow. That pending session exists only during active
 * enrolment; it becomes a normal session only once enrolment is confirmed.
 */
export async function startTwoFactorEnrollmentWithSetupToken(
  ctx: RequestContext,
  setupToken: string,
  password: string,
  requestHeaders: Headers,
): Promise<{ enrollment: EnrollmentStart; cookies: string[] }> {
  const tokenHash = createHash('sha256').update(setupToken).digest('hex');
  await enforceRateLimit(
    '2fa-setup-token',
    tokenHash,
    { limit: 5, windowSeconds: 900 },
    'Too many setup attempts. Sign in again to get a new setup link.',
  );
  const userId = await verifyTwoFactorSetupToken(setupToken);
  if (!userId) {
    throw new UnauthenticatedError('This setup link is invalid or has expired. Sign in again.');
  }
  const [row] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!row) {
    throw new UnauthenticatedError('This setup link is invalid or has expired. Sign in again.');
  }
  let signIn;
  try {
    signIn = await getAuth().api.signInEmail({
      body: { email: row.email, password, rememberMe: true },
      headers: requestHeaders,
      returnHeaders: true,
    });
  } catch (error) {
    if (authApiMessage(error)) throw new UnauthenticatedError('Incorrect password');
    throw error;
  }
  if ('twoFactorRedirect' in (signIn.response as object)) {
    // 2FA was enabled between token issue and this call — the token check
    // above should have caught it; fail closed instead of enrolling twice.
    throw new UnauthenticatedError('Two-factor authentication is already on. Sign in again.');
  }
  const cookies = signIn.headers.getSetCookie();
  const sessionHeaders = new Headers({
    cookie: cookies
      .map((c) => c.split(';')[0]?.trim())
      .filter((c): c is string => Boolean(c))
      .join('; '),
  });
  const enrollment = await startTwoFactorEnrollment(
    { ...ctx, actor: await loadActor(userId) },
    password,
    sessionHeaders,
  );
  return { enrollment, cookies };
}

/** Step 2: the first correct code from the app turns two-factor on. */
export async function confirmTwoFactorEnrollment(
  ctx: SignedIn,
  code: string,
  requestHeaders: Headers,
): Promise<string[]> {
  // 5 wrong codes per 15 minutes per account, plus the shared IP limit: an
  // attacker with a stolen session must not be able to brute-force enrolment.
  try {
    await enforceRateLimit(
      '2fa-confirm-user',
      ctx.actor.userId,
      { limit: 5, windowSeconds: 900 },
      'Too many incorrect codes. Try again in 15 minutes.',
    );
    // Audit 2026-11-11 (M-17): a null IP used to skip this limit entirely —
    // route through the helper so it lands in the shared 'untrusted' bucket.
    await enforceRateLimitByIp(ctx.ip, '2fa-confirm-ip', { limit: 30, windowSeconds: 900 });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      await recordAudit(ctx, {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: ctx.actor.userId,
        metadata: { method: 'totp_enroll', reason: 'RATE_LIMITED' },
      });
    }
    throw error;
  }
  try {
    const result = await getAuth().api.verifyTOTP({
      body: { code },
      headers: requestHeaders,
      returnHeaders: true,
    });
    await recordAudit(ctx, {
      action: 'auth.2fa_enabled',
      entityType: 'user',
      entityId: ctx.actor.userId,
    });
    return result.headers.getSetCookie();
  } catch (error) {
    if (authApiMessage(error)) {
      await recordAudit(ctx, {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: ctx.actor.userId,
        metadata: { method: 'totp_enroll', reason: 'INVALID' },
      });
      throw new UnauthenticatedError(
        betterAuthUserMessage(
          authApiCode(error),
          'That code is not correct. Check the time on your phone and try again.',
        ),
      );
    }
    throw error;
  }
}

/** Every password role must keep 2FA on once enrolled — applicants sit outside this only because they sign in with a phone SMS code, never a password. */
export async function disableTwoFactor(
  ctx: SignedIn,
  password: string,
  requestHeaders: Headers,
): Promise<void> {
  if (requiresTwoFactor(ctx.actor.roles)) {
    throw new ForbiddenError(
      'Two-factor authentication is required for your role and cannot be turned off.',
    );
  }
  try {
    await getAuth().api.disableTwoFactor({ body: { password }, headers: requestHeaders });
  } catch (error) {
    if (authApiMessage(error)) throw new UnauthenticatedError('Incorrect password');
    throw error;
  }
  // Turning 2FA off must not leave a live session behind for anyone who stole
  // one (the password is already known to them), and must not leave trusted
  // devices that would skip 2FA if it is re-enabled later. The user signs in
  // again afterwards; the client refreshes into the login redirect.
  await revokeAllSessions(ctx.actor.userId);
  await clearTrustedDevices(ctx.actor.userId);
  await recordAudit(ctx, {
    action: 'auth.2fa_disabled',
    entityType: 'user',
    entityId: ctx.actor.userId,
  });
}
