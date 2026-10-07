import 'server-only';
import { schema } from '@jobbank/db';
import type { CompanyStatus, DocumentReviewInput, VerificationState } from '@jobbank/shared';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { masterDataLabels } from '@/domains/settings';
import { getWorkingCalendar, pktDate } from '@/domains/settings';
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
  type Actor,
} from '@/domains/shared/scope';
import { db } from '@/lib/db';
import { formatDate } from '@/lib/format/date';
import {
  companyInfoRequestedEmail,
  companyRejectedEmail,
  companyVerifiedEmail,
} from '@/lib/mail/templates';
import { companyMachine, READY, type CompanyMachineContext } from './machine';
import { emailEmployers } from './notify';
import {
  buildCompanyView,
  c,
  contacts,
  currentDocuments,
  docs,
  documentsNotAccepted,
  loadCompany,
  openVerification,
  recordTransition,
  submissionMissing,
  toDocumentView,
  toVerificationSummary,
  ver,
  verificationDueOn,
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
  ntn: string;
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
 * Verifier queue: all open rounds in the verifier's branch(es), sorted by SLA urgency.
 * Verifiers see the whole branch queue so they know what is waiting; their own claimed
 * items are highlighted with the `mine` filter.
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
    branchScope(actor, ver.branchId),
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

/** The verifier's full view of a company — same as the employer's view plus the verification. */
export async function getCompanyForReview(actor: Actor, companyId: string): Promise<CompanyView> {
  assertPermission(actor, 'company:verify');
  const row = await loadCompany(db, companyId);
  assertBranchAccess(actor, row.branchId, { entityType: 'company', entityId: row.id });
  return buildCompanyView(db, row);
}

function assertAssignedVerifier(round: VerificationRow, actor: Actor) {
  if (round.assignedVerifierId !== actor.userId) {
    throw new ForbiddenError(
      'This company is not assigned to you. Claim it from the queue first, or ask a Super Admin to assign it.',
    );
  }
}

async function autoConflictCheck(actor: Actor, companyId: string): Promise<string | null> {
  const [verifier] = await db
    .select({ email: schema.users.email, phone: schema.users.phoneNumber })
    .from(schema.users)
    .where(eq(schema.users.id, actor.userId));
  if (!verifier) return null;
  const contactRows = await db
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

// ─── Claim / release ───────────────────────────────────────────────────

/** Pick up a SUBMITTED company from the queue. */
export async function claimCompany(ctx: SignedIn, companyId: string): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:verify');
  const conflict = await autoConflictCheck(ctx.actor, companyId);
  if (conflict) {
    throw new ConflictError(
      `You cannot verify this company: ${conflict}. Ask another verifier or your Super Admin.`,
      { reason: 'CONFLICT_OF_INTEREST' },
    );
  }
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
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
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
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
  assertPermission(ctx.actor, 'company:verify');
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (!round) throw new NotFoundError('Open verification for company', companyId);
    assertAssignedVerifier(round, ctx.actor);
    if (!['UNDER_VERIFICATION', 'RESUBMITTED'].includes(row.status)) {
      throw new ForbiddenError(
        'Documents can only be reviewed while the company is under verification',
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
  await runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    const machineCtx: CompanyMachineContext = {
      submissionMissing: await submissionMissing(tx, row),
      documentsNotAccepted: [],
    };
    const to = companyMachine.transition(row.status, 'REQUEST_INFO', machineCtx, ctx.actor.roles);
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (!round) throw new NotFoundError('Open verification for company', companyId);
    assertAssignedVerifier(round, ctx.actor);
    const now = new Date();
    await tx
      .update(ver)
      .set({ state: 'INFO_REQUESTED', infoRequest: input.note, infoRequestedAt: now })
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
      metadata: { note: input.note },
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
  return view;
}

export async function verifyCompany(
  ctx: SignedIn,
  companyId: string,
  input: { note: string | null },
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:verify');
  await runCommand(ctx, async ({ tx, audit, emit }) => {
    const row = await loadCompany(tx, companyId, { forUpdate: true });
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    const machineCtx: CompanyMachineContext = {
      submissionMissing: await submissionMissing(tx, row),
      documentsNotAccepted: await documentsNotAccepted(tx, row),
    };
    const to = companyMachine.transition(row.status, 'VERIFY', machineCtx, ctx.actor.roles);
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (!round) throw new NotFoundError('Open verification for company', companyId);
    assertAssignedVerifier(round, ctx.actor);
    const now = new Date();
    await tx
      .update(ver)
      .set({ state: 'VERIFIED', decidedAt: now, decisionNote: input.note })
      .where(eq(ver.id, round.id));
    await tx.update(c).set({ status: to, verifiedAt: now }).where(eq(c.id, row.id));
    await recordTransition(tx, {
      verificationId: round.id,
      companyId: row.id,
      event: 'VERIFY',
      fromStatus: row.status,
      toStatus: to,
      actorId: ctx.actor.userId,
      note: input.note,
    });
    audit({
      action: 'company.verify',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      before: { status: row.status },
      after: { status: to },
    });
    emit('company.verified', { companyId: row.id, branchId: row.branchId! });
  });
  const view = await getCompanyForReview(ctx.actor, companyId);
  await emailEmployers(ctx, companyId, ({ name, url }) =>
    companyVerifiedEmail({ name, companyName: view.details.legalName, url }),
  );
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
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
    const machineCtx: CompanyMachineContext = {
      submissionMissing: await submissionMissing(tx, row),
      documentsNotAccepted: [],
    };
    const to = companyMachine.transition(row.status, 'REJECT', machineCtx, ctx.actor.roles);
    const round = await openVerification(tx, row.id, { forUpdate: true });
    if (!round) throw new NotFoundError('Open verification for company', companyId);
    assertAssignedVerifier(round, ctx.actor);
    const now = new Date();
    await tx
      .update(ver)
      .set({
        state: 'REJECTED',
        decidedAt: now,
        rejectionReasonCode: input.reasonCode,
        decisionNote: input.note,
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
  return view;
}
