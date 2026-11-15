import { permissionsFor } from '@jobbank/shared';
import { schema } from '@jobbank/db';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PATCH as decideMatch } from '@/app/api/v1/jobs/[id]/matches/[applicantId]/route';
import { POST as respondOffer } from '@/app/api/v1/offers/[jobId]/response/route';
import { countHiresByMonth } from '@/domains/job';
import { GET as listNotifications } from '@/app/api/v1/notifications/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import type { Actor } from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { mailOutbox } from '@/lib/mail/mailer';
import { call, randomPhone, signInWith2fa, signInApplicant, Jar } from '@/test/api-client';

const us = schema.users;
const ap = schema.applicants;
const apn = schema.applications;
const cm = schema.companyMembers;
const j = schema.jobs;
const mr = schema.matchRuns;
const jm = schema.jobMatches;
const nt = schema.notifications;

let KHI: string;
let employerJar: Jar;
let employerUserId: string;
let companyId: string;

function lastMailTo(email: string) {
  const mail = [...mailOutbox].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase());
  if (!mail) throw new Error(`no email captured for ${email}`);
  return mail;
}

const randomCnic = () => '3' + String(Math.floor(1e11 + Math.random() * 8.99e11));

beforeAll(async () => {
  KHI = (
    await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.code, 'KHI-GULSHAN'))
  )[0]!.id;

  employerUserId = (
    await db.select({ id: us.id }).from(us).where(eq(us.email, 'employer@jobbank.local'))
  )[0]!.id;

  const [membership] = await db
    .select({ companyId: cm.companyId })
    .from(cm)
    .where(eq(cm.userId, employerUserId));
  if (!membership) throw new Error('Seeded employer has no company membership');
  companyId = membership.companyId;

  employerJar = await signInWith2fa('employer@jobbank.local');
});

beforeEach(() => resetMemoryRateLimits());

/** Fresh job + completed run + one ACTIVE applicant match, owned by the dev employer. */
async function seedFixture() {
  const phone = randomPhone();
  const applicantJar = await signInApplicant(phone);
  const applicantUser = (
    await db.select({ id: us.id, email: us.email }).from(us).where(eq(us.phoneNumber, phone))
  )[0]!;

  const applicant = (
    await db
      .insert(ap)
      .values({
        userId: applicantUser.id,
        registrationReference: `SJB-${randomUUID()}`,
        branchId: KHI,
        fullName: 'Decision Tester',
        fatherName: 'Test Father',
        cnic: randomCnic(),
        dateOfBirth: '1998-04-12',
        gender: 'MALE',
        status: 'ACTIVE',
        profileCompleteness: 100,
      })
      .returning({ id: ap.id })
  )[0]!;

  const job = (
    await db
      .insert(j)
      .values({
        companyId,
        branchId: KHI,
        title: 'Warehouse Supervisor',
        categoryCode: 'CALL_CENTRE',
        description: 'Supervise the warehouse floor.',
        jobType: 'FULL_TIME',
        shift: 'DAY',
        vacancies: 1,
        status: 'OPEN',
        createdBy: employerUserId,
      })
      .returning({ id: j.id })
  )[0]!;

  const run = (
    await db
      .insert(mr)
      .values({
        jobId: job.id,
        triggerType: 'MANUAL',
        status: 'COMPLETED',
        criteriaVersion: 1,
        scoringVersion: 'v2',
        candidateCount: 1,
        eligibleCount: 1,
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .returning({ id: mr.id })
  )[0]!;

  await db.insert(jm).values({
    runId: run.id,
    jobId: job.id,
    applicantId: applicant.id,
    score: 91,
    distanceM: 1400,
    summary: 'Strong overall match',
  });

  return {
    jobId: job.id as string,
    applicantId: applicant.id as string,
    applicantUserId: applicantUser.id as string,
    applicantEmail: applicantUser.email as string,
    applicantJar,
  };
}

const decision = (jobId: string, applicantId: string, jar: Jar, body: unknown) =>
  call(decideMatch, `/api/v1/jobs/${jobId}/matches/${applicantId}`, {
    method: 'PATCH',
    jar,
    params: { id: jobId, applicantId },
    body: body as Record<string, unknown>,
  });

const respond = (jobId: string, jar: Jar, body: unknown) =>
  call(respondOffer, `/api/v1/offers/${jobId}/response`, {
    method: 'POST',
    jar,
    params: { jobId },
    body: body as Record<string, unknown>,
  });

/** The fixture employer, as a domain actor (owns `companyId`). */
const employerActor = (): Actor => ({
  userId: employerUserId,
  roles: ['EMPLOYER'],
  permissions: permissionsFor(['EMPLOYER']),
  branchIds: [KHI],
  activeBranchId: null,
  companyId,
  applicantId: null,
  twoFactorPending: false,
});

/** Current year/month in Asia/Karachi — the hires chart buckets in PKT. */
function currentPktYearMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value),
  };
}

describe('employer match decisions (hire / reject)', () => {
  it('rejecting without a reason code is refused', async () => {
    const f = await seedFixture();
    const res = await decision(f.jobId, f.applicantId, employerJar, { reviewStatus: 'REJECTED' });
    expect(res.status).toBe(422);
  });

  it('rejecting with a reason persists it, notifies and emails the applicant', async () => {
    const f = await seedFixture();
    const res = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'REJECTED',
      reasonCode: 'SKILLS_MISMATCH',
      note: 'Missing forklift certification for this role',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const [row] = await db
      .select()
      .from(jm)
      .where(and(eq(jm.jobId, f.jobId), eq(jm.applicantId, f.applicantId)));
    expect(row!.reviewStatus).toBe('REJECTED');
    expect(row!.reviewReasonCode).toBe('SKILLS_MISMATCH');
    expect(row!.reviewedBy).toBe(employerUserId);
    expect(row!.reviewedAt).not.toBeNull();

    const [notification] = await db
      .select()
      .from(nt)
      .where(and(eq(nt.userId, f.applicantUserId), eq(nt.type, 'MATCH_REJECTED')));
    expect(notification).toBeTruthy();
    expect(notification!.title).toContain('Warehouse Supervisor');
    expect(notification!.body).toContain('Skills do not match the role');

    const mail = lastMailTo(f.applicantEmail);
    expect(mail.subject).toContain('Update on Warehouse Supervisor');
  });

  it('"Other" rejection reasons additionally require a note', async () => {
    const f = await seedFixture();
    const missingNote = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'REJECTED',
      reasonCode: 'OTHER',
    });
    expect(missingNote.status).toBe(422);

    const withNote = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'REJECTED',
      reasonCode: 'OTHER',
      note: 'Did not show up for the branch introduction call',
    });
    expect(withNote.status).toBe(200);
  });

  it('hiring notifies the applicant, who can then accept', async () => {
    const f = await seedFixture();
    const shortlisted = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'SHORTLISTED',
    });
    expect(shortlisted.status, JSON.stringify(shortlisted.body)).toBe(200);
    const hired = await decision(f.jobId, f.applicantId, employerJar, { reviewStatus: 'HIRED' });
    expect(hired.status, JSON.stringify(hired.body)).toBe(200);

    const [notification] = await db
      .select()
      .from(nt)
      .where(and(eq(nt.userId, f.applicantUserId), eq(nt.type, 'MATCH_HIRED')));
    expect(notification!.title).toContain('Selected for Warehouse Supervisor');
    expect(lastMailTo(f.applicantEmail).subject).toContain('Selected for Warehouse Supervisor');

    // The applicant accepts from their own session.
    const accepted = await respond(f.jobId, f.applicantJar, { applicantResponse: 'ACCEPTED' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

    const [row] = await db.select().from(jm).where(eq(jm.jobId, f.jobId));
    expect(row!.applicantResponse).toBe('ACCEPTED');
    expect(row!.respondedAt).not.toBeNull();

    // The employer side is notified of the acceptance.
    const [employerNotice] = await db
      .select()
      .from(nt)
      .where(and(eq(nt.userId, employerUserId), eq(nt.type, 'OFFER_ACCEPTED')));
    expect(employerNotice!.title).toContain('Decision Tester');
  });

  it('declining requires a refusal reason and closes the offer', async () => {
    const f = await seedFixture();
    const shortlisted = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'SHORTLISTED',
    });
    expect(shortlisted.status, JSON.stringify(shortlisted.body)).toBe(200);
    await decision(f.jobId, f.applicantId, employerJar, { reviewStatus: 'HIRED' });

    const missingReason = await respond(f.jobId, f.applicantJar, {
      applicantResponse: 'DECLINED',
    });
    expect(missingReason.status).toBe(422);

    const declined = await respond(f.jobId, f.applicantJar, {
      applicantResponse: 'DECLINED',
      reasonCode: 'BETTER_OFFER',
    });
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);

    const [row] = await db.select().from(jm).where(eq(jm.jobId, f.jobId));
    expect(row!.applicantResponse).toBe('DECLINED');
    expect(row!.refusalReasonCode).toBe('BETTER_OFFER');

    const [employerNotice] = await db
      .select()
      .from(nt)
      .where(and(eq(nt.userId, employerUserId), eq(nt.type, 'OFFER_DECLINED')));
    expect(employerNotice!.title).toContain('declined your offer');

    // Answering twice is a conflict.
    const again = await respond(f.jobId, f.applicantJar, { applicantResponse: 'ACCEPTED' });
    expect(again.status).toBe(409);
  });

  it('applicants cannot decide matches; unauthenticated calls are rejected', async () => {
    const f = await seedFixture();
    const asApplicant = await decision(f.jobId, f.applicantId, f.applicantJar, {
      reviewStatus: 'HIRED',
    });
    expect(asApplicant.status).toBe(403);

    const anonymous = await decision(f.jobId, f.applicantId, new Jar(), {
      reviewStatus: 'HIRED',
    });
    expect(anonymous.status).toBe(401);
  });

  it('responding to a job without an offer is a conflict', async () => {
    const f = await seedFixture();
    const res = await respond(f.jobId, f.applicantJar, { applicantResponse: 'ACCEPTED' });
    expect(res.status).toBe(409);
  });

  it('unread notifications list for the applicant includes the decision', async () => {
    const f = await seedFixture();
    const shortlisted = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'SHORTLISTED',
    });
    expect(shortlisted.status, JSON.stringify(shortlisted.body)).toBe(200);
    await decision(f.jobId, f.applicantId, employerJar, { reviewStatus: 'HIRED' });

    const [row] = await db
      .select({ id: nt.id, readAt: nt.readAt })
      .from(nt)
      .where(and(eq(nt.userId, f.applicantUserId), eq(nt.type, 'MATCH_HIRED')));
    expect(row!.readAt).toBeNull();

    const marked = await db
      .update(nt)
      .set({ readAt: new Date() })
      .where(eq(nt.id, row!.id))
      .returning({ readAt: nt.readAt });
    expect(marked[0]!.readAt).not.toBeNull();

    // Only the MATCH_HIRED notification is in scope here: the SHORTLISTED
    // decision above notifies too, and it stays unread by design.
    const [after] = await db
      .select({ readAt: nt.readAt })
      .from(nt)
      .where(and(eq(nt.userId, f.applicantUserId), eq(nt.type, 'MATCH_HIRED')));
    expect(after!.readAt).not.toBeNull();
  });

  it('review decisions enforce the transition table (H19)', async () => {
    const f = await seedFixture();
    // NEW cannot jump straight to HIRED.
    const directHire = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'HIRED',
    });
    expect(directHire.status).toBe(409);

    const reviewed = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'REVIEWED',
    });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);

    // REVIEWED cannot hire either — SHORTLISTED first.
    const hireFromReviewed = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'HIRED',
    });
    expect(hireFromReviewed.status).toBe(409);

    const shortlisted = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'SHORTLISTED',
    });
    expect(shortlisted.status, JSON.stringify(shortlisted.body)).toBe(200);

    const hired = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'HIRED',
    });
    expect(hired.status, JSON.stringify(hired.body)).toBe(200);

    // HIRED is terminal: it cannot be flipped back to REJECTED.
    const unhire = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'REJECTED',
      reasonCode: 'SKILLS_MISMATCH',
      note: 'Changed our mind',
    });
    expect(unhire.status).toBe(409);
  });

  it('decisions on a closed job are refused (H19)', async () => {
    const f = await seedFixture();
    await db.update(j).set({ status: 'CLOSED' }).where(eq(j.id, f.jobId));
    const res = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'REVIEWED',
    });
    expect(res.status).toBe(409);
  });

  it('a HIRED match fills the vacancy, syncs the application and shows in the hires chart (C3)', async () => {
    const f = await seedFixture();
    await db.insert(apn).values({
      applicantId: f.applicantId,
      jobId: f.jobId,
      branchId: KHI,
      createdBy: employerUserId,
      status: 'SHORTLISTED',
    });

    // Other tests in this file hire for the same company, so the chart
    // assertion is a before/after delta, not an absolute bucket.
    const { year, month } = currentPktYearMonth();
    const before = await countHiresByMonth(employerActor(), year);

    const shortlisted = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'SHORTLISTED',
    });
    expect(shortlisted.status, JSON.stringify(shortlisted.body)).toBe(200);
    const hired = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'HIRED',
    });
    expect(hired.status, JSON.stringify(hired.body)).toBe(200);

    // The application was synced to HIRED …
    const [application] = await db
      .select()
      .from(apn)
      .where(and(eq(apn.jobId, f.jobId), eq(apn.applicantId, f.applicantId)));
    expect(application!.status).toBe('HIRED');

    // … the single vacancy filled, so the job is FILLED …
    const [job] = await db
      .select({ status: j.status, vacanciesFilled: j.vacanciesFilled })
      .from(j)
      .where(eq(j.id, f.jobId));
    expect(job!.vacanciesFilled).toBe(1);
    expect(job!.status).toBe('FILLED');

    // … and the hire shows in this month's chart bucket (PKT).
    const after = await countHiresByMonth(employerActor(), year);
    expect(after[month - 1]! - before[month - 1]!).toBe(1);
  });

  it('a declined match offer drops out of the hires chart (C3)', async () => {
    const f = await seedFixture();
    // An application row exists, so the decline can mirror onto it (H19):
    // the match HIRED syncs it to HIRED, the decline mirrors it back.
    await db.insert(apn).values({
      applicantId: f.applicantId,
      jobId: f.jobId,
      branchId: KHI,
      createdBy: employerUserId,
      status: 'SHORTLISTED',
    });
    const { year, month } = currentPktYearMonth();
    const before = await countHiresByMonth(employerActor(), year);

    const shortlisted = await decision(f.jobId, f.applicantId, employerJar, {
      reviewStatus: 'SHORTLISTED',
    });
    expect(shortlisted.status, JSON.stringify(shortlisted.body)).toBe(200);
    await decision(f.jobId, f.applicantId, employerJar, { reviewStatus: 'HIRED' });
    const declined = await respond(f.jobId, f.applicantJar, {
      applicantResponse: 'DECLINED',
      reasonCode: 'BETTER_OFFER',
    });
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);

    // C3: the vacancy this match filled is freed — the job re-opens …
    const [job] = await db
      .select({ status: j.status, vacanciesFilled: j.vacanciesFilled })
      .from(j)
      .where(eq(j.id, f.jobId));
    expect(job!.vacanciesFilled).toBe(0);
    expect(job!.status).toBe('OPEN');

    // … H19: … and the placement application mirrors back to refused,
    // because placement owns the offer truth.
    const [application] = await db
      .select()
      .from(apn)
      .where(and(eq(apn.jobId, f.jobId), eq(apn.applicantId, f.applicantId)));
    expect(application!.status).toBe('APPLICANT_REFUSED');

    const after = await countHiresByMonth(employerActor(), year);
    expect(after[month - 1]! - before[month - 1]!).toBe(0);
  });

  it('reports the unread count across all pages', async () => {
    const f = await seedFixture();
    await db.insert(nt).values(
      Array.from({ length: 10 }, (_, index) => ({
        userId: f.applicantUserId,
        type: 'MATCH_HIRED',
        title: `Test notification ${index}`,
        readAt: index < 8 ? new Date() : null,
        createdAt: new Date(Date.now() - index * 1000),
      })),
    );
    const response = await call(listNotifications, '/api/v1/notifications?pageSize=8', {
      jar: f.applicantJar,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toHaveLength(8);
    expect(response.body.meta.total).toBe(10);
    expect(response.body.meta.unread).toBe(2);
  });
});
