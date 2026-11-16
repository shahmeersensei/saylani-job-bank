import { downloadMyCompanyDocument } from '@/domains/company';
import { documentDownloadResponse } from '@/domains/shared/documents';
import { apiHandler } from '@/domains/shared/http';
import { z } from 'zod';

/** GET /api/v1/companies/me/documents/{id}/download — stream own completed upload back out. */
export const GET = apiHandler({
  permission: 'company:register',
  params: z.object({ id: z.uuid() }),
  handler: async ({ actor, params }) =>
    documentDownloadResponse(await downloadMyCompanyDocument(actor!, params.id)),
});
