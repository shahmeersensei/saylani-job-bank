import { documentReviewSchema } from '@jobbank/shared';
import { reviewDocument } from '@/domains/company';
import { apiHandler, ok } from '@/domains/shared/http';
import { z } from 'zod';

/** PATCH /api/v1/companies/{id}/documents/{docId}/review — verifier accepts or rejects one doc. */
export const PATCH = apiHandler({
  permission: 'company:verify',
  idempotent: true,
  params: z.object({ id: z.uuid(), docId: z.uuid() }),
  body: documentReviewSchema,
  handler: async ({ ctx, actor, params, body }) =>
    ok(await reviewDocument({ ...ctx, actor: actor! }, params.id, params.docId, body)),
});
