import { z } from 'zod';
import { referApplicantToEmployer, referApplicantSchema } from '@/domains/placement';
import { apiHandler, ok } from '@/domains/shared/http';

const params = z.object({ id: z.uuid() });

/** POST /api/v1/applications/{id}/refer — staff/branch-admin refers applicant to employer. */
export const POST = apiHandler({
  permission: 'match_case:refer',
  params,
  body: referApplicantSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    ok(await referApplicantToEmployer({ ...ctx, actor: actor! }, p.id, body)),
});
