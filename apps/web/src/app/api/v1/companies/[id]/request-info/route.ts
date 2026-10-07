import { requestInfoSchema } from '@jobbank/shared';
import { requestInfo } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

/** POST /api/v1/companies/{id}/request-info — verifier asks the employer for more information. */
export const POST = apiHandler({
  permission: 'company:verify',
  params: z.object({ id: z.uuid() }),
  body: requestInfoSchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await requestInfo({ ...ctx, actor: actor! }, params.id, body)),
});
