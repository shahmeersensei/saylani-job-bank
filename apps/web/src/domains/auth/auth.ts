import 'server-only';
import { schema } from '@jobbank/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { phoneNumber, twoFactor } from 'better-auth/plugins';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { verifyOtpCode } from './otp';
import { getAuthSecret } from './secret';

export const SESSION_COOKIE_PREFIX = 'jb';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Applicants registering by phone get this placeholder email (Better Auth needs one). */
export const placeholderEmailFor = (e164: string) =>
  `${e164.replace('+', '')}@${schema.PLACEHOLDER_EMAIL_DOMAIN}`;
export const isPlaceholderEmail = (email: string) =>
  email.endsWith(`@${schema.PLACEHOLDER_EMAIL_DOMAIN}`);

function createAuth() {
  return betterAuth({
    appName: 'Saylani Job Bank',
    baseURL: env.NEXT_PUBLIC_APP_URL,
    secret: getAuthSecret(),
    trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        twoFactor: schema.twoFactors,
      },
    }),
    advanced: {
      cookiePrefix: SESSION_COOKIE_PREFIX,
      useSecureCookies: env.NEXT_PUBLIC_APP_URL.startsWith('https://'),
      database: { generateId: 'uuid' },
    },
    // Our /api/v1/auth endpoints apply their own (Redis-backed) limits.
    rateLimit: { enabled: false },
    // One log pipeline: redaction, JSON in production, and LOG_LEVEL (silent in tests).
    logger: {
      log: (level, message, ...args) =>
        logger[level](`[better-auth] ${message}`, args.length ? { details: args } : undefined),
    },
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        status: { type: 'string', required: false, defaultValue: 'ACTIVE', input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Staff are invited (M4) and employers register through /companies/register (M7);
      // Better Auth's own HTTP handler is never mounted, so there is no public sign-up.
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    plugins: [
      // Authenticator-app 2FA: required for Super Admin, Branch Admin, Staff
      // and Employer, optional for Verifier / Interviewer-Scheduler.
      // (Employer email-code sign-in was retired with mandatory employer 2FA
      // 2026-11-15: a passwordless emailed code would bypass the authenticator,
      // so the emailOTP plugin was removed rather than left as a back door.)
      twoFactor({
        issuer: 'Saylani Job Bank',
        backupCodeOptions: { amount: 10, length: 10 },
        twoFactorCookieMaxAge: 600,
        // 30 days. The cookie is Secure whenever NEXT_PUBLIC_APP_URL is https
        // (useSecureCookies above), which is how production is published
        // through the Cloudflare tunnel. No extra proxy setting is required:
        // the browser stores the cookie on the https page and sends it back.
        trustDeviceMaxAge: 30 * 24 * 60 * 60,
      }),
      phoneNumber({
        otpLength: 6,
        // Our own challenge table stores only an HMAC of the code (the plugin stores codes in
        // plain text). Codes are issued by /api/v1/auth/otp/request, not by the plugin.
        sendOTP: () => {
          throw new Error('OTP sending is handled by domains/auth/otp.ts');
        },
        verifyOTP: async ({ phoneNumber: phone, code }) => {
          const result = await verifyOtpCode(phone, code);
          if (result === 'locked') {
            throw new APIError('FORBIDDEN', {
              code: 'OTP_LOCKED',
              message: 'Too many incorrect attempts. Request a new code.',
            });
          }
          if (result !== 'ok') return false;
          const [user] = await db
            .select({ status: schema.users.status })
            .from(schema.users)
            .where(eq(schema.users.phoneNumber, phone));
          if (user && user.status !== 'ACTIVE') {
            throw new APIError('FORBIDDEN', {
              code: 'ACCOUNT_DISABLED',
              message: 'This account is disabled.',
            });
          }
          return true;
        },
        signUpOnVerification: {
          getTempEmail: placeholderEmailFor,
          getTempName: () => 'New applicant',
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // Phone sign-ups are applicants by definition.
          after: async (user) => {
            if (isPlaceholderEmail(user.email)) {
              await db
                .insert(schema.userRoles)
                .values({ userId: user.id, roleCode: 'APPLICANT' })
                .onConflictDoNothing();
            }
          },
        },
      },
      session: {
        create: {
          // Defence in depth: services already refuse disabled users before signing in.
          before: async (session) => {
            const [user] = await db
              .select({ status: schema.users.status })
              .from(schema.users)
              .where(eq(schema.users.id, session.userId));
            if (!user || user.status !== 'ACTIVE') return false;
            return { data: session };
          },
          after: async (session) => {
            await db
              .update(schema.users)
              .set({ lastLoginAt: sql`now()` })
              .where(eq(schema.users.id, session.userId));
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

// Module-scoped (not globalThis): it holds no connections, and must be rebuilt after a hot
// reload so it picks up the fresh drizzle wrapper (see lib/db).
let instance: Auth | undefined;

/** Lazily created so importing this module never needs env/DB (tests, build). */
export function getAuth(): Auth {
  return (instance ??= createAuth());
}
