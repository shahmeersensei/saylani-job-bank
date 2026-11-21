import { z } from 'zod';
import { recordInterviewOutcome, recordInterviewOutcomeSchema } from '@/domains/placement';
import { apiHandler, created } from '@/domains/shared/http';

const params = z.object({ id: z.uuid() });

/**
 * POST /api/v1/applications/{id}/interview/outcome — 0052.
 * Interviewer / Staff / Branch Admin records the outcome of a scheduled
 * Job Bank interview (attendance + pass/fail + feedback). The domain
 * function enforces the state machine (scheduled/postponed only) and the
 * `interview:record_outcome` permission; a PASSED outcome is what unlocks
 * the interviewer-only referral to the employer.
 */
export const POST = apiHandler({
  permission: 'interview:record_outcome',
  params,
  body: recordInterviewOutcomeSchema,
  handler: async ({ ctx, actor, params: p, body }) =>
    created(await recordInterviewOutcome({ ...ctx, actor: actor! }, p.id, body)),
});
