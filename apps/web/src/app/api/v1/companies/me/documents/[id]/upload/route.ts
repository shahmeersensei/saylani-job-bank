import { uploadMyCompanyDocument } from '@/domains/company';
import { readUploadBody } from '@/domains/shared/documents';
import { apiHandler, ok } from '@/domains/shared/http';
import { DOCUMENT_UPLOAD_RULES } from '@/lib/s3/storage';
import { z } from 'zod';

/** PUT /api/v1/companies/me/documents/{id}/upload — step 1½: store the bytes for a presigned upload. */
export const PUT = apiHandler({
  permission: 'company:register',
  params: z.object({ id: z.uuid() }),
  handler: async ({ request, ctx, actor, params }) =>
    ok(
      await uploadMyCompanyDocument(
        { ...ctx, actor: actor! },
        params.id,
        request.headers.get('content-type'),
        await readUploadBody(request, DOCUMENT_UPLOAD_RULES.maxSizeBytes),
      ),
    ),
});
