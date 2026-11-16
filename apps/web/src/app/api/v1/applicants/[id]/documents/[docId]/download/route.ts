import { downloadStaffApplicantDocument } from '@/domains/applicant';
import { documentDownloadResponse } from '@/domains/shared/documents';
import { apiHandler } from '@/domains/shared/http';
import { z } from 'zod';

/**
 * GET /api/v1/applicants/{id}/documents/{docId}/download — stream a completed
 * upload back out, through the app. Same gates as the view link; every view
 * is audited when the link is issued. The file renders inline in the viewer.
 */
export const GET = apiHandler({
  permission: 'applicant:read',
  params: z.object({ id: z.uuid(), docId: z.uuid() }),
  handler: async ({ ctx, actor, params }) =>
    documentDownloadResponse(
      await downloadStaffApplicantDocument({ ...ctx, actor: actor! }, params.id, params.docId),
    ),
});
