'server-only';
import { schema } from '@jobbank/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { runCommand } from '@/domains/shared/audit';
import { ConflictError, ForbiddenError, NotFoundError } from '@/domains/shared/errors';
import { assertCityAccess, assertPermission, type Actor } from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { createNotification, notifyCompanyEmployers } from '@/domains/notifications';
import type { RequestContext } from '@/domains/shared/audit';
export type ApplicationStatus =
  | 'SHORTLISTED'
  | 'INTERVIEW_SCHEDULED'
  | 'INTERVIEW_POSTPONED'
  | 'INTERVIEW_CANCELLED'
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
  interviewAt: z.string().datetime(),
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

export const updateInterviewStatusSchema = z.object({
  status: z.enum(INTERVIEW_UPDATE_STATUSES),
  interviewAt: z.string().datetime().optional(),
  interviewLocation: z.string().trim().max(300).optional(),
  interviewNote: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
});
export type UpdateInterviewStatusInput = z.infer<typeof updateInterviewStatusSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────

async function buildView(row: typeof ap.$inferSelect): Promise<ApplicationView> {
  const [jobRow] = await db
    .select({
      title: schema.jobs.title,
      companyId: schema.jobs.companyId,
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, row.jobId));

  let companyName = '';
  const companyId = jobRow?.companyId ?? '';
  if (jobRow) {
    const [c] = await db
      .select({ name: schema.companies.tradeName, legal: schema.companies.legalName })
      .from(schema.companies)
      .where(eq(schema.companies.id, jobRow.companyId));
    companyName = c?.name ?? c?.legal ?? '';
  }

  return {
    id: row.id,
    applicantId: row.applicantId,
    jobId: row.jobId,
    jobTitle: jobRow?.title ?? '',
    companyName,
    companyId,
    branchId: row.branchId,
    status: row.status,
    note: row.note,
    interviewAt: row.interviewAt?.toISOString() ?? null,
    interviewLocation: row.interviewLocation,
    interviewNote: row.interviewNote,
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

  // Verify applicant exists and actor has city access
  const [applicantRow] = await db
    .select({ id: schema.applicants.id, branchId: schema.applicants.branchId })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, input.applicantId));
  if (!applicantRow) throw new NotFoundError('Applicant', input.applicantId);
  await assertCityAccess(ctx.actor, applicantRow.branchId, {
    entityType: 'applicant',
    entityId: applicantRow.id,
  });

  // Verify job exists and is open
  const [jobRow] = await db
    .select({ id: schema.jobs.id, branchId: schema.jobs.branchId, status: schema.jobs.status })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, input.jobId));
  if (!jobRow) throw new NotFoundError('Job', input.jobId);
  if (jobRow.status !== 'OPEN')
    throw new ForbiddenError('Only OPEN jobs can receive shortlisted candidates');

  // Check for duplicate
  const [existing] = await db
    .select({ id: ap.id })
    .from(ap)
    .where(and(eq(ap.applicantId, input.applicantId), eq(ap.jobId, input.jobId)));
  if (existing) throw new ConflictError('This applicant is already shortlisted for this job');

  return runCommand(ctx, async ({ tx, audit }) => {
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
}

/** Branch Admin only: schedule a Job Bank interview for an application. */
export async function scheduleInterview(
  ctx: SignedIn,
  applicationId: string,
  input: ScheduleInterviewInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'interview:schedule_jobbank');

  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId));
  if (!row) throw new NotFoundError('Application', applicationId);

  if (row.status === 'REJECTED' || row.status === 'HIRED')
    throw new ForbiddenError('Cannot schedule an interview for a closed application');

  return runCommand(ctx, async ({ tx, audit }) => {
    const [updated] = await tx
      .update(ap)
      .set({
        status: 'INTERVIEW_SCHEDULED',
        interviewAt: new Date(input.interviewAt),
        interviewLocation: input.interviewLocation ?? null,
        interviewNote: input.interviewNote ?? null,
        scheduledBy: ctx.actor.userId,
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
}

/** Staff / Branch Admin: update the status and details of a scheduled interview. */
export async function updateInterviewStatus(
  ctx: SignedIn,
  applicationId: string,
  input: UpdateInterviewStatusInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'interview:schedule_jobbank');

  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId));
  if (!row) throw new NotFoundError('Application', applicationId);

  const interviewStatuses: ApplicationStatus[] = [
    'INTERVIEW_SCHEDULED',
    'INTERVIEW_POSTPONED',
    'INTERVIEW_CANCELLED',
  ];
  if (!interviewStatuses.includes(row.status))
    throw new ForbiddenError('Can only update status for applications with a scheduled interview');

  const view = await runCommand(ctx, async ({ tx, audit }) => {
    const patch: Partial<typeof ap.$inferInsert> = {
      status: input.status,
      note: input.note ?? row.note,
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
  void notifyApplicantOfInterviewUpdate(ctx, row.applicantId, view, input.status).catch((err) =>
    ctx.log.error('interview status notification failed', { applicationId, err }),
  );

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

  type NotifType = 'INTERVIEW_POSTPONED' | 'INTERVIEW_CANCELLED' | 'INTERVIEW_RESCHEDULED';
  const copy: Record<NotifType, { title: string; body: string }> = {
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
        ? `Your interview is now on ${new Date(view.interviewAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}${view.interviewLocation ? ` at ${view.interviewLocation}` : ''}.`
        : 'Your interview has been rescheduled.',
    },
  };

  const notifType = (
    newStatus === 'INTERVIEW_POSTPONED'
      ? 'INTERVIEW_POSTPONED'
      : newStatus === 'INTERVIEW_CANCELLED'
        ? 'INTERVIEW_CANCELLED'
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
 * Staff / Branch Admin: refer a shortlisted / interviewed applicant to the employer
 * by setting status to FORWARDED and notifying both the applicant and the company.
 */
export async function referApplicantToEmployer(
  ctx: SignedIn,
  applicationId: string,
  input: ReferApplicantInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'match_case:refer');

  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId));
  if (!row) throw new NotFoundError('Application', applicationId);

  const referable: ApplicationStatus[] = [
    'SHORTLISTED',
    'INTERVIEW_SCHEDULED',
    'INTERVIEW_POSTPONED',
  ];
  if (!referable.includes(row.status))
    throw new ForbiddenError('Application must be shortlisted or interviewed to refer');

  const view = await runCommand(ctx, async ({ tx, audit }) => {
    const [updated] = await tx
      .update(ap)
      .set({
        status: 'FORWARDED',
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
): Promise<ApplicationView[]> {
  assertPermission(actor, 'match_case:read');
  const rows = await db
    .select()
    .from(ap)
    .where(eq(ap.applicantId, applicantId))
    .orderBy(desc(ap.createdAt));
  return Promise.all(rows.map(buildView));
}

/** List applications visible to the signed-in applicant (their own). */
export async function listMyApplications(actor: Actor): Promise<ApplicationView[]> {
  const [applicant] = await db
    .select({ id: schema.applicants.id })
    .from(schema.applicants)
    .where(eq(schema.applicants.userId, actor.userId));
  if (!applicant) return [];

  const rows = await db
    .select()
    .from(ap)
    .where(eq(ap.applicantId, applicant.id))
    .orderBy(desc(ap.updatedAt));
  return Promise.all(rows.map(buildView));
}

export { buildView };

export * from './employer';
