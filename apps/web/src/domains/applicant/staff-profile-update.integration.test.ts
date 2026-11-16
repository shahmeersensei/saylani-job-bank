import { schema } from '@jobbank/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PATCH as updateProfile } from '@/app/api/v1/applicants/[id]/profile/route';
import { POST as registerForStaff } from '@/app/api/v1/applicants/staff-register/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { call, randomPhone, signInAdmin, signInApplicant } from '@/test/api-client';

const KARACHI_HOME = { lat: 24.9256, lng: 67.0899 };
let khi: string;
let lhr: string;
let educationLevel: string;
let jobCategory: string;
let sequence = 0;

const randomCnic = () => `42${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;
const idempotencyKey = () => `staff-profile-update-${Date.now()}-${sequence++}`;

const registration = (branchId: string, overrides: Record<string, unknown> = {}) => ({
  branchId,
  fullName: 'Profile Update Applicant',
  fatherName: 'Applicant Parent',
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

const emptyProfileUpdate = (cnic: string, fullName: string) => ({
  fullName,
  fatherName: 'Applicant Parent',
  cnic,
  dateOfBirth: '1998-04-12',
  gender: 'FEMALE',
  email: null,
  address: {
    addressLine: 'House 12, Block 13-D',
    cityCode: 'KARACHI',
    areaCode: 'KARACHI_GULSHAN_E_IQBAL',
    location: KARACHI_HOME,
  },
  education: { items: [] },
  experience: { hasNoExperience: false, items: [] },
  skills: { items: [] },
  languages: { items: [] },
  certifications: { items: [] },
  recordIds: { education: [], experience: [], certifications: [] },
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
  const [level] = await db
    .select({ code: schema.masterData.code })
    .from(schema.masterData)
    .where(and(eq(schema.masterData.type, 'EDUCATION_LEVEL'), eq(schema.masterData.isActive, true)))
    .limit(1);
  educationLevel = level!.code;
  const [category] = await db
    .select({ code: schema.masterData.code })
    .from(schema.masterData)
    .where(and(eq(schema.masterData.type, 'JOB_CATEGORY'), eq(schema.masterData.isActive, true)))
    .limit(1);
  jobCategory = category!.code;
});

beforeEach(() => resetMemoryRateLimits());

async function createApplicant(branch: string, input = registration(branch)) {
  const admin = await signInAdmin('superadmin@jobbank.local');
  return call(registerForStaff, '/api/v1/applicants/staff-register', {
    method: 'POST',
    body: input,
    jar: admin,
    headers: { 'idempotency-key': idempotencyKey() },
  });
}

describe('staff applicant profile update', () => {
  it('updates existing related records in place and preserves account and applicant identity', async () => {
    const admin = await signInAdmin('superadmin@jobbank.local');
    const input = registration(khi, {
      education: {
        items: [
          {
            levelCode: educationLevel,
            institution: 'Old College',
            fieldOfStudy: 'Commerce',
            completionYear: 2018,
            isCurrent: false,
            grade: 'B',
          },
        ],
      },
      experience: {
        hasNoExperience: false,
        items: [
          {
            employerName: 'Old Employer',
            jobTitle: 'Assistant',
            categoryCode: null,
            startMonth: '2021-01',
            endMonth: '2022-01',
            isCurrent: false,
            description: 'Old work details',
          },
        ],
      },
      certifications: {
        items: [
          { name: 'Old course', issuer: 'Old issuer', issuedMonth: null, expiresMonth: null },
        ],
      },
      preferences: {
        categoryCodes: [jobCategory],
        minSalaryPkr: null,
        shifts: [],
        jobTypes: [],
        willingRadiusM: null,
        availableFrom: null,
      },
    });
    const created = await call(registerForStaff, '/api/v1/applicants/staff-register', {
      method: 'POST',
      body: input,
      jar: admin,
      headers: { 'idempotency-key': idempotencyKey() },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const applicant = created.body.data;
    const applicantId = applicant.id as string;
    const recordIds = applicant.recordIds as {
      education: string[];
      experience: string[];
      certifications: string[];
    };
    const [beforeApplicant] = await db
      .select({
        userId: schema.applicants.userId,
        branchId: schema.applicants.branchId,
        registrationReference: schema.applicants.registrationReference,
        status: schema.applicants.status,
        identityStatus: schema.applicants.identityStatus,
      })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, applicantId));
    const [beforeUser] = await db
      .select({
        phoneNumber: schema.users.phoneNumber,
        phoneNumberVerified: schema.users.phoneNumberVerified,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(eq(schema.users.id, beforeApplicant!.userId));
    const rolesBefore = await db
      .select({ roleCode: schema.userRoles.roleCode, branchId: schema.userRoles.branchId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, beforeApplicant!.userId));
    const preferencesBefore = await db
      .select()
      .from(schema.applicantPreferences)
      .where(eq(schema.applicantPreferences.applicantId, applicantId));

    const payload = {
      fullName: 'Updated Profile Applicant',
      fatherName: 'Updated Parent',
      cnic: applicant.personal.cnic as string,
      dateOfBirth: applicant.personal.dateOfBirth as string,
      gender: applicant.personal.gender as string,
      email: 'updated.contact@example.test',
      address: {
        addressLine: 'House 24, Updated Street',
        cityCode: 'KARACHI',
        areaCode: 'KARACHI_GULSHAN_E_IQBAL',
        location: KARACHI_HOME,
      },
      education: {
        items: [
          {
            levelCode: educationLevel,
            institution: 'Updated College',
            fieldOfStudy: 'Business',
            completionYear: 2019,
            isCurrent: false,
            grade: 'A',
          },
          {
            levelCode: educationLevel,
            institution: 'New Institute',
            fieldOfStudy: 'Accounting',
            completionYear: 2022,
            isCurrent: false,
            grade: null,
          },
        ],
      },
      experience: {
        hasNoExperience: false,
        items: [
          {
            employerName: 'Updated Employer',
            jobTitle: 'Coordinator',
            categoryCode: null,
            startMonth: '2021-01',
            endMonth: '2022-01',
            isCurrent: false,
            description: 'Updated work details',
          },
          {
            employerName: 'Second Employer',
            jobTitle: 'Clerk',
            categoryCode: null,
            startMonth: '2023-01',
            endMonth: '2024-01',
            isCurrent: false,
            description: null,
          },
        ],
      },
      skills: { items: [] },
      languages: { items: [] },
      certifications: {
        items: [
          {
            name: 'Updated course',
            issuer: 'Updated issuer',
            issuedMonth: null,
            expiresMonth: null,
          },
        ],
      },
      recordIds: {
        education: [recordIds.education[0], null],
        experience: [recordIds.experience[0], null],
        certifications: [recordIds.certifications[0]],
      },
    };

    const updated = await call(updateProfile, `/api/v1/applicants/${applicantId}/profile`, {
      method: 'PATCH',
      body: payload,
      jar: admin,
      params: { id: applicantId },
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.id).toBe(applicantId);
    expect(updated.body.data.status).toBe(beforeApplicant!.status);
    expect(updated.body.data.registrationReference).toBe(beforeApplicant!.registrationReference);
    expect(updated.body.data.identityStatus).toBe('UNVERIFIED');
    expect(updated.body.data.recordIds.education[0]).toBe(recordIds.education[0]);
    expect(updated.body.data.recordIds.experience[0]).toBe(recordIds.experience[0]);
    expect(updated.body.data.recordIds.certifications[0]).toBe(recordIds.certifications[0]);
    expect(updated.body.data.education[0].institution).toBe('Updated College');
    expect(updated.body.data.experience[0].employerName).toBe('Updated Employer');
    expect(updated.body.data.certifications[0].name).toBe('Updated course');

    const repeated = await call(updateProfile, `/api/v1/applicants/${applicantId}/profile`, {
      method: 'PATCH',
      body: payload,
      jar: admin,
      params: { id: applicantId },
    });
    expect(repeated.status, JSON.stringify(repeated.body)).toBe(200);

    const [updatedApplicant] = await db
      .select({
        id: schema.applicants.id,
        userId: schema.applicants.userId,
        branchId: schema.applicants.branchId,
        status: schema.applicants.status,
      })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, applicantId));
    const educationRows = await db
      .select({
        id: schema.applicantEducation.id,
        institution: schema.applicantEducation.institution,
      })
      .from(schema.applicantEducation)
      .where(eq(schema.applicantEducation.applicantId, applicantId));
    const experienceRows = await db
      .select({
        id: schema.applicantExperience.id,
        employerName: schema.applicantExperience.employerName,
      })
      .from(schema.applicantExperience)
      .where(eq(schema.applicantExperience.applicantId, applicantId));
    const certificationRows = await db
      .select({ id: schema.applicantCertifications.id })
      .from(schema.applicantCertifications)
      .where(eq(schema.applicantCertifications.applicantId, applicantId));
    const [afterUser] = await db
      .select({
        phoneNumber: schema.users.phoneNumber,
        phoneNumberVerified: schema.users.phoneNumberVerified,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(eq(schema.users.id, beforeApplicant!.userId));
    const rolesAfter = await db
      .select({ roleCode: schema.userRoles.roleCode, branchId: schema.userRoles.branchId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, beforeApplicant!.userId));
    const preferencesAfter = await db
      .select()
      .from(schema.applicantPreferences)
      .where(eq(schema.applicantPreferences.applicantId, applicantId));

    expect(updatedApplicant).toEqual({
      id: applicantId,
      userId: beforeApplicant!.userId,
      branchId: beforeApplicant!.branchId,
      status: beforeApplicant!.status,
    });
    expect(educationRows).toHaveLength(2);
    expect(educationRows.find((row) => row.id === recordIds.education[0])?.institution).toBe(
      'Updated College',
    );
    expect(experienceRows).toHaveLength(2);
    expect(experienceRows.find((row) => row.id === recordIds.experience[0])?.employerName).toBe(
      'Updated Employer',
    );
    expect(certificationRows).toHaveLength(1);
    expect(afterUser).toEqual(beforeUser);
    expect(rolesAfter).toEqual(rolesBefore);
    expect(preferencesAfter).toEqual(preferencesBefore);
    expect(updated.body.data.personal.phone).toBe(beforeUser!.phoneNumber);

    const removalPayload = {
      ...payload,
      education: { items: payload.education.items.slice(0, 1) },
      experience: { ...payload.experience, items: payload.experience.items.slice(0, 1) },
      recordIds: {
        education: [recordIds.education[0]],
        experience: [recordIds.experience[0]],
        certifications: [recordIds.certifications[0]],
      },
    };
    const removed = await call(updateProfile, `/api/v1/applicants/${applicantId}/profile`, {
      method: 'PATCH',
      body: removalPayload,
      jar: admin,
      params: { id: applicantId },
    });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    const remainingEducation = await db
      .select({ id: schema.applicantEducation.id })
      .from(schema.applicantEducation)
      .where(eq(schema.applicantEducation.applicantId, applicantId));
    const remainingExperience = await db
      .select({ id: schema.applicantExperience.id })
      .from(schema.applicantExperience)
      .where(eq(schema.applicantExperience.applicantId, applicantId));
    expect(remainingEducation.map((row) => row.id)).toEqual([recordIds.education[0]]);
    expect(remainingExperience.map((row) => row.id)).toEqual([recordIds.experience[0]]);

    const deletePreferences = await call(
      updateProfile,
      `/api/v1/applicants/${applicantId}/profile`,
      {
        method: 'PATCH',
        body: { ...payload, preferences: null },
        jar: admin,
        params: { id: applicantId },
      },
    );
    expect(deletePreferences.status, JSON.stringify(deletePreferences.body)).toBe(200);
    const remainingPreferences = await db
      .select()
      .from(schema.applicantPreferences)
      .where(eq(schema.applicantPreferences.applicantId, applicantId));
    expect(remainingPreferences).toHaveLength(0);
  });

  it('allows authorized administrators and rejects unauthenticated or cross-branch updates', async () => {
    const created = await createApplicant(lhr);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const applicantId = created.body.data.id as string;
    const cnic = created.body.data.personal.cnic as string;

    const unauthenticated = await call(updateProfile, `/api/v1/applicants/${applicantId}/profile`, {
      method: 'PATCH',
      body: emptyProfileUpdate(cnic, 'Unauthenticated Update'),
      params: { id: applicantId },
    });
    expect(unauthenticated.status).toBe(401);

    const branchAdmin = await signInAdmin('branchadmin.khi@jobbank.local');
    const crossBranch = await call(updateProfile, `/api/v1/applicants/${applicantId}/profile`, {
      method: 'PATCH',
      body: emptyProfileUpdate(cnic, 'Cross Branch Update'),
      jar: branchAdmin,
      params: { id: applicantId },
    });
    expect(crossBranch.status).toBe(403);

    const ownApplicant = await createApplicant(khi);
    expect(ownApplicant.status, JSON.stringify(ownApplicant.body)).toBe(201);
    const ownApplicantId = ownApplicant.body.data.id as string;
    // Round 2: a Branch Admin holds applicant:manage (permissions.test.ts:
    // "Branch Admin is NOT read-only"), so their own-branch update is 200.
    const allowedBranchAdmin = await call(
      updateProfile,
      `/api/v1/applicants/${ownApplicantId}/profile`,
      {
        method: 'PATCH',
        body: emptyProfileUpdate(
          ownApplicant.body.data.personal.cnic,
          'Authorized Branch Admin Update',
        ),
        jar: branchAdmin,
        params: { id: ownApplicantId },
      },
    );
    expect(allowedBranchAdmin.status, JSON.stringify(allowedBranchAdmin.body)).toBe(200);

    const superAdmin = await signInAdmin('superadmin@jobbank.local');
    const allowed = await call(updateProfile, `/api/v1/applicants/${applicantId}/profile`, {
      method: 'PATCH',
      body: emptyProfileUpdate(cnic, 'Authorized Super Admin Update'),
      jar: superAdmin,
      params: { id: applicantId },
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);

    const applicantUser = await signInApplicant(created.body.data.personal.phone);
    const deniedApplicant = await call(updateProfile, `/api/v1/applicants/${applicantId}/profile`, {
      method: 'PATCH',
      body: emptyProfileUpdate(cnic, 'Unauthorized Applicant Update'),
      jar: applicantUser,
      params: { id: applicantId },
    });
    expect(deniedApplicant.status).toBe(403);
  });

  it('keeps a stored home pin when the profile update sends no location', async () => {
    // The staff form no longer sends a pin at all (2026-11-16): editing
    // a profile must not wipe the one already stored.
    const created = await createApplicant(khi);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const applicantId = created.body.data.id as string;
    const cnic = created.body.data.personal.cnic as string;

    const admin = await signInAdmin('superadmin@jobbank.local');
    const update = await call(updateProfile, `/api/v1/applicants/${applicantId}/profile`, {
      method: 'PATCH',
      body: {
        ...emptyProfileUpdate(cnic, 'Profile Update Applicant'),
        address: {
          addressLine: 'House 12, Block 13-D',
          cityCode: 'KARACHI',
          areaCode: 'KARACHI_GULSHAN_E_IQBAL',
          location: null,
        },
      },
      jar: admin,
      params: { id: applicantId },
    });
    expect(update.status, JSON.stringify(update.body)).toBe(200);

    const [address] = await db
      .select({ location: schema.applicantAddresses.location })
      .from(schema.applicantAddresses)
      .where(eq(schema.applicantAddresses.applicantId, applicantId));
    expect(address?.location).toEqual(KARACHI_HOME);
  });
});
