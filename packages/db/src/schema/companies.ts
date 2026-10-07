import {
  COMPANY_DOCUMENT_STATUSES,
  COMPANY_LOCATION_KINDS,
  COMPANY_MEMBER_ROLES,
  COMPANY_SIZE_BANDS,
  COMPANY_STATUSES,
  DOCUMENT_REVIEW_STATUSES,
  LEGAL_STRUCTURES,
  OPEN_VERIFICATION_STATES,
  VERIFICATION_EVENTS,
  VERIFICATION_STATES,
} from '@jobbank/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
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
 * M7: an employer's company. Created as a DRAFT by the employer's registration wizard; the
 * branch is chosen at the head-office step. While a verification round is open, `status`
 * mirrors the round's state. Only VERIFIED companies are visible to Branch Admin and may
 * post jobs (PRD rule 2) — see `company_is_verified()` for the M8 database check.
 */
export const companies = pgTable(
  'companies',
  {
    id: uuid().primaryKey().defaultRandom(),
    branchId: uuid().references(() => branches.id, { onDelete: 'restrict' }),
    legalName: text().notNull(),
    tradeName: text(),
    legalStructure: text({ enum: LEGAL_STRUCTURES }).notNull(),
    /** "1234567-8", a 7-digit NTN, or a 13-digit CNIC-based NTN. */
    ntn: text().notNull(),
    registrationNo: text(),
    industryCode: text().notNull(),
    sizeBand: text({ enum: COMPANY_SIZE_BANDS }).notNull(),
    website: text(),
    description: text(),
    status: text({ enum: COMPANY_STATUSES }).notNull().default('DRAFT'),
    /** Why the company was suspended (shown to Job Bank staff). */
    statusReason: text(),
    verifiedAt: timestamp({ withTimezone: true }),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    index('companies_branch_status_idx').on(t.branchId, t.status),
    // Owner decision 4: one live company per NTN. Drafts don't count (no squatting), and a
    // rejected company may be re-registered properly by its real owner.
    uniqueIndex('companies_ntn_active_uq')
      .on(t.ntn)
      .where(sql`${t.status} not in ('DRAFT', 'REJECTED')`),
    check('companies_status_valid', sql`${t.status} in (${list(COMPANY_STATUSES)})`),
    check(
      'companies_legal_structure_valid',
      sql`${t.legalStructure} in (${list(LEGAL_STRUCTURES)})`,
    ),
    check('companies_size_band_valid', sql`${t.sizeBand} in (${list(COMPANY_SIZE_BANDS)})`),
    check('companies_ntn_format', sql`${t.ntn} ~ '^([0-9]{7}(-[0-9])?|[1-9][0-9]{12})$'`),
    check(
      'companies_submitted_needs_branch',
      sql`${t.status} = 'DRAFT' or ${t.branchId} is not null`,
    ),
  ],
);

/** Employer accounts acting for a company. v1: one company per account (owner decision 2). */
export const companyMembers = pgTable(
  'company_members',
  {
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text({ enum: COMPANY_MEMBER_ROLES }).notNull().default('OWNER'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.userId] }),
    check('company_members_role_valid', sql`${t.role} in (${list(COMPANY_MEMBER_ROLES)})`),
  ],
);

/** People Job Bank can call about the company; exactly one is the main contact. */
export const companyContacts = pgTable(
  'company_contacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    designation: text(),
    /** E.164. */
    phone: text().notNull(),
    email: text(),
    isPrimary: boolean().notNull().default(false),
    sortOrder: smallint().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('company_contacts_company_idx').on(t.companyId),
    uniqueIndex('company_contacts_one_primary_uq')
      .on(t.companyId)
      .where(sql`${t.isPrimary}`),
  ],
);

/**
 * The head office (exactly one, `kind = HQ`) and other work sites. Jobs (M8) point at a
 * location, so rows are archived rather than deleted.
 */
export const companyLocations = pgTable(
  'company_locations',
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    kind: text({ enum: COMPANY_LOCATION_KINDS }).notNull(),
    label: text().notNull(),
    addressLine: text().notNull(),
    cityCode: text().notNull(),
    areaCode: text(),
    location: geographyPoint().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('company_locations_company_idx').on(t.companyId),
    uniqueIndex('company_locations_one_hq_uq')
      .on(t.companyId)
      .where(sql`${t.kind} = 'HQ'`),
    check('company_locations_kind_valid', sql`${t.kind} in (${list(COMPANY_LOCATION_KINDS)})`),
    check('company_locations_hq_not_archived', sql`${t.kind} = 'SITE' or ${t.archivedAt} is null`),
  ],
);

/**
 * Same upload pattern as applicant documents (presigned PUT → confirm). `status` tracks the
 * upload; `review_status` is the verifier's per-document decision. Rows are never deleted.
 */
export const companyDocuments = pgTable(
  'company_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    typeCode: text().notNull(),
    storageKey: text().notNull().unique(),
    fileName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    status: text({ enum: COMPANY_DOCUMENT_STATUSES }).notNull().default('PENDING_UPLOAD'),
    scanResult: text(),
    reviewStatus: text({ enum: DOCUMENT_REVIEW_STATUSES }).notNull().default('PENDING'),
    reviewNote: text(),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp({ withTimezone: true }),
    uploadedAt: timestamp({ withTimezone: true }),
    /** Superseded by a newer upload, or removed by the employer. */
    replacedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('company_documents_current_idx')
      .on(t.companyId, t.typeCode)
      .where(sql`${t.replacedAt} is null`),
    check(
      'company_documents_status_valid',
      sql`${t.status} in (${list(COMPANY_DOCUMENT_STATUSES)})`,
    ),
    check(
      'company_documents_review_status_valid',
      sql`${t.reviewStatus} in (${list(DOCUMENT_REVIEW_STATUSES)})`,
    ),
    check('company_documents_size_positive', sql`${t.sizeBytes} > 0`),
  ],
);

/** Which documents each legal structure must upload (owner decision 3; Super Admin edits). */
export const companyDocumentRequirements = pgTable(
  'company_document_requirements',
  {
    legalStructure: text({ enum: LEGAL_STRUCTURES }).notNull(),
    /** A DOCUMENT_TYPE master-data code with meta.appliesTo = COMPANY. */
    documentTypeCode: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.legalStructure, t.documentTypeCode] }),
    check(
      'company_document_requirements_structure_valid',
      sql`${t.legalStructure} in (${list(LEGAL_STRUCTURES)})`,
    ),
  ],
);

/**
 * One row per verification round (submission → decision); only one round is open at a time.
 * `branch_id` is copied from the company so the verifier queue can be branch-scoped cheaply.
 * SLA (owner decision 8): due `sla_due_on` (a Pakistan calendar date) = clock start + N
 * working days; the clock restarts when the employer resubmits.
 */
export const companyVerifications = pgTable(
  'company_verifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    round: smallint().notNull(),
    state: text({ enum: VERIFICATION_STATES }).notNull().default('SUBMITTED'),
    assignedVerifierId: uuid().references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp({ withTimezone: true }),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Last (re)submission: the SLA counts from here. */
    clockStartedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    slaDueOn: date({ mode: 'string' }).notNull(),
    /** The employer's latest message when resubmitting. */
    employerNote: text(),
    /** The verifier's latest request for information, and when it was sent (SLA paused). */
    infoRequest: text(),
    infoRequestedAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    decidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    rejectionReasonCode: text(),
    decisionNote: text(),
    ...timestamps,
  },
  (t) => [
    unique('company_verifications_round_uq').on(t.companyId, t.round),
    uniqueIndex('company_verifications_one_open_uq')
      .on(t.companyId)
      .where(sql`${t.state} in (${list(OPEN_VERIFICATION_STATES)})`),
    index('company_verifications_queue_idx').on(t.branchId, t.state, t.slaDueOn),
    index('company_verifications_verifier_idx').on(t.assignedVerifierId, t.state),
    check('company_verifications_state_valid', sql`${t.state} in (${list(VERIFICATION_STATES)})`),
    check(
      'company_verifications_decided',
      sql`(${t.state} in ('VERIFIED', 'REJECTED')) = (${t.decidedAt} is not null)`,
    ),
    check(
      'company_verifications_rejection_reason',
      sql`${t.state} <> 'REJECTED' or ${t.rejectionReasonCode} is not null`,
    ),
  ],
);

/** Append-only log of every verification transition (trigger + revoked UPDATE/DELETE). */
export const verificationHistory = pgTable(
  'verification_history',
  {
    id: uuid().primaryKey().defaultRandom(),
    verificationId: uuid()
      .notNull()
      .references(() => companyVerifications.id, { onDelete: 'restrict' }),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    event: text({ enum: VERIFICATION_EVENTS }).notNull(),
    /** Company status before/after (includes DRAFT and SUSPENDED). */
    fromStatus: text({ enum: COMPANY_STATUSES }),
    toStatus: text({ enum: COMPANY_STATUSES }).notNull(),
    actorId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    note: text(),
    reasonCode: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('verification_history_company_idx').on(t.companyId, t.createdAt),
    index('verification_history_verification_idx').on(t.verificationId, t.createdAt),
    check('verification_history_event_valid', sql`${t.event} in (${list(VERIFICATION_EVENTS)})`),
  ],
);
