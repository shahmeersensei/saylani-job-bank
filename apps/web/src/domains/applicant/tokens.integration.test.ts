import { schema } from '@jobbank/db';
import { tokenExpiresAt } from '@jobbank/shared';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as lookupTokens, POST as issueToken } from '@/app/api/v1/applicants/tokens/route';
import { POST as cancelToken } from '@/app/api/v1/applicants/tokens/[id]/cancel/route';
import { POST as staffRegister } from '@/app/api/v1/applicants/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { call, owner, randomPhone, signInWith2fa, type Jar } from '@/test/api-client';

const randomCnic = () => `42${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;

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

beforeAll(async () => {
  khi = await branchId('KHI-GULSHAN');
  lhr = await branchId('LHR-JOHAR');
  staffJar = await signInWith2fa('staff.khi@jobbank.local');
});
beforeEach(() => resetMemoryRateLimits());

async function issue(branchId: string, cnic: string, jar = staffJar) {
  return call(issueToken, '/api/v1/applicants/tokens', {
    method: 'POST',
    body: { branchId, cnic, applicantName: 'Ahmed Raza', phone: randomPhone() },
    // N7: the route is idempotent — every issue carries a fresh key.
    headers: { 'idempotency-key': crypto.randomUUID() },
    jar,
  });
}

async function lookup(path: string, jar = staffJar) {
  return call(lookupTokens, `/api/v1/applicants/tokens${path}`, { jar });
}

describe('first-counter applicant tokens', () => {
  // Round 2: numbers are per branch per day in the shared test DB, so
  // parallel files may already hold today's early numbers — assert the
  // sequence is consecutive, not that it starts at 1.
  it('issues consecutive token numbers for fresh CNICs', async () => {
    const first = await issue(khi, randomCnic());
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const firstNumber = first.body.data.tokenNumber as number;
    expect(firstNumber).toBeGreaterThan(0);
    expect(first.body.data).toMatchObject({
      tokenNumber: firstNumber,
      tokenCode: `KHI-GULSHAN-${String(firstNumber).padStart(3, '0')}`,
      branchId: khi,
      status: 'ISSUED',
      applicantId: null,
    });
    expect(first.body.data.phone).toMatch(/^\+92345\d{7}$/);
    expect(first.body.data.issuedAt).toEqual(expect.any(String));

    const second = await issue(khi, randomCnic());
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.data.tokenNumber).toBe(firstNumber + 1);
    expect(second.body.data.tokenCode).toBe(
      `KHI-GULSHAN-${String(firstNumber + 1).padStart(3, '0')}`,
    );
    // Expiry is midnight Pakistan time at the end of the issue day.
    expect(second.body.data.expiresAt).toBe(
      tokenExpiresAt(new Date(second.body.data.issuedAt as string)).toISOString(),
    );
    expect(second.body.data.expired).toBe(false);
    expect(first.body.data.registrationReference).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(second.body.data.registrationReference).toMatch(
      /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/,
    );
    expect(second.body.data.registrationReference).not.toBe(first.body.data.registrationReference);
  });

  it('issues a fresh token number with 201 when the same CNIC visits again', async () => {
    const cnic = randomCnic();
    const first = await issue(khi, cnic);
    expect(first.status).toBe(201);
    const again = await issue(khi, cnic);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.data.id).not.toBe(first.body.data.id);
    expect(again.body.data.tokenNumber).toBe(first.body.data.tokenNumber + 1);
    expect(again.body.data.supersededTokenCodes).toEqual([first.body.data.tokenCode]);
    expect(again.body.data.registrationReference).toBe(first.body.data.registrationReference);

    // The morning token is cancelled: looking it up by code shows CANCELLED.
    const byCode = await lookup(
      `/api/v1/applicants/tokens?tokenCode=${first.body.data.tokenCode as string}`,
    );
    const oldOne = (byCode.body.data as Array<{ id: string; status: string }>).find(
      (candidate) => candidate.id === (first.body.data.id as string),
    );
    expect(oldOne?.status).toBe('CANCELLED');
  });

  it('refuses a token for a CNIC that already has a profile', async () => {
    const cnic = randomCnic();
    const registered = await call(staffRegister, '/api/v1/applicants', {
      method: 'POST',
      body: {
        fullName: 'Ayesha Khan',
        fatherName: 'Imran Khan',
        cnic,
        dateOfBirth: '1998-04-12',
        gender: 'FEMALE',
        email: '',
        phone: randomPhone(),
        branchId: khi,
      },
      jar: staffJar,
    });
    expect(registered.status, JSON.stringify(registered.body)).toBe(201);

    const response = await issue(khi, cnic);
    expect(response.status).toBe(409);
    expect(response.body.error.details.reason).toBe('CNIC_TAKEN');
  });

  it('rejects a token for a branch outside the staff member’s scope', async () => {
    const response = await issue(lhr, randomCnic());
    expect(response.status).toBe(403);
  });

  it('audits the issuance', async () => {
    const cnic = randomCnic();
    const response = await issue(khi, cnic);
    expect(response.status).toBe(201);
    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, 'applicant.token_issued'),
          eq(schema.auditLogs.entityId, response.body.data.id as string),
        ),
      );
    expect(audit).toMatchObject({ branchId: khi });
    expect(audit?.after).toMatchObject({
      registrationReference: response.body.data.registrationReference,
    });
  });

  it('looks a token up by code, by CNIC + branch, and as a branch-day list', async () => {
    const cnic = randomCnic();
    const issued = await issue(khi, cnic);
    expect(issued.status).toBe(201);
    const code = issued.body.data.tokenCode as string;

    const byCode = await lookup(`?tokenCode=${code}`);
    expect(byCode.status).toBe(200);
    // A token code is reused every day, and the shared test DB is never
    // wiped — tokens from earlier runs can share this code. Assert
    // membership, not an exact length.
    expect(byCode.body.data).toContainEqual(
      expect.objectContaining({ id: issued.body.data.id, tokenCode: code, status: 'ISSUED' }),
    );

    const byCnic = await lookup(`?cnic=${cnic}&branchId=${khi}`);
    expect(byCnic.status).toBe(200);
    expect(byCnic.body.data).toHaveLength(1);
    expect(byCnic.body.data[0].id).toBe(issued.body.data.id);

    const list = await lookup(`?branchId=${khi}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((t: { tokenCode: string }) => t.tokenCode)).toContain(code);

    const missing = await lookup('?tokenCode=KHI-GULSHAN-9999');
    expect(missing.status).toBe(200);
    expect(missing.body.data).toHaveLength(0);
  });

  it('auto-detects the branch from just the token number (2026-11-17)', async () => {
    const cnic = randomCnic();
    const issued = await issue(khi, cnic);
    expect(issued.status).toBe(201);
    const tokenNumber = issued.body.data.tokenNumber as number;

    // Staff at one branch type only the number — no `KHI-GULSHAN-` prefix.
    // The staff account's single branch supplies it; the branch also rides
    // along explicitly, as the Counter 2 form sends it.
    const byNumber = await lookup(`?tokenCode=${tokenNumber}`);
    expect(byNumber.status).toBe(200);
    expect(byNumber.body.data).toContainEqual(
      expect.objectContaining({ id: issued.body.data.id, tokenNumber }),
    );

    const byNumberAndBranch = await lookup(`?tokenCode=${tokenNumber}&branchId=${khi}`);
    expect(byNumberAndBranch.status).toBe(200);
    expect(byNumberAndBranch.body.data).toContainEqual(
      expect.objectContaining({ id: issued.body.data.id, tokenNumber }),
    );

    const invalid = await lookup('?tokenCode=0');
    expect(invalid.status).toBe(422);
  });

  it('cancelling a token frees the CNIC for a new token the same day (N5)', async () => {
    const cnic = randomCnic();
    const first = await issue(khi, cnic);
    expect(first.status).toBe(201);

    const cancelled = await call(
      cancelToken,
      `/api/v1/applicants/tokens/${first.body.data.id}/cancel`,
      {
        method: 'POST',
        body: {},
        headers: { 'idempotency-key': crypto.randomUUID() },
        params: { id: first.body.data.id as string },
        jar: staffJar,
      },
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const again = await issue(khi, cnic);
    expect(again.status).toBe(201);
    expect(again.body.data.id).not.toBe(first.body.data.id);
    expect(again.body.data.tokenNumber).toBe(first.body.data.tokenNumber + 1);

    const cancelCompleted = await call(
      cancelToken,
      `/api/v1/applicants/tokens/${first.body.data.id}/cancel`,
      {
        method: 'POST',
        body: {},
        headers: { 'idempotency-key': crypto.randomUUID() },
        params: { id: first.body.data.id as string },
        jar: staffJar,
      },
    );
    expect(cancelCompleted.status).toBe(409);
  });

  it('completes the token when the full registration names it, and refuses a second use', async () => {
    const cnic = randomCnic();
    const issued = await issue(khi, cnic);
    expect(issued.status).toBe(201);

    const registered = await call(staffRegister, '/api/v1/applicants', {
      method: 'POST',
      body: {
        fullName: 'Ahmed Raza',
        fatherName: 'Imran Raza',
        cnic,
        dateOfBirth: '1998-04-12',
        gender: 'MALE',
        email: '',
        phone: issued.body.data.phone,
        branchId: khi,
        tokenId: issued.body.data.id,
      },
      jar: staffJar,
    });
    expect(registered.status, JSON.stringify(registered.body)).toBe(201);
    const [saved] = await db
      .select({ registrationReference: schema.applicants.registrationReference })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, registered.body.data.id as string));
    expect(saved?.registrationReference).toBe(issued.body.data.registrationReference);

    const after = await lookup(`?tokenCode=${issued.body.data.tokenCode}`);
    expect(after.body.data[0]).toMatchObject({
      status: 'COMPLETED',
      applicantId: registered.body.data.id,
    });

    // The same token cannot complete a second registration.
    const second = await call(staffRegister, '/api/v1/applicants', {
      method: 'POST',
      body: {
        fullName: 'Bilal Ahmed',
        fatherName: 'Imran Ahmed',
        cnic: randomCnic(),
        dateOfBirth: '1998-04-12',
        gender: 'MALE',
        email: '',
        phone: randomPhone(),
        branchId: khi,
        tokenId: issued.body.data.id,
      },
      jar: staffJar,
    });
    expect(second.status).toBe(409);
  });

  it('shows an expired token as expired, and refuses to complete it', async () => {
    const cnic = randomCnic();
    const issued = await issue(khi, cnic);
    expect(issued.status).toBe(201);
    await owner`UPDATE branch_applicant_tokens SET expires_at = now() - interval '1 hour', issued_at = now() - interval '2 hours' WHERE id = ${issued.body.data.id}`;

    const found = await lookup(`?tokenCode=${issued.body.data.tokenCode}`);
    expect(found.body.data[0]).toMatchObject({ status: 'ISSUED', expired: true });

    const registered = await call(staffRegister, '/api/v1/applicants', {
      method: 'POST',
      body: {
        fullName: 'Ahmed Raza',
        fatherName: 'Imran Raza',
        cnic,
        dateOfBirth: '1998-04-12',
        gender: 'MALE',
        email: '',
        phone: issued.body.data.phone,
        branchId: khi,
        tokenId: issued.body.data.id,
      },
      jar: staffJar,
    });
    expect(registered.status).toBe(409);
  });

  // Audit 2026-11-11 (M-06): re-issuing for a person whose token expired
  // issues a FRESH token — the dead one is auto-cancelled, never re-handed.
  it('issues a fresh token (and auto-cancels the old one) when re-issuing after expiry', async () => {
    const cnic = randomCnic();
    const issued = await issue(khi, cnic);
    expect(issued.status).toBe(201);
    await owner`UPDATE branch_applicant_tokens SET expires_at = now() - interval '1 hour', issued_at = now() - interval '2 hours' WHERE id = ${issued.body.data.id}`;

    const again = await issue(khi, cnic);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.data.id).not.toBe(issued.body.data.id);
    // MAX() counts the cancelled row, so the fresh token takes the next number.
    expect(again.body.data.tokenNumber).toBe(issued.body.data.tokenNumber + 1);
    expect(again.body.data.status).toBe('ISSUED');
    expect(again.body.data.expired).toBe(false);

    // Round 2: the fresh token takes the NEXT number, so it has a different
    // code — the old code finds only the cancelled token, the new code only
    // the fresh one. (Same number on an earlier day can also match, so
    // assert membership, not an exact length.)
    const byOldCode = await lookup(`?tokenCode=${issued.body.data.tokenCode}`);
    expect(byOldCode.body.data).toContainEqual(
      expect.objectContaining({ id: issued.body.data.id, status: 'CANCELLED' }),
    );
    expect(byOldCode.body.data).not.toContainEqual(
      expect.objectContaining({ id: again.body.data.id }),
    );
    const byNewCode = await lookup(`?tokenCode=${again.body.data.tokenCode}`);
    expect(byNewCode.body.data).toContainEqual(
      expect.objectContaining({ id: again.body.data.id, status: 'ISSUED' }),
    );
    expect(byNewCode.body.data).not.toContainEqual(
      expect.objectContaining({ id: issued.body.data.id }),
    );
  });

  // Audit 2026-11-11 (M-07): a token code is reused every day — the lookup
  // returns every day's token with that number, most recent first.
  it('returns every day’s token for a reused token code, most recent first', async () => {
    const cnic = randomCnic();
    const issued = await issue(khi, cnic);
    expect(issued.status).toBe(201);
    // A leftover token from an earlier run can already hold this number on
    // yesterday — the UPDATE would then hit the (branch, day, number) unique
    // index. Clear any conflicting row first (never the issued one).
    await owner`DELETE FROM branch_applicant_tokens WHERE branch_id = ${khi} AND registration_day = CURRENT_DATE - 1 AND token_number = ${issued.body.data.tokenNumber} AND id != ${issued.body.data.id}`;
    await owner`UPDATE branch_applicant_tokens SET registration_day = CURRENT_DATE - 1, expires_at = now() - interval '1 day', issued_at = now() - interval '2 days' WHERE id = ${issued.body.data.id}`;

    // The moved token no longer counts for today, so the next issue takes
    // its number again — the same code on two days.
    const today = await issue(khi, randomCnic());
    expect(today.status).toBe(201);
    expect(today.body.data.tokenNumber).toBe(issued.body.data.tokenNumber);

    const found = await lookup(`?tokenCode=${issued.body.data.tokenCode}`);
    // The shared test DB can hold this number from earlier days/runs, so
    // assert membership and order, not an exact length (same pattern as the
    // re-issue-after-expiry test above).
    expect(found.body.data[0]).toMatchObject({ id: today.body.data.id, status: 'ISSUED' });
    expect(found.body.data).toContainEqual(
      expect.objectContaining({ id: today.body.data.id, status: 'ISSUED' }),
    );
    expect(found.body.data).toContainEqual(
      expect.objectContaining({ id: issued.body.data.id, status: 'ISSUED', expired: true }),
    );
  });

  it('reuses an unregistered applicant ID from another branch', async () => {
    const cnic = randomCnic();
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const reserved = Array.from(
      { length: 8 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)]!,
    ).join('');
    await owner`DELETE FROM branch_applicant_tokens WHERE branch_id = ${lhr} AND registration_day = CURRENT_DATE - 1 AND token_number = 9999`;
    await owner`
      INSERT INTO branch_applicant_tokens (
        branch_id, registration_day, token_number, cnic, applicant_name, phone,
        status, issued_at, expires_at, registration_reference
      ) VALUES (
        ${lhr}, CURRENT_DATE - 1, 9999, ${cnic}, 'Cross Branch', '+923001234567',
        'CANCELLED', now() - interval '2 days', now() - interval '1 day', ${reserved}
      )
    `;

    const issued = await issue(khi, cnic);
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    expect(issued.body.data.registrationReference).toBe(reserved);
  });

  it('registers an old token that has no reserved applicant ID', async () => {
    const cnic = randomCnic();
    const issued = await issue(khi, cnic);
    expect(issued.status).toBe(201);
    await owner`UPDATE branch_applicant_tokens SET registration_reference = NULL WHERE id = ${issued.body.data.id}`;

    const registered = await call(staffRegister, '/api/v1/applicants', {
      method: 'POST',
      body: {
        fullName: 'Ahmed Raza',
        fatherName: 'Imran Raza',
        cnic,
        dateOfBirth: '1998-04-12',
        gender: 'MALE',
        email: '',
        phone: issued.body.data.phone,
        branchId: khi,
        tokenId: issued.body.data.id,
      },
      jar: staffJar,
    });
    expect(registered.status, JSON.stringify(registered.body)).toBe(201);
    const [saved] = await db
      .select({ registrationReference: schema.applicants.registrationReference })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, registered.body.data.id as string));
    expect(saved?.registrationReference).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(saved?.registrationReference).not.toBe(issued.body.data.registrationReference);
  });
});
