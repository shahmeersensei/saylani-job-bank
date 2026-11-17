import { z } from 'zod';

/** Strip a leading 0092 / 92 / 0 so only the national digits remain. */
const nationalDigits = (value: string): string => {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0092')) digits = digits.slice(4);
  else if (digits.startsWith('92') && digits.length >= 11) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
};

const toE164 = (national: string) => `+92${national}`;

/**
 * Original Pakistani mobile allocations; MNP means these do not identify
 * the current operator. This list is the single source of truth for which
 * 3xx prefixes are real allocations (audit 2026-11-11, L-03): the schema
 * below, the PhoneInput and the server domains all check against it, so a
 * number with a valid shape but an unallocated prefix (e.g. 0399) is
 * rejected the same way everywhere instead of accepted in one path and
 * refused in another.
 */
export const PAKISTAN_MOBILE_PREFIXES = [
  ...Array.from({ length: 10 }, (_, i) => `30${i}`),
  ...Array.from({ length: 10 }, (_, i) => `31${i}`),
  ...Array.from({ length: 10 }, (_, i) => `32${i}`),
  ...Array.from({ length: 9 }, (_, i) => `33${i}`),
  '339',
  ...Array.from({ length: 10 }, (_, i) => `34${i}`),
  ...Array.from({ length: 3 }, (_, i) => `35${5 + i}`),
  ...Array.from({ length: 6 }, (_, i) => `36${i}`),
  ...Array.from({ length: 9 }, (_, i) => `37${i + 1}`),
] as const;

const SUPPORTED_MOBILE_PREFIXES = new Set<string>(PAKISTAN_MOBILE_PREFIXES);

/** True when the 10 national digits start with a real allocated prefix. */
export function isSupportedPkMobileNational(national: string): boolean {
  return SUPPORTED_MOBILE_PREFIXES.has(national.slice(0, 3));
}

/**
 * Pakistani MOBILE numbers only (03xx, 10 national digits) → E.164.
 * Landlines are rejected: they cannot receive the SMS a token or an
 * applicant account depends on. Numbers with an unallocated prefix are
 * rejected too (L-03): the shape alone is not enough.
 */
export const pkMobileSchema = z
  .string('Enter a mobile number')
  .transform(nationalDigits)
  .pipe(
    z
      .string()
      .regex(/^3\d{9}$/, 'Enter a Pakistani mobile number, e.g. 0300 1234567')
      .refine(isSupportedPkMobileNational, 'Enter a Pakistani mobile number, e.g. 0300 1234567'),
  )
  .transform(toE164);

/**
 * Token-issue mobile (2026-11-17): the same Pakistani-mobile rule as
 * pkMobileSchema, but empty / incomplete / invalid are told apart, so the
 * counter sees "Phone number is required." / "Phone number is incomplete."
 * / "Please enter a valid Pakistani mobile number." pkMobileSchema stays
 * untouched: registration forms keep their existing wording.
 */
export const tokenPkMobileSchema = z
  .string('Phone number is required.')
  .transform(nationalDigits)
  .pipe(
    z.string().superRefine((national, ctx) => {
      if (national.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'Phone number is required.' });
        return;
      }
      if (national.length < 10) {
        ctx.addIssue({ code: 'custom', message: 'Phone number is incomplete.' });
        return;
      }
      if (!/^3\d{9}$/.test(national) || !isSupportedPkMobileNational(national)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Please enter a valid Pakistani mobile number.',
        });
      }
    }),
  )
  .transform(toE164);

/**
 * Pakistani phone numbers, shared by the company and applicant contracts.
 * Mobile or landline → E.164 ("021 3456 7890" → "+922134567890").
 * Only use this where a landline is genuinely acceptable (e.g. a company
 * head-office number). Anything that must reach a person — tokens, applicant
 * accounts, phone changes — must use pkMobileSchema instead (M21): a token
 * issued to a landline can never receive an SMS.
 */
export const pkPhoneSchema = z
  .string('Enter a phone number')
  .transform(nationalDigits)
  .pipe(z.string().regex(/^[1-9]\d{8,9}$/, 'Enter a Pakistani phone number, e.g. 0300 1234567'))
  .transform(toE164);
