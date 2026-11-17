import { ROLE_PERMISSIONS, TWO_FACTOR_REQUIRED_ROLES, type Role } from '@jobbank/shared';
import { schema } from '@jobbank/db';
import { DEV_USERS, getSeedDevPassword } from '@jobbank/db/seed/dev-data';
import { and, count, desc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as logoutRoute } from '@/app/api/v1/auth/logout/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as otpRequest } from '@/app/api/v1/auth/otp/request/route';
import { POST as otpVerify } from '@/app/api/v1/auth/otp/verify/route';
import { PUT as scope } from '@/app/api/v1/auth/scope/route';
import { GET as getBranchRoute } from '@/app/api/v1/branches/[id]/route';
import { GET as listBranchesRoute } from '@/app/api/v1/branches/route';
import { GET as listMasterDataRoute } from '@/app/api/v1/master-data/route';
import { GET as listSettingsRoute } from '@/app/api/v1/settings/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { devOutbox } from '@/lib/sms/sms';
import { call, Jar, owner, signIn, signInAdmin } from '@/test/api-client';

/** 2FA-required roles must enrol an authenticator; the helper enrols it on first sign-in in this file. */
async function signInWithPassword(email: string) {
  const needs2fa = DEV_USERS.find((u) => u.email === email)?.roles.some((r) =>
    (TWO_FACTOR_REQUIRED_ROLES as readonly string[]).includes(r.role),
  );
  return needs2fa ? signInAdmin(email) : signIn(email);
}

async function signInWithOtp(phone: string) {
  const jar = new Jar();
  await call(otpRequest, '/api/v1/auth/otp/request', { method: 'POST', body: { phone } });
  const code = lastCodeFor(phone);
  const res = await call(otpVerify, '/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { phone, code },
    jar,
  });
  expect(res.status).toBe(200);
  return { jar, body: res.body };
}

function lastCodeFor(phone: string): string {
  const message = [...devOutbox].reverse().find((m) => m.to === phone);
  const code = message?.message.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no SMS captured for ${phone}`);
  return code;
}

const randomPhone = () => `+92345${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const branchId = async (code: string) =>
  (
    await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.code, code))
  )[0]!.id;

beforeEach(() => resetMemoryRateLimits());

// ─── Role × endpoint matrix (M3 "done when") ─────────────────────────

const passwordUsers = DEV_USERS.filter((u) => u.password && u.status !== 'DISABLED');

describe('role × endpoint access matrix', () => {
  it.each(passwordUsers.map((u) => [u.roles[0]!.role, u.email] as const))(
    '%s (%s)',
    async (role, email) => {
      const jar = await signInWithPassword(email);

      const profile = await call(me, '/api/v1/auth/me', { jar });
      expect(profile.status).toBe(200);
      expect(profile.body.data.roles).toEqual([role]);
      expect(profile.body.data.permissions.sort()).toEqual(
        [...ROLE_PERMISSIONS[role as Role]].sort(),
      );

      const branches = await call(listBranchesRoute, '/api/v1/branches', { jar });
      expect(branches.status).toBe(
        ROLE_PERMISSIONS[role as Role].includes('branch:read') ? 200 : 403,
      );

      const switchScope = await call(scope, '/api/v1/auth/scope', {
        method: 'PUT',
        body: { branchId: null },
        jar,
      });
      expect(switchScope.status).toBe(role === 'SUPER_ADMIN' ? 200 : 403);

      // M5: settings are for admins; reference lists are for every signed-in user.
      const canManageSettings = ROLE_PERMISSIONS[role as Role].includes('settings:manage');
      expect((await call(listSettingsRoute, '/api/v1/settings', { jar })).status).toBe(
        canManageSettings ? 200 : 403,
      );
      expect(
        (await call(listMasterDataRoute, '/api/v1/master-data?type=SKILL', { jar })).status,
      ).toBe(200);
    },
  );

  it('applicants (phone sign-in) can read their profile but not branches', async () => {
    const { jar } = await signInWithOtp('+923001234567');
    expect((await call(me, '/api/v1/auth/me', { jar })).body.data.roles).toEqual(['APPLICANT']);
    expect((await call(listBranchesRoute, '/api/v1/branches', { jar })).status).toBe(403);
    expect(
      (await call(listMasterDataRoute, '/api/v1/master-data?type=SKILL', { jar })).status,
    ).toBe(200);
  });

  it('anonymous callers get 401 everywhere protected', async () => {
    expect((await call(me, '/api/v1/auth/me')).status).toBe(401);
    expect((await call(listBranchesRoute, '/api/v1/branches')).status).toBe(401);
    expect((await call(listMasterDataRoute, '/api/v1/master-data?type=SKILL')).status).toBe(401);
  });
});

// ─── Branch scoping ───────────────────────────────────────────────────

describe('branch scope (PRD rule 1)', () => {
  it('staff see only their branch; cross-branch reads are refused AND audited', async () => {
    const jar = await signInWithPassword('staff.khi@jobbank.local');
    const [khi, lhr] = [await branchId('KHI-GULSHAN'), await branchId('LHR-JOHAR')];

    const list = await call(listBranchesRoute, '/api/v1/branches', { jar });
    expect(list.body.data.map((b: { code: string }) => b.code)).toEqual(['KHI-GULSHAN']);
    expect(
      (await call(getBranchRoute, `/api/v1/branches/${khi}`, { jar, params: { id: khi } })).status,
    ).toBe(200);

    const denied = await call(getBranchRoute, `/api/v1/branches/${lhr}`, {
      jar,
      params: { id: lhr },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('SCOPE_VIOLATION');

    const [row] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, 'access.scope_violation'),
          eq(schema.auditLogs.correlationId, denied.body.error.correlation_id),
        ),
      );
    expect(row).toMatchObject({
      entityType: 'branch',
      entityId: lhr,
      branchId: lhr,
      actorRole: 'STAFF',
    });
    expect(row?.actorUserId).toBeTruthy();
  });

  it('Super Admin sees every branch, and can narrow to one (audited)', async () => {
    const jar = await signInWithPassword('superadmin@jobbank.local');
    const all = await call(listBranchesRoute, '/api/v1/branches', { jar });
    // The test DB persists between runs (other suites add branches), so compare with the table.
    const [{ total }] = (await db.select({ total: count() }).from(schema.branches)) as [
      { total: number },
    ];
    expect(all.body.data).toHaveLength(total);
    expect(all.body.data.map((b: { code: string }) => b.code)).toEqual(
      expect.arrayContaining(['KHI-GULSHAN', 'LHR-JOHAR']),
    );

    const lhr = await branchId('LHR-JOHAR');
    expect(
      (await call(scope, '/api/v1/auth/scope', { method: 'PUT', body: { branchId: lhr }, jar }))
        .status,
    ).toBe(200);
    const narrowed = await call(listBranchesRoute, '/api/v1/branches', { jar });
    expect(narrowed.body.data.map((b: { code: string }) => b.code)).toEqual(['LHR-JOHAR']);

    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'auth.scope_switch'))
      .orderBy(desc(schema.auditLogs.id))
      .limit(1);
    expect(audit?.after).toEqual({ activeBranchId: lhr });

    expect(
      (await call(scope, '/api/v1/auth/scope', { method: 'PUT', body: { branchId: null }, jar }))
        .status,
    ).toBe(200);
    expect((await call(listBranchesRoute, '/api/v1/branches', { jar })).body.data).toHaveLength(
      total,
    );
  });
});

// ─── Password sign-in ─────────────────────────────────────────────────

describe('email + password sign-in', () => {
  it('gives the same answer for a wrong password and an unknown email, and audits both', async () => {
    const wrong = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'employer@jobbank.local', password: 'not-the-password' },
    });
    const unknown = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'ghost@jobbank.local', password: 'not-the-password' },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);

    const failures = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.correlationId, wrong.body.error.correlation_id));
    expect(failures[0]).toMatchObject({ action: 'auth.login_failed' });
    expect(JSON.stringify(failures[0]?.metadata)).not.toContain('employer@jobbank.local');
  });

  it('only reveals a disabled account to someone who knows its password', async () => {
    const right = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'disabled.staff@jobbank.local', password: getSeedDevPassword() },
    });
    expect(right.status).toBe(403);
    expect(right.body.error.details).toEqual({ reason: 'ACCOUNT_DISABLED' });

    const wrong = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'disabled.staff@jobbank.local', password: 'not-the-password' },
    });
    expect(wrong.status).toBe(401);
  });

  it('locks an email after 5 attempts in 15 minutes', async () => {
    const attempt = () =>
      call(login, '/api/v1/auth/login', {
        method: 'POST',
        body: { email: 'verifier.khi@jobbank.local', password: 'nope-nope-nope' },
      });
    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('refuses cross-site sign-in posts (CSRF)', async () => {
    const res = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'employer@jobbank.local', password: getSeedDevPassword() },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});

// ─── Phone OTP sign-in ────────────────────────────────────────────────

describe('applicant phone OTP', () => {
  it('registers a new applicant on first verification and stores only a hash of the code', async () => {
    const phone = randomPhone();
    const requested = await call(otpRequest, '/api/v1/auth/otp/request', {
      method: 'POST',
      body: { phone },
    });
    expect(requested.status).toBe(202);
    const code = lastCodeFor(phone);

    const [challenge] = await db
      .select()
      .from(schema.otpChallenges)
      .where(eq(schema.otpChallenges.phoneNumber, phone));
    expect(challenge!.codeHash).not.toContain(code);
    expect(challenge!.codeHash).toHaveLength(43);

    const jar = new Jar();
    const verified = await call(otpVerify, '/api/v1/auth/otp/verify', {
      method: 'POST',
      body: { phone, code },
      jar,
    });
    expect(verified.status).toBe(200);
    expect(verified.body.data).toMatchObject({
      roles: ['APPLICANT'],
      homePath: '/applicant',
      user: { email: null, phoneNumber: phone },
    });

    const profile = await call(me, '/api/v1/auth/me', { jar });
    expect(profile.body.data.roles).toEqual(['APPLICANT']);

    // Codes are single-use.
    const reuse = await call(otpVerify, '/api/v1/auth/otp/verify', {
      method: 'POST',
      body: { phone, code },
    });
    expect(reuse.status).toBe(401);
  });

  it('locks a code after 5 wrong attempts, even if the right code follows', async () => {
    const phone = randomPhone();
    await call(otpRequest, '/api/v1/auth/otp/request', { method: 'POST', body: { phone } });
    const code = lastCodeFor(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      expect(
        (
          await call(otpVerify, '/api/v1/auth/otp/verify', {
            method: 'POST',
            body: { phone, code: wrong },
          })
        ).status,
      ).toBe(401);
    }
    const locked = await call(otpVerify, '/api/v1/auth/otp/verify', {
      method: 'POST',
      body: { phone, code },
    });
    expect(locked.status).toBe(401);
  });

  it('rejects expired codes', async () => {
    const phone = randomPhone();
    await call(otpRequest, '/api/v1/auth/otp/request', { method: 'POST', body: { phone } });
    await owner`UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE phone_number = ${phone}`;
    const res = await call(otpVerify, '/api/v1/auth/otp/verify', {
      method: 'POST',
      body: { phone, code: lastCodeFor(phone) },
    });
    expect(res.status).toBe(401);
  });

  it('a newer code supersedes the previous one', async () => {
    const phone = randomPhone();
    await call(otpRequest, '/api/v1/auth/otp/request', { method: 'POST', body: { phone } });
    const first = lastCodeFor(phone);
    resetMemoryRateLimits(); // skip the 60-second resend wait
    await call(otpRequest, '/api/v1/auth/otp/request', { method: 'POST', body: { phone } });
    const second = lastCodeFor(phone);
    if (first !== second) {
      expect(
        (
          await call(otpVerify, '/api/v1/auth/otp/verify', {
            method: 'POST',
            body: { phone, code: first },
          })
        ).status,
      ).toBe(401);
    }
    expect(
      (
        await call(otpVerify, '/api/v1/auth/otp/verify', {
          method: 'POST',
          body: { phone, code: second },
        })
      ).status,
    ).toBe(200);
  });

  it('rate-limits resends to one per minute', async () => {
    const phone = randomPhone();
    expect(
      (await call(otpRequest, '/api/v1/auth/otp/request', { method: 'POST', body: { phone } }))
        .status,
    ).toBe(202);
    const again = await call(otpRequest, '/api/v1/auth/otp/request', {
      method: 'POST',
      body: { phone },
    });
    expect(again.status).toBe(429);
  });

  it('rejects numbers that are not Pakistani mobiles', async () => {
    const res = await call(otpRequest, '/api/v1/auth/otp/request', {
      method: 'POST',
      body: { phone: '0213 4567890' },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.issues[0].path).toBe('phone');
  });
});

// ─── Sessions ─────────────────────────────────────────────────────────

describe('sessions', () => {
  it('logout ends the session', async () => {
    const jar = await signInWithPassword('employer@jobbank.local');
    expect((await call(me, '/api/v1/auth/me', { jar })).status).toBe(200);
    expect((await call(logoutRoute, '/api/v1/auth/logout', { method: 'POST', jar })).status).toBe(
      204,
    );
    expect((await call(me, '/api/v1/auth/me', { jar })).status).toBe(401);
  });

  it('disabling a user cuts off their existing session immediately', async () => {
    const jar = await signInWithPassword('staff.lhr@jobbank.local');
    expect((await call(me, '/api/v1/auth/me', { jar })).status).toBe(200);
    await owner`UPDATE users SET status = 'DISABLED' WHERE email = 'staff.lhr@jobbank.local'`;
    try {
      expect((await call(me, '/api/v1/auth/me', { jar })).status).toBe(401);
    } finally {
      await owner`UPDATE users SET status = 'ACTIVE' WHERE email = 'staff.lhr@jobbank.local'`;
    }
  });
});
