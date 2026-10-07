import { transferCompanySchema } from '@jobbank/shared';
import { transferCompany } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

/** POST /api/v1/companies/{id}/transfer — Super Admin moves a company to another branch. */
export const POST = apiHandler({
  permission: 'company:manage',
  params: z.object({ id: z.uuid() }),
  body: transferCompanySchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await transferCompany({ ...ctx, actor: actor! }, params.id, body)),
});
