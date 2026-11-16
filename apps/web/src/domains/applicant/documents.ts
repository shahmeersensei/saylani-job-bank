import 'server-only';
import { missingApplicantDocumentRequirements, type PresignDocumentInput } from '@jobbank/shared';
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
import { assertCityAccess, assertPermission, type Actor } from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';
import type { StoredObject } from '@/lib/s3/storage';
import {
  a,
  applicantDocumentTypes,
  buildProfile,
  currentDocuments,
  docs,
  IDENTITY_DOCUMENT_TYPES,
  identityLocked,
  loadApplicant,
  PRESENT_DOCUMENT_STATUSES,
  pref,
  refreshProfileState,
  requireOwnApplicant,
  type ApplicantDocumentType,
  type ApplicantProfile,
  type ApplicantRow,
  type SignedIn,
} from './repository';

export type { DocumentLink, PresignedDocument };

/** Document table columns the shared upload pipeline touches. */
const applicantDocumentStore: DocumentTable = {
  table: docs,
  id: docs.id,
  owner: docs.applicantId,
  typeCode: docs.typeCode,
  replacedAt: docs.replacedAt,
};

const isIdentityDocument = (typeCode: string) =>
  (IDENTITY_DOCUMENT_TYPES as readonly string[]).includes(typeCode);

/** Active applicant document types, for the upload screen. */
export async function listApplicantDocumentTypes(): Promise<ApplicantDocumentType[]> {
  return (await applicantDocumentTypes()).filter((t) => t.isActive);
}

function assertIdentityDocumentEditable(row: ApplicantRow, typeCode: string): void {
  if (isIdentityDocument(typeCode) && identityLocked(row)) {
    throw new ForbiddenError(
      'Your identity has been verified, so your CNIC images are locked. Ask your branch if they need changing.',
    );
  }
}

/**
 * Step 1 of an upload: checks the file against the document type's rules and returns a
 * same-origin upload route for it. The file goes through the app, never straight to storage.
 */
export async function presignMyDocument(
  ctx: SignedIn,
  input: PresignDocumentInput,
): Promise<PresignedDocument> {
  assertPermission(ctx.actor, 'applicant:self');
  const row = await requireOwnApplicant(db, ctx.actor);
  return presignDocumentUpload({
    ctx,
    store: applicantDocumentStore,
    row,
    input,
    entity: 'applicant',
    types: await listApplicantDocumentTypes(),
    rateLimitName: 'applicant-upload',
    branchError: 'Set your home location and branch before uploading documents',
    assertEditableAfterType: (typeCode) => assertIdentityDocumentEditable(row, typeCode),
    uploadUrl: (documentId) => `/api/v1/applicants/me/documents/${documentId}/upload`,
  });
}

/**
 * Step 1½ (same-origin upload): store the bytes for a PENDING_UPLOAD row the
 * applicant presigned. Same gates as confirm, so a locked identity document
 * cannot gain a new file here either.
 */
export async function uploadMyDocument(
  ctx: SignedIn,
  documentId: string,
  contentType: string | null,
  body: Uint8Array,
): Promise<ReceivedUpload> {
  assertPermission(ctx.actor, 'applicant:self');
  const row = await requireOwnApplicant(db, ctx.actor);
  const doc = await ownDocument(db, row, documentId);
  assertIdentityDocumentEditable(row, doc.typeCode);
  return receiveDocumentUpload({ doc, contentType, body });
}

async function ownDocument(executor: DbExecutor, row: ApplicantRow, documentId: string) {
  const [doc] = await executor
    .select()
    .from(docs)
    .where(and(eq(docs.id, documentId), eq(docs.applicantId, row.id)));
  if (!doc) throw new NotFoundError('Document', documentId);
  return doc;
}

/**
 * Step 2: the browser finished the PUT. Checks what actually landed in storage (never trust
 * the client), verifies the file's magic bytes match its declared type, scans it, and
 * makes it the current document of its type. See `confirmDocumentUpload` in
 * `@/domains/shared/documents` for the shared outcomes (mismatch → REJECTED here;
 * 'skipped' scans block only in production).
 */
export async function confirmMyDocument(
  ctx: SignedIn,
  documentId: string,
): Promise<ApplicantProfile> {
  assertPermission(ctx.actor, 'applicant:self');
  const row = await requireOwnApplicant(db, ctx.actor);
  const doc = await ownDocument(db, row, documentId);
  if (doc.status !== 'PENDING_UPLOAD') return buildProfile(db, row);
  assertIdentityDocumentEditable(row, doc.typeCode);
  const type = (await applicantDocumentTypes()).find((t) => t.code === doc.typeCode);
  await confirmDocumentUpload({
    ctx,
    store: applicantDocumentStore,
    doc,
    entityType: 'applicant',
    entityId: row.id,
    branchId: row.branchId,
    ownerId: row.id,
    multiple: type?.meta.multiple ?? false,
    mismatch: {
      status: 'REJECTED',
      reviewNote: 'The file contents do not match its declared type',
    },
    infectedStatus: 'REJECTED',
    loadOwner: (tx) => loadApplicant(tx, row.id, { forUpdate: true }),
    onUploaded: async (cmd, owner) => {
      // New CNIC images after a failed check go back to staff for a new check.
      if (owner && isIdentityDocument(doc.typeCode) && owner.identityStatus === 'REJECTED') {
        await cmd.tx.update(a).set({ identityStatus: 'UNVERIFIED' }).where(eq(a.id, row.id));
      }
    },
    afterUpload: async (cmd) => {
      await refreshProfileState(cmd, row.id);
    },
  });
  return buildProfile(db, await requireOwnApplicant(db, ctx.actor));
}

/** Optional documents can be removed; required ones can only be replaced. Rows are kept. */
export async function removeMyDocument(
  ctx: SignedIn,
  documentId: string,
): Promise<ApplicantProfile> {
  assertPermission(ctx.actor, 'applicant:self');
  const row = await requireOwnApplicant(db, ctx.actor);
  const doc = await ownDocument(db, row, documentId);
  if (doc.replacedAt) return buildProfile(db, row);
  assertIdentityDocumentEditable(row, doc.typeCode);
  const [types, [preferences], present] = await Promise.all([
    applicantDocumentTypes(),
    db.select({ categories: pref.categoryCodes }).from(pref).where(eq(pref.applicantId, row.id)),
    currentDocuments(db, row.id),
  ]);
  const activeRequirements = types
    .filter((type) => type.isActive)
    .map((type) => ({ code: type.code, ...type.meta }));
  const categories = preferences?.categories ?? [];
  const missingBefore = missingApplicantDocumentRequirements(
    activeRequirements,
    categories,
    present.map((document) => document.typeCode),
  );
  const missingAfter = missingApplicantDocumentRequirements(
    activeRequirements,
    categories,
    present.filter((document) => document.id !== doc.id).map((document) => document.typeCode),
  );
  if (missingAfter > missingBefore) {
    throw new ConflictError(
      'This document is required for your selected job categories and cannot be removed',
    );
  }
  await runCommand(ctx, async (cmd) => {
    await cmd.tx.update(docs).set({ replacedAt: new Date() }).where(eq(docs.id, doc.id));
    cmd.audit({
      action: 'applicant.document_remove',
      entityType: 'applicant',
      entityId: row.id,
      branchId: row.branchId,
      metadata: { documentId: doc.id, typeCode: doc.typeCode },
    });
    await refreshProfileState(cmd, row.id);
  });
  return buildProfile(db, await requireOwnApplicant(db, ctx.actor));
}

/** Short-lived link for the applicant to view their own upload. */
export async function myDocumentLink(actor: Actor, documentId: string): Promise<DocumentLink> {
  assertPermission(actor, 'applicant:self');
  const row = await requireOwnApplicant(db, actor);
  return viewDocumentLink(
    await ownDocument(db, row, documentId),
    PRESENT_DOCUMENT_STATUSES,
    `/api/v1/applicants/me/documents/${documentId}/download`,
  );
}

/** The applicant downloading their own upload — same gates as the view link. */
export async function downloadMyDocument(actor: Actor, documentId: string): Promise<StoredObject> {
  assertPermission(actor, 'applicant:self');
  const row = await requireOwnApplicant(db, actor);
  return downloadDocument(await ownDocument(db, row, documentId), PRESENT_DOCUMENT_STATUSES);
}

/** Staff viewing an applicant's document: city-scoped like the profile read (audit 2026-11-11, M-23), and always audited. */
export async function staffDocumentLink(
  ctx: SignedIn,
  applicantId: string,
  documentId: string,
): Promise<DocumentLink> {
  assertPermission(ctx.actor, 'applicant:read');
  const row = await loadApplicant(db, applicantId);
  await assertCityAccess(ctx.actor, row.branchId, { entityType: 'applicant', entityId: row.id });
  const doc = await ownDocument(db, row, documentId);
  const link = await viewDocumentLink(
    doc,
    PRESENT_DOCUMENT_STATUSES,
    `/api/v1/applicants/${applicantId}/documents/${documentId}/download`,
  );
  await recordAudit(ctx, {
    action: 'applicant.document_view',
    entityType: 'applicant',
    entityId: row.id,
    branchId: row.branchId,
    metadata: { documentId: doc.id, typeCode: doc.typeCode },
  });
  return link;
}

/** Staff downloading an applicant's document — same gates as the view link. */
export async function downloadStaffApplicantDocument(
  ctx: SignedIn,
  applicantId: string,
  documentId: string,
): Promise<StoredObject> {
  assertPermission(ctx.actor, 'applicant:read');
  const row = await loadApplicant(db, applicantId);
  await assertCityAccess(ctx.actor, row.branchId, { entityType: 'applicant', entityId: row.id });
  return downloadDocument(await ownDocument(db, row, documentId), PRESENT_DOCUMENT_STATUSES);
}

// ─── Staff photo capture (2026-11-13) ────────────────────────────────────
// Live photo capture at registration runs before the applicant exists, so the
// photo cannot go through the applicant's own upload path. Instead the form
// holds the captured JPEG in memory, creates the applicant, then uploads it
// here — the same presign → same-origin upload → confirm pipeline, with
// the seeded PHOTO document type (Passport-size photo, JPEG/PNG, max 2 MB).
// Only PHOTO is accepted on these endpoints: staff document uploads of any
// other type stay on the applicant's own path.

/** Staff registering an applicant: city-scoped like the profile read. */
async function loadStaffApplicantForPhoto(
  ctx: SignedIn,
  applicantId: string,
): Promise<ApplicantRow> {
  assertPermission(ctx.actor, 'applicant:create');
  const row = await loadApplicant(db, applicantId);
  await assertCityAccess(ctx.actor, row.branchId, { entityType: 'applicant', entityId: row.id });
  return row;
}

/** Step 1 (staff): presign a PHOTO upload for a just-registered applicant. */
export async function presignStaffApplicantPhoto(
  ctx: SignedIn,
  applicantId: string,
  input: PresignDocumentInput,
): Promise<PresignedDocument> {
  const row = await loadStaffApplicantForPhoto(ctx, applicantId);
  if (input.typeCode !== 'PHOTO') {
    throw new ForbiddenError('Only the passport-size photo can be uploaded here.');
  }
  return presignDocumentUpload({
    ctx,
    store: applicantDocumentStore,
    row,
    input,
    entity: 'applicant',
    types: (await listApplicantDocumentTypes()).filter((t) => t.code === 'PHOTO'),
    rateLimitName: 'applicant-upload',
    branchError: 'Set your home location and branch before uploading documents',
    uploadUrl: (documentId) => `/api/v1/applicants/${applicantId}/documents/${documentId}/upload`,
  });
}

/** Step 1½ (staff): store the bytes for a presigned PHOTO upload. */
export async function uploadStaffApplicantPhoto(
  ctx: SignedIn,
  applicantId: string,
  documentId: string,
  contentType: string | null,
  body: Uint8Array,
): Promise<ReceivedUpload> {
  const row = await loadStaffApplicantForPhoto(ctx, applicantId);
  const doc = await ownDocument(db, row, documentId);
  if (doc.typeCode !== 'PHOTO') {
    throw new ForbiddenError('Only the passport-size photo can be uploaded here.');
  }
  return receiveDocumentUpload({ doc, contentType, body });
}

/** Step 2 (staff): confirm a PHOTO upload for a just-registered applicant. */
export async function confirmStaffApplicantPhoto(
  ctx: SignedIn,
  applicantId: string,
  documentId: string,
): Promise<ApplicantProfile> {
  const row = await loadStaffApplicantForPhoto(ctx, applicantId);
  const doc = await ownDocument(db, row, documentId);
  if (doc.typeCode !== 'PHOTO') {
    throw new ForbiddenError('Only the passport-size photo can be confirmed here.');
  }
  if (doc.status !== 'PENDING_UPLOAD') return buildProfile(db, row);
  const type = (await applicantDocumentTypes()).find((t) => t.code === doc.typeCode);
  await confirmDocumentUpload({
    ctx,
    store: applicantDocumentStore,
    doc,
    entityType: 'applicant',
    entityId: row.id,
    branchId: row.branchId,
    ownerId: row.id,
    multiple: type?.meta.multiple ?? false,
    mismatch: {
      status: 'REJECTED',
      reviewNote: 'The file contents do not match its declared type',
    },
    infectedStatus: 'REJECTED',
    loadOwner: (tx) => loadApplicant(tx, row.id, { forUpdate: true }),
    afterUpload: async (cmd) => {
      await refreshProfileState(cmd, row.id);
    },
  });
  return buildProfile(db, await loadApplicant(db, row.id));
}
