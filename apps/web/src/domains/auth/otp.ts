import 'server-only';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { schema } from '@jobbank/db';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getSmsSender } from '@/lib/sms/sms';
import { getAuthSecret } from './secret';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;

const t = schema.otpChallenges;

/** HMAC bound to the phone number: a leaked table row cannot be replayed for another number. */
export function hashOtp(phoneNumber: string, code: string, secret = getAuthSecret()): string {
  return createHmac('sha256', secret).update(`otp:v1:${phoneNumber}:${code}`).digest('base64url');
}

export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

/** Creates a fresh challenge (older open ones are superseded) and texts the code. */
export async function issueOtp(phoneNumber: string, ipAddress: string | null): Promise<void> {
  const code = generateOtpCode();
  console.log(`Issuing OTP for ${phoneNumber}: ${code} (expires in ${OTP_TTL_SECONDS}s)`);
  await db.transaction(async (tx) => {
    await tx
      .update(t)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(t.phoneNumber, phoneNumber), isNull(t.consumedAt)));
    await tx.insert(t).values({
      phoneNumber,
      codeHash: hashOtp(phoneNumber, code),
      maxAttempts: OTP_MAX_ATTEMPTS,
      expiresAt: sql`now() + ${sql.raw(`interval '${OTP_TTL_SECONDS} seconds'`)}`,
      ipAddress,
    });
  });
  await getSmsSender().send(
    phoneNumber,
    `Your Saylani Job Bank code is ${code}. It expires in ${OTP_TTL_SECONDS / 60} minutes. Never share this code with anyone.`,
  );
}

export type OtpCheck = 'ok' | 'invalid' | 'expired' | 'locked';

/**
 * Checks a code against the newest open challenge. Every attempt is counted atomically
 * before comparing, so parallel guesses cannot exceed the attempt limit; a correct code is
 * consumed exactly once.
 */
export async function verifyOtpCode(phoneNumber: string, code: string): Promise<OtpCheck> {
  if (!/^\d{6}$/.test(code)) return 'invalid';

  const [challenge] = await db
    .select()
    .from(t)
    .where(and(eq(t.phoneNumber, phoneNumber), isNull(t.consumedAt)))
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
  const actual = Buffer.from(hashOtp(phoneNumber, code));
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
