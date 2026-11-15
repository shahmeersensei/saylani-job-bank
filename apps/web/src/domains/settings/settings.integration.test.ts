import { schema } from '@jobbank/db';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createBranchRoute } from '@/app/api/v1/branches/route';
import { PATCH as patchHoliday } from '@/app/api/v1/holidays/[id]/route';
import { GET as listHolidaysRoute, POST as createHolidayRoute } from '@/app/api/v1/holidays/route';
import { PATCH as patchItem } from '@/app/api/v1/master-data/[id]/route';
import { GET as listItems, POST as createItem } from '@/app/api/v1/master-data/route';
import {
  DELETE as clearBranchRadius,
  PUT as putBranchRadius,
} from '@/app/api/v1/radius-policies/branches/[branchId]/route';
import { PUT as putCategoryRadius } from '@/app/api/v1/radius-policies/categories/[categoryId]/route';
import { PUT as putGlobalRadius } from '@/app/api/v1/radius-policies/global/route';
import { GET as resolveRoute } from '@/app/api/v1/radius-policies/resolve/route';
import { GET as radiusOverview } from '@/app/api/v1/radius-policies/route';
import { PUT as putSetting } from '@/app/api/v1/settings/[key]/route';
import { GET as listSettingsRoute } from '@/app/api/v1/settings/route';
import { resetMemoryRateLimits } from '@/domains/shared/rate-limit';
import { db } from '@/lib/db';
import { call, type Jar, owner, signInWith2fa, signInAdmin } from '@/test/api-client';
import { getWorkingCalendar, resolveMatchRadius, slaDueDate } from '.';

const branchId = async (code: string) =>
  (
    await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.code, code))
  )[0]!.id;

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
let KHI: string;
let LHR: string;

beforeAll(async () => {
  superAdmin = await signInAdmin('superadmin@jobbank.local');
  branchAdmin = await signInAdmin('branchadmin.khi@jobbank.local');
  staff = await signInWith2fa('staff.khi@jobbank.local');
  KHI = await branchId('KHI-GULSHAN');
  LHR = await branchId('LHR-JOHAR');
});
beforeEach(() => resetMemoryRateLimits());

/** Branches/categories created by these tests — removed again so later runs
 * (and other files sharing the test DB) never see a second active Karachi
 * branch. A leftover "Radius test branch" used to hijack applicant branch
 * assignment in applicant.integration.test.ts. */
const createdBranchIds: string[] = [];
const createdCategoryIds: string[] = [];

/** Global state touched by these tests goes back to the seeded defaults. */
async function restoreGlobals() {
  await owner`UPDATE match_radius_policies SET preferred_m = 8000, max_m = 10000 WHERE scope = 'GLOBAL'`;
  await owner`DELETE FROM match_radius_policies WHERE branch_id IN (${KHI}, ${LHR})`;
  await owner`DELETE FROM system_settings WHERE branch_id IS NULL`;
  for (const id of createdBranchIds) {
    await owner`DELETE FROM match_radius_policies WHERE branch_id = ${id}`;
    await owner`DELETE FROM branches WHERE id = ${id}`;
  }
  createdBranchIds.length = 0;
  for (const id of createdCategoryIds) {
    await owner`DELETE FROM match_radius_policies WHERE category_id = ${id}`;
    await owner`DELETE FROM master_data WHERE id = ${id}`;
  }
  createdCategoryIds.length = 0;
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

// ─── Matching radius ──────────────────────────────────────────────────

describe('matching radius policies', () => {
  const putBranch = (jar: Jar, id: string, body: object) =>
    call(putBranchRadius, `/api/v1/radius-policies/branches/${id}`, {
      method: 'PUT',
      jar,
      params: { branchId: id },
      body,
    });
  const putGlobal = (jar: Jar, body: object) =>
    call(putGlobalRadius, '/api/v1/radius-policies/global', { method: 'PUT', jar, body });

  it('resolves job → category → branch → global, capped by the global max', async () => {
    await restoreGlobals();
    const branch = await call(createBranchRoute, '/api/v1/branches', {
      method: 'POST',
      jar: superAdmin,
      headers: idem(),
      body: {
        code: `R-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'Radius test branch',
        // Round 3: NOT Karachi — a leftover Karachi branch used to win the
        // applicant location auto-assignment lottery over KHI-GULSHAN (the
        // old unordered LIMIT 1). The radius test never needs the city.
        city: 'Hyderabad',
        location: { lat: 24.9, lng: 67.1 },
      },
    });
    const bId = branch.body.data.id;
    createdBranchIds.push(bId);
    expect(branch.body.data.matchRadius).toMatchObject({ maxM: 10_000, source: 'GLOBAL' });

    const category = await call(createItem, '/api/v1/master-data', {
      method: 'POST',
      jar: superAdmin,
      headers: idem(),
      body: { type: 'JOB_CATEGORY', code: code('RADIUS'), label: 'Radius test category' },
    });
    const cId = category.body.data.id;
    createdCategoryIds.push(cId);

    expect(await resolveMatchRadius({ branchId: bId, categoryId: cId })).toMatchObject({
      preferredM: 8000,
      maxM: 10_000,
      source: 'GLOBAL',
    });

    expect((await putBranch(superAdmin, bId, { preferredM: 4000, maxM: 6000 })).status).toBe(200);
    expect(await resolveMatchRadius({ branchId: bId, categoryId: cId })).toMatchObject({
      maxM: 6000,
      source: 'BRANCH',
    });

    const cat = await call(putCategoryRadius, `/api/v1/radius-policies/categories/${cId}`, {
      method: 'PUT',
      jar: superAdmin,
      params: { categoryId: cId },
      body: { preferredM: 7000, maxM: 9000 },
    });
    expect(cat.status, JSON.stringify(cat.body)).toBe(200);
    expect(await resolveMatchRadius({ branchId: bId, categoryId: cId })).toMatchObject({
      preferredM: 7000,
      maxM: 9000,
      source: 'CATEGORY',
    });
    expect(await resolveMatchRadius({ branchId: bId })).toMatchObject({ source: 'BRANCH' });

    // Lowering the global max tightens every override at resolution time.
    expect((await putGlobal(superAdmin, { preferredM: 5000, maxM: 7000 })).status).toBe(200);
    const preview = await call(
      resolveRoute,
      `/api/v1/radius-policies/resolve?branchId=${bId}&categoryId=${cId}`,
      { jar: superAdmin },
    );
    expect(preview.body.data).toEqual({
      preferredM: 7000,
      maxM: 7000,
      source: 'CATEGORY',
      capped: true,
    });

    await restoreGlobals();
    await owner`DELETE FROM match_radius_policies WHERE branch_id = ${bId} OR category_id = ${cId}`;
  });

  it('Branch Admin overrides only their own branch, within the global max', async () => {
    await restoreGlobals();
    const own = await putBranch(branchAdmin, KHI, { preferredM: 5000, maxM: 9000 });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.data.branches).toEqual([
      expect.objectContaining({ branchId: KHI, preferredM: 5000, maxM: 9000 }),
    ]);
    expect(await lastAudit('radius_policy.create', KHI)).toMatchObject({
      after: { preferredM: 5000, maxM: 9000 },
    });

    expect((await putBranch(branchAdmin, KHI, { preferredM: 5000, maxM: 12_000 })).status).toBe(
      422,
    );
    expect((await putBranch(branchAdmin, KHI, { preferredM: 9500, maxM: 9000 })).status).toBe(422);

    await putGlobal(superAdmin, { preferredM: 6000, maxM: 8000 });
    const aboveGlobal = await putBranch(branchAdmin, KHI, { preferredM: 5000, maxM: 8500 });
    expect(aboveGlobal.status).toBe(422);
    expect(aboveGlobal.body.error.issues[0]).toMatchObject({ path: 'maxM' });

    const otherBranch = await putBranch(branchAdmin, LHR, { preferredM: 5000, maxM: 6000 });
    expect(otherBranch.status).toBe(403);
    expect(await lastAudit('access.scope_violation', LHR)).toBeDefined();

    expect((await putGlobal(branchAdmin, { preferredM: 5000, maxM: 6000 })).status).toBe(403);

    const reset = await call(clearBranchRadius, `/api/v1/radius-policies/branches/${KHI}`, {
      method: 'DELETE',
      jar: branchAdmin,
      params: { branchId: KHI },
    });
    expect(reset.body.data.branches).toEqual([]);
    expect(await resolveMatchRadius({ branchId: KHI })).toMatchObject({ source: 'GLOBAL' });

    expect((await call(radiusOverview, '/api/v1/radius-policies', { jar: staff })).status).toBe(
      403,
    );
    await restoreGlobals();
  });
});
