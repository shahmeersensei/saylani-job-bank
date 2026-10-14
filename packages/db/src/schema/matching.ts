import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { vectorColumn } from '../types/vector';

/**
 * Auto matching engine storage (migration 0014). The engine itself lives in
 * `services/matching` (Python) and reads/writes these tables directly; the web
 * app writes the outbox (job publish) and reads the latest run's shortlist.
 */

const MATCH_RUN_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
const MATCH_TRIGGERS = ['PUBLISH', 'RESUME', 'PROFILE_UPDATE', 'MANUAL'] as const;
const MATCH_REVIEW_STATUSES = ['NEW', 'REVIEWED', 'SHORTLISTED', 'HIRED', 'REJECTED'] as const;
export type MatchReviewStatus = (typeof MATCH_REVIEW_STATUSES)[number];
const OUTBOX_STATUSES = ['PENDING', 'PROCESSED', 'FAILED'] as const;

export const matchRuns = pgTable(
  'match_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').notNull(),
    triggerType: text('trigger_type', { enum: MATCH_TRIGGERS }).notNull(),
    status: text('status', { enum: MATCH_RUN_STATUSES }).notNull().default('PENDING'),
    criteriaVersion: integer('criteria_version').notNull().default(1),
    scoringVersion: text('scoring_version').notNull().default('v1'),
    candidateCount: integer('candidate_count'),
    eligibleCount: integer('eligible_count'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('match_runs_active_uq')
      .on(t.jobId)
      .where(sql`${t.status} in ('PENDING', 'RUNNING')`),
    index('match_runs_job_idx').on(t.jobId, t.createdAt),
  ],
);

export const jobMatches = pgTable(
  'job_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull(),
    jobId: uuid('job_id').notNull(),
    applicantId: uuid('applicant_id').notNull(),
    /** 0–100; null while an older debug row exists — the engine always sets it. */
    score: integer('score'),
    distanceM: integer('distance_m'),
    reviewStatus: text('review_status', { enum: MATCH_REVIEW_STATUSES }).notNull().default('NEW'),
    /** Master-data REJECTION_REASON code — required when review_status = REJECTED. */
    reviewReasonCode: text('review_reason_code'),
    reviewNote: text('review_note'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Applicant's answer to a HIRED decision (offer response). */
    applicantResponse: text('applicant_response', {
      enum: ['ACCEPTED', 'DECLINED'] as const,
    }),
    /** Master-data REFUSAL_REASON code — required when applicant_response = DECLINED. */
    refusalReasonCode: text('refusal_reason_code'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    summary: text('summary').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('job_matches_run_applicant_uq').on(t.runId, t.applicantId),
    index('job_matches_job_score_idx').on(t.jobId, t.score),
    check('job_matches_score_range', sql`${t.score} between 0 and 100`),
    check(
      'job_matches_review_status_valid',
      sql`${t.reviewStatus} in ('NEW', 'REVIEWED', 'SHORTLISTED', 'HIRED', 'REJECTED')`,
    ),
    check(
      'job_matches_reject_needs_reason',
      sql`${t.reviewStatus} <> 'REJECTED' or ${t.reviewReasonCode} is not null`,
    ),
    check(
      'job_matches_response_valid',
      sql`${t.applicantResponse} is null or ${t.applicantResponse} in ('ACCEPTED', 'DECLINED')`,
    ),
    check(
      'job_matches_declined_needs_reason',
      sql`${t.applicantResponse} <> 'DECLINED' or ${t.refusalReasonCode} is not null`,
    ),
  ],
);

export const jobMatchFactors = pgTable(
  'job_match_factors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobMatchId: uuid('job_match_id').notNull(),
    factor: text('factor').notNull(),
    score: numeric('score', { precision: 6, scale: 2 }).notNull(),
    weight: numeric('weight', { precision: 6, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex('job_match_factors_match_factor_uq').on(t.jobMatchId, t.factor)],
);

/**
 * Outbox: the job domain appends a row inside the publish transaction; the
 * Python worker claims it with FOR UPDATE SKIP LOCKED, runs the match and
 * marks it PROCESSED (or FAILED with a retry backoff).
 */
export const matchOutbox = pgTable(
  'match_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: OUTBOX_STATUSES }).notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('match_outbox_pending_dedupe_uq')
      .on(t.eventType, t.dedupeKey)
      .where(sql`${t.status} = 'PENDING'`),
    index('match_outbox_claim_idx').on(t.status, t.nextAttemptAt),
  ],
);

/** Phase 3: one embedding per entity per model (pgvector column, 384 dims). */
export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    model: text('model').notNull(),
    content: text('content').notNull(),
    embedding: vectorColumn(384)('embedding'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('embeddings_entity_model_uq').on(t.entityType, t.entityId, t.model)],
);
