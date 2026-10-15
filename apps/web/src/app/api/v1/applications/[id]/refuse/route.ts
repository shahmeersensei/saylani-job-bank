import { z } from 'zod';
import { refuseJobOffer, refuseJobOfferSchema } from '@/domains/placement';
import { apiHandler, ok } from '@/domains/shared/http';

const params = z.object({ id: z.uuid() });

/** POST /api/v1/applications/{id}/refuse — applicant refuses a job offer. */
export const POST = apiHandler({
  params,
  body: refuseJobOfferSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    ok(await refuseJobOffer({ ...ctx, actor: actor! }, p.id, body)),
});
