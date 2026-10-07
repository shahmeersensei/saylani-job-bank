import { employerSignupCodeSchema } from '@jobbank/shared';
import { requestEmployerSignupCode } from '@/domains/auth';
import { accepted, apiHandler } from '@/domains/shared/http';

/** POST /api/v1/auth/signup/code — email a 6-digit confirmation code to a new employer. */
export const POST = apiHandler({
  auth: 'public',
  body: employerSignupCodeSchema,
  handler: async ({ ctx, body }) => {
    const timing = await requestEmployerSignupCode(ctx, body.email);
    return accepted({ message: 'Check your email for a 6-digit code.', ...timing });
  },
});
