import { releaseSchema } from '@jobbank/shared';
import { releaseCompany } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

/** POST /api/v1/companies/{id}/release — verifier returns the company to the queue. */
export const POST = apiHandler({
  permission: 'company:verify',
  params: z.object({ id: z.uuid() }),
  body: releaseSchema,
  handler: async ({ ctx, actor, params, body }) => {
    await releaseCompany({ ...ctx, actor: actor! }, params.id, body);
    return ok({ released: true });
  },
});
