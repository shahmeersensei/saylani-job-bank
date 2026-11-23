import { schema } from '@jobbank/db';
import { getSeedDevPassword } from '@jobbank/db/seed/dev-data';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as acceptInvite } from '@/app/api/v1/auth/invitations/accept/route';
import { POST as claim } from '@/app/api/v1/companies/[id]/claim/route';
import { PUT as uploadCompanyDoc } from '@/app/api/v1/companies/[id]/documents/[docId]/upload/route';
import { POST as confirmCompanyDoc } from '@/app/api/v1/companies/[id]/documents/[docId]/confirm/route';
import { POST as presignCompanyDoc } from '@/app/api/v1/companies/[id]/documents/route';
import { PATCH as reviewCompanyDoc } from '@/app/api/v1/companies/[id]/documents/[docId]/review/route';
import { POST as setCompanyHeadOffice } from '@/app/api/v1/companies/[id]/head-office/route';
import { POST as requestCompanyInfo } from '@/app/api/v1/companies/[id]/request-info/route';
import { POST as markVerifiedSigned } from '@/app/api/v1/companies/[id]/registration-form/verified-signed/route';
import { GET as getCompany, PATCH as correctCompany } from '@/app/api/v1/companies/[id]/route';
import { POST as onboard } from '@/app/api/v1/companies/onboard/route';
import { POST as verify } from '@/app/api/v1/companies/[id]/verify/route';
import { GET as listCompanies } from '@/app/api/v1/companies/route';
import { POST as inviteRoute } from '@/app/api/v1/users/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { mailOutbox } from '@/lib/mail/mailer';
import {
  BASE,
  call,
  enrollTwoFactor,
  Jar,
  randomPhone,
  signInAdmin,
  uniqueEmail,
} from '@/test/api-client';

const randomNtn = () =>
  `${String(Math.floor(1000000 + Math.random() * 9000000))}-${Math.floor(Math.random() * 10)}`;
let idempotency = 0;
const key = () => `it-verifier-onboard-${Date.now()}-${idempotency++}`;

const branchId = async (code: string) =>
  (
    await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.code, code))
  )[0]!.id;

let khi: string;
let lhr: string;
let verifierJar: Jar;
/** A second in-branch actor: M9 forbids the onboarder marking their own form. */
let colleagueJar: Jar;
/** A second KHI verifier: Branch Admin can no longer onboard companies
 * (Step 2, 2026-11-12), so the "other" company in the list test needs a
 * second verifier, not a Branch Admin. */
let secondVerifierJar: Jar;

const tokenFrom = (text: string) => text.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? '';

/** Invites + activates a verifier through the real flow; returns their session. */
async function inviteAndActivateVerifier(adminJar: Jar) {
  const email = uniqueEmail('verifier');
  const invited = await call(inviteRoute, '/api/v1/users', {
    method: 'POST',
    jar: adminJar,
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: {
      name: 'Second Verifier',
      email,
      title: 'Verification Officer',
      role: 'VERIFIER',
      branchId: khi,
    },
  });
  expect(invited.status, JSON.stringify(invited.body)).toBe(201);
  const mail = [...mailOutbox].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase());
  if (!mail) throw new Error(`no email captured for ${email}`);
  const jar = new Jar();
  const accepted = await call(acceptInvite, '/api/v1/auth/invitations/accept', {
    method: 'POST',
    body: { token: tokenFrom(mail.text), password: getSeedDevPassword() },
    jar,
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  // Verifiers are 2FA-required, so activation returns a setup token instead
  // of a session — enrol here so the caller gets a live session.
  if (accepted.body.data.kind === 'two_factor_setup_required') {
    jar.setupToken = accepted.body.data.setupToken as string;
    await enrollTwoFactor(email, jar);
  }
  return { id: invited.body.data.user.id as string, email, jar };
}

beforeAll(async () => {
  khi = await branchId('KHI-GULSHAN');
  lhr = await branchId('LHR-JOHAR');
  verifierJar = await signInAdmin('verifier.khi@jobbank.local');
  // Round 2: plain signIn cannot pass the 2FA step — other files leave
  // Branch Admin enrolled in the shared DB, so this file must enrol too.
  colleagueJar = await signInAdmin('branchadmin.khi@jobbank.local');
  const superAdmin = await signInAdmin('superadmin@jobbank.local');
  secondVerifierJar = (await inviteAndActivateVerifier(superAdmin)).jar;
});
beforeEach(() => resetMemoryRateLimits());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** Presign → PUT → confirm, mirroring the applicant document upload helper. */
async function uploadCompanyDocument(
  companyId: string,
  jar: Jar,
  typeCode = 'AUTHORISED_PERSON_CNIC_FRONT',
) {
  const presigned = await call(presignCompanyDoc, `/api/v1/companies/${companyId}/documents`, {
    method: 'POST',
    params: { id: companyId },
    body: {
      typeCode,
      fileName: `${typeCode}.png`,
      contentType: 'image/png',
      sizeBytes: PNG.byteLength,
    },
    jar,
  });
  expect(presigned.status, JSON.stringify(presigned.body)).toBe(201);
  const { documentId } = presigned.body.data;
  // Same-origin upload: the bytes go to the app's upload route, which stores
  // them — the browser (and this test) never talks to storage directly.
  const stored = await uploadCompanyDoc(
    new Request(`${BASE}/api/v1/companies/${companyId}/documents/${documentId}/upload`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', cookie: jar.header() },
      body: PNG,
    }),
    { params: Promise.resolve({ id: companyId, docId: documentId }) },
  );
  expect(stored.status).toBe(200);
  const confirmed = await call(
    confirmCompanyDoc,
    `/api/v1/companies/${companyId}/documents/${documentId}/confirm`,
    { method: 'POST', jar, params: { id: companyId, docId: documentId } },
  );
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return documentId;
}

/** Full field-visit form: company details, contact person, outreach, notes. */
const onboardBody = (overrides: Record<string, unknown> = {}) => ({
  branchId: khi,
  legalName: 'Verifier Onboard Test Textiles',
  legalStructure: 'PRIVATE_LIMITED',
  ntn: randomNtn(),
  industryCode: 'MANUFACTURING',
  sizeBand: '11_50',
  contactName: 'Bilal Contact',
  contactDesignation: 'HR Manager',
  contactPhone: randomPhone(),
  visitDate: new Date().toISOString().slice(0, 10),
  headOfficeAddress: 'Plot 12, SITE Area, Karachi',
  workforceRoles: 'Machine operators',
  additionalNotes: 'Met the HR manager on site.',
  ...overrides,
});

async function onboardedCompany(overrides: Record<string, unknown> = {}) {
  const res = await call(onboard, '/api/v1/companies/onboard', {
    method: 'POST',
    body: onboardBody(overrides),
    jar: verifierJar,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const company = res.body.data as { id: string; status: string };
  // N15: marking the form verified & signed requires at least one required
  // document. Upload the authorised person's CNIC front first; the rule
  // itself is unchanged. M9: the onboarder cannot upload their own
  // company's documents (409 SELF_ATTESTATION) — a colleague in the
  // branch uploads them, same as markVerifiedSigned below.
  const documentId = await uploadCompanyDocument(company.id, colleagueJar);
  return { ...company, documentId };
}

describe('verifier creates companies', () => {
  it('onboards a company with company, contact-person and outreach details', async () => {
    const res = await call(onboard, '/api/v1/companies/onboard', {
      method: 'POST',
      body: onboardBody(),
      jar: verifierJar,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.details.legalName).toBe('Verifier Onboard Test Textiles');
    expect(res.body.data.contacts[0].name).toBe('Bilal Contact');
    expect(res.body.data.onboarding.onboardedBy.roleLabel).toBe('Verification Officer');
    expect(res.body.data.onboarding.notes.headOfficeAddress).toBe('Plot 12, SITE Area, Karachi');
  });

  it('marks it verified & signed and it reaches the queue as SUBMITTED', async () => {
    const company = await onboardedCompany();
    // M9: the onboarder cannot mark their own paper form — a colleague in
    // the branch records it.
    const res = await call(
      markVerifiedSigned,
      `/api/v1/companies/${company.id}/registration-form/verified-signed`,
      { method: 'POST', jar: colleagueJar, params: { id: company.id } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.verifiedSigned).toBe(true);
    expect(res.body.data.status).toBe('SUBMITTED');
  });

  it('verifier can no longer claim or verify a company they onboarded', async () => {
    const company = await onboardedCompany();
    // 2026-11-14: company:verify moved to Branch Admin. The verifier who
    // registered the company gets 403 on both the old claim step and verify.
    const claimRes = await call(claim, `/api/v1/companies/${company.id}/claim`, {
      method: 'POST',
      jar: verifierJar,
      params: { id: company.id },
      headers: { 'Idempotency-Key': key() },
    });
    expect(claimRes.status, JSON.stringify(claimRes.body)).toBe(403);
    const verifyRes = await call(verify, `/api/v1/companies/${company.id}/verify`, {
      method: 'POST',
      body: { note: null },
      jar: verifierJar,
      params: { id: company.id },
      headers: { 'Idempotency-Key': key() },
    });
    expect(verifyRes.status, JSON.stringify(verifyRes.body)).toBe(403);
  });

  it('Branch Admin verifies a company the verifier onboarded', async () => {
    const onboarded = await call(onboard, '/api/v1/companies/onboard', {
      method: 'POST',
      body: onboardBody(),
      jar: verifierJar,
    });
    expect(onboarded.status, JSON.stringify(onboarded.body)).toBe(201);
    const companyId = onboarded.body.data.id as string;
    const res = await call(verify, `/api/v1/companies/${companyId}/verify`, {
      method: 'POST',
      body: { note: null },
      jar: colleagueJar,
      params: { id: companyId },
      headers: { 'Idempotency-Key': key() },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('VERIFIED');
    expect(res.body.data.registrationVerifiedSignedAt).not.toBeNull();
    expect(res.body.data.registrationVerifiedSignedBy).not.toBeNull();
  });

  it('returns an info-requested company to the Branch Admin for final signed approval', async () => {
    const company = await onboardedCompany();
    const backDocumentId = await uploadCompanyDocument(
      company.id,
      colleagueJar,
      'AUTHORISED_PERSON_CNIC_BACK',
    );
    const headOffice = await call(
      setCompanyHeadOffice,
      `/api/v1/companies/${company.id}/head-office`,
      {
        method: 'POST',
        body: {
          location: { lat: 24.8607, lng: 67.0011 },
          addressLine: 'Plot 12, SITE Area, Karachi',
          cityCode: 'KARACHI',
        },
        jar: colleagueJar,
        params: { id: company.id },
      },
    );
    expect(headOffice.status, JSON.stringify(headOffice.body)).toBe(200);

    const requested = await call(
      requestCompanyInfo,
      `/api/v1/companies/${company.id}/request-info`,
      {
        method: 'POST',
        body: { note: 'Please confirm the head office address and required documents.' },
        jar: colleagueJar,
        params: { id: company.id },
        headers: { 'Idempotency-Key': key() },
      },
    );
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    expect(requested.body.data.status).toBe('INFO_REQUESTED');

    const corrected = await call(correctCompany, `/api/v1/companies/${company.id}`, {
      method: 'PATCH',
      body: {
        tradeName: 'Updated by Verifier',
        reason: 'Completed the details requested by the Branch Admin.',
      },
      jar: secondVerifierJar,
      params: { id: company.id },
      headers: { 'Idempotency-Key': key() },
    });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(corrected.body.data.status).toBe('RESUBMITTED');
    expect(corrected.body.data.details.tradeName).toBe('Updated by Verifier');

    const returned = await call(getCompany, `/api/v1/companies/${company.id}`, {
      method: 'GET',
      jar: colleagueJar,
      params: { id: company.id },
    });
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    expect(returned.body.data.status).toBe('RESUBMITTED');

    const branchAdminQueue = await call(listCompanies, '/api/v1/companies?status=RESUBMITTED', {
      method: 'GET',
      jar: colleagueJar,
    });
    expect(branchAdminQueue.status, JSON.stringify(branchAdminQueue.body)).toBe(200);
    expect((branchAdminQueue.body.data.items as { id: string }[]).map((item) => item.id)).toContain(
      company.id,
    );

    for (const documentId of [company.documentId, backDocumentId]) {
      const accepted = await call(
        reviewCompanyDoc,
        `/api/v1/companies/${company.id}/documents/${documentId}/review`,
        {
          method: 'PATCH',
          body: { decision: 'ACCEPTED', note: null },
          jar: colleagueJar,
          params: { id: company.id, docId: documentId },
          headers: { 'Idempotency-Key': key() },
        },
      );
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    }

    const approved = await call(verify, `/api/v1/companies/${company.id}/verify`, {
      method: 'POST',
      body: { note: null },
      jar: colleagueJar,
      params: { id: company.id },
      headers: { 'Idempotency-Key': key() },
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.status).toBe('VERIFIED');
    expect(approved.body.data.registrationVerifiedSignedAt).not.toBeNull();
    expect(approved.body.data.registrationVerifiedSignedBy).not.toBeNull();
  });

  it('returns the verifier response even when the Branch Admin may need more information', async () => {
    const company = await onboardedCompany();
    const requested = await call(
      requestCompanyInfo,
      `/api/v1/companies/${company.id}/request-info`,
      {
        method: 'POST',
        body: { note: 'Please update the company details.' },
        jar: colleagueJar,
        params: { id: company.id },
        headers: { 'Idempotency-Key': key() },
      },
    );
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);

    const corrected = await call(correctCompany, `/api/v1/companies/${company.id}`, {
      method: 'PATCH',
      body: {
        tradeName: 'Updated before completing every requirement',
        reason: 'Updated the company details requested by the Branch Admin.',
      },
      jar: secondVerifierJar,
      params: { id: company.id },
      headers: { 'Idempotency-Key': key() },
    });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(corrected.body.data.status).toBe('RESUBMITTED');

    const branchAdminQueue = await call(listCompanies, '/api/v1/companies?status=RESUBMITTED', {
      method: 'GET',
      jar: colleagueJar,
    });
    expect(branchAdminQueue.status, JSON.stringify(branchAdminQueue.body)).toBe(200);
    expect((branchAdminQueue.body.data.items as { id: string }[]).map((item) => item.id)).toContain(
      company.id,
    );

    const accepted = await call(verify, `/api/v1/companies/${company.id}/verify`, {
      method: 'POST',
      body: { note: null },
      jar: colleagueJar,
      params: { id: company.id },
      headers: { 'Idempotency-Key': key() },
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.data.status).toBe('VERIFIED');
  });

  it('Branch Admin cannot verify a company assigned to another branch', async () => {
    const onboarded = await call(onboard, '/api/v1/companies/onboard', {
      method: 'POST',
      body: onboardBody(),
      jar: verifierJar,
    });
    expect(onboarded.status, JSON.stringify(onboarded.body)).toBe(201);
    const companyId = onboarded.body.data.id as string;
    await db
      .update(schema.companies)
      .set({ branchId: lhr })
      .where(eq(schema.companies.id, companyId));

    const res = await call(verify, `/api/v1/companies/${companyId}/verify`, {
      method: 'POST',
      body: { note: null },
      jar: colleagueJar,
      params: { id: companyId },
      headers: { 'Idempotency-Key': key() },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('sees every company in their city in the company list', async () => {
    const mine = await onboardedCompany();
    // Branch Admin can no longer onboard companies (Step 2), so the other
    // company is onboarded by the second KHI verifier instead.
    const otherRes = await call(onboard, '/api/v1/companies/onboard', {
      method: 'POST',
      body: onboardBody({ legalName: 'Second Verifier Onboard Test Foods' }),
      jar: secondVerifierJar,
    });
    expect(otherRes.status, JSON.stringify(otherRes.body)).toBe(201);
    const res = await call(listCompanies, '/api/v1/companies', {
      method: 'GET',
      jar: verifierJar,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.data.items as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(mine.id);
    // Round 3: verifiers hold company:manage (Nov 8 "verifiers manage
    // companies" model, permissions.test.ts), so the createdBy scope does
    // not apply to them — the list is city-scoped, and a colleague's
    // Karachi company is visible too.
    expect(ids).toContain(otherRes.body.data.id);
  });
});
