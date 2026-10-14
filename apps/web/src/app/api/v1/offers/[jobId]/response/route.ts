import { z } from 'zod';
import { respondToJobOffer, OFFER_RESPONSES } from '@/domains/matching';
import { apiHandler, ok } from '@/domains/shared/http';

/**
 * POST /api/v1/offers/[jobId]/response — applicant answers a HIRED decision
 * (accept, or decline with a REFUSAL_REASON). Guarded by `decision:applicant`.
 */
export const POST = apiHandler({
  params: z.object({ jobId: z.uuid() }),
  body: z
    .object({
      applicantResponse: z.enum(OFFER_RESPONSES),
      reasonCode: z
        .string()
        .trim()
        .regex(/^[A-Z0-9]+(_[A-Z0-9]+)*$/, 'Invalid reason code')
        .optional(),
      note: z
        .string()
        .trim()
        .min(5, 'Add a short note (at least 5 characters)')
        .max(500)
        .optional(),
    })
    .refine((v) => v.applicantResponse !== 'DECLINED' || v.reasonCode, {
      message: 'Choose a reason for declining',
      path: ['reasonCode'],
    }),
  handler: async ({ ctx, actor, params, body }) =>
    ok(
      await respondToJobOffer({ ...ctx, actor: actor! }, params.jobId, {
        applicantResponse: body.applicantResponse,
        reasonCode: body.reasonCode,
        note: body.note,
      }),
    ),
});
