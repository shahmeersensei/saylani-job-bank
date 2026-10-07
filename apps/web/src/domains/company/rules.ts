import { SLA_RUNNING_STATES, type CompanyStatus, type VerificationState } from '@jobbank/shared';

/** Pure M7 rules (no database), unit-tested in rules.test.ts. */

export interface CompanyEditability {
  /** Trade name, industry, size, website, description. */
  details: boolean;
  /** Legal name, legal structure, NTN, registration number (owner decision 11). */
  legal: boolean;
  contacts: boolean;
  /** Head office address/pin and work sites. */
  locations: boolean;
  /** Only before the first submission; afterwards Super Admin transfers (decision 5). */
  branch: boolean;
  documents: boolean;
}

const ALL: CompanyEditability = {
  details: true,
  legal: true,
  contacts: true,
  locations: true,
  branch: true,
  documents: true,
};
const NONE: CompanyEditability = {
  details: false,
  legal: false,
  contacts: false,
  locations: false,
  branch: false,
  documents: false,
};

/** What the employer may change in each status. Nothing changes while a verifier reviews. */
export function companyEditability(status: CompanyStatus): CompanyEditability {
  switch (status) {
    case 'DRAFT':
      return ALL;
    case 'INFO_REQUESTED':
    case 'REJECTED':
      return { ...ALL, branch: false };
    case 'VERIFIED':
      return { ...NONE, details: true, contacts: true, locations: true };
    default:
      return NONE;
  }
}

export type SlaStatus = 'ON_TRACK' | 'DUE_TODAY' | 'BREACHED' | 'PAUSED' | 'DONE';

/**
 * SLA state of a verification round on `today` (Pakistan date). The clock only runs while
 * the round is with Job Bank; it is paused while waiting for the employer.
 */
export function slaStatus(state: VerificationState, slaDueOn: string, today: string): SlaStatus {
  if (state === 'VERIFIED' || state === 'REJECTED') return 'DONE';
  if (!(SLA_RUNNING_STATES as readonly string[]).includes(state)) return 'PAUSED';
  if (today > slaDueOn) return 'BREACHED';
  return today === slaDueOn ? 'DUE_TODAY' : 'ON_TRACK';
}

const normalizeEmail = (value: string | null | undefined) => value?.trim().toLowerCase() || null;
const phoneDigits = (value: string | null | undefined) => {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits.length >= 9 ? digits.slice(-10) : null;
};

/**
 * Owner decision 7: a verifier may not handle a company they are linked to. Returns why
 * they are linked, or null. Emails match case-insensitively; phones on their last 10 digits.
 */
export function conflictReason(
  verifier: { email: string | null; phone: string | null },
  company: { emails: readonly (string | null)[]; phones: readonly (string | null)[] },
): string | null {
  const email = normalizeEmail(verifier.email);
  if (email && company.emails.some((e) => normalizeEmail(e) === email)) {
    return 'Your email address is listed on this company';
  }
  const phone = phoneDigits(verifier.phone);
  if (phone && company.phones.some((p) => phoneDigits(p) === phone)) {
    return 'Your phone number is listed on this company';
  }
  return null;
}
