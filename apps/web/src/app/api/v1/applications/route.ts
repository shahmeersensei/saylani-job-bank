import { shortlistApplicant, shortlistSchema } from '@/domains/placement';
import { apiHandler, created } from '@/domains/shared/http';

/** POST /api/v1/applications — staff/branch-admin shortlist an applicant for an open job. */
export const POST = apiHandler({
  permission: 'match_case:manage',
  body: shortlistSchema,
  handler: async ({ ctx, actor, body }) =>
    created(await shortlistApplicant({ ...ctx, actor: actor! }, body)),
});
