import { z } from 'zod';
import { setJobMatchReviewStatus, MATCH_REVIEW_STATUSES } from '@/domains/matching';
import { apiHandler, ok } from '@/domains/shared/http';

const decisionBody = z
  .object({
    reviewStatus: z.enum(MATCH_REVIEW_STATUSES),
    /** Master-data REJECTION_REASON code — required when reviewStatus = REJECTED. */
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]+(_[A-Z0-9]+)*$/, 'Invalid reason code')
      .optional(),
    note: z.string().trim().min(5, 'Add a short note (at least 5 characters)').max(500).optional(),
  })
  .refine((v) => v.reviewStatus !== 'REJECTED' || v.reasonCode, {
    message: 'Choose a rejection reason',
    path: ['reasonCode'],
  });

/**
 * PATCH /api/v1/jobs/[id]/matches/[applicantId] — review decision on one match.
 * Permission (`match_case:manage` or the owning employer's `decision:employer`)
 * is asserted inside the service.
 */
export const PATCH = apiHandler({
  params: z.object({ id: z.uuid(), applicantId: z.uuid() }),
  body: decisionBody,
  handler: async ({ ctx, actor, params, body }) =>
    ok(
      await setJobMatchReviewStatus({ ...ctx, actor: actor! }, params.id, params.applicantId, {
        reviewStatus: body.reviewStatus,
        reasonCode: body.reasonCode,
        note: body.note,
      }),
    ),
});
