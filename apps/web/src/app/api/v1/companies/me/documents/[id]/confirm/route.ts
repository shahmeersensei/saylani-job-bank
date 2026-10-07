import { z } from 'zod';
import { confirmMyCompanyDocument } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

/** POST /api/v1/companies/me/documents/{id}/confirm — step 2: confirm upload. */
export const POST = apiHandler({
  permission: 'company:register',
  params: z.object({ id: z.uuid() }),
  handler: async ({ ctx, actor, params }) =>
    ok(await confirmMyCompanyDocument({ ...ctx, actor: actor! }, params.id)),
});
