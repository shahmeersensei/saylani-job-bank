import { verifyCompanySchema } from '@jobbank/shared';
import { verifyCompany } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

/** POST /api/v1/companies/{id}/verify — verifier approves the company. */
export const POST = apiHandler({
  permission: 'company:verify',
  idempotent: true,
  params: z.object({ id: z.uuid() }),
  body: verifyCompanySchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await verifyCompany({ ...ctx, actor: actor! }, params.id, body)),
});
