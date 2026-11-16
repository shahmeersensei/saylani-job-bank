import { uploadStaffApplicantPhoto } from '@/domains/applicant';
import { readUploadBody } from '@/domains/shared/documents';
import { apiHandler, ok } from '@/domains/shared/http';
import { DOCUMENT_UPLOAD_RULES } from '@/lib/s3/storage';
import { z } from 'zod';

const params = z.object({ id: z.uuid(), docId: z.uuid() });

/**
 * PUT /api/v1/applicants/{id}/documents/{docId}/upload — staff photo step 1½:
 * store the bytes for a presigned PHOTO upload. The raw file is the request
 * body (Content-Type must match the approved upload); the route reads it
 * capped at the document size limit, then the confirm step verifies it.
 * Same-origin by design: the browser never talks to storage directly.
 */
export const PUT = apiHandler({
  permission: 'applicant:create',
  params,
  handler: async ({ request, ctx, actor, params: p }) =>
    ok(
      await uploadStaffApplicantPhoto(
        { ...ctx, actor: actor! },
        p.id,
        p.docId,
        request.headers.get('content-type'),
        await readUploadBody(request, DOCUMENT_UPLOAD_RULES.maxSizeBytes),
      ),
    ),
});
