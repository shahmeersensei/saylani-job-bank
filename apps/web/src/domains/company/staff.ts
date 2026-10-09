import 'server-only';
import { schema } from '@jobbank/db';
import {
  COMPANY_STATUSES,
  PUBLIC_COMPANY_STATUSES,
  type CompanyStatus,
  type RegisterCompanyInput,
  type UpdateCompanyInput,
} from '@jobbank/shared';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getBranchContact } from '@/domains/branch';
import { masterDataLabels } from '@/domains/settings';
import { runCommand } from '@/domains/shared/audit';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/domains/shared/errors';
import { paginationMeta, type ListQuery } from '@/domains/shared/pagination';
import {
  assertBranchAccess,
  assertPermission,
  branchScope,
  hasPermission,
  isSuperAdmin,
  type Actor,
} from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { companyMachine, READY } from './machine';
import { emailEmployers } from './notify';
import {
  buildCompanyView,
  c,
  loadCompany,
  members,
  openVerification,
  recordTransition,
  ver,
  type CompanyView,
  type SignedIn,
} from './repository';

// ─── Company listing ───────────────────────────────────────────────────

export const COMPANY_SORTABLE = ['legalName', 'createdAt', 'status'] as const;

export const companyFilters = {
  status: z.enum(COMPANY_STATUSES).optional(),
  branchId: z.uuid().optional(),
};

export interface CompanyListItem {
  id: string;
  legalName: string;
  tradeName: string | null;
  ntn: string;
  status: CompanyStatus;
  branchName: string | null;
  industryLabel: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

/**
 * Branch Admin: VERIFIED + SUSPENDED in their branch(es).
 * Super Admin: all companies, any status.
 * Verifiers have their own queue (listQueue) and do not use this endpoint.
 */
export async function listCompanies(
  actor: Actor,
  query: ListQuery<
    (typeof COMPANY_SORTABLE)[number],
    { status?: CompanyStatus; branchId?: string }
  >,
) {
  // Both company:read (Branch Admin for verified) and company:manage (Super Admin) can list.
  const canManage = hasPermission(actor, 'company:manage');
  if (!canManage) assertPermission(actor, 'company:read');
  const f = query.filters;

  const visibleStatuses = canManage
    ? f.status
      ? [f.status]
      : [...COMPANY_STATUSES]
    : f.status
      ? (PUBLIC_COMPANY_STATUSES as readonly string[]).includes(f.status)
        ? [f.status]
        : []
      : [...PUBLIC_COMPANY_STATUSES];
  if (visibleStatuses.length === 0) return { items: [], pagination: paginationMeta(query, 0) };

  const conditions: (SQL | undefined)[] = [
    branchScope(actor, c.branchId),
    inArray(c.status, visibleStatuses),
    f.branchId ? eq(c.branchId, f.branchId) : undefined,
  ];
  if (query.q) {
    conditions.push(
      or(
        ilike(c.legalName, `%${query.q}%`),
        ilike(c.tradeName, `%${query.q}%`),
        sql`${c.ntn} like ${`${query.q}%`}`,
      ),
    );
  }
  const where = and(...conditions);

  const sortColumn = {
    legalName: c.legalName,
    createdAt: c.createdAt,
    status: c.status,
  }[query.sort.field];

  const base = () =>
    db
      .select({
        id: c.id,
        legalName: c.legalName,
        tradeName: c.tradeName,
        ntn: c.ntn,
        status: c.status,
        branchName: schema.branches.name,
        industryCode: c.industryCode,
        createdAt: c.createdAt,
        verifiedAt: c.verifiedAt,
      })
      .from(c)
      .leftJoin(schema.branches, eq(schema.branches.id, c.branchId));

  const [rows, [total], allLabels] = await Promise.all([
    base()
      .where(where)
      .orderBy(query.sort.direction === 'asc' ? asc(sortColumn) : desc(sortColumn), asc(c.id))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ value: count() })
      .from(c)
      .leftJoin(schema.branches, eq(schema.branches.id, c.branchId))
      .where(where),
    masterDataLabels(['INDUSTRY']),
  ]);

  const industryLabels = allLabels['INDUSTRY'] ?? {};

  const items: CompanyListItem[] = rows.map((row) => ({
    id: row.id,
    legalName: row.legalName,
    tradeName: row.tradeName,
    ntn: row.ntn,
    status: row.status,
    branchName: row.branchName,
    industryLabel: industryLabels[row.industryCode] ?? null,
    createdAt: row.createdAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  }));

  return { items, pagination: paginationMeta(query, total!.value) };
}

/** Detailed company view for staff. */
export async function getCompanyDetail(actor: Actor, companyId: string): Promise<CompanyView> {
  const canManage = hasPermission(actor, 'company:manage');
  if (!canManage) assertPermission(actor, 'company:read');
  const row = await loadCompany(db, companyId);
  assertBranchAccess(actor, row.branchId, { entityType: 'company', entityId: row.id });
  // if (!canManage && !(PUBLIC_COMPANY_STATUSES as readonly string[]).includes(row.status)) {
  //   throw new ForbiddenError('This company is not yet verified');
  // }
  return buildCompanyView(db, row);
}

// ─── Suspend / reinstate ───────────────────────────────────────────────

export async function suspendCompany(
  ctx: SignedIn,
  companyId: string,
  input: { reason: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:suspend');
  await runCommand(ctx, async ({ tx, audit, emit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    const to = companyMachine.transition(row.status, 'SUSPEND', READY, ctx.actor.roles);
    await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
    // The latest verification round stays VERIFIED — the suspension is at the company level.
    audit({
      action: 'company.suspend',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
      metadata: { reason: input.reason },
    });
    emit('company.suspended', { companyId: row.id, branchId: row.branchId! });
  });
  return getCompanyDetail(ctx.actor, companyId);
}

export async function reinstateCompany(
  ctx: SignedIn,
  companyId: string,
  input: { reason: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:suspend');
  await runCommand(ctx, async ({ tx, audit, emit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    const to = companyMachine.transition(row.status, 'REINSTATE', READY, ctx.actor.roles);
    await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
    audit({
      action: 'company.reinstate',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
      metadata: { reason: input.reason },
    });
    // Reinstate emits company.verified — the company is visible again.
    emit('company.verified', { companyId: row.id, branchId: row.branchId! });
  });
  return getCompanyDetail(ctx.actor, companyId);
}

// ─── Super Admin ───────────────────────────────────────────────────────

/** Super Admin assigns or reassigns a verifier to an open round. */
export async function assignVerifier(
  ctx: SignedIn,
  companyId: string,
  input: { verifierId: string; reason: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:manage');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    const to = companyMachine.transition(row.status, 'ASSIGN', READY, ctx.actor.roles);
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (!round) throw new NotFoundError('Open verification for company', companyId);
    const prevVerifier = round.assignedVerifierId;
    await tx
      .update(ver)
      .set({ state: to as any, assignedVerifierId: input.verifierId })
      .where(eq(ver.id, round.id));
    if (row.status !== to) {
      await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
    }
    await recordTransition(tx, {
      verificationId: round.id,
      companyId: row.id,
      event: 'ASSIGN',
      fromStatus: row.status,
      toStatus: to,
      actorId: ctx.actor.userId,
      note: input.reason,
      metadata: { verifierId: input.verifierId, previousVerifierId: prevVerifier },
    });
    audit({
      action: 'company.assign_verifier',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { assignedVerifierId: prevVerifier, status: row.status },
      after: { assignedVerifierId: input.verifierId, status: to },
      metadata: { reason: input.reason },
    });
  });
  return getCompanyDetail(ctx.actor, companyId);
}

/** Super Admin changes the company's branch without re-verification. */
export async function transferCompany(
  ctx: SignedIn,
  companyId: string,
  input: { branchId: string; reason: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:manage');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    if (row.branchId === input.branchId) return;
    const branch = await getBranchContact(input.branchId, tx);
    if (!branch?.isActive) {
      throw new ValidationError([{ path: 'branchId', message: 'Choose an active branch' }]);
    }
    // Move the company and any open verification round.
    await tx.update(c).set({ branchId: input.branchId }).where(eq(c.id, row.id));
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (round) {
      await tx.update(ver).set({ branchId: input.branchId }).where(eq(ver.id, round.id));
    }
    audit({
      action: 'company.transfer',
      entityType: 'company',
      entityId: row.id,
      branchId: input.branchId,
      before: { branchId: row.branchId },
      after: { branchId: input.branchId },
      metadata: { reason: input.reason },
    });
  });
  return getCompanyDetail(ctx.actor, companyId);
}

/** Branch Admin or Super Admin registers a company on behalf of an employer. */
export async function staffRegisterCompany(
  ctx: SignedIn,
  input: RegisterCompanyInput & { branchId: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:manage');
  if (!isSuperAdmin(ctx.actor)) assertBranchAccess(ctx.actor, input.branchId);

  const { branchId, ...companyInput } = input;
  const [existing] = await db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.ntn, companyInput.ntn), sql`${c.status} not in ('DRAFT', 'REJECTED')`));
  if (existing) {
    throw new ConflictError(
      'A company with this NTN is already registered with Saylani Job Bank.',
      { reason: 'NTN_TAKEN' },
    );
  }

  let createdId: string | null = null;
  await runCommand(ctx, async ({ tx, audit }) => {
    const [row] = await tx
      .insert(c)
      .values({ ...companyInput, branchId, createdBy: ctx.actor.userId })
      .returning();
    createdId = row!.id;
    audit({
      action: 'company.register',
      entityType: 'company',
      entityId: row!.id,
      branchId,
      after: { ...companyInput, branchId },
    });
  });

  const [row] = await db.select().from(c).where(eq(c.id, createdId!));
  return buildCompanyView(db, row!);
}

/** Super Admin corrects locked fields (legal name, NTN, etc.) on a verified company. */
export async function correctCompanyDetails(
  ctx: SignedIn,
  companyId: string,
  input: UpdateCompanyInput & { reason: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:manage');
  const { reason, ...changes } = input;
  if (Object.keys(changes).length === 0) {
    throw new ValidationError([{ path: 'root', message: 'Change at least one field' }]);
  }
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    const before = Object.fromEntries(
      Object.keys(changes).map((k) => [k, row[k as keyof typeof row]]),
    );
    await tx.update(c).set(changes).where(eq(c.id, row.id));
    audit({
      action: 'company.correct',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before,
      after: changes,
      metadata: { reason },
    });
  });
  return getCompanyDetail(ctx.actor, companyId);
}
