import { resubmitSchema } from '@jobbank/shared';
import { resubmitMyCompany } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

/** POST /api/v1/companies/me/resubmit — send back after an info request. */
export const POST = apiHandler({
  permission: 'company:register',
  body: resubmitSchema,
  handler: async ({ ctx, actor, body }) =>
    ok(await resubmitMyCompany({ ...ctx, actor: actor! }, body)),
});
