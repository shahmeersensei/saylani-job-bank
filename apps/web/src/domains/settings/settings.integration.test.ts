import { schema } from '@jobbank/db';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PATCH as patchHoliday } from '@/app/api/v1/holidays/[id]/route';
import { GET as listHolidaysRoute, POST as createHolidayRoute } from '@/app/api/v1/holidays/route';
import { PATCH as patchItem } from '@/app/api/v1/master-data/[id]/route';
import { GET as listItems, POST as createItem } from '@/app/api/v1/master-data/route';
import { PUT as putSetting } from '@/app/api/v1/settings/[key]/route';
import { GET as listSettingsRoute } from '@/app/api/v1/settings/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { call, type Jar, owner, signInWith2fa, signInAdmin } from '@/test/api-client';
import { getWorkingCalendar, slaDueDate } from '.';

const lastAudit = async (action: string, entityId: string) =>
  (
    await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, action), eq(schema.auditLogs.entityId, entityId)))
      .orderBy(desc(schema.auditLogs.id))
      .limit(1)
  )[0];

const code = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
const idem = () => ({ 'idempotency-key': crypto.randomUUID() });

let superAdmin: Jar;
let branchAdmin: Jar;
let staff: Jar;

beforeAll(async () => {
  superAdmin = await signInAdmin('superadmin@jobbank.local');
  branchAdmin = await signInAdmin('branchadmin.khi@jobbank.local');
  staff = await signInWith2fa('staff.khi@jobbank.local');
});
beforeEach(() => resetMemoryRateLimits());

/** Global state touched by these tests goes back to the seeded defaults. */
async function restoreGlobals() {
  await owner`DELETE FROM system_settings WHERE branch_id IS NULL`;
}
afterAll(restoreGlobals);

// ─── Master data ──────────────────────────────────────────────────────

describe('master data', () => {
  it('lists seeded items to any signed-in user, but not to anonymous callers', async () => {
    const skills = await call(listItems, '/api/v1/master-data?type=SKILL', { jar: staff });
    expect(skills.status).toBe(200);
    expect(skills.body.data.map((s: { code: string }) => s.code)).toContain('PLUMBING');

    const cities = await call(listItems, '/api/v1/master-data?type=CITY', { jar: staff });
    expect(cities.body.data.find((c: { code: string }) => c.code === 'KARACHI')).toMatchObject({
      label: 'Karachi',
      meta: { province: 'SINDH' },
    });

    expect((await call(listItems, '/api/v1/master-data?type=SKILL')).status).toBe(401);
    expect((await call(listItems, '/api/v1/master-data?type=PLANET', { jar: staff })).status).toBe(
      422,
    );
  });

  it('Super Admin creates items idempotently; codes are unique per list and permanent', async () => {
    const body = {
      type: 'EDUCATION_LEVEL',
      code: code('CERT').toLowerCase(),
      label: 'Short course certificate',
      meta: { rank: 3 },
    };
    const headers = idem();
    const first = await call(createItem, '/api/v1/master-data', {
      method: 'POST',
      jar: superAdmin,
      headers,
      body,
    });
    const retry = await call(createItem, '/api/v1/master-data', {
      method: 'POST',
      jar: superAdmin,
      headers,
      body,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(first.body.data).toMatchObject({ code: body.code.toUpperCase(), meta: { rank: 3 } });

    const dup = await call(createItem, '/api/v1/master-data', {
      method: 'POST',
      jar: superAdmin,
      headers: idem(),
      body,
    });
    expect(dup.status).toBe(409);

    const id = first.body.data.id;
    const edited = await call(patchItem, `/api/v1/master-data/${id}`, {
      method: 'PATCH',
      jar: superAdmin,
      params: { id },
      body: { label: 'Short course', code: 'HACKED', type: 'SKILL' },
    });
    expect(edited.body.data).toMatchObject({
      label: 'Short course',
      code: body.code.toUpperCase(),
      type: 'EDUCATION_LEVEL',
    });
  });

  it('validates meta per type and parent rules', async () => {
    const post = (body: object) =>
      call(createItem, '/api/v1/master-data', {
        method: 'POST',
        jar: superAdmin,
        headers: idem(),
        body,
      });

    const noRank = await post({ type: 'EDUCATION_LEVEL', code: code('X'), label: 'No rank' });
    expect(noRank.status).toBe(422);
    expect(noRank.body.error.issues[0].path).toBe('meta.rank');

    const typo = await post({ type: 'LANGUAGE', code: code('X'), label: 'Typo', meta: { foo: 1 } });
    expect(typo.status).toBe(422);

    const orphanArea = await post({ type: 'AREA', code: code('X'), label: 'Orphan area' });
    expect(orphanArea.status).toBe(422);
    expect(orphanArea.body.error.issues[0].path).toBe('parentId');

    const cities = await call(listItems, '/api/v1/master-data?type=CITY', { jar: superAdmin });
    const karachi = cities.body.data.find((c: { code: string }) => c.code === 'KARACHI').id;
    const skillUnderCity = await post({
      type: 'SKILL',
      code: code('X'),
      label: 'Wrong parent',
      parentId: karachi,
    });
    expect(skillUnderCity.status).toBe(422);

    const area = await post({
      type: 'AREA',
      code: code('KHI'),
      label: 'Test area',
      parentId: karachi,
    });
    expect(area.status, JSON.stringify(area.body)).toBe(201);
  });

  it('deactivated items disappear from lists except for managers, and the change is audited', async () => {
    const created = await call(createItem, '/api/v1/master-data', {
      method: 'POST',
      jar: superAdmin,
      headers: idem(),
      body: { type: 'LANGUAGE', code: code('LANG'), label: 'Test language' },
    });
    const id = created.body.data.id;
    await call(patchItem, `/api/v1/master-data/${id}`, {
      method: 'PATCH',
      jar: superAdmin,
      params: { id },
      body: { isActive: false },
    });

    const ids = (r: { body: { data: { id: string }[] } }) => r.body.data.map((i) => i.id);
    const forStaff = await call(
      listItems,
      '/api/v1/master-data?type=LANGUAGE&includeInactive=true',
      {
        jar: staff,
      },
    );
    expect(ids(forStaff)).not.toContain(id);
    const forAdmin = await call(
      listItems,
      '/api/v1/master-data?type=LANGUAGE&includeInactive=true',
      { jar: superAdmin },
    );
    expect(ids(forAdmin)).toContain(id);

    expect((await lastAudit('master_data.deactivate', id))?.before).toEqual({ isActive: true });
  });

  it('only Super Admin manages master data', async () => {
    const denied = await call(createItem, '/api/v1/master-data', {
      method: 'POST',
      jar: branchAdmin,
      headers: idem(),
      body: { type: 'LANGUAGE', code: code('LANG'), label: 'Nope' },
    });
    expect(denied.status).toBe(403);
  });
});

// ─── Holidays and the working-day calendar ────────────────────────────

describe('holidays', () => {
  it('Super Admin adds, lists and deactivates holidays; dates are unique', async () => {
    const date = `2099-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-1${Math.floor(Math.random() * 9)}`;
    await owner`DELETE FROM holidays WHERE date = ${date}`;
    const created = await call(createHolidayRoute, '/api/v1/holidays', {
      method: 'POST',
      jar: superAdmin,
      headers: idem(),
      body: { date, name: 'Test holiday' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const again = await call(createHolidayRoute, '/api/v1/holidays', {
      method: 'POST',
      jar: superAdmin,
      headers: idem(),
      body: { date, name: 'Same day' },
    });
    expect(again.status).toBe(409);

    const list = await call(listHolidaysRoute, '/api/v1/holidays?year=2099', { jar: staff });
    expect(list.body.data.map((h: { date: string }) => h.date)).toContain(date);

    const id = created.body.data.id;
    const off = await call(patchHoliday, `/api/v1/holidays/${id}`, {
      method: 'PATCH',
      jar: superAdmin,
      params: { id },
      body: { isActive: false },
    });
    expect(off.body.data.isActive).toBe(false);
    await owner`DELETE FROM holidays WHERE id = ${id}`;

    const bad = await call(createHolidayRoute, '/api/v1/holidays', {
      method: 'POST',
      jar: superAdmin,
      headers: idem(),
      body: { date: '2099-02-30', name: 'Impossible' },
    });
    expect(bad.status).toBe(422);
  });

  it('SLA due dates skip Sundays and seeded holidays', async () => {
    const calendar = await getWorkingCalendar();
    expect(calendar.weekendDays).toEqual([0]);
    expect(calendar.holidays.has('2026-11-09')).toBe(true); // Iqbal Day (seeded)
    // Submitted Saturday 7 Nov 2026: Sun off, Mon 9 holiday → Tue 10, Wed 11.
    expect(slaDueDate(new Date('2026-11-07T10:00:00+05:00'), 2, calendar)).toBe('2026-11-11');
  });
});

// ─── System settings ──────────────────────────────────────────────────

describe('system settings', () => {
  it('lists every setting with its PRD default', async () => {
    await restoreGlobals();
    const res = await call(listSettingsRoute, '/api/v1/settings', { jar: superAdmin });
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      res.body.data.map((s: { key: string; value: unknown }) => [s.key, s.value]),
    );
    expect(byKey).toEqual({
      'matching.hold_expiry_days': 14,
      'decision.counteroffer_max_rounds': 3,
      'placement.followup_days': [7, 30, 90, 180],
      'verification.sla_working_days': 2,
      'calendar.weekend_days': [0],
      'jobs.review_required': false,
    });
  });

  it('Super Admin changes a global value; every change is audited', async () => {
    const put = (key: string, value: unknown, jar = superAdmin) =>
      call(putSetting, `/api/v1/settings/${key}`, {
        method: 'PUT',
        jar,
        params: { key },
        body: { value },
      });

    const changed = await put('matching.hold_expiry_days', 21);
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.data).toMatchObject({ value: 21, isDefault: false, defaultValue: 14 });
    expect(await lastAudit('setting.update', 'matching.hold_expiry_days')).toMatchObject({
      before: { value: 14 },
      after: { value: 21 },
    });
    expect((await put('matching.hold_expiry_days', 30)).body.data.value).toBe(30);

    expect((await put('matching.hold_expiry_days', 0)).status).toBe(422);
    expect((await put('matching.hold_expiry_days', 'two weeks')).body.error.issues[0].path).toBe(
      'value',
    );
    expect((await put('placement.followup_days', [30, 7])).status).toBe(422);
    expect((await put('calendar.weekend_days', [0, 0])).status).toBe(422);
    expect((await put('no.such.key', 1)).status).toBe(422);

    expect((await put('jobs.review_required', true)).body.data.value).toBe(true);
  });

  it('Branch Admin cannot change global settings; staff cannot read them', async () => {
    const denied = await call(putSetting, '/api/v1/settings/jobs.review_required', {
      method: 'PUT',
      jar: branchAdmin,
      params: { key: 'jobs.review_required' },
      body: { value: true },
    });
    expect(denied.status).toBe(403);
    expect((await call(listSettingsRoute, '/api/v1/settings', { jar: staff })).status).toBe(403);
  });
});
