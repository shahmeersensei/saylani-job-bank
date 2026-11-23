'server-only';
import { schema } from '@jobbank/db';
import type { PaginationMeta } from '@jobbank/shared';
import { and, count, desc, eq, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { runCommand } from '@/domains/shared/audit';
import { formatDateTime } from '@/lib/format/date';
import { paginationMeta, type ListQuery } from '@/domains/shared/pagination';
import { enforceRateLimit } from '@/domains/shared/rate-limit';
import {
  ConflictError,
  ForbiddenError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '@/domains/shared/errors';
import {
  assertBranchAccess,
  assertCityAccess,
  assertPermission,
  assertRole,
  branchScope,
  type Actor,
} from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { createNotification, notifyCompanyEmployers } from '@/domains/notifications';
import {
  assertJobLive,
  assertJobOpen,
  isReferrableApplicant,
  loadJob,
  loadJobForUpdate,
} from '@/domains/job';
import type { RequestContext } from '@/domains/shared/audit';
import { lockAndTransitionApplication } from './machine';
import { assertFutureInterviewAt, futureInterviewAtSchema } from './interview-date';

export {
  assertFutureInterviewAt,
  futureInterviewAtSchema,
  INTERVIEW_AT_GRACE_MS,
} from './interview-date';
export type ApplicationStatus =
  | 'SHORTLISTED'
  | 'INTERVIEW_SCHEDULED'
  | 'INTERVIEW_POSTPONED'
  | 'INTERVIEW_CANCELLED'
  | 'INTERVIEW_PASSED'
  | 'INTERVIEW_FAILED'
  | 'FORWARDED'
  | 'EMPLOYER_INTERVIEW_SCHEDULED'
  | 'EMPLOYER_INTERVIEW_POSTPONED'
  | 'EMPLOYER_INTERVIEW_CANCELLED'
  | 'ON_HOLD'
  | 'OFFER_EXTENDED'
  | 'EMPLOYER_REJECTED'
  | 'APPLICANT_REFUSED'
  | 'HIRED'
  | 'REJECTED';

type SignedIn = RequestContext & { actor: Actor };

const ap = schema.applications;

/**
 * M32 — pagination for the placement lists. Pass a ListQuery (parsed with
 * parseListQuery, pageSize capped at 100 by the helper) to get one page
 * plus pagination metadata. Without a query the full list is returned, as
 * before — existing dashboard callers still call it that way.
 */
export type PlacementListQuery = Pick<
  ListQuery<'createdAt', Record<string, never>>,
  'page' | 'pageSize' | 'offset' | 'limit'
>;

// ─── Types ────────────────────────────────────────────────────────────────

export interface ApplicationView {
  id: string;
  applicantId: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  companyId: string;
  branchId: string;
  status: ApplicationStatus;
  note: string | null;
  interviewAt: string | null;
  interviewLocation: string | null;
  interviewNote: string | null;
  // 0052 — Job Bank interview outcome (null until an outcome is recorded).
  interviewAttendance: 'ATTENDED' | 'NO_SHOW' | null;
  interviewResult: 'PASSED' | 'FAILED' | null;
  interviewFeedback: string | null;
  interviewOutcomeAt: string | null;
  interviewOutcomeBy: string | null;
  // Employer interview stage
  employerInterviewAt: string | null;
  employerInterviewLocation: string | null;
  employerInterviewNote: string | null;
  // Employer decision
  employerDecision: string | null;
  employerDecisionNote: string | null;
  // Applicant refusal
  applicantRefusalReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────

export const shortlistSchema = z.object({
  applicantId: z.uuid(),
  jobId: z.uuid(),
  note: z.string().trim().max(500).optional(),
});
export type ShortlistInput = z.infer<typeof shortlistSchema>;

export const scheduleInterviewSchema = z.object({
  interviewAt: futureInterviewAtSchema,
  interviewLocation: z.string().trim().min(3).max(300).optional(),
  interviewNote: z.string().trim().max(500).optional(),
});
export type ScheduleInterviewInput = z.infer<typeof scheduleInterviewSchema>;

export const INTERVIEW_UPDATE_STATUSES = [
  'INTERVIEW_POSTPONED',
  'INTERVIEW_CANCELLED',
  'INTERVIEW_SCHEDULED',
] as const;
export type InterviewUpdateStatus = (typeof INTERVIEW_UPDATE_STATUSES)[number];

export const updateInterviewStatusSchema = z
  .object({
    status: z.enum(INTERVIEW_UPDATE_STATUSES),
    interviewAt: futureInterviewAtSchema.optional(),
    interviewLocation: z.string().trim().max(300).optional(),
    interviewNote: z.string().trim().max(500).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    // M19 — rescheduling back to SCHEDULED without a new date would silently
    // keep the old date; the new date is required.
    if (v.status === 'INTERVIEW_SCHEDULED' && !v.interviewAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['interviewAt'],
        message: 'Provide a new interview date & time when rescheduling',
      });
    }
  });
export type UpdateInterviewStatusInput = z.infer<typeof updateInterviewStatusSchema>;

// ─── 0052 — interview outcome ──────────────────────────────────────────

export const INTERVIEW_ATTENDANCES = ['ATTENDED', 'NO_SHOW'] as const;
export type InterviewAttendance = (typeof INTERVIEW_ATTENDANCES)[number];
export const INTERVIEW_RESULTS = ['PASSED', 'FAILED'] as const;
export type InterviewResult = (typeof INTERVIEW_RESULTS)[number];

/**
 * Outcome of a scheduled Job Bank interview. A no-show is always a fail
 * (attendance NO_SHOW forces result FAILED); feedback is required when the
 * candidate fails (≥5 chars, M19-style evidence rule) and optional on a
 * pass. No new seed reason codes: NO_SHOW is captured by `attendance`,
 * and a failed performance is described in `feedback`.
 */
export const recordInterviewOutcomeSchema = z
  .object({
    attendance: z.enum(INTERVIEW_ATTENDANCES),
    result: z.enum(INTERVIEW_RESULTS),
    feedback: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.attendance === 'NO_SHOW' && v.result !== 'FAILED') {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'A no-show is always recorded as failed',
      });
    }
    if (v.result === 'FAILED' && (v.feedback?.trim().length ?? 0) < 5) {
      ctx.addIssue({
        code: 'custom',
        path: ['feedback'],
        message: 'Feedback is required when the candidate fails (at least 5 characters)',
      });
    }
  });
export type RecordInterviewOutcomeInput = z.infer<typeof recordInterviewOutcomeSchema>;

/**
 * True when the actor's only interview/referral power comes from the
 * INTERVIEWER_SCHEDULER role — i.e. they hold no STAFF / BRANCH_ADMIN role.
 * A dual-role user (e.g. Branch Admin + Interviewer) is treated as Staff/BA,
 * not as interviewer-only. Pure helper, unit-tested without a DB.
 */
export function isInterviewerOnlyReferrer(actor: Actor): boolean {
  return (
    actor.roles.includes('INTERVIEWER_SCHEDULER') &&
    !actor.roles.some((r) => r === 'STAFF' || r === 'BRANCH_ADMIN')
  );
}

/**
 * Statuses an actor may refer to the employer from. Interviewer-only
 * actors may refer ONLY from INTERVIEW_PASSED; Staff/BA keep their
 * existing range, plus PASSED (they may also forward a passed candidate).
 * Pure helper, unit-tested without a DB; referApplicantToEmployer enforces it.
 */
export function referableStatusesFor(actor: Actor): ApplicationStatus[] {
  if (isInterviewerOnlyReferrer(actor)) return ['INTERVIEW_PASSED'];
  return ['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_POSTPONED', 'INTERVIEW_PASSED'];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function buildView(row: typeof ap.$inferSelect): Promise<ApplicationView> {
  const [jobRow] = await db
    .select({
      title: schema.jobs.title,
      companyId: schema.jobs.companyId,
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, row.jobId));

  let company: Pick<typeof schema.companies.$inferSelect, 'tradeName' | 'legalName'> | undefined;
  if (jobRow) {
    const [c] = await db
      .select({ tradeName: schema.companies.tradeName, legalName: schema.companies.legalName })
      .from(schema.companies)
      .where(eq(schema.companies.id, jobRow.companyId));
    company = c;
  }

  return toView(row, jobRow, company);
}

/**
 * Batched views for the list endpoints: ONE jobs query + ONE companies
 * query for the whole page, instead of two queries per row. listInterviews
 * runs on every dashboard refresh (every 30s via DashboardAutoRefresh),
 * so the per-row lookups Copilot flagged grew with historical data —
 * this keeps the refresh at a constant number of queries.
 */
async function buildViews(rows: (typeof ap.$inferSelect)[]): Promise<ApplicationView[]> {
  if (rows.length === 0) return [];
  const jobs = await db
    .select({
      id: schema.jobs.id,
      title: schema.jobs.title,
      companyId: schema.jobs.companyId,
    })
    .from(schema.jobs)
    .where(inArray(schema.jobs.id, [...new Set(rows.map((r) => r.jobId))]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const companyIds = [...new Set(jobs.map((j) => j.companyId))];
  const companies =
    companyIds.length === 0
      ? []
      : await db
          .select({
            id: schema.companies.id,
            tradeName: schema.companies.tradeName,
            legalName: schema.companies.legalName,
          })
          .from(schema.companies)
          .where(inArray(schema.companies.id, companyIds));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  return rows.map((row) => {
    const jobRow = jobById.get(row.jobId);
    return toView(row, jobRow, jobRow ? companyById.get(jobRow.companyId) : undefined);
  });
}

/** Pure row → view mapping, shared by the single-row and batched loaders. */
function toView(
  row: typeof ap.$inferSelect,
  jobRow: Pick<typeof schema.jobs.$inferSelect, 'title' | 'companyId'> | undefined,
  company: Pick<typeof schema.companies.$inferSelect, 'tradeName' | 'legalName'> | undefined,
): ApplicationView {
  return {
    id: row.id,
    applicantId: row.applicantId,
    jobId: row.jobId,
    jobTitle: jobRow?.title ?? '',
    companyName: company?.tradeName ?? company?.legalName ?? '',
    companyId: jobRow?.companyId ?? '',
    branchId: row.branchId,
    status: row.status,
    note: row.note,
    interviewAt: row.interviewAt?.toISOString() ?? null,
    interviewLocation: row.interviewLocation,
    interviewNote: row.interviewNote,
    interviewAttendance:
      (row.interviewAttendance as ApplicationView['interviewAttendance']) ?? null,
    interviewResult: (row.interviewResult as ApplicationView['interviewResult']) ?? null,
    interviewFeedback: row.interviewFeedback,
    interviewOutcomeAt: row.interviewOutcomeAt?.toISOString() ?? null,
    interviewOutcomeBy: row.interviewOutcomeBy ?? null,
    employerInterviewAt: row.employerInterviewAt?.toISOString() ?? null,
    employerInterviewLocation: row.employerInterviewLocation,
    employerInterviewNote: row.employerInterviewNote,
    employerDecision: row.employerDecision ?? null,
    employerDecisionNote: row.employerDecisionNote ?? null,
    applicantRefusalReason: row.applicantRefusalReason ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────

/** Staff or Branch Admin: shortlist an applicant for a specific job. */
export async function shortlistApplicant(
  ctx: SignedIn,
  input: ShortlistInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'match_case:manage');
  // Audit 2026-11-11 (L-20): shortlists fire notifications — 30 per
  // staff member per hour is plenty for real work, and stops spam.
  await enforceRateLimit(
    'shortlist',
    ctx.actor.userId,
    { limit: 30, windowSeconds: 3600 },
    'Too many shortlists. Try again in an hour.',
  );

  // Verify applicant exists and actor has city access
  const [applicantRow] = await db
    .select({
      id: schema.applicants.id,
      userId: schema.applicants.userId,
      branchId: schema.applicants.branchId,
      status: schema.applicants.status,
      identityStatus: schema.applicants.identityStatus,
    })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, input.applicantId));
  if (!applicantRow) throw new NotFoundError('Applicant', input.applicantId);
  // Audit 2026-11-10 (D-F1): the two-step flow never checked eligibility,
  // so a RESTRICTED applicant (or REJECTED identity) could be shortlisted
  // and forwarded to an employer — the same interim rule the direct-refer
  // and job→applicant paths already enforce.
  if (!isReferrableApplicant(applicantRow))
    throw new ForbiddenError(
      'Candidates cannot be shortlisted from restricted or rejected profiles',
    );
  await assertCityAccess(ctx.actor, applicantRow.branchId, {
    entityType: 'applicant',
    entityId: applicantRow.id,
  });

  // Verify job exists and is open
  const [jobRow] = await db
    .select({
      id: schema.jobs.id,
      title: schema.jobs.title,
      companyId: schema.jobs.companyId,
      branchId: schema.jobs.branchId,
      status: schema.jobs.status,
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, input.jobId));
  if (!jobRow) throw new NotFoundError('Job', input.jobId);
  if (jobRow.status !== 'OPEN')
    throw new ForbiddenError('Only OPEN jobs can receive shortlisted candidates');

  // A suspended or rejected company must not keep collecting candidates:
  // shortlisting is only for companies that are verified right now.
  const [companyRow] = await db
    .select({ status: schema.companies.status })
    .from(schema.companies)
    .where(eq(schema.companies.id, jobRow.companyId));
  if (companyRow?.status !== 'VERIFIED')
    throw new ForbiddenError('Only verified companies can receive shortlisted candidates');

  // Check for duplicate
  const [existing] = await db
    .select({ id: ap.id })
    .from(ap)
    .where(and(eq(ap.applicantId, input.applicantId), eq(ap.jobId, input.jobId)));
  if (existing) throw new ConflictError('This applicant is already shortlisted for this job');

  let view: ApplicationView;
  try {
    view = await runCommand(ctx, async ({ tx, audit }) => {
      const [row] = await tx
        .insert(ap)
        .values({
          applicantId: input.applicantId,
          jobId: input.jobId,
          branchId: jobRow.branchId,
          createdBy: ctx.actor.userId,
          note: input.note ?? null,
          status: 'SHORTLISTED',
        })
        .returning();

      audit({
        action: 'application.shortlist',
        entityType: 'application',
        entityId: row!.id,
        branchId: jobRow.branchId,
      });
      return row!;
    }).then(buildView);
  } catch (error) {
    // Audit 2026-11-11 (L-21): two concurrent shortlists race the
    // duplicate pre-check above — the unique index catches it. Map it to
    // the same specific message as the pre-check instead of a generic 409.
    if (!isUniqueViolation(error, 'applications_applicant_job_uq')) throw error;
    throw new ConflictError('This applicant is already shortlisted for this job');
  }

  // M25 — the applicant must hear they were shortlisted: until now only the
  // referral was notified, so a shortlisted applicant heard nothing.
  void createNotification(db, {
    userId: applicantRow.userId,
    type: 'MATCH_SHORTLISTED',
    title: `Shortlisted — ${jobRow.title}`,
    body: `You have been shortlisted for ${jobRow.title}. Job Bank staff will contact you about the next steps.`,
    data: { applicationId: view.id, jobId: jobRow.id, jobTitle: jobRow.title },
  }).catch((err) =>
    ctx.log.error('shortlist notification failed', { applicationId: view.id, err }),
  );

  return view;
}

/** Staff / Branch Admin: schedule a Job Bank interview for an application. */
export async function scheduleInterview(
  ctx: SignedIn,
  applicationId: string,
  input: ScheduleInterviewInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'interview:schedule_jobbank');
  // Audit 2026-11-23 (MEDIUM-1): scheduling writes audit rows and fires
  // an applicant notification, so it gets the same 30/hr budget as the
  // shortlist/refer commands — without it one account could spam an
  // applicant with "interview scheduled" notifications.
  await enforceRateLimit(
    'interview-schedule',
    ctx.actor.userId,
    { limit: 30, windowSeconds: 3600 },
    'Too many interview updates. Try again in an hour.',
  );

  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId));
  if (!row) throw new NotFoundError('Application', applicationId);

  if (row.status === 'REJECTED' || row.status === 'HIRED')
    throw new ForbiddenError('Cannot schedule an interview for a closed application');

  // Audit 2026-11-11 (M-09): interviews are in-flight pipeline steps — the
  // job must still be live (OPEN or PAUSED), never closed/expired/filled.
  // Re-checked under the job lock inside the transaction.
  assertJobLive(await loadJob(db, row.jobId), 'schedule an interview for this application');

  // H11 — service-level backstop: the schema already rejects past dates, but
  // direct callers bypass it.
  assertFutureInterviewAt(input.interviewAt);

  // Audit 2026-11-23 (HIGH-1): the interviewer's own lists are
  // branch-exact, so his commands must be too. A city check here would
  // let one branch's interviewer act on another same-city branch's
  // applications via a direct API call. Staff/BA keep the established
  // city-wide rule; only the interviewer-only actor is branch-pinned.
  if (isInterviewerOnlyReferrer(ctx.actor)) {
    assertBranchAccess(ctx.actor, row.branchId, {
      entityType: 'application',
      entityId: row.id,
    });
  } else {
    await assertCityAccess(ctx.actor, row.branchId, {
      entityType: 'application',
      entityId: row.id,
    });
  }

  const view = await runCommand(ctx, async ({ tx, audit }) => {
    assertJobLive(
      await loadJobForUpdate(tx, row.jobId),
      'schedule an interview for this application',
    );
    const { to } = await lockAndTransitionApplication(tx, applicationId, 'SCHEDULE_INTERVIEW');
    const [updated] = await tx
      .update(ap)
      .set({
        status: to,
        interviewAt: new Date(input.interviewAt),
        interviewLocation: input.interviewLocation ?? null,
        interviewNote: input.interviewNote ?? null,
        scheduledBy: ctx.actor.userId,
        // Ported from Najam: reset so the newly scheduled interview
        // re-appears in the call list (see listPendingCalls).
        lastCallStatus: null,
        updatedAt: new Date(),
      })
      .where(eq(ap.id, applicationId))
      .returning();

    audit({
      action: 'application.interview_scheduled',
      entityType: 'application',
      entityId: applicationId,
      branchId: row.branchId,
    });
    return updated!;
  }).then(buildView);

  // The applicant must hear about their first interview too: until now only
  // postponements and cancellations were notified.
  void notifyApplicantOfInterviewUpdate(ctx, row.applicantId, view, 'INTERVIEW_SCHEDULED').catch(
    (err) => ctx.log.error('interview notification failed', { applicationId, err }),
  );

  return view;
}

/** Staff / Branch Admin: update the status and details of a scheduled interview. */
export async function updateInterviewStatus(
  ctx: SignedIn,
  applicationId: string,
  input: UpdateInterviewStatusInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'interview:schedule_jobbank');
  // Audit 2026-11-23 (MEDIUM-1): same budget as scheduleInterview —
  // reschedules and postponements notify the applicant too.
  await enforceRateLimit(
    'interview-schedule',
    ctx.actor.userId,
    { limit: 30, windowSeconds: 3600 },
    'Too many interview updates. Try again in an hour.',
  );

  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId));
  if (!row) throw new NotFoundError('Application', applicationId);

  // Audit 2026-11-23 (HIGH-1): the interviewer's own lists are
  // branch-exact, so his commands must be too. A city check here would
  // let one branch's interviewer act on another same-city branch's
  // applications via a direct API call. Staff/BA keep the established
  // city-wide rule; only the interviewer-only actor is branch-pinned.
  if (isInterviewerOnlyReferrer(ctx.actor)) {
    assertBranchAccess(ctx.actor, row.branchId, {
      entityType: 'application',
      entityId: row.id,
    });
  } else {
    await assertCityAccess(ctx.actor, row.branchId, {
      entityType: 'application',
      entityId: row.id,
    });
  }

  const interviewStatuses: ApplicationStatus[] = [
    'INTERVIEW_SCHEDULED',
    'INTERVIEW_POSTPONED',
    'INTERVIEW_CANCELLED',
  ];
  if (!interviewStatuses.includes(row.status))
    throw new ForbiddenError('Can only update status for applications with a scheduled interview');

  // Audit 2026-11-11 (M-09): same live-job rule as scheduleInterview.
  assertJobLive(await loadJob(db, row.jobId), 'update the interview for this application');

  // H11 — a supplied new date must be in the future.
  if (input.status === 'INTERVIEW_SCHEDULED' && input.interviewAt) {
    assertFutureInterviewAt(input.interviewAt);
  }
  // M19 — service-level backstop for the schema rule above: rescheduling
  // without a new date must not silently keep the old date.
  if (input.status === 'INTERVIEW_SCHEDULED' && !input.interviewAt) {
    throw new ValidationError([
      { path: 'interviewAt', message: 'Provide a new interview date & time when rescheduling' },
    ]);
  }

  const view = await runCommand(ctx, async ({ tx, audit }) => {
    assertJobLive(
      await loadJobForUpdate(tx, row.jobId),
      'update the interview for this application',
    );
    const event =
      input.status === 'INTERVIEW_SCHEDULED'
        ? 'RESCHEDULE_INTERVIEW'
        : input.status === 'INTERVIEW_POSTPONED'
          ? 'POSTPONE_INTERVIEW'
          : 'CANCEL_INTERVIEW';
    const { to } = await lockAndTransitionApplication(tx, applicationId, event);
    const patch: Partial<typeof ap.$inferInsert> = {
      status: to,
      note: input.note ?? row.note,
      // Ported from Najam: reset so a (re)scheduled interview re-appears
      // in the call list (listPendingCalls hides rows whose lastCallStatus
      // equals their current status).
      lastCallStatus: null,
      updatedAt: new Date(),
    };
    if (input.status === 'INTERVIEW_SCHEDULED') {
      if (input.interviewAt) patch.interviewAt = new Date(input.interviewAt);
      if (input.interviewLocation !== undefined) patch.interviewLocation = input.interviewLocation;
      if (input.interviewNote !== undefined) patch.interviewNote = input.interviewNote;
    }

    const [updated] = await tx.update(ap).set(patch).where(eq(ap.id, applicationId)).returning();
    audit({
      action: 'application.interview_status_updated',
      entityType: 'application',
      entityId: applicationId,
      branchId: row.branchId,
      metadata: { status: input.status },
    });
    return updated!;
  }).then(buildView);

  // Notify the applicant of the interview status change (best-effort, post-commit).
  // Audit 2026-11-11 (L-11): reaching here with INTERVIEW_SCHEDULED always
  // means a reschedule — a first schedule goes through scheduleInterview —
  // so the applicant hears "rescheduled", not "scheduled".
  const notifStatus =
    input.status === 'INTERVIEW_SCHEDULED' && row.interviewAt
      ? 'INTERVIEW_RESCHEDULED'
      : input.status;
  void notifyApplicantOfInterviewUpdate(ctx, row.applicantId, view, notifStatus).catch((err) =>
    ctx.log.error('interview status notification failed', { applicationId, err }),
  );

  return view;
}

/**
 * 0052 — Interviewer / Staff / Branch Admin: record the outcome of a
 * scheduled Job Bank interview. Only from INTERVIEW_SCHEDULED or
 * INTERVIEW_POSTPONED (the machine rejects SHORTLISTED, CANCELLED, PASSED
 * and FAILED alike); a FAILED outcome is terminal for the interview stage,
 * a PASSED outcome is the interviewer-only actor's only route to referral.
 */
export async function recordInterviewOutcome(
  ctx: SignedIn,
  applicationId: string,
  input: RecordInterviewOutcomeInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'interview:record_outcome');
  // Audit 2026-11-23 (MEDIUM-1): outcomes write audit rows and notify
  // the applicant, so they get the same 30/hr budget as the other
  // interview commands.
  await enforceRateLimit(
    'interview-outcome',
    ctx.actor.userId,
    { limit: 30, windowSeconds: 3600 },
    'Too many interview outcomes. Try again in an hour.',
  );

  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId));
  if (!row) throw new NotFoundError('Application', applicationId);

  if (row.status !== 'INTERVIEW_SCHEDULED' && row.status !== 'INTERVIEW_POSTPONED')
    throw new ForbiddenError('Record an outcome only for a scheduled interview');

  // Same live-job rule as scheduleInterview: an outcome on a closed job
  // is moot. Re-checked under the job lock inside the transaction.
  assertJobLive(await loadJob(db, row.jobId), 'record an interview outcome for this application');

  // Audit 2026-11-23 (HIGH-1): the interviewer's own lists are
  // branch-exact, so his commands must be too. A city check here would
  // let one branch's interviewer act on another same-city branch's
  // applications via a direct API call. Staff/BA keep the established
  // city-wide rule; only the interviewer-only actor is branch-pinned.
  if (isInterviewerOnlyReferrer(ctx.actor)) {
    assertBranchAccess(ctx.actor, row.branchId, {
      entityType: 'application',
      entityId: row.id,
    });
  } else {
    await assertCityAccess(ctx.actor, row.branchId, {
      entityType: 'application',
      entityId: row.id,
    });
  }

  const event = input.result === 'PASSED' ? 'RECORD_INTERVIEW_PASS' : 'RECORD_INTERVIEW_FAIL';
  const view = await runCommand(ctx, async ({ tx, audit }) => {
    assertJobLive(
      await loadJobForUpdate(tx, row.jobId),
      'record an interview outcome for this application',
    );
    const { to } = await lockAndTransitionApplication(tx, applicationId, event);
    const [updated] = await tx
      .update(ap)
      .set({
        status: to,
        interviewAttendance: input.attendance,
        interviewResult: input.result,
        interviewFeedback: input.feedback?.trim() ? input.feedback.trim() : null,
        interviewOutcomeAt: new Date(),
        interviewOutcomeBy: ctx.actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(ap.id, applicationId))
      .returning();

    audit({
      action: 'application.interview_outcome_recorded',
      entityType: 'application',
      entityId: applicationId,
      branchId: row.branchId,
      metadata: { attendance: input.attendance, result: input.result },
    });
    return updated!;
  }).then(buildView);

  // The applicant hears the outcome (best-effort, post-commit).
  void notifyApplicantOfInterviewUpdate(
    ctx,
    row.applicantId,
    view,
    input.result === 'PASSED' ? 'INTERVIEW_PASSED' : 'INTERVIEW_FAILED',
  ).catch((err) => ctx.log.error('interview outcome notification failed', { applicationId, err }));

  return view;
}

async function notifyApplicantOfInterviewUpdate(
  ctx: SignedIn,
  applicantId: string,
  view: ApplicationView,
  newStatus: string,
): Promise<void> {
  const [applicantRow] = await db
    .select({ userId: schema.applicants.userId })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, applicantId))
    .limit(1);
  if (!applicantRow) return;

  type NotifType =
    | 'INTERVIEW_SCHEDULED'
    | 'INTERVIEW_POSTPONED'
    | 'INTERVIEW_CANCELLED'
    | 'INTERVIEW_RESCHEDULED'
    | 'INTERVIEW_PASSED'
    | 'INTERVIEW_FAILED';
  const copy: Record<NotifType, { title: string; body: string }> = {
    INTERVIEW_SCHEDULED: {
      title: `Interview scheduled — ${view.jobTitle}`,
      body: view.interviewAt
        ? `Your interview is on ${formatDateTime(view.interviewAt)}${view.interviewLocation ? ` at ${view.interviewLocation}` : ''}.`
        : 'Your interview has been scheduled. Staff will contact you with details.',
    },
    INTERVIEW_POSTPONED: {
      title: `Interview postponed — ${view.jobTitle}`,
      body: 'Your interview has been postponed. Staff will contact you with a new time.',
    },
    INTERVIEW_CANCELLED: {
      title: `Interview cancelled — ${view.jobTitle}`,
      body: 'Your scheduled interview has been cancelled. Contact your Job Bank branch for details.',
    },
    INTERVIEW_RESCHEDULED: {
      title: `Interview rescheduled — ${view.jobTitle}`,
      body: view.interviewAt
        ? `Your interview is now on ${formatDateTime(view.interviewAt)}${view.interviewLocation ? ` at ${view.interviewLocation}` : ''}.`
        : 'Your interview has been rescheduled.',
    },
    INTERVIEW_PASSED: {
      title: `Interview passed — ${view.jobTitle}`,
      body: `You passed your Job Bank interview for ${view.jobTitle}. Staff will contact you about the next step.`,
    },
    INTERVIEW_FAILED: {
      title: `Interview outcome — ${view.jobTitle}`,
      body: `Your Job Bank interview for ${view.jobTitle} did not go ahead as hoped. Contact your Job Bank branch for details.`,
    },
  };

  const notifType = (
    newStatus === 'INTERVIEW_SCHEDULED'
      ? 'INTERVIEW_SCHEDULED'
      : newStatus === 'INTERVIEW_POSTPONED'
        ? 'INTERVIEW_POSTPONED'
        : newStatus === 'INTERVIEW_CANCELLED'
          ? 'INTERVIEW_CANCELLED'
          : newStatus === 'INTERVIEW_PASSED'
            ? 'INTERVIEW_PASSED'
            : newStatus === 'INTERVIEW_FAILED'
              ? 'INTERVIEW_FAILED'
              : 'INTERVIEW_RESCHEDULED'
  ) satisfies NotifType;

  await createNotification(db, {
    userId: applicantRow.userId,
    type: notifType,
    title: copy[notifType].title,
    body: copy[notifType].body,
    data: { applicationId: view.id, jobId: view.jobId, jobTitle: view.jobTitle },
  });
}

// ─── Referral ──────────────────────────────────────────────────────────────

export const referApplicantSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ReferApplicantInput = z.infer<typeof referApplicantSchema>;

/**
 * Refer a shortlisted / interviewed applicant to the employer by setting
 * status to FORWARDED and notifying both the applicant and the company.
 * Staff / Branch Admin keep their existing range (SHORTLISTED, scheduled
 * or postponed interviews, plus PASSED). An interviewer-only actor may
 * refer ONLY from INTERVIEW_PASSED — the pass-only guard for Option B.
 * The permission alone does not authorise it: a dual-role Staff/BA user
 * is treated as Staff/BA, an interviewer-only user hitting any other
 * status gets a clear ForbiddenError, not a silent machine rejection.
 */
export async function referApplicantToEmployer(
  ctx: SignedIn,
  applicationId: string,
  input: ReferApplicantInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'match_case:refer');
  // Audit 2026-11-11 (L-20): referrals fire notifications — 30 per staff
  // member per hour (shared with the direct-refer path below).
  await enforceRateLimit(
    'refer-to-employer',
    ctx.actor.userId,
    { limit: 30, windowSeconds: 3600 },
    'Too many referrals. Try again in an hour.',
  );

  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId));
  if (!row) throw new NotFoundError('Application', applicationId);

  // Audit 2026-11-23 (HIGH-1): the interviewer's own lists are
  // branch-exact, so his commands must be too. A city check here would
  // let one branch's interviewer act on another same-city branch's
  // applications via a direct API call. Staff/BA keep the established
  // city-wide rule; only the interviewer-only actor is branch-pinned.
  if (isInterviewerOnlyReferrer(ctx.actor)) {
    assertBranchAccess(ctx.actor, row.branchId, {
      entityType: 'application',
      entityId: row.id,
    });
  } else {
    await assertCityAccess(ctx.actor, row.branchId, {
      entityType: 'application',
      entityId: row.id,
    });
  }

  const referable = referableStatusesFor(ctx.actor);
  if (!referable.includes(row.status)) {
    if (isInterviewerOnlyReferrer(ctx.actor))
      throw new ForbiddenError('Record a passed interview outcome before referring');
    throw new ForbiddenError('Application must be shortlisted or interviewed to refer');
  }

  // The job's company must still be verified: a referral to a suspended
  // or rejected company must not go out.
  const [companyRow] = await db
    .select({ status: schema.companies.status })
    .from(schema.jobs)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.jobs.companyId))
    .where(eq(schema.jobs.id, row.jobId));
  if (companyRow?.status !== 'VERIFIED')
    throw new ForbiddenError('Only verified companies can receive referred candidates');

  // Audit 2026-11-11 (H-10): new referrals require an OPEN job — a candidate
  // shortlisted while the job was OPEN must not be forwarded after it was
  // closed, expired or filled. Re-checked under the job lock inside the
  // transaction, so a close landing between the check and the write cannot
  // slip through.
  assertJobOpen(await loadJob(db, row.jobId), 'refer this candidate');

  // Audit 2026-11-10 (D-F1): re-check eligibility at forward time — the
  // applicant may have become RESTRICTED (or identity REJECTED) after
  // being shortlisted. Same interim rule as shortlist/direct-refer.
  const [applicantRow] = await db
    .select({ status: schema.applicants.status, identityStatus: schema.applicants.identityStatus })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, row.applicantId));
  if (!applicantRow || !isReferrableApplicant(applicantRow))
    throw new ForbiddenError('Candidates cannot be referred from restricted or rejected profiles');

  const view = await runCommand(ctx, async ({ tx, audit }) => {
    assertJobOpen(await loadJobForUpdate(tx, row.jobId), 'refer this candidate');
    const { to } = await lockAndTransitionApplication(tx, applicationId, 'REFER');
    const [updated] = await tx
      .update(ap)
      .set({
        status: to,
        note: input.note ?? row.note,
        updatedAt: new Date(),
      })
      .where(eq(ap.id, applicationId))
      .returning();

    audit({
      action: 'application.referred',
      entityType: 'application',
      entityId: applicationId,
      branchId: row.branchId,
      metadata: { jobId: row.jobId },
    });
    return updated!;
  }).then(buildView);

  // Notify applicant and employer users (best-effort, post-commit).
  void notifyReferral(ctx, row.applicantId, row.jobId, view).catch((err) =>
    ctx.log.error('referral notification failed', { applicationId, err }),
  );

  return view;
}

// ─── Direct refer from the staff job page ─────────────────────────────────

/**
 * A candidate already referred to the employer for one job (staff view on
 * the job detail page): the application row plus the applicant's name.
 * `referredAt` is the application's last update — the moment it moved to
 * FORWARDED, or a later employer-side step.
 */
export interface JobCandidateReferralView {
  applicationId: string;
  applicantId: string;
  applicantName: string;
  status: ApplicationStatus;
  referredAt: string;
}

export const referApplicantToEmployerForJobSchema = z.object({
  applicantId: z.uuid(),
  note: z.string().trim().max(500).optional(),
});
export type ReferApplicantToEmployerForJobInput = z.infer<
  typeof referApplicantToEmployerForJobSchema
>;

/**
 * Statuses an application can be in once the employer can see it. Mirrors
 * EMPLOYER_VISIBLE_STATUSES in ./employer.
 */
const REFERRED_STATUSES: ApplicationStatus[] = [
  'FORWARDED',
  'EMPLOYER_INTERVIEW_SCHEDULED',
  'EMPLOYER_INTERVIEW_POSTPONED',
  'EMPLOYER_INTERVIEW_CANCELLED',
  'ON_HOLD',
  'OFFER_EXTENDED',
  'EMPLOYER_REJECTED',
  'APPLICANT_REFUSED',
  'HIRED',
];

/**
 * Who staff may refer to an employer from the job page (2026-11-10): the
 * same interim "filhal" rule as job→applicant referrals — any profile that
 * is not RESTRICTED, with an identity VERIFIED or still UNVERIFIED.
 * Single source of truth is isReferrableApplicant in the job domain
 * (audit 2026-11-10, M12); this alias keeps the existing export name
 * for the direct-refer test and callers.
 */
export const isDirectReferrableApplicant = isReferrableApplicant;

/**
 * Staff / Branch Admin: refer an applicant to the employer for a job,
 * straight from the staff job detail page — one step, no detour through
 * the applicant detail page.
 *
 * If the applicant is already shortlisted / interviewed for this job, this
 * just forwards the existing application via referApplicantToEmployer
 * (same machine transition, same notifications). Otherwise it creates the
 * application and forwards it in one transaction, audited as both a
 * shortlist and a referral, so the history reads the same as the two-step
 * flow. The employer no longer sees the candidate on /employer/referrals
 * (sidebar entry removed 2026-11-12) and can no longer record a decision
 * on the referral — the application is still forwarded to the employer's
 * company, and staff match-review is unaffected.
 */
export async function referApplicantToEmployerForJob(
  ctx: SignedIn,
  jobId: string,
  input: ReferApplicantToEmployerForJobInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'match_case:manage');
  assertPermission(ctx.actor, 'match_case:refer');
  // Audit 2026-11-11 (L-20): same 'refer-to-employer' bucket as the
  // two-step refer path above — one action, one budget.
  await enforceRateLimit(
    'refer-to-employer',
    ctx.actor.userId,
    { limit: 30, windowSeconds: 3600 },
    'Too many referrals. Try again in an hour.',
  );

  const [jobRow] = await db
    .select({
      id: schema.jobs.id,
      title: schema.jobs.title,
      companyId: schema.jobs.companyId,
      branchId: schema.jobs.branchId,
      status: schema.jobs.status,
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));
  if (!jobRow) throw new NotFoundError('Job', jobId);
  await assertCityAccess(ctx.actor, jobRow.branchId, {
    entityType: 'job',
    entityId: jobRow.id,
  });
  if (jobRow.status !== 'OPEN')
    throw new ForbiddenError('Only OPEN jobs can receive referred candidates');

  const [companyRow] = await db
    .select({ status: schema.companies.status })
    .from(schema.companies)
    .where(eq(schema.companies.id, jobRow.companyId));
  if (companyRow?.status !== 'VERIFIED')
    throw new ForbiddenError('Only verified companies can receive referred candidates');

  const [applicantRow] = await db
    .select({
      id: schema.applicants.id,
      userId: schema.applicants.userId,
      fullName: schema.applicants.fullName,
      branchId: schema.applicants.branchId,
      status: schema.applicants.status,
      identityStatus: schema.applicants.identityStatus,
    })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, input.applicantId));
  if (!applicantRow) throw new NotFoundError('Applicant', input.applicantId);
  if (!isDirectReferrableApplicant(applicantRow))
    throw new ForbiddenError('Candidates cannot be referred from restricted or rejected profiles');
  await assertCityAccess(ctx.actor, applicantRow.branchId, {
    entityType: 'applicant',
    entityId: applicantRow.id,
  });

  const [existing] = await db
    .select()
    .from(ap)
    .where(and(eq(ap.applicantId, input.applicantId), eq(ap.jobId, jobId)));
  if (existing) {
    if (
      existing.status === 'SHORTLISTED' ||
      existing.status === 'INTERVIEW_SCHEDULED' ||
      existing.status === 'INTERVIEW_POSTPONED' ||
      existing.status === 'INTERVIEW_PASSED'
    ) {
      return referApplicantToEmployer(ctx, existing.id, { note: input.note });
    }
    if (REFERRED_STATUSES.includes(existing.status))
      throw new ConflictError(
        'This applicant has already been referred to the employer for this job',
      );
    throw new ForbiddenError('Application must be shortlisted or interviewed to refer');
  }

  // No application yet: shortlist + refer in one transaction, so the
  // employer's view and the audit trail match the two-step flow exactly.
  // Audit 2026-11-10 (D-F7/M4): two concurrent submits race the pre-check
  // above, so catch the unique-index violation and replay the raced row
  // instead of surfacing a raw 500 — mirroring referJobToApplicant.
  let view: ApplicationView;
  try {
    view = await runCommand(ctx, async ({ tx, audit }) => {
      const [row] = await tx
        .insert(ap)
        .values({
          applicantId: input.applicantId,
          jobId: jobRow.id,
          branchId: jobRow.branchId,
          createdBy: ctx.actor.userId,
          note: input.note ?? null,
          status: 'FORWARDED',
        })
        .returning();

      audit({
        action: 'application.shortlist',
        entityType: 'application',
        entityId: row!.id,
        branchId: jobRow.branchId,
      });
      audit({
        action: 'application.referred',
        entityType: 'application',
        entityId: row!.id,
        branchId: jobRow.branchId,
        metadata: { jobId: jobRow.id },
      });
      return row!;
    }).then(buildView);
  } catch (error) {
    if (!isUniqueViolation(error, 'applications_applicant_job_uq')) throw error;
    const [raced] = await db
      .select()
      .from(ap)
      .where(and(eq(ap.applicantId, input.applicantId), eq(ap.jobId, jobId)));
    if (!raced) throw error;
    if (
      raced.status === 'SHORTLISTED' ||
      raced.status === 'INTERVIEW_SCHEDULED' ||
      raced.status === 'INTERVIEW_POSTPONED' ||
      raced.status === 'INTERVIEW_PASSED'
    ) {
      return referApplicantToEmployer(ctx, raced.id, { note: input.note });
    }
    if (REFERRED_STATUSES.includes(raced.status))
      throw new ConflictError(
        'This applicant has already been referred to the employer for this job',
      );
    throw new ForbiddenError('Application must be shortlisted or interviewed to refer');
  }

  // Notify applicant and employer users (best-effort, post-commit).
  void notifyReferral(ctx, input.applicantId, jobRow.id, view).catch((err) =>
    ctx.log.error('referral notification failed', { applicationId: view.id, err }),
  );

  return view;
}

async function notifyReferral(
  ctx: SignedIn,
  applicantId: string,
  jobId: string,
  view: ApplicationView,
): Promise<void> {
  const [applicantRow] = await db
    .select({ userId: schema.applicants.userId })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, applicantId))
    .limit(1);

  const [jobRow] = await db
    .select({ companyId: schema.jobs.companyId })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  await Promise.all([
    applicantRow
      ? createNotification(db, {
          userId: applicantRow.userId,
          type: 'APPLICANT_REFERRED',
          title: `Referred to employer — ${view.jobTitle}`,
          body: `Your profile has been forwarded to ${view.companyName} for ${view.jobTitle}. They will review your application.`,
          data: {
            applicationId: view.id,
            jobId: view.jobId,
            jobTitle: view.jobTitle,
            companyName: view.companyName,
          },
        })
      : Promise.resolve(),
    jobRow?.companyId
      ? notifyCompanyEmployers(db, jobRow.companyId, ({ userId }) => ({
          userId,
          type: 'APPLICANT_REFERRED',
          title: `New candidate referred — ${view.jobTitle}`,
          body: `Job Bank has referred a candidate for your ${view.jobTitle} opening.`,
          data: { applicationId: view.id, jobId: view.jobId, applicantId },
        }))
      : Promise.resolve(),
  ]);
}

// ─── Queries ──────────────────────────────────────────────────────────────

/** List all applications for a specific applicant (staff view). */
export async function listApplicationsForApplicant(
  actor: Actor,
  applicantId: string,
): Promise<ApplicationView[]>;
export async function listApplicationsForApplicant(
  actor: Actor,
  applicantId: string,
  query: PlacementListQuery,
): Promise<{ items: ApplicationView[]; pagination: PaginationMeta }>;
export async function listApplicationsForApplicant(
  actor: Actor,
  applicantId: string,
  query?: PlacementListQuery,
): Promise<ApplicationView[] | { items: ApplicationView[]; pagination: PaginationMeta }> {
  assertPermission(actor, 'match_case:read');
  // M15 — defense-in-depth: staff roles only, city-scoped on the
  // applicant's branch. Sole caller today is the staff applicant-detail
  // page after a city check; a future caller must not inherit the hole.
  // INTERVIEWER_SCHEDULER reads it too: the interviewer needs the
  // applications list to reach the schedule/update dialogs on the
  // applicant detail page.
  assertRole(actor, 'STAFF', 'BRANCH_ADMIN', 'SUPER_ADMIN', 'INTERVIEWER_SCHEDULER');
  const [applicantRow] = await db
    .select({ branchId: schema.applicants.branchId })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, applicantId))
    .limit(1);
  if (!applicantRow) throw new NotFoundError('Applicant', applicantId);
  await assertCityAccess(actor, applicantRow.branchId, {
    entityType: 'applicant',
    entityId: applicantId,
  });
  const where = eq(ap.applicantId, applicantId);
  const [totalRow] = query
    ? await db.select({ total: count() }).from(ap).where(where)
    : [{ total: 0 }];
  const base = db.select().from(ap).where(where).orderBy(desc(ap.createdAt));
  const rows = query ? await base.limit(query.limit).offset(query.offset) : await base;
  const items = await buildViews(rows);
  if (!query) return items;
  return { items, pagination: paginationMeta(query, totalRow?.total ?? 0) };
}

/**
 * Interviews (and candidates awaiting scheduling) in the actor's branch(es)
 * — the Interviewer and Scheduler role's list. SHORTLISTED rows are the
 * "to schedule" queue; INTERVIEW_* rows are the scheduled, postponed,
 * cancelled and outcome-recorded interviews (PASSED stays until referred,
 * FAILED stays in Past). Branch-scoped like Staff; Super Admin holds no
 * interview permission, so they never reach this list.
 */
export interface InterviewListItem {
  applicationId: string;
  applicantId: string;
  applicantName: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  branchId: string;
  status: ApplicationStatus;
  interviewAt: string | null;
  interviewLocation: string | null;
  interviewNote: string | null;
  // 0052 — outcome, null until recorded.
  interviewAttendance: 'ATTENDED' | 'NO_SHOW' | null;
  interviewResult: 'PASSED' | 'FAILED' | null;
  interviewFeedback: string | null;
  updatedAt: string;
}

const INTERVIEW_PIPELINE_STATUSES: ApplicationStatus[] = [
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_POSTPONED',
  'INTERVIEW_CANCELLED',
  // 0052 — PASSED stays in the list (awaiting referral); FAILED stays
  // visible in Past so the outcome is not lost once recorded.
  'INTERVIEW_PASSED',
  'INTERVIEW_FAILED',
];

/**
 * Dashboard funnel: passed candidates this branch referred to the
 * employer. interviewResult PASSED + a status only reachable after a
 * referral (REFERRED_STATUSES) is the precise shape — Staff can also
 * refer straight from SHORTLISTED, and those rows carry no interview
 * result, so they are not counted here. Note the count is about the
 * candidates, not who clicked refer: Staff/BA may also refer from
 * INTERVIEW_PASSED, and the row records no referrer, so a staff-referred
 * passed candidate counts here too (audit 2026-11-23, LOW-2). If the bar
 * must mean "referred by the interviewer", record referredBy on referral
 * and filter on it. Counting FORWARDED alone lost referrals the moment
 * the employer moved the application onward (employer interview, hold,
 * offer, hire): the referral already happened, so the count must not
 * depend on the current status. Same branch-scoped guard as
 * listInterviews; a referred candidate leaves listInterviews (FORWARDED
 * is not a pipeline status), so the dashboard needs this count to show
 * the end of the funnel at all.
 */
export async function countInterviewerReferrals(actor: Actor): Promise<number> {
  assertPermission(actor, 'interview:schedule_jobbank');
  assertRole(actor, 'STAFF', 'BRANCH_ADMIN', 'INTERVIEWER_SCHEDULER');
  const [row] = await db
    .select({ value: count() })
    .from(ap)
    .where(
      and(
        eq(ap.interviewResult, 'PASSED'),
        inArray(ap.status, REFERRED_STATUSES),
        branchScope(actor, ap.branchId),
      ),
    );
  return row?.value ?? 0;
}

/**
 * Monthly Job Bank interviews, Jan..Dec of `year`, in ONE grouped query —
 * the interviewer chart's values. Buckets by the interview date
 * (interviewAt in PKT), not by applicant registration, and counts EVERY
 * interview-dated application in the branch — including ones that already
 * left the pipeline (referred, hired, on hold). The old chart bucketed
 * listInterviews rows, so a referred candidate's interview month vanished
 * from the chart the moment they were referred. Same branch-scoped guard
 * as listInterviews, same PKT year window as monthlyApplicantCounts.
 */
export async function monthlyInterviewCounts(actor: Actor, year: number): Promise<number[]> {
  assertPermission(actor, 'interview:schedule_jobbank');
  assertRole(actor, 'STAFF', 'BRANCH_ADMIN', 'INTERVIEWER_SCHEDULER');
  // PKT year window as UTC instants: 1 Jan 00:00 PKT = 31 Dec 19:00 UTC.
  const start = new Date(Date.UTC(year, 0, 1) - 5 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year + 1, 0, 1) - 5 * 60 * 60 * 1000);

  const monthExpr = sql<number>`extract(month from ${ap.interviewAt} at time zone 'Asia/Karachi')`;
  const rows = await db
    .select({ month: monthExpr, value: count() })
    .from(ap)
    .where(
      and(
        branchScope(actor, ap.branchId),
        gte(ap.interviewAt, start),
        lt(ap.interviewAt, end),
        // Audit 2026-11-23 (LOW-1): a cancelled interview is not a
        // scheduled one — the chart label is "Interviews Scheduled".
        ne(ap.status, 'INTERVIEW_CANCELLED'),
      ),
    )
    .groupBy(monthExpr);

  const values = Array.from({ length: 12 }, () => 0);
  for (const row of rows) {
    if (row.month >= 1 && row.month <= 12) values[row.month - 1] = row.value;
  }
  return values;
}

export async function listInterviews(actor: Actor, limit = 500): Promise<InterviewListItem[]> {
  assertPermission(actor, 'interview:schedule_jobbank');
  // Same staff-only, branch-scoped guard as listApplicationsForApplicant.
  assertRole(actor, 'STAFF', 'BRANCH_ADMIN', 'INTERVIEWER_SCHEDULER');
  // Audit 2026-11-23 (MEDIUM-2): bounded — the old query had no limit
  // and terminal rows (FAILED, CANCELLED) never leave the list, so the
  // row set grew forever while the dashboard reloaded it every 30s.
  // The dashboard now takes its numbers from interviewPipelineCounts
  // and only needs 5 rows for Recent Activity; the Interviews page uses
  // the 500 most recently updated rows.
  const rows = await db
    .select()
    .from(ap)
    .where(
      and(
        or(...INTERVIEW_PIPELINE_STATUSES.map((s) => eq(ap.status, s))),
        branchScope(actor, ap.branchId),
      ),
    )
    .orderBy(desc(ap.updatedAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const [views, applicants] = await Promise.all([
    buildViews(rows),
    db
      .select({ id: schema.applicants.id, fullName: schema.applicants.fullName })
      .from(schema.applicants)
      .where(
        inArray(
          schema.applicants.id,
          rows.map((r) => r.applicantId),
        ),
      ),
  ]);
  const byId = new Map(applicants.map((a) => [a.id, a]));
  return rows.map((row, i) => {
    const view = views[i]!;
    return {
      applicationId: row.id,
      applicantId: row.applicantId,
      applicantName: byId.get(row.applicantId)?.fullName ?? 'Unknown applicant',
      jobId: row.jobId,
      jobTitle: view.jobTitle,
      companyName: view.companyName,
      branchId: row.branchId,
      status: row.status as ApplicationStatus,
      interviewAt: row.interviewAt?.toISOString() ?? null,
      interviewLocation: row.interviewLocation,
      interviewNote: row.interviewNote,
      interviewAttendance:
        (row.interviewAttendance as InterviewListItem['interviewAttendance']) ?? null,
      interviewResult: (row.interviewResult as InterviewListItem['interviewResult']) ?? null,
      interviewFeedback: row.interviewFeedback,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/**
 * Dashboard pipeline numbers in two aggregate queries — no row loading.
 * The dashboard used to derive these from listInterviews rows, which
 * meant every 30s refresh loaded the whole (unbounded) pipeline. Same
 * branch-scoped guard as listInterviews.
 */
export interface InterviewPipelineCounts {
  toSchedule: number;
  scheduled: number;
  upcomingToday: number;
  passed: number;
  failed: number;
  total: number;
}

export async function interviewPipelineCounts(actor: Actor): Promise<InterviewPipelineCounts> {
  assertPermission(actor, 'interview:schedule_jobbank');
  assertRole(actor, 'STAFF', 'BRANCH_ADMIN', 'INTERVIEWER_SCHEDULER');
  const where = and(
    or(...INTERVIEW_PIPELINE_STATUSES.map((s) => eq(ap.status, s))),
    branchScope(actor, ap.branchId),
  );
  const [byStatus, [today]] = await Promise.all([
    db.select({ status: ap.status, value: count() }).from(ap).where(where).groupBy(ap.status),
    db
      .select({ value: count() })
      .from(ap)
      .where(
        and(
          inArray(ap.status, ['INTERVIEW_SCHEDULED', 'INTERVIEW_POSTPONED'] as ApplicationStatus[]),
          branchScope(actor, ap.branchId),
          sql`${ap.interviewAt} > now()`,
          sql`(${ap.interviewAt} at time zone 'Asia/Karachi')::date = (now() at time zone 'Asia/Karachi')::date`,
        ),
      ),
  ]);
  const byStatusMap = new Map<ApplicationStatus, number>(byStatus.map((r) => [r.status, r.value]));
  const pick = (s: ApplicationStatus) => byStatusMap.get(s) ?? 0;
  return {
    toSchedule: pick('SHORTLISTED'),
    scheduled: pick('INTERVIEW_SCHEDULED') + pick('INTERVIEW_POSTPONED'),
    upcomingToday: today?.value ?? 0,
    passed: pick('INTERVIEW_PASSED'),
    failed: pick('INTERVIEW_FAILED'),
    total: byStatus.reduce((sum, r) => sum + r.value, 0),
  };
}

/**
 * Staff view for the job detail page: every candidate already referred to
 * the employer for this job (FORWARDED onward), newest referral first.
 */
export async function listReferredCandidatesForJob(
  actor: Actor,
  jobId: string,
): Promise<JobCandidateReferralView[]> {
  assertPermission(actor, 'match_case:read');
  // Same staff-only, city-scoped guard as listApplicationsForApplicant.
  assertRole(actor, 'STAFF', 'BRANCH_ADMIN', 'SUPER_ADMIN');
  const [jobRow] = await db
    .select({ branchId: schema.jobs.branchId })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);
  if (!jobRow) throw new NotFoundError('Job', jobId);
  await assertCityAccess(actor, jobRow.branchId, { entityType: 'job', entityId: jobId });

  const rows = await db
    .select()
    .from(ap)
    .where(and(eq(ap.jobId, jobId), or(...REFERRED_STATUSES.map((s) => eq(ap.status, s)))))
    .orderBy(desc(ap.updatedAt));
  if (rows.length === 0) return [];
  const applicants = await db
    .select({ id: schema.applicants.id, fullName: schema.applicants.fullName })
    .from(schema.applicants)
    .where(
      inArray(
        schema.applicants.id,
        rows.map((r) => r.applicantId),
      ),
    );
  const byId = new Map(applicants.map((a) => [a.id, a]));
  return rows.map((row) => ({
    applicationId: row.id,
    applicantId: row.applicantId,
    applicantName: byId.get(row.applicantId)?.fullName ?? 'Unknown applicant',
    status: row.status as ApplicationStatus,
    referredAt: row.updatedAt.toISOString(),
  }));
}

/** List applications visible to the signed-in applicant (their own). */
export async function listMyApplications(actor: Actor): Promise<ApplicationView[]>;
export async function listMyApplications(
  actor: Actor,
  query: PlacementListQuery,
): Promise<{ items: ApplicationView[]; pagination: PaginationMeta }>;
export async function listMyApplications(
  actor: Actor,
  query?: PlacementListQuery,
): Promise<ApplicationView[] | { items: ApplicationView[]; pagination: PaginationMeta }> {
  const [applicant] = await db
    .select({ id: schema.applicants.id })
    .from(schema.applicants)
    .where(eq(schema.applicants.userId, actor.userId));
  if (!applicant) return query ? { items: [], pagination: paginationMeta(query, 0) } : [];

  const where = eq(ap.applicantId, applicant.id);
  const [totalRow] = query
    ? await db.select({ total: count() }).from(ap).where(where)
    : [{ total: 0 }];
  const base = db.select().from(ap).where(where).orderBy(desc(ap.updatedAt));
  const rows = query ? await base.limit(query.limit).offset(query.offset) : await base;
  const items = await buildViews(rows);
  if (!query) return items;
  return { items, pagination: paginationMeta(query, totalRow?.total ?? 0) };
}

export { buildView };

export * from './calls';
export * from './employer';
export { applicationMachine, lockAndTransitionApplication, type ApplicationEvent } from './machine';
