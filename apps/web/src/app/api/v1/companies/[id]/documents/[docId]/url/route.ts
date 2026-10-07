import { z } from 'zod';
import { staffCompanyDocumentLink } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

/** GET /api/v1/companies/{id}/documents/{docId}/url — audited presigned GET for staff. */
export const GET = apiHandler({
  permission: 'company:read',
  params: z.object({ id: z.uuid(), docId: z.uuid() }),
  handler: async ({ ctx, actor, params }) =>
    ok(await staffCompanyDocumentLink({ ...ctx, actor: actor! }, params.id, params.docId)),
});
