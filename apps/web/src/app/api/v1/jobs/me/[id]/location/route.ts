import { z } from 'zod';
import { jobLocationSchema } from '@jobbank/shared';
import { setJobLocation } from '@/domains/job';
import { apiHandler, ok } from '@/domains/shared/http';

/** PUT /api/v1/jobs/me/[id]/location — set the job's work location. */
export const PUT = apiHandler({
  permission: 'job:manage_own',
  params: z.object({ id: z.uuid() }),
  body: jobLocationSchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await setJobLocation({ ...ctx, actor: actor! }, params.id, body)),
});
