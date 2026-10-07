import { companyStatusSchema } from '@jobbank/shared';
import { reinstateCompany, suspendCompany } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

/** PATCH /api/v1/companies/{id}/status — Branch Admin suspends or reinstates a company. */
export const PATCH = apiHandler({
  permission: 'company:suspend',
  params: z.object({ id: z.uuid() }),
  body: companyStatusSchema,
  handler: async ({ ctx, actor, params, body }) => {
    const fn = body.status === 'SUSPENDED' ? suspendCompany : reinstateCompany;
    return ok(await fn({ ...ctx, actor: actor! }, params.id, { reason: body.reason }));
  },
});
