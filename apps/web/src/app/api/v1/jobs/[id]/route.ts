import { z } from 'zod';
import { getJobDetail } from '@/domains/job';
import { apiHandler, ok } from '@/domains/shared/http';

/** GET /api/v1/jobs/[id] — job detail for staff. */
export const GET = apiHandler({
  permission: 'job:read',
  params: z.object({ id: z.uuid() }),
  handler: async ({ actor, params }) => ok(await getJobDetail(actor!, params.id)),
});
