import 'server-only';
import { schema } from '@jobbank/db';
import {
  APPLICANT_STATUSES,
  IDENTITY_STATUSES,
  masterDataCodeSchema,
  type ApplicantStatus,
  type IdentityMethod,
  type IdentityOutcome,
  type IdentityStatus,
  type IdentityVerificationInput,
  type UpdatePersonalInput,
} from '@jobbank/shared';
import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { isPlaceholderEmail, placeholderEmailFor } from '@/domains/auth';
import { getBranchContact, type BranchContact } from '@/domains/branch';
import { masterDataLabels } from '@/domains/settings';
import { runCommand } from '@/domains/shared/audit';
import {
  ConflictError,
  ForbiddenError,
  isUniqueViolation,
  ScopeViolationError,
  ValidationError,
} from '@/domains/shared/errors';
import { maskCnic, maskPhone } from '@/domains/shared/masking';
import { paginationMeta, type ListQuery } from '@/domains/shared/pagination';
import {
  assertCityAccess,
  assertPermission,
  hasPermission,
  isSuperAdmin,
  type Actor,
} from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { normalizePkMobile } from '@/lib/format/phone';
import { applicantMachine } from './machine';
import { cnicTakenError, IDENTITY_FIELDS } from './profile';
import {
  a,
  addr,
  buildProfile,
  cnicOwner,
  currentDocuments,
  docs,
  idv,
  loadApplicant,
  skl,
  type ApplicantProfile,
  type ApplicantRow,
  type SignedIn,
} from './repository';

// ─── Search ────────────────────────────────────────────────────────────

export const APPLICANT_SORTABLE = ['fullName', 'createdAt', 'profileCompleteness'] as const;

export const applicantFilters = {
  status: z.enum(APPLICANT_STATUSES).optional(),
  identityStatus: z.enum(IDENTITY_STATUSES).optional(),
  branchId: z.uuid().optional(),
  cityCode: masterDataCodeSchema.optional(),
  areaCode: masterDataCodeSchema.optional(),
  skillCode: masterDataCodeSchema.optional(),
};

export interface ApplicantListItem {
  id: string;
  fullName: string;
  /** "42101-•••••••-1": lists never show the full CNIC. */
  cnicMasked: string;
  phoneMasked: string | null;
  status: ApplicantStatus;
  identityStatus: IdentityStatus;
  profileCompleteness: number;
  branchName: string | null;
  cityLabel: string | null;
  areaLabel: string | null;
  createdAt: string;
}

export async function listApplicants(
  actor: Actor,
  query: ListQuery<
    (typeof APPLICANT_SORTABLE)[number],
    {
      status?: ApplicantStatus;
      identityStatus?: IdentityStatus;
      branchId?: string;
      cityCode?: string;
      areaCode?: string;
      skillCode?: string;
    }
  >,
) {
  assertPermission(actor, 'applicant:read');
  const f = query.filters;
  if (f.branchId && !isSuperAdmin(actor) && !actor.branchIds.includes(f.branchId)) {
    throw new ScopeViolationError(undefined, {
      entityType: 'branch',
      entityId: f.branchId,
      branchId: f.branchId,
    });
  }

  // City-based scoping: staff see all applicants whose city matches any city of their branches.
  const cityScope: SQL | undefined = isSuperAdmin(actor)
    ? undefined
    : actor.branchIds.length === 0
      ? sql`false`
      : exists(
          db
            .select({ one: sql`1` })
            .from(schema.branches)
            .where(
              and(
                inArray(schema.branches.id, actor.branchIds),
                sql`upper(${schema.branches.city}) = upper(${addr.cityCode})`,
              ),
            ),
        );

  const conditions: (SQL | undefined)[] = [
    cityScope,
    f.status ? eq(a.status, f.status) : undefined,
    f.identityStatus ? eq(a.identityStatus, f.identityStatus) : undefined,
    f.branchId ? eq(a.branchId, f.branchId) : undefined,
    f.cityCode ? eq(addr.cityCode, f.cityCode) : undefined,
    f.areaCode ? eq(addr.areaCode, f.areaCode) : undefined,
    f.skillCode
      ? exists(
          db
            .select({ one: sql`1` })
            .from(skl)
            .where(and(eq(skl.applicantId, a.id), eq(skl.skillCode, f.skillCode))),
        )
      : undefined,
  ];
  if (query.q) {
    // Names by substring; CNIC and phone by their digits (staff often have only one of them).
    const digits = query.q.replace(/\D/g, '');
    const phone = digits.length >= 10 ? normalizePkMobile(digits) : null;
    conditions.push(
      or(
        ilike(a.fullName, `%${query.q}%`),
        digits.length >= 5 ? sql`${a.cnic} like ${`${digits}%`}` : undefined,
        phone ? eq(schema.users.phoneNumber, phone) : undefined,
      ),
    );
  }
  const where = and(...conditions);

  const sortColumn = {
    fullName: a.fullName,
    createdAt: a.createdAt,
    profileCompleteness: a.profileCompleteness,
  }[query.sort.field];
  const base = () =>
    db
      .select({
        id: a.id,
        fullName: a.fullName,
        cnic: a.cnic,
        phone: schema.users.phoneNumber,
        status: a.status,
        identityStatus: a.identityStatus,
        profileCompleteness: a.profileCompleteness,
        branchName: schema.branches.name,
        cityCode: addr.cityCode,
        areaCode: addr.areaCode,
        createdAt: a.createdAt,
      })
      .from(a)
      .innerJoin(schema.users, eq(schema.users.id, a.userId))
      .leftJoin(schema.branches, eq(schema.branches.id, a.branchId))
      .leftJoin(addr, eq(addr.applicantId, a.id));

  const [rows, [total], labels] = await Promise.all([
    base()
      .where(where)
      .orderBy(query.sort.direction === 'asc' ? asc(sortColumn) : desc(sortColumn), asc(a.id))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ value: count() })
      .from(a)
      .innerJoin(schema.users, eq(schema.users.id, a.userId))
      .leftJoin(addr, eq(addr.applicantId, a.id))
      .where(where),
    masterDataLabels(['CITY', 'AREA']),
  ]);

  return {
    data: rows.map((row): ApplicantListItem => ({
      id: row.id,
      fullName: row.fullName,
      cnicMasked: maskCnic(row.cnic),
      phoneMasked: row.phone ? maskPhone(row.phone) : null,
      status: row.status,
      identityStatus: row.identityStatus,
      profileCompleteness: row.profileCompleteness,
      branchName: row.branchName,
      cityLabel: row.cityCode ? (labels.CITY?.[row.cityCode] ?? row.cityCode) : null,
      areaLabel: row.areaCode ? (labels.AREA?.[row.areaCode] ?? row.areaCode) : null,
      createdAt: row.createdAt.toISOString(),
    })),
    meta: paginationMeta(query, total?.value ?? 0),
  };
}

// ─── Detail ────────────────────────────────────────────────────────────

export interface IdentityCheckView {
  id: string;
  outcome: IdentityOutcome;
  method: IdentityMethod;
  notes: string | null;
  verifiedByName: string | null;
  createdAt: string;
  /** False when the CNIC was corrected after this check. */
  cnicMatchesCurrent: boolean;
}

export interface ApplicantStaffView extends ApplicantProfile {
  userId: string;
  statusReason: string | null;
  identityHistory: IdentityCheckView[];
  /** What the signed-in staff member may do (drives the UI). */
  can: {
    verifyIdentity: boolean;
    manage: boolean;
    transfer: boolean;
    shortlist: boolean;
    scheduleInterview: boolean;
    referToEmployer: boolean;
  };
}

async function scopedApplicant(actor: Actor, applicantId: string): Promise<ApplicantRow> {
  const row = await loadApplicant(db, applicantId);
  await assertCityAccess(actor, row.branchId, { entityType: 'applicant', entityId: row.id });
  return row;
}

export async function getApplicantForStaff(
  actor: Actor,
  applicantId: string,
): Promise<ApplicantStaffView> {
  assertPermission(actor, 'applicant:read');
  const row = await scopedApplicant(actor, applicantId);
  const [profile, history] = await Promise.all([
    buildProfile(db, row),
    db
      .select({
        id: idv.id,
        outcome: idv.outcome,
        method: idv.method,
        notes: idv.notes,
        cnic: idv.cnic,
        verifiedByName: schema.users.name,
        createdAt: idv.createdAt,
      })
      .from(idv)
      .leftJoin(schema.users, eq(schema.users.id, idv.verifiedBy))
      .where(eq(idv.applicantId, row.id))
      .orderBy(desc(idv.createdAt)),
  ]);
  return {
    ...profile,
    userId: row.userId,
    statusReason: row.statusReason,
    identityHistory: history.map((h) => ({
      id: h.id,
      outcome: h.outcome,
      method: h.method,
      notes: h.notes,
      verifiedByName: h.verifiedByName,
      createdAt: h.createdAt.toISOString(),
      cnicMatchesCurrent: h.cnic === row.cnic,
    })),
    can: {
      verifyIdentity:
        hasPermission(actor, 'applicant:verify_identity') && actor.userId !== row.userId,
      manage: hasPermission(actor, 'applicant:manage'),
      transfer: hasPermission(actor, 'applicant:transfer'),
      shortlist: hasPermission(actor, 'match_case:manage') && row.status === 'ACTIVE',
      scheduleInterview:
        hasPermission(actor, 'interview:schedule_jobbank') && row.status === 'ACTIVE',
      referToEmployer: hasPermission(actor, 'match_case:refer') && row.status === 'ACTIVE',
    },
  };
}

// ─── Identity verification ─────────────────────────────────────────────

/**
 * Records a staff identity check (append-only) and updates the applicant's identity status.
 * A document review needs the current CNIC front and back; those documents are marked
 * accepted or rejected along with the check.
 */
export async function verifyApplicantIdentity(
  ctx: SignedIn,
  applicantId: string,
  input: IdentityVerificationInput,
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:verify_identity');
  await scopedApplicant(ctx.actor, applicantId);
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadApplicant(tx, applicantId, { forUpdate: true });
    if (row.userId === ctx.actor.userId) {
      throw new ForbiddenError('You cannot verify your own identity');
    }
    if (input.outcome === 'VERIFIED' && row.identityStatus === 'VERIFIED') {
      throw new ConflictError('This identity is already verified');
    }
    const current = await currentDocuments(tx, row.id);
    const front = current.find((d) => d.typeCode === 'CNIC_FRONT') ?? null;
    const back = current.find((d) => d.typeCode === 'CNIC_BACK') ?? null;
    if (input.method === 'DOCUMENT_REVIEW' && (!front || !back)) {
      throw new ConflictError(
        'The applicant has not uploaded both sides of their CNIC. Ask them to, or check the original card in person.',
      );
    }
    const now = new Date();
    await tx.insert(idv).values({
      applicantId: row.id,
      cnic: row.cnic,
      method: input.method,
      outcome: input.outcome,
      notes: input.notes,
      frontDocumentId: front?.id ?? null,
      backDocumentId: back?.id ?? null,
      verifiedBy: ctx.actor.userId,
    });
    await tx.update(a).set({ identityStatus: input.outcome }).where(eq(a.id, row.id));
    if (input.method === 'DOCUMENT_REVIEW') {
      await tx
        .update(docs)
        .set({
          status: input.outcome === 'VERIFIED' ? 'ACCEPTED' : 'REJECTED',
          reviewNote: input.outcome === 'VERIFIED' ? null : input.notes,
          reviewedBy: ctx.actor.userId,
          reviewedAt: now,
        })
        .where(inArray(docs.id, [front!.id, back!.id]));
    }
    audit({
      action:
        input.outcome === 'VERIFIED' ? 'applicant.identity_verify' : 'applicant.identity_reject',
      entityType: 'applicant',
      entityId: row.id,
      branchId: row.branchId,
      before: { identityStatus: row.identityStatus },
      after: { identityStatus: input.outcome, method: input.method },
      reason: input.notes,
    });
  });
  return getApplicantForStaff(ctx.actor, applicantId);
}

// ─── Corrections & account recovery ────────────────────────────────────

/**
 * Staff correct personal details (e.g. a typo found during the identity check). Changing an
 * identity field resets the identity status, so the profile is checked again.
 */
export async function staffUpdateApplicant(
  ctx: SignedIn,
  applicantId: string,
  input: UpdatePersonalInput & { reason: string },
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:manage');
  const { reason, ...fields } = input;
  await scopedApplicant(ctx.actor, applicantId);
  try {
    await runCommand(ctx, async ({ tx, audit }) => {
      const row = await loadApplicant(tx, applicantId, { forUpdate: true });
      const changes = Object.fromEntries(
        Object.entries(fields).filter(
          ([k, v]) => v !== undefined && v !== row[k as keyof ApplicantRow],
        ),
      ) as UpdatePersonalInput;
      if (Object.keys(changes).length === 0) throw new ConflictError('Nothing was changed');
      if (changes.cnic) {
        const owner = await cnicOwner(tx, changes.cnic, row.id);
        if (owner) throw await cnicTakenError(tx, owner);
      }
      const identityChanged = IDENTITY_FIELDS.some((field) => field in changes);
      await tx
        .update(a)
        .set({
          ...changes,
          identityStatus: identityChanged ? 'UNVERIFIED' : row.identityStatus,
        })
        .where(eq(a.id, row.id));
      if (changes.fullName) {
        await tx
          .update(schema.users)
          .set({ name: changes.fullName })
          .where(eq(schema.users.id, row.userId));
      }
      audit({
        action: 'applicant.staff_update',
        entityType: 'applicant',
        entityId: row.id,
        branchId: row.branchId,
        before: Object.fromEntries(
          Object.keys(changes).map((k) => [k, row[k as keyof ApplicantRow]]),
        ),
        after: changes,
        reason,
        metadata: { identityReset: identityChanged && row.identityStatus !== 'UNVERIFIED' },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, 'applicants_cnic_unique')) {
      throw new ConflictError('Another applicant already has this CNIC');
    }
    throw error;
  }
  return getApplicantForStaff(ctx.actor, applicantId);
}

/**
 * Account recovery (owner decision 3): the applicant lost their SIM, or registered the CNIC
 * from another number. Staff move the profile to the new number; old sessions end.
 */
export async function changeApplicantPhone(
  ctx: SignedIn,
  applicantId: string,
  input: { phone: string; reason: string },
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:manage');
  const phone = normalizePkMobile(input.phone);
  if (!phone) {
    throw new ValidationError([{ path: 'phone', message: 'Enter a Pakistani mobile number' }]);
  }
  await scopedApplicant(ctx.actor, applicantId);
  try {
    await runCommand(ctx, async ({ tx, audit }) => {
      const row = await loadApplicant(tx, applicantId, { forUpdate: true });
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, row.userId));
      if (user!.phoneNumber === phone) throw new ConflictError('This is already their number');
      const [taken] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phoneNumber, phone));
      if (taken) {
        throw new ConflictError(
          'This number is used by another account. That account must be closed first.',
        );
      }
      await tx
        .update(schema.users)
        .set({
          phoneNumber: phone,
          phoneNumberVerified: true,
          // The placeholder email is derived from the phone, so a new sign-up with the old
          // number must not collide with it.
          ...(isPlaceholderEmail(user!.email) ? { email: placeholderEmailFor(phone) } : {}),
        })
        .where(eq(schema.users.id, row.userId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, row.userId));
      audit({
        action: 'applicant.phone_change',
        entityType: 'applicant',
        entityId: row.id,
        branchId: row.branchId,
        reason: input.reason,
        metadata: {
          from: user!.phoneNumber ? maskPhone(user!.phoneNumber) : null,
          to: maskPhone(phone),
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        'This number is used by another account. That account must be closed first.',
      );
    }
    throw error;
  }
  return getApplicantForStaff(ctx.actor, applicantId);
}

/** Staff deactivate (e.g. unreachable, found work elsewhere) or reactivate, with a reason. */
export async function staffSetApplicantStatus(
  ctx: SignedIn,
  applicantId: string,
  input: { status: 'ACTIVE' | 'INACTIVE'; reason: string },
): Promise<ApplicantStaffView> {
  assertPermission(ctx.actor, 'applicant:manage');
  await scopedApplicant(ctx.actor, applicantId);
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadApplicant(tx, applicantId, { forUpdate: true });
    const event = input.status === 'INACTIVE' ? 'DEACTIVATE' : 'REACTIVATE';
    const to = applicantMachine.transition(
      row.status,
      event,
      { activationMissing: [] },
      ctx.actor.roles,
    );
    await tx
      .update(a)
      .set({ status: to, statusReason: input.status === 'INACTIVE' ? input.reason : null })
      .where(eq(a.id, row.id));
    audit({
      action: input.status === 'INACTIVE' ? 'applicant.deactivate' : 'applicant.reactivate',
      entityType: 'applicant',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
      reason: input.reason,
      metadata: { by: 'staff' },
    });
  });
  return getApplicantForStaff(ctx.actor, applicantId);
}

/**
 * Branch Admin (of the current branch) or Super Admin moves an applicant to another branch.
 * Returns only the new branch: a Branch Admin can no longer open the profile afterwards.
 */
export async function transferApplicant(
  ctx: SignedIn,
  applicantId: string,
  input: { branchId: string; reason: string },
): Promise<{ applicantId: string; branch: BranchContact }> {
  assertPermission(ctx.actor, 'applicant:transfer');
  await scopedApplicant(ctx.actor, applicantId);
  return runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadApplicant(tx, applicantId, { forUpdate: true });
    if (row.branchId === input.branchId) {
      throw new ConflictError('The applicant is already in this branch');
    }
    const target = await getBranchContact(input.branchId, tx);
    if (!target?.isActive) {
      throw new ValidationError([{ path: 'branchId', message: 'Choose an active branch' }]);
    }
    await tx.update(a).set({ branchId: input.branchId }).where(eq(a.id, row.id));
    audit({
      action: 'applicant.transfer',
      entityType: 'applicant',
      entityId: row.id,
      branchId: input.branchId,
      before: { branchId: row.branchId },
      after: { branchId: input.branchId },
      reason: input.reason,
    });
    return { applicantId: row.id, branch: target };
  });
}
