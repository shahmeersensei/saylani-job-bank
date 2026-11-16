import { presignDocumentSchema } from '@jobbank/shared';
import { listApplicantDocumentTypes, presignMyDocument } from '@/domains/applicant';
import { apiHandler, created, ok } from '@/domains/shared/http';

/** GET /api/v1/applicants/me/documents — document types with their upload rules. */
export const GET = apiHandler({
  permission: 'applicant:self',
  onBehalf: true,
  handler: async () => ok(await listApplicantDocumentTypes()),
});

/**
 * POST /api/v1/applicants/me/documents — step 1 of an upload: returns the same-origin
 * upload route for the browser. Confirm with POST …/documents/{id}/confirm once the PUT succeeded.
 */
export const POST = apiHandler({
  permission: 'applicant:self',
  onBehalf: true,
  body: presignDocumentSchema,
  handler: async ({ ctx, actor, body }) =>
    created(await presignMyDocument({ ...ctx, actor: actor! }, body)),
});
