import 'server-only';
import { schema } from '@jobbank/db';
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { runCommand, type RequestContext } from '@/domains/shared/audit';
import { ConflictError, NotFoundError } from '@/domains/shared/errors';
import { assertCityAccess, assertPermission, cityScope, type Actor } from '@/domains/shared/scope';
import { db } from '@/lib/db';

const ap = schema.applications;
const a = schema.applicants;
const j = schema.jobs;
const u = schema.users;
const jm = schema.jobMatches;

/** Things a counter-registered candidate needs to be told, by phone or at the counter. */
const CALL_MESSAGES: Record<string, string> = {
  INTERVIEW_SCHEDULED: 'Tell them about their Job Bank interview.',
  INTERVIEW_POSTPONED: 'Their Job Bank interview was postponed.',
  INTERVIEW_CANCELLED: 'Their Job Bank interview was cancelled.',
  // 0052 outcomes: counter-registered candidates have no portal, so the
  // only way they learn the result is a staff phone call. Without these
  // two rows a passed/failed candidate never appeared in the call queue.
  INTERVIEW_PASSED: 'They passed their Job Bank interview.',
  INTERVIEW_FAILED: 'They did not pass their Job Bank interview.',
  EMPLOYER_INTERVIEW_SCHEDULED: 'Tell them about their employer interview.',
  EMPLOYER_INTERVIEW_POSTPONED: 'Their employer interview was postponed.',
  EMPLOYER_INTERVIEW_CANCELLED: 'Their employer interview was cancelled.',
  ON_HOLD: 'The employer put their application on hold.',
  OFFER_EXTENDED: 'They have a job offer. Record their answer.',
  EMPLOYER_REJECTED: 'They were not selected for this job.',
};
const CALL_STATUSES = Object.keys(CALL_MESSAGES) as (typeof ap.$inferSelect.status)[];

export interface CallListItem {
  key: string;
  applicantId: string;
  fullName: string;
  phone: string | null;
  jobId: string;
  jobTitle: string;
  message: string;
  /** Present for the referral workflow; can be marked as told. */
  applicationId: string | null;
  /** The candidate must answer an offer made from the match shortlist. */
  matchOffer: boolean;
  interviewAt: string | null;
  interviewLocation: string | null;
  isOffer: boolean;
}

export async function listCandidateCalls(actor: Actor): Promise<CallListItem[]> {
  assertPermission(actor, 'match_case:manage');
  const scope = cityScope(actor, a.branchId);

  const applications = await db
    .select({ app: ap, fullName: a.fullName, phone: u.phoneNumber, jobTitle: j.title })
    .from(ap)
    .innerJoin(a, eq(a.id, ap.applicantId))
    .innerJoin(u, eq(u.id, a.userId))
    .innerJoin(j, eq(j.id, ap.jobId))
    .where(
      and(
        isNotNull(a.counterRegisteredBy),
        // Audit 2026-11-23 (MEDIUM-3): a passed candidate stays in the
        // queue after referral — FORWARDED is not a call status, so
        // without this the item vanished the moment the interviewer
        // referred, even if staff never phoned the candidate. The item
        // clears when markCandidateCalled records it at FORWARDED.
        or(
          inArray(ap.status, CALL_STATUSES),
          and(eq(ap.status, 'FORWARDED'), eq(ap.interviewResult, 'PASSED')),
        ),
        or(isNull(ap.lastCallStatus), ne(ap.lastCallStatus, sql`${ap.status}`)),
        scope,
      ),
    )
    .orderBy(desc(ap.updatedAt))
    .limit(200);

  const offers = await db
    .select({
      id: jm.id,
      applicantId: jm.applicantId,
      jobId: jm.jobId,
      fullName: a.fullName,
      phone: u.phoneNumber,
      jobTitle: j.title,
    })
    .from(jm)
    .innerJoin(a, eq(a.id, jm.applicantId))
    .innerJoin(u, eq(u.id, a.userId))
    .innerJoin(j, eq(j.id, jm.jobId))
    .where(
      and(
        isNotNull(a.counterRegisteredBy),
        eq(jm.reviewStatus, 'HIRED'),
        isNull(jm.applicantResponse),
        scope,
      ),
    )
    .limit(200);

  return [
    ...offers.map((o) => ({
      key: `match-${o.id}`,
      applicantId: o.applicantId,
      fullName: o.fullName,
      phone: o.phone,
      jobId: o.jobId,
      jobTitle: o.jobTitle,
      message: CALL_MESSAGES.OFFER_EXTENDED!,
      applicationId: null,
      matchOffer: true,
      interviewAt: null,
      interviewLocation: null,
      isOffer: true,
    })),
    ...applications.map(({ app, fullName, phone, jobTitle }) => {
      const employer = app.status.startsWith('EMPLOYER_INTERVIEW');
      return {
        key: app.id,
        applicantId: app.applicantId,
        fullName,
        phone,
        jobId: app.jobId,
        jobTitle,
        // MEDIUM-3: a referred passed candidate keeps a call item until
        // staff mark it called — the message says what changed.
        message:
          app.status === 'FORWARDED' && app.interviewResult === 'PASSED'
            ? 'They passed their Job Bank interview and were referred to the employer.'
            : CALL_MESSAGES[app.status]!,
        applicationId: app.id,
        matchOffer: false,
        interviewAt: (employer ? app.employerInterviewAt : app.interviewAt)?.toISOString() ?? null,
        interviewLocation:
          (employer ? app.employerInterviewLocation : app.interviewLocation) ?? null,
        isOffer: app.status === 'OFFER_EXTENDED',
      };
    }),
  ];
}

/** The candidate has been told about this status: it leaves the list until the status changes. */
export async function markCandidateCalled(
  ctx: RequestContext & { actor: Actor },
  applicationId: string,
): Promise<void> {
  assertPermission(ctx.actor, 'match_case:manage');
  const [row] = await db.select().from(ap).where(eq(ap.id, applicationId));
  if (!row) throw new NotFoundError('Application', applicationId);
  await assertCityAccess(ctx.actor, row.branchId, {
    entityType: 'application',
    entityId: applicationId,
  });
  if (row.status === 'OFFER_EXTENDED') {
    throw new ConflictError("Record the candidate's answer to this offer instead");
  }
  await runCommand(ctx, async ({ tx, audit }) => {
    await tx
      .update(ap)
      .set({ lastCallStatus: row.status, lastCalledAt: new Date(), lastCalledBy: ctx.actor.userId })
      .where(eq(ap.id, applicationId));
    audit({
      action: 'application.candidate_called',
      entityType: 'application',
      entityId: applicationId,
      branchId: row.branchId,
      metadata: { status: row.status },
    });
  });
}
