import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { ROLE_LABELS, type Role } from '@jobbank/shared';
import { schema } from '@jobbank/db';
import { hashPassword } from 'better-auth/crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { recordAudit, runCommand, type RequestContext } from '@/domains/shared/audit';
import { DomainError } from '@/domains/shared/errors';
import { maskEmail } from '@/domains/shared/masking';
import { enforceRateLimit } from '@/domains/shared/rate-limit';
import { db, type DbExecutor } from '@/lib/db';
import { env } from '@/lib/env';
import { sendMail } from '@/lib/mail/mailer';
import { invitationEmail, passwordResetEmail } from '@/lib/mail/templates';
import { loginWithPassword, type SignInResult } from './service';

export const INVITE_TTL_DAYS = 7;
export const RESET_TTL_MINUTES = 60;

export class InvalidLinkError extends DomainError {
  constructor() {
    super('BAD_REQUEST', 400, 'This link is invalid, already used or has expired.', {
      reason: 'TOKEN_INVALID',
    });
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Issues a fresh single-use token; older unused tokens of the same purpose stop working. */
export async function issueAccountToken(
  executor: DbExecutor,
  input: {
    userId: string;
    purpose: schema.AccountTokenPurpose;
    ttlSeconds: number;
    createdBy: string | null;
  },
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const t = schema.accountTokens;
  await executor
    .update(t)
    .set({ usedAt: sql`now()` })
    .where(and(eq(t.userId, input.userId), eq(t.purpose, input.purpose), isNull(t.usedAt)));
  await executor.insert(t).values({
    userId: input.userId,
    purpose: input.purpose,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    createdBy: input.createdBy,
  });
  return token;
}

/** Finds a still-valid token (unused, unexpired) without consuming it. */
async function findValidToken(
  executor: DbExecutor,
  token: string,
  purpose: schema.AccountTokenPurpose,
) {
  const t = schema.accountTokens;
  const [row] = await executor
    .select({ id: t.id, userId: t.userId, expiresAt: t.expiresAt })
    .from(t)
    .where(
      and(
        eq(t.tokenHash, hashToken(token)),
        eq(t.purpose, purpose),
        isNull(t.usedAt),
        gt(t.expiresAt, sql`now()`),
      ),
    );
  return row;
}

/** Marks the token used; false if someone else used it first (double submit). */
async function consumeToken(executor: DbExecutor, tokenId: string): Promise<boolean> {
  const t = schema.accountTokens;
  const used = await executor
    .update(t)
    .set({ usedAt: sql`now()` })
    .where(and(eq(t.id, tokenId), isNull(t.usedAt)))
    .returning({ id: t.id });
  return used.length === 1;
}

export async function setCredentialPassword(
  executor: DbExecutor,
  userId: string,
  password: string,
) {
  const hash = await hashPassword(password);
  await executor
    .insert(schema.accounts)
    .values({ userId, providerId: 'credential', accountId: userId, password: hash })
    .onConflictDoUpdate({
      target: [schema.accounts.providerId, schema.accounts.accountId],
      set: { password: hash, updatedAt: sql`now()` },
    });
}

const appUrl = (path: string) => new URL(path, env.NEXT_PUBLIC_APP_URL).toString();

// ─── Invitations ───────────────────────────────────────────────────────

/** Emails an invitation link. Called after the user + role rows are committed. */
export async function sendInvitationEmail(input: {
  user: { id: string; name: string; email: string };
  token: string;
  invitedByName: string;
  role: Role;
  branchName: string | null;
}): Promise<void> {
  const url = appUrl(`/accept-invite?token=${encodeURIComponent(input.token)}`);
  await sendMail({
    to: input.user.email,
    ...invitationEmail({
      name: input.user.name,
      invitedBy: input.invitedByName,
      roleLabel: ROLE_LABELS[input.role],
      branchName: input.branchName,
      url,
      expiresDays: INVITE_TTL_DAYS,
    }),
  });
}

export interface InvitationPreview {
  name: string;
  email: string;
  roles: { role: Role; branchName: string | null }[];
}

/** Shown on the accept page so people can confirm the invitation is theirs. */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const found = await findValidToken(db, token, 'INVITE');
  if (!found) throw new InvalidLinkError();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, found.userId));
  if (!user || user.status !== 'INVITED') throw new InvalidLinkError();
  const roles = await db
    .select({ role: schema.userRoles.roleCode, branchName: schema.branches.name })
    .from(schema.userRoles)
    .leftJoin(schema.branches, eq(schema.branches.id, schema.userRoles.branchId))
    .where(eq(schema.userRoles.userId, user.id));
  return {
    name: user.name,
    email: user.email,
    roles: roles.map((r) => ({ role: r.role as Role, branchName: r.branchName })),
  };
}

/** Sets the password, activates the account and signs the new user in. */
export async function acceptInvitation(
  ctx: RequestContext,
  token: string,
  password: string,
  requestHeaders: Headers,
): Promise<SignInResult | Awaited<ReturnType<typeof loginWithPassword>>> {
  if (ctx.ip) await enforceRateLimit('invite-accept-ip', ctx.ip, { limit: 20, windowSeconds: 900 });

  const email = await runCommand(ctx, async ({ tx, audit }) => {
    const found = await findValidToken(tx, token, 'INVITE');
    if (!found) throw new InvalidLinkError();
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, found.userId));
    if (!user || user.status !== 'INVITED') throw new InvalidLinkError();
    if (!(await consumeToken(tx, found.id))) throw new InvalidLinkError();

    await setCredentialPassword(tx, user.id, password);
    await tx
      .update(schema.users)
      .set({ status: 'ACTIVE', emailVerified: true })
      .where(eq(schema.users.id, user.id));
    audit({
      action: 'user.invitation_accepted',
      entityType: 'user',
      entityId: user.id,
      before: { status: 'INVITED' },
      after: { status: 'ACTIVE' },
    });
    return user.email;
  });

  // The account is active now; sign in through the normal path (rate limits, audit, 2FA).
  return loginWithPassword(ctx, email, password, requestHeaders);
}

// ─── Password reset ────────────────────────────────────────────────────

/** Always answers the same way (no account discovery). Sends a link only to active accounts. */
export async function requestPasswordReset(ctx: RequestContext, rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  await enforceRateLimit(
    'password-reset',
    email,
    { limit: 3, windowSeconds: 3600 },
    'Too many reset requests. Try again in an hour.',
  );
  if (ctx.ip)
    await enforceRateLimit('password-reset-ip', ctx.ip, { limit: 20, windowSeconds: 3600 });

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, email));
  const [credential] = user
    ? await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(
          and(eq(schema.accounts.userId, user.id), eq(schema.accounts.providerId, 'credential')),
        )
    : [];

  const eligible = user?.status === 'ACTIVE' && Boolean(credential);
  if (eligible && user) {
    const token = await issueAccountToken(db, {
      userId: user.id,
      purpose: 'PASSWORD_RESET',
      ttlSeconds: RESET_TTL_MINUTES * 60,
      createdBy: null,
    });
    await sendMail({
      to: user.email,
      ...passwordResetEmail({
        name: user.name,
        url: appUrl(`/reset-password?token=${encodeURIComponent(token)}`),
        expiresMinutes: RESET_TTL_MINUTES,
      }),
    });
  }
  await recordAudit(ctx, {
    action: 'auth.password_reset_requested',
    entityType: 'user',
    entityId: user?.id ?? null,
    metadata: { emailMasked: maskEmail(email), sent: eligible },
  });
}

/** Sets a new password and signs the account out everywhere (the reset may follow a compromise). */
export async function resetPassword(
  ctx: RequestContext,
  token: string,
  password: string,
): Promise<void> {
  if (ctx.ip)
    await enforceRateLimit('password-reset-confirm-ip', ctx.ip, { limit: 20, windowSeconds: 900 });
  await runCommand(ctx, async ({ tx, audit }) => {
    const found = await findValidToken(tx, token, 'PASSWORD_RESET');
    if (!found) throw new InvalidLinkError();
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, found.userId));
    if (!user || user.status !== 'ACTIVE') throw new InvalidLinkError();
    if (!(await consumeToken(tx, found.id))) throw new InvalidLinkError();

    await setCredentialPassword(tx, user.id, password);
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    audit({ action: 'auth.password_reset', entityType: 'user', entityId: user.id });
  });
}

/** The newest unused, unexpired invitation for a user (shown on the user detail page). */
export async function pendingInvitation(userId: string): Promise<{ expiresAt: Date } | null> {
  const t = schema.accountTokens;
  const [row] = await db
    .select({ expiresAt: t.expiresAt })
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        eq(t.purpose, 'INVITE'),
        isNull(t.usedAt),
        gt(t.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(t.createdAt))
    .limit(1);
  return row ?? null;
}
