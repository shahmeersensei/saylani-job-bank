import { schema } from '@jobbank/db';
import { getSeedDevPassword } from '@jobbank/db/seed/dev-data';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, like } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as confirm2fa } from '@/app/api/v1/account/2fa/confirm/route';
import { POST as disable2fa } from '@/app/api/v1/account/2fa/disable/route';
import { POST as enroll2fa } from '@/app/api/v1/account/2fa/enroll/route';
import { POST as verify2fa } from '@/app/api/v1/auth/2fa/verify/route';
import { POST as acceptInvite } from '@/app/api/v1/auth/invitations/accept/route';
import { GET as lookupInvite } from '@/app/api/v1/auth/invitations/lookup/route';
import { POST as signupCode } from '@/app/api/v1/auth/signup/code/route';
import { POST as signupComplete } from '@/app/api/v1/auth/signup/complete/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as forgot } from '@/app/api/v1/auth/password/forgot/route';
import { POST as reset } from '@/app/api/v1/auth/password/reset/route';
import { PATCH as patchBranch } from '@/app/api/v1/branches/[id]/route';
import { GET as listBranchesRoute, POST as createBranchRoute } from '@/app/api/v1/branches/route';
import { POST as resendInvite } from '@/app/api/v1/users/[id]/invitation/route';
import { POST as revokeInvite } from '@/app/api/v1/users/[id]/invitation/revoke/route';
import { DELETE as revokeRoleRoute } from '@/app/api/v1/users/[id]/roles/[assignmentId]/route';
import { POST as grantRoleRoute } from '@/app/api/v1/users/[id]/roles/route';
import { GET as getUser } from '@/app/api/v1/users/[id]/route';
import { PATCH as setStatus } from '@/app/api/v1/users/[id]/status/route';
import { POST as reset2faRoute } from '@/app/api/v1/users/[id]/two-factor/reset/route';
import { GET as listUsers, POST as inviteRoute } from '@/app/api/v1/users/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { mailOutbox } from '@/lib/mail/mailer';
import {
  call,
  enrollTwoFactor,
  Jar,
  owner,
  rememberTotp,
  resetTwoFactor,
  signIn,
  signInAdmin,
  signInWith2fa,
  totpCode,
  uniqueEmail,
} from '@/test/api-client';

const branchId = async (code: string) =>
  (
    await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.code, code))
  )[0]!.id;

function lastMailTo(email: string) {
  const mail = [...mailOutbox].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase());
  if (!mail) throw new Error(`no email captured for ${email}`);
  return mail;
}
const tokenFrom = (text: string) => text.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? '';

let KHI: string;
let LHR: string;
beforeAll(async () => {
  KHI = await branchId('KHI-GULSHAN');
  LHR = await branchId('LHR-JOHAR');
});
beforeEach(() => resetMemoryRateLimits());

/** Invites + activates a staff member through the real flow; returns their id and session. */
async function inviteAndActivate(
  adminJar: Jar,
  role: 'STAFF' | 'VERIFIER' | 'INTERVIEWER_SCHEDULER',
  branch: string,
) {
  const email = uniqueEmail('staff');
  const invited = await call(inviteRoute, '/api/v1/users', {
    method: 'POST',
    jar: adminJar,
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: { name: 'Test Staff', email, title: 'Placement Officer', role, branchId: branch },
  });
  expect(invited.status, JSON.stringify(invited.body)).toBe(201);
  const token = tokenFrom(lastMailTo(email).text);
  const jar = new Jar();
  const accepted = await call(acceptInvite, '/api/v1/auth/invitations/accept', {
    method: 'POST',
    body: { token, password: getSeedDevPassword() },
    jar,
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  // Staff, Verifiers and Interviewer-Schedulers must enrol an authenticator
  // before use, so activation returns a setup token instead of a session —
  // enrol here so the caller gets a live session.
  if (accepted.body.data.kind === 'two_factor_setup_required') {
    jar.setupToken = accepted.body.data.setupToken as string;
    await enrollTwoFactor(email, jar);
  }
  return { id: invited.body.data.user.id as string, email, jar };
}

// ─── Mandatory two-factor (decided for M4) ────────────────────────────

describe('two-factor authentication', () => {
  it('Super Admin is blocked until enrolment, then needs a code at every sign-in', async () => {
    const email = 'superadmin@jobbank.local';
    await resetTwoFactor(email);
    // H-02: a never-enrolled 2FA-required admin gets no session at login —
    // only a short-lived setup token. Protected routes see no session (401),
    // and enrolment is the only thing the token buys.
    const jar = await signIn(email);
    expect(jar.setupToken?.startsWith('v1.')).toBe(true);

    const blocked = await call(listBranchesRoute, '/api/v1/branches', { jar });
    expect(blocked.status).toBe(401);

    const badPassword = await call(enroll2fa, '/api/v1/account/2fa/enroll', {
      method: 'POST',
      jar,
      body: { password: 'wrong-password-1', setupToken: jar.setupToken },
    });
    expect(badPassword.status).toBe(401);

    const start = await call(enroll2fa, '/api/v1/account/2fa/enroll', {
      method: 'POST',
      jar,
      body: { password: getSeedDevPassword(), setupToken: jar.setupToken },
    });
    expect(start.status).toBe(200);
    expect(start.body.data.qrSvg).toMatch(/^<svg/);
    expect(start.body.data.backupCodes).toHaveLength(10);
    const wrong = await call(confirm2fa, '/api/v1/account/2fa/confirm', {
      method: 'POST',
      jar,
      body: { code: '000000' },
    });
    expect(wrong.status).toBe(401);
    await resetTwoFactor(email); // start over through the helper, which records the secret
    const fresh = await signIn(email);
    const backupCodes = await enrollTwoFactor(email, fresh);
    expect((await call(listBranchesRoute, '/api/v1/branches', { jar: fresh })).status).toBe(200);

    // Next sign-in: password alone is not enough.
    const step1 = new Jar();
    const pw = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email, password: getSeedDevPassword() },
      jar: step1,
    });
    expect(pw.body.data).toMatchObject({ kind: 'two_factor_required', methods: ['totp'] });
    expect((await call(me, '/api/v1/auth/me', { jar: step1 })).status).toBe(401);
    expect(
      (
        await call(verify2fa, '/api/v1/auth/2fa/verify', {
          method: 'POST',
          jar: step1,
          body: { code: '123456' },
        })
      ).status,
    ).toBe(401);
    const ok = await call(verify2fa, '/api/v1/auth/2fa/verify', {
      method: 'POST',
      jar: step1,
      body: { code: totpCode(email) },
    });
    expect(ok.status).toBe(200);
    expect((await call(me, '/api/v1/auth/me', { jar: step1 })).body.data.twoFactorPending).toBe(
      false,
    );

    // A backup code works exactly once.
    const viaBackup = async () => {
      const j = new Jar();
      await call(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email, password: getSeedDevPassword() },
        jar: j,
      });
      return call(verify2fa, '/api/v1/auth/2fa/verify', {
        method: 'POST',
        jar: j,
        body: { backupCode: backupCodes[0] },
      });
    };
    expect((await viaBackup()).status).toBe(200);
    expect((await viaBackup()).status).toBe(401);
  });

  it('an invitee enrols with their setup token even when an admin session is live', async () => {
    // Regression 2026-11-16: the enrol route used to prefer the session
    // cookie over the setupToken, so an admin testing an invite in the same
    // browser had the invitee's password checked against the admin's account
    // and a correct password failed with "Incorrect password".
    const adminJar = await signInAdmin('superadmin@jobbank.local');
    const email = uniqueEmail('staff');
    const invited = await call(inviteRoute, '/api/v1/users', {
      method: 'POST',
      jar: adminJar,
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: { name: 'Test Staff', email, title: 'Placement Officer', role: 'STAFF', branchId: KHI },
    });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const token = tokenFrom(lastMailTo(email).text);
    // The invitee chooses a password unlike any seeded account's, so a check
    // against the wrong account cannot pass by accident.
    const staffPassword = 'Invitee-only-99';
    const jar = new Jar();
    const accepted = await call(acceptInvite, '/api/v1/auth/invitations/accept', {
      method: 'POST',
      body: { token, password: staffPassword },
      jar,
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.data.kind).toBe('two_factor_setup_required');
    const setupToken = accepted.body.data.setupToken as string;

    // The admin session is still live in this browser — enrolment must still
    // run against the invitee's account, via the setup token.
    const start = await call(enroll2fa, '/api/v1/account/2fa/enroll', {
      method: 'POST',
      jar: adminJar,
      body: { password: staffPassword, setupToken },
    });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    expect(start.body.data.qrSvg).toMatch(/^<svg/);
    expect(start.body.data.backupCodes).toHaveLength(10);

    // The enrolment belongs to the invitee: confirming it signs the invitee
    // in, not the admin whose session was on the request.
    rememberTotp(email, start.body.data.manualKey);
    const done = await call(confirm2fa, '/api/v1/account/2fa/confirm', {
      method: 'POST',
      jar: adminJar,
      body: { code: totpCode(email) },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await call(me, '/api/v1/auth/me', { jar: adminJar })).body.data.user.email).toBe(email);
  });

  it('invited Verifier and Interviewer-Scheduler must enrol an authenticator before use', async () => {
    // Regression 2026-11-23: both roles used to sign straight in after
    // accepting an invite (2FA was optional for them), so the setup screen
    // never appeared for them.
    const adminJar = await signInAdmin('superadmin@jobbank.local');
    for (const role of ['VERIFIER', 'INTERVIEWER_SCHEDULER'] as const) {
      const email = uniqueEmail('invitee2fa');
      const invited = await call(inviteRoute, '/api/v1/users', {
        method: 'POST',
        jar: adminJar,
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: { name: 'Test Invitee', email, title: 'Officer', role, branchId: KHI },
      });
      expect(invited.status, JSON.stringify(invited.body)).toBe(201);
      const token = tokenFrom(lastMailTo(email).text);
      const accepted = await call(acceptInvite, '/api/v1/auth/invitations/accept', {
        method: 'POST',
        body: { token, password: getSeedDevPassword() },
      });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      expect(accepted.body.data.kind).toBe('two_factor_setup_required');
    }
  });

  it('no password role can turn two-factor off', async () => {
    // Branch Admin and Verifier alike: enrolment is mandatory, so disabling
    // is forbidden for both. (Before the 2026-11-23 extension, Verifiers
    // could opt in and out.)
    const admin = await signInAdmin('branchadmin.khi@jobbank.local');
    const refused = await call(disable2fa, '/api/v1/account/2fa/disable', {
      method: 'POST',
      jar: admin,
      body: { password: getSeedDevPassword() },
    });
    expect(refused.status).toBe(403);

    const verifier = await signInAdmin('verifier.khi@jobbank.local');
    const refusedVerifier = await call(disable2fa, '/api/v1/account/2fa/disable', {
      method: 'POST',
      jar: verifier,
      body: { password: getSeedDevPassword() },
    });
    expect(refusedVerifier.status).toBe(403);
  });
});

// ─── Branches ─────────────────────────────────────────────────────────

describe('branch management', () => {
  it('Super Admin creates (idempotently) and edits branches; codes are unique and Super Admin-editable', async () => {
    const jar = await signInAdmin('superadmin@jobbank.local');
    const code = `T-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const key = crypto.randomUUID();
    const body = {
      code,
      name: 'Test Branch',
      city: 'Hyderabad',
      location: { lat: 25.396, lng: 68.3578 },
    };
    const create = () =>
      call(createBranchRoute, '/api/v1/branches', {
        method: 'POST',
        jar,
        body,
        headers: { 'idempotency-key': key },
      });

    const first = await create();
    const retry = await create();
    expect(first.status).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(first.body.data).toMatchObject({
      code,
      staffCount: 0,
      location: { lat: 25.396, lng: 68.3578 },
    });

    const dup = await call(createBranchRoute, '/api/v1/branches', {
      method: 'POST',
      jar,
      body,
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(dup.status).toBe(409);

    const id = first.body.data.id;
    // Branch codes are editable by Super Admin only (Step 2, 2026-11-12):
    // a new unique code is accepted and returned. Changing a code breaks
    // already-issued token slips, so this throwaway branch is the right place.
    const newCode = `T-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const renamed = await call(patchBranch, `/api/v1/branches/${id}`, {
      method: 'PATCH',
      jar,
      params: { id },
      body: { name: 'Test Branch Renamed', code: newCode },
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    // A partial update must not reset unrelated fields.
    expect(renamed.body.data).toMatchObject({
      name: 'Test Branch Renamed',
      code: newCode,
      city: 'Hyderabad',
      location: { lat: 25.396, lng: 68.3578 },
    });

    // A code that already belongs to another branch is refused.
    const duplicate = await call(patchBranch, `/api/v1/branches/${id}`, {
      method: 'PATCH',
      jar,
      params: { id },
      body: { code: 'KHI-GULSHAN' },
    });
    expect(duplicate.status).toBe(409);

    // A Branch Admin cannot edit a branch code at all (branch:manage is Super Admin only).
    const ba = await signInAdmin('branchadmin.khi@jobbank.local');
    const denied = await call(patchBranch, `/api/v1/branches/${id}`, {
      method: 'PATCH',
      jar: ba,
      params: { id },
      body: { code: `T-${crypto.randomUUID().slice(0, 6).toUpperCase()}` },
    });
    expect(denied.status).toBe(403);

    // Re-saving identical values (the form sends every field) writes no audit row.
    const auditCount = async () =>
      (
        await db
          .select({ id: schema.auditLogs.id })
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.entityId, id))
      ).length;
    const rowsBefore = await auditCount();
    await call(patchBranch, `/api/v1/branches/${id}`, {
      method: 'PATCH',
      jar,
      params: { id },
      body: {
        name: 'Test Branch Renamed',
        city: 'Hyderabad',
        location: { lat: 25.396, lng: 68.3578 },
      },
    });
    expect(await auditCount()).toBe(rowsBefore);

    await call(patchBranch, `/api/v1/branches/${id}`, {
      method: 'PATCH',
      jar,
      params: { id },
      body: { isActive: false },
    });
    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(eq(schema.auditLogs.entityId, id), eq(schema.auditLogs.action, 'branch.deactivate')),
      );
    expect(audit?.before).toEqual({ isActive: true });
  });

  it('rejects branch edits by non-Super-Admins', async () => {
    const ba = await signInAdmin('branchadmin.khi@jobbank.local');
    const denied = await call(patchBranch, `/api/v1/branches/${KHI}`, {
      method: 'PATCH',
      jar: ba,
      params: { id: KHI },
      body: { name: 'Mine now' },
    });
    expect(denied.status).toBe(403);
  });
});

// ─── Staff invitations & scope ────────────────────────────────────────

describe('staff invitations', () => {
  it('Branch Admin invites staff into their branch; the invitee activates with a strong password', async () => {
    const ba = await signInAdmin('branchadmin.khi@jobbank.local');
    const email = uniqueEmail('invitee');
    const invited = await call(inviteRoute, '/api/v1/users', {
      method: 'POST',
      jar: ba,
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: { name: 'Nadia Invitee', email, title: null, role: 'STAFF', branchId: KHI },
    });
    expect(invited.status).toBe(201);
    expect(invited.body.data).toMatchObject({ emailSent: true, user: { status: 'INVITED' } });

    const mail = lastMailTo(email);
    expect(mail.subject).toMatch(/invited/i);
    const token = tokenFrom(mail.text);
    expect(token.length).toBeGreaterThan(30);
    // The link returned to the admin is the identical link the email carries.
    expect(tokenFrom(invited.body.data.inviteLink as string)).toBe(token);
    const [stored] = await db
      .select()
      .from(schema.accountTokens)
      .where(eq(schema.accountTokens.userId, invited.body.data.user.id));
    expect(stored!.tokenHash).not.toContain(token);

    const preview = await call(lookupInvite, `/api/v1/auth/invitations/lookup?token=${token}`);
    expect(preview.body.data).toMatchObject({ name: 'Nadia Invitee', roles: [{ role: 'STAFF' }] });

    const weak = await call(acceptInvite, '/api/v1/auth/invitations/accept', {
      method: 'POST',
      body: { token, password: 'short' },
    });
    expect(weak.status).toBe(422);

    const jar = new Jar();
    const ok = await call(acceptInvite, '/api/v1/auth/invitations/accept', {
      method: 'POST',
      jar,
      body: { token, password: 'Strong-pass-123' },
    });
    expect(ok.status).toBe(200);
    // Staff must enrol before they hold a session (same rule as inviteAndActivate).
    expect(ok.body.data.kind).toBe('two_factor_setup_required');
    jar.setupToken = ok.body.data.setupToken as string;
    await enrollTwoFactor(email, jar, 'Strong-pass-123');
    expect(
      (await call(me, '/api/v1/auth/me', { jar })).body.data.branches.map(
        (b: { id: string }) => b.id,
      ),
    ).toEqual([KHI]);

    const again = await call(acceptInvite, '/api/v1/auth/invitations/accept', {
      method: 'POST',
      body: { token, password: 'Strong-pass-123' },
    });
    expect(again.status).toBe(400);
  });

  it('Branch Admins cannot invite outside their branch or above their role; duplicates are refused', async () => {
    const ba = await signInAdmin('branchadmin.khi@jobbank.local');
    const invite = (body: object) =>
      call(inviteRoute, '/api/v1/users', {
        method: 'POST',
        jar: ba,
        headers: { 'idempotency-key': crypto.randomUUID() },
        body,
      });
    expect(
      (await invite({ name: 'X Y', email: uniqueEmail('x'), role: 'STAFF', branchId: LHR })).status,
    ).toBe(403);
    expect(
      (await invite({ name: 'X Y', email: uniqueEmail('x'), role: 'BRANCH_ADMIN', branchId: KHI }))
        .status,
    ).toBe(403);
    expect(
      (
        await invite({
          name: 'X Y',
          email: 'staff.khi@jobbank.local',
          role: 'STAFF',
          branchId: KHI,
        })
      ).status,
    ).toBe(409);
  });

  it('Super Admin and Branch Admin can invite an Interviewer and Scheduler into a branch', async () => {
    // Regression: the user_roles_branch_scope check once omitted
    // INTERVIEWER_SCHEDULER, so these invites passed the permission check
    // and then failed in Postgres with 23514 ("Scope is not allowed.").
    const sa = await signInAdmin('superadmin@jobbank.local');
    const saEmail = uniqueEmail('interviewer-sa');
    const saInvite = await call(inviteRoute, '/api/v1/users', {
      method: 'POST',
      jar: sa,
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: {
        name: 'Sara Interviewer',
        email: saEmail,
        title: 'Interviewer Officer',
        role: 'INTERVIEWER_SCHEDULER',
        branchId: KHI,
      },
    });
    expect(saInvite.status, JSON.stringify(saInvite.body)).toBe(201);

    const ba = await signInAdmin('branchadmin.khi@jobbank.local');
    const baEmail = uniqueEmail('interviewer-ba');
    const baInvite = await call(inviteRoute, '/api/v1/users', {
      method: 'POST',
      jar: ba,
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: {
        name: 'Bilal Interviewer',
        email: baEmail,
        title: 'Interviewer Officer',
        role: 'INTERVIEWER_SCHEDULER',
        branchId: KHI,
      },
    });
    expect(baInvite.status, JSON.stringify(baInvite.body)).toBe(201);

    const [stored] = await db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, baInvite.body.data.user.id));
    expect(stored).toMatchObject({ roleCode: 'INTERVIEWER_SCHEDULER', branchId: KHI });
  });

  it('a resent invitation replaces the old link', async () => {
    const sa = await signInAdmin('superadmin@jobbank.local');
    const email = uniqueEmail('resend');
    const invited = await call(inviteRoute, '/api/v1/users', {
      method: 'POST',
      jar: sa,
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: { name: 'Re Send', email, role: 'VERIFIER', branchId: LHR },
    });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const firstToken = tokenFrom(lastMailTo(email).text);
    const id = invited.body.data.user.id;
    // Round 2: L-29 refuses a resend within 5 minutes of the invite — age
    // the pending invite past the cooldown, as a real resend would be.
    await owner`UPDATE account_tokens SET created_at = now() - interval '10 minutes' WHERE user_id = ${id} AND purpose = 'INVITE' AND used_at IS NULL`;
    const resent = await call(resendInvite, `/api/v1/users/${id}/invitation`, {
      method: 'POST',
      jar: sa,
      params: { id },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(resent.status).toBe(200);
    const secondToken = tokenFrom(lastMailTo(email).text);
    expect(secondToken).not.toBe(firstToken);
    // The resend response carries the new link, identical to the emailed one.
    expect(tokenFrom(resent.body.data.inviteLink as string)).toBe(secondToken);
    expect(
      (await call(lookupInvite, `/api/v1/auth/invitations/lookup?token=${firstToken}`)).status,
    ).toBe(400);
    expect(
      (await call(lookupInvite, `/api/v1/auth/invitations/lookup?token=${secondToken}`)).status,
    ).toBe(200);
  });

  it('a revoked invitation stops working and a fresh one can be sent afterwards', async () => {
    const sa = await signInAdmin('superadmin@jobbank.local');
    const email = uniqueEmail('revoke');
    const invited = await call(inviteRoute, '/api/v1/users', {
      method: 'POST',
      jar: sa,
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: { name: 'Re Voke', email, role: 'STAFF', branchId: KHI },
    });
    const token = tokenFrom(lastMailTo(email).text);
    const id = invited.body.data.user.id;
    const revoked = await call(revokeInvite, `/api/v1/users/${id}/invitation/revoke`, {
      method: 'POST',
      jar: sa,
      params: { id },
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data).toMatchObject({ revoked: true });
    expect(
      (await call(lookupInvite, `/api/v1/auth/invitations/lookup?token=${token}`)).status,
    ).toBe(400);
    expect(
      (
        await call(acceptInvite, '/api/v1/auth/invitations/accept', {
          method: 'POST',
          body: { token, password: 'Strong-pass-123' },
        })
      ).status,
    ).toBe(400);
    const resent = await call(resendInvite, `/api/v1/users/${id}/invitation`, {
      method: 'POST',
      jar: sa,
      params: { id },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(resent.status).toBe(200);
    const freshToken = tokenFrom(lastMailTo(email).text);
    expect(freshToken).not.toBe(token);
    expect(
      (await call(lookupInvite, `/api/v1/auth/invitations/lookup?token=${freshToken}`)).status,
    ).toBe(200);
  });

  it('staff lists are branch-scoped, and reading another branch is refused and audited', async () => {
    const ba = await signInAdmin('branchadmin.khi@jobbank.local');
    const list = await call(listUsers, '/api/v1/users?pageSize=100', { jar: ba });
    expect(list.status).toBe(200);
    const branches = new Set(
      list.body.data.flatMap((u: { roles: { branchId: string }[] }) =>
        u.roles.map((r) => r.branchId),
      ),
    );
    expect(branches.has(LHR)).toBe(false);

    const [lhrStaff] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, 'staff.lhr@jobbank.local'));
    const denied = await call(getUser, `/api/v1/users/${lhrStaff!.id}`, {
      jar: ba,
      params: { id: lhrStaff!.id },
    });
    expect(denied.status).toBe(403);
    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.correlationId, denied.body.error.correlation_id));
    expect(audit).toMatchObject({
      action: 'access.scope_violation',
      entityType: 'user',
      entityId: lhrStaff!.id,
    });

    const sa = await signInAdmin('superadmin@jobbank.local');
    expect(
      (
        await call(getUser, `/api/v1/users/${lhrStaff!.id}`, {
          jar: sa,
          params: { id: lhrStaff!.id },
        })
      ).status,
    ).toBe(200);
  });
});

// ─── Roles, status, 2FA reset ─────────────────────────────────────────

describe('managing staff accounts', () => {
  it('Super Admin adds and removes roles; the only role cannot be removed', async () => {
    const sa = await signInAdmin('superadmin@jobbank.local');
    const { id } = await inviteAndActivate(sa, 'STAFF', KHI);

    const granted = await call(grantRoleRoute, `/api/v1/users/${id}/roles`, {
      method: 'POST',
      jar: sa,
      params: { id },
      body: { role: 'VERIFIER', branchId: LHR },
    });
    expect(granted.status).toBe(200);
    expect(granted.body.data.roles).toHaveLength(2);
    const duplicate = await call(grantRoleRoute, `/api/v1/users/${id}/roles`, {
      method: 'POST',
      jar: sa,
      params: { id },
      body: { role: 'VERIFIER', branchId: LHR },
    });
    expect(duplicate.status).toBe(409);

    const verifier = granted.body.data.roles.find((r: { role: string }) => r.role === 'VERIFIER');
    const removed = await call(revokeRoleRoute, '/x', {
      method: 'DELETE',
      jar: sa,
      params: { id, assignmentId: verifier.id },
    });
    expect(removed.body.data.roles).toHaveLength(1);
    const last = removed.body.data.roles[0];
    expect(
      (
        await call(revokeRoleRoute, '/x', {
          method: 'DELETE',
          jar: sa,
          params: { id, assignmentId: last.id },
        })
      ).status,
    ).toBe(409);
  });

  it('disabling signs the person out everywhere and blocks sign-in until re-enabled', async () => {
    const ba = await signInAdmin('branchadmin.khi@jobbank.local');
    const person = await inviteAndActivate(ba, 'STAFF', KHI);
    expect((await call(me, '/api/v1/auth/me', { jar: person.jar })).status).toBe(200);

    const noReason = await call(setStatus, '/x', {
      method: 'PATCH',
      jar: ba,
      params: { id: person.id },
      body: { status: 'DISABLED', reason: '' },
    });
    expect(noReason.status).toBe(422);
    const disabled = await call(setStatus, '/x', {
      method: 'PATCH',
      jar: ba,
      params: { id: person.id },
      body: { status: 'DISABLED', reason: 'Left the organisation' },
    });
    expect(disabled.body.data.status).toBe('DISABLED');
    expect((await call(me, '/api/v1/auth/me', { jar: person.jar })).status).toBe(401);
    const blocked = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: person.email, password: getSeedDevPassword() },
    });
    expect(blocked.body.error.details).toEqual({ reason: 'ACCOUNT_DISABLED' });

    await call(setStatus, '/x', {
      method: 'PATCH',
      jar: ba,
      params: { id: person.id },
      body: { status: 'ACTIVE', reason: 'Rejoined' },
    });
    expect(
      (
        await call(login, '/api/v1/auth/login', {
          method: 'POST',
          body: { email: person.email, password: getSeedDevPassword() },
        })
      ).status,
    ).toBe(200);

    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(eq(schema.auditLogs.entityId, person.id), eq(schema.auditLogs.action, 'user.disable')),
      );
    expect(audit?.reason).toBe('Left the organisation');
  });

  it('Branch Admin cannot change admins or their own account', async () => {
    const ba = await signInAdmin('branchadmin.khi@jobbank.local');
    const [self] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, 'branchadmin.khi@jobbank.local'));
    const selfChange = await call(setStatus, '/x', {
      method: 'PATCH',
      jar: ba,
      params: { id: self!.id },
      body: { status: 'DISABLED', reason: 'Testing self' },
    });
    expect(selfChange.status).toBe(403);
  });

  it('resetting a lost authenticator signs them out and makes them enrol again', async () => {
    const sa = await signInAdmin('superadmin@jobbank.local');
    const person = await inviteAndActivate(sa, 'VERIFIER', LHR);
    // inviteAndActivate already enrolled the verifier (2FA is mandatory for
    // them). Enrolling again here would fail: the setup token on the jar
    // died once the first enrolment completed, and a setup token wins over
    // the live session on the enrol route.
    // Audit 2026-11-11 (M-28): the acting admin's password is required — a
    // wrong password refuses the reset and leaves 2FA in place.
    const wrongPassword = await call(reset2faRoute, '/x', {
      method: 'POST',
      jar: sa,
      params: { id: person.id },
      body: { reason: 'Lost phone', password: 'not-the-password' },
    });
    expect(wrongPassword.status).toBe(401);
    const reset2fa = await call(reset2faRoute, '/x', {
      method: 'POST',
      jar: sa,
      params: { id: person.id },
      body: { reason: 'Lost phone', password: getSeedDevPassword() },
    });
    expect(reset2fa.body.data.twoFactorEnabled).toBe(false);
    expect((await call(me, '/api/v1/auth/me', { jar: person.jar })).status).toBe(401);
    const relogin = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: person.email, password: getSeedDevPassword() },
    });
    // Verifiers are 2FA-required now: after the reset there is no
    // authenticator left, so sign-in ends in enrolment, not a session.
    expect(relogin.body.data.kind).toBe('two_factor_setup_required');
  });
});

// ─── Password reset ────────────────────────────────────────────────────

describe('password reset', () => {
  it('emails a single-use link, changes the password and signs out other sessions', async () => {
    const sa = await signInAdmin('superadmin@jobbank.local');
    const person = await inviteAndActivate(sa, 'STAFF', LHR);

    const before = mailOutbox.length;
    expect(
      (await call(forgot, '/x', { method: 'POST', body: { email: 'nobody@jobbank.test' } })).status,
    ).toBe(202);
    expect(mailOutbox.length).toBe(before);

    expect(
      (await call(forgot, '/x', { method: 'POST', body: { email: person.email } })).status,
    ).toBe(202);
    const token = tokenFrom(lastMailTo(person.email).text);
    const done = await call(reset, '/x', {
      method: 'POST',
      body: { token, password: 'Brand-new-pass-9' },
    });
    expect(done.status).toBe(200);
    expect((await call(me, '/api/v1/auth/me', { jar: person.jar })).status).toBe(401);
    expect(
      (
        await call(login, '/x', {
          method: 'POST',
          body: { email: person.email, password: getSeedDevPassword() },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(login, '/x', {
          method: 'POST',
          body: { email: person.email, password: 'Brand-new-pass-9' },
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(reset, '/x', { method: 'POST', body: { token, password: 'Another-pass-99' } }))
        .status,
    ).toBe(400);
  });

  it('works for an employer, and the authenticator still stands after the reset', async () => {
    const email = 'employer@jobbank.local';
    const jar = await signInWith2fa(email);
    expect((await call(me, '/api/v1/auth/me', { jar })).status).toBe(200);

    expect((await call(forgot, '/x', { method: 'POST', body: { email } })).status).toBe(202);
    const token = tokenFrom(lastMailTo(email).text);
    expect(token.length).toBeGreaterThan(20);

    const done = await call(reset, '/x', {
      method: 'POST',
      body: { token, password: 'Employer-new-99' },
    });
    expect(done.status).toBe(200);

    // The reset signs the employer out everywhere, and the old password is dead.
    expect((await call(me, '/api/v1/auth/me', { jar })).status).toBe(401);
    expect(
      (
        await call(login, '/x', {
          method: 'POST',
          body: { email, password: getSeedDevPassword() },
        })
      ).status,
    ).toBe(401);

    // The new password works — but only with the authenticator code: the
    // reset changes the password, it does not clear the enrolment.
    const step1 = new Jar();
    const pw = await call(login, '/x', {
      method: 'POST',
      body: { email, password: 'Employer-new-99' },
      jar: step1,
    });
    expect(pw.body.data).toMatchObject({ kind: 'two_factor_required', methods: ['totp'] });
    expect((await call(me, '/api/v1/auth/me', { jar: step1 })).status).toBe(401);
    const ok = await call(verify2fa, '/api/v1/auth/2fa/verify', {
      method: 'POST',
      jar: step1,
      body: { code: totpCode(email) },
    });
    expect(ok.status).toBe(200);
    expect((await call(me, '/api/v1/auth/me', { jar: step1 })).status).toBe(200);

    // The link is single-use.
    expect(
      (await call(reset, '/x', { method: 'POST', body: { token, password: 'Another-pass-99' } }))
        .status,
    ).toBe(400);

    // This file shares the seeded employer. Put the password back so later
    // tests (and other files) can still sign in with SEED_DEV_PASSWORD.
    const [employerUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    await db
      .update(schema.accounts)
      .set({ password: await hashPassword(getSeedDevPassword()) })
      .where(eq(schema.accounts.userId, employerUser!.id));
  });
});

describe('two-factor for Staff and Employer (extended 2026-11-15)', () => {
  it('Staff is blocked until enrolment, then needs a code at every sign-in, and cannot turn it off', async () => {
    const email = 'staff.khi@jobbank.local';
    await resetTwoFactor(email);
    // H-02: a never-enrolled 2FA-required staff member gets no session at
    // login — only a short-lived setup token.
    const jar = await signIn(email);
    expect(jar.setupToken?.startsWith('v1.')).toBe(true);
    expect((await call(me, '/api/v1/auth/me', { jar })).status).toBe(401);

    await enrollTwoFactor(email, jar);
    expect((await call(me, '/api/v1/auth/me', { jar })).body.data.twoFactorPending).toBe(false);

    // Next sign-in: password alone is not enough. Trust-this-device is offered;
    // leaving it unchecked still asks for a code next time.
    const step1 = new Jar();
    const pw = await call(login, '/x', {
      method: 'POST',
      body: { email, password: getSeedDevPassword() },
      jar: step1,
    });
    expect(pw.body.data).toMatchObject({
      kind: 'two_factor_required',
      methods: ['totp'],
      trustDeviceAllowed: true,
    });
    expect((await call(me, '/api/v1/auth/me', { jar: step1 })).status).toBe(401);
    const ok = await call(verify2fa, '/api/v1/auth/2fa/verify', {
      method: 'POST',
      jar: step1,
      body: { code: totpCode(email) },
    });
    expect(ok.status).toBe(200);

    const refused = await call(disable2fa, '/api/v1/account/2fa/disable', {
      method: 'POST',
      jar: step1,
      body: { password: getSeedDevPassword() },
    });
    expect(refused.status).toBe(403);
  });

  it('trusts this browser for 30 days when the 2FA step checks trust this device', async () => {
    const email = 'staff.khi@jobbank.local';
    await resetTwoFactor(email);
    const enrolled = await signIn(email);
    await enrollTwoFactor(email, enrolled);

    const jar = new Jar();
    const challenge = await call(login, '/x', {
      method: 'POST',
      body: { email, password: getSeedDevPassword() },
      jar,
    });
    expect(challenge.body.data).toMatchObject({
      kind: 'two_factor_required',
      trustDeviceAllowed: true,
    });
    const verified = await call(verify2fa, '/api/v1/auth/2fa/verify', {
      method: 'POST',
      jar,
      body: { code: totpCode(email), trustDevice: true },
    });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);

    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    const trusted = await db
      .select({ identifier: schema.verifications.identifier })
      .from(schema.verifications)
      .where(
        and(
          eq(schema.verifications.value, user!.id),
          like(schema.verifications.identifier, 'trust-device-%'),
        ),
      );
    expect(trusted.length).toBeGreaterThan(0);

    // Same browser (the jar still holds the trust cookie): password alone.
    const again = await call(login, '/x', {
      method: 'POST',
      body: { email, password: getSeedDevPassword() },
      jar,
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.data.kind).toBe('signed_in');

    // A browser without the cookie is still challenged.
    const fresh = new Jar();
    const untrusted = await call(login, '/x', {
      method: 'POST',
      body: { email, password: getSeedDevPassword() },
      jar: fresh,
    });
    expect(untrusted.body.data.kind).toBe('two_factor_required');
  });

  it('Employer is blocked until enrolment and cannot turn two-factor off', async () => {
    const email = 'employer@jobbank.local';
    await resetTwoFactor(email);
    const jar = await signIn(email);
    expect(jar.setupToken?.startsWith('v1.')).toBe(true);
    expect((await call(me, '/api/v1/auth/me', { jar })).status).toBe(401);

    await enrollTwoFactor(email, jar);
    expect((await call(me, '/api/v1/auth/me', { jar })).body.data.twoFactorPending).toBe(false);

    const refused = await call(disable2fa, '/api/v1/account/2fa/disable', {
      method: 'POST',
      jar,
      body: { password: getSeedDevPassword() },
    });
    expect(refused.status).toBe(403);
  });

  it('Employer signup ends in authenticator enrolment, not a signed-in session', async () => {
    // signUpEmployer signs the new account in through the normal path, so a
    // brand-new employer — who has no authenticator yet — gets the setup
    // token instead of a session. (Before the employer 2FA change this threw
    // "A new employer account cannot have 2FA".)
    const email = uniqueEmail('employer2fa');
    const codeRes = await call(signupCode, '/x', { method: 'POST', body: { email } });
    expect(codeRes.status).toBe(202);
    const code = lastMailTo(email).subject.match(/^(\d{6})/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const done = await call(signupComplete, '/x', {
      method: 'POST',
      body: { email, code, fullName: 'Two Factor Owner', password: getSeedDevPassword() },
    });
    expect(done.status).toBe(200);
    expect(done.body.data.kind).toBe('two_factor_setup_required');
    expect(done.body.data.setupToken?.startsWith('v1.')).toBe(true);
  });
});
