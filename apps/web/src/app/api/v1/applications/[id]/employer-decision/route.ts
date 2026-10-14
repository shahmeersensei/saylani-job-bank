import { z } from 'zod';
import { recordEmployerDecision, recordEmployerDecisionSchema } from '@/domains/placement';
import { apiHandler, created } from '@/domains/shared/http';

const params = z.object({ id: z.uuid() });

/** POST /api/v1/applications/{id}/employer-decision — employer records HOLD/ACCEPTED/REJECTED. */
export const POST = apiHandler({
  permission: 'decision:employer',
  params,
  body: recordEmployerDecisionSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    created(await recordEmployerDecision({ ...ctx, actor: actor! }, p.id, body)),
});
