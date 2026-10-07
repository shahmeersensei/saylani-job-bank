import { z } from 'zod';
import { jobRequirementsSchema } from '@jobbank/shared';
import { saveJobRequirements } from '@/domains/job';
import { apiHandler, ok } from '@/domains/shared/http';

/** PUT /api/v1/jobs/me/[id]/requirements — save job requirements. */
export const PUT = apiHandler({
  permission: 'job:manage_own',
  params: z.object({ id: z.uuid() }),
  body: jobRequirementsSchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await saveJobRequirements({ ...ctx, actor: actor! }, params.id, body)),
});
