import { describe, expect, it } from '@jest/globals';
import { schema } from '@jobbank/db';
import { HEADERS } from '@jobbank/shared';
import { POST as register } from '@/app/api/v1/applicants/register/route';
import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  Jar,
  SEEDED_APPLICANT_PHONE,
  bodyOf,
  call,
  clearRateLimits,
  errorOf,
  latestOtpCode,
  otpRequestRoute,
  otpVerifyRoute,
} from './helpers';

const PHONE = SEEDED_APPLICANT_PHONE;
const E164 = '+923001234567';

/** The seeded phone account must start without a profile so registration can succeed. */
async function resetApplicantProfile(): Promise<void> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.phoneNumber, E164));
  if (user) await db.delete(schema.applicants).where(eq(schema.applicants.userId, user.id));
}

function registrationBody() {
  return {
    fullName: 'Jest Applicant',
    fatherName: 'Jest Father',
    cnic: `35202${Date.now().toString().slice(-8)}`,
    dateOfBirth: '1995-04-12',
    gender: 'MALE' as const,
  };
}

describe('applicant OTP sign-in + idempotent registration', () => {
  let jar: Jar;
  let replayKey: string;

  beforeAll(async () => {
    await resetApplicantProfile();
  });

  afterAll(async () => {
    await resetApplicantProfile();
  });

  it('signs the applicant in with the SMS code (rejecting a wrong code first)', async () => {
    // The limiter keys on the normalized E.164 number, so clear that form.
    await clearRateLimits(['otp-resend', E164], ['otp-phone', E164]);
    const request = await call(otpRequestRoute, '/api/v1/auth/otp/request', {
      body: { phone: PHONE },
    });
    expect(request.status).toBe(202);

    const code = latestOtpCode(PHONE);
    const wrongCode = (code[0] === '0' ? '1' : '0') + code.slice(1);
    const bad = await call(otpVerifyRoute, '/api/v1/auth/otp/verify', {
      body: { phone: PHONE, code: wrongCode },
    });
    expect(bad.status).toBe(401);
    expect((await errorOf(bad)).code).toBe('UNAUTHENTICATED');

    const good = await call(otpVerifyRoute, '/api/v1/auth/otp/verify', {
      body: { phone: PHONE, code },
    });
    expect(good.status).toBe(200);
    const { data } = await bodyOf<{
      data: { kind: string; roles: string[]; homePath: string };
    }>(good);
    expect(data.kind).toBe('signed_in');
    expect(data.roles).toContain('APPLICANT');
    jar = new Jar().absorb(good);
  }, 60_000);

  it('refuses the registration without an Idempotency-Key', async () => {
    const response = await call(register, '/api/v1/applicants/register', {
      method: 'POST',
      body: registrationBody(),
      jar,
    });
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('refuses a malformed Idempotency-Key', async () => {
    const response = await call(register, '/api/v1/applicants/register', {
      method: 'POST',
      body: registrationBody(),
      headers: { [HEADERS.idempotencyKey]: 'short' },
      jar,
    });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('creates the profile once and replays the stored response for duplicates', async () => {
    replayKey = `jest-idem-${Date.now()}-1`;
    const body = registrationBody();

    const first = await call(register, '/api/v1/applicants/register', {
      method: 'POST',
      body,
      headers: { [HEADERS.idempotencyKey]: replayKey },
      jar,
    });
    expect(first.status).toBe(201);
    expect(first.headers.get('location')).toBe('/api/v1/applicants/me');
    const firstBody = await bodyOf<{
      data: { id?: string; personal: { fullName: string; cnic: string } };
    }>(first);
    expect(firstBody.data.id).toBeTruthy();
    expect(firstBody.data.personal.fullName).toBe(body.fullName);
    expect(firstBody.data.personal.cnic).toBe(body.cnic);

    const replay = await call(register, '/api/v1/applicants/register', {
      method: 'POST',
      body,
      headers: { [HEADERS.idempotencyKey]: replayKey },
      jar,
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get(HEADERS.idempotentReplay)).toBe('true');
    expect(await bodyOf(replay)).toEqual(firstBody);
  }, 60_000);

  it('answers 422 when the key is reused with a different body', async () => {
    const response = await call(register, '/api/v1/applicants/register', {
      method: 'POST',
      body: { ...registrationBody(), fullName: 'Different Person' },
      headers: { [HEADERS.idempotencyKey]: replayKey },
      jar,
    });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});
