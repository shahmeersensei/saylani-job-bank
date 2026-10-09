import { describe, expect, it, beforeAll } from '@jest/globals';
import { schema } from '@jobbank/db';
import { HEADERS } from '@jobbank/shared';
import { POST as register } from '@/app/api/v1/applicants/register/route';
import { PUT as putLocation } from '@/app/api/v1/applicants/me/location/route';
import { DELETE as removeDocument } from '@/app/api/v1/applicants/me/documents/[id]/route';
import { POST as confirmDocument } from '@/app/api/v1/applicants/me/documents/[id]/confirm/route';
import { GET as documentUrl } from '@/app/api/v1/applicants/me/documents/[id]/url/route';
import {
  GET as documentTypes,
  POST as presignDocument,
} from '@/app/api/v1/applicants/me/documents/route';
import { db } from '@/lib/db';
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
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 1, 2, 3, 4]);

const TYPES_PATH = '/api/v1/applicants/me/documents';

let keySeq = 0;
const key = () => `jest-docs-${Date.now()}-${keySeq++}`;
const randomCnic = () => `42${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;
const randomPhone = () => `+92345${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

interface DocumentType {
  code: string;
  label: string;
  isActive: boolean;
  meta: { required: boolean; multiple: boolean; mimeTypes: string[]; maxSizeMb: number };
}

interface PresignBody {
  data: {
    documentId: string;
    upload: { url: string; method: string; headers: Record<string, string> };
  };
}

let branchIds: Record<string, string>;
/** Registered + located in Karachi, so uploads are allowed. */
let jar: Jar;
let myApplicantId: string;
/** Document that was really uploaded and confirmed. */
let uploadedCnicId: string;
/** Registered but without a location branch ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â uploads must be refused. */
let noBranchJar: Jar;

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

async function registerApplicant(session: Jar): Promise<string> {
  const response = await call(register, '/api/v1/applicants/register', {
    method: 'POST',
    body: {
      fullName: 'Jest Document Applicant',
      fatherName: 'Jest Document Father',
      cnic: randomCnic(),
      dateOfBirth: '1994-07-03',
      gender: 'FEMALE',
    },
    headers: { [HEADERS.idempotencyKey]: key() },
    jar: session,
  });
  expect(response.status).toBe(201);
  return (await bodyOf<{ data: { id: string } }>(response)).data.id;
}

/** Presign ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ upload the bytes to the presigned URL ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ confirm. Returns the document id. */
async function upload(
  session: Jar,
  typeCode: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<string> {
  const presigned = await call(presignDocument, TYPES_PATH, {
    method: 'POST',
    body: { typeCode, fileName: `${typeCode}.bin`, contentType, sizeBytes: bytes.byteLength },
    jar: session,
  });
  expect(presigned.status).toBe(201);
  const presignBody = await bodyOf<PresignBody>(presigned);
  const { documentId, upload: put } = presignBody.data;
  const stored = await fetch(put.url, {
    method: put.method,
    headers: put.headers,
    body: bytes,
  });
  expect(stored.status).toBe(200);
  const confirmed = await call(confirmDocument, `${TYPES_PATH}/${documentId}/confirm`, {
    method: 'POST',
    jar: session,
    params: { id: documentId },
  });
  expect(confirmed.status).toBe(200);
  return documentId;
}

beforeAll(async () => {
  const branches = await db
    .select({ id: schema.branches.id, code: schema.branches.code })
    .from(schema.branches);
  branchIds = Object.fromEntries(branches.map((b) => [b.code, b.id]));

  jar = await signUpApplicant(randomPhone());
  myApplicantId = await registerApplicant(jar);
  const located = await call(putLocation, '/api/v1/applicants/me/location', {
    method: 'PUT',
    body: {
      location: KHI_HOME,
      addressLine: 'House 4, Block 13-D',
      cityCode: 'KARACHI',
      areaCode: 'KARACHI_GULSHAN_E_IQBAL',
      branchId: branchIds['KHI-GULSHAN'],
    },
    jar,
  });
  expect(located.status).toBe(200);

  noBranchJar = await signUpApplicant(randomPhone());
  await registerApplicant(noBranchJar);
}, 60_000);

describe('GET /api/v1/applicants/me/documents ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â upload rules', () => {
  it('refuses anonymous callers with 401 UNAUTHENTICATED', async () => {
    const response = await call(documentTypes, TYPES_PATH);
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe('UNAUTHENTICATED');
  });

  it('refuses a STAFF caller, who has no applicant:self permission', async () => {
    const { jar: staff } = await signIn('staff.khi@jobbank.local');
    const response = await call(documentTypes, TYPES_PATH, { jar: staff });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('FORBIDDEN');
  });

  it('lists the active applicant document types with their rules', async () => {
    const response = await call(documentTypes, TYPES_PATH, { jar });
    expect(response.status).toBe(200);
    const body = await bodyOf<{ data: DocumentType[] }>(response);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.every((t) => t.isActive)).toBe(true);
    const front = body.data.find((t) => t.code === 'CNIC_FRONT');
    expect(front?.meta).toMatchObject({ required: true, multiple: false, maxSizeMb: 5 });
    expect(front?.meta.mimeTypes).toEqual(expect.arrayContaining(['image/png', 'image/jpeg']));
    const cv = body.data.find((t) => t.code === 'CV');
    expect(cv?.meta).toMatchObject({ required: false });
    expect(body.data.find((t) => t.code === 'AUTHORISED_PERSON_CNIC')).toBeUndefined();
  });
});

describe('POST /api/v1/applicants/me/documents ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â presigned upload', () => {
  it('refuses anonymous callers with 401 UNAUTHENTICATED', async () => {
    const response = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: { typeCode: 'CV', fileName: 'cv.pdf', contentType: 'application/pdf', sizeBytes: 10 },
    });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe('UNAUTHENTICATED');
  });

  it('refuses a STAFF caller, who has no applicant:self permission', async () => {
    const { jar: staff } = await signIn('staff.khi@jobbank.local');
    const response = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: { typeCode: 'CV', fileName: 'cv.pdf', contentType: 'application/pdf', sizeBytes: 10 },
      jar: staff,
    });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('FORBIDDEN');
  });

  it('answers 422 with issues for a malformed document payload', async () => {
    const response = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: { typeCode: 'CNIC_FRONT', fileName: '', contentType: 'text/plain', sizeBytes: 0 },
      jar,
    });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(error.issues)).toBe(true);
    const paths = (error.issues as Array<{ path: string }>).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['fileName', 'contentType', 'sizeBytes']));
  });

  it('refuses uploads before a branch is chosen', async () => {
    const response = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: {
        typeCode: 'CNIC_FRONT',
        fileName: 'cnic.png',
        contentType: 'image/png',
        sizeBytes: 12,
      },
      jar: noBranchJar,
    });
    expect(response.status).toBe(409);
    const error = await errorOf(response);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toContain('home location and branch');
  });

  it('refuses a file type the document type does not allow', async () => {
    const response = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: {
        typeCode: 'CNIC_FRONT',
        fileName: 'cnic.pdf',
        contentType: 'application/pdf',
        sizeBytes: 12,
      },
      jar,
    });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect((error.issues as Array<{ path: string }>)[0]!.path).toBe('file');
  });

  it('refuses a document type that does not exist', async () => {
    const response = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: {
        typeCode: 'NOT_A_DOC_TYPE',
        fileName: 'x.png',
        contentType: 'image/png',
        sizeBytes: 12,
      },
      jar,
    });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect((error.issues as Array<{ path: string }>)[0]!.path).toBe('typeCode');
  });

  it('returns a presigned PUT the browser can use', async () => {
    const response = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: {
        typeCode: 'CNIC_FRONT',
        fileName: 'cnic.png',
        contentType: 'image/png',
        sizeBytes: PNG.byteLength,
      },
      jar,
    });
    expect(response.status).toBe(201);
    const body = await bodyOf<PresignBody>(response);
    expect(body.data.documentId).toBeTruthy();
    expect(body.data.upload.method).toBe('PUT');
    expect(body.data.upload.url).toContain('http');
    expect(body.data.upload.headers['Content-Type']).toBe('image/png');
  });
});

describe('POST /api/v1/applicants/me/documents/{id}/confirm', () => {
  it('answers 422 for a path parameter that is not a uuid', async () => {
    const response = await call(confirmDocument, `${TYPES_PATH}/not-a-uuid/confirm`, {
      method: 'POST',
      jar,
      params: { id: 'not-a-uuid' },
    });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect((error.issues as Array<{ path: string }>)[0]!.path).toBe('id');
  });

  it('answers 404 for a document that does not exist', async () => {
    const missing = '11111111-2222-4333-8444-555555555555';
    const response = await call(confirmDocument, `${TYPES_PATH}/${missing}/confirm`, {
      method: 'POST',
      jar,
      params: { id: missing },
    });
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe('NOT_FOUND');
  });

  it('answers 409 when the file never landed in storage', async () => {
    const ghost = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: {
        typeCode: 'CV',
        fileName: 'cv.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.byteLength,
      },
      jar,
    });
    expect(ghost.status).toBe(201);
    const ghostBody = await bodyOf<PresignBody>(ghost);
    const { documentId } = ghostBody.data;
    const confirmed = await call(confirmDocument, `${TYPES_PATH}/${documentId}/confirm`, {
      method: 'POST',
      jar,
      params: { id: documentId },
    });
    expect(confirmed.status).toBe(409);
    expect((await errorOf(confirmed)).message).toContain('did not receive the file');
  });

  it('confirms a real upload and marks the document as uploaded', async () => {
    const presigned = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: {
        typeCode: 'CNIC_FRONT',
        fileName: 'cnic.png',
        contentType: 'image/png',
        sizeBytes: PNG.byteLength,
      },
      jar,
    });
    expect(presigned.status).toBe(201);
    const { documentId, upload: put } = (await bodyOf<PresignBody>(presigned)).data;
    const stored = await fetch(put.url, { method: 'PUT', headers: put.headers, body: PNG });
    expect(stored.status).toBe(200);

    const confirmed = await call(confirmDocument, `${TYPES_PATH}/${documentId}/confirm`, {
      method: 'POST',
      jar,
      params: { id: documentId },
    });
    expect(confirmed.status).toBe(200);
    const body = await bodyOf<{
      data: { documents: Array<{ id: string; typeCode: string; status: string }> };
    }>(confirmed);
    const doc = body.data.documents.find((d) => d.id === documentId);
    expect(doc).toMatchObject({ typeCode: 'CNIC_FRONT', status: 'UPLOADED' });
    uploadedCnicId = documentId;
  }, 30_000);
});

describe('GET /api/v1/applicants/me/documents/{id}/url', () => {
  it('refuses anonymous callers with 401 UNAUTHENTICATED', async () => {
    const response = await call(documentUrl, `${TYPES_PATH}/any/url`, {
      params: { id: '11111111-2222-4333-8444-555555555555' },
    });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe('UNAUTHENTICATED');
  });

  it('refuses a STAFF caller, who has no applicant:self permission', async () => {
    const { jar: staff } = await signIn('staff.khi@jobbank.local');
    const response = await call(documentUrl, `${TYPES_PATH}/any/url`, {
      jar: staff,
      params: { id: '11111111-2222-4333-8444-555555555555' },
    });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('FORBIDDEN');
  });

  it('answers 404 when another applicantÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s document is requested', async () => {
    // The second applicant is located, so they can presign a document of their own.
    const located = await call(putLocation, '/api/v1/applicants/me/location', {
      method: 'PUT',
      body: {
        location: KHI_HOME,
        addressLine: 'House 9, Block 13-D',
        cityCode: 'KARACHI',
        areaCode: 'KARACHI_GULSHAN_E_IQBAL',
        branchId: branchIds['KHI-GULSHAN'],
      },
      jar: noBranchJar,
    });
    expect(located.status).toBe(200);
    const mine = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: {
        typeCode: 'CV',
        fileName: 'cv.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.byteLength,
      },
      jar: noBranchJar,
    });
    expect(mine.status).toBe(201);
    const mineBody = await bodyOf<PresignBody>(mine);
    const { documentId } = mineBody.data;

    const response = await call(documentUrl, `${TYPES_PATH}/${documentId}/url`, {
      jar,
      params: { id: documentId },
    });
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe('NOT_FOUND');
  });

  it('answers 409 while the upload is still pending', async () => {
    const pending = await call(presignDocument, TYPES_PATH, {
      method: 'POST',
      body: {
        typeCode: 'CV',
        fileName: 'cv.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.byteLength,
      },
      jar,
    });
    expect(pending.status).toBe(201);
    const { documentId } = (await bodyOf<PresignBody>(pending)).data;
    const response = await call(documentUrl, `${TYPES_PATH}/${documentId}/url`, {
      jar,
      params: { id: documentId },
    });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).message).toContain('not completed');
  });

  it('issues a short-lived link to a completed upload', async () => {
    const before = Date.now();
    const response = await call(documentUrl, `${TYPES_PATH}/${uploadedCnicId}/url`, {
      jar,
      params: { id: uploadedCnicId },
    });
    expect(response.status).toBe(200);
    const body = await bodyOf<{ data: { url: string; expiresAt: string } }>(response);
    expect(typeof body.data.url).toBe('string');
    expect(body.data.url).toContain('http');
    const expiresAt = Date.parse(body.data.expiresAt);
    expect(Number.isNaN(expiresAt)).toBe(false);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 100_000);
    expect(expiresAt).toBeLessThanOrEqual(before + 150_000);
  });
});

describe('DELETE /api/v1/applicants/me/documents/{id}', () => {
  it('refuses anonymous callers with 401 UNAUTHENTICATED', async () => {
    const response = await call(
      removeDocument,
      `${TYPES_PATH}/11111111-2222-4333-8444-555555555555`,
      {
        method: 'DELETE',
        params: { id: '11111111-2222-4333-8444-555555555555' },
      },
    );
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe('UNAUTHENTICATED');
  });

  it('answers 422 for a path parameter that is not a uuid', async () => {
    const response = await call(removeDocument, `${TYPES_PATH}/nope`, {
      method: 'DELETE',
      jar,
      params: { id: 'nope' },
    });
    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('VALIDATION_FAILED');
  });

  it('answers 404 for a document that does not exist', async () => {
    const missing = '99999999-8888-4777-8666-555555555555';
    const response = await call(removeDocument, `${TYPES_PATH}/${missing}`, {
      method: 'DELETE',
      jar,
      params: { id: missing },
    });
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe('NOT_FOUND');
  });

  it('refuses to remove a required document', async () => {
    const required = await upload(jar, 'CNIC_FRONT', 'image/png', PNG);
    const response = await call(removeDocument, `${TYPES_PATH}/${required}`, {
      method: 'DELETE',
      jar,
      params: { id: required },
    });
    expect(response.status).toBe(409);
    const error = await errorOf(response);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toContain('Required documents');
  }, 30_000);

  it('removes an optional document from the current list', async () => {
    const optional = await upload(jar, 'CV', 'application/pdf', PDF);
    const response = await call(removeDocument, `${TYPES_PATH}/${optional}`, {
      method: 'DELETE',
      jar,
      params: { id: optional },
    });
    expect(response.status).toBe(200);
    const body = await bodyOf<{ data: { id: string; documents: Array<{ id: string }> } }>(response);
    expect(body.data.id).toBe(myApplicantId);
    expect(body.data.documents.find((d) => d.id === optional)).toBeUndefined();
  }, 30_000);
});
