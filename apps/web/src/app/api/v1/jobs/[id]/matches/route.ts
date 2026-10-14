import { z } from 'zod';
import { getJobMatches } from '@/domains/matching';
import { apiHandler, ok, type HandlerResult } from '@/domains/shared/http';

/**
 * GET /api/v1/jobs/{id}/matches — ranked shortlist for one job.
 * Employer: only their own company's job. Staff: their branch. No PII fields.
 */
export const GET = apiHandler({
  permission: 'match_case:read',
  params: z.object({ id: z.uuid() }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  }),
  handler: async ({ actor, params, query }): Promise<HandlerResult> =>
    ok(await getJobMatches(actor!, params.id, query)),
});
