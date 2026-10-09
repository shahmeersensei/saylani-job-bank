import { rejectCompanySchema } from '@jobbank/shared';
import { rejectCompany } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

/** POST /api/v1/companies/{id}/reject — verifier rejects the company registration. */
export const POST = apiHandler({
  permission: 'company:verify',
  idempotent: true,
  params: z.object({ id: z.uuid() }),
  body: rejectCompanySchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await rejectCompany({ ...ctx, actor: actor! }, params.id, body)),
});
