import { downloadMyDocument } from '@/domains/applicant';
import { documentDownloadResponse } from '@/domains/shared/documents';
import { apiHandler } from '@/domains/shared/http';
import { z } from 'zod';

/** GET /api/v1/applicants/me/documents/{id}/download — stream own completed upload back out. */
export const GET = apiHandler({
  permission: 'applicant:self',
  onBehalf: true,
  params: z.object({ id: z.uuid() }),
  handler: async ({ actor, params }) =>
    documentDownloadResponse(await downloadMyDocument(actor!, params.id)),
});
