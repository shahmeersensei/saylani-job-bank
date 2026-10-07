import { z } from 'zod';
import { myCompanyDocumentLink } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

/** GET /api/v1/companies/me/documents/{id}/url — presigned GET link for own document. */
export const GET = apiHandler({
  permission: 'company:register',
  params: z.object({ id: z.uuid() }),
  handler: async ({ actor, params }) => ok(await myCompanyDocumentLink(actor!, params.id)),
});
