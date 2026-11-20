import {
  APPLICANT_DOCUMENT_STATUSES,
  APPLICANT_REGISTRATION_SOURCES,
  APPLICANT_STATUSES,
  APPLICANT_TOKEN_STATUSES,
  GENDERS,
  IDENTITY_METHODS,
  IDENTITY_OUTCOMES,
  IDENTITY_STATUSES,
  LANGUAGE_PROFICIENCIES,
  SKILL_LEVELS,
} from '@jobbank/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from '../types/geography';
import { branches } from './branches';
import { users } from './identity';

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * M6: one profile per applicant account (phone sign-in). The phone number stays on `users`
 * (it is the sign-in identity). `branch_id` is chosen at the location step; a profile can only
 * be ACTIVE (matchable) with a branch. Master-data references store the permanent `code`.
 */
export const applicants = pgTable(
  'applicants',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    branchId: uuid().references(() => branches.id, { onDelete: 'restrict' }),
    registrationSource: text({ enum: APPLICANT_REGISTRATION_SOURCES })
      .notNull()
      .default('SELF_SERVICE'),
    registrationReference: text().notNull().unique(),
    registeredBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    registeredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    contactConfirmedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    contactConfirmedAt: timestamp({ withTimezone: true }),
    fullName: text().notNull(),
    fatherName: text().notNull(),
    /** 13 digits, no dashes. Never sent to employers (PRD rule 3). */
    cnic: text().notNull().unique(),
    dateOfBirth: date({ mode: 'string' }).notNull(),
    gender: text({ enum: GENDERS }).notNull(),
    /** Optional contact email (the `users` row only has a placeholder). */
    email: text(),
    /** The staff member who registered this candidate at a counter; null for self sign-up. */
    counterRegisteredBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /**
     * When staff recorded the candidate's agreement. Set only from the signed
     * paper consent form kept at the branch (counter registration); never
     * defaulted — a missing value means no consent evidence is on file.
     */
    consentConfirmedAt: timestamp({ withTimezone: true }),
    status: text({ enum: APPLICANT_STATUSES }).notNull().default('ACTIVE'),
    /** Why staff deactivated the profile (shown to staff). */
    statusReason: text(),
    /** When the first-counter paper form was verified and signed (null until then). */
    registrationVerifiedSignedAt: timestamp({ withTimezone: true }),
    /** Who recorded the verified & signed mark. */
    registrationVerifiedSignedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Free-text notes from section 6 of the first-counter form. */
    additionalNotes: text(),
    /** Current result of the staff identity check; history is in identity_verifications. */
    identityStatus: text({ enum: IDENTITY_STATUSES }).notNull().default('UNVERIFIED'),
    profileCompleteness: smallint().notNull().default(0),
    hasNoExperience: boolean().notNull().default(false),
    activatedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('applicants_branch_status_idx').on(t.branchId, t.status),
    // Trigram index for the staff `ILIKE '%q%'` name search (profile.ts/staff.ts).
    // GIN has no default opclass for text — `gin_trgm_ops` must be named
    // explicitly or CREATE INDEX fails with 42704 (migration 0027).
    index('applicants_full_name_trgm_idx').using('gin', sql`${t.fullName} gin_trgm_ops`),
    check('applicants_cnic_format', sql`${t.cnic} ~ '^[1-9][0-9]{12}$'`),
    check('applicants_status_valid', sql`${t.status} in (${list(APPLICANT_STATUSES)})`),
    check(
      'applicants_identity_status_valid',
      sql`${t.identityStatus} in (${list(IDENTITY_STATUSES)})`,
    ),
    check('applicants_gender_valid', sql`${t.gender} in (${list(GENDERS)})`),
    check(
      'applicants_registration_source_valid',
      sql`${t.registrationSource} in (${list(APPLICANT_REGISTRATION_SOURCES)})`,
    ),
    check('applicants_completeness_range', sql`${t.profileCompleteness} between 0 and 100`),
    // No branch check: a fresh self-registration has no branch until the
    // location step assigns one (the old applicants_active_needs_branch
    // check only ever exempted DRAFT profiles, and DRAFT is gone).
  ],
);

/** The applicant's current home address (one per applicant; changes are kept in the audit log). The map pin is optional since 2026-11-16: the staff registration form no longer collects a home location, so new registrations have no pin. */
export const applicantAddresses = pgTable('applicant_addresses', {
  applicantId: uuid()
    .primaryKey()
    .references(() => applicants.id, { onDelete: 'cascade' }),
  addressLine: text().notNull(),
  cityCode: text().notNull(),
  areaCode: text(),
  location: geographyPoint(),
  ...timestamps,
});

/**
 * The applicant's permanent home address (one per applicant), mirroring
 * `applicant_addresses`. No map pin is collected for it, so `location` is optional.
 */
export const applicantPermanentAddresses = pgTable('applicant_permanent_addresses', {
  applicantId: uuid()
    .primaryKey()
    .references(() => applicants.id, { onDelete: 'cascade' }),
  addressLine: text().notNull(),
  cityCode: text().notNull(),
  areaCode: text(),
  location: geographyPoint(),
  ...timestamps,
});

export const applicantEducation = pgTable(
  'applicant_education',
  {
    id: uuid().primaryKey().defaultRandom(),
    applicantId: uuid()
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    levelCode: text().notNull(),
    institution: text(),
    fieldOfStudy: text(),
    completionYear: smallint(),
    isCurrent: boolean().notNull().default(false),
    grade: text(),
    sortOrder: smallint().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('applicant_education_applicant_idx').on(t.applicantId)],
);

export const applicantExperience = pgTable(
  'applicant_experience',
  {
    id: uuid().primaryKey().defaultRandom(),
    applicantId: uuid()
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    employerName: text().notNull(),
    jobTitle: text().notNull(),
    categoryCode: text(),
    /** First day of the month. */
    startMonth: date({ mode: 'string' }).notNull(),
    endMonth: date({ mode: 'string' }),
    isCurrent: boolean().notNull().default(false),
    description: text(),
    sortOrder: smallint().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('applicant_experience_applicant_idx').on(t.applicantId),
    check(
      'applicant_experience_dates',
      sql`(${t.isCurrent} and ${t.endMonth} is null)
       or (not ${t.isCurrent} and ${t.endMonth} is not null and ${t.endMonth} >= ${t.startMonth})`,
    ),
  ],
);

export const applicantSkills = pgTable(
  'applicant_skills',
  {
    applicantId: uuid()
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    skillCode: text().notNull(),
    level: text({ enum: SKILL_LEVELS }).notNull(),
    years: smallint().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.applicantId, t.skillCode] }),
    index('applicant_skills_skill_idx').on(t.skillCode),
    check('applicant_skills_level_valid', sql`${t.level} in (${list(SKILL_LEVELS)})`),
    check('applicant_skills_years_range', sql`${t.years} between 0 and 50`),
  ],
);

export const applicantLanguages = pgTable(
  'applicant_languages',
  {
    applicantId: uuid()
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    languageCode: text().notNull(),
    proficiency: text({ enum: LANGUAGE_PROFICIENCIES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.applicantId, t.languageCode] }),
    check(
      'applicant_languages_proficiency_valid',
      sql`${t.proficiency} in (${list(LANGUAGE_PROFICIENCIES)})`,
    ),
  ],
);

export const applicantCertifications = pgTable(
  'applicant_certifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    applicantId: uuid()
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    issuer: text(),
    issuedMonth: date({ mode: 'string' }),
    expiresMonth: date({ mode: 'string' }),
    sortOrder: smallint().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('applicant_certifications_applicant_idx').on(t.applicantId)],
);

export const applicantPreferences = pgTable(
  'applicant_preferences',
  {
    applicantId: uuid()
      .primaryKey()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    categoryCodes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    minSalaryPkr: integer(),
    shifts: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    jobTypes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    availableFrom: date({ mode: 'string' }),
    ...timestamps,
  },
  (t) => [
    check('applicant_preferences_salary', sql`${t.minSalaryPkr} is null or ${t.minSalaryPkr} >= 0`),
  ],
);

/**
 * Uploads go straight from the browser to object storage (presigned PUT); this row tracks
 * them. A new upload of a single-file type sets `replaced_at` on the previous one — rows are
 * never deleted, so staff can always see what was checked.
 */
export const applicantDocuments = pgTable(
  'applicant_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    applicantId: uuid()
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    typeCode: text().notNull(),
    storageKey: text().notNull().unique(),
    fileName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    status: text({ enum: APPLICANT_DOCUMENT_STATUSES }).notNull().default('PENDING_UPLOAD'),
    scanResult: text(),
    reviewNote: text(),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp({ withTimezone: true }),
    uploadedAt: timestamp({ withTimezone: true }),
    /** Superseded by a newer upload, or removed by the applicant. */
    replacedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('applicant_documents_current_idx')
      .on(t.applicantId, t.typeCode)
      .where(sql`${t.replacedAt} is null`),
    check(
      'applicant_documents_status_valid',
      sql`${t.status} in (${list(APPLICANT_DOCUMENT_STATUSES)})`,
    ),
    check('applicant_documents_size_positive', sql`${t.sizeBytes} > 0`),
  ],
);

/**
 * Append-only history of staff identity checks (trigger + revoked UPDATE/DELETE). The latest
 * outcome is copied to `applicants.identity_status`.
 */
export const identityVerifications = pgTable(
  'identity_verifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    applicantId: uuid()
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),
    /** The CNIC that was checked (it can be corrected later). */
    cnic: text().notNull(),
    method: text({ enum: IDENTITY_METHODS }).notNull(),
    outcome: text({ enum: IDENTITY_OUTCOMES }).notNull(),
    notes: text(),
    frontDocumentId: uuid().references(() => applicantDocuments.id, { onDelete: 'restrict' }),
    backDocumentId: uuid().references(() => applicantDocuments.id, { onDelete: 'restrict' }),
    verifiedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('identity_verifications_applicant_idx').on(t.applicantId, t.createdAt),
    check('identity_verifications_method_valid', sql`${t.method} in (${list(IDENTITY_METHODS)})`),
    check(
      'identity_verifications_outcome_valid',
      sql`${t.outcome} in (${list(IDENTITY_OUTCOMES)})`,
    ),
  ],
);

/**
 * First-counter token (2026-11-07 reversal): one row per token issued at a
 * branch. The token number is a daily sequence per branch (1, 2, 3, … from
 * `registration_day`, Pakistan calendar day); the unique index is the guard
 * against two counters issuing the same number. `applicant_id` stays null
 * until the later full-registration step links the completed profile.
 */
export const branchApplicantTokens = pgTable(
  'branch_applicant_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    /** Pakistan calendar day the token was issued (token numbers reset daily). */
    registrationDay: date({ mode: 'string' }).notNull(),
    tokenNumber: integer().notNull(),
    /** 13 digits, no dashes. */
    cnic: text().notNull(),
    applicantName: text().notNull(),
    /** E.164 mobile, e.g. +923001234567. No format CHECK: rows issued before
        this column existed carry '' — validation lives in the shared schema. */
    phone: text().notNull().default(''),
    status: text({ enum: APPLICANT_TOKEN_STATUSES }).notNull().default('ISSUED'),
    /** Linked once the full registration is completed for this token. */
    applicantId: uuid().references(() => applicants.id, { onDelete: 'set null' }),
    /**
     * Applicant ID reserved at issue (8-character registration reference).
     * Null on tokens issued before this column existed. Copied onto
     * `applicants.registration_reference` when the token is registered, and
     * reused on later tokens for the same CNIC until one is registered.
     */
    registrationReference: text(),
    issuedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /**
     * End of the issue day in Pakistan time (migration 0035). Derived from the
     * same instant as `issuedAt` so a midnight rollover can never split the
     * two (N3). An ISSUED token past this instant is expired: it no longer
     * completes and never blocks a new token (dedup is per-day anyway).
     */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    index('branch_applicant_tokens_branch_day_idx').on(t.branchId, t.registrationDay),
    // Daily sequence guard: two counters can never issue the same number.
    uniqueIndex('branch_applicant_tokens_branch_day_number_unique').on(
      t.branchId,
      t.registrationDay,
      t.tokenNumber,
    ),
    // Same-CNIC same-day guard (H22, migration 0031): two counters can never
    // issue different tokens for the same person on the same day. Matches the
    // migration SQL exactly so `db:generate` emits no diff.
    uniqueIndex('branch_applicant_tokens_branch_day_cnic_issued_unique')
      .on(t.branchId, t.registrationDay, t.cnic)
      .where(sql`"status" = 'ISSUED'`),
    index('branch_applicant_tokens_cnic_idx').on(t.cnic),
    index('branch_applicant_tokens_registration_reference_idx')
      .on(t.registrationReference)
      .where(sql`"registration_reference" is not null`),
    check('branch_applicant_tokens_number_positive', sql`${t.tokenNumber} > 0`),
    // N6 cap (MAX_TOKEN_NUMBER in @jobbank/shared): no 5-digit token numbers.
    check('branch_applicant_tokens_number_max', sql`${t.tokenNumber} <= 9999`),
    check('branch_applicant_tokens_expires_after_issued', sql`${t.expiresAt} > ${t.issuedAt}`),
    check('branch_applicant_tokens_cnic_format', sql`${t.cnic} ~ '^[1-9][0-9]{12}$'`),
    check(
      'branch_applicant_tokens_status_valid',
      sql`${t.status} in (${list(APPLICANT_TOKEN_STATUSES)})`,
    ),
  ],
);

/** QR verification credentials are hash-indexed; ciphertext is only for authorized reprints. */
export const applicantVerificationTokens = pgTable(
  'applicant_verification_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    applicantId: uuid()
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull().unique(),
    tokenCiphertext: text().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('applicant_verification_tokens_active_applicant_idx')
      .on(t.applicantId)
      .where(sql`${t.isActive}`),
    index('applicant_verification_tokens_applicant_idx').on(t.applicantId, t.createdAt),
    check(
      'applicant_verification_tokens_revocation_consistent',
      sql`(${t.isActive} and ${t.revokedAt} is null and ${t.revokedBy} is null)
       or (not ${t.isActive} and ${t.revokedAt} is not null)`,
    ),
  ],
);
