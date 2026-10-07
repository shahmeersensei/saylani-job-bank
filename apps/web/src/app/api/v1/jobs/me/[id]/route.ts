import { z } from 'zod';
import { updateJobSchema } from '@jobbank/shared';
import { deleteJob, getMyJob, updateJob } from '@/domains/job';
import { apiHandler, ok } from '@/domains/shared/http';

const idParam = z.object({ id: z.uuid() });

/** GET /api/v1/jobs/me/[id] — get employer's own job. */
export const GET = apiHandler({
  permission: 'job:manage_own',
  params: idParam,
  handler: async ({ actor, params }) => ok(await getMyJob(actor!, params.id)),
});

/** PATCH /api/v1/jobs/me/[id] — update draft job details. */
export const PATCH = apiHandler({
  permission: 'job:manage_own',
  params: idParam,
  body: updateJobSchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await updateJob({ ...ctx, actor: actor! }, params.id, body)),
});

/** DELETE /api/v1/jobs/me/[id] — delete a draft job. */
export const DELETE = apiHandler({
  permission: 'job:manage_own',
  params: idParam,
  handler: async ({ ctx, actor, params }) => {
    await deleteJob({ ...ctx, actor: actor! }, params.id);
    return ok({ deleted: true });
  },
});
