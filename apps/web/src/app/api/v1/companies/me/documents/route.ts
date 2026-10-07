import { companyPresignSchema } from '@jobbank/shared';
import { presignMyCompanyDocument } from '@/domains/company';
import { companyDocumentTypes } from '@/domains/company/repository';
import { apiHandler, created, ok } from '@/domains/shared/http';

/** GET /api/v1/companies/me/documents — document types for companies. */
export const GET = apiHandler({
  permission: 'company:register',
  handler: async () => ok(await companyDocumentTypes()),
});

/** POST /api/v1/companies/me/documents — step 1: get a presigned PUT URL for upload. */
export const POST = apiHandler({
  permission: 'company:register',
  body: companyPresignSchema,
  handler: async ({ ctx, actor, body }) =>
    created(await presignMyCompanyDocument({ ...ctx, actor: actor! }, body)),
});
