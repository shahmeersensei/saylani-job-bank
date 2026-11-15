/* Ported from Najam (2026-11-11). Adaptations: counter registration posts to
 * /api/v1/applicants/counter (not /api/v1/applicants); placeholder emails use
 * this repo's phone.jobbank.invalid domain; a shared phone is a 409 PHONE_TAKEN
 * (phone OTP stays the sign-in method); job inserts use ROTATING + shiftHours. */
import { schema } from '@jobbank/db';
import { and, desc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as getMe } from '@/app/api/v1/applicants/me/route';
import { PUT as putLocation } from '@/app/api/v1/applicants/me/location/route';
import { POST as registerCounter } from '@/app/api/v1/applicants/counter/route';
import { POST as accept } from '@/app/api/v1/applications/[id]/accept/route';
import { POST as called } from '@/app/api/v1/applications/[id]/called/route';
import { PATCH as updateInterview } from '@/app/api/v1/applications/[id]/employer-interview/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as forgot } from '@/app/api/v1/auth/password/forgot/route';
import { listCandidateCalls } from '@/domains/placement';
import { loadActor } from '@/domains/auth';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { mailOutbox } from '@/lib/mail/mailer';
import { call, type Jar, randomPhone, signInWith2fa, signInApplicant } from '@/test/api-client';

const HEADER = 'x-jb-on-behalf-of';
let staffKhi: Jar;
let staffLhr: Jar;
let employer: Jar;
let staffKhiId: string;

const randomCnic = () => '4' + String(Math.floor(1e11 + Math.random() * 8.99e11));

const candidate = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Counter Candidate',
  fatherName: 'Counter Father',
  cnic: randomCnic(),
  dateOfBirth: '1990-03-14',
  gender: 'MALE',
  consentConfirmed: true,
  ...overrides,
});

const register = (body: unknown, jar: Jar = staffKhi) =>
  call(registerCounter, '/api/v1/applicants/counter', {
    method: 'POST',
    jar,
    body,
    headers: { 'idempotency-key': crypto.randomUUID() },
  });

const asCandidate = (id: string) => ({ [HEADER]: id });

beforeAll(async () => {
  staffKhi = await signInWith2fa('staff.khi@jobbank.local');
  staffLhr = await signInWith2fa('staff.lhr@jobbank.local');
  employer = await signInWith2fa('employer@jobbank.local');
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, 'staff.khi@jobbank.local'));
  staffKhiId = row!.id;
});

beforeEach(() => resetMemoryRateLimits());

/** A registered candidate with an application at a given stage, on an employer's job. */
async function withApplication(status: 'OFFER_EXTENDED' | 'EMPLOYER_INTERVIEW_SCHEDULED') {
  const created = await register(candidate({ phone: randomPhone() }));
  const id = created.body.data.id as string;
  const [khi] = await db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.code, 'KHI-GULSHAN'));
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
      branchId: khi!.id,
      title: 'Counter Test Job',
      categoryCode: 'CALL_CENTRE',
      description: 'Job used by the counter registration tests.',
      jobType: 'FULL_TIME',
      shift: 'ROTATING',
      shiftHours: 8,
      vacancies: 1,
      status: 'OPEN',
      createdBy: owner!.id,
    })
    .returning();
  const [application] = await db
    .insert(schema.applications)
    .values({ applicantId: id, jobId: job!.id, branchId: khi!.id, createdBy: owner!.id, status })
    .returning();
  return { id, applicationId: application!.id };
}

describe('registering a candidate at a counter', () => {
  it("creates a candidate with no email, phone or login, in the staff member's branch", async () => {
    const res = await register(candidate());
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const [row] = await db
      .select({ applicant: schema.applicants, user: schema.users })
      .from(schema.applicants)
      .innerJoin(schema.users, eq(schema.users.id, schema.applicants.userId))
      .where(eq(schema.applicants.id, res.body.data.id));
    expect(row!.applicant.counterRegisteredBy).toBe(staffKhiId);
    expect(row!.applicant.consentConfirmedAt).not.toBeNull();
    expect(row!.user.phoneNumber).toBeNull();
    expect(row!.user.email).toMatch(/@phone\.jobbank\.invalid$/);

    const credentials = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, row!.user.id));
    expect(credentials).toHaveLength(0);

    const attempt = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: row!.user.email, password: 'Anything-At-All-1' },
    });
    expect(attempt.status).toBe(401);

    const sent = mailOutbox.length;
    await call(forgot, '/api/v1/auth/password/forgot', {
      method: 'POST',
      body: { email: row!.user.email },
    });
    expect(mailOutbox.length).toBe(sent);

    const [log] = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, res.body.data.id))
      .orderBy(desc(schema.auditLogs.occurredAt))
      .limit(1);
    expect(log!.actorUserId).toBe(staffKhiId);
  });

  it('needs consent, and refuses a CNIC that is already registered', async () => {
    const noConsent = await register(candidate({ consentConfirmed: false }));
    expect(noConsent.status).toBe(422);

    const cnic = randomCnic();
    expect((await register(candidate({ cnic }))).status).toBe(201);
    const again = await register(candidate({ cnic }));
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('CNIC_TAKEN');
  });

  it('refuses a mobile number that already has an account (phone OTP sign-in)', async () => {
    // Ported from Najam with the expectation reversed: Najam dropped OTP, so it
    // let families share one number. This repo keeps phone OTP, and the OTP
    // lookup takes the first row for a number — a shared number would sign the
    // wrong person in. The phone stays optional: register without one and the
    // candidate checks in at the branch.
    const phone = randomPhone();
    expect((await register(candidate({ phone }))).status).toBe(201);
    const again = await register(candidate({ phone }));
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('PHONE_TAKEN');
  });

  it('refuses job seekers and employers', async () => {
    const seeker = await signInApplicant(randomPhone());
    expect((await register(candidate(), seeker)).status).toBe(403);
    expect((await register(candidate(), employer)).status).toBe(403);
  });
});

describe('staff working on behalf of a counter candidate', () => {
  const me = (id: string, jar: Jar) =>
    call(getMe, '/api/v1/applicants/me', { jar, headers: asCandidate(id) });

  it('reaches the candidate through the job seeker routes', async () => {
    const created = await register(candidate());
    const res = await me(created.body.data.id, staffKhi);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.id).toBe(created.body.data.id);
  });

  it('is limited to staff in the same city', async () => {
    const created = await register(candidate());
    expect((await me(created.body.data.id, staffLhr)).status).toBe(403);
  });

  it('refuses employers and other job seekers', async () => {
    const created = await register(candidate());
    expect((await me(created.body.data.id, employer)).status).toBe(403);
    const seeker = await signInApplicant(randomPhone());
    expect((await me(created.body.data.id, seeker)).status).toBe(403);
  });

  it('never reaches someone who registered themselves', async () => {
    const seeker = await signInApplicant(randomPhone());
    const [user] = await db
      .select()
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt))
      .limit(1);
    const [branch] = await db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.code, 'KHI-GULSHAN'));
    const [self] = await db
      .insert(schema.applicants)
      .values({
        userId: user!.id,
        branchId: branch!.id,
        registrationSource: 'SELF_SERVICE',
        registrationReference: `SJB-TEST-${crypto.randomUUID()}`,
        fullName: 'Self Registered',
        fatherName: 'Father',
        cnic: randomCnic(),
        dateOfBirth: '1991-01-01',
        gender: 'MALE',
      })
      .returning();
    expect(seeker).toBeDefined();
    expect((await me(self!.id, staffKhi)).status).toBe(403);
  });

  it('ignores the header on routes that do not allow it', async () => {
    const created = await register(candidate());
    const res = await call(registerCounter, '/api/v1/applicants/counter', {
      method: 'POST',
      jar: staffKhi,
      body: candidate(),
      headers: { ...asCandidate(created.body.data.id), 'idempotency-key': crypto.randomUUID() },
    });
    expect(res.status).toBe(201);
  });

  it('keeps the candidate at the registering branch when their address is entered', async () => {
    const created = await register(candidate());
    const id = created.body.data.id as string;
    const [before] = await db
      .select({ branchId: schema.applicants.branchId })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, id));
    const res = await call(putLocation, '/api/v1/applicants/me/location', {
      method: 'PUT',
      jar: staffKhi,
      headers: asCandidate(id),
      body: {
        addressLine: 'House 1, Street 2',
        cityCode: 'LHR',
        location: { lat: 31.52, lng: 74.35 },
      },
    });
    expect([200, 422]).toContain(res.status);
    const [after] = await db
      .select({ branchId: schema.applicants.branchId })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, id));
    expect(after!.branchId).toBe(before!.branchId);
  });
});

describe('call list and recording offers', () => {
  it('lists offers, records the answer under the staff member, and reveals the candidate', async () => {
    const { id, applicationId } = await withApplication('OFFER_EXTENDED');
    const actor = await loadActor(staffKhiId);
    const before = await listCandidateCalls(actor);
    expect(before.find((c) => c.applicationId === applicationId)?.isOffer).toBe(true);

    const res = await call(accept, `/api/v1/applications/${applicationId}/accept`, {
      method: 'POST',
      jar: staffKhi,
      params: { id: applicationId },
      headers: asCandidate(id),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('HIRED');

    const [log] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, applicationId),
          eq(schema.auditLogs.action, 'application.applicant_accepted'),
        ),
      );
    expect(log!.actorUserId).toBe(staffKhiId);
    expect(log!.metadata).toHaveProperty('onBehalfOfUserId');

    const after = await listCandidateCalls(actor);
    expect(after.find((c) => c.applicationId === applicationId)).toBeUndefined();
  });

  it('removes an item once told, until the status changes', async () => {
    const { applicationId } = await withApplication('EMPLOYER_INTERVIEW_SCHEDULED');
    const actor = await loadActor(staffKhiId);
    expect((await listCandidateCalls(actor)).some((c) => c.applicationId === applicationId)).toBe(
      true,
    );

    const lhr = await call(called, `/api/v1/applications/${applicationId}/called`, {
      method: 'POST',
      jar: staffLhr,
      params: { id: applicationId },
    });
    expect(lhr.status).toBe(403);

    const done = await call(called, `/api/v1/applications/${applicationId}/called`, {
      method: 'POST',
      jar: staffKhi,
      params: { id: applicationId },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(204);
    expect((await listCandidateCalls(actor)).some((c) => c.applicationId === applicationId)).toBe(
      false,
    );

    // Employer decisions were removed 2026-11-12 (Step 2): the employer-decision
    // endpoint now hard-403s employers. Postponing the employer interview is
    // the still-live employer action that moves the application to another
    // call-list status (EMPLOYER_INTERVIEW_POSTPONED) and clears
    // lastCallStatus, so the item reappears in the call list.
    const postponed = await call(
      updateInterview,
      `/api/v1/applications/${applicationId}/employer-interview`,
      {
        method: 'PATCH',
        jar: employer,
        params: { id: applicationId },
        body: { status: 'EMPLOYER_INTERVIEW_POSTPONED' },
      },
    );
    expect(postponed.status, JSON.stringify(postponed.body)).toBe(200);
    expect((await listCandidateCalls(actor)).some((c) => c.applicationId === applicationId)).toBe(
      true,
    );
  });

  it("only shows counter candidates from the staff member's city", async () => {
    const { applicationId } = await withApplication('OFFER_EXTENDED');
    const [lhr] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, 'staff.lhr@jobbank.local'));
    const list = await listCandidateCalls(await loadActor(lhr!.id));
    expect(list.some((c) => c.applicationId === applicationId)).toBe(false);
  });
});
