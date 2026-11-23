import { randomBytes, createHash } from 'node:crypto';
import { schema } from '@jobbank/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as registerForStaff } from '@/app/api/v1/applicants/staff-register/route';
import { POST as getRegistrationForm } from '@/app/api/v1/applicants/[id]/registration-form/route';
import { POST as regenerateVerificationToken } from '@/app/api/v1/applicants/[id]/verification-token/regenerate/route';
import { resolveApplicantVerification } from '@/domains/applicant';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { call, randomPhone, signInAdmin } from '@/test/api-client';

const HOME = { lat: 24.9256, lng: 67.0899 };
let branchId: string;
let otherBranchId: string;
let sequence = 0;

const randomCnic = () => `42${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;

async function createApplicant(applicantBranchId = branchId) {
  const admin = await signInAdmin('superadmin@jobbank.local');
  const payload = {
    branchId: applicantBranchId,
    fullName: 'Verification Test Applicant',
    fatherName: 'Verification Test Parent',
    cnic: randomCnic(),
    dateOfBirth: '1998-04-12',
    gender: 'FEMALE',
    phone: randomPhone(),
    email: '',
    address: {
      addressLine: 'House 12, Test Block',
      cityCode: 'KARACHI',
      areaCode: 'KARACHI_GULSHAN_E_IQBAL',
      branchId: applicantBranchId,
      location: HOME,
    },
    education: { items: [] },
    experience: { hasNoExperience: true, items: [] },
    skills: { items: [] },
    languages: { items: [] },
    certifications: { items: [] },
  };
  const response = await call(registerForStaff, '/api/v1/applicants/staff-register', {
    method: 'POST',
    body: payload,
    jar: admin,
    headers: { 'idempotency-key': `verification-test-${Date.now()}-${sequence++}` },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { admin, id: response.body.data.id as string, payload };
}

beforeAll(async () => {
  const [branch] = await db
    .select({ id: schema.branches.id })
    .from(schema.branches)
    .where(eq(schema.branches.code, 'KHI-GULSHAN'));
  branchId = branch!.id;
  const [otherBranch] = await db
    .select({ id: schema.branches.id })
    .from(schema.branches)
    .where(eq(schema.branches.code, 'LHR-JOHAR'));
  otherBranchId = otherBranch!.id;
});

beforeEach(() => resetMemoryRateLimits());

describe('applicant registration form and QR verification', () => {
  it('uses the saved profile and reuses one active QR token until it is rotated', async () => {
    const { admin, id } = await createApplicant();
    const first = await call(getRegistrationForm, `/api/v1/applicants/${id}/registration-form`, {
      method: 'POST',
      jar: admin,
      params: { id },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.registrationReference).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(first.body.data.personal.fullName).toBe('Verification Test Applicant');
    expect(first.body.data.personal.email).toBeNull();
    expect(first.body.data.hasNoExperience).toBe(true);
    expect(first.body.data.experience).toEqual([]);
    expect(first.body.data.verificationQrDataUrl).toMatch(/^data:image\/png;base64,/);

    const [activeToken] = await db
      .select()
      .from(schema.applicantVerificationTokens)
      .where(
        and(
          eq(schema.applicantVerificationTokens.applicantId, id),
          eq(schema.applicantVerificationTokens.isActive, true),
        ),
      );
    expect(activeToken?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(activeToken?.tokenCiphertext).toMatch(/^v1:/);

    const repeated = await call(getRegistrationForm, `/api/v1/applicants/${id}/registration-form`, {
      method: 'POST',
      jar: admin,
      params: { id },
    });
    expect(repeated.status).toBe(200);
    expect(repeated.body.data.verificationQrDataUrl).toBe(first.body.data.verificationQrDataUrl);
    expect(
      await db
        .select()
        .from(schema.applicantVerificationTokens)
        .where(
          and(
            eq(schema.applicantVerificationTokens.applicantId, id),
            eq(schema.applicantVerificationTokens.isActive, true),
          ),
        ),
    ).toHaveLength(1);

    // Round 2: regenerating needs applicant:manage, which a Branch Admin
    // holds (permissions.test.ts: "Branch Admin is NOT read-only") — the
    // denied caller is a Verifier, who holds no applicant permission.
    const verifier = await signInAdmin('verifier.khi@jobbank.local');
    const denied = await call(
      regenerateVerificationToken,
      `/api/v1/applicants/${id}/verification-token/regenerate`,
      { method: 'POST', jar: verifier, params: { id } },
    );
    expect(denied.status).toBe(403);
    const branchAdmin = await signInAdmin('branchadmin.khi@jobbank.local');
    const rotatedByBranchAdmin = await call(
      regenerateVerificationToken,
      `/api/v1/applicants/${id}/verification-token/regenerate`,
      { method: 'POST', jar: branchAdmin, params: { id } },
    );
    expect(rotatedByBranchAdmin.status, JSON.stringify(rotatedByBranchAdmin.body)).toBe(200);
    const manager = await signInAdmin('superadmin@jobbank.local');
    const rotated = await call(
      regenerateVerificationToken,
      `/api/v1/applicants/${id}/verification-token/regenerate`,
      { method: 'POST', jar: manager, params: { id } },
    );
    expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);

    const afterRotation = await call(
      getRegistrationForm,
      `/api/v1/applicants/${id}/registration-form`,
      { method: 'POST', jar: admin, params: { id } },
    );
    expect(afterRotation.status).toBe(200);
    expect(afterRotation.body.data.verificationQrDataUrl).not.toBe(
      first.body.data.verificationQrDataUrl,
    );
    expect(
      await db
        .select()
        .from(schema.applicantVerificationTokens)
        .where(
          and(
            eq(schema.applicantVerificationTokens.applicantId, id),
            eq(schema.applicantVerificationTokens.isActive, true),
          ),
        ),
    ).toHaveLength(1);
  });

  it('returns a minimal public projection and rejects invalid or revoked credentials', async () => {
    const { id, payload } = await createApplicant();
    const token = randomBytes(32).toString('base64url');
    const [applicant] = await db
      .select({
        registrationReference: schema.applicants.registrationReference,
        registeredAt: schema.applicants.registeredAt,
      })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, id));
    const [tokenRow] = await db
      .insert(schema.applicantVerificationTokens)
      .values({
        applicantId: id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        tokenCiphertext: 'test fixture ciphertext',
      })
      .returning({ id: schema.applicantVerificationTokens.id });

    const verified = await resolveApplicantVerification(token);
    expect(verified?.applicantId).toBe(id);
    expect(verified?.verification).toEqual({
      registrationReference: applicant!.registrationReference,
      registeredAt: applicant!.registeredAt.toISOString(),
      maskedApplicantName: 'V•••• T•••• A••••',
      branchName: expect.any(String),
    });
    expect(verified?.verification).not.toHaveProperty('cnic');
    expect(verified?.verification).not.toHaveProperty('phone');
    expect(verified?.verification).not.toHaveProperty('email');
    expect(verified?.verification).not.toHaveProperty('address');
    expect(verified?.verification).not.toHaveProperty('education');
    expect(await resolveApplicantVerification(randomBytes(32).toString('base64url'))).toBeNull();

    await db
      .update(schema.applicantVerificationTokens)
      .set({ isActive: false, revokedAt: new Date() })
      .where(eq(schema.applicantVerificationTokens.id, tokenRow!.id));
    expect(await resolveApplicantVerification(token)).toBeNull();
    expect(payload.cnic).not.toBe(verified?.verification.maskedApplicantName);
  });

  it('requires authentication and enforces branch scope before returning printable details', async () => {
    const { id } = await createApplicant(otherBranchId);
    const path = `/api/v1/applicants/${id}/registration-form`;
    const anonymous = await call(getRegistrationForm, path, {
      method: 'POST',
      params: { id },
    });
    expect(anonymous.status).toBe(401);

    const otherBranchAdmin = await signInAdmin('branchadmin.khi@jobbank.local');
    const forbidden = await call(getRegistrationForm, path, {
      method: 'POST',
      jar: otherBranchAdmin,
      params: { id },
    });
    expect(forbidden.status).toBe(403);
    expect(
      await db
        .select()
        .from(schema.applicantVerificationTokens)
        .where(eq(schema.applicantVerificationTokens.applicantId, id)),
    ).toHaveLength(0);
  });
});
