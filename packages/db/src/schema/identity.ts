import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const USER_STATUSES = ['ACTIVE', 'DISABLED', 'INVITED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/**
 * Accounts for every role. Shape follows Better Auth's `user` model (+ phone-number plugin
 * fields) so the auth library can read/write it directly.
 * Applicants who sign up by phone get a placeholder email (see PLACEHOLDER_EMAIL_DOMAIN).
 */
export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  phoneNumber: text().unique(),
  phoneNumberVerified: boolean().notNull().default(false),
  status: text({ enum: USER_STATUSES }).notNull().default('ACTIVE'),
  /** Job title / designation for staff, e.g. "Placement Officer". */
  title: text(),
  /** Set by Better Auth's two-factor plugin once an authenticator app is confirmed. */
  twoFactorEnabled: boolean().notNull().default(false),
  lastLoginAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

/** Applicants registering by phone have no email; Better Auth still needs a unique one. */
export const PLACEHOLDER_EMAIL_DOMAIN = 'phone.jobbank.invalid';

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    token: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    ...timestamps,
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Credentials (hashed password) and any future external providers. */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (t) => [
    unique('accounts_provider_account_uq').on(t.providerId, t.accountId),
    index('accounts_user_idx').on(t.userId),
  ],
);

/** Better Auth's generic verification store (password reset tokens etc.). */
export const verifications = pgTable(
  'verifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/**
 * SMS one-time codes. Only an HMAC of the code is stored (never the code itself),
 * bound to the phone number; codes expire and allow a limited number of attempts.
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid().primaryKey().defaultRandom(),
    phoneNumber: text().notNull(),
    codeHash: text().notNull(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** Set when verified successfully, or when superseded by a newer code. */
    consumedAt: timestamp({ withTimezone: true }),
    ipAddress: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('otp_challenges_phone_idx').on(t.phoneNumber, t.createdAt.desc()),
    index('otp_challenges_open_idx')
      .on(t.phoneNumber)
      .where(sql`${t.consumedAt} is null`),
  ],
);

export const EMAIL_CHALLENGE_PURPOSES = ['EMPLOYER_SIGNUP'] as const;

/**
 * Email confirmation codes for new accounts (M7 employer sign-up: the email is confirmed
 * before the account exists, so Better Auth's per-user email OTP cannot be used). Same rules
 * as `otp_challenges`: HMAC only, short expiry, limited attempts, single use.
 */
export const emailChallenges = pgTable(
  'email_challenges',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    purpose: text({ enum: EMAIL_CHALLENGE_PURPOSES }).notNull(),
    codeHash: text().notNull(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    ipAddress: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('email_challenges_open_idx')
      .on(t.email, t.purpose)
      .where(sql`${t.consumedAt} is null`),
  ],
);

/**
 * Authenticator-app (TOTP) secrets — Better Auth two-factor plugin. `secret` is encrypted
 * with the auth secret; backup codes are encrypted too. `verified` stays false until the
 * user confirms their first code, so a half-finished setup never locks anyone out.
 */
export const twoFactors = pgTable(
  'two_factors',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    verified: boolean().notNull().default(true),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
  },
  (t) => [index('two_factors_user_idx').on(t.userId), index('two_factors_secret_idx').on(t.secret)],
);

export const ACCOUNT_TOKEN_PURPOSES = ['INVITE', 'PASSWORD_RESET'] as const;
export type AccountTokenPurpose = (typeof ACCOUNT_TOKEN_PURPOSES)[number];

/**
 * Single-use links sent by email (staff invitations, password resets). Only a SHA-256 of
 * the random token is stored; issuing a new token voids older unused ones.
 */
export const accountTokens = pgTable(
  'account_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text({ enum: ACCOUNT_TOKEN_PURPOSES }).notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_tokens_user_idx').on(t.userId, t.purpose)],
);
