import { companySiteSchema } from '@jobbank/shared';
import { addMySite } from '@/domains/company';
import { apiHandler, created } from '@/domains/shared/http';

/** POST /api/v1/companies/me/sites — add a new work site. */
export const POST = apiHandler({
  permission: 'company:register',
  body: companySiteSchema,
  handler: async ({ ctx, actor, body }) =>
    created(await addMySite({ ...ctx, actor: actor! }, body), '/api/v1/companies/me'),
});
