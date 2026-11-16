import { describe, expect, it } from 'vitest';
import { buildObjectKey, getObjectStream, headObject, putObject } from './storage';

const bytes = new TextEncoder().encode('%PDF-1.7 integration test file');

describe('server-side storage against S3-compatible storage', () => {
  it('stores bytes, verifies what landed, and streams them back', async () => {
    const key = buildObjectKey({
      branchId: 'it-branch',
      entity: 'probe',
      entityId: 'p1',
      contentType: 'application/pdf',
    });

    await putObject({ key, contentType: 'application/pdf', body: bytes });

    expect(await headObject(key)).toEqual({
      sizeBytes: bytes.byteLength,
      contentType: 'application/pdf',
    });

    const download = await getObjectStream(key);
    expect(download).not.toBeNull();
    expect(download!.contentType).toBe('application/pdf');
    expect(download!.sizeBytes).toBe(bytes.byteLength);
    expect(new Uint8Array(await new Response(download!.body).arrayBuffer())).toEqual(bytes);
  });

  it('returns null for objects that do not exist', async () => {
    expect(await headObject('branch/none/probe/none/missing.pdf')).toBeNull();
    expect(await getObjectStream('branch/none/probe/none/missing.pdf')).toBeNull();
  });
});
