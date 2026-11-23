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
 * Copilot PR #2 follow-ups are covered too: the referral count and the
 * monthly interview chart survive the employer moving the application
 * onward, and passed/failed outcomes reach the staff call queue. The
 * 2026-11-23 audit fixes are covered as well: a cross-branch interviewer
 * gets 403 on schedule/outcome/refer (HIGH-1), the dashboard pipeline
 * numbers come from the grouped count query (MEDIUM-2), the passed call
 * item survives referral (MEDIUM-3), and a cancelled interview leaves
 * the monthly chart (LOW-1).
 */
import { schema } from '@jobbank/db';
import { getSeedDevPassword } from '@jobbank/db/seed/dev-data';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as acceptInvite } from '@/app/api/v1/auth/invitations/accept/route';
import {
  PATCH as updateInterviewRoute,
  POST as scheduleInterviewRoute,
} from '@/app/api/v1/applications/[id]/interview/route';
import { POST as recordOutcomeRoute } from '@/app/api/v1/applications/[id]/interview/outcome/route';
import { POST as scheduleEmployerInterview } from '@/app/api/v1/applications/[id]/employer-interview/route';
import { POST as referRoute } from '@/app/api/v1/applications/[id]/refer/route';
import { POST as shortlistRoute } from '@/app/api/v1/applications/route';
import { POST as registerCounter } from '@/app/api/v1/applicants/counter/route';
import { POST as inviteRoute } from '@/app/api/v1/users/route';
import { loadActor } from '@/domains/auth';
import {
  countInterviewerReferrals,
  interviewPipelineCounts,
  listCandidateCalls,
  monthlyInterviewCounts,
} from '@/domains/placement';
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
let interviewerLhr: Jar;
let employer: Jar;
let staffKhiId: string;
let khiId: string;
let lhrId: string;
let jobId: string;

const randomCnic = () => '4' + String(Math.floor(1e11 + Math.random() * 8.99e11));

const futureIso = (hours: number) => new Date(Date.now() + hours * 60 * 60_000).toISOString();

/** PKT calendar year/month of an instant (PKT is fixed UTC+5, no DST). */
const pktMonth = (iso: string) => {
  const pkt = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  return { year: pkt.getUTCFullYear(), monthIndex: pkt.getUTCMonth() };
};

/** Invite + activate an Interviewer and Scheduler through the real flow. */
async function inviteInterviewer(adminJar: Jar, branchId: string): Promise<Jar> {
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
      branchId,
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
  // Interviewers are 2FA-required, so activation returns a setup token —
  // enrol here the same way Staff does in staff-management.integration.test.ts.
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
  employer = await signInWith2fa('employer@jobbank.local');
  const admin = await signInAdmin('superadmin@jobbank.local');
  const [staffRow] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, 'staff.khi@jobbank.local'));
  staffKhiId = staffRow!.id;
  const [khi] = await db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.code, 'KHI-GULSHAN'));
  khiId = khi!.id;
  const [lhr] = await db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.code, 'LHR-JOHAR'));
  lhrId = lhr!.id;
  interviewer = await inviteInterviewer(admin, khiId);
  interviewerLhr = await inviteInterviewer(admin, lhrId);

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

  it('referral count and interview month survive the employer moving the application onward', async () => {
    // Copilot PR #2 follow-ups: the referral count must not depend on the
    // application still being FORWARDED, and the monthly chart must keep
    // the interview month after the referral. Deltas, not absolutes —
    // the other tests in this file create referrals too.
    const staffActor = await loadActor(staffKhiId);
    const interviewAt = futureIso(2);
    const { year, monthIndex } = pktMonth(interviewAt);
    const referralsBefore = await countInterviewerReferrals(staffActor);
    const monthsBefore = await monthlyInterviewCounts(staffActor, year);
    // Audit 2026-11-23 (MEDIUM-2): the dashboard numbers come from the
    // grouped count query now, not from loading the whole pipeline.
    const pipelineBefore = await interviewPipelineCounts(staffActor);

    const { applicationId } = await shortlistedApplication();
    expect((await interviewPipelineCounts(staffActor)).toSchedule).toBe(
      pipelineBefore.toSchedule + 1,
    );
    const scheduled = await call(
      scheduleInterviewRoute,
      `/api/v1/applications/${applicationId}/interview`,
      {
        method: 'POST',
        jar: interviewer,
        params: { id: applicationId },
        body: { interviewAt, interviewLocation: 'Branch office' },
      },
    );
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201);
    const pipelineAfterSchedule = await interviewPipelineCounts(staffActor);
    expect(pipelineAfterSchedule.toSchedule).toBe(pipelineBefore.toSchedule);
    expect(pipelineAfterSchedule.scheduled).toBe(pipelineBefore.scheduled + 1);
    const monthsAfterSchedule = await monthlyInterviewCounts(staffActor, year);
    expect(monthsAfterSchedule[monthIndex]).toBe((monthsBefore[monthIndex] ?? 0) + 1);

    const outcome = await recordOutcome(applicationId, interviewer, {
      attendance: 'ATTENDED',
      result: 'PASSED',
      feedback: 'Strong answers, good fit.',
    });
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(201);
    expect((await interviewPipelineCounts(staffActor)).passed).toBe(pipelineBefore.passed + 1);

    // Counter-registered candidates have no portal: the pass must reach
    // the staff call queue so someone phones them the result.
    const calls = await listCandidateCalls(staffActor);
    expect(calls.find((c) => c.applicationId === applicationId)?.message).toContain('passed');

    const referred = await refer(applicationId, interviewer);
    expect(referred.status, JSON.stringify(referred.body)).toBe(200);
    expect(await countInterviewerReferrals(staffActor)).toBe(referralsBefore + 1);

    // Audit 2026-11-23 (MEDIUM-3): the passed call item must survive
    // the referral until staff mark it called — otherwise nobody phones
    // the counter-registered candidate about the outcome.
    const callsAfterRefer = await listCandidateCalls(staffActor);
    expect(callsAfterRefer.find((c) => c.applicationId === applicationId)?.message).toContain(
      'referred',
    );

    // Employer moves it onward — schedules their own interview. The
    // referral already happened: the count and the chart month must stay.
    const employerInterview = await call(
      scheduleEmployerInterview,
      `/api/v1/applications/${applicationId}/employer-interview`,
      {
        method: 'POST',
        jar: employer,
        params: { id: applicationId },
        body: { interviewAt: futureIso(48), interviewLocation: 'Employer office' },
      },
    );
    expect(employerInterview.status, JSON.stringify(employerInterview.body)).toBe(201);
    expect(employerInterview.body.data.status).toBe('EMPLOYER_INTERVIEW_SCHEDULED');
    expect(await countInterviewerReferrals(staffActor)).toBe(referralsBefore + 1);
    const monthsAfter = await monthlyInterviewCounts(staffActor, year);
    expect(monthsAfter[monthIndex]).toBe((monthsBefore[monthIndex] ?? 0) + 1);
  });

  it('a failed candidate appears in the staff call queue', async () => {
    const staffActor = await loadActor(staffKhiId);
    const { applicationId } = await shortlistedApplication();
    const scheduled = await schedule(applicationId, interviewer);
    expect(scheduled.status).toBe(201);

    const outcome = await recordOutcome(applicationId, interviewer, {
      attendance: 'ATTENDED',
      result: 'FAILED',
      feedback: 'Not a fit for this role.',
    });
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(201);

    const calls = await listCandidateCalls(staffActor);
    expect(calls.find((c) => c.applicationId === applicationId)?.message).toContain('did not pass');
  });

  it('a cancelled interview does not count in the monthly chart', async () => {
    // Audit 2026-11-23 (LOW-1): the chart label is "Interviews
    // Scheduled" — a cancelled interview must not count as one.
    const staffActor = await loadActor(staffKhiId);
    const interviewAt = futureIso(2);
    const { year, monthIndex } = pktMonth(interviewAt);
    const monthsBefore = await monthlyInterviewCounts(staffActor, year);

    const { applicationId } = await shortlistedApplication();
    const scheduled = await call(
      scheduleInterviewRoute,
      `/api/v1/applications/${applicationId}/interview`,
      {
        method: 'POST',
        jar: interviewer,
        params: { id: applicationId },
        body: { interviewAt, interviewLocation: 'Branch office' },
      },
    );
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201);
    const monthsAfterSchedule = await monthlyInterviewCounts(staffActor, year);
    expect(monthsAfterSchedule[monthIndex]).toBe((monthsBefore[monthIndex] ?? 0) + 1);

    const cancelled = await call(
      updateInterviewRoute,
      `/api/v1/applications/${applicationId}/interview`,
      {
        method: 'PATCH',
        jar: interviewer,
        params: { id: applicationId },
        body: { status: 'INTERVIEW_CANCELLED' },
      },
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const monthsAfterCancel = await monthlyInterviewCounts(staffActor, year);
    expect(monthsAfterCancel[monthIndex]).toBe(monthsBefore[monthIndex] ?? 0);
  });

  it('an interviewer from another branch cannot touch a KHI application', async () => {
    // Audit 2026-11-23 (HIGH-1): the interviewer's lists are branch-exact,
    // so his commands must be too. The Lahore interviewer must get 403 on
    // schedule, outcome and refer — while the KHI interviewer can still
    // schedule the same application afterwards.
    const { applicationId } = await shortlistedApplication();

    const scheduledByLhr = await schedule(applicationId, interviewerLhr);
    expect(scheduledByLhr.status).toBe(403);

    const scheduled = await schedule(applicationId, interviewer);
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201);

    const outcomeByLhr = await recordOutcome(applicationId, interviewerLhr, {
      attendance: 'ATTENDED',
      result: 'PASSED',
      feedback: 'Strong answers, good fit.',
    });
    expect(outcomeByLhr.status).toBe(403);

    const outcome = await recordOutcome(applicationId, interviewer, {
      attendance: 'ATTENDED',
      result: 'PASSED',
      feedback: 'Strong answers, good fit.',
    });
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(201);

    const referredByLhr = await refer(applicationId, interviewerLhr);
    expect(referredByLhr.status).toBe(403);

    const referred = await refer(applicationId, interviewer);
    expect(referred.status, JSON.stringify(referred.body)).toBe(200);
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
