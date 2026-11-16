import { downloadStaffCompanyDocument } from '@/domains/company';
import { documentDownloadResponse } from '@/domains/shared/documents';
import { apiHandler } from '@/domains/shared/http';
import { z } from 'zod';

/** GET /api/v1/companies/{id}/documents/{docId}/download — stream a completed upload back out, through the app. */
export const GET = apiHandler({
  permission: 'company:read',
  params: z.object({ id: z.uuid(), docId: z.uuid() }),
  handler: async ({ ctx, actor, params }) =>
    documentDownloadResponse(
      await downloadStaffCompanyDocument({ ...ctx, actor: actor! }, params.id, params.docId),
    ),
});
