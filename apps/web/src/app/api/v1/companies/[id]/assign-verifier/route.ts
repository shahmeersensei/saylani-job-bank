import { assignVerifierSchema } from '@jobbank/shared';
import { assignVerifier } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

/** POST /api/v1/companies/{id}/assign-verifier — Super Admin assigns a verifier to an open round. */
export const POST = apiHandler({
  permission: 'company:manage',
  params: z.object({ id: z.uuid() }),
  body: assignVerifierSchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await assignVerifier({ ...ctx, actor: actor! }, params.id, body)),
});
