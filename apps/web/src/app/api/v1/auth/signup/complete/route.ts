import { employerSignupSchema } from '@jobbank/shared';
import { signUpEmployer } from '@/domains/auth';
import { apiHandler, ok } from '@/domains/shared/http';

/** POST /api/v1/auth/signup/complete — create an employer account and sign in. */
export const POST = apiHandler({
  auth: 'public',
  body: employerSignupSchema,
  handler: async ({ ctx, body, request }) => ok(await signUpEmployer(ctx, body, request.headers)),
});
