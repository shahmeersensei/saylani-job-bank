import { schema } from '@jobbank/db';
import { and, eq, isNull } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PATCH as decideMatch } from '@/app/api/v1/jobs/[id]/matches/[applicantId]/route';
import { POST as respondOffer } from '@/app/api/v1/offers/[jobId]/response/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { mailOutbox } from '@/lib/mail/mailer';
import { call, randomPhone, signIn, signInApplicant, Jar } from '@/test/api-client';

const us = schema.users;
const ap = schema.applicants;
const co = schema.companies;
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

  const [existing] = await db
    .select({ id: co.id })
    .from(co)
    .where(and(eq(co.legalName, 'Decide Flow Traders'), eq(co.createdBy, employerUserId)))
    .limit(1);
  if (existing) {
    companyId = existing.id;
  } else {
    const company = (
      await db
        .insert(co)
        .values({
          branchId: KHI,
          legalName: 'Decide Flow Traders',
          legalStructure: 'PRIVATE_LIMITED',
          ntn: String(Math.floor(1e6 + Math.random() * 9e6)),
          industryCode: 'RETAIL',
          sizeBand: '1_10',
          status: 'VERIFIED',
          verifiedAt: new Date(),
          createdBy: employerUserId,
        })
        .returning({ id: co.id })
    )[0]!;
    companyId = company.id;
  }
  await db
    .insert(cm)
    .values({ companyId, userId: employerUserId, role: 'OWNER' })
    .onConflictDoNothing();

  employerJar = await signIn('employer@jobbank.local');
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

    const stillUnread = await db
      .select()
      .from(nt)
      .where(and(eq(nt.userId, f.applicantUserId), isNull(nt.readAt)));
    expect(stillUnread).toHaveLength(0);
  });
});
