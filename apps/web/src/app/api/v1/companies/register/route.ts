import { registerCompanySchema } from '@jobbank/shared';
import { registerCompany } from '@/domains/company';
import { apiHandler, created } from '@/domains/shared/http';

/** POST /api/v1/companies/register — first wizard step: create a DRAFT company. */
export const POST = apiHandler({
  permission: 'company:register',
  idempotent: true,
  body: registerCompanySchema,
  handler: async ({ ctx, actor, body }) =>
    created(await registerCompany({ ...ctx, actor: actor! }, body), '/api/v1/companies/me'),
});
