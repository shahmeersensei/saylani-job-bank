import { schema } from '@jobbank/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as registerForStaff } from '@/app/api/v1/applicants/staff-register/route';
import { GET as getMe } from '@/app/api/v1/applicants/me/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { call, randomPhone, signInAdmin, signInApplicant } from '@/test/api-client';

const KARACHI_HOME = { lat: 24.9256, lng: 67.0899 };
let khi: string;
let lhr: string;
let sequence = 0;

const randomCnic = () => `42${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;
const idempotencyKey = () => `staff-registration-${Date.now()}-${sequence++}`;

const registration = (branchId: string, overrides: Record<string, unknown> = {}) => ({
  branchId,
  fullName: 'Assisted Applicant',
  fatherName: 'Applicant Father',
  cnic: randomCnic(),
  dateOfBirth: '1998-04-12',
  gender: 'FEMALE',
  phone: randomPhone(),
  email: '',
  address: {
    addressLine: 'House 12, Block 13-D',
    cityCode: 'KARACHI',
    areaCode: 'KARACHI_GULSHAN_E_IQBAL',
    branchId,
    location: KARACHI_HOME,
  },
  ...overrides,
});

async function branchId(code: string) {
  const [branch] = await db
    .select({ id: schema.branches.id })
    .from(schema.branches)
    .where(eq(schema.branches.code, code));
  return branch!.id;
}

beforeAll(async () => {
  khi = await branchId('KHI-GULSHAN');
  lhr = await branchId('LHR-JOHAR');
});

beforeEach(() => resetMemoryRateLimits());

describe('staff-assisted applicant registration', () => {
  it('allows Super Admin creation and persists account, profile, address, and audit metadata', async () => {
    const admin = await signInAdmin('superadmin@jobbank.local');
    const input = registration(khi);

    const response = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: input,
      jar: admin,
      headers: { 'idempotency-key': idempotencyKey() },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const applicantId = response.body.data.id as string;
    expect(response.body.data.personal.email).toBeNull();

    const [applicant] = await db
      .select({
        userId: schema.applicants.userId,
        branchId: schema.applicants.branchId,
        registrationSource: schema.applicants.registrationSource,
        registeredBy: schema.applicants.registeredBy,
        contactConfirmedBy: schema.applicants.contactConfirmedBy,
        contactConfirmedAt: schema.applicants.contactConfirmedAt,
      })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, applicantId));
    const [user] = await db
      .select({
        phoneNumber: schema.users.phoneNumber,
        phoneNumberVerified: schema.users.phoneNumberVerified,
      })
      .from(schema.users)
      .where(eq(schema.users.id, applicant!.userId));
    const [address] = await db
      .select({ applicantId: schema.applicantAddresses.applicantId })
      .from(schema.applicantAddresses)
      .where(eq(schema.applicantAddresses.applicantId, applicantId));
    const [audit] = await db
      .select({ action: schema.auditLogs.action, entityId: schema.auditLogs.entityId })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, 'applicant.register_staff_assisted'),
          eq(schema.auditLogs.entityId, applicantId),
        ),
      );

    expect(applicant).toMatchObject({
      branchId: khi,
      registrationSource: 'STAFF_ASSISTED',
      registeredBy: expect.any(String),
      contactConfirmedBy: expect.any(String),
    });
    expect(applicant!.contactConfirmedAt).toBeInstanceOf(Date);
    expect(user).toEqual({ phoneNumber: input.phone, phoneNumberVerified: false });
    expect(address).toEqual({ applicantId });
    expect(audit).toEqual({
      action: 'applicant.register_staff_assisted',
      entityId: applicantId,
    });
  });

  it('registers without a home pin and stores a null location', async () => {
    // Home location removed from the staff form (2026-11-16): a
    // registration with no pin must succeed instead of failing validation.
    const admin = await signInAdmin('superadmin@jobbank.local');
    const input = registration(khi, {
      address: {
        addressLine: 'House 12, Block 13-D',
        cityCode: 'KARACHI',
        areaCode: 'KARACHI_GULSHAN_E_IQBAL',
        branchId: khi,
        location: null,
      },
    });

    const response = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: input,
      jar: admin,
      headers: { 'idempotency-key': idempotencyKey() },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const applicantId = response.body.data.id as string;
    const [address] = await db
      .select({ location: schema.applicantAddresses.location })
      .from(schema.applicantAddresses)
      .where(eq(schema.applicantAddresses.applicantId, applicantId));
    expect(address?.location).toBeNull();
  });

  // Round 2: a Branch Admin holds applicant:create (permissions.test.ts:
  // "Branch Admin is NOT read-only") — own-branch registration is 201,
  // and only the cross-branch attempt is refused.
  it('lets a Branch Admin register in their own branch, but not in another branch', async () => {
    const branchAdmin = await signInAdmin('branchadmin.khi@jobbank.local');
    const ownBranch = registration(khi);
    const allowed = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: ownBranch,
      jar: branchAdmin,
      headers: { 'idempotency-key': idempotencyKey() },
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
    expect(allowed.body.data.branch.code).toBe('KHI-GULSHAN');

    const crossBranch = registration(lhr);
    const rejected = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: crossBranch,
      jar: branchAdmin,
      headers: { 'idempotency-key': idempotencyKey() },
    });
    expect(rejected.status).toBe(403);
  });

  it('rejects unauthorized roles and duplicate phone or CNIC values', async () => {
    // STAFF legitimately holds applicant:create in this fork (Rafeh merge),
    // so it cannot be the denied caller — VERIFIER has no such permission.
    const verifier = await signInAdmin('verifier.khi@jobbank.local');
    const denied = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: registration(lhr),
      jar: verifier,
      headers: { 'idempotency-key': idempotencyKey() },
    });

    expect(denied.status).toBe(403);

    const admin = await signInAdmin('superadmin@jobbank.local');
    const first = registration(khi);
    const created = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: first,
      jar: admin,
      headers: { 'idempotency-key': idempotencyKey() },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const duplicatePhone = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: registration(khi, { phone: first.phone }),
      jar: admin,
      headers: { 'idempotency-key': idempotencyKey() },
    });
    expect(duplicatePhone.status).toBe(409);
    expect(duplicatePhone.body.error.details.reason).toBe('PHONE_TAKEN');

    const duplicateCnic = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: registration(khi, { cnic: first.cnic }),
      jar: admin,
      headers: { 'idempotency-key': idempotencyKey() },
    });
    expect(duplicateCnic.status).toBe(409);
    expect(duplicateCnic.body.error.details.reason).toBe('CNIC_TAKEN');
  });

  it('rejects unsupported assisted-registration gender values', async () => {
    const admin = await signInAdmin('superadmin@jobbank.local');
    const rejected = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: { ...registration(khi), gender: 'UNDISCLOSED' },
      jar: admin,
      headers: { 'idempotency-key': idempotencyKey() },
    });

    expect(rejected.status).toBe(422);
  });

  it('rejects unsupported Pakistani mobile allocation prefixes', async () => {
    const admin = await signInAdmin('superadmin@jobbank.local');
    const rejected = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: { ...registration(khi), phone: '+923991234567' },
      jar: admin,
      headers: { 'idempotency-key': idempotencyKey() },
    });

    expect(rejected.status).toBe(422);
  });

  it('keeps the phone unverified during creation and supports first-login OTP', async () => {
    const admin = await signInAdmin('superadmin@jobbank.local');
    const input = registration(khi);
    const created = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: input,
      jar: admin,
      headers: { 'idempotency-key': idempotencyKey() },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const applicantJar = await signInApplicant(input.phone);
    const profile = await call(getMe, '/api/v1/applicants/me', { jar: applicantJar });

    expect(profile.status, JSON.stringify(profile.body)).toBe(200);
    expect(profile.body.data.personal.fullName).toBe(input.fullName);
    expect(profile.body.data.personal.phone).toBe(input.phone);
  });
});
