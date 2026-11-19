import 'server-only';
import { schema } from '@jobbank/db';
import type { DocumentReviewInput, VerificationState } from '@jobbank/shared';
import { and, asc, count, desc, eq, gte, inArray, lt, max, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  assertActiveMasterData,
  getWorkingCalendar,
  masterDataLabels,
  pktDate,
  workingDaysBetween,
} from '@/domains/settings';
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
  assertCityAccess,
  assertPermission,
  assertRole,
  cityScope,
  type Actor,
} from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';
import {
  companyInfoRequestedEmail,
  companyRejectedEmail,
  companyVerifiedEmail,
} from '@/lib/mail/templates';
import { companyMachine, READY, type CompanyMachineContext } from './machine';
import { emailEmployers, notifyCompanyOutcome } from './notify';
import {
  buildCompanyView,
  c,
  contacts,
  docs,
  documentsNotAccepted,
  loadCompany,
  openVerification,
  recordTransition,
  submissionMissing,
  ver,
  verificationDueOn,
  type CompanyRow,
  type CompanyView,
  type SignedIn,
  type VerificationRow,
} from './repository';
import { conflictReason, slaStatus } from './rules';

// ─── Verification queue ────────────────────────────────────────────────

export const QUEUE_SORTABLE = ['submittedAt', 'slaDueOn', 'legalName'] as const;

const QUEUE_STATES: readonly VerificationState[] = [
  'SUBMITTED',
  'UNDER_VERIFICATION',
  'INFO_REQUESTED',
  'RESUBMITTED',
];

export const queueFilters = {
  state: z.enum(['SUBMITTED', 'UNDER_VERIFICATION', 'INFO_REQUESTED', 'RESUBMITTED']).optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
};

export interface QueueItem {
  verificationId: string;
  companyId: string;
  legalName: string;
  tradeName: string | null;
  ntn: string | null;
  state: VerificationState;
  round: number;
  submittedAt: string;
  slaDueOn: string;
  sla: ReturnType<typeof slaStatus>;
  verifierId: string | null;
  verifierName: string | null;
  branchName: string;
}

/**
 * Branch Admin verification queue: all open rounds in the Branch Admin's
 * branch(es), sorted by SLA urgency.
 */
export async function listQueue(
  actor: Actor,
  query: ListQuery<(typeof QUEUE_SORTABLE)[number], { state?: VerificationState; mine?: boolean }>,
) {
  assertPermission(actor, 'company:verify');
  const f = query.filters;
  const now = new Date();
  const today = pktDate(now);

  const conditions: (SQL | undefined)[] = [
    cityScope(actor, ver.branchId),
    inArray(ver.state, [...QUEUE_STATES]),
    f.state ? eq(ver.state, f.state) : undefined,
    f.mine ? eq(ver.assignedVerifierId, actor.userId) : undefined,
  ];
  const where = and(...conditions);

  const sortColumn = {
    submittedAt: ver.submittedAt,
    slaDueOn: ver.slaDueOn,
    legalName: c.legalName,
  }[query.sort.field];

  const base = () =>
    db
      .select({
        verificationId: ver.id,
        companyId: ver.companyId,
        legalName: c.legalName,
        tradeName: c.tradeName,
        ntn: c.ntn,
        state: ver.state,
        round: ver.round,
        submittedAt: ver.submittedAt,
        slaDueOn: ver.slaDueOn,
        verifierId: ver.assignedVerifierId,
        verifierName: schema.users.name,
        branchName: schema.branches.name,
      })
      .from(ver)
      .innerJoin(c, eq(c.id, ver.companyId))
      .innerJoin(schema.branches, eq(schema.branches.id, ver.branchId))
      .leftJoin(schema.users, eq(schema.users.id, ver.assignedVerifierId));

  const [rows, [total]] = await Promise.all([
    base()
      .where(where)
      .orderBy(query.sort.direction === 'asc' ? asc(sortColumn) : desc(sortColumn), asc(ver.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(ver).innerJoin(c, eq(c.id, ver.companyId)).where(where),
  ]);

  const items: QueueItem[] = rows.map((row) => ({
    verificationId: row.verificationId,
    companyId: row.companyId,
    legalName: row.legalName,
    tradeName: row.tradeName,
    ntn: row.ntn,
    state: row.state,
    round: row.round,
    submittedAt: row.submittedAt.toISOString(),
    slaDueOn: row.slaDueOn,
    sla: slaStatus(row.state, row.slaDueOn, today),
    verifierId: row.verifierId,
    verifierName: row.verifierName,
    branchName: row.branchName!,
  }));

  return { items, pagination: paginationMeta(query, total!.value) };
}

// ─── Review helpers ────────────────────────────────────────────────────

/**
 * Monthly verifications done by the signed-in Branch Admin (H8), current calendar year,
 * branch-scoped exactly like the queue (cityScope): counts verification rounds this
 * reviewer decided VERIFIED, bucketed by decidedAt in PKT months (M1 — a decision
 * at 00:30 PKT on 1 November belongs to November, not October). Months with no
 * decisions are 0 — the dashboard chart shows real decisions, never invented bars.
 * The year window is PKT too: 1 Jan 00:00 PKT = 31 Dec 19:00 UTC the year before.
 */
export async function countVerificationsDoneByMonth(actor: Actor, year: number): Promise<number[]> {
  assertPermission(actor, 'company:verify');
  const start = new Date(Date.UTC(year - 1, 11, 31, 19));
  const end = new Date(Date.UTC(year, 11, 31, 19));
  const rows = await db
    .select({
      month: sql<number>`extract(month from ${ver.decidedAt} at time zone 'Asia/Karachi')`,
      value: count(),
    })
    .from(ver)
    .where(
      and(
        cityScope(actor, ver.branchId),
        eq(ver.state, 'VERIFIED'),
        eq(ver.decidedBy, actor.userId),
        gte(ver.decidedAt, start),
        lt(ver.decidedAt, end),
      ),
    )
    .groupBy(sql`extract(month from ${ver.decidedAt} at time zone 'Asia/Karachi')`);
  const values = Array.from({ length: 12 }, () => 0);
  for (const row of rows) {
    if (row.month >= 1 && row.month <= 12) values[row.month - 1] = row.value;
  }
  return values;
}

/** The reviewer's full view of a company — same as the employer's view plus the verification. */
export async function getCompanyForReview(actor: Actor, companyId: string): Promise<CompanyView> {
  assertPermission(actor, 'company:verify');
  const row = await loadCompany(db, companyId);
  await assertCityAccess(actor, row.branchId, { entityType: 'company', entityId: row.id });
  return buildCompanyView(db, row);
}

/**
 * The open verification round for a company, creating one when the company
 * has none yet. Field-visit companies are reviewed straight from DRAFT and
 * never went through SUBMIT, so no round exists for them until the Branch
 * Admin's first review action. For a direct DRAFT verification, the company
 * verification and paper-form attestation are recorded together; for the
 * separate signing flow, submittedAt honours the existing attestation.
 */
async function ensureOpenVerification(tx: DbExecutor, row: CompanyRow): Promise<VerificationRow> {
  const existing = await openVerification(tx, row.id, { forUpdate: true });
  if (existing) return existing;
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
      submittedAt: row.registrationVerifiedSignedAt ?? now,
      clockStartedAt: now,
      slaDueOn: dueOn,
    })
    .returning();
  return round!;
}

function assertAssignedVerifier(round: VerificationRow, actor: Actor) {
  if (round.assignedVerifierId !== actor.userId) {
    throw new ForbiddenError(
      'This company is not assigned to you. Claim it from the queue first, or ask a Super Admin to assign it.',
    );
  }
}

async function autoConflictCheck(
  actor: Actor,
  companyId: string,
  // Audit 2026-11-11 (L-07): pass the transaction when checking inside
  // one — a plain `db` read there would still be a pre-transaction
  // snapshot for the TOCTOU the claim guard is meant to close.
  ex: DbExecutor = db,
): Promise<string | null> {
  const [verifier] = await ex
    .select({ email: schema.users.email, phone: schema.users.phoneNumber })
    .from(schema.users)
    .where(eq(schema.users.id, actor.userId));
  if (!verifier) return null;
  const contactRows = await ex
    .select({ phone: contacts.phone, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.companyId, companyId));
  return conflictReason(
    { email: verifier.email, phone: verifier.phone },
    {
      emails: contactRows.map((r) => r.email),
      phones: contactRows.map((r) => r.phone),
    },
  );
}

/** Same conflict message as claimCompany, for the review paths below. */
async function assertNoConflictOfInterest(
  actor: Actor,
  companyId: string,
  ex: DbExecutor = db,
): Promise<void> {
  const conflict = await autoConflictCheck(actor, companyId, ex);
  if (conflict) {
    throw new ConflictError(
      `You cannot verify this company: ${conflict}. Ask another Branch Admin or your Super Admin.`,
      { reason: 'CONFLICT_OF_INTEREST' },
    );
  }
}

/**
 * Validate a Super Admin assignment target before it is written: the user
 * must exist, be ACTIVE, hold the VERIFIER role, work in the company's city,
 * and pass the same contact-conflict check claimCompany runs (no shared
 * email/phone with the company's contacts). The onboarder may be assigned:
 * verifiers are allowed to verify companies they created themselves, so there
 * is no not-the-creator check here. Assignment used to accept any user id —
 * including staff and employers.
 */
export async function assertAssignableVerifier(
  verifierId: string,
  company: CompanyRow,
): Promise<void> {
  const [user] = await db
    .select({ id: schema.users.id, status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.id, verifierId));
  if (!user) throw new NotFoundError('User', verifierId);
  if (user.status !== 'ACTIVE') {
    throw new ValidationError([
      { path: 'verifierId', message: 'Choose an active verification officer' },
    ]);
  }
  const roles = await db
    .select({ roleCode: schema.userRoles.roleCode, branchId: schema.userRoles.branchId })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, verifierId));
  const verifierBranches = roles
    .filter((r) => r.roleCode === 'VERIFIER' && r.branchId)
    .map((r) => r.branchId!);
  if (verifierBranches.length === 0) {
    throw new ValidationError([{ path: 'verifierId', message: 'Choose a verification officer' }]);
  }
  // The target's own scope, not the assigner's: assertCityAccess reads the
  // branchIds off the actor it is given.
  const target: Actor = {
    userId: verifierId,
    roles: ['VERIFIER'],
    permissions: new Set(),
    branchIds: verifierBranches,
    activeBranchId: null,
    companyId: null,
    applicantId: null,
    twoFactorPending: false,
  };
  await assertCityAccess(target, company.branchId, {
    entityType: 'company',
    entityId: company.id,
  });
  await assertNoConflictOfInterest(target, company.id);
}

// ─── Claim / release ───────────────────────────────────────────────────

/** Pick up a SUBMITTED company from the queue.
 * Legacy Verifier-queue flow: since verification moved to the Branch Admin
 * (2026-11-14) nothing claims companies any more — the Branch Admin reviews
 * straight from DRAFT or SUBMITTED. Kept so in-flight rounds stay readable;
 * the route is permission-gated to company:verify, which Verifiers no
 * longer hold, and the machine CLAIM transition still requires VERIFIER. */
export async function claimCompany(ctx: SignedIn, companyId: string): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:verify');
  // M33: scope BEFORE the conflict check — the conflict signal must not leak
  // for a company outside the verifier's branches. The check runs again
  // inside the transaction below, so this is ordering, not the guard itself.
  const preview = await loadCompany(db, companyId);
  await assertCityAccess(ctx.actor, preview.branchId, {
    entityType: 'company',
    entityId: preview.id,
  });
  const conflict = await autoConflictCheck(ctx.actor, companyId);
  if (conflict) {
    throw new ConflictError(
      `You cannot verify this company: ${conflict}. Ask another verifier or your Super Admin.`,
      { reason: 'CONFLICT_OF_INTEREST' },
    );
  }
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    await assertCityAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    // Audit 2026-11-11 (L-07): the conflict check runs again inside the
    // transaction, against the locked row — a contact added between the
    // pre-check above and this commit now blocks the claim.
    await assertNoConflictOfInterest(ctx.actor, companyId, tx);
    const to = companyMachine.transition(row.status, 'CLAIM', READY, ctx.actor.roles);
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (!round) throw new NotFoundError('Open verification for company', companyId);
    if (round.assignedVerifierId && round.assignedVerifierId !== ctx.actor.userId) {
      throw new ConflictError('Another verifier already claimed this company');
    }
    await tx
      .update(ver)
      .set({ state: 'UNDER_VERIFICATION', assignedVerifierId: ctx.actor.userId })
      .where(eq(ver.id, round.id));
    await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
    await recordTransition(tx, {
      verificationId: round.id,
      companyId: row.id,
      event: 'CLAIM',
      fromStatus: row.status,
      toStatus: to,
      actorId: ctx.actor.userId,
    });
    audit({
      action: 'company.claim',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to, assignedVerifierId: ctx.actor.userId },
    });
  });
  return getCompanyForReview(ctx.actor, companyId);
}

/** Return a company to the queue. If conflict = true, records the conflict. */
export async function releaseCompany(
  ctx: SignedIn,
  companyId: string,
  input: { conflict: boolean; note: string | null },
): Promise<void> {
  assertPermission(ctx.actor, 'company:verify');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    await assertCityAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    const event = input.conflict ? 'DECLARE_CONFLICT' : 'RELEASE';
    const to = companyMachine.transition(row.status, event, READY, ctx.actor.roles);
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (!round) throw new NotFoundError('Open verification for company', companyId);
    assertAssignedVerifier(round, ctx.actor);
    await tx
      .update(ver)
      .set({ state: 'SUBMITTED', assignedVerifierId: null })
      .where(eq(ver.id, round.id));
    await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
    await recordTransition(tx, {
      verificationId: round.id,
      companyId: row.id,
      event,
      fromStatus: row.status,
      toStatus: to,
      actorId: ctx.actor.userId,
      note: input.note,
    });
    audit({
      action: input.conflict ? 'company.declare_conflict' : 'company.release',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status, assignedVerifierId: round.assignedVerifierId },
      after: { status: to, assignedVerifierId: null },
      metadata: input.conflict ? { conflict: true } : undefined,
    });
  });
}

// ─── Per-document review ───────────────────────────────────────────────

/** Accept or reject a single company document. */
export async function reviewDocument(
  ctx: SignedIn,
  companyId: string,
  documentId: string,
  input: DocumentReviewInput,
): Promise<CompanyView> {
  assertRole(ctx.actor, 'BRANCH_ADMIN');
  assertPermission(ctx.actor, 'company:verify');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    // A round must exist before a document is reviewed: DRAFT companies
    // have none until the first review action opens one.
    await ensureOpenVerification(tx, row);
    // The contact-conflict check is re-run here: the review paths check it
    // themselves.
    await assertNoConflictOfInterest(ctx.actor, companyId);
    if (!['DRAFT', 'SUBMITTED', 'UNDER_VERIFICATION', 'RESUBMITTED'].includes(row.status)) {
      throw new ForbiddenError(
        'Documents can only be reviewed while the company is awaiting verification',
      );
    }
    const [doc] = await tx
      .select()
      .from(docs)
      .where(and(eq(docs.id, documentId), eq(docs.companyId, companyId)));
    if (!doc || doc.status !== 'UPLOADED') {
      throw new NotFoundError('Uploaded document', documentId);
    }
    await tx
      .update(docs)
      .set({
        reviewStatus: input.decision,
        reviewNote: input.note ?? null,
        reviewedBy: ctx.actor.userId,
        reviewedAt: new Date(),
      })
      .where(eq(docs.id, doc.id));
    audit({
      action: 'company.review_document',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { reviewStatus: doc.reviewStatus },
      after: { reviewStatus: input.decision, reviewNote: input.note },
      metadata: { documentId: doc.id, typeCode: doc.typeCode },
    });
  });
  return getCompanyForReview(ctx.actor, companyId);
}

// ─── Request info / verify / reject ────────────────────────────────────

export async function requestInfo(
  ctx: SignedIn,
  companyId: string,
  input: { note: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:verify');
  // M23: the SLA pauses while the employer replies — the remaining working
  // days are recorded here so resubmit resumes from them (Specialist D),
  // instead of granting a full fresh SLA.
  const calendar = await getWorkingCalendar();
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    await assertCityAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    const machineCtx: CompanyMachineContext = {
      submissionMissing: await submissionMissing(tx, row),
      documentsNotAccepted: [],
    };
    const to = companyMachine.transition(row.status, 'REQUEST_INFO', machineCtx, ctx.actor.roles);
    const round = await ensureOpenVerification(tx, row);
    await assertNoConflictOfInterest(ctx.actor, companyId);
    const now = new Date();
    // Working days left on the SLA, counting the due day itself and
    // flooring at 0 once the round is already past due.
    const slaRemainingDays = Math.max(
      0,
      workingDaysBetween(pktDate(now), round.slaDueOn, calendar),
    );
    await tx
      .update(ver)
      .set({
        state: 'INFO_REQUESTED',
        infoRequest: input.note,
        infoRequestedAt: now,
        slaRemainingDays,
      })
      .where(eq(ver.id, round.id));
    await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
    await recordTransition(tx, {
      verificationId: round.id,
      companyId: row.id,
      event: 'REQUEST_INFO',
      fromStatus: row.status,
      toStatus: to,
      actorId: ctx.actor.userId,
      note: input.note,
    });
    audit({
      action: 'company.request_info',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
      metadata: { note: input.note, slaRemainingDays },
    });
  });
  const view = await getCompanyForReview(ctx.actor, companyId);
  await emailEmployers(ctx, companyId, ({ name, url }) =>
    companyInfoRequestedEmail({
      name,
      companyName: view.details.legalName,
      request: input.note,
      url,
    }),
  );
  // Audit 2026-11-11 (M-15): the outcome was email-only; notify in-app too
  // (employer members + the staff onboarder). Best-effort, post-commit.
  void notifyCompanyOutcome(db, companyId, ({ userId }) => ({
    userId,
    type: 'COMPANY_INFO_REQUESTED',
    title: `More information needed — ${view.details.legalName}`,
    body: `The Branch Admin asked for more information about ${view.details.legalName}: ${input.note}`,
    data: { companyId },
  })).catch((err) => ctx.log.error('company info-request notification failed', { companyId, err }));
  return view;
}

export async function verifyCompany(
  ctx: SignedIn,
  companyId: string,
  input: { note: string | null },
): Promise<CompanyView> {
  assertRole(ctx.actor, 'BRANCH_ADMIN');
  assertPermission(ctx.actor, 'company:verify');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    await assertNoConflictOfInterest(ctx.actor, companyId);

    const [onboarding] = await tx
      .select({ companyId: schema.companyOnboarding.companyId })
      .from(schema.companyOnboarding)
      .where(
        and(
          eq(schema.companyOnboarding.companyId, row.id),
          eq(schema.companyOnboarding.agreed, true),
        ),
      )
      .limit(1);
    const directFieldVisitVerification = Boolean(onboarding && row.status === 'DRAFT');
    const finalFieldVisitApproval = Boolean(onboarding && row.status === 'RESUBMITTED');
    const acceptingResubmission = row.status === 'RESUBMITTED';
    const outstandingSubmissionItems = acceptingResubmission
      ? await submissionMissing(tx, row)
      : [];
    const outstandingDocuments = acceptingResubmission ? await documentsNotAccepted(tx, row) : [];
    const machineCtx: CompanyMachineContext = {
      submissionMissing:
        directFieldVisitVerification || acceptingResubmission
          ? []
          : await submissionMissing(tx, row),
      documentsNotAccepted:
        directFieldVisitVerification || acceptingResubmission
          ? []
          : await documentsNotAccepted(tx, row),
    };
    const to = companyMachine.transition(row.status, 'VERIFY', machineCtx, ctx.actor.roles);
    const round = await ensureOpenVerification(tx, row);
    // A field-visit DRAFT is verified directly by its Branch Admin. A
    // resubmitted field-visit company is signed again as part of final
    // Branch Admin approval; other field-visit rounds need a separate,
    // current paper-form attestation. Employer registrations have no paper
    // form, and info-request resubmits reuse their original verification round.
    if (onboarding && !directFieldVisitVerification && !finalFieldVisitApproval) {
      const signedAt = row.registrationVerifiedSignedAt;
      if (!signedAt || signedAt < round.submittedAt) {
        throw new ConflictError(
          'This company’s paper registration form must be marked verified and signed for the current details before it can be verified. Ask a staff member who did not onboard the company.',
          { reason: 'PAPER_FORM_NOT_SIGNED' },
        );
      }
    }
    const now = new Date();
    await tx
      .update(ver)
      .set({
        state: 'VERIFIED',
        decidedAt: now,
        decisionNote: input.note,
        decidedBy: ctx.actor.userId,
      })
      .where(eq(ver.id, round.id));
    await tx
      .update(c)
      .set({
        status: to,
        verifiedAt: now,
        ...(directFieldVisitVerification || finalFieldVisitApproval
          ? {
              registrationVerifiedSignedAt: now,
              registrationVerifiedSignedBy: ctx.actor.userId,
            }
          : {}),
      })
      .where(eq(c.id, row.id));
    await recordTransition(tx, {
      verificationId: round.id,
      companyId: row.id,
      event: 'VERIFY',
      fromStatus: row.status,
      toStatus: to,
      actorId: ctx.actor.userId,
      note: input.note,
      ...(acceptingResubmission
        ? {
            metadata: {
              acceptedWithOutstandingRequirements:
                outstandingSubmissionItems.length > 0 || outstandingDocuments.length > 0,
              acceptedResubmission: true,
              submissionMissing: outstandingSubmissionItems,
              documentsNotAccepted: outstandingDocuments,
            },
          }
        : {}),
    });
    audit({
      action: 'company.verify',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
      ...(acceptingResubmission
        ? {
            metadata: {
              acceptedWithOutstandingRequirements:
                outstandingSubmissionItems.length > 0 || outstandingDocuments.length > 0,
              acceptedResubmission: true,
              submissionMissing: outstandingSubmissionItems,
              documentsNotAccepted: outstandingDocuments,
            },
          }
        : {}),
    });
    if (directFieldVisitVerification || finalFieldVisitApproval) {
      audit({
        action: 'company.registration_form_verified_signed',
        entityType: 'company',
        entityId: row.id,
        branchId: row.branchId,
        after: { verifiedSigned: true },
        metadata: {
          verifiedBy: ctx.actor.userId,
          verifiedWithCompany: true,
          finalResubmission: finalFieldVisitApproval,
        },
      });
    }
  });
  const view = await getCompanyForReview(ctx.actor, companyId);
  await emailEmployers(ctx, companyId, ({ name, url }) =>
    companyVerifiedEmail({ name, companyName: view.details.legalName, url }),
  );
  // Audit 2026-11-11 (M-15): the outcome was email-only; notify in-app too
  // (employer members + the staff onboarder). Best-effort, post-commit.
  void notifyCompanyOutcome(db, companyId, ({ userId }) => ({
    userId,
    type: 'COMPANY_VERIFIED',
    title: `Company verified — ${view.details.legalName}`,
    body: `${view.details.legalName} has been verified and can now post jobs.`,
    data: { companyId },
  })).catch((err) => ctx.log.error('company verify notification failed', { companyId, err }));
  return view;
}

export async function rejectCompany(
  ctx: SignedIn,
  companyId: string,
  input: { reasonCode: string; note: string },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:verify');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    await assertCityAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    // M20 — a rejection reason must be an active VERIFICATION_REJECTION_REASON;
    // a retired or invented code must not be stored or emailed to the employer.
    await assertActiveMasterData(
      tx,
      'VERIFICATION_REJECTION_REASON',
      [input.reasonCode],
      () => 'reasonCode',
    );
    const machineCtx: CompanyMachineContext = {
      submissionMissing: await submissionMissing(tx, row),
      documentsNotAccepted: [],
    };
    const to = companyMachine.transition(row.status, 'REJECT', machineCtx, ctx.actor.roles);
    const round = await ensureOpenVerification(tx, row);
    await assertNoConflictOfInterest(ctx.actor, companyId);
    const now = new Date();
    await tx
      .update(ver)
      .set({
        state: 'REJECTED',
        decidedAt: now,
        rejectionReasonCode: input.reasonCode,
        decisionNote: input.note,
        decidedBy: ctx.actor.userId,
      })
      .where(eq(ver.id, round.id));
    await tx.update(c).set({ status: to }).where(eq(c.id, row.id));
    await recordTransition(tx, {
      verificationId: round.id,
      companyId: row.id,
      event: 'REJECT',
      fromStatus: row.status,
      toStatus: to,
      actorId: ctx.actor.userId,
      note: input.note,
      reasonCode: input.reasonCode,
    });
    audit({
      action: 'company.reject',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
      metadata: { reasonCode: input.reasonCode },
    });
  });
  const view = await getCompanyForReview(ctx.actor, companyId);
  const allLabels = await masterDataLabels(['VERIFICATION_REJECTION_REASON']);
  const rejectionLabels = allLabels['VERIFICATION_REJECTION_REASON'] ?? {};
  await emailEmployers(ctx, companyId, ({ name, url }) =>
    companyRejectedEmail({
      name,
      companyName: view.details.legalName,
      reason: rejectionLabels[input.reasonCode] ?? input.reasonCode,
      note: input.note,
      url,
    }),
  );
  // Audit 2026-11-11 (M-15): the outcome was email-only; notify in-app too
  // (employer members + the staff onboarder). Best-effort, post-commit.
  void notifyCompanyOutcome(db, companyId, ({ userId }) => ({
    userId,
    type: 'COMPANY_REJECTED',
    title: `Company verification rejected — ${view.details.legalName}`,
    body: `${view.details.legalName} was not verified (${rejectionLabels[input.reasonCode] ?? input.reasonCode}). ${input.note}`,
    data: { companyId, reasonCode: input.reasonCode },
  })).catch((err) => ctx.log.error('company reject notification failed', { companyId, err }));
  return view;
}
