import 'server-only';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { s3, S3_BUCKET } from './client';

/**
 * Default rules for user documents (CNIC scans, CVs, company papers, evidence).
 * Kept in step with the shared DOCUMENT_MIME_TYPES (packages/shared/src/master-data):
 * PDF, JPEG and PNG only. WebP was previously listed here but the shared allowlist
 * (enforced by zod at presign) forbids it, so it could never reach storage.
 */
export const DOCUMENT_UPLOAD_RULES = {
  maxSizeBytes: 10 * 1024 * 1024,
  contentTypes: ['application/pdf', 'image/jpeg', 'image/png'] as const,
};

const EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejectedError';
  }
}

export function assertUploadAllowed(
  contentType: string,
  sizeBytes: number,
  rules: { maxSizeBytes: number; contentTypes: readonly string[] } = DOCUMENT_UPLOAD_RULES,
): void {
  if (!rules.contentTypes.includes(contentType)) {
    throw new UploadRejectedError(`File type ${contentType} is not allowed`);
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0)
    throw new UploadRejectedError('File is empty');
  if (sizeBytes > rules.maxSizeBytes) {
    throw new UploadRejectedError(
      `File exceeds ${Math.round(rules.maxSizeBytes / 1024 / 1024)} MB`,
    );
  }
}

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Object keys never contain user-supplied file names (path traversal, PII in URLs).
 * Layout: branch/{branchId}/{entity}/{entityId}/{uuid}.{ext}
 */
export function buildObjectKey(input: {
  branchId: string;
  entity: string;
  entityId: string;
  contentType: string;
}): string {
  for (const [name, value] of Object.entries({
    branchId: input.branchId,
    entity: input.entity,
    entityId: input.entityId,
  })) {
    if (!SAFE_SEGMENT.test(value)) throw new Error(`Unsafe object key segment ${name}=${value}`);
  }
  const ext = EXTENSIONS[input.contentType] ?? '';
  return `branch/${input.branchId}/${input.entity}/${input.entityId}/${crypto.randomUUID()}${ext}`;
}

/**
 * Upload instruction returned with a PENDING_UPLOAD row. The browser PUTs the
 * file to the app's own same-origin upload route — never straight to storage.
 *
 * A presigned storage URL used to be returned here, but it baked the server's
 * internal storage address (e.g. http://seaweedfs:8333) into a browser-facing
 * URL: on the live HTTPS site the browser blocked it as mixed content, and the
 * hostname does not resolve outside the server's Docker network at all, so
 * every upload and download failed there. The server now stores the bytes
 * itself (see putObject); the URL below is the app route that does that.
 */
export interface PresignedUpload {
  key: string;
  url: string;
  method: 'PUT';
  /** Headers the client MUST send unchanged (they must match the approved upload). */
  headers: Record<string, string>;
  expiresAt: string;
}

/**
 * Store bytes under a key, from the server side only. Callers must have
 * checked the caller may upload this document and that the bytes match the
 * approved type and size (see receiveDocumentUpload) — the confirm step
 * re-verifies what landed before the document counts as present.
 */
export async function putObject(input: {
  key: string;
  contentType: string;
  body: Uint8Array;
}): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: input.key,
      ContentType: input.contentType,
      Body: input.body,
    }),
  );
}

export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  sizeBytes: number;
}

/** Stream a stored object back out, for the same-origin download routes. */
export async function getObjectStream(key: string): Promise<StoredObject | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    if (!res.Body) return null;
    return {
      body: res.Body.transformToWebStream(),
      contentType: res.ContentType ?? 'application/octet-stream',
      sizeBytes: res.ContentLength ?? 0,
    };
  } catch (error) {
    if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return null;
    throw error;
  }
}

/** What actually landed in storage — verify this after upload instead of trusting the client. */
export async function headObject(
  key: string,
): Promise<{ sizeBytes: number; contentType: string } | null> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return {
      sizeBytes: head.ContentLength ?? 0,
      contentType: head.ContentType ?? 'application/octet-stream',
    };
  } catch (error) {
    if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return null;
    throw error;
  }
}

/** Fetch the first bytes of a stored object (for magic-byte verification). */
export async function getObjectPrefix(key: string, length = 16): Promise<Uint8Array | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Range: `bytes=0-${length - 1}`,
      }),
    );
    if (!res.Body) return null;
    return await res.Body.transformToByteArray();
  } catch (error) {
    if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return null;
    throw error;
  }
}

/** Delete a stored object. Used to quarantine rejected uploads (infected / type-spoofed). */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

/**
 * Identify a file from its magic bytes — never trust a client-declared MIME type.
 * This is the authoritative server-side copy; the client-side helper in
 * lib/upload/validate-file.ts (sniffFileType) mirrors these signatures for early
 * feedback only and must never replace this check. WebP is recognised here so a
 * WebP file smuggled in as image/png is still caught, even though WebP is not an
 * allowed upload type.
 */
export function detectContentType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return 'application/pdf';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export type ScanResult = 'clean' | 'infected' | 'skipped';

/**
 * Malware scanning.
 *
 * 'skipped' means NOT YET SCANNED — it is not a pass. Callers must hold an
 * unscanned upload in PENDING_UPLOAD (never mark it UPLOADED, never hand out a
 * download link for it) until a scan result exists; 'infected' must be
 * quarantined/deleted and never served.
 *
 * No scanner service exists in this repo yet, so the default scanner returns
 * 'skipped'. To plug in a real scanner (e.g. a ClamAV sidecar with a small HTTP
 * API), set MALWARE_SCANNER_URL to its base URL (e.g. http://clamav:8080) and
 * expose POST {MALWARE_SCANNER_URL}/scan accepting JSON { "key": "<object key>" }
 * and returning JSON { "result": "clean" | "infected" }. The scanner should fetch
 * the object from storage itself (or accept a presigned GET URL) and must return
 * 'infected' only on a positive detection. Anything else — scanner unreachable,
 * timeout (30s), non-2xx, or a malformed/unexpected response — is treated as
 * 'skipped', never as 'clean': a scan failure must leave the file unscanned,
 * not silently approve it. Add MALWARE_SCANNER_URL to lib/env.ts and
 * .env.example when the service lands; until then the confirm flows hold every
 * upload in PENDING_UPLOAD and surface "not yet scanned, try again" — but only
 * in production (see scansEnforced): development/test let 'skipped' through so
 * the localhost demo flows keep working.
 */
export interface MalwareScanner {
  scan(key: string): Promise<ScanResult>;
}

/**
 * Whether an unscanned upload blocks confirm. Production ALWAYS blocks: no
 * document may complete without a scan result, so a production deploy without
 * a scanner service blocks every upload by design — the scanner is required
 * work before production, not optional hardening.
 *
 * Development and test allow 'skipped' through (the row is still recorded with
 * scanResult 'skipped' in the audit trail) because no scanner service exists
 * yet, the app is localhost-only, and the demo flows depend on uploads
 * completing. This must never be relaxed for production.
 */
export function scansEnforced(): boolean {
  return process.env.NODE_ENV === 'production';
}

export const malwareScanner: MalwareScanner = {
  async scan(key: string): Promise<ScanResult> {
    const base = process.env.MALWARE_SCANNER_URL?.replace(/\/$/, '');
    if (!base) return 'skipped';
    try {
      const res = await fetch(`${base}/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return 'skipped';
      const data: unknown = await res.json();
      if (typeof data === 'object' && data !== null && 'result' in data) {
        const result = (data as { result: unknown }).result;
        if (result === 'clean' || result === 'infected') return result;
      }
      return 'skipped';
    } catch {
      return 'skipped';
    }
  },
};
