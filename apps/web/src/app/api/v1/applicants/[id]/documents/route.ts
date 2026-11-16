import { presignDocumentSchema } from '@jobbank/shared';
import { presignStaffApplicantPhoto } from '@/domains/applicant';
import { apiHandler, created } from '@/domains/shared/http';
import { z } from 'zod';

const params = z.object({ id: z.uuid() });

/**
 * POST /api/v1/applicants/{id}/documents — staff photo step 1: get the same-origin
 * upload route for the passport-size photo captured at registration. Only the PHOTO
 * document type is accepted here; the applicant's own upload path is untouched.
 * The applicant must already exist (the form uploads after creating them).
 */
export const POST = apiHandler({
  permission: 'applicant:create',
  params,
  body: presignDocumentSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    created(await presignStaffApplicantPhoto({ ...ctx, actor: actor! }, p.id, body)),
});
