import { z } from 'zod';
import { JOB_SORTABLE, jobFilters, listJobs, staffCreateJob } from '@/domains/job';
import { apiHandler, created, ok } from '@/domains/shared/http';
import { parseListQuery } from '@/domains/shared/pagination';
import { createJobSchema } from '@jobbank/shared';

/** GET /api/v1/jobs — branch-scoped job list (Branch Admin / Super Admin). */
export const GET = apiHandler({
  permission: 'job:read',
  handler: async ({ actor, request }) => {
    const query = parseListQuery(new URL(request.url).searchParams, {
      sortable: [...JOB_SORTABLE],
      defaultSort: { field: 'createdAt', direction: 'desc' },
      filters: jobFilters,
    });
    return ok(await listJobs(actor!, query));
  },
});

/** POST /api/v1/jobs — Branch Admin / Super Admin posts a job for a branch company. */
export const POST = apiHandler({
  permission: 'job:manage',
  body: createJobSchema.extend({ companyId: z.uuid() }),
  handler: async ({ ctx, actor, body }) => {
    const { companyId, ...input } = body;
    const job = await staffCreateJob({ ...ctx, actor: actor! }, companyId, input);
    return created(job);
  },
});
