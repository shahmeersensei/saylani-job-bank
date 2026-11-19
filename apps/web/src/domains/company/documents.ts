import 'server-only';
import { PUBLIC_COMPANY_STATUSES, type CompanyPresignInput } from '@jobbank/shared';
import { and, eq } from 'drizzle-orm';
import { recordAudit, runCommand } from '@/domains/shared/audit';
import {
  confirmDocumentUpload,
  downloadDocument,
  presignDocumentUpload,
  receiveDocumentUpload,
  viewDocumentLink,
  type DocumentLink,
  type DocumentTable,
  type PresignedDocument,
  type ReceivedUpload,
} from '@/domains/shared/documents';
import { ConflictError, ForbiddenError, NotFoundError } from '@/domains/shared/errors';
import {
  assertBranchAccess,
  assertCityAccess,
  assertPermission,
  hasPermission,
  isSuperAdmin,
  type Actor,
} from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';
import type { StoredObject } from '@/lib/s3/storage';
import { companyEditability } from './rules';
import {
  buildCompanyView,
  companyDocumentTypes,
  docs,
  loadCompany,
  requireOwnCompany,
  type CompanyRow,
  type CompanyView,
  type SignedIn,
} from './repository';
import { autoResubmitInfoRequestIfReady, getCompanyOnboarding } from './staff';

export type { DocumentLink };
export type PresignedCompanyDocument = PresignedDocument;

/** Document table columns the shared upload pipeline touches. */
const companyDocumentStore: DocumentTable = {
  table: docs,
  id: docs.id,
  owner: docs.companyId,
  typeCode: docs.typeCode,
  replacedAt: docs.replacedAt,
};

function assertDocumentEditable(row: CompanyRow): void {
  if (!companyEditability(row.status).documents) {
    throw new ForbiddenError(
      'Documents cannot be changed while a verifier is reviewing your company. Wait for their response.',
    );
  }
}

/**
 * Step 1 (shared): checks file against the document type's rules, creates a
 * PENDING_UPLOAD row, returns the same-origin upload route for it. The file
 * goes through the app, never straight from the browser to storage.
 * Used by the employer's own upload and by the onboard upload for onboarded companies —
 * the type allowlist, size limits, content-type locking and rate limit are identical.
 */
async function presignDocumentForCompany(
  ctx: SignedIn,
  row: CompanyRow,
  input: CompanyPresignInput,
  uploadUrl: (documentId: string) => string,
): Promise<PresignedCompanyDocument> {
  return presignDocumentUpload({
    ctx,
    store: companyDocumentStore,
    row,
    input,
    entity: 'company',
    types: (await companyDocumentTypes()).filter((t) => t.isActive),
    rateLimitName: 'company-upload',
    branchError: 'Set your head office location and branch before uploading documents',
    assertEditableBeforeType: () => assertDocumentEditable(row),
    uploadUrl,
  });
}

/** Step 1 for the employer: presign an upload for their own company. */
export async function presignMyCompanyDocument(
  ctx: SignedIn,
  input: CompanyPresignInput,
): Promise<PresignedCompanyDocument> {
  assertPermission(ctx.actor, 'company:register');
  const row = await requireOwnCompany(db, ctx.actor);
  return presignDocumentForCompany(
    ctx,
    row,
    input,
    (documentId) => `/api/v1/companies/me/documents/${documentId}/upload`,
  );
}

/** Step 1½ for the employer: store the bytes for a presigned upload. */
export async function uploadMyCompanyDocument(
  ctx: SignedIn,
  documentId: string,
  contentType: string | null,
  body: Uint8Array,
): Promise<ReceivedUpload> {
  assertPermission(ctx.actor, 'company:register');
  const row = await requireOwnCompany(db, ctx.actor);
  assertDocumentEditable(row);
  return receiveDocumentUpload({ doc: await ownDocument(db, row, documentId), contentType, body });
}

async function ownDocument(executor: DbExecutor, row: CompanyRow, documentId: string) {
  const [doc] = await executor
    .select()
    .from(docs)
    .where(and(eq(docs.id, documentId), eq(docs.companyId, row.id)));
  if (!doc) throw new NotFoundError('Document', documentId);
  return doc;
}

/**
 * Step 2 (shared): browser finished the PUT. Verify what actually landed in storage,
 * verify the file's magic bytes match its declared type, scan for malware, then make
 * it the current document of its type (superseding earlier uploads). Used by the
 * employer's own upload and by the onboard upload for onboarded companies — storage
 * check, type check, scan handling, supersede and audit are identical. See
 * `confirmDocumentUpload` in `@/domains/shared/documents` for the shared outcomes
 * (mismatch leaves the row PENDING_UPLOAD — the company enum has no REJECTED value;
 * 'skipped' scans block only in production).
 */
async function confirmDocumentForCompany(
  ctx: SignedIn,
  row: CompanyRow,
  documentId: string,
): Promise<CompanyView> {
  const doc = await ownDocument(db, row, documentId);
  if (doc.status !== 'PENDING_UPLOAD') return buildCompanyView(db, row);
  assertDocumentEditable(row);
  await confirmDocumentUpload({
    ctx,
    store: companyDocumentStore,
    doc,
    entityType: 'company',
    entityId: row.id,
    branchId: row.branchId,
    ownerId: row.id,
    multiple: false,
    mismatch: { status: null, reviewNote: null },
    infectedStatus: 'INFECTED',
  });
  return buildCompanyView(db, await loadCompany(db, row.id));
}

/** Step 2 for the employer: confirm an upload for their own company. */
export async function confirmMyCompanyDocument(
  ctx: SignedIn,
  documentId: string,
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  const row = await requireOwnCompany(db, ctx.actor);
  return confirmDocumentForCompany(ctx, row, documentId);
}

// ─── Onboard upload (F1) ─────────────────────────────────────────────────

/**
 * Gate for the onboard upload path. A company qualifies only when it was onboarded
 * after a field visit — the outreach record is the marker (see getCompanyOnboarding,
 * the same detector markCompanyRegistrationVerifiedSigned uses): employer
 * self-registered companies and legacy staff-registered companies carry no visit /
 * agreement record and are rejected here. Uploads happen while the company is still
 * a DRAFT, i.e. before the paper form is marked verified & signed, and while it is
 * INFO_REQUESTED, i.e. the verifier asked for more and the onboarder is supplying
 * it; once the company is with the verifier, documents are the verifier's to
 * review, not staff's to change. Branch scope matches staffOnboardCompany /
 * markCompanyRegistrationVerifiedSigned: Super Admin bypasses it, everyone else
 * must be in the company's branch.
 */
async function loadStaffOnboardedCompany(ctx: SignedIn, companyId: string): Promise<CompanyRow> {
  assertPermission(ctx.actor, 'company:onboard');
  const row = await loadCompany(db, companyId);
  if (!isSuperAdmin(ctx.actor)) {
    assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
  }
  const onboarding = await getCompanyOnboarding(ctx.actor, companyId);
  if (!onboarding) {
    throw new ForbiddenError(
      'Documents for this company can only be uploaded by the employer who registered it.',
    );
  }
  // M9: no self-upload — the onboarder must not supply the documents the
  // deciding verifier trusts. A colleague in the branch uploads them
  // (this gate covers both the presign and the confirm step).
  if (row.createdBy === ctx.actor.userId) {
    throw new ConflictError(
      'You cannot upload documents for a company you onboarded. Ask another staff member in your branch.',
      { reason: 'SELF_ATTESTATION' },
    );
  }
  if (row.status !== 'DRAFT' && row.status !== 'INFO_REQUESTED') {
    throw new ConflictError(
      'Documents can only be uploaded while the company is still a draft or the verifier has asked for more information. Once it is with the verifier, only the verifier can review the documents.',
    );
  }
  return row;
}

/**
 * Step 1 (onboard): presign an upload for an onboarded DRAFT company.
 * Same pipeline as the employer path — type allowlist, size limits, content-type
 * locking and the per-company rate limit are identical.
 */
export async function presignStaffCompanyDocument(
  ctx: SignedIn,
  companyId: string,
  input: CompanyPresignInput,
): Promise<PresignedCompanyDocument> {
  const row = await loadStaffOnboardedCompany(ctx, companyId);
  return presignDocumentForCompany(
    ctx,
    row,
    input,
    (documentId) => `/api/v1/companies/${companyId}/documents/${documentId}/upload`,
  );
}

/** Step 1½ (onboard): store the bytes for a presigned upload. Same gates as confirm. */
export async function uploadStaffCompanyDocument(
  ctx: SignedIn,
  companyId: string,
  documentId: string,
  contentType: string | null,
  body: Uint8Array,
): Promise<ReceivedUpload> {
  const row = await loadStaffOnboardedCompany(ctx, companyId);
  return receiveDocumentUpload({ doc: await ownDocument(db, row, documentId), contentType, body });
}

/**
 * Step 2 (onboard): confirm an upload for an onboarded DRAFT company.
 * Same pipeline as the employer path — storage check, malware scan, supersede of
 * earlier uploads of the same type, and the same audit entries.
 */
export async function confirmStaffCompanyDocument(
  ctx: SignedIn,
  companyId: string,
  documentId: string,
): Promise<CompanyView> {
  const row = await loadStaffOnboardedCompany(ctx, companyId);
  const saved = await confirmDocumentForCompany(ctx, row, documentId);
  const resubmitted = await autoResubmitInfoRequestIfReady(
    ctx,
    companyId,
    'Verifier saved the requested document information.',
  );
  return resubmitted ? buildCompanyView(db, await loadCompany(db, companyId)) : saved;
}

/** Remove (supersede) a document. Required documents can only be replaced, not removed. */
export async function removeMyCompanyDocument(
  ctx: SignedIn,
  documentId: string,
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  const row = await requireOwnCompany(db, ctx.actor);
  const doc = await ownDocument(db, row, documentId);
  if (doc.replacedAt) return buildCompanyView(db, row);
  assertDocumentEditable(row);
  await runCommand(ctx, async ({ tx, audit }) => {
    await tx.update(docs).set({ replacedAt: new Date() }).where(eq(docs.id, doc.id));
    audit({
      action: 'company.document_remove',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      metadata: { documentId: doc.id, typeCode: doc.typeCode },
    });
  });
  return buildCompanyView(db, await requireOwnCompany(db, ctx.actor));
}

const PRESENT_STATUSES = ['UPLOADED', 'REJECTED'] as const;

/** Short-lived download link for the employer to view their own upload. */
export async function myCompanyDocumentLink(
  actor: Actor,
  documentId: string,
): Promise<DocumentLink> {
  assertPermission(actor, 'company:register');
  const row = await requireOwnCompany(db, actor);
  return viewDocumentLink(
    await ownDocument(db, row, documentId),
    PRESENT_STATUSES,
    `/api/v1/companies/me/documents/${documentId}/download`,
  );
}

/** The employer downloading their own upload — same gates as the view link. */
export async function downloadMyCompanyDocument(
  actor: Actor,
  documentId: string,
): Promise<StoredObject> {
  assertPermission(actor, 'company:register');
  const row = await requireOwnCompany(db, actor);
  return downloadDocument(await ownDocument(db, row, documentId), PRESENT_STATUSES);
}

/** Staff (verifier / Branch Admin) viewing a company document — audited. */
export async function staffCompanyDocumentLink(
  ctx: SignedIn,
  companyId: string,
  documentId: string,
): Promise<DocumentLink> {
  // Audit 2026-11-11 (L-24): explicit permission assert (defense-in-depth
  // — the route already gates on company:read) and the same non-manager
  // status rule as getCompanyDetail: a DRAFT company's documents, including
  // authorised-person CNIC images, are not open to company:read holders.
  const canManage = hasPermission(ctx.actor, 'company:manage');
  if (!canManage) assertPermission(ctx.actor, 'company:read');
  const row = await loadCompany(db, companyId);
  // Audit 2026-11-11 (L-25): city scope, like getCompanyDetail.
  await assertCityAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
  if (!canManage && !(PUBLIC_COMPANY_STATUSES as readonly string[]).includes(row.status)) {
    throw new ForbiddenError('This company is not yet verified');
  }
  const doc = await ownDocument(db, row, documentId);
  const link = await viewDocumentLink(
    doc,
    PRESENT_STATUSES,
    `/api/v1/companies/${companyId}/documents/${documentId}/download`,
  );
  await recordAudit(ctx, {
    action: 'company.document_view',
    entityType: 'company',
    entityId: row.id,
    branchId: row.branchId,
    metadata: { documentId: doc.id, typeCode: doc.typeCode },
  });
  return link;
}

/** Staff downloading a company document — same gates as the view link. */
export async function downloadStaffCompanyDocument(
  ctx: SignedIn,
  companyId: string,
  documentId: string,
): Promise<StoredObject> {
  const canManage = hasPermission(ctx.actor, 'company:manage');
  if (!canManage) assertPermission(ctx.actor, 'company:read');
  const row = await loadCompany(db, companyId);
  await assertCityAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
  if (!canManage && !(PUBLIC_COMPANY_STATUSES as readonly string[]).includes(row.status)) {
    throw new ForbiddenError('This company is not yet verified');
  }
  return downloadDocument(await ownDocument(db, row, documentId), PRESENT_STATUSES);
}
