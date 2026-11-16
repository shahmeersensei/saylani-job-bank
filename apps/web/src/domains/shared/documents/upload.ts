import 'server-only';
import { ConflictError, ValidationError } from '../errors';
import { putObject } from '@/lib/s3/storage';
import type { ConfirmableDocument } from './confirm';

/**
 * Step 1½ of an upload: the browser PUTs the file to the app's same-origin
 * upload route, and the server stores it. The browser never talks to storage
 * directly (a presigned storage URL baked the server-internal storage address
 * into a browser-facing URL, which the live HTTPS site blocked as mixed
 * content — and the hostname does not resolve outside the server at all).
 *
 * The confirm step still re-verifies what landed (size, magic bytes, scan)
 * before the document counts as present; this step only locks the bytes to
 * the row the presign step approved.
 */

const fileIssue = (message: string) => new ValidationError([{ path: 'file', message }]);

/**
 * Read a request body with a hard cap, so a body far larger than the approved
 * upload is refused without buffering it all. The declared Content-Length is
 * checked first (cheap); the stream cap is the backstop for a lying header
 * or a chunked body with no declared length.
 */
export async function readUploadBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw fileIssue('File is too large');
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw fileIssue('File is too large');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export interface ReceivedUpload {
  documentId: string;
  sizeBytes: number;
}

/**
 * Store the bytes for a PENDING_UPLOAD row. The type and size must match the
 * approved upload exactly — a different file than the one presign approved is
 * refused here, before anything is written.
 */
export async function receiveDocumentUpload(input: {
  doc: ConfirmableDocument;
  /** Raw Content-Type header; parameters (e.g. charset) are ignored. */
  contentType: string | null;
  body: Uint8Array;
}): Promise<ReceivedUpload> {
  const { doc, body } = input;
  if (doc.status !== 'PENDING_UPLOAD') {
    throw new ConflictError(
      'This upload was already completed or replaced. Start a new upload to replace the file.',
    );
  }
  const sentType = input.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!sentType || sentType !== doc.contentType) {
    throw fileIssue('The uploaded file type does not match the approved upload.');
  }
  if (body.byteLength !== doc.sizeBytes) {
    throw fileIssue('The uploaded file size does not match the approved upload.');
  }
  await putObject({ key: doc.storageKey, contentType: doc.contentType, body });
  return { documentId: doc.id, sizeBytes: doc.sizeBytes };
}
