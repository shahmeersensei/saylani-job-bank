import { correctCompanySchema } from '@jobbank/shared';
import { companyViewSchema, correctCompanyDetails, getCompanyDetail } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

const params = z.object({ id: z.uuid() });

/** GET /api/v1/companies/{id} — staff/admin company detail. */
export const GET = apiHandler({
  permission: 'company:read',
  params,
  output: companyViewSchema,
  handler: async ({ actor, params: p }) => ok(await getCompanyDetail(actor!, p.id)),
});

/** PATCH /api/v1/companies/{id} — admins correct details; verifier may respond to an info request. */
export const PATCH = apiHandler({
  roles: ['SUPER_ADMIN', 'BRANCH_ADMIN', 'VERIFIER'],
  // L10: a retried correction must not double-apply. The panel sends a fresh
  // key per submit (see StaffCompanyPanel).
  idempotent: true,
  params,
  body: correctCompanySchema,
  output: companyViewSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    ok(await correctCompanyDetails({ ...ctx, actor: actor! }, p.id, body)),
});
