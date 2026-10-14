import 'server-only';
import { schema } from '@jobbank/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { runCommand, type RequestContext } from '@/domains/shared/audit';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/domains/shared/errors';
import {
  assertBranchAccess,
  assertPermission,
  hasPermission,
  type Actor,
} from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { sendMail, type MailMessage } from '@/lib/mail/mailer';
import { createNotification, notifyCompanyEmployers } from '@/domains/notifications';
import {
  enqueueJobMatch,
  getLatestJobMatches,
  invalidateShortlistCache,
  type MatchesPage,
  type MatchTrigger,
} from './queries';

const j = schema.jobs;
const mr = schema.matchRuns;
const jm = schema.jobMatches;
const ap = schema.applicants;
const us = schema.users;
const md = schema.masterData;

/** Review workflow states for a shortlisted applicant (schema enum). */
export const MATCH_REVIEW_STATUSES = [
  'NEW',
  'REVIEWED',
  'SHORTLISTED',
  'HIRED',
  'REJECTED',
] as const;
export type MatchReviewStatus = (typeof MATCH_REVIEW_STATUSES)[number];

export const OFFER_RESPONSES = ['ACCEPTED', 'DECLINED'] as const;
export type OfferResponse = (typeof OFFER_RESPONSES)[number];

/** Employer sees only their own company's job; staff are branch-scoped. */
async function loadJobForActor(actor: Actor, jobId: string) {
  const [job] = await db
    .select({
      id: j.id,
      companyId: j.companyId,
      branchId: j.branchId,
      status: j.status,
      title: j.title,
    })
    .from(j)
    .where(eq(j.id, jobId))
    .limit(1);
  if (!job) throw new NotFoundError('Job', jobId);

  if (actor.roles.includes('EMPLOYER')) {
    if (actor.companyId !== job.companyId) throw new NotFoundError('Job', jobId);
  } else {
    assertBranchAccess(actor, job.branchId, { entityType: 'job', entityId: job.id });
  }
  return job;
}

/** REJECTION_REASON / REFUSAL_REASON code check against active master data. */
async function requireReasonCode(
  type: 'REJECTION_REASON' | 'REFUSAL_REASON',
  code: string | undefined,
  note: string | undefined,
): Promise<{ code: string; label: string }> {
  if (!code) {
    throw new ValidationError([{ path: 'reasonCode', message: 'Choose a reason' }]);
  }
  const [row] = await db
    .select({ code: md.code, label: md.label, meta: md.meta })
    .from(md)
    .where(and(eq(md.type, type), eq(md.code, code), eq(md.isActive, true)))
    .limit(1);
  if (!row) {
    throw new ValidationError([{ path: 'reasonCode', message: 'Unknown reason' }]);
  }
  const trimmed = note?.trim() ?? '';
  if ((row.meta as { requiresNote?: boolean }).requiresNote && trimmed.length < 5) {
    throw new ValidationError([
      { path: 'note', message: 'Add a short note for this reason (at least 5 characters)' },
    ]);
  }
  return { code: row.code, label: row.label };
}

const appUrl = (path: string) => new URL(path, env.NEXT_PUBLIC_APP_URL).toString();

/** Best-effort decision email; a failure is logged by the mailer, never thrown here. */
function sendDecisionEmail(
  ctx: RequestContext,
  to: string | null,
  message: Omit<MailMessage, 'to'>,
): void {
  if (!to) return;
  void sendMail({ to, ...message }).catch((err) => {
    ctx.log.error('match decision email failed', { to, subject: message.subject, err });
  });
}

export async function getJobMatches(
  actor: Actor,
  jobId: string,
  opts: { page: number; pageSize: number },
): Promise<MatchesPage> {
  assertPermission(actor, 'match_case:read');
  await loadJobForActor(actor, jobId);
  return getLatestJobMatches(db, jobId, opts);
}

/** Manual recalculation: enqueue an event; the Python worker rebuilds the shortlist. */
export async function requestJobMatchesRefresh(
  ctx: RequestContext & { actor: Actor },
  jobId: string,
): Promise<{ queued: true }> {
  if (
    !hasPermission(ctx.actor, 'match_case:manage') &&
    !hasPermission(ctx.actor, 'job:manage_own')
  ) {
    throw new ForbiddenError();
  }
  const job = await loadJobForActor(ctx.actor, jobId);
  if (job.status !== 'OPEN') {
    throw new ForbiddenError('Only open jobs can be re-matched');
  }

  await runCommand(ctx, async ({ tx, audit }) => {
    await enqueueJobMatch(tx, jobId, 'MANUAL' satisfies MatchTrigger);
    audit({ action: 'match.refresh', entityType: 'job', entityId: jobId });
  });
  return { queued: true };
}

export interface MatchDecisionInput {
  reviewStatus: MatchReviewStatus;
  /** Required when reviewStatus = REJECTED (master-data REJECTION_REASON code). */
  reasonCode?: string;
  /** Optional context; mandatory for reasons whose meta.requiresNote is true. */
  note?: string;
}

/**
 * Employer/staff decision on one shortlisted applicant (latest completed run).
 * Allowed for staff (`match_case:manage`) and the owning employer
 * (`decision:employer`). REJECTED persists a reason and the applicant is
 * notified in-app (+ best-effort email).
 */
export async function setJobMatchReviewStatus(
  ctx: RequestContext & { actor: Actor },
  jobId: string,
  applicantId: string,
  input: MatchDecisionInput,
): Promise<{ reviewStatus: MatchReviewStatus; reasonCode: string | null }> {
  if (
    !hasPermission(ctx.actor, 'match_case:manage') &&
    !hasPermission(ctx.actor, 'decision:employer')
  ) {
    throw new ForbiddenError();
  }
  const job = await loadJobForActor(ctx.actor, jobId);

  const reason =
    input.reviewStatus === 'REJECTED'
      ? await requireReasonCode('REJECTION_REASON', input.reasonCode, input.note)
      : null;
  const note = input.note?.trim() || null;

  await runCommand(ctx, async ({ tx, audit }) => {
    const [latestRun] = await tx
      .select({ id: mr.id })
      .from(mr)
      .where(and(eq(mr.jobId, jobId), eq(mr.status, 'COMPLETED')))
      .orderBy(desc(mr.createdAt))
      .limit(1);
    if (!latestRun) throw new NotFoundError('Match run', jobId);

    const updated = await tx
      .update(jm)
      .set({
        reviewStatus: input.reviewStatus,
        reviewReasonCode: reason?.code ?? null,
        reviewNote: note,
        reviewedBy: ctx.actor.userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(jm.runId, latestRun.id), eq(jm.applicantId, applicantId)))
      .returning({ id: jm.id });
    if (updated.length === 0) throw new NotFoundError('Match', applicantId);

    audit({
      action: 'match.review_status',
      entityType: 'job_match',
      entityId: jobId,
      metadata: {
        applicant_id: applicantId,
        review_status: input.reviewStatus,
        reason_code: reason?.code ?? null,
        note,
      },
    });
  });
  // Cached shortlist pages still show the old status — drop them (TTL would
  // cover it too, but an explicit invalidation keeps the UI instant).
  await invalidateShortlistCache(jobId);

  // Applicant-facing notification (post-commit so the row is visible even if
  // the notification insert fails — notifications must never block a decision).
  if (
    input.reviewStatus === 'SHORTLISTED' ||
    input.reviewStatus === 'HIRED' ||
    input.reviewStatus === 'REJECTED'
  ) {
    await notifyApplicantOfDecision(ctx, job, applicantId, input.reviewStatus, reason, note);
  }
  return { reviewStatus: input.reviewStatus, reasonCode: reason?.code ?? null };
}

async function notifyApplicantOfDecision(
  ctx: RequestContext & { actor: Actor },
  job: { id: string; title: string },
  applicantId: string,
  reviewStatus: 'SHORTLISTED' | 'HIRED' | 'REJECTED',
  reason: { code: string; label: string } | null,
  note: string | null,
): Promise<void> {
  try {
    const contact = await db
      .select({ userId: us.id, email: us.email, fullName: ap.fullName })
      .from(ap)
      .innerJoin(us, eq(us.id, ap.userId))
      .where(eq(ap.id, applicantId))
      .limit(1);
    const target = contact[0];
    if (!target) return;

    const copy = {
      SHORTLISTED: {
        type: 'MATCH_SHORTLISTED' as const,
        title: `Shortlisted for ${job.title}`,
        body: 'The employer shortlisted you. Job Bank staff will contact you about the next steps.',
      },
      HIRED: {
        type: 'MATCH_HIRED' as const,
        title: `Selected for ${job.title}`,
        body: 'Congratulations — the employer selected you. Your Job Bank branch will guide you through onboarding.',
      },
      REJECTED: {
        type: 'MATCH_REJECTED' as const,
        title: `Update on ${job.title}`,
        body: reason
          ? `The employer moved on with other candidates. Reason: ${reason.label}${note ? ` — ${note}` : ''}.`
          : 'The employer moved on with other candidates.',
      },
    }[reviewStatus];

    await createNotification(db, {
      userId: target.userId,
      type: copy.type,
      title: copy.title,
      body: copy.body,
      data: {
        jobId: job.id,
        jobTitle: job.title,
        applicantId,
        reasonCode: reason?.code ?? null,
        reasonLabel: reason?.label ?? null,
        note,
      },
    });

    if (target.email) {
      sendDecisionEmail(ctx, target.email, {
        subject: `${copy.title} — Saylani Job Bank`,
        text: `Assalam-o-Alaikum ${target.fullName ?? ''},\n\n${copy.body}\n\nOpen your dashboard: ${appUrl('/applicant/notifications')}\n\n— Saylani Job Bank`,
        html: `<p>Assalam-o-Alaikum ${target.fullName ?? ''},</p><p>${copy.body}</p><p><a href="${appUrl('/applicant/notifications')}">Open your dashboard</a></p><p>— Saylani Job Bank</p>`,
      });
    }
  } catch (err) {
    ctx.log.error('match decision notification failed', { jobId: job.id, applicantId, err });
  }
}

export interface OfferResponseInput {
  applicantResponse: OfferResponse;
  /** Required when applicantResponse = DECLINED (master-data REFUSAL_REASON code). */
  reasonCode?: string;
  note?: string;
}

/**
 * Applicant answers a HIRED decision on their own match (offer accept/decline).
 * Declining requires a REFUSAL_REASON; the employer is notified either way.
 */
export async function respondToJobOffer(
  ctx: RequestContext & { actor: Actor },
  jobId: string,
  input: OfferResponseInput,
): Promise<{ applicantResponse: OfferResponse }> {
  assertPermission(ctx.actor, 'decision:applicant');
  const applicantId = ctx.actor.applicantId;
  if (!applicantId) throw new ForbiddenError('No applicant profile on this account');

  const reason =
    input.applicantResponse === 'DECLINED'
      ? await requireReasonCode('REFUSAL_REASON', input.reasonCode, input.note)
      : null;

  const [job] = await db
    .select({ id: j.id, title: j.title, companyId: j.companyId })
    .from(j)
    .where(eq(j.id, jobId))
    .limit(1);
  if (!job) throw new NotFoundError('Job', jobId);

  await runCommand(ctx, async ({ tx, audit }) => {
    const [latestRun] = await tx
      .select({ id: mr.id })
      .from(mr)
      .where(and(eq(mr.jobId, jobId), eq(mr.status, 'COMPLETED')))
      .orderBy(desc(mr.createdAt))
      .limit(1);
    if (!latestRun) throw new NotFoundError('Match run', jobId);

    const [existing] = await tx
      .select({ id: jm.id, reviewStatus: jm.reviewStatus, applicantResponse: jm.applicantResponse })
      .from(jm)
      .where(and(eq(jm.runId, latestRun.id), eq(jm.applicantId, applicantId)))
      .limit(1);
    if (!existing) throw new NotFoundError('Match', applicantId);
    if (existing.reviewStatus !== 'HIRED') {
      throw new ConflictError('There is no offer to answer on this job');
    }
    if (existing.applicantResponse) {
      throw new ConflictError('You have already answered this offer');
    }

    await tx
      .update(jm)
      .set({
        applicantResponse: input.applicantResponse,
        refusalReasonCode: reason?.code ?? null,
        respondedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(jm.id, existing.id));

    audit({
      action: 'match.offer_response',
      entityType: 'job_match',
      entityId: jobId,
      metadata: {
        applicant_id: applicantId,
        response: input.applicantResponse,
        reason_code: reason?.code ?? null,
      },
    });
  });

  if (job.companyId) {
    try {
      const [applicant] = await db
        .select({ fullName: ap.fullName })
        .from(ap)
        .where(eq(ap.id, applicantId))
        .limit(1);
      const name = applicant?.fullName ?? 'An applicant';
      const accepted = input.applicantResponse === 'ACCEPTED';
      await notifyCompanyEmployers(db, job.companyId, ({ userId }) => ({
        userId,
        type: accepted ? 'OFFER_ACCEPTED' : 'OFFER_DECLINED',
        title: accepted ? `${name} accepted your offer` : `${name} declined your offer`,
        body: accepted
          ? `${job.title} — coordinate onboarding through the Job Bank branch.`
          : `${job.title}${reason ? ` — reason: ${reason.label}` : ''}. The shortlist is open again.`,
        data: {
          jobId: job.id,
          jobTitle: job.title,
          applicantId,
          response: input.applicantResponse,
          reasonCode: reason?.code ?? null,
          reasonLabel: reason?.label ?? null,
        },
      }));
    } catch (err) {
      ctx.log.error('offer response notification failed', { jobId, applicantId, err });
    }
  }
  return { applicantResponse: input.applicantResponse };
}

/** Reason dropdown options for the applicant's offer-response UI. */
export async function listRefusalReasons(): Promise<
  { code: string; label: string; requiresNote: boolean }[]
> {
  const rows = await db
    .select({ code: md.code, label: md.label, meta: md.meta })
    .from(md)
    .where(and(eq(md.type, 'REFUSAL_REASON'), eq(md.isActive, true)))
    .orderBy(md.sortOrder, md.label);
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    requiresNote: Boolean((r.meta as { requiresNote?: boolean }).requiresNote),
  }));
}

/** Reason dropdown options for the employer's reject action. */
export async function listRejectionReasons(): Promise<
  { code: string; label: string; requiresNote: boolean }[]
> {
  const rows = await db
    .select({ code: md.code, label: md.label, meta: md.meta })
    .from(md)
    .where(and(eq(md.type, 'REJECTION_REASON'), eq(md.isActive, true)))
    .orderBy(md.sortOrder, md.label);
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    requiresNote: Boolean((r.meta as { requiresNote?: boolean }).requiresNote),
  }));
}

export interface PendingOffer {
  jobId: string;
  jobTitle: string;
  score: number | null;
  hiredAt: Date | null;
}

/** HIRED decisions on the applicant's latest-run matches that they have not answered yet. */
export async function getMyPendingOffers(actor: Actor): Promise<PendingOffer[]> {
  assertPermission(actor, 'match_case:read');
  if (!actor.applicantId) return [];

  const rows = await db
    .select({ jobId: jm.jobId, jobTitle: j.title, score: jm.score, hiredAt: jm.reviewedAt })
    .from(jm)
    .innerJoin(mr, eq(mr.id, jm.runId))
    .innerJoin(j, eq(j.id, jm.jobId))
    .where(
      and(
        eq(jm.applicantId, actor.applicantId),
        eq(jm.reviewStatus, 'HIRED'),
        isNull(jm.applicantResponse),
        eq(mr.status, 'COMPLETED'),
      ),
    )
    .orderBy(desc(mr.createdAt));

  // One row per job (the latest completed run wins).
  const seen = new Set<string>();
  const offers: PendingOffer[] = [];
  for (const row of rows) {
    if (seen.has(row.jobId)) continue;
    seen.add(row.jobId);
    offers.push({
      jobId: row.jobId,
      jobTitle: row.jobTitle,
      score: row.score,
      hiredAt: row.hiredAt,
    });
  }
  return offers;
}
