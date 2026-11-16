import { describe, expect, it, vi } from 'vitest';
import { ConflictError, ValidationError } from '../errors';
import { readUploadBody, receiveDocumentUpload } from './upload';

vi.mock('@/lib/s3/storage', () => ({ putObject: vi.fn() }));

import { putObject } from '@/lib/s3/storage';

const mockedPut = vi.mocked(putObject);

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  typeCode: 'PHOTO',
  storageKey: 'branch/b1/applicant/a1/photo.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 4,
  status: 'PENDING_UPLOAD',
  scanResult: null,
  ...overrides,
});

const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i + 1));

describe('receiveDocumentUpload', () => {
  it('stores the bytes under the approved key', async () => {
    mockedPut.mockResolvedValue(undefined);
    await expect(
      receiveDocumentUpload({ doc: doc(), contentType: 'image/jpeg', body: bytes(4) }),
    ).resolves.toEqual({ documentId: 'd1', sizeBytes: 4 });
    expect(mockedPut).toHaveBeenCalledWith({
      key: 'branch/b1/applicant/a1/photo.jpg',
      contentType: 'image/jpeg',
      body: bytes(4),
    });
  });

  it('refuses a row that is no longer pending', async () => {
    await expect(
      receiveDocumentUpload({
        doc: doc({ status: 'UPLOADED' }),
        contentType: 'image/jpeg',
        body: bytes(4),
      }),
    ).rejects.toThrow(ConflictError);
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('refuses a type that differs from the approved upload', async () => {
    await expect(
      receiveDocumentUpload({ doc: doc(), contentType: 'image/png', body: bytes(4) }),
    ).rejects.toThrow(ValidationError);
    await expect(
      receiveDocumentUpload({ doc: doc(), contentType: 'image/png', body: bytes(4) }),
    ).rejects.toThrow(/type does not match/);
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('accepts a Content-Type with parameters (e.g. charset)', async () => {
    mockedPut.mockResolvedValue(undefined);
    await expect(
      receiveDocumentUpload({
        doc: doc(),
        contentType: 'image/jpeg; charset=binary',
        body: bytes(4),
      }),
    ).resolves.toEqual({ documentId: 'd1', sizeBytes: 4 });
  });

  it('refuses a size that differs from the approved upload', async () => {
    await expect(
      receiveDocumentUpload({ doc: doc(), contentType: 'image/jpeg', body: bytes(3) }),
    ).rejects.toThrow(ValidationError);
    await expect(
      receiveDocumentUpload({ doc: doc(), contentType: 'image/jpeg', body: bytes(3) }),
    ).rejects.toThrow(/size does not match/);
    expect(mockedPut).not.toHaveBeenCalled();
  });
});

describe('readUploadBody', () => {
  it('returns the exact bytes', async () => {
    const req = new Request('http://localhost/upload', { method: 'PUT', body: bytes(3) });
    await expect(readUploadBody(req, 10)).resolves.toEqual(bytes(3));
  });

  it('returns empty bytes when there is no body', async () => {
    const req = new Request('http://localhost/upload', { method: 'PUT' });
    await expect(readUploadBody(req, 10)).resolves.toEqual(new Uint8Array(0));
  });

  it('refuses a declared length over the cap without reading the body', async () => {
    const req = new Request('http://localhost/upload', {
      method: 'PUT',
      headers: { 'content-length': '11' },
      body: bytes(3),
    });
    await expect(readUploadBody(req, 10)).rejects.toThrow(/too large/);
  });

  it('refuses a chunked body that grows over the cap', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(6));
        controller.enqueue(bytes(6));
        controller.close();
      },
    });
    const init = { method: 'PUT', body: stream, duplex: 'half' } as unknown as RequestInit;
    const req = new Request('http://localhost/upload', init);
    await expect(readUploadBody(req, 10)).rejects.toThrow(/too large/);
  });
});
