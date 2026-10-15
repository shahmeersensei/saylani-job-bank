import 'server-only';
import { schema, type GeoPoint } from '@jobbank/db';
import { radiusValueSchema, type ResolvedRadius } from '@jobbank/shared';
import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { runCommand, type RequestContext } from '@/domains/shared/audit';
import { ConflictError, NotFoundError } from '@/domains/shared/errors';
import {
  assertBranchAccess,
  assertPermission,
  branchScope,
  type Actor,
} from '@/domains/shared/scope';
import { branchRadii, deleteRadiusPolicy, writeRadiusPolicy } from '@/domains/settings';
import { db, type DbExecutor } from '@/lib/db';
import { toGeography } from '@/lib/geospatial';

export interface BranchView {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  location: GeoPoint | null;
  /** Effective matching radius: the branch's own policy, else the global one (M5). */
  matchRadius: ResolvedRadius;
  isActive: boolean;
  /** Distinct staff accounts (Branch Admin, Verifier, Staff) assigned here. */
  staffCount: number;
}

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/** Editable fields, without defaults (a default would leak into every PATCH). */
const branchFields = z.object({
  name: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  location: point,
  /**
   * The branch's own matching radius (BRANCH policy, within the global max). `null`
   * removes it so the branch follows the global radius; omitted = unchanged.
   */
  matchRadius: radiusValueSchema.nullable().optional(),
});

export const createBranchSchema = branchFields.extend({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, 'Use letters, digits and dashes, e.g. KHI-GULSHAN')
    .max(24),
});

/** Code is permanent (it appears in candidate codes like JB-KHI-00412). */
export const updateBranchSchema = branchFields.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

const b = schema.branches;
const columns = {
  id: b.id,
  code: b.code,
  name: b.name,
  city: b.city,
  address: b.address,
  phone: b.phone,
  location: b.location,
  isActive: b.isActive,
};

type BranchRow = Omit<BranchView, 'staffCount' | 'matchRadius'>;

async function withStaffCounts(rows: BranchRow[]): Promise<BranchView[]> {
  if (rows.length === 0) return [];
  const radii = await branchRadii(rows.map((r) => r.id));
  const counts = await db
    .select({
      branchId: schema.userRoles.branchId,
      staff: sql<number>`count(distinct ${schema.userRoles.userId})`.mapWith(Number),
    })
    .from(schema.userRoles)
    .where(
      inArray(
        schema.userRoles.branchId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(schema.userRoles.branchId);
  const byBranch = new Map(counts.map((c) => [c.branchId, c.staff]));
  return rows.map((row) => ({
    ...row,
    matchRadius: radii.get(row.id)!,
    staffCount: byBranch.get(row.id) ?? 0,
  }));
}

/** Branches the actor may see (PRD rule 1). */
export async function listBranches(actor: Actor): Promise<BranchView[]> {
  const rows = await db
    .select(columns)
    .from(b)
    .where(branchScope(actor, b.id))
    .orderBy(asc(b.name));
  return withStaffCounts(rows);
}

export async function getBranch(actor: Actor, branchId: string): Promise<BranchView> {
  const [branch] = await db.select(columns).from(b).where(eq(b.id, branchId));
  if (!branch) throw new NotFoundError('Branch', branchId);
  assertBranchAccess(actor, branch.id, { entityType: 'branch', entityId: branch.id });
  return (await withStaffCounts([branch]))[0]!;
}

/** Public contact details of a branch (shown to applicants, e.g. for account recovery). */
export interface BranchContact {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

export async function getBranchContact(
  branchId: string,
  executor: DbExecutor = db,
): Promise<BranchContact | null> {
  const [row] = await executor
    .select({
      id: b.id,
      code: b.code,
      name: b.name,
      city: b.city,
      address: b.address,
      phone: b.phone,
      isActive: b.isActive,
    })
    .from(b)
    .where(eq(b.id, branchId));
  return row ?? null;
}

export interface BranchOption extends BranchContact {
  /** Geodesic distance from the given point; null when the branch has no map pin. */
  distanceM: number | null;
}

/**
 * Active branches nearest-first from `point` (applicants choosing their branch; the first
 * one is the suggestion). Branches without a pin come last.
 */
export async function listBranchOptions(point: GeoPoint): Promise<BranchOption[]> {
  const distance = sql<number | null>`ST_Distance(${b.location}, ${toGeography(point)})`.mapWith(
    (v) => (v === null ? null : Number(v)),
  );
  const rows = await db
    .select({
      id: b.id,
      code: b.code,
      name: b.name,
      city: b.city,
      address: b.address,
      phone: b.phone,
      isActive: b.isActive,
      distanceM: distance,
    })
    .from(b)
    .where(eq(b.isActive, true))
    .orderBy(sql`${distance} asc nulls last`, asc(b.name));
  return rows.map((row) => ({
    ...row,
    distanceM: row.distanceM === null ? null : Math.round(row.distanceM),
  }));
}

type SignedIn = RequestContext & { actor: Actor };

/** Value equality that ignores object key order (the DB returns points as { lng, lat }). */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

export async function createBranch(ctx: SignedIn, input: CreateBranchInput): Promise<BranchView> {
  assertPermission(ctx.actor, 'branch:manage');
  const id = await runCommand(ctx, async (cmd) => {
    const { tx, audit } = cmd;
    const [taken] = await tx.select({ id: b.id }).from(b).where(eq(b.code, input.code));
    if (taken) throw new ConflictError(`Branch code ${input.code} is already used`);
    const [created] = await tx
      .insert(b)
      .values({
        code: input.code,
        name: input.name,
        city: input.city,
        address: input.address ?? null,
        phone: input.phone ?? null,
        location: input.location,
      })
      .returning({ id: b.id });
    const { matchRadius, ...fields } = input;
    audit({
      action: 'branch.create',
      entityType: 'branch',
      entityId: created!.id,
      branchId: created!.id,
      after: fields,
    });
    if (matchRadius) {
      await writeRadiusPolicy(cmd, { scope: 'BRANCH', branchId: created!.id }, matchRadius);
    }
    return created!.id;
  });
  return getBranch(ctx.actor, id);
}

export async function updateBranch(
  ctx: SignedIn,
  branchId: string,
  patch: UpdateBranchInput,
): Promise<BranchView> {
  assertPermission(ctx.actor, 'branch:manage');
  const { matchRadius, ...fields } = patch;
  const [before] = await db.select(columns).from(b).where(eq(b.id, branchId));
  if (!before) throw new NotFoundError('Branch', branchId);
  // The form sends every field: only the ones that really differ are written and audited.
  const changes = Object.fromEntries(
    Object.entries(fields).filter(
      ([k, v]) => v !== undefined && canonical(v) !== canonical(before[k as keyof typeof before]),
    ),
  );
  if (Object.keys(changes).length === 0 && matchRadius === undefined) {
    return getBranch(ctx.actor, branchId);
  }
  await runCommand(
    ctx,
    async (cmd) => {
      const { tx, audit } = cmd;
      // Radius changes are audited by the policy writes themselves.
      if (matchRadius) await writeRadiusPolicy(cmd, { scope: 'BRANCH', branchId }, matchRadius);
      if (matchRadius === null) await deleteRadiusPolicy(cmd, { scope: 'BRANCH', branchId });
      if (Object.keys(changes).length === 0) return;
      await tx.update(b).set(changes).where(eq(b.id, branchId));
      audit({
        action:
          changes.isActive === false
            ? 'branch.deactivate'
            : changes.isActive === true
              ? 'branch.activate'
              : 'branch.update',
        entityType: 'branch',
        entityId: branchId,
        branchId,
        before: Object.fromEntries(
          Object.keys(changes).map((k) => [k, before[k as keyof typeof before]]),
        ),
        after: changes,
      });
    },
    { audited: false },
  );
  return getBranch(ctx.actor, branchId);
}

/** How many active branches exist (used by the Super Admin overview). */
export async function countBranches(): Promise<{ total: number; active: number }> {
  const [row] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${b.isActive})`.mapWith(Number),
    })
    .from(b);
  return { total: row?.total ?? 0, active: row?.active ?? 0 };
}
