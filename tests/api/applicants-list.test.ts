import { describe, expect, it, beforeAll } from '@jest/globals';
import { schema } from '@jobbank/db';
import { HEADERS } from '@jobbank/shared';
import { GET as listApplicants } from '@/app/api/v1/applicants/route';
import { POST as register } from '@/app/api/v1/applicants/register/route';
import { PUT as putLocation } from '@/app/api/v1/applicants/me/location/route';
import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  Jar,
  bodyOf,
  call,
  clearRateLimits,
  errorOf,
  latestOtpCode,
  otpRequestRoute,
  otpVerifyRoute,
  signIn,
} from './helpers';

const KHI_HOME = { lat: 24.9256, lng: 67.0899 };
const PATH = '/api/v1/applicants';

let idempotency = 0;
const key = () => `jest-list-${Date.now()}-${idempotency++}`;
const randomCnic = () => `42${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;
const randomPhone = () => `+92345${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

interface ListRow {
  id: string;
  fullName: string;
  cnicMasked: string;
  phoneMasked: string | null;
  status: string;
  identityStatus: string;
  profileCompleteness: number;
  branchName: string | null;
  cityLabel: string | null;
  areaLabel: string | null;
  createdAt: string;
}

let applicantJar: Jar;
let applicantCnic: string;
let applicantPhone: string;
let applicantId: string;
let branchIds: Record<string, string>;

async function signUpApplicant(phone: string): Promise<Jar> {
  await clearRateLimits(['otp-resend', phone], ['otp-phone', phone]);
  const requested = await call(otpRequestRoute, '/api/v1/auth/otp/request', {
    method: 'POST',
    body: { phone },
  });
  expect(requested.status).toBe(202);
  const verified = await call(otpVerifyRoute, '/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { phone, code: latestOtpCode(phone) },
  });
  expect(verified.status).toBe(200);
  return new Jar().absorb(verified);
}

beforeAll(async () => {
  const branches = await db
    .select({ id: schema.branches.id, code: schema.branches.code })
    .from(schema.branches);
  branchIds = Object.fromEntries(branches.map((b) => [b.code, b.id]));

  applicantPhone = randomPhone();
  applicantCnic = randomCnic();
  applicantJar = await signUpApplicant(applicantPhone);

  const created = await call(register, '/api/v1/applicants/register', {
    method: 'POST',
    body: {
      fullName: 'Jest List Applicant',
      fatherName: 'Jest List Father',
      cnic: applicantCnic,
      dateOfBirth: '1995-04-12',
      gender: 'MALE',
    },
    headers: { [HEADERS.idempotencyKey]: key() },
    jar: applicantJar,
  });
  expect(created.status).toBe(201);
  applicantId = (await bodyOf<{ data: { id: string } }>(created)).data.id;

  const located = await call(putLocation, '/api/v1/applicants/me/location', {
    method: 'PUT',
    body: {
      location: KHI_HOME,
      addressLine: 'House 12, Block 13-D',
      cityCode: 'KARACHI',
      areaCode: 'KARACHI_GULSHAN_E_IQBAL',
      branchId: branchIds['KHI-GULSHAN'],
    },
    jar: applicantJar,
  });
  expect(located.status).toBe(200);
}, 60_000);

describe('GET /api/v1/applicants — authentication and authorisation', () => {
  it('refuses anonymous callers with 401 UNAUTHENTICATED', async () => {
    const response = await call(listApplicants, PATH);
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe('UNAUTHENTICATED');
  });

  it('refuses an EMPLOYER, who has no applicant:read permission', async () => {
    const { jar } = await signIn('employer@jobbank.local');
    const response = await call(listApplicants, PATH, { jar });
    expect(response.status).toBe(403);
    const error = await errorOf(response);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.details?.reason).toBeUndefined();
  });

  it('refuses the applicant, who may only read their own profile', async () => {
    const response = await call(listApplicants, PATH, { jar: applicantJar });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('FORBIDDEN');
  });

  it('refuses a Super Admin who has not enrolled 2FA yet', async () => {
    const { jar } = await signIn('superadmin@jobbank.local');
    const response = await call(listApplicants, PATH, { jar });
    expect(response.status).toBe(403);
    const error = await errorOf(response);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.details?.reason).toBe('TWO_FACTOR_SETUP_REQUIRED');
  });
});

describe('GET /api/v1/applicants — list query validation', () => {
  it('answers 422 with issues for an unknown query parameter', async () => {
    const { jar } = await signIn('staff.khi@jobbank.local');
    const response = await call(listApplicants, `${PATH}?branch=1`, { jar });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(error.issues)).toBe(true);
    const issue = (error.issues as Array<{ path: string; message: string }>)[0]!;
    expect(issue.path).toBe('(root)');
    expect(issue.message).toContain('branch');
  });

  it('answers 422 when the sort field is not whitelisted', async () => {
    const { jar } = await signIn('staff.khi@jobbank.local');
    const response = await call(listApplicants, `${PATH}?sort=cnic:asc`, { jar });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect((error.issues as Array<{ path: string; message: string }>)[0]).toMatchObject({
      path: 'sort',
    });
  });

  it('answers 422 when a filter value is not a known status', async () => {
    const { jar } = await signIn('staff.khi@jobbank.local');
    const response = await call(listApplicants, `${PATH}?status=SUSPENDED`, { jar });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect((error.issues as Array<{ path: string }>).map((i) => i.path)).toContain('status');
  });
});

describe('GET /api/v1/applicants — search', () => {
  it('lets branch staff find their applicant with a masked CNIC only', async () => {
    const { jar } = await signIn('staff.khi@jobbank.local');
    const response = await call(
      listApplicants,
      `${PATH}?q=${applicantCnic.slice(0, 9)}&status=DRAFT`,
      { jar },
    );
    expect(response.status).toBe(200);
    const body = await bodyOf<{ data: ListRow[]; meta: Record<string, number> }>(response);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 20 });
    expect(body.meta.total).toBeGreaterThanOrEqual(1);

    const row = body.data.find((r) => r.id === applicantId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      fullName: 'Jest List Applicant',
      status: 'DRAFT',
      identityStatus: 'UNVERIFIED',
      branchName: 'Karachi — Gulshan-e-Iqbal',
      cityLabel: 'Karachi',
      areaLabel: 'Gulshan-e-Iqbal',
      phoneMasked: expect.stringContaining('•'),
    });
    expect(row!.cnicMasked).toContain('•');
    expect(row!.cnicMasked).not.toBe(applicantCnic);
    expect(row!.profileCompleteness).toBeGreaterThanOrEqual(40);
    expect(JSON.stringify(body)).not.toContain(applicantCnic);
  });

  it('paginates with a page size of one', async () => {
    const { jar } = await signIn('staff.khi@jobbank.local');
    const response = await call(listApplicants, `${PATH}?q=${applicantCnic}&pageSize=1&page=1`, {
      jar,
    });
    expect(response.status).toBe(200);
    const body = await bodyOf<{ data: ListRow[]; meta: Record<string, number> }>(response);
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 1, total: 1, pageCount: 1 });
  });

  it('returns an empty page for a CNIC another branch is searching for', async () => {
    const { jar } = await signIn('staff.lhr@jobbank.local');
    const response = await call(listApplicants, `${PATH}?q=${applicantCnic}`, { jar });
    expect(response.status).toBe(200);
    const body = await bodyOf<{ data: ListRow[]; meta: { total: number } }>(response);
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it('refuses a branch filter outside the caller’s scope', async () => {
    const { jar } = await signIn('staff.lhr@jobbank.local');
    const response = await call(listApplicants, `${PATH}?branchId=${branchIds['KHI-GULSHAN']}`, {
      jar,
    });
    expect(response.status).toBe(403);
    const error = await errorOf(response);
    expect(error.code).toBe('SCOPE_VIOLATION');
  });
});
