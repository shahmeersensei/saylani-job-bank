import { z } from 'zod';
import { claimCompany } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

/** POST /api/v1/companies/{id}/claim — legacy Verifier-queue step; verification moved to the Branch Admin (2026-11-14), so this is no longer part of the flow. */
export const POST = apiHandler({
  permission: 'company:verify',
  idempotent: true,
  params: z.object({ id: z.uuid() }),
  handler: async ({ ctx, actor, params }) =>
    ok(await claimCompany({ ...ctx, actor: actor! }, params.id)),
});
