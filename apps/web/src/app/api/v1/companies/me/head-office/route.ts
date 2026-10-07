import { companyHeadOfficeSchema } from '@jobbank/shared';
import { setMyHeadOffice } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

/** PUT /api/v1/companies/me/head-office — set or update the head office pin and branch. */
export const PUT = apiHandler({
  permission: 'company:register',
  body: companyHeadOfficeSchema,
  handler: async ({ ctx, actor, body }) =>
    ok(await setMyHeadOffice({ ...ctx, actor: actor! }, body)),
});
