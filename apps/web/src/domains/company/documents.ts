import 'server-only';
import type { CompanyPresignInput } from '@jobbank/shared';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { recordAudit, runCommand } from '@/domains/shared/audit';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/domains/shared/errors';
import { enforceRateLimit } from '@/domains/shared/rate-limit';
import { assertBranchAccess, assertPermission, type Actor } from '@/domains/shared/scope';
import { db, type DbExecutor } from '@/lib/db';
import {
  assertUploadAllowed,
  buildObjectKey,
  headObject,
  malwareScanner,
  presignDownload,
  presignUpload,
  UploadRejectedError,
  type PresignedUpload,
} from '@/lib/s3/storage';
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

const MB = 1024 * 1024;
const VIEW_LINK_SECONDS = 120;

export interface PresignedCompanyDocument {
  documentId: string;
  upload: PresignedUpload;
}

function assertDocumentEditable(row: CompanyRow): void {
  if (!companyEditability(row.status).documents) {
    throw new ForbiddenError(
      'Documents cannot be changed while a verifier is reviewing your company. Wait for their response.',
    );
  }
}

/**
 * Step 1: checks file against the document type's rules, creates a PENDING_UPLOAD row,
 * returns a presigned PUT the browser sends the file straight to.
 */
export async function presignMyCompanyDocument(
  ctx: SignedIn,
  input: CompanyPresignInput,
): Promise<PresignedCompanyDocument> {
  assertPermission(ctx.actor, 'company:register');
  const row = await requireOwnCompany(db, ctx.actor);
  if (!row.branchId) {
    throw new ConflictError('Set your head office location and branch before uploading documents');
  }
  assertDocumentEditable(row);
  const types = await companyDocumentTypes();
  const type = types.find((t) => t.code === input.typeCode && t.isActive);
  if (!type) throw new ValidationError([{ path: 'typeCode', message: 'Choose a document type' }]);
  try {
    assertUploadAllowed(input.contentType, input.sizeBytes, {
      contentTypes: type.meta.mimeTypes,
      maxSizeBytes: type.meta.maxSizeMb * MB,
    });
  } catch (error) {
    if (error instanceof UploadRejectedError) {
      throw new ValidationError([{ path: 'file', message: error.message }]);
    }
    throw error;
  }
  await enforceRateLimit(
    'company-upload',
    row.id,
    { limit: 30, windowSeconds: 3600 },
    'Too many uploads. Please try again in an hour.',
  );
  const key = buildObjectKey({
    branchId: row.branchId,
    entity: 'company',
    entityId: row.id,
    contentType: input.contentType,
  });
  // Not audited: nothing stored yet. The confirm step records the upload.
  const documentId = await runCommand(
    ctx,
    async ({ tx }) => {
      const [doc] = await tx
        .insert(docs)
        .values({
          companyId: row.id,
          typeCode: type.code,
          storageKey: key,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
        })
        .returning({ id: docs.id });
      return doc!.id;
    },
    { audited: false },
  );
  const upload = await presignUpload({
    key,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });
  return { documentId, upload };
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
 * Step 2: browser finished the PUT. Verify what actually landed in storage, scan for
 * malware, then make it the current document of its type (superseding earlier uploads).
 */
export async function confirmMyCompanyDocument(
  ctx: SignedIn,
  documentId: string,
): Promise<CompanyView> {
  assertPermission(ctx.actor, 'company:register');
  const row = await requireOwnCompany(db, ctx.actor);
  const doc = await ownDocument(db, row, documentId);
  if (doc.status !== 'PENDING_UPLOAD') return buildCompanyView(db, row);
  assertDocumentEditable(row);

  const stored = await headObject(doc.storageKey);
  if (!stored) throw new ConflictError('We did not receive the file. Please upload it again.');
  if (stored.sizeBytes !== doc.sizeBytes || stored.contentType !== doc.contentType) {
    throw new ConflictError('The uploaded file does not match. Please upload it again.');
  }
  const scan = await malwareScanner.scan(doc.storageKey);

  await runCommand(ctx, async ({ tx, audit }) => {
    if (scan === 'infected') {
      await tx
        .update(docs)
        .set({ status: 'INFECTED', scanResult: scan, reviewNote: 'The file failed a virus check' })
        .where(eq(docs.id, doc.id));
      audit({
        action: 'company.document_infected',
        entityType: 'company',
        entityId: row.id,
        branchId: row.branchId,
        metadata: { documentId: doc.id, typeCode: doc.typeCode },
      });
      return;
    }
    const now = new Date();
    // Company document types are single-document: supersede any earlier upload of the same type.
    const replaced = await tx
      .update(docs)
      .set({ replacedAt: now })
      .where(
        and(
          eq(docs.companyId, row.id),
          eq(docs.typeCode, doc.typeCode),
          ne(docs.id, doc.id),
          isNull(docs.replacedAt),
        ),
      )
      .returning({ id: docs.id });
    await tx
      .update(docs)
      .set({ status: 'UPLOADED', scanResult: scan, uploadedAt: now })
      .where(eq(docs.id, doc.id));
    // A replacement upload resets the verifier's per-document decision to PENDING.
    audit({
      action: 'company.document_upload',
      entityType: 'company',
      entityId: row.id,
      branchId: row.branchId,
      metadata: {
        documentId: doc.id,
        typeCode: doc.typeCode,
        sizeBytes: doc.sizeBytes,
        scan,
        replaced: replaced.map((r) => r.id),
      },
    });
  });
  if (scan === 'infected') {
    throw new ConflictError('This file failed a virus check and was not saved.');
  }
  return buildCompanyView(db, await requireOwnCompany(db, ctx.actor));
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

export interface DocumentLink {
  url: string;
  expiresAt: string;
}

const PRESENT_STATUSES = ['UPLOADED', 'REJECTED'] as const;

async function viewLink(doc: typeof docs.$inferSelect): Promise<DocumentLink> {
  if (!PRESENT_STATUSES.includes(doc.status as (typeof PRESENT_STATUSES)[number])) {
    throw new ConflictError('This upload was not completed');
  }
  return {
    url: await presignDownload(doc.storageKey, { expiresInSeconds: VIEW_LINK_SECONDS }),
    expiresAt: new Date(Date.now() + VIEW_LINK_SECONDS * 1000).toISOString(),
  };
}

/** Short-lived download link for the employer to view their own upload. */
export async function myCompanyDocumentLink(
  actor: Actor,
  documentId: string,
): Promise<DocumentLink> {
  assertPermission(actor, 'company:register');
  const row = await requireOwnCompany(db, actor);
  return viewLink(await ownDocument(db, row, documentId));
}

/** Staff (verifier / Branch Admin) viewing a company document — audited. */
export async function staffCompanyDocumentLink(
  ctx: SignedIn,
  companyId: string,
  documentId: string,
): Promise<DocumentLink> {
  const row = await loadCompany(db, companyId);
  assertBranchAccess(ctx.actor, row.branchId, { entityType: 'company', entityId: row.id });
  const doc = await ownDocument(db, row, documentId);
  const link = await viewLink(doc);
  await recordAudit(ctx, {
    action: 'company.document_view',
    entityType: 'company',
    entityId: row.id,
    branchId: row.branchId,
    metadata: { documentId: doc.id, typeCode: doc.typeCode },
  });
  return link;
}
