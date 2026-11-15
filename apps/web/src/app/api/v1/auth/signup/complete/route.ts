import { employerSignupSchema } from '@jobbank/shared';
import { signUpEmployer } from '@/domains/auth';
import { apiHandler } from '@/domains/shared/http';

/** POST /api/v1/auth/signup/complete — create an employer account and sign in. */
export const POST = apiHandler({
  auth: 'public',
  body: employerSignupSchema,
  handler: async ({ ctx, body, request }) => {
    // Forward the session cookies like the login route: `ok()` drops them,
    // so a signed-in signup never actually signed the employer in.
    // A new employer normally gets `two_factor_setup_required` (cookies: [])
    // instead — the form continues into authenticator enrolment with the token.
    const { cookies, ...result } = await signUpEmployer(ctx, body, request.headers);
    return { status: 200, data: result, cookies };
  },
});
