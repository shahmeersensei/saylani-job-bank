import 'server-only';
import { schema } from '@jobbank/db';
import {
  MASTER_DATA_META,
  MASTER_DATA_PARENT,
  masterDataCodeSchema,
  masterDataTypeSchema,
  type Holiday,
  type MasterDataItem,
  type MasterDataType,
} from '@jobbank/shared';
import { and, asc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { runCommand, type RequestContext } from '@/domains/shared/audit';
import { ConflictError, NotFoundError, ValidationError, zodIssues } from '@/domains/shared/errors';
import { assertPermission, hasPermission, type Actor } from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';

type SignedIn = RequestContext & { actor: Actor };

const md = schema.masterData;
const columns = {
  id: md.id,
  type: md.type,
  code: md.code,
  label: md.label,
  description: md.description,
  parentId: md.parentId,
  meta: md.meta,
  sortOrder: md.sortOrder,
  isActive: md.isActive,
};

// ─── Master data ──────────────────────────────────────────────────────

export const listMasterDataQuery = z.object({
  type: masterDataTypeSchema,
  /** Only for managers; everyone else sees active items only. */
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  parentId: z.uuid().optional(),
});

const editableFields = z.object({
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).nullable().optional(),
  parentId: z.uuid().nullable().optional(),
  /** Validated per type with MASTER_DATA_META. */
  meta: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

export const createMasterDataSchema = editableFields.extend({
  type: masterDataTypeSchema,
  code: masterDataCodeSchema,
});

/** Type and code are permanent: other records store the code. */
export const updateMasterDataSchema = editableFields.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateMasterDataInput = z.infer<typeof createMasterDataSchema>;
export type UpdateMasterDataInput = z.infer<typeof updateMasterDataSchema>;

/**
 * Items of one type, in display order. Lists are needed by every signed-in role (forms),
 * so reading needs no permission; inactive items are only shown to managers.
 */
export async function listMasterData(
  actor: Actor,
  query: { type: MasterDataType; includeInactive?: boolean; parentId?: string },
): Promise<MasterDataItem[]> {
  const showInactive = query.includeInactive && hasPermission(actor, 'master_data:manage');
  const conditions: SQL[] = [eq(md.type, query.type)];
  if (!showInactive) conditions.push(eq(md.isActive, true));
  if (query.parentId) conditions.push(eq(md.parentId, query.parentId));
  return db
    .select(columns)
    .from(md)
    .where(and(...conditions))
    .orderBy(asc(md.sortOrder), asc(md.label));
}

/** Items of one type with the given codes (active or not), for validating stored references. */
export async function findMasterDataByCodes(
  type: MasterDataType,
  codes: readonly string[],
  executor: DbExecutor = db,
): Promise<MasterDataItem[]> {
  if (codes.length === 0) return [];
  return executor
    .select(columns)
    .from(md)
    .where(and(eq(md.type, type), inArray(md.code, [...new Set(codes)])));
}

/**
 * Checks that every code exists in `type` and is active; returns the items by code.
 * Issues point at `path(index)` so the form can highlight the right row.
 */
export async function assertActiveMasterData(
  executor: DbExecutor,
  type: MasterDataType,
  codes: readonly string[],
  path: (index: number) => string,
) {
  const found = new Map(
    (await findMasterDataByCodes(type, codes, executor)).map((item) => [item.code, item]),
  );
  const issues = codes.flatMap((code, index) => {
    const item = found.get(code);
    if (!item) return [{ path: path(index), message: 'Choose an option from the list' }];
    if (!item.isActive)
      return [{ path: path(index), message: `"${item.label}" is no longer offered; remove it` }];
    return [];
  });
  if (issues.length > 0) throw new ValidationError(issues);
  return found;
}

/**
 * code → label for the given types, including inactive items, so records that still hold a
 * retired code keep a readable label.
 */
export async function masterDataLabels(
  types: readonly MasterDataType[],
  executor: DbExecutor = db,
): Promise<Record<string, Record<string, string>>> {
  const rows = await executor
    .select({ type: md.type, code: md.code, label: md.label })
    .from(md)
    .where(inArray(md.type, [...types]));
  const out: Record<string, Record<string, string>> = Object.fromEntries(types.map((t) => [t, {}]));
  for (const row of rows) out[row.type]![row.code] = row.label;
  return out;
}

export async function getMasterDataItem(id: string, executor: DbExecutor = db) {
  const [item] = await executor.select(columns).from(md).where(eq(md.id, id));
  if (!item) throw new NotFoundError('Master data item', id);
  return item;
}

function parseMeta(type: MasterDataType, meta: unknown): Record<string, unknown> {
  const result = MASTER_DATA_META[type].safeParse(meta ?? {});
  if (!result.success) {
    throw new ValidationError(
      zodIssues(result.error).map((issue) => ({ ...issue, path: `meta.${issue.path}` })),
    );
  }
  return result.data as Record<string, unknown>;
}

async function assertValidParent(
  executor: DbExecutor,
  type: MasterDataType,
  parentId: string | null | undefined,
  selfId?: string,
): Promise<void> {
  const rule = MASTER_DATA_PARENT[type];
  if (!rule) {
    if (parentId)
      throw new ValidationError([{ path: 'parentId', message: 'This list has no parent' }]);
    return;
  }
  if (!parentId) {
    if (rule.required) {
      throw new ValidationError([{ path: 'parentId', message: 'Choose a parent item' }]);
    }
    return;
  }
  const [parent] = await executor
    .select({ type: md.type, isActive: md.isActive })
    .from(md)
    .where(eq(md.id, parentId));
  if (!parent || parent.type !== rule.type || parentId === selfId) {
    throw new ValidationError([{ path: 'parentId', message: 'Choose a valid parent item' }]);
  }
  if (!parent.isActive) {
    throw new ValidationError([{ path: 'parentId', message: 'The parent item is inactive' }]);
  }
}

export async function createMasterDataItem(
  ctx: SignedIn,
  input: CreateMasterDataInput,
): Promise<MasterDataItem> {
  assertPermission(ctx.actor, 'master_data:manage');
  const meta = parseMeta(input.type, input.meta);
  const id = await runCommand(ctx, async ({ tx, audit }) => {
    const [taken] = await tx
      .select({ id: md.id })
      .from(md)
      .where(and(eq(md.type, input.type), eq(md.code, input.code)));
    if (taken) throw new ConflictError(`The code ${input.code} is already used in this list`);
    await assertValidParent(tx, input.type, input.parentId);
    const [created] = await tx
      .insert(md)
      .values({
        type: input.type,
        code: input.code,
        label: input.label,
        description: input.description ?? null,
        parentId: input.parentId ?? null,
        meta,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning({ id: md.id });
    audit({
      action: 'master_data.create',
      entityType: 'master_data',
      entityId: created!.id,
      after: { ...input, meta },
    });
    return created!.id;
  });
  return getMasterDataItem(id);
}

export async function updateMasterDataItem(
  ctx: SignedIn,
  id: string,
  patch: UpdateMasterDataInput,
): Promise<MasterDataItem> {
  assertPermission(ctx.actor, 'master_data:manage');
  await runCommand(ctx, async ({ tx, audit }) => {
    const before = await getMasterDataItem(id, tx);
    const changes: Partial<typeof md.$inferInsert> = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (patch.meta !== undefined) changes.meta = parseMeta(before.type, patch.meta);
    if (patch.parentId !== undefined) await assertValidParent(tx, before.type, patch.parentId, id);
    if (Object.keys(changes).length === 0) return;
    await tx.update(md).set(changes).where(eq(md.id, id));
    audit({
      action:
        patch.isActive === false
          ? 'master_data.deactivate'
          : patch.isActive === true
            ? 'master_data.activate'
            : 'master_data.update',
      entityType: 'master_data',
      entityId: id,
      before: Object.fromEntries(
        Object.keys(changes).map((k) => [k, before[k as keyof typeof before]]),
      ),
      after: changes,
      metadata: { type: before.type, code: before.code },
    });
  });
  return getMasterDataItem(id);
}

// ─── Holidays ─────────────────────────────────────────────────────────

const h = schema.holidays;
const holidayColumns = { id: h.id, date: h.date, name: h.name, isActive: h.isActive };

const isoDate = z.iso.date('Use the format YYYY-MM-DD');

export const listHolidaysQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const createHolidaySchema = z.object({
  date: isoDate,
  name: z.string().trim().min(2).max(120),
});

export const updateHolidaySchema = createHolidaySchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;

/** Holidays in date order; a year narrows the list. */
export async function listHolidays(query: { year?: number } = {}): Promise<Holiday[]> {
  const where = query.year
    ? and(gte(h.date, `${query.year}-01-01`), lt(h.date, `${query.year + 1}-01-01`))
    : undefined;
  return db.select(holidayColumns).from(h).where(where).orderBy(asc(h.date));
}

/** Active holiday dates (for the working-day calendar). */
export async function activeHolidayDates(): Promise<Set<string>> {
  const rows = await db.select({ date: h.date }).from(h).where(eq(h.isActive, true));
  return new Set(rows.map((r) => r.date));
}

async function getHoliday(id: string, executor: DbExecutor = db): Promise<Holiday> {
  const [row] = await executor.select(holidayColumns).from(h).where(eq(h.id, id));
  if (!row) throw new NotFoundError('Holiday', id);
  return row;
}

export async function createHoliday(ctx: SignedIn, input: CreateHolidayInput): Promise<Holiday> {
  assertPermission(ctx.actor, 'master_data:manage');
  const id = await runCommand(ctx, async ({ tx, audit }) => {
    const [taken] = await tx.select({ id: h.id }).from(h).where(eq(h.date, input.date));
    if (taken) throw new ConflictError(`${input.date} is already a holiday`);
    const [created] = await tx.insert(h).values(input).returning({ id: h.id });
    audit({ action: 'holiday.create', entityType: 'holiday', entityId: created!.id, after: input });
    return created!.id;
  });
  return getHoliday(id);
}

export async function updateHoliday(
  ctx: SignedIn,
  id: string,
  patch: UpdateHolidayInput,
): Promise<Holiday> {
  assertPermission(ctx.actor, 'master_data:manage');
  await runCommand(ctx, async ({ tx, audit }) => {
    const before = await getHoliday(id, tx);
    const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(changes).length === 0) return;
    await tx.update(h).set(changes).where(eq(h.id, id));
    audit({
      action:
        patch.isActive === false
          ? 'holiday.deactivate'
          : patch.isActive === true
            ? 'holiday.activate'
            : 'holiday.update',
      entityType: 'holiday',
      entityId: id,
      before: Object.fromEntries(
        Object.keys(changes).map((k) => [k, before[k as keyof typeof before]]),
      ),
      after: changes,
    });
  });
  return getHoliday(id);
}
