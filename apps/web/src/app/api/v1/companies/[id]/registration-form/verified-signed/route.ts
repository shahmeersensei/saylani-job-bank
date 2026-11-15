import { z } from 'zod';
import {
  markCompanyRegistrationVerifiedSigned,
  verifiedSignedCompanyResponseSchema,
} from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

const params = z.object({ id: z.uuid() });

/** POST /api/v1/companies/{id}/registration-form/verified-signed — record the paper review and send the company to Branch Admin review. */
export const POST = apiHandler({
  permission: 'company:onboard',
  params,
  output: verifiedSignedCompanyResponseSchema,
  handler: async ({ ctx, actor, params: p }) => {
    const company = await markCompanyRegistrationVerifiedSigned({ ...ctx, actor: actor! }, p.id);
    return ok({ verifiedSigned: true, status: company.status, company });
  },
});
