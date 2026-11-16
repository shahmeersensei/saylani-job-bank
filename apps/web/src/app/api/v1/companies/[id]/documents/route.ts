import { companyPresignSchema } from '@jobbank/shared';
import { presignStaffCompanyDocument } from '@/domains/company';
import { apiHandler, created } from '@/domains/shared/http';
import { z } from 'zod';

const params = z.object({ id: z.uuid() });

/**
 * POST /api/v1/companies/{id}/documents — onboard step 1: get the same-origin upload route.
 * Onboarded DRAFT companies only (permission company:onboard); the employer
 * path (/companies/me/documents) is untouched. The VERIFY guard is unchanged —
 * this only lets the onboarder supply the documents the guard requires.
 */
export const POST = apiHandler({
  permission: 'company:onboard',
  params,
  body: companyPresignSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    created(await presignStaffCompanyDocument({ ...ctx, actor: actor! }, p.id, body)),
});
