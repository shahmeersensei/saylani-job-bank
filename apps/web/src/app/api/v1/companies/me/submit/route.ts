import { submitMyCompany } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';

/** POST /api/v1/companies/me/submit — send a DRAFT or REJECTED company to the verifier queue. */
export const POST = apiHandler({
  permission: 'company:register',
  idempotent: true,
  handler: async ({ ctx, actor }) => ok(await submitMyCompany({ ...ctx, actor: actor! })),
});
