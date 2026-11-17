import { schema } from '@jobbank/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as getApplicant, PATCH as staffPatch } from '@/app/api/v1/applicants/[id]/route';
import { POST as markVerifiedSigned } from '@/app/api/v1/applicants/[id]/registration-form/verified-signed/route';
import { GET as staffDocUrl } from '@/app/api/v1/applicants/[id]/documents/[docId]/url/route';
import { GET as staffDocDownload } from '@/app/api/v1/applicants/[id]/documents/[docId]/download/route';
import { PUT as uploadDoc } from '@/app/api/v1/applicants/me/documents/[id]/upload/route';
import { POST as verifyIdentity } from '@/app/api/v1/applicants/[id]/identity-verification/route';
import { PUT as changePhone } from '@/app/api/v1/applicants/[id]/phone/route';
import { POST as requestPhoneCode } from '@/app/api/v1/applicants/[id]/phone/code/route';
import { PATCH as staffStatus } from '@/app/api/v1/applicants/[id]/status/route';
import { POST as transfer } from '@/app/api/v1/applicants/[id]/transfer/route';
import { GET as branchOptions } from '@/app/api/v1/applicants/me/branch-options/route';
import { PUT as putExperience } from '@/app/api/v1/applicants/me/experience/route';
import { POST as confirmDoc } from '@/app/api/v1/applicants/me/documents/[id]/confirm/route';
import { DELETE as removeDoc } from '@/app/api/v1/applicants/me/documents/[id]/route';
import { GET as docTypes, POST as presignDoc } from '@/app/api/v1/applicants/me/documents/route';
import { PUT as putLocation } from '@/app/api/v1/applicants/me/location/route';
import { PUT as putPreferences } from '@/app/api/v1/applicants/me/preferences/route';
import { GET as getMe, PATCH as patchMe } from '@/app/api/v1/applicants/me/route';
import { PUT as putSkills } from '@/app/api/v1/applicants/me/skills/route';
import { PATCH as myStatus } from '@/app/api/v1/applicants/me/status/route';
import { POST as register } from '@/app/api/v1/applicants/register/route';
import { GET as listApplicants, POST as staffRegister } from '@/app/api/v1/applicants/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { devOutbox } from '@/lib/sms/sms';
import {
  BASE,
  call,
  owner,
  randomPhone,
  signInWith2fa,
  signInAdmin,
  signInApplicant,
  type Jar,
} from '@/test/api-client';

const KARACHI_HOME = { lat: 24.9256, lng: 67.0899 }; // ~1 km from the Gulshan branch
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const randomCnic = () => `42${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;
let idempotency = 0;
const key = () => `it-applicant-${Date.now()}-${idempotency++}`;

const branchId = async (code: string) =>
  (
    await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.code, code))
  )[0]!.id;

let khi: string;
let lhr: string;
let staffJar: Jar;
let staffUserId: string;

beforeAll(async () => {
  khi = await branchId('KHI-GULSHAN');
  lhr = await branchId('LHR-JOHAR');
  staffJar = await signInWith2fa('staff.khi@jobbank.local');
  staffUserId = (
    await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, 'staff.khi@jobbank.local'))
  )[0]!.id;
});
beforeEach(() => resetMemoryRateLimits());

const personal = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Ayesha Khan',
  fatherName: 'Imran Khan',
  cnic: randomCnic(),
  dateOfBirth: '1998-04-12',
  gender: 'FEMALE',
  email: '',
  ...overrides,
});

async function registered(overrides: Record<string, unknown> = {}) {
  const jar = await signInApplicant(randomPhone());
  const body = personal(overrides);
  const res = await call(register, '/api/v1/applicants/register', {
    method: 'POST',
    body,
    jar,
    headers: { 'idempotency-key': key() },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { jar, profile: res.body.data, cnic: body.cnic as string };
}

describe('staff-assisted applicant registration', () => {
  async function createStaffApplicant(branchId: string, jar = staffJar) {
    return call(staffRegister, '/api/v1/applicants', {
      method: 'POST',
      body: { ...personal(), phone: randomPhone(), branchId },
      jar,
    });
  }

  it('rejects a CNIC that is already registered', async () => {
    const existing = await registered();
    const response = await call(staffRegister, '/api/v1/applicants', {
      method: 'POST',
      body: {
        ...personal({ cnic: existing.cnic }),
        phone: randomPhone(),
        branchId: khi,
      },
      jar: staffJar,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.details.reason).toBe('CNIC_TAKEN');
  });

  it('rejects a staff member registering an applicant outside their branch', async () => {
    const response = await call(staffRegister, '/api/v1/applicants', {
      method: 'POST',
      body: { ...personal(), phone: randomPhone(), branchId: lhr },
      jar: staffJar,
    });

    expect(response.status).toBe(403);
  });

  it('creates an ACTIVE applicant and audits the staff member who created it', async () => {
    const body = { ...personal(), phone: randomPhone(), branchId: khi };
    const response = await call(staffRegister, '/api/v1/applicants', {
      method: 'POST',
      body,
      jar: staffJar,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('ACTIVE');
    expect(response.body.data.createdByStaff).toMatchObject({
      name: expect.any(String),
      roleLabel: 'Job Bank Staff',
    });
    const applicantId = response.body.data.id as string;
    const [applicant] = await db
      .select({
        status: schema.applicants.status,
        branchId: schema.applicants.branchId,
        userId: schema.applicants.userId,
      })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, applicantId));
    const [applicantRole] = await db
      .select({ roleCode: schema.userRoles.roleCode })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, applicant!.userId));
    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, 'applicant.register_by_staff'),
          eq(schema.auditLogs.entityId, applicantId),
        ),
      );

    expect(applicant).toMatchObject({ status: 'ACTIVE', branchId: khi });
    expect(applicantRole?.roleCode).toBe('APPLICANT');
    // Revised process: registration issues no token — the form's QR encodes the
    // applicant ID instead. The token is issued only if a later step needs one.
    expect(response.body.data.registrationToken).toBeUndefined();
    expect(audit).toMatchObject({
      actorUserId: staffUserId,
      branchId: khi,
      metadata: { createdBy: staffUserId },
    });
  });

  it('marks an applicant verified & signed and audits it', async () => {
    const created = await createStaffApplicant(khi);
    expect(created.status).toBe(201);
    const applicantId = created.body.data.id as string;
    const response = await call(
      markVerifiedSigned,
      `/api/v1/applicants/${applicantId}/registration-form/verified-signed`,
      { method: 'POST', jar: staffJar, params: { id: applicantId } },
    );

    expect(response.status).toBe(200);
    expect(response.body.data.verifiedSigned).toBe(true);
    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, 'applicant.registration_form_verified_signed'),
          eq(schema.auditLogs.entityId, applicantId),
        ),
      );
    expect(audit).toBeDefined();
    expect(audit?.metadata).toMatchObject({ verifiedBy: staffUserId });
  });
});

const location = (branch: string) => ({
  location: KARACHI_HOME,
  addressLine: 'House 12, Block 13-D',
  cityCode: 'KARACHI',
  areaCode: 'KARACHI_GULSHAN_E_IQBAL',
  branchId: branch,
});

/** A genuine move to the Lahore branch (city code drives the auto-assign). */
const lahoreLocation = {
  location: { lat: 31.4697, lng: 74.2728 },
  addressLine: 'House 12, Block G1',
  cityCode: 'LAHORE',
  areaCode: 'LAHORE_JOHAR_TOWN',
};

async function upload(jar: Jar, typeCode: string, bytes = PNG, contentType = 'image/png') {
  const presigned = await call(presignDoc, '/api/v1/applicants/me/documents', {
    method: 'POST',
    body: { typeCode, fileName: `${typeCode}.png`, contentType, sizeBytes: bytes.byteLength },
    jar,
  });
  expect(presigned.status, JSON.stringify(presigned.body)).toBe(201);
  const { documentId } = presigned.body.data;
  // Same-origin upload: the bytes go to the app's upload route, which stores
  // them — the browser (and this test) never talks to storage directly.
  const stored = await uploadDoc(
    new Request(`${BASE}/api/v1/applicants/me/documents/${documentId}/upload`, {
      method: 'PUT',
      headers: { 'content-type': contentType, cookie: jar.header() },
      body: bytes,
    }),
    { params: Promise.resolve({ id: documentId }) },
  );
  expect(stored.status).toBe(200);
  const confirmed = await call(
    confirmDoc,
    `/api/v1/applicants/me/documents/${documentId}/confirm`,
    {
      method: 'POST',
      jar,
      params: { id: documentId },
    },
  );
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return { documentId: documentId as string, profile: confirmed.body.data };
}

/** Registered, located in Karachi and with both CNIC sides: an ACTIVE profile. */
async function activeApplicant() {
  const r = await registered();
  expect(
    (
      await call(putLocation, '/api/v1/applicants/me/location', {
        method: 'PUT',
        body: location(khi),
        jar: r.jar,
      })
    ).status,
  ).toBe(200);
  await upload(r.jar, 'CNIC_FRONT');
  const back = await upload(r.jar, 'CNIC_BACK');
  expect(back.profile.status).toBe('ACTIVE');
  return { ...r, profile: back.profile };
}

const latestAudit = async (action: string, entityId: string) =>
  (
    await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, action), eq(schema.auditLogs.entityId, entityId)))
      .orderBy(desc(schema.auditLogs.id))
      .limit(1)
  )[0];

describe('applicant registration', () => {
  it('starts an ACTIVE profile from the phone account and names the account', async () => {
    const jar = await signInApplicant(randomPhone());
    expect((await call(getMe, '/api/v1/applicants/me', { jar })).status).toBe(404);

    const body = personal();
    const res = await call(register, '/api/v1/applicants/register', {
      method: 'POST',
      body: {
        ...body,
        cnic: `${body.cnic.slice(0, 5)}-${body.cnic.slice(5, 12)}-${body.cnic.slice(12)}`,
      },
      jar,
      headers: { 'idempotency-key': key() },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'ACTIVE',
      identityStatus: 'UNVERIFIED',
      personal: { fullName: 'Ayesha Khan', cnic: body.cnic, email: null },
      completeness: { percent: 20, activationMissing: ['location', 'documents'] },
      branch: null,
    });
    const [user] = await db
      .select({ name: schema.users.name })
      .from(schema.users)
      .innerJoin(schema.applicants, eq(schema.applicants.userId, schema.users.id))
      .where(eq(schema.applicants.id, res.body.data.id));
    expect(user!.name).toBe('Ayesha Khan');

    const again = await call(register, '/api/v1/applicants/register', {
      method: 'POST',
      body: personal(),
      jar,
      headers: { 'idempotency-key': key() },
    });
    expect(again.status).toBe(409);
  });

  it('rejects under-18s and malformed CNICs', async () => {
    const jar = await signInApplicant(randomPhone());
    const young = new Date();
    young.setUTCFullYear(young.getUTCFullYear() - 17);
    const res = await call(register, '/api/v1/applicants/register', {
      method: 'POST',
      body: personal({ dateOfBirth: young.toISOString().slice(0, 10), cnic: '12345' }),
      jar,
      headers: { 'idempotency-key': key() },
    });
    expect(res.status).toBe(422);
    const paths = res.body.error.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['dateOfBirth', 'cnic']));
  });

  it('refuses a CNIC that is already registered and points to its branch', async () => {
    const first = await registered();
    await call(putLocation, '/api/v1/applicants/me/location', {
      method: 'PUT',
      body: location(khi),
      jar: first.jar,
    });

    const intruder = await signInApplicant(randomPhone());
    const res = await call(register, '/api/v1/applicants/register', {
      method: 'POST',
      body: personal({ cnic: first.cnic }),
      jar: intruder,
      headers: { 'idempotency-key': key() },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('Karachi — Gulshan-e-Iqbal');
    expect(res.body.error.details).toMatchObject({ reason: 'CNIC_TAKEN' });
    expect(JSON.stringify(res.body)).not.toContain('+92');

    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.correlationId, res.body.error.correlation_id));
    expect(audit?.action).toBe('applicant.register_duplicate_cnic');
  });
});

describe('location, branch and profile sections', () => {
  it('suggests the nearest active branch and stores the pin as a geography point', async () => {
    const { jar } = await registered();
    const options = await call(
      branchOptions,
      `/api/v1/applicants/me/branch-options?lat=${KARACHI_HOME.lat}&lng=${KARACHI_HOME.lng}`,
      { jar },
    );
    expect(options.status).toBe(200);
    expect(options.body.data[0]).toMatchObject({ code: 'KHI-GULSHAN' });
    expect(options.body.data[0].distanceM).toBeLessThan(2000);

    const wrongArea = await call(putLocation, '/api/v1/applicants/me/location', {
      method: 'PUT',
      body: { ...location(khi), areaCode: 'LAHORE_JOHAR_TOWN' },
      jar,
    });
    expect(wrongArea.status).toBe(422);

    const saved = await call(putLocation, '/api/v1/applicants/me/location', {
      method: 'PUT',
      body: location(khi),
      jar,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.branch.code).toBe('KHI-GULSHAN');
    expect(saved.body.data.completeness.percent).toBe(40);
    const [stored] = await owner<[{ type: string; lat: number }]>`
      SELECT GeometryType(location::geometry) AS type, ST_Y(location::geometry) AS lat
      FROM applicant_addresses WHERE applicant_id = ${saved.body.data.id}`;
    expect(stored).toMatchObject({ type: 'POINT', lat: KARACHI_HOME.lat });
  });

  it('validates section codes and dates', async () => {
    const { jar } = await registered();
    await call(putLocation, '/api/v1/applicants/me/location', {
      method: 'PUT',
      body: location(khi),
      jar,
    });

    const badSkill = await call(putSkills, '/api/v1/applicants/me/skills', {
      method: 'PUT',
      body: { items: [{ skillCode: 'NOT_A_SKILL', level: 'EXPERT', years: 3 }] },
      jar,
    });
    expect(badSkill.status).toBe(422);
    expect(badSkill.body.error.issues[0].path).toBe('items.0.skillCode');

    const contradiction = await call(putExperience, '/api/v1/applicants/me/experience', {
      method: 'PUT',
      body: {
        hasNoExperience: true,
        items: [
          { employerName: 'ABC', jobTitle: 'Helper', startMonth: '2020-01', isCurrent: true },
        ],
      },
      jar,
    });
    expect(contradiction.status).toBe(422);

    const fresher = await call(putExperience, '/api/v1/applicants/me/experience', {
      method: 'PUT',
      body: { hasNoExperience: true, items: [] },
      jar,
    });
    expect(fresher.body.data.completeness.sections).toContainEqual(
      expect.objectContaining({ id: 'experience', done: true }),
    );

    const [skill] = await db
      .select({ code: schema.masterData.code })
      .from(schema.masterData)
      .where(and(eq(schema.masterData.type, 'SKILL'), eq(schema.masterData.isActive, true)))
      .limit(1);
    const skills = await call(putSkills, '/api/v1/applicants/me/skills', {
      method: 'PUT',
      body: { items: [{ skillCode: skill!.code, level: 'INTERMEDIATE', years: 2 }] },
      jar,
    });
    expect(skills.status).toBe(200);
    expect(skills.body.data.skills).toEqual([
      { skillCode: skill!.code, level: 'INTERMEDIATE', years: 2 },
    ]);

    const [category] = await db
      .select({ code: schema.masterData.code })
      .from(schema.masterData)
      .where(eq(schema.masterData.type, 'JOB_CATEGORY'))
      .limit(1);
    const prefs = await call(putPreferences, '/api/v1/applicants/me/preferences', {
      method: 'PUT',
      body: {
        categoryCodes: [category!.code],
        shifts: ['DAY'],
        jobTypes: ['FULL_TIME'],
        minSalaryPkr: 40000,
      },
      jar,
    });
    expect(prefs.status, JSON.stringify(prefs.body)).toBe(200);
    expect(prefs.body.data.completeness.percent).toBe(20 + 20 + 15 + 10 + 10);
  });
});

describe('documents and activation', () => {
  it('lists upload rules and refuses files that break them', async () => {
    const { jar } = await registered();
    const beforeLocation = await call(presignDoc, '/api/v1/applicants/me/documents', {
      method: 'POST',
      body: { typeCode: 'CNIC_FRONT', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 },
      jar,
    });
    expect(beforeLocation.status).toBe(409);
    await call(putLocation, '/api/v1/applicants/me/location', {
      method: 'PUT',
      body: location(khi),
      jar,
    });

    const types = await call(docTypes, '/api/v1/applicants/me/documents', { jar });
    expect(
      types.body.data.find((t: { code: string }) => t.code === 'CNIC_FRONT').meta,
    ).toMatchObject({
      required: true,
      multiple: false,
    });
    const pdfForCnic = await call(presignDoc, '/api/v1/applicants/me/documents', {
      method: 'POST',
      body: {
        typeCode: 'CNIC_FRONT',
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
      },
      jar,
    });
    expect(pdfForCnic.status).toBe(422);
    const huge = await call(presignDoc, '/api/v1/applicants/me/documents', {
      method: 'POST',
      body: {
        typeCode: 'PHOTO',
        fileName: 'a.png',
        contentType: 'image/png',
        sizeBytes: 3 * 1024 * 1024,
      },
      jar,
    });
    expect(huge.status).toBe(422);

    // Presigned but never uploaded: confirming must fail.
    const ghost = await call(presignDoc, '/api/v1/applicants/me/documents', {
      method: 'POST',
      body: { typeCode: 'CV', fileName: 'cv.pdf', contentType: 'application/pdf', sizeBytes: 100 },
      jar,
    });
    const confirmGhost = await call(
      confirmDoc,
      `/api/v1/applicants/me/documents/${ghost.body.data.documentId}/confirm`,
      { method: 'POST', jar, params: { id: ghost.body.data.documentId } },
    );
    expect(confirmGhost.status).toBe(409);
  });

  it('is ACTIVE from registration and locks the branch once location is set', async () => {
    const { jar, profile } = await registered();
    expect(profile.status).toBe('ACTIVE');
    expect(profile.activatedAt).not.toBeNull();
    expect(profile.branchLocked).toBe(false);
    await call(putLocation, '/api/v1/applicants/me/location', {
      method: 'PUT',
      body: location(khi),
      jar,
    });
    const front = await upload(jar, 'CNIC_FRONT');
    expect(front.profile.status).toBe('ACTIVE');
    expect(front.profile.branchLocked).toBe(true);

    // A re-upload replaces the old front image instead of adding a second one.
    const front2 = await upload(jar, 'CNIC_FRONT');
    expect(
      front2.profile.documents.filter((d: { typeCode: string }) => d.typeCode === 'CNIC_FRONT'),
    ).toHaveLength(1);

    const back = await upload(jar, 'CNIC_BACK');
    expect(back.profile).toMatchObject({ status: 'ACTIVE', branchLocked: true });
    expect(back.profile.activatedAt).not.toBeNull();

    const moveBranch = await call(putLocation, '/api/v1/applicants/me/location', {
      method: 'PUT',
      body: lahoreLocation,
      jar,
    });
    expect(moveBranch.status).toBe(403);

    const required = await call(removeDoc, `/api/v1/applicants/me/documents/${back.documentId}`, {
      method: 'DELETE',
      jar,
      params: { id: back.documentId },
    });
    expect(required.status).toBe(409);
  });

  it('lets applicants pause and resume their profile', async () => {
    const { jar } = await activeApplicant();
    const paused = await call(myStatus, '/api/v1/applicants/me/status', {
      method: 'PATCH',
      body: { status: 'INACTIVE' },
      jar,
    });
    expect(paused.body.data.status).toBe('INACTIVE');
    const resumed = await call(myStatus, '/api/v1/applicants/me/status', {
      method: 'PATCH',
      body: { status: 'ACTIVE' },
      jar,
    });
    expect(resumed.body.data.status).toBe('ACTIVE');
  });
});

describe('staff access', () => {
  it('scopes search and profiles to the branch, and audits denied access', async () => {
    const { profile } = await activeApplicant();
    const khiStaff = await signInWith2fa('staff.khi@jobbank.local');
    const found = await call(
      listApplicants,
      `/api/v1/applicants?q=${profile.personal.cnic.slice(0, 9)}&status=ACTIVE`,
      { jar: khiStaff },
    );
    expect(found.status).toBe(200);
    const row = found.body.data.find((r: { id: string }) => r.id === profile.id);
    expect(row).toMatchObject({
      branchName: 'Karachi — Gulshan-e-Iqbal',
      areaLabel: expect.any(String),
    });
    expect(row.cnicMasked).toContain('•');
    expect(JSON.stringify(found.body)).not.toContain(profile.personal.cnic);

    const lhrStaff = await signInWith2fa('staff.lhr@jobbank.local');
    const denied = await call(getApplicant, `/api/v1/applicants/${profile.id}`, {
      jar: lhrStaff,
      params: { id: profile.id },
    });
    expect(denied.status).toBe(403);
    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.correlationId, denied.body.error.correlation_id));
    expect(audit).toMatchObject({ action: 'access.scope_violation', entityId: profile.id });

    const lhrList = await call(listApplicants, `/api/v1/applicants?q=${profile.personal.cnic}`, {
      jar: lhrStaff,
    });
    expect(lhrList.body.data).toEqual([]);

    const employer = await signInWith2fa('employer@jobbank.local');
    expect((await call(listApplicants, '/api/v1/applicants', { jar: employer })).status).toBe(403);
    expect(
      (
        await call(getApplicant, `/api/v1/applicants/${profile.id}`, {
          jar: employer,
          params: { id: profile.id },
        })
      ).status,
    ).toBe(403);
  });

  it('filters the staff list by city, area, area name and registration date', async () => {
    const staff = await signInWith2fa('staff.khi@jobbank.local');
    // Staff registration (no document upload, so this runs without the S3 dev stack);
    // the address row is inserted directly for the same reason.
    const created = await call(staffRegister, '/api/v1/applicants', {
      method: 'POST',
      body: { ...personal(), phone: randomPhone(), branchId: khi },
      jar: staff,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    await db.insert(schema.applicantAddresses).values({
      applicantId: id,
      addressLine: 'House 12, Block 13-D',
      cityCode: 'KARACHI',
      areaCode: 'KARACHI_GULSHAN_E_IQBAL',
      location: sql`ST_SetSRID(ST_MakePoint(67.0899, 24.9256), 4326)::geography`,
    });
    const find = async (qs: string) =>
      (await call(listApplicants, `/api/v1/applicants?${qs}`, { jar: staff })).body.data as {
        id: string;
      }[];
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

    // City and area filters (the funnel panel exposes these; the API already accepted them).
    expect(ids(await find('cityCode=KARACHI'))).toContain(id);
    expect(ids(await find('cityCode=LAHORE'))).not.toContain(id);
    expect(ids(await find('areaCode=KARACHI_GULSHAN_E_IQBAL'))).toContain(id);
    expect(ids(await find('areaCode=LAHORE_JOHAR_TOWN'))).not.toContain(id);

    // Several values for one filter (sidebar checkboxes): any ticked value matches.
    // The new profile is ACTIVE, never INACTIVE or RESTRICTED.
    expect(ids(await find('status=ACTIVE'))).toContain(id);
    expect(ids(await find('status=INACTIVE&status=RESTRICTED'))).not.toContain(id);
    expect(ids(await find('cityCode=KARACHI&cityCode=LAHORE'))).toContain(id);

    // Free text matches the area label staff see, not just the code.
    expect(ids(await find(`q=${encodeURIComponent('Gulshan')}`))).toContain(id);

    // Registration date: created today (UTC) matches; from tomorrow does not.
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(ids(await find(`createdFrom=${today}&createdTo=${today}`))).toContain(id);
    expect(ids(await find(`createdFrom=${tomorrow}`))).not.toContain(id);

    // Bad dates and a reversed range fail loudly instead of silently returning everything.
    expect(
      (await call(listApplicants, '/api/v1/applicants?createdFrom=not-a-date', { jar: staff }))
        .status,
    ).toBe(422);
    expect(
      (
        await call(
          listApplicants,
          `/api/v1/applicants?createdFrom=${tomorrow}&createdTo=${today}`,
          { jar: staff },
        )
      ).status,
    ).toBe(422);
  });

  it('verifies identity from the CNIC images, audits document views and locks identity fields', async () => {
    const { jar, profile } = await activeApplicant();
    const staff = await signInWith2fa('staff.khi@jobbank.local');
    const front = profile.documents.find((d: { typeCode: string }) => d.typeCode === 'CNIC_FRONT');

    const link = await call(
      staffDocUrl,
      `/api/v1/applicants/${profile.id}/documents/${front.id}/url`,
      {
        jar: staff,
        params: { id: profile.id, docId: front.id },
      },
    );
    expect(link.status).toBe(200);
    const image = await staffDocDownload(
      new Request(`${BASE}/api/v1/applicants/${profile.id}/documents/${front.id}/download`, {
        headers: { cookie: staff.header() },
      }),
      { params: Promise.resolve({ id: profile.id, docId: front.id }) },
    );
    expect(image.status).toBe(200);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
    expect(await latestAudit('applicant.document_view', profile.id)).toMatchObject({
      metadata: { documentId: front.id, typeCode: 'CNIC_FRONT' },
    });

    const rejectWithoutNote = await call(
      verifyIdentity,
      `/api/v1/applicants/${profile.id}/identity-verification`,
      {
        method: 'POST',
        body: { outcome: 'REJECTED', method: 'DOCUMENT_REVIEW' },
        jar: staff,
        params: { id: profile.id },
      },
    );
    expect(rejectWithoutNote.status).toBe(422);

    const verified = await call(
      verifyIdentity,
      `/api/v1/applicants/${profile.id}/identity-verification`,
      {
        method: 'POST',
        body: { outcome: 'VERIFIED', method: 'DOCUMENT_REVIEW' },
        jar: staff,
        params: { id: profile.id },
      },
    );
    expect(verified.status, JSON.stringify(verified.body)).toBe(201);
    expect(verified.body.data).toMatchObject({ identityStatus: 'VERIFIED', identityLocked: true });
    expect(verified.body.data.identityHistory[0]).toMatchObject({
      outcome: 'VERIFIED',
      verifiedByName: 'Sana Staff (Karachi)',
      cnicMatchesCurrent: true,
    });
    expect(
      verified.body.data.documents
        .filter((d: { typeCode: string }) => d.typeCode.startsWith('CNIC_'))
        .map((d: { status: string }) => d.status),
    ).toEqual(['ACCEPTED', 'ACCEPTED']);

    const locked = await call(patchMe, '/api/v1/applicants/me', {
      method: 'PATCH',
      body: { fullName: 'Someone Else' },
      jar,
    });
    expect(locked.status).toBe(403);
    const lockedImage = await call(presignDoc, '/api/v1/applicants/me/documents', {
      method: 'POST',
      body: { typeCode: 'CNIC_FRONT', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 },
      jar,
    });
    expect(lockedImage.status).toBe(403);
    // Round 2: the email must be unique per run — the test DB persists, so
    // the hardcoded address from the first proof run is already taken (409).
    const freshEmail = `ayesha.${crypto.randomUUID().slice(0, 8)}@example.com`;
    const stillEditable = await call(patchMe, '/api/v1/applicants/me', {
      method: 'PATCH',
      body: { email: freshEmail },
      jar,
    });
    expect(stillEditable.status, JSON.stringify(stillEditable.body)).toBe(200);
    expect(stillEditable.body.data.personal.email).toBe(freshEmail);

    // History is evidence: the database refuses to change it.
    await expect(
      owner`UPDATE identity_verifications SET outcome = 'REJECTED' WHERE applicant_id = ${profile.id}`,
    ).rejects.toMatchObject({ code: 'JB001' });

    // A staff correction of an identity field sends the profile back for a new check.
    const corrected = await call(staffPatch, `/api/v1/applicants/${profile.id}`, {
      method: 'PATCH',
      body: { fatherName: 'Imran Ahmed Khan', reason: 'Typo found while checking the card' },
      jar: staff,
      params: { id: profile.id },
    });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(corrected.body.data).toMatchObject({ identityStatus: 'UNVERIFIED' });
    expect(await latestAudit('applicant.staff_update', profile.id)).toMatchObject({
      reason: 'Typo found while checking the card',
    });
  });

  it('moves a profile to a new phone number and ends the old sessions', async () => {
    const { jar, profile } = await activeApplicant();
    const staff = await signInWith2fa('staff.khi@jobbank.local');
    const newPhone = randomPhone();
    // M-21: the new number must prove itself first — request the 6-digit
    // code texted to it, then spend it on the change.
    const codeReq = await call(requestPhoneCode, `/api/v1/applicants/${profile.id}/phone/code`, {
      method: 'POST',
      body: { phone: newPhone },
      jar: staff,
      params: { id: profile.id },
    });
    expect(codeReq.status, JSON.stringify(codeReq.body)).toBe(200);
    const message = [...devOutbox].reverse().find((m) => m.to === newPhone);
    const code = message?.message.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeDefined();
    const changed = await call(changePhone, `/api/v1/applicants/${profile.id}/phone`, {
      method: 'PUT',
      body: { phone: newPhone, reason: 'Lost SIM, verified at the branch', code },
      jar: staff,
      params: { id: profile.id },
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.data.personal.phone).toBe(newPhone);

    expect((await call(getMe, '/api/v1/applicants/me', { jar })).status).toBe(401);
    const fresh = await signInApplicant(newPhone);
    const me = await call(getMe, '/api/v1/applicants/me', { jar: fresh });
    expect(me.body.data.id).toBe(profile.id);
  });

  it('deactivates with a reason, and lets a Super Admin transfer to another branch', async () => {
    const { profile } = await activeApplicant();
    const staff = await signInWith2fa('staff.khi@jobbank.local');
    const noReason = await call(staffStatus, `/api/v1/applicants/${profile.id}/status`, {
      method: 'PATCH',
      body: { status: 'INACTIVE' },
      jar: staff,
      params: { id: profile.id },
    });
    expect(noReason.status).toBe(422);
    const inactive = await call(staffStatus, `/api/v1/applicants/${profile.id}/status`, {
      method: 'PATCH',
      body: { status: 'INACTIVE', reason: 'Unreachable for 3 weeks' },
      jar: staff,
      params: { id: profile.id },
    });
    expect(inactive.body.data).toMatchObject({
      status: 'INACTIVE',
      statusReason: 'Unreachable for 3 weeks',
    });

    // Staff cannot transfer; a Branch Admin cannot move an applicant to a
    // branch outside their own branches (M13, staff.ts) — cross-city moves
    // are a Super Admin's job.
    expect(
      (
        await call(transfer, `/api/v1/applicants/${profile.id}/transfer`, {
          method: 'POST',
          body: { branchId: lhr, reason: 'Moved to Lahore' },
          jar: staff,
          params: { id: profile.id },
        })
      ).status,
    ).toBe(403);
    const branchAdmin = await signInAdmin('branchadmin.khi@jobbank.local');
    const crossCity = await call(transfer, `/api/v1/applicants/${profile.id}/transfer`, {
      method: 'POST',
      body: { branchId: lhr, expectedBranchId: khi, reason: 'Moved to Lahore' },
      jar: branchAdmin,
      params: { id: profile.id },
    });
    expect(crossCity.status, JSON.stringify(crossCity.body)).toBe(403);
    const superAdmin = await signInAdmin('superadmin@jobbank.local');
    const moved = await call(transfer, `/api/v1/applicants/${profile.id}/transfer`, {
      method: 'POST',
      body: { branchId: lhr, expectedBranchId: khi, reason: 'Moved to Lahore' },
      jar: superAdmin,
      params: { id: profile.id },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.data.branch.code).toBe('LHR-JOHAR');

    expect(
      (
        await call(getApplicant, `/api/v1/applicants/${profile.id}`, {
          jar: staff,
          params: { id: profile.id },
        })
      ).status,
    ).toBe(403);
    const lhrStaff = await signInWith2fa('staff.lhr@jobbank.local');
    expect(
      (
        await call(getApplicant, `/api/v1/applicants/${profile.id}`, {
          jar: lhrStaff,
          params: { id: profile.id },
        })
      ).status,
    ).toBe(200);
  });
});
