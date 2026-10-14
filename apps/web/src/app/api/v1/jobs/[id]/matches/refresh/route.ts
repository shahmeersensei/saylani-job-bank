import { z } from 'zod';
import { requestJobMatchesRefresh } from '@/domains/matching';
import { apiHandler, ok } from '@/domains/shared/http';

/**
 * POST /api/v1/jobs/{id}/matches/refresh — queue a shortlist rebuild (audited,
 * rate-limited by the existing API layer). The Python worker runs it.
 */
export const POST = apiHandler({
  params: z.object({ id: z.uuid() }),
  handler: async ({ ctx, actor, params }) =>
    ok(await requestJobMatchesRefresh({ ...ctx, actor: actor! }, params.id)),
});
