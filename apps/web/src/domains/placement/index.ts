'server-only';
import { schema } from '@jobbank/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { runCommand } from '@/domains/shared/audit';
import { ConflictError, ForbiddenError, NotFoundError } from '@/domains/shared/errors';
import {
  assertCityAccess,
  assertPermission,
  hasPermission,
  type Actor,
} from '@/domains/shared/scope';
import { db } from '@/lib/db';
import type { RequestContext } from '@/domains/shared/audit';
export type ApplicationStatus =
  'SHORTLISTED' | 'INTERVIEW_SCHEDULED' | 'FORWARDED' | 'HIRED' | 'REJECTED';

type SignedIn = RequestContext & { actor: Actor };

const ap = schema.applications;

// ─── Types ────────────────────────────────────────────────────────────────

export interface ApplicationView {
  id: string;
  applicantId: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  branchId: string;
  status: ApplicationStatus;
  note: string | null;
  interviewAt: string | null;
  interviewLocation: string | null;
  interviewNote: string | null;
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

// ─── Helpers ──────────────────────────────────────────────────────────────

async function buildView(row: typeof ap.$inferSelect): Promise<ApplicationView> {
  const [jobRow] = await db
    .select({
      title: schema.jobs.title,
      companyId: schema.jobs.companyId,
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, row.jobId));

  const companyName = jobRow
    ? await db
        .select({ name: schema.companies.tradeName, legal: schema.companies.legalName })
        .from(schema.companies)
        .where(eq(schema.companies.id, jobRow.companyId))
        .then(([c]) => c?.name ?? c?.legal ?? '')
    : '';

  return {
    id: row.id,
    applicantId: row.applicantId,
    jobId: row.jobId,
    jobTitle: jobRow?.title ?? '',
    companyName,
    branchId: row.branchId,
    status: row.status,
    note: row.note,
    interviewAt: row.interviewAt?.toISOString() ?? null,
    interviewLocation: row.interviewLocation,
    interviewNote: row.interviewNote,
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
