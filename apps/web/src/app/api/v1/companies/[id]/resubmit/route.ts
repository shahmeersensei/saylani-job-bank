import { resubmitSchema } from '@jobbank/shared';
import { resubmitOnboardedCompany } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

/** POST /api/v1/companies/{id}/resubmit — verifier returns requested information to Branch Admin review. */
export const POST = apiHandler({
  roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'VERIFIER'],
  params: z.object({ id: z.uuid() }),
  body: resubmitSchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await resubmitOnboardedCompany({ ...ctx, actor: actor! }, params.id, body)),
});
