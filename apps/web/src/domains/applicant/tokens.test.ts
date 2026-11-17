import {
  APPLICANT_TOKEN_TTL_MINUTES,
  cancelApplicantTokenSchema,
  issueApplicantTokenSchema,
  karachiDay,
  karachiDayEnd,
  MAX_TOKEN_NUMBER,
  parseTokenCode,
  tokenCodeFor,
  tokenExpiresAt,
  tokenLookupQuerySchema,
} from '@jobbank/shared';
import { describe, expect, it } from 'vitest';

describe('tokenCodeFor', () => {
  it('pads the daily number to three digits', () => {
    expect(tokenCodeFor('KHI-GULSHAN', 7)).toBe('KHI-GULSHAN-007');
    expect(tokenCodeFor('KHI-GULSHAN', 123)).toBe('KHI-GULSHAN-123');
  });

  it('lets four-digit numbers through unpadded (N6 cap is 9999)', () => {
    expect(tokenCodeFor('KHI-GULSHAN', 1000)).toBe('KHI-GULSHAN-1000');
    expect(tokenCodeFor('KHI-GULSHAN', MAX_TOKEN_NUMBER)).toBe('KHI-GULSHAN-9999');
  });
});

describe('parseTokenCode', () => {
  it('splits at the last dash, so branch codes with dashes work', () => {
    expect(parseTokenCode('KHI-GULSHAN-007')).toEqual({
      branchCode: 'KHI-GULSHAN',
      tokenNumber: 7,
    });
    expect(parseTokenCode('KHI-GULSHAN-1000')).toEqual({
      branchCode: 'KHI-GULSHAN',
      tokenNumber: 1000,
    });
  });

  it('rejects codes without a numeric suffix', () => {
    expect(parseTokenCode('KHI-GULSHAN')).toBeNull();
    expect(parseTokenCode('KHI-GULSHAN-ABC')).toBeNull();
    expect(parseTokenCode('-007')).toBeNull();
  });
});

describe('karachiDay', () => {
  it('uses the Pakistan calendar day, not UTC', () => {
    // 18:00 UTC is 23:00 in Karachi — still the 7th.
    expect(karachiDay(new Date('2026-11-07T18:00:00Z'))).toBe('2026-11-07');
    // 19:00 UTC is midnight in Karachi — already the 8th.
    expect(karachiDay(new Date('2026-11-07T19:00:00Z'))).toBe('2026-11-08');
  });
});

describe('tokenExpiresAt', () => {
  it('is exactly 24 hours (1440 minutes) after issue, across midnight', () => {
    expect(APPLICANT_TOKEN_TTL_MINUTES).toBe(1440);
    // 19:39 PKT on the 7th expires at 19:39 PKT on the 8th — not at midnight.
    expect(tokenExpiresAt(new Date('2026-11-07T14:39:20.000Z')).toISOString()).toBe(
      '2026-11-08T14:39:20.000Z',
    );
    const issuedAt = new Date('2026-11-07T19:30:00.000Z');
    expect(tokenExpiresAt(issuedAt).getTime() - issuedAt.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('karachiDayEnd', () => {
  it('is midnight at the start of the next Pakistan day (N3/N11 expiry)', () => {
    // 19:39 PKT on the 7th expires at midnight starting the 8th PKT.
    expect(karachiDayEnd(new Date('2026-11-07T14:39:20.000Z')).toISOString()).toBe(
      '2026-11-07T19:00:00.000Z',
    );
    // A token issued at 00:30 PKT on the 8th expires at the end of the 8th.
    expect(karachiDayEnd(new Date('2026-11-07T19:30:00.000Z')).toISOString()).toBe(
      '2026-11-08T19:00:00.000Z',
    );
  });
});

describe('tokenLookupQuerySchema', () => {
  const branchId = '123e4567-e89b-12d3-a456-426614174000';

  it('accepts a token code on its own', () => {
    expect(tokenLookupQuerySchema.safeParse({ tokenCode: 'KHI-GULSHAN-007' }).success).toBe(true);
  });

  it('accepts CNIC + branch (+ day)', () => {
    expect(
      tokenLookupQuerySchema.safeParse({
        cnic: '4210112345671',
        branchId,
        day: '2026-11-08',
      }).success,
    ).toBe(true);
  });

  it('accepts a bare branch-day list', () => {
    expect(tokenLookupQuerySchema.safeParse({ branchId, day: '2026-11-08' }).success).toBe(true);
  });

  it('rejects a CNIC without a branch, and an empty query', () => {
    expect(tokenLookupQuerySchema.safeParse({ cnic: '4210112345671' }).success).toBe(false);
    expect(tokenLookupQuerySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a malformed day', () => {
    expect(tokenLookupQuerySchema.safeParse({ branchId, day: '08/11/2026' }).success).toBe(false);
  });
});

describe('cancelApplicantTokenSchema', () => {
  it('accepts an empty body and an optional reason', () => {
    expect(cancelApplicantTokenSchema.safeParse({}).success).toBe(true);
    expect(
      cancelApplicantTokenSchema.safeParse({ reason: 'Applicant left the queue' }).success,
    ).toBe(true);
  });
});

describe('issueApplicantTokenSchema', () => {
  const branchId = '123e4567-e89b-12d3-a456-426614174000';

  it('accepts a CNIC with dashes, a name and a phone number', () => {
    const parsed = issueApplicantTokenSchema.safeParse({
      branchId,
      cnic: '42101-1234567-1',
      applicantName: 'Ahmed Raza',
      phone: '0300 1234567',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cnic).toBe('4210112345671');
      expect(parsed.data.phone).toBe('+923001234567');
    }
  });

  it('rejects a short CNIC and a short name', () => {
    expect(
      issueApplicantTokenSchema.safeParse({
        branchId,
        cnic: '42101',
        applicantName: 'Ahmed',
        phone: '03001234567',
      }).success,
    ).toBe(false);
    expect(
      issueApplicantTokenSchema.safeParse({
        branchId,
        cnic: '4210112345671',
        applicantName: 'Al',
        phone: '03001234567',
      }).success,
    ).toBe(false);
  });

  it('rejects a missing or invalid phone number', () => {
    expect(
      issueApplicantTokenSchema.safeParse({
        branchId,
        cnic: '4210112345671',
        applicantName: 'Ahmed Raza',
        phone: '',
      }).success,
    ).toBe(false);
    expect(
      issueApplicantTokenSchema.safeParse({
        branchId,
        cnic: '4210112345671',
        applicantName: 'Ahmed Raza',
        phone: '12345',
      }).success,
    ).toBe(false);
  });

  it('rejects a landline: a token must go to a mobile that can receive an SMS (M21)', () => {
    expect(
      issueApplicantTokenSchema.safeParse({
        branchId,
        cnic: '4210112345671',
        applicantName: 'Ahmed Raza',
        phone: '021 34567890',
      }).success,
    ).toBe(false);
  });
});
