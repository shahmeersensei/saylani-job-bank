import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { schema } from '@jobbank/db';
import type { EmployerSignupInput } from '@jobbank/shared';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { recordAudit, runCommand, type RequestContext } from '@/domains/shared/audit';
import { ConflictError, isUniqueViolation, ValidationError } from '@/domains/shared/errors';
import { maskEmail } from '@/domains/shared/masking';
import { enforceRateLimit } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { sendMail } from '@/lib/mail/mailer';
import { signupCodeEmail, signupExistingAccountEmail } from '@/lib/mail/templates';
import { setCredentialPassword } from './account-tokens';
import { generateOtpCode } from './otp';
import { getAuthSecret } from './secret';
import { loginWithPassword, RESEND_AFTER_SECONDS, type SignInResult } from './service';

/**
 * Employer self-registration (M7, owner decision 1): the employer confirms their email with
 * a 6-digit code, then creates an account with a password. The company itself is registered
 * afterwards, from the employer dashboard.
 */

export const SIGNUP_CODE_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
const PURPOSE = 'EMPLOYER_SIGNUP';
const t = schema.emailChallenges;

const normalize = (email: string) => email.trim().toLowerCase();

/** HMAC bound to the purpose and email: a leaked row cannot be replayed elsewhere. */
export function hashEmailCode(email: string, code: string, secret = getAuthSecret()): string {
  return createHmac('sha256', secret)
    .update(`email-code:v1:${PURPOSE}:${email}:${code}`)
    .digest('base64url');
}

async function emailTaken(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, email));
  return Boolean(row);
}

/**
 * Emails a confirmation code. Answers the same way whether or not the email already has an
 * account (that person gets a "sign in instead" email), so it cannot be used to discover
 * who is registered.
 */
export async function requestEmployerSignupCode(ctx: RequestContext, rawEmail: string) {
  const email = normalize(rawEmail);
  await enforceRateLimit(
    'signup-code-resend',
    email,
    { limit: 1, windowSeconds: RESEND_AFTER_SECONDS },
    'Please wait a minute before requesting another code.',
  );
  await enforceRateLimit('signup-code', email, { limit: 5, windowSeconds: 3600 });
  if (ctx.ip) {
    await enforceRateLimit('signup-code-ip', ctx.ip, { limit: 20, windowSeconds: 3600 });
  }

  const existing = await emailTaken(email);
  if (existing) {
    await sendMail({
      to: email,
      ...signupExistingAccountEmail({ url: new URL('/login', env.NEXT_PUBLIC_APP_URL).toString() }),
    });
  } else {
    const code = generateOtpCode();
    await db.transaction(async (tx) => {
      await tx
        .update(t)
        .set({ consumedAt: sql`now()` })
        .where(and(eq(t.email, email), eq(t.purpose, PURPOSE), isNull(t.consumedAt)));
      await tx.insert(t).values({
        email,
        purpose: PURPOSE,
        codeHash: hashEmailCode(email, code),
        maxAttempts: MAX_ATTEMPTS,
        expiresAt: sql`now() + ${sql.raw(`interval '${SIGNUP_CODE_TTL_SECONDS} seconds'`)}`,
        ipAddress: ctx.ip,
      });
    });
    await sendMail({
      to: email,
      ...signupCodeEmail({ code, expiresMinutes: SIGNUP_CODE_TTL_SECONDS / 60 }),
    });
  }
  await recordAudit(ctx, {
    action: 'auth.signup_code_requested',
    entityType: 'email',
    metadata: { emailMasked: maskEmail(email), existingAccount: existing },
  });
  return { expiresInSeconds: SIGNUP_CODE_TTL_SECONDS, resendAfterSeconds: RESEND_AFTER_SECONDS };
}

type CodeCheck = 'ok' | 'invalid' | 'expired' | 'locked';

/** Same rules as SMS codes: attempts are counted atomically before comparing; single use. */
async function checkCode(email: string, code: string): Promise<CodeCheck> {
  const [challenge] = await db
    .select()
    .from(t)
    .where(and(eq(t.email, email), eq(t.purpose, PURPOSE), isNull(t.consumedAt)))
    .orderBy(desc(t.createdAt))
    .limit(1);
  if (!challenge || challenge.expiresAt.getTime() <= Date.now()) return 'expired';

  const [counted] = await db
    .update(t)
    .set({ attempts: sql`${t.attempts} + 1` })
    .where(
      and(
        eq(t.id, challenge.id),
        isNull(t.consumedAt),
        lt(t.attempts, t.maxAttempts),
        gt(t.expiresAt, sql`now()`),
      ),
    )
    .returning({ attempts: t.attempts });
  if (!counted) return 'locked';

  const expected = Buffer.from(challenge.codeHash);
  const actual = Buffer.from(hashEmailCode(email, code));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return counted.attempts >= challenge.maxAttempts ? 'locked' : 'invalid';
  }
  const [consumed] = await db
    .update(t)
    .set({ consumedAt: sql`now()` })
    .where(and(eq(t.id, challenge.id), isNull(t.consumedAt)))
    .returning({ id: t.id });
  return consumed ? 'ok' : 'expired';
}

const CODE_MESSAGES: Record<Exclude<CodeCheck, 'ok'>, string> = {
  invalid: 'The code is incorrect.',
  expired: 'The code has expired. Request a new one.',
  locked: 'Too many incorrect attempts. Request a new code.',
};

const alreadyRegistered = () =>
  new ConflictError('An account with this email already exists. Please sign in instead.', {
    reason: 'EMAIL_TAKEN',
  });

/** Creates the employer account (email already confirmed by the code) and signs them in. */
export async function signUpEmployer(
  ctx: RequestContext,
  input: EmployerSignupInput,
  requestHeaders: Headers,
): Promise<SignInResult> {
  const email = normalize(input.email);
  if (ctx.ip) {
    await enforceRateLimit('signup-ip', ctx.ip, { limit: 20, windowSeconds: 900 });
  }
  // Someone who can read this mailbox may learn that an account exists.
  if (await emailTaken(email)) throw alreadyRegistered();

  const check = await checkCode(email, input.code);
  if (check !== 'ok') {
    await recordAudit(ctx, {
      action: 'auth.signup_failed',
      entityType: 'email',
      metadata: { emailMasked: maskEmail(email), reason: check },
    });
    throw new ValidationError([{ path: 'code', message: CODE_MESSAGES[check] }]);
  }

  try {
    await runCommand(ctx, async ({ tx, audit }) => {
      const [user] = await tx
        .insert(schema.users)
        .values({ name: input.fullName, email, emailVerified: true, status: 'ACTIVE' })
        .returning({ id: schema.users.id });
      await setCredentialPassword(tx, user!.id, input.password);
      await tx.insert(schema.userRoles).values({ userId: user!.id, roleCode: 'EMPLOYER' });
      audit({
        action: 'auth.register_employer',
        entityType: 'user',
        entityId: user!.id,
        after: { name: input.fullName, email },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw alreadyRegistered();
    throw error;
  }

  const result = await loginWithPassword(ctx, email, input.password, requestHeaders);
  if (result.kind !== 'signed_in') throw new Error('A new employer account cannot have 2FA');
  return result;
}
