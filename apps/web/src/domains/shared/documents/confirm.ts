import 'server-only';
import type { MasterDataMeta } from '@jobbank/shared';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import { runCommand, type CommandScope, type RequestContext } from '../audit';
import { ConflictError, DomainError, ValidationError } from '../errors';
import { enforceRateLimit } from '../rate-limit';
import type { Actor } from '../scope';
import { type Transaction } from '@/lib/db';
import {
  assertUploadAllowed,
  buildObjectKey,
  deleteObject,
  detectContentType,
  getObjectPrefix,
  getObjectStream,
  headObject,
  malwareScanner,
  scansEnforced,
  UploadRejectedError,
  type PresignedUpload,
  type StoredObject,
} from '@/lib/s3/storage';

/**
 * Shared document upload pipeline (same-origin upload → confirm → view link), used by the
 * applicant and company document flows. The two flows were ~85% duplicated:
 * storage check, magic-byte verification, malware scan handling, supersede
 * and audit shapes are identical; only the table, the status values on
 * mismatch/infected, and the per-domain post-upload work differ.
 *
 * Deliberately NOT shared: loading the document row (`ownDocument` stays in
 * each domain). A generic-table select returns `unknown` fields, so loading
 * through this module would need a runtime cast; the typed per-domain loader
 * is 7 lines and keeps the row fully typed.
 */

/** A signed-in request context (same shape both document domains use). */
export type SignedIn = RequestContext & { actor: Actor };

const MB = 1024 * 1024;

/** Short-lived viewer link lifetime, in seconds. */
export const VIEW_LINK_SECONDS = 120;

/**
 * The columns of a document table this pipeline touches. Both document tables
 * (`applicant_documents`, `company_documents`) share these columns; only the
 * owner FK differs (`applicantId` / `companyId`). The table is kept as
 * `AnyPgTable` because drizzle cannot type a select/update over a generic
 * table parameter — the callers pass their concrete tables, and the values
 * written here are the same literals both flows wrote before.
 */
export interface DocumentTable {
  table: AnyPgTable;
  id: AnyPgColumn;
  /** Owner FK column; its `.name` is the insert key (`applicantId` / `companyId`). */
  owner: AnyPgColumn;
  typeCode: AnyPgColumn;
  replacedAt: AnyPgColumn;
}

/** A document row as this pipeline sees it (both tables share these columns). */
export interface ConfirmableDocument {
  id: string;
  typeCode: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  scanResult: string | null;
}

export interface PresignedDocument {
  documentId: string;
  upload: PresignedUpload;
}

export interface DocumentLink {
  url: string;
  expiresAt: string;
}

// ─── Step 1: presign ────────────────────────────────────────────────────

export interface PresignDocumentOptions {
  ctx: SignedIn;
  store: DocumentTable;
  row: { id: string; branchId: string | null };
  input: { typeCode: string; contentType: string; sizeBytes: number; fileName: string };
  /** Storage key namespace and rate-limit subject owner ('applicant' | 'company'). */
  entity: 'applicant' | 'company';
  /** Active document types (code + rules) for this entity. */
  types: readonly { code: string; meta: MasterDataMeta<'DOCUMENT_TYPE'> }[];
  rateLimitName: string;
  branchError: string;
  /**
   * Same-origin upload route for the created row. The browser PUTs the file
   * there (see receiveDocumentUpload); the URL must stay on the app's origin
   * — a storage URL would be blocked as mixed content on the live HTTPS site.
   */
  uploadUrl: (documentId: string) => string;
  /** Editability check that runs before the type lookup (company: review lock). */
  assertEditableBeforeType?: () => void;
  /** Editability check that runs after the type lookup (applicant: identity lock). */
  assertEditableAfterType?: (typeCode: string) => void;
}

/**
 * Step 1 of an upload: checks the file against the document type's rules and
 * returns the same-origin upload route for it. The file goes through the app,
 * never straight from the browser to storage. Audited: the row is created here,
 * so the presign itself is the audit entry (confirm records the upload separately).
 */
export async function presignDocumentUpload(
  options: PresignDocumentOptions,
): Promise<PresignedDocument> {
  const { ctx, store, row, input, entity, types } = options;
  if (!row.branchId) throw new ConflictError(options.branchError);
  options.assertEditableBeforeType?.();
  const type = types.find((t) => t.code === input.typeCode);
  if (!type) throw new ValidationError([{ path: 'typeCode', message: 'Choose a document type' }]);
  options.assertEditableAfterType?.(type.code);
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
    options.rateLimitName,
    row.id,
    { limit: 30, windowSeconds: 3600 },
    'Too many uploads. Please try again in an hour.',
  );
  const key = buildObjectKey({
    branchId: row.branchId,
    entity,
    entityId: row.id,
    contentType: input.contentType,
  });
  const documentId = await runCommand(ctx, async ({ tx, audit }) => {
    const [inserted] = await tx
      .insert(store.table)
      .values({
        [store.owner.name]: row.id,
        typeCode: type.code,
        storageKey: key,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      })
      .returning({ id: store.id });
    const id = inserted?.id;
    if (typeof id !== 'string') {
      throw new DomainError('INTERNAL', 500, 'Document upload could not be created');
    }
    // Presign creates the row, so it is audited here (L7): confirm records the
    // upload, but a presign never confirmed would otherwise leave no trace.
    audit({
      action: `${entity}.document_presign`,
      entityType: entity,
      entityId: row.id,
      branchId: row.branchId,
      metadata: {
        documentId: id,
        typeCode: type.code,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
      },
    });
    return id;
  });
  const upload: PresignedUpload = {
    key,
    url: options.uploadUrl(documentId),
    method: 'PUT',
    headers: { 'Content-Type': input.contentType },
    expiresAt: new Date(Date.now() + 300 * 1000).toISOString(),
  };
  return { documentId, upload };
}

// ─── Step 2: confirm ───────────────────────────────────────────────────

export interface ConfirmDocumentOptions<Owner> {
  ctx: SignedIn;
  store: DocumentTable;
  /** Row already loaded by the caller (still PENDING_UPLOAD). */
  doc: ConfirmableDocument;
  entityType: 'applicant' | 'company';
  entityId: string;
  branchId: string | null;
  ownerId: string;
  /** This type allows several current documents instead of superseding. */
  multiple: boolean;
  /** Row update on a magic-byte mismatch; a null status leaves it alone. */
  mismatch: { status: string | null; reviewNote: string | null };
  /** Status written when the scan reports infected. */
  infectedStatus: string;
  /** Reload the owner row (locked) at the start of the final transaction. */
  loadOwner?: (tx: Transaction) => Promise<Owner>;
  /** Extra work after the row is marked UPLOADED, before the upload audit entry. */
  onUploaded?: (cmd: CommandScope, owner: Owner | null) => Promise<void>;
  /** Extra work after the upload audit entry, still inside the transaction. */
  afterUpload?: (cmd: CommandScope) => Promise<void>;
}

/**
 * Step 2: the browser finished the PUT. Checks what actually landed in storage
 * (never trust the client), verifies the file's magic bytes match its declared
 * type, scans it, and makes it the current document of its type.
 *
 * Outcomes: a magic-byte mismatch deletes the object and applies the caller's
 * `mismatch` update (applicant: REJECTED; company: status untouched — the
 * company enum has no REJECTED value — the audit row is the record, and the
 * user re-uploads); an 'infected' scan applies `infectedStatus` and
 * quarantines the object; a 'skipped' scan leaves the row PENDING_UPLOAD with
 * scanResult 'skipped' — never servable, never counted as present — and the
 * user retries confirm later, but ONLY in production (see scansEnforced): in
 * development/test 'skipped' is recorded and the upload completes, because no
 * scanner service exists yet. Only a 'clean' scan, or a 'skipped' scan outside
 * production, marks the document UPLOADED.
 *
 * The caller must have checked `doc.status === 'PENDING_UPLOAD'` first and
 * rebuilds its view afterwards; an infected upload throws ConflictError.
 */
export async function confirmDocumentUpload<Owner>(
  options: ConfirmDocumentOptions<Owner>,
): Promise<void> {
  const { ctx, store, doc, entityType, entityId, branchId, ownerId } = options;
  const action = `${entityType}.document`;

  const stored = await headObject(doc.storageKey);
  if (!stored) throw new ConflictError('We did not receive the file. Please upload it again.');
  if (stored.sizeBytes !== doc.sizeBytes || stored.contentType !== doc.contentType) {
    throw new ConflictError('The uploaded file does not match. Please upload it again.');
  }
  // The PUT's Content-Type header is attacker-controlled, so the stored bytes
  // themselves are the only trustworthy type signal. Check them before scanning.
  const prefix = await getObjectPrefix(doc.storageKey);
  const actualType = prefix ? detectContentType(prefix) : null;
  if (actualType !== doc.contentType) {
    // Delete the spoofed object first: a mismatched row must not leave a live
    // file in storage. If the delete itself fails, leave the row PENDING_UPLOAD
    // (propagate the error) so the user can retry.
    await deleteObject(doc.storageKey);
    await runCommand(ctx, async ({ tx, audit }) => {
      await tx
        .update(store.table)
        .set({
          ...(options.mismatch.status ? { status: options.mismatch.status } : {}),
          scanResult: 'skipped',
          ...(options.mismatch.reviewNote ? { reviewNote: options.mismatch.reviewNote } : {}),
        })
        .where(eq(store.id, doc.id));
      audit({
        action: `${action}_type_mismatch`,
        entityType,
        entityId,
        branchId,
        metadata: {
          documentId: doc.id,
          typeCode: doc.typeCode,
          declared: doc.contentType,
          detected: actualType ?? 'unknown',
        },
      });
    });
    throw new ConflictError(
      'The file contents do not match its type. Please upload the correct file.',
    );
  }
  const scan = await malwareScanner.scan(doc.storageKey);
  if (scan === 'infected') {
    // Best-effort quarantine: remove the object. Serving is already blocked
    // (viewDocumentLink refuses scanResult 'infected'), so a failed delete is
    // not fatal.
    await deleteObject(doc.storageKey).catch(() => undefined);
  }
  if (scan === 'skipped' && scansEnforced()) {
    // No scanner result in production: hold the upload. The row stays
    // PENDING_UPLOAD so the user can retry confirm once a scanner exists or
    // recovers; it is not counted as a present document and cannot be viewed
    // or downloaded. Outside production scansEnforced() is false, so this
    // branch is skipped and the upload completes with scanResult 'skipped'
    // recorded (see scansEnforced in lib/s3/storage.ts).
    await runCommand(ctx, async ({ tx, audit }) => {
      await tx.update(store.table).set({ scanResult: 'skipped' }).where(eq(store.id, doc.id));
      audit({
        action: `${action}_scan_pending`,
        entityType,
        entityId,
        branchId,
        metadata: { documentId: doc.id, typeCode: doc.typeCode },
      });
    });
    throw new ConflictError(
      'This file has not been virus-scanned yet. Please try again in a few minutes.',
    );
  }

  await runCommand(ctx, async (cmd) => {
    const { tx, audit } = cmd;
    const owner = options.loadOwner ? await options.loadOwner(tx) : null;
    if (scan === 'infected') {
      await tx
        .update(store.table)
        .set({
          status: options.infectedStatus,
          scanResult: scan,
          reviewNote: 'The file failed a virus check',
        })
        .where(eq(store.id, doc.id));
      audit({
        action: `${action}_infected`,
        entityType,
        entityId,
        branchId,
        metadata: { documentId: doc.id, typeCode: doc.typeCode },
      });
      return;
    }
    const now = new Date();
    const replaced = options.multiple
      ? []
      : await tx
          .update(store.table)
          .set({ replacedAt: now })
          .where(
            and(
              eq(store.owner, ownerId),
              eq(store.typeCode, doc.typeCode),
              ne(store.id, doc.id),
              isNull(store.replacedAt),
            ),
          )
          .returning({ id: store.id });
    await tx
      .update(store.table)
      .set({ status: 'UPLOADED', scanResult: scan, uploadedAt: now })
      .where(eq(store.id, doc.id));
    if (options.onUploaded) await options.onUploaded(cmd, owner);
    audit({
      action: `${action}_upload`,
      entityType,
      entityId,
      branchId,
      metadata: {
        documentId: doc.id,
        typeCode: doc.typeCode,
        sizeBytes: doc.sizeBytes,
        scan,
        replaced: replaced.map((r) => r.id),
      },
    });
    if (options.afterUpload) await options.afterUpload(cmd);
  });
  if (scan === 'infected') {
    throw new ConflictError('This file failed a virus check and was not saved.');
  }
}

// ─── View link ─────────────────────────────────────────────────────────

/**
 * Short-lived link to view a completed upload. An infected file is never
 * served, even if its status would otherwise allow a link.
 *
 * The link is the app's own download route for the document — the file is
 * streamed through the app, never from storage directly (a presigned storage
 * URL was blocked as mixed content on the live HTTPS site, and the storage
 * hostname does not resolve outside the server). The route re-checks the
 * caller's permission on every GET, so the link needs no expiry of its own;
 * `expiresAt` is kept for the existing response shape.
 */
export async function viewDocumentLink(
  doc: ConfirmableDocument,
  presentStatuses: readonly string[],
  downloadUrl: string,
): Promise<DocumentLink> {
  if (doc.scanResult === 'infected') {
    throw new ConflictError('This upload failed a virus check');
  }
  if (!presentStatuses.includes(doc.status)) {
    throw new ConflictError('This upload was not completed');
  }
  return {
    url: downloadUrl,
    expiresAt: new Date(Date.now() + VIEW_LINK_SECONDS * 1000).toISOString(),
  };
}

/**
 * Stream a completed upload back out, through the app. Same guards as the
 * view link: an infected file is never served, and only a completed upload
 * can be downloaded. Callers must have checked the caller may view this
 * document (the same gates as the link) before calling this.
 */
export async function downloadDocument(
  doc: ConfirmableDocument,
  presentStatuses: readonly string[],
): Promise<StoredObject> {
  if (doc.scanResult === 'infected') {
    throw new ConflictError('This upload failed a virus check');
  }
  if (!presentStatuses.includes(doc.status)) {
    throw new ConflictError('This upload was not completed');
  }
  const stored = await getObjectStream(doc.storageKey);
  if (!stored) {
    throw new ConflictError('The file is no longer available. Please upload it again.');
  }
  return stored;
}

/**
 * Download response for a stored object: rendered inline (the in-app viewer),
 * with sniffing off. The stored bytes were verified against the declared type
 * at confirm, so the Content-Type below is trustworthy.
 */
export function documentDownloadResponse(file: StoredObject): Response {
  return new Response(file.body, {
    headers: {
      'content-type': file.contentType,
      'content-length': String(file.sizeBytes),
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=120',
    },
  });
}
