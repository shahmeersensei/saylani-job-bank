import { updateCompanySchema } from '@jobbank/shared';
import { getMyCompany, updateMyCompany } from '@/domains/company';
import { NotFoundError } from '@/domains/shared/errors';
import { apiHandler, ok } from '@/domains/shared/http';

/** GET /api/v1/companies/me — own company view; 404 before registering. */
export const GET = apiHandler({
  permission: 'company:register',
  handler: async ({ actor }) => {
    const company = await getMyCompany(actor!);
    if (!company) throw new NotFoundError('Company profile');
    return ok(company);
  },
});

/** PATCH /api/v1/companies/me — update editable company details. */
export const PATCH = apiHandler({
  permission: 'company:register',
  body: updateCompanySchema,
  handler: async ({ ctx, actor, body }) =>
    ok(await updateMyCompany({ ...ctx, actor: actor! }, body)),
});
