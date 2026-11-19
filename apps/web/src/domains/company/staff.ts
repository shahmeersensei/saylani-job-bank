import 'server-only';
import { schema } from '@jobbank/db';
import {
  COMPANY_LEGAL_FIELDS,
  COMPANY_STATUSES,
  PUBLIC_COMPANY_STATUSES,
  ROLE_LABELS,
  ROLE_PRIORITY,
  VERIFICATION_STATES,
  isResubmitNoteSufficient,
  type CompanyStatus,
  type OnboardedCompanyHeadOfficeInput,
  type Role,
  type StaffOnboardCompanyInput,
  type UpdateCompanyInput,
} from '@jobbank/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  max,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { getBranchContact } from '@/domains/branch';
import { createNotification, notifyCompanyEmployers } from '@/domains/notifications';
import { assertActiveMasterData, masterDataLabels } from '@/domains/settings';
import { runCommand } from '@/domains/shared/audit';
import {
  ConflictError,
  ForbiddenError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '@/domains/shared/errors';
import { paginationMeta, type ListQuery } from '@/domains/shared/pagination';
import { likeContains, likeStartsWith } from '@/domains/shared/filters';
import {
  assertBranchAccess,
  assertCityAccess,
  assertPermission,
  assertRole,
  cityScope,
  hasRole,
  hasPermission,
  isSuperAdmin,
  type Actor,
} from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';
import { companyMachine, READY } from './machine';
import {
  buildCompanyView,
  c,
  changedSinceInfoRequest,
  contacts,
  currentDocuments,
  loadCompany,
  locs,
  openVerification,
  recordTransition,
  requiredDocumentTypes,
  submissionMissing,
  ver,
  verificationDueOn,
  type CompanyView,
  type SignedIn,
} from './repository';
import { assertAssignableVerifier } from './verifier';

// ─── Company listing ───────────────────────────────────────────────────

export const COMPANY_SORTABLE = ['legalName', 'createdAt', 'status', 'verifiedAt'] as const;

const ACTIVE_NTN_CONSTRAINT = 'companies_ntn_active_uq';

const ntnTaken = () =>
  new ConflictError('A company with this NTN is already registered with Saylani Job Bank.', {
    reason: 'NTN_TAKEN',
  });

/**
 * Owner decision 4 (packages/db/src/schema/companies.ts): one LIVE company per NTN.
 * A second DRAFT — or a re-registration after a REJECTED one — is allowed by design:
 * drafts don't count (no squatting) and a rejected company may be re-registered by
 * its real owner. That is deliberately looser than the CNIC rule (one applicant row
 * per CNIC ever, `applicants_cnic_unique`): a mistyped NTN on a draft must not block
 * a later correct registration, while a second live company must never exist.
 *
 * What the rule does require is that a live duplicate fails with a clean 409
 * NTN_TAKEN — never a raw 500, and never a silent second DRAFT created next to a
 * live company by a concurrent request. So every staff write below re-checks inside
 * its transaction AND maps the partial-index violation to 409: the check-then-act
 * read outside the transaction is only an early friendly error, never the guard.
 */
async function assertNtnFree(executor: DbExecutor, ntn: string, exceptId?: string) {
  const [other] = await executor
    .select({ id: c.id })
    .from(c)
    .where(
      and(
        eq(c.ntn, ntn),
        notInArray(c.status, ['DRAFT', 'REJECTED']),
        exceptId ? ne(c.id, exceptId) : undefined,
      ),
    );
  if (other) throw ntnTaken();
}

export const companyFilters = {
  status: z.enum(COMPANY_STATUSES).optional(),
  branchId: z.uuid().optional(),
};

export interface CompanyListItem {
  id: string;
  legalName: string;
  tradeName: string | null;
  ntn: string | null;
  status: CompanyStatus;
  branchName: string | null;
  industryLabel: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

/**
 * Branch Admin: all companies in their branch(es).
 * Super Admin: all companies, any status.
 * Verifier: all companies in their branch(es), any status — they register
 * companies and follow them through review, but no longer verify them
 * (2026-11-14: verification moved to the Branch Admin).
 */
export async function listCompanies(
  actor: Actor,
  query: ListQuery<
    (typeof COMPANY_SORTABLE)[number],
    { status?: CompanyStatus; branchId?: string }
  >,
) {
  // Both company:read (Branch Admin for verified) and company:manage (Super Admin) can list.
  // Staff who onboard companies see every status, but only the companies they onboarded.
  const canManage = hasPermission(actor, 'company:manage');
  const canOnboard = hasPermission(actor, 'company:onboard');
  if (!canManage && !canOnboard) assertPermission(actor, 'company:read');
  const f = query.filters;

  const visibleStatuses =
    canManage || canOnboard
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
    // Audit 2026-11-11 (L-25): city scope — the newer rule — like the
    // Branch Admin review queue, the job list and the applicant list. Reads are
    // city-scoped; branch-bound writes (suspend, correct, onboard, …)
    // stay exact-branch below.
    cityScope(actor, c.branchId),
    inArray(c.status, visibleStatuses),
    f.branchId ? eq(c.branchId, f.branchId) : undefined,
    // Staff see the companies they onboarded; Branch Admin / Super Admin see the branch.
    !canManage && canOnboard ? eq(c.createdBy, actor.userId) : undefined,
  ];
  if (query.q) {
    conditions.push(
      or(
        ilike(c.legalName, likeContains(query.q)),
        ilike(c.tradeName, likeContains(query.q)),
        sql`${c.ntn} like ${likeStartsWith(query.q)}`,
      ),
    );
  }
  const where = and(...conditions);

  const sortColumn = {
    legalName: c.legalName,
    createdAt: c.createdAt,
    status: c.status,
    verifiedAt: c.verifiedAt,
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
  await assertCityAccess(actor, row.branchId, { entityType: 'company', entityId: row.id });
  // H4: the list endpoint deliberately restricts non-managers to
  // VERIFIED/SUSPENDED; the detail endpoint must match — a DRAFT company's
  // contacts, NTN and notes are not public to company:read holders.
  if (!canManage && !(PUBLIC_COMPANY_STATUSES as readonly string[]).includes(row.status)) {
    throw new ForbiddenError('This company is not yet verified');
  }
  return buildCompanyView(db, row);
}

/**
 * Monthly companies onboarded by the signed-in staff member (field visits),
 * current calendar year, bucketed by the outreach record's createdAt in PKT
 * months — same windowing as countVerificationsDoneByMonth. Feeds the
 * Verifier dashboard chart, which shows registrations, not verifications,
 * since verification moved to the Branch Admin (2026-11-14).
 */
export async function countCompaniesOnboardedByMonth(
  actor: Actor,
  year: number,
): Promise<number[]> {
  assertPermission(actor, 'company:onboard');
  const start = new Date(Date.UTC(year - 1, 11, 31, 19));
  const end = new Date(Date.UTC(year, 11, 31, 19));
  const monthExpr = sql<number>`extract(month from ${schema.companyOnboarding.createdAt} at time zone 'Asia/Karachi')`;
  const rows = await db
    .select({ month: monthExpr, value: count() })
    .from(schema.companyOnboarding)
    .where(
      and(
        eq(schema.companyOnboarding.onboardedBy, actor.userId),
        gte(schema.companyOnboarding.createdAt, start),
        lt(schema.companyOnboarding.createdAt, end),
      ),
    )
    .groupBy(monthExpr);
  const values = Array.from({ length: 12 }, () => 0);
  for (const row of rows) {
    if (row.month >= 1 && row.month <= 12) values[row.month - 1] = row.value;
  }
  return values;
}

// ─── Suspend / reinstate ───────────────────────────────────────────────

export async function suspendCompany(
  ctx: SignedIn,
  companyId: string,
  input: { reason: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:suspend');
  await runCommand(ctx, async ({ tx, audit }) => {
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
  });
  const view = await getCompanyDetail(ctx.actor, companyId);
  // M25 — the company's employer users must hear their company was
  // suspended (until now only the audit log recorded it). Best-effort,
  // post-commit, following the placement notification pattern.
  void notifyCompanyEmployers(db, companyId, ({ userId }) => ({
    userId,
    type: 'COMPANY_SUSPENDED',
    title: `Company suspended — ${view.details.legalName}`,
    body: `Your company ${view.details.legalName} has been suspended. Reason: ${input.reason}`,
    data: { companyId, reason: input.reason },
  })).catch((err) => ctx.log.error('company suspend notification failed', { companyId, err }));
  return view;
}

export async function reinstateCompany(
  ctx: SignedIn,
  companyId: string,
  input: { reason: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:suspend');
  await runCommand(ctx, async ({ tx, audit }) => {
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
  });
  const view = await getCompanyDetail(ctx.actor, companyId);
  // M25 — same as suspend: the employer users hear the company is live again.
  void notifyCompanyEmployers(db, companyId, ({ userId }) => ({
    userId,
    type: 'COMPANY_REINSTATED',
    title: `Company reinstated — ${view.details.legalName}`,
    body: `Your company ${view.details.legalName} has been reinstated and can post jobs again.`,
    data: { companyId, reason: input.reason },
  })).catch((err) => ctx.log.error('company reinstate notification failed', { companyId, err }));
  return view;
}

// ─── Super Admin ───────────────────────────────────────────────────────

/** Super Admin assigns or reassigns a verifier to an open round. */
export async function assignVerifier(
  ctx: SignedIn,
  companyId: string,
  input: { verifierId: string; reason: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:manage');
  // Audit 2026-11-10 (B-H1): company:manage is also held by verifiers since
  // their scope grew, so the permission alone no longer proves Super Admin.
  // Only Super Admin assigns verifiers — a verifier must never be able to
  // self-assign a case (bypassing the claim queue) or reassign one away
  // from its assigned verifier. Mirrors transferCompany's role guard.
  assertRole(ctx.actor, 'SUPER_ADMIN');
  // Validate the target before anything is written: the user must exist,
  // be ACTIVE, hold the VERIFIER role, work in the company's city, and pass
  // the contact-conflict check (no shared email/phone with the company's
  // contacts). See assertAssignableVerifier.
  const company = await loadCompany(db, companyId);
  await assertAssignableVerifier(input.verifierId, company);
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    // Scope BEFORE the update (see correctCompanyDetails): the
    // getCompanyDetail() at the end only fails after this commits.
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    const to = companyMachine.transition(row.status, 'ASSIGN', READY, ctx.actor.roles);
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (!round) throw new NotFoundError('Open verification for company', companyId);
    const prevVerifier = round.assignedVerifierId;
    const verificationState = VERIFICATION_STATES.find((state) => state === to);
    if (!verificationState) throw new Error(`Invalid verification state for assignment: ${to}`);
    await tx
      .update(ver)
      .set({ state: verificationState, assignedVerifierId: input.verifierId })
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
  // M25 — the assigned verifier hears about the new case (until now only
  // the queue showed it, and only if they looked). Best-effort, post-commit.
  void createNotification(db, {
    userId: input.verifierId,
    type: 'VERIFIER_ASSIGNED',
    title: `Verification assigned — ${company.legalName}`,
    body: `You have been assigned to verify ${company.legalName}. Reason: ${input.reason}`,
    data: { companyId, verifierId: input.verifierId, reason: input.reason },
  }).catch((err) => ctx.log.error('assign verifier notification failed', { companyId, err }));
  return getCompanyDetail(ctx.actor, companyId);
}

/** Super Admin or Branch Admin changes the company's branch without re-verification.
 * Blocked while a verification round is open (see below). */
export async function transferCompany(
  ctx: SignedIn,
  companyId: string,
  input: { branchId: string; reason: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:manage');
  // company:manage is also held by verifiers since their scope grew; a
  // verifier must never be able to move a company to another branch.
  assertRole(ctx.actor, 'SUPER_ADMIN', 'BRANCH_ADMIN');
  // M25: set inside the transaction when the move lands, read after commit
  // for the employer notification below. Stays null for a no-op transfer
  // (same branch) or a failed one, so nothing is notified then.
  let transferredTo: string | null = null;
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    // Scope BEFORE the move (see correctCompanyDetails): only a company in
    // the actor's own branch can be transferred out of it.
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    if (row.branchId === input.branchId) return;
    // H3: block while a verification round is open. Moving the round would
    // strand its assigned verifier in the old city (they fail scope on the
    // new branch on every action) and reset the SLA context; clearing or
    // reassigning the verifier mid-review would be worse. Transfer once
    // the round closes.
    if (await openVerification(tx, row.id, { forUpdate: true })) {
      throw new ConflictError(
        'This company has an open verification round. Transfer it after the round closes.',
      );
    }
    const branch = await getBranchContact(input.branchId, tx);
    if (!branch?.isActive) {
      throw new ValidationError([{ path: 'branchId', message: 'Choose an active branch' }]);
    }
    // Move the company. No open round can exist here (blocked above), so
    // there is no assigned verifier to strand.
    await tx.update(c).set({ branchId: input.branchId }).where(eq(c.id, row.id));
    transferredTo = branch.name;
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
  const view = await getCompanyDetail(ctx.actor, companyId);
  // M25 — the company's employer users hear their branch changed (until now
  // only the audit log recorded it). Best-effort, post-commit.
  if (transferredTo) {
    const branchName = transferredTo;
    void notifyCompanyEmployers(db, companyId, ({ userId }) => ({
      userId,
      type: 'COMPANY_TRANSFERRED',
      title: `Company moved — ${view.details.legalName}`,
      body: `Your company ${view.details.legalName} is now served by the ${branchName} branch.`,
      data: { companyId, branchId: input.branchId, branchName, reason: input.reason },
    })).catch((err) => ctx.log.error('company transfer notification failed', { companyId, err }));
  }
  return view;
}

// ─── Field-visit onboarding ────────────────────────────────────────────

/*
 * F9/N16 (2026-11-08): staffRegisterCompany is deleted. It created a bare
 * DRAFT with no outreach record, no Review & Print and no verified-signed
 * flow — and the verifier gate rejects such companies, so they could never
 * reach VERIFIED. Companies are registered only through
 * staffOnboardCompany below (field visit, company:onboard).
 */

export interface CompanyOnboardingNotes {
  headOfficeAddress: string | null;
  otherSites: string | null;
  workforceRoles: string | null;
  workforceType: string | null;
  workforceShifts: string | null;
  workforceOpenings: string | null;
  yearsInBusiness: string | null;
  previousHiring: string | null;
  certifications: string | null;
  additionalNotes: string | null;
}

export interface CompanyOnboarding {
  onboardedBy: { name: string | null; roleLabel: string | null } | null;
  visitDate: string | null;
  notes: CompanyOnboardingNotes;
}

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * The outreach record for a company registered by staff after a field visit, read
 * from the `company_onboarding` table (migration 0026). Returns null for companies
 * the employer registered themselves — those carry no visit record. The
 * `company.register` audit entry is evidence only and is no longer read back, so
 * audit retention/purge and PII redaction can no longer destroy this record.
 */
export async function getCompanyOnboarding(
  actor: Actor,
  companyId: string,
): Promise<CompanyOnboarding | null> {
  assertPermission(actor, 'company:read');
  const row = await loadCompany(db, companyId);
  await assertCityAccess(actor, row.branchId, { entityType: 'company', entityId: row.id });
  // Audit 2026-11-11 (L-24): same non-manager status rule as
  // getCompanyDetail — outreach notes for a DRAFT company are not open to
  // company:read holders. (Managers — SA/BA/verifier — are unaffected.)
  if (
    !hasPermission(actor, 'company:manage') &&
    !(PUBLIC_COMPANY_STATUSES as readonly string[]).includes(row.status)
  ) {
    throw new ForbiddenError('This company is not yet verified');
  }
  const [onboarding] = await db
    .select()
    .from(schema.companyOnboarding)
    .where(eq(schema.companyOnboarding.companyId, row.id))
    .limit(1);
  if (!onboarding) return null;
  // Name + current role of the staff member who onboarded the company (shown on
  // the paper form). Roles can change after the visit, so this is read live.
  const [[user], roles] = await Promise.all([
    onboarding.onboardedBy
      ? db
          .select({ name: schema.users.name })
          .from(schema.users)
          .where(eq(schema.users.id, onboarding.onboardedBy))
          .limit(1)
      : Promise.resolve([]),
    onboarding.onboardedBy
      ? db
          .select({ roleCode: schema.userRoles.roleCode })
          .from(schema.userRoles)
          .where(eq(schema.userRoles.userId, onboarding.onboardedBy))
      : Promise.resolve([]),
  ]);
  const role = ROLE_PRIORITY.find((r: Role) => roles.some((a) => a.roleCode === r));
  return {
    onboardedBy: onboarding.onboardedBy
      ? { name: user?.name ?? null, roleLabel: role ? ROLE_LABELS[role] : null }
      : null,
    visitDate: asText(onboarding.visitDate),
    notes: {
      headOfficeAddress: asText(onboarding.headOfficeAddress),
      otherSites: asText(onboarding.otherSites),
      workforceRoles: asText(onboarding.workforceRoles),
      workforceType: asText(onboarding.workforceType),
      workforceShifts: asText(onboarding.workforceShifts),
      workforceOpenings: asText(onboarding.workforceOpenings),
      yearsInBusiness: asText(onboarding.yearsInBusiness),
      previousHiring: asText(onboarding.previousHiring),
      certifications: asText(onboarding.certifications),
      additionalNotes: asText(onboarding.additionalNotes),
    },
  };
}

/**
 * Staff, Branch Admin, Super Admin or Verifier registers a company they visited and onboarded.
 * Creates a DRAFT company plus its main contact; the outreach record (who visited,
 * when, and the extra notes) is stored in the
 * `company_onboarding` table, in the same transaction as the company row.
 */
export async function staffOnboardCompany(
  ctx: SignedIn,
  input: StaffOnboardCompanyInput,
): Promise<CompanyView & { onboarding: CompanyOnboarding }> {
  assertPermission(ctx.actor, 'company:onboard');
  // 2026-11-12: Super Admin and Branch Admin no longer register companies
  // (field-visit onboard) — Verifier only. `company:onboard` stays on the
  // permission table: Verifier still needs it, and the follow-up onboard
  // steps (documents, resubmit) are unchanged.
  if (hasRole(ctx.actor, 'SUPER_ADMIN', 'BRANCH_ADMIN')) {
    throw new ForbiddenError('Only Verifier can register companies');
  }
  if (!isSuperAdmin(ctx.actor)) assertBranchAccess(ctx.actor, input.branchId);

  const {
    branchId,
    contactName,
    contactDesignation,
    contactPhone,
    contactEmail,
    visitDate,
    // Notes stay out of the company row; they go to `company_onboarding` below.
    headOfficeAddress,
    otherSites,
    workforceRoles,
    workforceType,
    workforceShifts,
    workforceOpenings,
    yearsInBusiness,
    previousHiring,
    certifications,
    additionalNotes,
    ...companyInput
  } = input;

  await assertActiveMasterData(db, 'INDUSTRY', [companyInput.industryCode], () => 'industryCode');
  // NTN is optional on this flow (2026-11-13): with no NTN there is nothing
  // to collide with and no DRAFT to resume — every check below is skipped
  // and a fresh row is always created. (A null NTN must never match other
  // null-NTN rows: `eq(ntn, null)` would read as IS NULL.)
  const ntn = companyInput.ntn ?? null;
  const [existing] = ntn
    ? await db
        .select({ id: c.id })
        .from(c)
        .where(and(eq(c.ntn, ntn), sql`${c.status} not in ('DRAFT', 'REJECTED')`))
    : [];
  if (existing) throw ntnTaken();

  // F4: a second DRAFT for the same NTN used to be created silently — a
  // double-submit, or a second visit to a company already onboarded as a
  // draft, produced two DRAFT rows for one NTN. Return the existing DRAFT
  // for resumption instead: the dialog opens it, and the visit's Review &
  // Print / verified-signed flow continues from there. The submitted details
  // are NOT merged over the draft — the draft is the record, and corrections
  // go through the company panel. A REJECTED company is not resumed (owner
  // decision 4: it may be re-registered fresh). A live duplicate still 409s
  // NTN_TAKEN above.
  const [draft] = ntn
    ? await db
        .select({ id: c.id, branchId: c.branchId })
        .from(c)
        .where(and(eq(c.ntn, ntn), eq(c.status, 'DRAFT')))
    : [];
  if (draft) {
    if (!isSuperAdmin(ctx.actor)) assertBranchAccess(ctx.actor, draft.branchId);
    const [draftRow] = await db.select().from(c).where(eq(c.id, draft.id));
    const view = await buildCompanyView(db, draftRow!);
    const onboarding = await getCompanyOnboarding(ctx.actor, draftRow!.id);
    return { ...view, onboarding: onboarding! };
  }

  let createdId: string | null = null;
  let resumedId: string | null = null;
  try {
    await runCommand(ctx, async ({ tx, audit }) => {
      // Re-check inside the transaction: a live company with this NTN may have
      // appeared after the read above (see assertNtnFree). Skipped with no NTN.
      if (ntn) await assertNtnFree(tx, ntn);
      // F4 (race): a DRAFT for this NTN may have appeared after the read
      // above — a concurrent onboard, or the same double-submit. Resume it
      // instead of inserting a second DRAFT; the resumption is audited, and
      // runCommand requires an audit entry, so the no-op write still records
      // one. Same branch rule as the pre-check above.
      const [racyDraft] = ntn
        ? await tx
            .select({ id: c.id, branchId: c.branchId })
            .from(c)
            .where(and(eq(c.ntn, ntn), eq(c.status, 'DRAFT')))
        : [];
      if (racyDraft) {
        if (!isSuperAdmin(ctx.actor)) assertBranchAccess(ctx.actor, racyDraft.branchId);
        resumedId = racyDraft.id;
        audit({
          action: 'company.register_resumed',
          entityType: 'company',
          entityId: racyDraft.id,
          branchId: racyDraft.branchId,
        });
        return;
      }
      const [row] = await tx
        .insert(c)
        .values({ ...companyInput, ntn, branchId, createdBy: ctx.actor.userId })
        .returning();
      createdId = row!.id;
      await tx.insert(contacts).values({
        companyId: row!.id,
        name: contactName,
        designation: contactDesignation,
        phone: contactPhone,
        email: contactEmail,
        isPrimary: true,
        sortOrder: 0,
      });
      await tx.insert(schema.companyOnboarding).values({
        companyId: row!.id,
        onboardedBy: ctx.actor.userId,
        visitDate,
        headOfficeAddress,
        otherSites,
        workforceRoles,
        workforceType,
        workforceShifts,
        workforceOpenings,
        yearsInBusiness,
        previousHiring,
        certifications,
        additionalNotes,
      });
      audit({
        action: 'company.register',
        entityType: 'company',
        entityId: row!.id,
        branchId,
        // Evidence only: the outreach record lives in `company_onboarding`
        // (migration 0026). Keep PII — contact details, notes, NTN — out of the
        // audit trail; it is redacted there anyway (see lib/privacy/redact.ts).
        after: { legalName: companyInput.legalName, branchId },
        metadata: { onboardedBy: ctx.actor.userId, visitDate },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, ACTIVE_NTN_CONSTRAINT)) throw ntnTaken();
    throw error;
  }

  // F4: either a fresh row was created, or the in-transaction re-check
  // resumed a DRAFT that appeared concurrently. Exactly one of them is set.
  const [row] = await db
    .select()
    .from(c)
    .where(eq(c.id, (resumedId ?? createdId)!));
  const view = await buildCompanyView(db, row!);
  const onboarding = await getCompanyOnboarding(ctx.actor, row!.id);
  return { ...view, onboarding: onboarding! };
}

/**
 * Records the first-counter paper review (company representative + staff signatures) and
 * sends the DRAFT company to Branch Admin review in the same step. Staff submission needs
 * what the field visit guarantees — a main contact, a branch, and at least one required
 * document uploaded (N15: a document-less company used to reach review, where VERIFY
 * then 409'd instead). The head office and full document acceptance are still the
 * Branch Admin's checks: the VERIFY guard requires every required document accepted, and
 * the Branch Admin can request anything missing.
 * Verifiers onboard and submit companies the same way; the marker must be
 * someone other than the onboarder (M9 — no self-attestation).
 */
export async function markCompanyRegistrationVerifiedSigned(
  ctx: SignedIn,
  companyId: string,
): Promise<CompanyView> {
  assertRole(ctx.actor, 'STAFF', 'BRANCH_ADMIN', 'SUPER_ADMIN', 'VERIFIER');
  assertPermission(ctx.actor, 'company:onboard');
  const company = await loadCompany(db, companyId);
  if (!isSuperAdmin(ctx.actor)) {
    assertBranchAccess(ctx.actor, company.branchId, {
      entityType: 'company',
      entityId: company.id,
    });
  }
  // Only a company registered by staff after a field visit has a paper form to
  // verify and sign. Employer self-registered DRAFTs must go through the
  // employer's own submit path (with its head-office + documents checks).
  const onboarding = await getCompanyOnboarding(ctx.actor, companyId);
  if (!onboarding) {
    throw new ConflictError(
      'Only a company registered by staff after a field visit can be marked verified and signed.',
      { reason: 'NOT_ONBOARDED' },
    );
  }
  // M9: no self-attestation — the staff member who onboarded the company
  // must not be the one marking its paper form verified & signed. A
  // colleague in the branch records it instead.
  if (company.createdBy === ctx.actor.userId) {
    throw new ConflictError(
      'You cannot mark a registration form verified and signed for a company you onboarded. Ask another staff member in your branch.',
      { reason: 'SELF_ATTESTATION' },
    );
  }
  const now = new Date();
  const dueOn = await verificationDueOn(now);
  try {
    await runCommand(ctx, async ({ tx, audit }) => {
      const row = await loadCompany(tx, companyId, { forUpdate: true });
      if (row.status !== 'DRAFT') {
        throw new ConflictError('Only a draft company can be marked verified and signed.');
      }
      if (row.registrationVerifiedSignedAt) {
        throw new ConflictError('This registration form was already marked verified and signed.');
      }
      if (await openVerification(tx, row.id)) {
        throw new ConflictError('This company is already waiting for verification');
      }
      const contactRows = await tx
        .select({ isPrimary: contacts.isPrimary })
        .from(contacts)
        .where(eq(contacts.companyId, row.id));
      const missing: string[] = [];
      if (!contactRows.some((r) => r.isPrimary)) missing.push('a main contact person');
      if (!row.branchId) missing.push('a branch');
      // N15: require at least one required document before the company can
      // enter Branch Admin review. Same building blocks as the Branch Admin's
      // VERIFY completeness guard (requiredDocumentTypes /
      // currentDocuments, see submissionMissing / documentsNotAccepted in
      // repository.ts) — but only the ≥1 floor, not the full set: a
      // confirmed upload is reviewStatus PENDING until the Branch Admin
      // reviews it, so ACCEPTED cannot be required here, and the VERIFY
      // guard still requires EVERY required document accepted. A
      // rejected-only upload does not count (same rule submissionMissing
      // uses: a rejected document must be replaced).
      const [required, current] = await Promise.all([
        requiredDocumentTypes(tx, row.legalStructure),
        currentDocuments(tx, row.id),
      ]);
      const hasRequiredDocument = required.some((type) =>
        current.some((doc) => doc.typeCode === type.code && doc.reviewStatus !== 'REJECTED'),
      );
      if (required.length > 0 && !hasRequiredDocument) {
        throw new ConflictError(
          'Upload at least one required document before marking the registration form verified and signed.',
          { reason: 'DOCUMENTS_MISSING' },
        );
      }
      const to = companyMachine.transition(
        row.status,
        'SUBMIT',
        { submissionMissing: missing, documentsNotAccepted: [] },
        ctx.actor.roles,
      );
      // No NTN, no duplicate to find: `eq(ntn, null)` would read as IS NULL
      // and wrongly match every other live company without an NTN.
      const [other] = row.ntn
        ? await tx
            .select({ id: c.id })
            .from(c)
            .where(
              and(
                eq(c.ntn, row.ntn),
                notInArray(c.status, ['DRAFT', 'REJECTED']),
                ne(c.id, row.id),
              ),
            )
        : [];
      if (other) {
        throw new ConflictError(
          'A company with this NTN is already registered with Saylani Job Bank.',
          { reason: 'NTN_TAKEN' },
        );
      }
      const [{ last } = { last: 0 }] = await tx
        .select({ last: max(ver.round) })
        .from(ver)
        .where(eq(ver.companyId, row.id));
      const [round] = await tx
        .insert(ver)
        .values({
          companyId: row.id,
          branchId: row.branchId!,
          round: (last ?? 0) + 1,
          submittedAt: now,
          clockStartedAt: now,
          slaDueOn: dueOn,
        })
        .returning();
      await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
      await tx
        .update(c)
        .set({
          registrationVerifiedSignedAt: now,
          registrationVerifiedSignedBy: ctx.actor.userId,
        })
        .where(eq(c.id, row.id));
      await recordTransition(tx, {
        verificationId: round!.id,
        companyId: row.id,
        event: 'SUBMIT',
        fromStatus: row.status,
        toStatus: to,
        actorId: ctx.actor.userId,
        metadata: { round: round!.round, slaDueOn: dueOn },
      });
      audit({
        action: 'company.registration_form_verified_signed',
        entityType: 'company',
        entityId: row.id,
        branchId: row.branchId,
        after: { status: row.status, verifiedSigned: true },
        metadata: { verifiedBy: ctx.actor.userId },
      });
      audit({
        action: 'company.submit',
        entityType: 'company',
        entityId: row.id,
        branchId: row.branchId,
        before: { status: row.status },
        after: { status: to },
        metadata: { round: round!.round, slaDueOn: dueOn },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, ACTIVE_NTN_CONSTRAINT)) {
      throw new ConflictError(
        'A company with this NTN is already registered with Saylani Job Bank.',
        { reason: 'NTN_TAKEN' },
      );
    }
    throw error;
  }
  return getCompanyDetail(ctx.actor, companyId);
}

/** Return a field-visit company or a verifier's info-request response to review. */
export async function resubmitOnboardedCompany(
  ctx: SignedIn,
  companyId: string,
  input: { note: string | null },
): Promise<CompanyView> {
  const isVerifier =
    hasRole(ctx.actor, 'VERIFIER') && !hasRole(ctx.actor, 'SUPER_ADMIN', 'BRANCH_ADMIN');
  const company = await loadCompany(db, companyId);
  if (!isVerifier) assertPermission(ctx.actor, 'company:onboard');
  if (!isSuperAdmin(ctx.actor)) {
    assertBranchAccess(ctx.actor, company.branchId, {
      entityType: 'company',
      entityId: company.id,
    });
  }
  const onboarding = await getCompanyOnboarding(ctx.actor, companyId);
  if (!onboarding && !isVerifier) {
    throw new ConflictError(
      'Only a company registered after a field visit can be sent back this way.',
      { reason: 'NOT_ONBOARDED' },
    );
  }
  if (isVerifier && company.status !== 'INFO_REQUESTED') {
    throw new ConflictError(
      'A verifier can only return a company after the Branch Admin requests information.',
    );
  }
  // Audit 2026-11-11 (L-08): separation of duties — the staff member who
  // onboarded the company must not single-handedly bounce it back to the
  // verifier. A colleague (or Branch/Super Admin, who hold company:onboard)
  // sends it back instead.
  if (!isVerifier && company.createdBy === ctx.actor.userId) {
    throw new ConflictError(
      'You cannot send back a company you onboarded yourself. Ask another staff member in your branch.',
      { reason: 'SELF_ATTESTATION' },
    );
  }
  const now = new Date();
  const dueOn = await verificationDueOn(now);
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    const to = companyMachine.transition(
      row.status,
      'RESUBMIT',
      { submissionMissing: await submissionMissing(tx, row), documentsNotAccepted: [] },
      ctx.actor.roles,
    );
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (!round) throw new ConflictError('There is no open verification to send back');
    if (
      isVerifier &&
      (round.state !== 'INFO_REQUESTED' ||
        (round.assignedVerifierId !== null && round.assignedVerifierId !== ctx.actor.userId))
    ) {
      throw new ForbiddenError(
        'Only the assigned verifier can return this company to the Branch Admin.',
      );
    }
    // M18 (staff mirror of resubmitMyCompany): an unchanged company cannot be
    // bounced back and burn a fresh SLA — a real note, or proof something
    // changed since the verifier asked for more.
    if (
      !isResubmitNoteSufficient(input.note) &&
      !(await changedSinceInfoRequest(tx, row.id, round.infoRequestedAt))
    ) {
      throw new ValidationError([
        {
          path: 'note',
          message: isVerifier
            ? 'Tell the Branch Admin what you changed or sent (at least 10 characters), or upload the document they asked for first.'
            : 'Tell the verifier what you changed or sent (at least 10 characters), or upload the document they asked for first.',
        },
      ]);
    }
    await tx
      .update(ver)
      .set({ state: 'RESUBMITTED', employerNote: input.note, clockStartedAt: now, slaDueOn: dueOn })
      .where(eq(ver.id, round.id));
    await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
    await recordTransition(tx, {
      verificationId: round.id,
      companyId: row.id,
      event: 'RESUBMIT',
      fromStatus: row.status,
      toStatus: to,
      actorId: ctx.actor.userId,
      note: input.note,
      metadata: { slaDueOn: dueOn },
    });
    audit({
      action: 'company.resubmit',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
      metadata: { round: round.round, slaDueOn: dueOn },
    });
  });
  return getCompanyDetail(ctx.actor, companyId);
}

/** Auto-return a completed verifier response as soon as its last required save lands. */
export async function autoResubmitInfoRequestIfReady(
  ctx: SignedIn,
  companyId: string,
  note: string,
): Promise<boolean> {
  let resubmitted = false;
  await runCommand(
    ctx,
    async ({ tx, audit }) => {
      const row = await loadCompany(tx, companyId, { forUpdate: true });
      if (row.status !== 'INFO_REQUESTED') return;
      assertBranchAccess(ctx.actor, row.branchId, {
        entityType: 'company',
        entityId: row.id,
      });

      const round = await openVerification(tx, row.id, { forUpdate: true });
      if (
        !round ||
        round.state !== 'INFO_REQUESTED' ||
        (round.assignedVerifierId !== null && round.assignedVerifierId !== ctx.actor.userId) ||
        !(await changedSinceInfoRequest(tx, row.id, round.infoRequestedAt))
      ) {
        return;
      }

      // Returning information to the Branch Admin is not approval; VERIFY still
      // enforces submission completeness and accepted documents.
      const to = companyMachine.transition(
        row.status,
        'RESUBMIT',
        { submissionMissing: [], documentsNotAccepted: [] },
        ctx.actor.roles,
      );
      const now = new Date();
      const slaDueOn = await verificationDueOn(now);
      await tx
        .update(ver)
        .set({
          state: 'RESUBMITTED',
          employerNote: note,
          clockStartedAt: now,
          slaDueOn,
        })
        .where(eq(ver.id, round.id));
      await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
      await recordTransition(tx, {
        verificationId: round.id,
        companyId: row.id,
        event: 'RESUBMIT',
        fromStatus: row.status,
        toStatus: to,
        actorId: ctx.actor.userId,
        note,
        metadata: { slaDueOn, automatic: true },
      });
      audit({
        action: 'company.resubmit',
        entityType: 'company',
        entityId: row.id,
        branchId: row.branchId,
        before: { status: row.status },
        after: { status: to },
        metadata: { round: round.round, slaDueOn, automatic: true },
      });
      resubmitted = true;
    },
    { audited: false },
  );
  return resubmitted;
}

/**
 * Set the head office of a field-visit-onboarded company. The onboard form
 * only records the address as a note, so these companies reach the verifier
 * with no location row — and the VERIFY guard now requires one. The
 * onboarder supplies it while the company is a draft; a verifier may fill it
 * in response to a Branch Admin's information request. The city must be an
 * active master-data CITY code.
 */
export async function setOnboardedCompanyHeadOffice(
  ctx: SignedIn,
  companyId: string,
  input: OnboardedCompanyHeadOfficeInput,
): Promise<CompanyView> {
  const isVerifier =
    hasRole(ctx.actor, 'VERIFIER') && !hasRole(ctx.actor, 'SUPER_ADMIN', 'BRANCH_ADMIN');
  const company = await loadCompany(db, companyId);
  const verifierInfoResponse = isVerifier && company.status === 'INFO_REQUESTED';
  if (!verifierInfoResponse) assertPermission(ctx.actor, 'company:onboard');
  if (!isSuperAdmin(ctx.actor)) {
    assertBranchAccess(ctx.actor, company.branchId, {
      entityType: 'company',
      entityId: company.id,
    });
  }
  const onboarding = await getCompanyOnboarding(ctx.actor, companyId);
  if (!onboarding) {
    throw new ConflictError(
      'Only a company registered after a field visit can have its head office set this way.',
      { reason: 'NOT_ONBOARDED' },
    );
  }
  // Audit 2026-11-11 (L-08): separation of duties — the staff member who
  // onboarded the company must not single-handedly set its head office.
  // A colleague (or Branch/Super Admin, who hold company:onboard) does it.
  if (company.createdBy === ctx.actor.userId && !verifierInfoResponse) {
    throw new ConflictError(
      'You cannot set the head office of a company you onboarded yourself. Ask another staff member in your branch.',
      { reason: 'SELF_ATTESTATION' },
    );
  }
  if (company.status !== 'DRAFT' && company.status !== 'INFO_REQUESTED') {
    throw new ConflictError(
      'The head office can only be set while the company is a draft or waiting for more information.',
    );
  }
  await assertActiveMasterData(db, 'CITY', [input.cityCode], () => 'cityCode');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    if (verifierInfoResponse) {
      const round = await openVerification(tx, row.id);
      if (
        row.status !== 'INFO_REQUESTED' ||
        !round ||
        round.state !== 'INFO_REQUESTED' ||
        (round.assignedVerifierId !== null && round.assignedVerifierId !== ctx.actor.userId)
      ) {
        throw new ForbiddenError(
          'Only the assigned verifier can complete this information request.',
        );
      }
    }
    const values = {
      label: 'Head office',
      addressLine: input.addressLine,
      cityCode: input.cityCode,
      areaCode: input.areaCode ?? null,
      location: input.location,
    };
    const [hq] = await tx
      .select({ id: locs.id })
      .from(locs)
      .where(and(eq(locs.companyId, row.id), eq(locs.kind, 'HQ')));
    if (hq) await tx.update(locs).set(values).where(eq(locs.id, hq.id));
    else await tx.insert(locs).values({ companyId: row.id, kind: 'HQ', ...values });
    audit({
      action: 'company.set_head_office',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
    });
  });
  if (verifierInfoResponse) {
    await autoResubmitInfoRequestIfReady(
      ctx,
      companyId,
      'Verifier saved the requested head office information.',
    );
  }
  return getCompanyDetail(ctx.actor, companyId);
}

const LEGAL_FIELDS = new Set<string>(COMPANY_LEGAL_FIELDS);

/** Super Admin corrects locked fields (legal name, NTN, etc.) on a verified company. */
export async function correctCompanyDetails(
  ctx: SignedIn,
  companyId: string,
  input: UpdateCompanyInput & { reason: string },
): Promise<CompanyView> {
  const isVerifier =
    hasRole(ctx.actor, 'VERIFIER') && !hasRole(ctx.actor, 'SUPER_ADMIN', 'BRANCH_ADMIN');
  if (!isVerifier) assertPermission(ctx.actor, 'company:manage');
  // Verifiers may correct details only while responding to a Branch Admin's
  // information request. All other corrections remain restricted to admins.
  assertRole(ctx.actor, 'SUPER_ADMIN', 'BRANCH_ADMIN', 'VERIFIER');
  const { reason, ...requested } = input;
  if (Object.keys(requested).length === 0) {
    throw new ValidationError([{ path: 'root', message: 'Change at least one field' }]);
  }
  try {
    await runCommand(ctx, async ({ tx, audit }) => {
      const row = await loadCompany(tx, companyId, { forUpdate: true });
      // Scope BEFORE the update: getCompanyDetail() at the end checks the
      // branch too, but only after this transaction commits — without this
      // line a cross-branch correction would silently land.
      assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
      if (isVerifier) {
        if (row.status !== 'INFO_REQUESTED') {
          throw new ForbiddenError(
            'Verifiers can only correct details after the Branch Admin requests information.',
          );
        }
        const round = await openVerification(tx, row.id);
        if (
          !round ||
          round.state !== 'INFO_REQUESTED' ||
          (round.assignedVerifierId !== null && round.assignedVerifierId !== ctx.actor.userId)
        ) {
          throw new ForbiddenError('Only the assigned verifier can correct this company.');
        }
      }
      // L16: only genuinely changed fields count — a "" that optionalText
      // mapped to null on an already-null field (tradeName, website, …) is
      // no change, not a correction. (Same diff as updateMyCompany.)
      const changes = Object.fromEntries(
        Object.entries(requested).filter(
          ([key, value]) => value !== undefined && value !== row[key as keyof typeof row],
        ),
      ) as UpdateCompanyInput;
      if (Object.keys(changes).length === 0) {
        throw new ValidationError([{ path: 'root', message: 'Change at least one field' }]);
      }
      // H1: while a verifier is reviewing, only the assigned verifier (or a
      // Branch/Super Admin) may correct details — another verifier must not
      // rewrite the company under review.
      if (row.status === 'UNDER_VERIFICATION' || row.status === 'RESUBMITTED') {
        if (!isSuperAdmin(ctx.actor) && !hasRole(ctx.actor, 'BRANCH_ADMIN')) {
          const round = await openVerification(tx, row.id);
          if (!round || round.assignedVerifierId !== ctx.actor.userId) {
            throw new ForbiddenError(
              'This company is under verification. Only the assigned verifier, a Branch Admin or a Super Admin can correct its details while it is being reviewed.',
            );
          }
        }
      }
      const touchesLegal = Object.keys(changes).some((key) => LEGAL_FIELDS.has(key));
      // A suspended company keeps its suspension: legal details change only
      // after reinstatement, when the new verification round can open.
      if (touchesLegal && row.status === 'SUSPENDED') {
        throw new ConflictError(
          'Reinstate the company first — changing its legal details needs a new verification round.',
        );
      }
      // A corrected NTN must not collide with another live company (see
      // assertNtnFree). Previously there was no check here at all: the update
      // hit the partial index and failed with a raw 500 instead of a 409.
      if (changes.ntn) await assertNtnFree(tx, changes.ntn, row.id);
      // H1: a changed industry must be an active master-data code, like the
      // employer and onboard paths already require.
      if (changes.industryCode) {
        await assertActiveMasterData(tx, 'INDUSTRY', [changes.industryCode], () => 'industryCode');
      }
      const before = Object.fromEntries(
        Object.keys(changes).map((k) => [k, row[k as keyof typeof row]]),
      );
      // H1: a VERIFIED badge must mean the verified details. Changing a legal
      // field (name, structure, NTN, registration no.) re-opens verification:
      // a fresh round is opened, the status returns to SUBMITTED and
      // verifiedAt is cleared. Non-legal changes keep the badge. There is no
      // VERIFIED → SUBMITTED machine transition, so the round opens directly
      // (same shape as markCompanyRegistrationVerifiedSigned).
      // Audit 2026-11-11 (M-11): the paper-form attestation is cleared too
      // — it attested to the OLD legal details. verifyCompany blocks the
      // new round until a colleague marks the new form verified & signed.
      if (touchesLegal && row.status === 'VERIFIED') {
        const now = new Date();
        const dueOn = await verificationDueOn(now);
        const [{ last } = { last: 0 }] = await tx
          .select({ last: max(ver.round) })
          .from(ver)
          .where(eq(ver.companyId, row.id));
        const [round] = await tx
          .insert(ver)
          .values({
            companyId: row.id,
            branchId: row.branchId!,
            round: (last ?? 0) + 1,
            submittedAt: now,
            clockStartedAt: now,
            slaDueOn: dueOn,
          })
          .returning();
        await tx
          .update(c)
          .set({
            ...changes,
            status: 'SUBMITTED',
            verifiedAt: null,
            registrationVerifiedSignedAt: null,
            registrationVerifiedSignedBy: null,
          })
          .where(eq(c.id, row.id));
        await recordTransition(tx, {
          verificationId: round!.id,
          companyId: row.id,
          event: 'SUBMIT',
          fromStatus: row.status,
          toStatus: 'SUBMITTED',
          actorId: ctx.actor.userId,
          metadata: {
            reVerification: true,
            legalFields: Object.keys(changes).filter((k) => LEGAL_FIELDS.has(k)),
            reason,
            slaDueOn: dueOn,
          },
        });
        audit({
          action: 'company.correct',
          entityType: 'company',
          entityId: row.id,
          branchId: row.branchId,
          before: {
            ...before,
            status: row.status,
            verifiedAt: row.verifiedAt?.toISOString() ?? null,
          },
          after: { ...changes, status: 'SUBMITTED', verifiedAt: null },
          metadata: { reason, reVerification: true },
        });
        return;
      }
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
  } catch (error) {
    if (isUniqueViolation(error, ACTIVE_NTN_CONSTRAINT)) throw ntnTaken();
    throw error;
  }
  if (isVerifier) {
    await autoResubmitInfoRequestIfReady(ctx, companyId, input.reason);
  }
  return getCompanyDetail(ctx.actor, companyId);
}
