import { z } from 'zod';
import { jobSkillsSchema } from '@jobbank/shared';
import { saveJobSkills } from '@/domains/job';
import { apiHandler, ok } from '@/domains/shared/http';

/** PUT /api/v1/jobs/me/[id]/skills — replace job skills list. */
export const PUT = apiHandler({
  permission: 'job:manage_own',
  params: z.object({ id: z.uuid() }),
  body: jobSkillsSchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await saveJobSkills({ ...ctx, actor: actor! }, params.id, body)),
});
