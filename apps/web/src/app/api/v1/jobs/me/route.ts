import { createJobSchema } from '@jobbank/shared';
import { createJob, listMyJobs } from '@/domains/job';
import { apiHandler, ok } from '@/domains/shared/http';

/** GET /api/v1/jobs/me — employer's own job list. */
export const GET = apiHandler({
  permission: 'job:manage_own',
  handler: async ({ actor }) => ok(await listMyJobs(actor!)),
});

/** POST /api/v1/jobs/me — create a new draft job. */
export const POST = apiHandler({
  permission: 'job:manage_own',
  body: createJobSchema,
  handler: async ({ ctx, actor, body }) => ok(await createJob({ ...ctx, actor: actor! }, body)),
});
