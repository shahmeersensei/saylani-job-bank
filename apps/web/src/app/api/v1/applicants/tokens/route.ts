import { z } from 'zod';
import { issueApplicantToken, lookupApplicantTokens } from '@/domains/applicant';
import { apiHandler, created, ok } from '@/domains/shared/http';
import { enforceRateLimit, enforceRateLimitByIp } from '@/domains/shared/rate-limit';
import {
  applicantTokenSchema,
  issueApplicantTokenSchema,
  tokenLookupQuerySchema,
} from '@jobbank/shared';

/**
 * GET /api/v1/applicants/tokens — staff token lookup (step 2): by token code,
 * by CNIC + branch (+ day, default today), or the whole branch-day list.
 * Branch-scoped; Super Admins may look up any branch.
 */
export const GET = apiHandler({
  permission: 'applicant:manage',
  query: tokenLookupQuerySchema,
  output: z.array(applicantTokenSchema),
  handler: async ({ ctx, actor, query }) =>
    ok(await lookupApplicantTokens({ ...ctx, actor: actor! }, query)),
});

/**
 * POST /api/v1/applicants/tokens — first counter issues a numbered token for
 * the day from a CNIC + name + phone (2026-11-07 token-only first step).
 * Fresh number per visit (2026-11-17): every issue is a new token (201) —
 * a previous live token for the same CNIC + branch is cancelled in the same
 * transaction, never handed back. Idempotent (N7/N22): the caller must send
 * an Idempotency-Key; a replay returns the stored response. Rate-limited per
 * staff account + branch and per IP (N22).
 */
export const POST = apiHandler({
  permission: 'applicant:manage',
  body: issueApplicantTokenSchema,
  output: applicantTokenSchema,
  idempotent: true,
  handler: async ({ ctx, actor, body }) => {
    await enforceRateLimitByIp(ctx.ip, 'token-issue-ip', { limit: 120, windowSeconds: 60 });
    await enforceRateLimit(`token-issue-user-branch`, `${actor!.userId}:${body.branchId}`, {
      limit: 60,
      windowSeconds: 60,
    });
    const { view, supersededTokenCodes } = await issueApplicantToken(
      { ...ctx, actor: actor! },
      body,
    );
    return created({ ...view, supersededTokenCodes });
  },
});
