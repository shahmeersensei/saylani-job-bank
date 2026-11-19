import { onboardedCompanyHeadOfficeSchema } from '@jobbank/shared';
import { setOnboardedCompanyHeadOffice } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

/** POST /api/v1/companies/{id}/head-office — onboarder or info-requested verifier sets a field-visit company's head office. */
export const POST = apiHandler({
  roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'VERIFIER'],
  params: z.object({ id: z.uuid() }),
  body: onboardedCompanyHeadOfficeSchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await setOnboardedCompanyHeadOffice({ ...ctx, actor: actor! }, params.id, body)),
});
