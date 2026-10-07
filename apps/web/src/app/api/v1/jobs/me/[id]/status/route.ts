import { z } from 'zod';
import { jobStatusSchema } from '@jobbank/shared';
import { transitionJobStatus } from '@/domains/job';
import { apiHandler, ok } from '@/domains/shared/http';

/** PATCH /api/v1/jobs/me/[id]/status — publish / pause / resume / close a job. */
export const PATCH = apiHandler({
  permission: 'job:manage_own',
  params: z.object({ id: z.uuid() }),
  body: jobStatusSchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await transitionJobStatus({ ...ctx, actor: actor! }, params.id, body)),
});
