/**
 * 0052 — interviewer end-to-end (Option B): record outcome, then refer
 * only after a pass.
 *
 * NOT RUN in the workspace where it was written: it needs a live Postgres
 * test database (the integration project seeds it in globalSetup). Run it
 * on the laptop with:
 *   pnpm --filter @jobbank/web exec vitest run --project integration \
 *     src/domains/placement/interview-outcome.integration.test.ts
 * until that passes, treat the refer-after-pass path as unit-verified only
 * (placement-guards.test.ts: machine + referableStatusesFor + schema).
 *
 * Flow under test, through the real API routes: Staff shortlists a
 * counter-registered candidate for an OPEN job → interviewer schedules the
 * Job Bank interview → interviewer records the outcome → interviewer
 * refers the passed candidate to the employer. The guard cases assert the
 * server rejects a referral before a pass, and a referral after a fail.
 */
import { schema } from '@jobbank/db';
import { getSeedDevPassword } from '@jobbank/db/seed/dev-data';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as acceptInvite } from '@/app/api/v1/auth/invitations/accept/route';
import { POST as scheduleInterviewRoute } from '@/app/api/v1/applications/[id]/interview/route';
import { POST as recordOutcomeRoute } from '@/app/api/v1/applications/[id]/interview/outcome/route';
import { POST as referRoute } from '@/app/api/v1/applications/[id]/refer/route';
import { POST as shortlistRoute } from '@/app/api/v1/applications/route';
import { POST as registerCounter } from '@/app/api/v1/applicants/counter/route';
import { POST as inviteRoute } from '@/app/api/v1/users/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { mailOutbox } from '@/lib/mail/mailer';
import {
  call,
  enrollTwoFactor,
  Jar,
  randomPhone,
  signInAdmin,
  signInWith2fa,
  uniqueEmail,
} from '@/test/api-client';

let staffKhi: Jar;
let interviewer: Jar;
let khiId: string;
let jobId: string;

const randomCnic = () => '4' + String(Math.floor(1e11 + Math.random() * 8.99e11));

const futureIso = (hours: number) => new Date(Date.now() + hours * 60 * 60_000).toISOString();

/** Invite + activate an Interviewer and Scheduler through the real flow. */
async function inviteInterviewer(adminJar: Jar): Promise<Jar> {
  const email = uniqueEmail('interviewer');
  const invited = await call(inviteRoute, '/api/v1/users', {
    method: 'POST',
    jar: adminJar,
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: {
      name: 'Test Interviewer',
      email,
      title: 'Interviewer Officer',
      role: 'INTERVIEWER_SCHEDULER',
      branchId: khiId,
    },
  });
  expect(invited.status, JSON.stringify(invited.body)).toBe(201);
  const mail = [...mailOutbox].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase());
  const token = mail?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? '';
  expect(token).not.toBe('');
  const jar = new Jar();
  const accepted = await call(acceptInvite, '/api/v1/auth/invitations/accept', {
    method: 'POST',
    body: { token, password: getSeedDevPassword() },
    jar,
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  // Interviewers are not 2FA-required; if that ever changes, enrol here
  // the same way Staff does in staff-management.integration.test.ts.
  if (accepted.body.data.kind === 'two_factor_setup_required') {
    jar.setupToken = accepted.body.data.setupToken as string;
    await enrollTwoFactor(email, jar);
  }
  return jar;
}

/** A counter-registered candidate, shortlisted by Staff for the shared OPEN job. */
async function shortlistedApplication() {
  const created = await call(registerCounter, '/api/v1/applicants/counter', {
    method: 'POST',
    jar: staffKhi,
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: {
      fullName: 'Interview Candidate',
      fatherName: 'Interview Father',
      cnic: randomCnic(),
      dateOfBirth: '1990-03-14',
      gender: 'MALE',
      phone: randomPhone(),
      consentConfirmed: true,
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const applicantId = created.body.data.id as string;
  const shortlisted = await call(shortlistRoute, '/api/v1/applications', {
    method: 'POST',
    jar: staffKhi,
    body: { applicantId, jobId },
  });
  expect(shortlisted.status, JSON.stringify(shortlisted.body)).toBe(201);
  expect(shortlisted.body.data.status).toBe('SHORTLISTED');
  return { applicantId, applicationId: shortlisted.body.data.id as string };
}

const schedule = (applicationId: string, jar: Jar) =>
  call(scheduleInterviewRoute, `/api/v1/applications/${applicationId}/interview`, {
    method: 'POST',
    jar,
    params: { id: applicationId },
    body: { interviewAt: futureIso(2), interviewLocation: 'Branch office' },
  });

const recordOutcome = (applicationId: string, jar: Jar, body: unknown) =>
  call(recordOutcomeRoute, `/api/v1/applications/${applicationId}/interview/outcome`, {
    method: 'POST',
    jar,
    params: { id: applicationId },
    body,
  });

const refer = (applicationId: string, jar: Jar) =>
  call(referRoute, `/api/v1/applications/${applicationId}/refer`, {
    method: 'POST',
    jar,
    params: { id: applicationId },
    body: {},
  });

beforeAll(async () => {
  staffKhi = await signInWith2fa('staff.khi@jobbank.local');
  const admin = await signInAdmin('superadmin@jobbank.local');
  const [khi] = await db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.code, 'KHI-GULSHAN'));
  khiId = khi!.id;
  interviewer = await inviteInterviewer(admin);

  const [owner] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, 'employer@jobbank.local'));
  const [member] = await db
    .select()
    .from(schema.companyMembers)
    .where(eq(schema.companyMembers.userId, owner!.id));
  const [job] = await db
    .insert(schema.jobs)
    .values({
      companyId: member!.companyId,
      branchId: khiId,
      title: 'Interview Outcome Test Job',
      categoryCode: 'CALL_CENTRE',
      description: 'Job used by the interview-outcome integration tests.',
      jobType: 'FULL_TIME',
      shift: 'ROTATING',
      shiftHours: 8,
      vacancies: 5,
      status: 'OPEN',
      createdBy: owner!.id,
    })
    .returning();
  jobId = job!.id;
});

beforeEach(() => resetMemoryRateLimits());

describe('interviewer end-to-end: outcome then referral (0052)', () => {
  it('interviewer schedules, records a pass, then refers to the employer', async () => {
    const { applicationId } = await shortlistedApplication();

    const scheduled = await schedule(applicationId, interviewer);
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201);
    expect(scheduled.body.data.status).toBe('INTERVIEW_SCHEDULED');

    const outcome = await recordOutcome(applicationId, interviewer, {
      attendance: 'ATTENDED',
      result: 'PASSED',
      feedback: 'Strong answers, good fit.',
    });
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(201);
    expect(outcome.body.data.status).toBe('INTERVIEW_PASSED');
    expect(outcome.body.data.interviewResult).toBe('PASSED');

    const referred = await refer(applicationId, interviewer);
    expect(referred.status, JSON.stringify(referred.body)).toBe(200);
    expect(referred.body.data.status).toBe('FORWARDED');
  });

  it('interviewer cannot refer a shortlisted candidate before any interview', async () => {
    const { applicationId } = await shortlistedApplication();
    const referred = await refer(applicationId, interviewer);
    expect(referred.status).toBe(403);
    expect(JSON.stringify(referred.body)).toContain('passed interview outcome');
  });

  it('interviewer cannot record an outcome on a shortlisted candidate', async () => {
    const { applicationId } = await shortlistedApplication();
    const outcome = await recordOutcome(applicationId, interviewer, {
      attendance: 'ATTENDED',
      result: 'PASSED',
    });
    expect(outcome.status).toBe(403);
  });

  it('a no-show is a fail and cannot be referred afterwards', async () => {
    const { applicationId } = await shortlistedApplication();
    const scheduled = await schedule(applicationId, interviewer);
    expect(scheduled.status).toBe(201);

    const outcome = await recordOutcome(applicationId, interviewer, {
      attendance: 'NO_SHOW',
      result: 'FAILED',
      feedback: 'Did not attend.',
    });
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(201);
    expect(outcome.body.data.status).toBe('INTERVIEW_FAILED');

    const referred = await refer(applicationId, interviewer);
    expect(referred.status).toBe(403);
  });

  it('staff can still refer a shortlisted candidate without an interview', async () => {
    const { applicationId } = await shortlistedApplication();
    const referred = await refer(applicationId, staffKhi);
    expect(referred.status, JSON.stringify(referred.body)).toBe(200);
    expect(referred.body.data.status).toBe('FORWARDED');
  });
});
