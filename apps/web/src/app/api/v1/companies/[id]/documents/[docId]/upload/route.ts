import { uploadStaffCompanyDocument } from '@/domains/company';
import { readUploadBody } from '@/domains/shared/documents';
import { apiHandler, ok } from '@/domains/shared/http';
import { DOCUMENT_UPLOAD_RULES } from '@/lib/s3/storage';
import { z } from 'zod';

const params = z.object({ id: z.uuid(), docId: z.uuid() });

/** PUT /api/v1/companies/{id}/documents/{docId}/upload — onboard step 1½: store the bytes for a presigned upload. */
export const PUT = apiHandler({
  permission: 'company:onboard',
  params,
  handler: async ({ request, ctx, actor, params: p }) =>
    ok(
      await uploadStaffCompanyDocument(
        { ...ctx, actor: actor! },
        p.id,
        p.docId,
        request.headers.get('content-type'),
        await readUploadBody(request, DOCUMENT_UPLOAD_RULES.maxSizeBytes),
      ),
    ),
});
