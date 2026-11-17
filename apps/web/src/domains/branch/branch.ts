import 'server-only';
import { schema, type GeoPoint } from '@jobbank/db';
import { pakistanPointSchema, pkPhoneSchema } from '@jobbank/shared';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { runCommand, type RequestContext } from '@/domains/shared/audit';
import { ConflictError, ForbiddenError, NotFoundError } from '@/domains/shared/errors';
import {
  assertBranchAccess,
  assertPermission,
  branchScope,
  type Actor,
} from '@/domains/shared/scope';
import { MAX_UNPAGINATED_LIST_ROWS } from '@/domains/shared/pagination';
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
  isActive: boolean;
  /** Distinct staff accounts (Branch Admin, Verifier, Staff) assigned here. */
  staffCount: number;
}

/** Editable fields, without defaults (a default would leak into every PATCH). */
const branchFields = z.object({
  name: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().max(300).nullable().optional(),
  // A branch phone must be a real Pakistani number (L14); the landline-tolerant
  // schema is right here — branches genuinely have landlines.
  phone: pkPhoneSchema.nullable().optional(),
  // Branch pins must be inside Pakistan, like applicant pins (L14).
  location: pakistanPointSchema,
});

/** Branch code format (create + update): letters, digits and dashes, e.g. KHI-GULSHAN. */
const branchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, 'Use letters, digits and dashes, e.g. KHI-GULSHAN')
  .max(24);

export const createBranchSchema = branchFields.extend({
  code: branchCodeSchema,
});

/**
 * Code is editable by Super Admin only: updateBranch is `branch:manage`
 * gated and only Super Admin holds that permission, and the edit form
 * lives on Super Admin pages only. Changing a code breaks the token codes
 * already issued under it — tokenCodeFor builds them live from
 * branch.code, so old printed slips stop resolving — and history is NOT
 * rewritten when a code changes.
 */
export const updateBranchSchema = branchFields.partial().extend({
  isActive: z.boolean().optional(),
  code: branchCodeSchema.optional(),
});

/** Days a deactivated branch must wait before it can be deleted (2026-11-12; was "40 Days?" in the notes). */
export const BRANCH_DELETE_WAIT_DAYS = 90;

/** Deleting a branch is permanent, so a short reason is recorded in the audit log. */
export const deleteBranchSchema = z.object({
  reason: z.string().trim().min(5, 'Give a short reason (at least 5 characters)').max(500),
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

type BranchRow = Omit<BranchView, 'staffCount'>;

async function withStaffCounts(rows: BranchRow[]): Promise<BranchView[]> {
  if (rows.length === 0) return [];
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
    staffCount: byBranch.get(row.id) ?? 0,
  }));
}

/** Branches the actor may see (PRD rule 1). */
export async function listBranches(actor: Actor): Promise<BranchView[]> {
  const rows = await db
    .select(columns)
    .from(b)
    .where(branchScope(actor, b.id))
    .orderBy(asc(b.name))
    .limit(MAX_UNPAGINATED_LIST_ROWS);
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
    audit({
      action: 'branch.create',
      entityType: 'branch',
      entityId: created!.id,
      branchId: created!.id,
      after: input,
    });
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
  const fields = patch;
  const [before] = await db.select(columns).from(b).where(eq(b.id, branchId));
  if (!before) throw new NotFoundError('Branch', branchId);
  // The form sends every field: only the ones that really differ are written and audited.
  const changes = Object.fromEntries(
    Object.entries(fields).filter(
      ([k, v]) => v !== undefined && canonical(v) !== canonical(before[k as keyof typeof before]),
    ),
  );
  if (Object.keys(changes).length === 0) {
    return getBranch(ctx.actor, branchId);
  }
  await runCommand(
    ctx,
    async (cmd) => {
      const { tx, audit } = cmd;
      if (Object.keys(changes).length === 0) return;
      if (changes.code) {
        const [taken] = await tx
          .select({ id: b.id })
          .from(b)
          .where(and(eq(b.code, changes.code as string), ne(b.id, branchId)));
        if (taken) throw new ConflictError(`Branch code ${changes.code} is already used`);
      }
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

/**
 * Permanently delete a branch. Super Admin only (`branch:manage`), and only
 * after the branch has been deactivated — an active branch cannot be deleted.
 * 90-day rule (2026-11-12): a deactivated branch cannot be deleted until 90
 * days after its deactivation, so a mistaken deactivation can still be
 * undone. The deactivation time is the latest `branch.deactivate` audit
 * row — no schema change. Refuses while anything still points at the branch:
 * staff assignments, applicants, companies, jobs and applications would
 * otherwise be orphaned (jobs / applications carry a plain branch id) or
 * trip the restrict FKs. Its settings rows cascade away with it.
 */
export async function deleteBranch(ctx: SignedIn, branchId: string, reason: string): Promise<void> {
  assertPermission(ctx.actor, 'branch:manage');
  await runCommand(ctx, async ({ tx, audit }) => {
    const [branch] = await tx.select(columns).from(b).where(eq(b.id, branchId));
    if (!branch) throw new NotFoundError('Branch', branchId);
    if (branch.isActive) throw new ForbiddenError('Deactivate the branch before deleting it');
    const [deactivated] = await tx
      .select({ occurredAt: schema.auditLogs.occurredAt })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, 'branch.deactivate'),
          eq(schema.auditLogs.entityType, 'branch'),
          eq(schema.auditLogs.entityId, branchId),
        ),
      )
      .orderBy(desc(schema.auditLogs.occurredAt))
      .limit(1);
    if (deactivated) {
      const eligibleAt = new Date(
        deactivated.occurredAt.getTime() + BRANCH_DELETE_WAIT_DAYS * 24 * 60 * 60 * 1000,
      );
      if (Date.now() < eligibleAt.getTime()) {
        throw new ForbiddenError(
          `This branch was deactivated on ${deactivated.occurredAt.toISOString().slice(0, 10)}. It can be deleted after ${eligibleAt.toISOString().slice(0, 10)} (${BRANCH_DELETE_WAIT_DAYS} days after deactivation).`,
        );
      }
    }
    // No deactivation row on file (deactivated before audit logging began):
    // the wait cannot be measured, so the branch is treated as past it.
    const [staffRows] = await tx
      .select({ n: count() })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.branchId, branchId));
    const [applicantRows] = await tx
      .select({ n: count() })
      .from(schema.applicants)
      .where(eq(schema.applicants.branchId, branchId));
    const [companyRows] = await tx
      .select({ n: count() })
      .from(schema.companies)
      .where(eq(schema.companies.branchId, branchId));
    const [jobRows] = await tx
      .select({ n: count() })
      .from(schema.jobs)
      .where(eq(schema.jobs.branchId, branchId));
    const [applicationRows] = await tx
      .select({ n: count() })
      .from(schema.applications)
      .where(eq(schema.applications.branchId, branchId));
    const [tokenRows] = await tx
      .select({ n: count() })
      .from(schema.branchApplicantTokens)
      .where(eq(schema.branchApplicantTokens.branchId, branchId));
    const [verificationRows] = await tx
      .select({ n: count() })
      .from(schema.companyVerifications)
      .where(eq(schema.companyVerifications.branchId, branchId));
    const attached = [
      { label: 'staff accounts', n: staffRows?.n ?? 0 },
      { label: 'applicants', n: applicantRows?.n ?? 0 },
      { label: 'companies', n: companyRows?.n ?? 0 },
      { label: 'jobs', n: jobRows?.n ?? 0 },
      { label: 'applications', n: applicationRows?.n ?? 0 },
      { label: 'applicant tokens', n: tokenRows?.n ?? 0 },
      { label: 'company verifications', n: verificationRows?.n ?? 0 },
    ].filter((entry) => entry.n > 0);
    if (attached.length > 0) {
      throw new ConflictError(
        `Cannot delete this branch: ${attached
          .map((entry) => `${entry.n} ${entry.label}`)
          .join(', ')} still assigned to it. Move or remove them first.`,
      );
    }
    audit({
      action: 'branch.delete',
      entityType: 'branch',
      entityId: branchId,
      branchId,
      before: { code: branch.code, name: branch.name, city: branch.city },
      after: null,
      reason,
    });
    await tx.delete(b).where(eq(b.id, branchId));
  });
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
