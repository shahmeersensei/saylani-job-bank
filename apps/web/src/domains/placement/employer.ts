'server-only';
// Employer-side interview scheduling, applicant refusal, and chat.

import { schema } from '@jobbank/db';
import { ROLE_LABELS, ROLES, type PaginationMeta, type Role } from '@jobbank/shared';
import { and, asc, count, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { runCommand } from '@/domains/shared/audit';
import { paginationMeta } from '@/domains/shared/pagination';
import { enforceRateLimit } from '@/domains/shared/rate-limit';
import { ConflictError, ForbiddenError, NotFoundError } from '@/domains/shared/errors';
import {
  assertCityAccess,
  assertPermission,
  hasPermission,
  type Actor,
} from '@/domains/shared/scope';
import {
  assertJobLive,
  assertVacancyAvailable,
  jobMachine,
  loadJob,
  loadJobForUpdate,
} from '@/domains/job';
import { requireReasonCode } from '@/domains/matching';
import { db } from '@/lib/db';
import { formatPkMobileDisplay } from '@/lib/format/phone';
import { formatDateTime } from '@/lib/format/date';
import { createNotification, notifyCompanyEmployers } from '@/domains/notifications';
import type { RequestContext } from '@/domains/shared/audit';
import {
  buildView,
  type ApplicationView,
  type ApplicationStatus,
  type PlacementListQuery,
} from './index';
import { assertFutureInterviewAt, futureInterviewAtSchema } from './interview-date';
import { lockAndTransitionApplication } from './machine';

type SignedIn = RequestContext & { actor: Actor };

const ap = schema.applications;
const am = schema.applicationMessages;

// ─── Types ────────────────────────────────────────────────────────────────

export interface ReferredBySummary {
  name: string;
  roleLabel: string | null;
  title: string | null;
  branchName: string | null;
  referredAt: string;
}

export interface ApplicantSummary {
  id: string;
  fullName: string;
  fatherName: string;
  dateOfBirth: string;
  gender: string;
  email: string | null;
  identityStatus: string;
  cityCode: string | null;
  addressLine: string | null;
  areaCode: string | null;
  /** Full phone, unmasked — the employer contacts the candidate directly. */
  phone: string | null;
  education: {
    levelCode: string;
    institution: string | null;
    fieldOfStudy: string | null;
    completionYear: number | null;
    isCurrent: boolean;
    grade: string | null;
  }[];
  skills: { skillCode: string; level: string; years: number }[];
  languages: { languageCode: string; proficiency: string }[];
  certifications: {
    name: string;
    issuer: string | null;
    issuedMonth: string | null;
    expiresMonth: string | null;
  }[];
  preferences: {
    categoryCodes: string[];
    minSalaryPkr: number | null;
    shifts: string[];
    jobTypes: string[];
    availableFrom: string | null;
  } | null;
  experience: {
    employerName: string;
    jobTitle: string;
    categoryCode: string | null;
    startMonth: string;
    endMonth: string | null;
    isCurrent: boolean;
    description: string | null;
  }[];
  /** The staff member who referred this candidate to the employer. */
  referredBy: ReferredBySummary | null;
}

export interface ApplicationWithApplicant extends ApplicationView {
  applicant: ApplicantSummary;
}

export interface MessageView {
  id: string;
  applicationId: string;
  senderId: string;
  senderRole: 'EMPLOYER' | 'APPLICANT';
  senderName: string;
  content: string;
  createdAt: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────

export const refuseJobOfferSchema = z.object({
  /**
   * H19 — unified with respondToJobOffer: a master-data REFUSAL_REASON code,
   * not free text. The human-readable label is stored on the application
   * (see refuseJobOffer) so existing displays keep showing real words.
   */
  reasonCode: z.string().trim().min(1).max(50),
  note: z.string().trim().max(500).optional(),
});
export type RefuseJobOfferInput = z.infer<typeof refuseJobOfferSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Who referred this candidate to the employer. The referral itself is
 * audited as `application.referred` with the staff member who sent it —
 * that is the true referrer, even when a different staff member
 * shortlisted the candidate first. Falls back to the application creator
 * (the shortlister) when no referral audit row exists.
 */
async function getReferredBy(
  application: typeof ap.$inferSelect,
): Promise<ReferredBySummary | null> {
  const [referral] = await db
    .select({
      actorUserId: schema.auditLogs.actorUserId,
      actorRole: schema.auditLogs.actorRole,
      branchId: schema.auditLogs.branchId,
      occurredAt: schema.auditLogs.occurredAt,
    })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, 'application.referred'),
        eq(schema.auditLogs.entityType, 'application'),
        eq(schema.auditLogs.entityId, application.id),
      ),
    )
    .orderBy(desc(schema.auditLogs.occurredAt), desc(schema.auditLogs.id))
    .limit(1);

  const referrerId = referral?.actorUserId ?? application.createdBy;
  if (!referrerId) return null;

  const [userRow] = await db
    .select({ name: schema.users.name, title: schema.users.title })
    .from(schema.users)
    .where(eq(schema.users.id, referrerId))
    .limit(1);
  if (!userRow) return null;

  const branchId = referral?.branchId ?? application.branchId;
  const [branchRow] = branchId
    ? await db
        .select({ name: schema.branches.name })
        .from(schema.branches)
        .where(eq(schema.branches.id, branchId))
        .limit(1)
    : [undefined];

  const role = referral?.actorRole
    ? ROLES.find((r: Role) => referral.actorRole?.split(',').includes(r))
    : undefined;

  return {
    name: userRow.name,
    roleLabel: role ? ROLE_LABELS[role] : null,
    title: userRow.title,
    branchName: branchRow?.name ?? null,
    referredAt: (referral?.occurredAt ?? application.updatedAt).toISOString(),
  };
}

async function getApplicantSummary(
  applicantId: string,
  application: typeof ap.$inferSelect,
): Promise<ApplicantSummary | null> {
  const [applicantRow] = await db
    .select({
      id: schema.applicants.id,
      fullName: schema.applicants.fullName,
      fatherName: schema.applicants.fatherName,
      dateOfBirth: schema.applicants.dateOfBirth,
      gender: schema.applicants.gender,
      email: schema.applicants.email,
      identityStatus: schema.applicants.identityStatus,
      userId: schema.applicants.userId,
    })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, applicantId))
    .limit(1);

  if (!applicantRow) return null;

  const [
    address,
    phone,
    skills,
    experience,
    education,
    languages,
    certifications,
    preferences,
    referredBy,
  ] = await Promise.all([
    db
      .select({
        cityCode: schema.applicantAddresses.cityCode,
        addressLine: schema.applicantAddresses.addressLine,
        areaCode: schema.applicantAddresses.areaCode,
      })
      .from(schema.applicantAddresses)
      .where(eq(schema.applicantAddresses.applicantId, applicantId))
      .limit(1),
    db
      .select({ phone: schema.users.phoneNumber })
      .from(schema.users)
      .where(eq(schema.users.id, applicantRow.userId))
      .limit(1),
    db
      .select({
        skillCode: schema.applicantSkills.skillCode,
        level: schema.applicantSkills.level,
        years: schema.applicantSkills.years,
      })
      .from(schema.applicantSkills)
      .where(eq(schema.applicantSkills.applicantId, applicantId)),
    db
      .select({
        employerName: schema.applicantExperience.employerName,
        jobTitle: schema.applicantExperience.jobTitle,
        categoryCode: schema.applicantExperience.categoryCode,
        startMonth: schema.applicantExperience.startMonth,
        endMonth: schema.applicantExperience.endMonth,
        isCurrent: schema.applicantExperience.isCurrent,
        description: schema.applicantExperience.description,
      })
      .from(schema.applicantExperience)
      .where(eq(schema.applicantExperience.applicantId, applicantId))
      .orderBy(asc(schema.applicantExperience.startMonth)),
    db
      .select({
        levelCode: schema.applicantEducation.levelCode,
        institution: schema.applicantEducation.institution,
        fieldOfStudy: schema.applicantEducation.fieldOfStudy,
        completionYear: schema.applicantEducation.completionYear,
        isCurrent: schema.applicantEducation.isCurrent,
        grade: schema.applicantEducation.grade,
      })
      .from(schema.applicantEducation)
      .where(eq(schema.applicantEducation.applicantId, applicantId))
      .orderBy(asc(schema.applicantEducation.sortOrder)),
    db
      .select({
        languageCode: schema.applicantLanguages.languageCode,
        proficiency: schema.applicantLanguages.proficiency,
      })
      .from(schema.applicantLanguages)
      .where(eq(schema.applicantLanguages.applicantId, applicantId)),
    db
      .select({
        name: schema.applicantCertifications.name,
        issuer: schema.applicantCertifications.issuer,
        issuedMonth: schema.applicantCertifications.issuedMonth,
        expiresMonth: schema.applicantCertifications.expiresMonth,
      })
      .from(schema.applicantCertifications)
      .where(eq(schema.applicantCertifications.applicantId, applicantId))
      .orderBy(asc(schema.applicantCertifications.sortOrder)),
    db
      .select({
        categoryCodes: schema.applicantPreferences.categoryCodes,
        minSalaryPkr: schema.applicantPreferences.minSalaryPkr,
        shifts: schema.applicantPreferences.shifts,
        jobTypes: schema.applicantPreferences.jobTypes,
        availableFrom: schema.applicantPreferences.availableFrom,
      })
      .from(schema.applicantPreferences)
      .where(eq(schema.applicantPreferences.applicantId, applicantId))
      .limit(1),
    getReferredBy(application),
  ]);

  return {
    id: applicantRow.id,
    fullName: applicantRow.fullName,
    fatherName: applicantRow.fatherName,
    dateOfBirth: applicantRow.dateOfBirth,
    gender: applicantRow.gender,
    email: applicantRow.email,
    identityStatus: applicantRow.identityStatus,
    cityCode: address[0]?.cityCode ?? null,
    addressLine: address[0]?.addressLine ?? null,
    areaCode: address[0]?.areaCode ?? null,
    // Full phone, unmasked: the employer contacts the candidate directly.
    // CNIC is deliberately never selected here — PRD rule: only the
    // applicant and Job Bank staff ever see it.
    phone: phone[0]?.phone ? formatPkMobileDisplay(phone[0].phone) : null,
    education: education.map((e) => ({ ...e })),
    skills: skills.map((s) => ({ skillCode: s.skillCode, level: s.level, years: s.years })),
    languages: languages.map((l) => ({
      languageCode: l.languageCode,
      proficiency: l.proficiency,
    })),
    certifications: certifications.map((c) => ({ ...c })),
    preferences: preferences[0]
      ? {
          categoryCodes: preferences[0].categoryCodes,
          minSalaryPkr: preferences[0].minSalaryPkr,
          shifts: preferences[0].shifts,
          jobTypes: preferences[0].jobTypes,
          availableFrom: preferences[0].availableFrom,
        }
      : null,
    experience: experience.map((e) => ({
      employerName: e.employerName,
      jobTitle: e.jobTitle,
      categoryCode: e.categoryCode,
      startMonth: e.startMonth,
      endMonth: e.endMonth,
      isCurrent: e.isCurrent,
      description: e.description,
    })),
    referredBy,
  };
}

async function assertEmployerOwnsApplication(
  actor: Actor,
  applicationId: string,
): Promise<typeof ap.$inferSelect & { companyId: string }> {
  if (!actor.companyId) throw new ForbiddenError('Only employer users can perform this action');

  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId)).limit(1);
  if (!row) throw new NotFoundError('Application', applicationId);

  const [jobRow] = await db
    .select({ companyId: schema.jobs.companyId })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, row.jobId))
    .limit(1);

  if (!jobRow || jobRow.companyId !== actor.companyId)
    throw new NotFoundError('Application', applicationId);

  return { ...row, companyId: jobRow.companyId };
}

// ─── Queries ──────────────────────────────────────────────────────────────

export const EMPLOYER_VISIBLE_STATUSES: ApplicationStatus[] = [
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

/** H18 — employers only ever see applications staff have forwarded. */
export function assertEmployerCanView(status: ApplicationStatus, applicationId: string): void {
  if (!EMPLOYER_VISIBLE_STATUSES.includes(status))
    throw new NotFoundError('Application', applicationId);
}

/** Employer: list all referred candidates for their company's jobs. */
export async function listReferrals(actor: Actor): Promise<ApplicationView[]>;
export async function listReferrals(
  actor: Actor,
  query: PlacementListQuery,
): Promise<{ items: ApplicationView[]; pagination: PaginationMeta }>;
export async function listReferrals(
  actor: Actor,
  query?: PlacementListQuery,
): Promise<ApplicationView[] | { items: ApplicationView[]; pagination: PaginationMeta }> {
  assertPermission(actor, 'decision:employer');
  if (!actor.companyId) return query ? { items: [], pagination: paginationMeta(query, 0) } : [];

  const companyJobs = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(eq(schema.jobs.companyId, actor.companyId));

  if (companyJobs.length === 0)
    return query ? { items: [], pagination: paginationMeta(query, 0) } : [];

  const jobIds = companyJobs.map((j) => j.id);

  // M32 — the or(...jobIds) filter used to return every referral at once;
  // with a query only one page is fetched, plus a count for the metadata.
  const where = and(
    or(...jobIds.map((id) => eq(ap.jobId, id))),
    or(...EMPLOYER_VISIBLE_STATUSES.map((s) => eq(ap.status, s))),
  );
  const [totalRow] = query
    ? await db.select({ total: count() }).from(ap).where(where)
    : [{ total: 0 }];
  const base = db.select().from(ap).where(where);
  const rows = query ? await base.limit(query.limit).offset(query.offset) : await base;
  const items = await Promise.all(rows.map(buildView));
  if (!query) return items;
  return { items, pagination: paginationMeta(query, totalRow?.total ?? 0) };
}

/** Employer: get full application + applicant summary for one referred candidate. */
export async function getApplicationForEmployer(
  actor: Actor,
  applicationId: string,
): Promise<ApplicationWithApplicant> {
  assertPermission(actor, 'decision:employer');
  const row = await assertEmployerOwnsApplication(actor, applicationId);
  // H18 — pre-referral applications are invisible to employers, same as listReferrals.
  assertEmployerCanView(row.status, applicationId);
  const [view, applicant] = await Promise.all([
    buildView(row),
    getApplicantSummary(row.applicantId, row),
  ]);
  if (!applicant) throw new NotFoundError('Applicant', row.applicantId);
  return { ...view, applicant };
}

// ─── Employer interviews (audit 2026-11-11, H-09) ────────────────────────

/**
 * The decided sequence is staff first, then company: JobBank staff interview
 * (SCHEDULE_INTERVIEW) only from SHORTLISTED/INTERVIEW_* states, and the
 * employer interview only once the candidate is FORWARDED. The machine
 * already had the SCHEDULE_/RESCHEDULE_/POSTPONE_/CANCEL_EMPLOYER_INTERVIEW
 * events and the employerInterviewAt/Location/Note columns — nothing ever
 * called them, so employers could only Hold/Accept/Reject from FORWARDED.
 *
 * Edit rights: once the employer schedules, the employer owns the interview
 * — only the employer may reschedule, postpone or cancel it, through
 * updateEmployerInterviewStatus below. Staff JobBank interview functions
 * never touch the employerInterview* columns, and the machine cannot move
 * an application back from FORWARDED to a JobBank interview state.
 */
export const scheduleEmployerInterviewSchema = z.object({
  interviewAt: futureInterviewAtSchema,
  interviewLocation: z.string().trim().min(3).max(300).optional(),
  interviewNote: z.string().trim().max(500).optional(),
});
export type ScheduleEmployerInterviewInput = z.infer<typeof scheduleEmployerInterviewSchema>;

export const EMPLOYER_INTERVIEW_UPDATE_STATUSES = [
  'EMPLOYER_INTERVIEW_POSTPONED',
  'EMPLOYER_INTERVIEW_CANCELLED',
  'EMPLOYER_INTERVIEW_SCHEDULED',
] as const;
export type EmployerInterviewUpdateStatus = (typeof EMPLOYER_INTERVIEW_UPDATE_STATUSES)[number];

export const updateEmployerInterviewStatusSchema = z
  .object({
    status: z.enum(EMPLOYER_INTERVIEW_UPDATE_STATUSES),
    interviewAt: futureInterviewAtSchema.optional(),
    interviewLocation: z.string().trim().max(300).optional(),
    interviewNote: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    // Rescheduling back to SCHEDULED without a new date would silently keep
    // the old date; the new date is required (same rule as JobBank interviews).
    if (v.status === 'EMPLOYER_INTERVIEW_SCHEDULED' && !v.interviewAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['interviewAt'],
        message: 'Provide a new interview date & time when rescheduling',
      });
    }
  });
export type UpdateEmployerInterviewStatusInput = z.infer<
  typeof updateEmployerInterviewStatusSchema
>;

const EMPLOYER_INTERVIEW_STATES: ApplicationStatus[] = [
  'EMPLOYER_INTERVIEW_SCHEDULED',
  'EMPLOYER_INTERVIEW_POSTPONED',
  'EMPLOYER_INTERVIEW_CANCELLED',
];

async function assertOwnCompanyVerified(companyId: string): Promise<void> {
  const [companyRow] = await db
    .select({ status: schema.companies.status })
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId))
    .limit(1);
  if (companyRow?.status !== 'VERIFIED')
    throw new ForbiddenError('Only verified companies can schedule interviews');
}

async function notifyApplicantOfEmployerInterview(
  applicantId: string,
  view: ApplicationView,
  kind: 'SCHEDULED' | 'RESCHEDULED' | 'POSTPONED' | 'CANCELLED',
): Promise<void> {
  const [applicantRow] = await db
    .select({ userId: schema.applicants.userId })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, applicantId))
    .limit(1);
  if (!applicantRow) return;
  const type = (
    {
      // Audit 2026-11-23 (LOW-3): employer interviews get their own
      // types — reusing INTERVIEW_SCHEDULED made the applicant's list
      // show two indistinguishable "Interview scheduled" entries.
      SCHEDULED: 'EMPLOYER_INTERVIEW_SCHEDULED',
      RESCHEDULED: 'EMPLOYER_INTERVIEW_RESCHEDULED',
      POSTPONED: 'EMPLOYER_INTERVIEW_POSTPONED',
      CANCELLED: 'EMPLOYER_INTERVIEW_CANCELLED',
    } as const
  )[kind];
  const when = view.employerInterviewAt ? formatDateTime(view.employerInterviewAt) : '';
  const verb =
    kind === 'SCHEDULED'
      ? 'has scheduled an interview with you'
      : kind === 'RESCHEDULED'
        ? 'has rescheduled your interview'
        : kind === 'POSTPONED'
          ? 'has postponed your interview'
          : 'has cancelled your interview';
  await createNotification(db, {
    userId: applicantRow.userId,
    type,
    title: `Employer interview ${kind === 'CANCELLED' ? 'cancelled' : kind === 'POSTPONED' ? 'postponed' : 'scheduled'} — ${view.jobTitle}`,
    body: `${view.companyName} ${verb} for ${view.jobTitle}${when ? ` — ${when}` : ''}.`,
    data: { applicationId: view.id, jobTitle: view.jobTitle, companyName: view.companyName },
  });
}

/** Employer: schedule their interview with a forwarded candidate. */
export async function scheduleEmployerInterview(
  ctx: SignedIn,
  applicationId: string,
  input: ScheduleEmployerInterviewInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'decision:employer');
  const row = await assertEmployerOwnsApplication(ctx.actor, applicationId);
  assertEmployerCanView(row.status, applicationId);
  assertFutureInterviewAt(input.interviewAt);
  // In-flight step: the job must still be live and the company verified.
  assertJobLive(await loadJob(db, row.jobId), 'schedule an interview for this application');
  await assertOwnCompanyVerified(row.companyId);

  const view = await runCommand(ctx, async ({ tx, audit }) => {
    assertJobLive(
      await loadJobForUpdate(tx, row.jobId),
      'schedule an interview for this application',
    );
    const [lockedCompany] = await tx
      .select({ status: schema.companies.status })
      .from(schema.companies)
      .where(eq(schema.companies.id, row.companyId))
      .for('update');
    if (lockedCompany?.status !== 'VERIFIED')
      throw new ForbiddenError('Only verified companies can schedule interviews');
    const { to } = await lockAndTransitionApplication(
      tx,
      applicationId,
      'SCHEDULE_EMPLOYER_INTERVIEW',
    );
    const [updated] = await tx
      .update(ap)
      .set({
        status: to,
        employerInterviewAt: new Date(input.interviewAt),
        employerInterviewLocation: input.interviewLocation ?? null,
        employerInterviewNote: input.interviewNote ?? null,
        // Reset so the newly scheduled interview re-appears in the call list.
        lastCallStatus: null,
        updatedAt: new Date(),
      })
      .where(eq(ap.id, applicationId))
      .returning();
    audit({
      action: 'application.employer_interview_scheduled',
      entityType: 'application',
      entityId: applicationId,
      branchId: row.branchId,
      metadata: { jobId: row.jobId },
    });
    return updated!;
  }).then(buildView);

  void notifyApplicantOfEmployerInterview(row.applicantId, view, 'SCHEDULED').catch(() => null);
  return view;
}

/** Employer: reschedule, postpone or cancel their interview. */
export async function updateEmployerInterviewStatus(
  ctx: SignedIn,
  applicationId: string,
  input: UpdateEmployerInterviewStatusInput,
): Promise<ApplicationView> {
  assertPermission(ctx.actor, 'decision:employer');
  const row = await assertEmployerOwnsApplication(ctx.actor, applicationId);
  assertEmployerCanView(row.status, applicationId);
  if (!EMPLOYER_INTERVIEW_STATES.includes(row.status))
    throw new ForbiddenError('Can only update an interview that has been scheduled');
  if (input.status === 'EMPLOYER_INTERVIEW_SCHEDULED' && input.interviewAt) {
    assertFutureInterviewAt(input.interviewAt);
  }
  assertJobLive(await loadJob(db, row.jobId), 'update the interview for this application');

  const view = await runCommand(ctx, async ({ tx, audit }) => {
    assertJobLive(
      await loadJobForUpdate(tx, row.jobId),
      'update the interview for this application',
    );
    const event =
      input.status === 'EMPLOYER_INTERVIEW_SCHEDULED'
        ? 'RESCHEDULE_EMPLOYER_INTERVIEW'
        : input.status === 'EMPLOYER_INTERVIEW_POSTPONED'
          ? 'POSTPONE_EMPLOYER_INTERVIEW'
          : 'CANCEL_EMPLOYER_INTERVIEW';
    const { to } = await lockAndTransitionApplication(tx, applicationId, event);
    const patch: Partial<typeof ap.$inferInsert> = {
      status: to,
      lastCallStatus: null,
      updatedAt: new Date(),
    };
    if (input.status === 'EMPLOYER_INTERVIEW_SCHEDULED') {
      if (input.interviewAt) patch.employerInterviewAt = new Date(input.interviewAt);
      if (input.interviewLocation !== undefined)
        patch.employerInterviewLocation = input.interviewLocation;
      if (input.interviewNote !== undefined) patch.employerInterviewNote = input.interviewNote;
    }
    const [updated] = await tx.update(ap).set(patch).where(eq(ap.id, applicationId)).returning();
    audit({
      action: 'application.employer_interview_updated',
      entityType: 'application',
      entityId: applicationId,
      branchId: row.branchId,
      metadata: { status: input.status },
    });
    return updated!;
  }).then(buildView);

  const kind =
    input.status === 'EMPLOYER_INTERVIEW_SCHEDULED'
      ? 'RESCHEDULED'
      : input.status === 'EMPLOYER_INTERVIEW_POSTPONED'
        ? 'POSTPONED'
        : 'CANCELLED';
  void notifyApplicantOfEmployerInterview(row.applicantId, view, kind).catch(() => null);
  return view;
}

/** Applicant: refuse a job offer. */
export async function refuseJobOffer(
  ctx: SignedIn,
  applicationId: string,
  input: RefuseJobOfferInput,
): Promise<ApplicationView> {
  if (!ctx.actor.applicantId) throw new ForbiddenError('Only applicants can refuse a job offer');

  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId)).limit(1);
  if (!row) throw new NotFoundError('Application', applicationId);

  if (row.applicantId !== ctx.actor.applicantId)
    throw new ForbiddenError('You can only refuse your own job offer');

  if (row.status !== 'OFFER_EXTENDED')
    throw new ConflictError('Only OFFER_EXTENDED applications can be refused');

  // C3 — no vacancy to free here: a placement offer fills its vacancy only
  // when the applicant ACCEPTS (acceptJobOffer), so a refusal of an
  // OFFER_EXTENDED application never filled one. The rollback lives in the
  // match decline path (respondToJobOffer → freeVacancyForDeclinedMatchOffer),
  // where the match-HIRED decision fills the vacancy up front.
  // H19 — the refusal reason must be an active master-data REFUSAL_REASON
  // code, the same validation respondToJobOffer applies (the machine's
  // APPLICANT_REFUSE transition already guards the terminal-state flip).
  const reason = await requireReasonCode('REFUSAL_REASON', input.reasonCode, input.note);

  const [jobRow] = await db
    .select({ title: schema.jobs.title, companyId: schema.jobs.companyId })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, row.jobId))
    .limit(1);

  const [_applicantRow] = await db
    .select({ userId: schema.applicants.userId })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, row.applicantId))
    .limit(1);

  const [userRow] = await db
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, ctx.actor.userId))
    .limit(1);

  const view = await runCommand(ctx, async ({ tx, audit }) => {
    const { to } = await lockAndTransitionApplication(tx, applicationId, 'APPLICANT_REFUSE');
    const [updated] = await tx
      .update(ap)
      .set({
        status: to,
        applicantRefusalReason: reason.label,
        applicantRefusedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ap.id, applicationId))
      .returning();

    // Open chat with first message from applicant
    const content = `I have refused this offer. Reason: ${reason.label}${input.note ? '. ' + input.note : ''}`;
    await tx.insert(am).values({
      applicationId,
      senderId: ctx.actor.userId,
      senderRole: 'APPLICANT',
      content,
    });

    audit({
      action: 'application.applicant_refused',
      entityType: 'application',
      entityId: applicationId,
      branchId: row.branchId,
      metadata: { reason: reason.code, reasonLabel: reason.label },
    });
    return updated!;
  }).then(buildView);

  // Notify employer company users
  if (jobRow?.companyId) {
    const jobTitle = jobRow.title;
    const applicantName = userRow?.name ?? 'The applicant';
    void notifyCompanyEmployers(db, jobRow.companyId, ({ userId }) => ({
      userId,
      type: 'OFFER_DECLINED' as const,
      title: `Offer refused — ${jobTitle}`,
      body: `${applicantName} has refused the offer for ${jobTitle}. See their message in the application.`,
      data: { applicationId, jobTitle },
    })).catch(() => null);
  }

  return view;
}

/**
 * Applicant: accept a job offer. This is the hire path: the application
 * becomes HIRED and one vacancy fills in the same transaction; when the
 * last vacancy fills, the job itself becomes FILLED (system event). Until
 * now an applicant could only refuse — nothing ever wrote HIRED, so jobs
 * stayed OPEN forever and hire counts were permanently zero.
 */
export async function acceptJobOffer(
  ctx: SignedIn,
  applicationId: string,
): Promise<ApplicationView> {
  if (!ctx.actor.applicantId) throw new ForbiddenError('Only applicants can accept a job offer');

  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId)).limit(1);
  if (!row) throw new NotFoundError('Application', applicationId);

  if (row.applicantId !== ctx.actor.applicantId)
    throw new ForbiddenError('You can only accept your own job offer');

  if (row.status !== 'OFFER_EXTENDED')
    throw new ConflictError('Only OFFER_EXTENDED applications can be accepted');

  // Audit 2026-11-11 (H-11/H-12): the job must still be live (OPEN or
  // PAUSED) and have a free vacancy — an offer extended before the job
  // closed or filled must not be accept-able afterwards. Re-checked under
  // the job lock inside the transaction.
  const liveJob = await loadJob(db, row.jobId);
  assertJobLive(liveJob, 'accept this offer');
  assertVacancyAvailable(liveJob);

  const [jobRow] = await db
    .select({ title: schema.jobs.title, companyId: schema.jobs.companyId })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, row.jobId))
    .limit(1);

  const [userRow] = await db
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, ctx.actor.userId))
    .limit(1);

  const view = await runCommand(ctx, async ({ tx, audit }) => {
    // Row lock + machine check: a second, concurrent accept waits on the
    // lock, then fails the transition instead of double-filling a vacancy.
    const { to } = await lockAndTransitionApplication(tx, applicationId, 'APPLICANT_ACCEPT');
    const [updated] = await tx
      .update(ap)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(ap.id, applicationId))
      .returning();
    if (!updated) throw new ConflictError('Only OFFER_EXTENDED applications can be accepted');

    // Fill one vacancy in the same transaction, under a row lock. The live
    // and vacancy guards above are re-checked here, so a concurrent close
    // or fill landing between the pre-check and this write cannot over-fill
    // the job (audit H-12).
    const job = await loadJobForUpdate(tx, row.jobId);
    assertJobLive(job, 'accept this offer');
    assertVacancyAvailable(job);
    const filled = job.vacanciesFilled + 1;
    const patch: Partial<typeof schema.jobs.$inferInsert> = {
      vacanciesFilled: filled,
      updatedAt: new Date(),
    };
    if (filled >= job.vacancies && (job.status === 'OPEN' || job.status === 'PAUSED')) {
      const check = jobMachine.check(job.status, 'FILL', {}, 'system');
      if (check.ok) {
        patch.status = check.to;
        patch.closedAt = new Date();
      }
    }
    await tx.update(schema.jobs).set(patch).where(eq(schema.jobs.id, job.id));

    audit({
      action: 'application.applicant_accepted',
      entityType: 'application',
      entityId: applicationId,
      branchId: row.branchId,
      metadata: { jobId: row.jobId },
    });
    return updated!;
  }).then(buildView);

  // Notify employer company users
  if (jobRow?.companyId) {
    const jobTitle = jobRow.title;
    const applicantName = userRow?.name ?? 'The applicant';
    void notifyCompanyEmployers(db, jobRow.companyId, ({ userId }) => ({
      userId,
      type: 'OFFER_ACCEPTED' as const,
      title: `Offer accepted — ${jobTitle}`,
      body: `${applicantName} has accepted the offer for ${jobTitle}.`,
      data: { applicationId, jobTitle },
    })).catch(() => null);
  }

  return view;
}

// ─── Messages ──────────────────────────────────────────────────────────────

/** List all messages for an application. Accessible by employer, applicant, or match_case:read staff. */
export async function listMessages(actor: Actor, applicationId: string): Promise<MessageView[]>;
export async function listMessages(
  actor: Actor,
  applicationId: string,
  query: PlacementListQuery,
): Promise<{ items: MessageView[]; pagination: PaginationMeta }>;
export async function listMessages(
  actor: Actor,
  applicationId: string,
  query?: PlacementListQuery,
): Promise<MessageView[] | { items: MessageView[]; pagination: PaginationMeta }> {
  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId)).limit(1);
  if (!row) throw new NotFoundError('Application', applicationId);

  // Access is ownership-first: an applicant sees only their own application,
  // an employer only their own company's jobs. Staff need match_case:read AND
  // city scope — holding the permission alone must never open every case.
  if (actor.applicantId != null) {
    if (actor.applicantId !== row.applicantId) {
      throw new ForbiddenError('You can only view messages for your own application');
    }
  } else if (actor.companyId != null) {
    // Verify employer's company owns the job (applies even to dual-role
    // accounts that also hold staff permissions).
    const [jobRow] = await db
      .select({ companyId: schema.jobs.companyId })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, row.jobId))
      .limit(1);
    if (!jobRow || jobRow.companyId !== actor.companyId)
      throw new ForbiddenError('Not authorised to view this application');
  } else if (hasPermission(actor, 'match_case:read')) {
    await assertCityAccess(actor, row.branchId, {
      entityType: 'application',
      entityId: row.id,
    });
  } else {
    throw new ForbiddenError('Not authorised to view this application');
  }

  // M32 — paginate when a query is passed; the dashboard callers still get
  // the full thread, as before.
  const where = eq(am.applicationId, applicationId);
  const [totalRow] = query
    ? await db.select({ total: count() }).from(am).where(where)
    : [{ total: 0 }];

  const base = db
    .select({
      id: am.id,
      applicationId: am.applicationId,
      senderId: am.senderId,
      senderRole: am.senderRole,
      content: am.content,
      createdAt: am.createdAt,
      senderName: schema.users.name,
    })
    .from(am)
    .innerJoin(schema.users, eq(schema.users.id, am.senderId))
    .where(where)
    .orderBy(asc(am.createdAt));
  const messages = query ? await base.limit(query.limit).offset(query.offset) : await base;

  const items = messages.map((m) => ({
    id: m.id,
    applicationId: m.applicationId,
    senderId: m.senderId,
    senderRole: m.senderRole as 'EMPLOYER' | 'APPLICANT',
    senderName: m.senderName ?? 'Unknown',
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));
  if (!query) return items;
  return { items, pagination: paginationMeta(query, totalRow?.total ?? 0) };
}

/** Send a message on an application. Only EMPLOYER or APPLICANT can send. */
export async function sendMessage(
  ctx: SignedIn,
  applicationId: string,
  content: string,
): Promise<MessageView> {
  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId)).limit(1);
  if (!row) throw new NotFoundError('Application', applicationId);

  if (row.status !== 'APPLICANT_REFUSED')
    throw new ConflictError('Chat is only available after the applicant refuses an offer');

  const [jobRow] = await db
    .select({ companyId: schema.jobs.companyId, title: schema.jobs.title })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, row.jobId))
    .limit(1);

  // Determine sender role
  let senderRole: 'EMPLOYER' | 'APPLICANT';
  if (ctx.actor.applicantId === row.applicantId) {
    senderRole = 'APPLICANT';
  } else if (ctx.actor.companyId && jobRow?.companyId === ctx.actor.companyId) {
    senderRole = 'EMPLOYER';
  } else {
    throw new ForbiddenError('Only the applicant or employer can send messages');
  }

  const [userRow] = await db
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, ctx.actor.userId))
    .limit(1);

  // Audit 2026-11-11 (L-20): each message notifies the other party — 60
  // per sender per application per hour.
  await enforceRateLimit(
    'application-message',
    `${ctx.actor.userId}:${applicationId}`,
    { limit: 60, windowSeconds: 3600 },
    'Too many messages. Try again in an hour.',
  );

  const [msgRow] = await runCommand(ctx, async ({ tx, audit }) => {
    const inserted = await tx
      .insert(am)
      .values({
        applicationId,
        senderId: ctx.actor.userId,
        senderRole,
        content,
      })
      .returning();

    audit({
      action: 'application.message_sent',
      entityType: 'application',
      entityId: applicationId,
      branchId: row.branchId,
    });
    return inserted;
  });

  // Notify the other party
  if (senderRole === 'APPLICANT') {
    // Notify employer
    if (jobRow?.companyId) {
      void notifyCompanyEmployers(db, jobRow.companyId, ({ userId }) => ({
        userId,
        type: 'MESSAGE' as const,
        title: `New message — ${jobRow.title}`,
        body: 'The applicant sent a message regarding their refusal.',
        data: { applicationId },
      })).catch(() => null);
    }
  } else {
    // Notify applicant
    const [applicantRow] = await db
      .select({ userId: schema.applicants.userId })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, row.applicantId))
      .limit(1);
    if (applicantRow) {
      void createNotification(db, {
        userId: applicantRow.userId,
        type: 'MESSAGE',
        title: `New message — ${jobRow?.title ?? 'your application'}`,
        body: 'The employer replied to your message.',
        data: { applicationId },
      }).catch(() => null);
    }
  }

  return {
    id: msgRow!.id,
    applicationId: msgRow!.applicationId,
    senderId: msgRow!.senderId,
    senderRole: msgRow!.senderRole as 'EMPLOYER' | 'APPLICANT',
    senderName: userRow?.name ?? 'Unknown',
    content: msgRow!.content,
    createdAt: msgRow!.createdAt.toISOString(),
  };
}
