import { z } from 'zod';
import { removeMyCompanyDocument } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

/** DELETE /api/v1/companies/me/documents/{id} — remove an uploaded document. */
export const DELETE = apiHandler({
  permission: 'company:register',
  params: z.object({ id: z.uuid() }),
  handler: async ({ ctx, actor, params }) =>
    ok(await removeMyCompanyDocument({ ...ctx, actor: actor! }, params.id)),
});
