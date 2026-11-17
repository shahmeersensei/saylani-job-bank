import { z } from 'zod';
import { pakistanPointSchema } from './applicant';
import { passwordSchema, sixDigitCodeSchema } from './auth';
import { DOCUMENT_MIME_TYPES, masterDataCodeSchema } from './master-data';
import { pkPhoneSchema } from './phone';

/**
 * Company & verification contracts (M7), shared by the API and the UI.
 * Owner decisions (2026-10-02, all recommended defaults): employers sign up with email +
 * password after confirming a 6-digit code; one company per employer account
 * (2026-11-17: an employer creates and runs one company at a time); documents
 * required per legal structure; NTN required and unique among non-rejected companies; the
 * nearest branch to the head office is suggested; claim-based verifier queue with automatic
 * conflict-of-interest checks; SLA = 2 working days, paused while waiting for the employer;
 * rejected companies may correct and submit again; legal details lock once verified;
 * Branch Admin suspends/reinstates; only verifiers and Super Admin see unverified companies.
 */

// ─── Statuses ──────────────────────────────────────────────────────────

/** A company's overall status. While a round is open it mirrors the round's state. */
export const COMPANY_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_VERIFICATION',
  'INFO_REQUESTED',
  'RESUBMITTED',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = {
  DRAFT: 'Not submitted yet',
  SUBMITTED: 'Waiting for a verifier',
  UNDER_VERIFICATION: 'Under verification',
  INFO_REQUESTED: 'More information needed',
  RESUBMITTED: 'Resubmitted',
  VERIFIED: 'Verified',
  REJECTED: 'Not approved',
  SUSPENDED: 'Suspended',
};

/** Statuses Branch Admin and Staff can see (PRD: verifier-first approval). */
export const PUBLIC_COMPANY_STATUSES = ['VERIFIED', 'SUSPENDED'] as const satisfies CompanyStatus[];

/** One verification round (submission → decision). */
export const VERIFICATION_STATES = [
  'SUBMITTED',
  'UNDER_VERIFICATION',
  'INFO_REQUESTED',
  'RESUBMITTED',
  'VERIFIED',
  'REJECTED',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/** Rounds still waiting for a decision. */
export const OPEN_VERIFICATION_STATES = [
  'SUBMITTED',
  'UNDER_VERIFICATION',
  'INFO_REQUESTED',
  'RESUBMITTED',
] as const satisfies VerificationState[];

/** The SLA clock runs only while the round is with Job Bank (paused while INFO_REQUESTED). */
export const SLA_RUNNING_STATES = [
  'SUBMITTED',
  'UNDER_VERIFICATION',
  'RESUBMITTED',
] as const satisfies VerificationState[];

export const VERIFICATION_EVENTS = [
  'SUBMIT',
  'CLAIM',
  'RELEASE',
  'DECLARE_CONFLICT',
  'ASSIGN',
  'REQUEST_INFO',
  'RESUBMIT',
  'VERIFY',
  'REJECT',
  'SUSPEND',
  'REINSTATE',
] as const;
export type VerificationEvent = (typeof VERIFICATION_EVENTS)[number];

export const VERIFICATION_EVENT_LABELS: Record<VerificationEvent, string> = {
  SUBMIT: 'Submitted for verification',
  CLAIM: 'Picked up by a verifier',
  RELEASE: 'Returned to the queue',
  DECLARE_CONFLICT: 'Verifier declared a conflict of interest',
  ASSIGN: 'Assigned to a verifier',
  REQUEST_INFO: 'More information requested',
  RESUBMIT: 'Employer sent the information',
  VERIFY: 'Verified',
  REJECT: 'Not approved',
  SUSPEND: 'Suspended',
  REINSTATE: 'Reinstated',
};

// ─── Reference lists ───────────────────────────────────────────────────

export const LEGAL_STRUCTURES = [
  'SOLE_PROPRIETOR',
  'PARTNERSHIP',
  'PRIVATE_LIMITED',
  'PUBLIC_LIMITED',
  'NGO_TRUST',
] as const;
export type LegalStructure = (typeof LEGAL_STRUCTURES)[number];

export const LEGAL_STRUCTURE_LABELS: Record<LegalStructure, string> = {
  SOLE_PROPRIETOR: 'Sole proprietorship',
  PARTNERSHIP: 'Partnership (AOP)',
  PRIVATE_LIMITED: 'Private limited company',
  PUBLIC_LIMITED: 'Public limited company',
  NGO_TRUST: 'NGO, trust or society',
};

/**
 * Default required documents per legal structure (owner decision 3).
 * NTN certificate, SECP registration and address proof are OPTIONAL
 * (2026-11-13, handwritten notes): they are no longer in any list, so
 * they never block submission or verification. They stay uploadable —
 * see `optionalDocuments` on the company view — the employer just isn't
 * forced to supply them. Seeded into `company_document_requirements`;
 * Super Admin can change them later. Migration 0048 deletes the three
 * rows from live databases; the seed is insert-only, so removing them
 * here alone would not change an existing database.
 */
export const DEFAULT_COMPANY_DOCUMENT_REQUIREMENTS: Record<LegalStructure, readonly string[]> = {
  SOLE_PROPRIETOR: ['AUTHORISED_PERSON_CNIC_FRONT', 'AUTHORISED_PERSON_CNIC_BACK'],
  PARTNERSHIP: [
    'AUTHORISED_PERSON_CNIC_FRONT',
    'AUTHORISED_PERSON_CNIC_BACK',
    'BUSINESS_REGISTRATION',
  ],
  PRIVATE_LIMITED: ['AUTHORISED_PERSON_CNIC_FRONT', 'AUTHORISED_PERSON_CNIC_BACK'],
  PUBLIC_LIMITED: ['AUTHORISED_PERSON_CNIC_FRONT', 'AUTHORISED_PERSON_CNIC_BACK'],
  NGO_TRUST: [
    'AUTHORISED_PERSON_CNIC_FRONT',
    'AUTHORISED_PERSON_CNIC_BACK',
    'BUSINESS_REGISTRATION',
    'AUTHORISATION_LETTER',
  ],
};

export const COMPANY_SIZE_BANDS = ['1_10', '11_50', '51_200', '201_500', '500_PLUS'] as const;
export type CompanySizeBand = (typeof COMPANY_SIZE_BANDS)[number];

export const COMPANY_SIZE_LABELS: Record<CompanySizeBand, string> = {
  '1_10': '1–10 employees',
  '11_50': '11–50 employees',
  '51_200': '51–200 employees',
  '201_500': '201–500 employees',
  '500_PLUS': 'More than 500 employees',
};

export const COMPANY_LOCATION_KINDS = ['HQ', 'SITE'] as const;
export type CompanyLocationKind = (typeof COMPANY_LOCATION_KINDS)[number];

export const COMPANY_DOCUMENT_STATUSES = ['PENDING_UPLOAD', 'UPLOADED', 'INFECTED'] as const;
export type CompanyDocumentStatus = (typeof COMPANY_DOCUMENT_STATUSES)[number];

export const DOCUMENT_REVIEW_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];

export const COMPANY_MEMBER_ROLES = ['OWNER'] as const;
export type CompanyMemberRole = (typeof COMPANY_MEMBER_ROLES)[number];

// ─── Field schemas ─────────────────────────────────────────────────────

/**
 * National Tax Number: "1234567-8" (7 digits + check digit), an older 7-digit NTN, or the
 * 13-digit CNIC-based NTN of an individual. Stored as "1234567-8", "1234567" or 13 digits.
 *
 * M17 (PARTIAL, 2026-11-08): only the format is validated. The 8th digit is a check
 * digit, but the FBR check-digit algorithm could not be verified against any reliable
 * in-repo source — the only NTN values in the repo are the placeholder "1234567-8"
 * (seed data, tests, form placeholders), which is not a known-good NTN to validate
 * an algorithm against. Do NOT guess or invent the algorithm: implementing an
 * unverified check digit would reject valid NTNs. Confirm the algorithm (FBR
 * documentation or a set of known-valid NTNs) before adding check-digit validation.
 */
export const ntnSchema = z
  .string('Enter the NTN')
  .transform((value) => value.replace(/\s/g, ''))
  .transform((value) => {
    const short = /^(\d{7})-?(\d)$/.exec(value);
    if (short) return `${short[1]}-${short[2]}`;
    const cnic = value.replace(/-/g, '');
    return /^\d{13}$/.test(cnic) ? cnic : value;
  })
  .pipe(
    z
      .string()
      .regex(/^(\d{7}(-\d)?|[1-9]\d{12})$/, 'Enter the NTN, e.g. 1234567-8 or a 13-digit CNIC'),
  );

/**
 * NTN for staff field-visit onboarding only (2026-11-13, user): NTN is NOT
 * mandatory there — a company visited in the field may not share its NTN on
 * the spot. Blank / missing parses to null; a filled value still gets the
 * full ntnSchema format check. The employer self-registration schema keeps
 * the required `ntnSchema` above, so this does not loosen employer sign-up.
 */
export const optionalNtnSchema = z
  .preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    ntnSchema.nullable(),
  )
  // A missing key parses to null, not undefined: Zod skips an optional
  // field's inner schema when the key is absent, so the default — not the
  // preprocess above — is what normalises a missing NTN.
  .default(null);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const optionalEmail = z
  .preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z
      .union([
        z
          .email('Enter a valid email address')
          .max(254)
          .refine((value) => value.slice(value.lastIndexOf('@') + 1).includes('.'), {
            message: 'Enter an email with a valid domain',
          }),
        z.literal(''),
      ])
      .nullish(),
  )
  .transform((value) => value || null);

const websiteSchema = z
  .preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string().max(200).nullish(),
  )
  .transform((value) => {
    if (!value) return null;
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  })
  .pipe(
    z
      .url('Enter a valid website address, e.g. https://example.com')
      .nullable()
      .refine((value) => {
        if (!value) return true;
        const parsed = new URL(value);
        return (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          parsed.hostname.includes('.') &&
          !/^\d+(?:\.\d+)+$/.test(parsed.hostname)
        );
      }, 'Enter a valid website address with a domain name'),
  );

const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters)').max(500);
const note = (message: string) => z.string().trim().min(10, message).max(2000);

// ─── Employer sign-up ──────────────────────────────────────────────────

export const employerSignupCodeSchema = z.object({
  email: z.email('Enter a valid email address').trim().toLowerCase().max(254),
});

export const employerSignupSchema = z.object({
  fullName: z.string('Enter your name').trim().min(3, 'Enter your full name').max(120),
  email: z.email('Enter a valid email address').trim().toLowerCase().max(254),
  // No phone here: `users.phone_number` is the applicants' sign-in identity. Company phone
  // numbers live on company_contacts.
  password: passwordSchema,
  code: sixDigitCodeSchema,
});
export type EmployerSignupInput = z.infer<typeof employerSignupSchema>;

// ─── Company details ───────────────────────────────────────────────────

const companyFields = {
  legalName: z
    .string('Enter the registered company name')
    .trim()
    .min(2, 'Enter the registered company name')
    .max(160),
  tradeName: optionalText(160),
  legalStructure: z.enum(LEGAL_STRUCTURES, 'Choose the type of business'),
  ntn: ntnSchema,
  registrationNo: optionalText(60),
  industryCode: masterDataCodeSchema,
  sizeBand: z.enum(COMPANY_SIZE_BANDS, 'Choose the company size'),
  website: websiteSchema,
  description: optionalText(1000),
};

export const registerCompanySchema = z.object(companyFields);
export type RegisterCompanyInput = z.infer<typeof registerCompanySchema>;

/**
 * Staff field-visit onboarding: a Saylani staff member visits a company
 * and registers it on its behalf.
 * Few required fields so the form is quick to fill during/after a visit; the rest is
 * completable later. Legal structure and company size stay required: the database keeps
 * them NOT NULL, so making them optional would need a migration. NTN is optional
 * here (2026-11-13): the database column is nullable from migration 0047, and the
 * duplicate-NTN checks in domains/company/staff.ts are skipped when it is null.
 */
export const staffOnboardCompanySchema = z.object({
  ...companyFields,
  // NTN is optional here (see optionalNtnSchema): overrides the required
  // ntn from companyFields, which employer self-registration keeps.
  ntn: optionalNtnSchema,
  branchId: z.uuid('Choose a branch'),
  contactName: z
    .string('Enter the contact person’s name')
    .trim()
    .min(3, 'Enter the contact person’s full name')
    .max(120),
  contactDesignation: optionalText(120),
  contactPhone: pkPhoneSchema,
  contactEmail: optionalEmail,
  visitDate: z
    .string('Choose the visit date')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the visit date')
    .refine((value) => {
      // Reject impossible calendar dates (e.g. 2026-02-30), which the
      // format regex alone would accept.
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(Date.UTC(year!, month! - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month! - 1 &&
        date.getUTCDate() === day
      );
    }, 'Choose a real calendar date')
    .refine((value) => {
      // Compare date strings in Asia/Karachi so a visit "today" in Pakistan
      // is never rejected by a server running in another timezone.
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Karachi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      return value <= today;
    }, 'The visit date cannot be in the future'),
  headOfficeAddress: optionalText(300),
  otherSites: optionalText(500),
  workforceRoles: optionalText(300),
  workforceType: optionalText(300),
  workforceShifts: optionalText(300),
  workforceOpenings: optionalText(60),
  yearsInBusiness: optionalText(60),
  previousHiring: optionalText(500),
  certifications: optionalText(500),
  additionalNotes: optionalText(2000),
});
export type StaffOnboardCompanyInput = z.infer<typeof staffOnboardCompanySchema>;

/** Every field optional and without defaults (a default would overwrite on every PATCH). */
export const updateCompanySchema = z.object(companyFields).partial();
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

/** Locked once the company is verified (owner decision 11). */
export const COMPANY_LEGAL_FIELDS = [
  'legalName',
  'legalStructure',
  'ntn',
  'registrationNo',
] as const satisfies (keyof UpdateCompanyInput)[];

/** Super Admin corrects locked details; the reason goes to the audit log. */
export const correctCompanySchema = z
  .object(companyFields)
  .partial()
  .extend({ reason })
  .refine((v) => Object.keys(v).some((key) => key !== 'reason'), {
    message: 'Change at least one field',
  });

export const companyContactSchema = z.object({
  name: z
    .string('Enter a name')
    .trim()
    .min(3, 'Enter the full name')
    .max(120)
    .refine((value) => value.split(/\s+/).length >= 2, 'Enter first and last name')
    .regex(/^[\p{L}][\p{L}\s.'-]*$/u, 'Enter a name using letters only'),
  designation: optionalText(120).refine(
    (value) => value === null || /^[\p{L}][\p{L}\s.'-]*$/u.test(value),
    'Enter a designation using letters only',
  ),
  phone: z
    .string('Enter a phone number')
    .transform((value) => {
      let digits = value.replace(/\D/g, '');
      if (digits.startsWith('0092')) digits = digits.slice(4);
      else if (digits.startsWith('92') && digits.length > 10) digits = digits.slice(2);
      else if (digits.startsWith('0')) digits = digits.slice(1);
      return digits;
    })
    .pipe(
      z.string().regex(/^3\d{9}$/, 'Enter an 11-digit Pakistani mobile number, e.g. 03001234567'),
    )
    .transform((national) => `+92${national}`),
  email: optionalEmail,
  isPrimary: z.boolean().default(false),
});

export const companyContactsSchema = z.object({
  items: z
    .array(companyContactSchema)
    .min(1, 'Add at least one contact person')
    .max(5)
    .refine((items) => items.filter((c) => c.isPrimary).length === 1, {
      message: 'Mark exactly one contact as the main contact',
    }),
});
export type CompanyContactsInput = z.infer<typeof companyContactsSchema>;

const addressFields = {
  location: pakistanPointSchema,
  addressLine: z
    .string('Enter the address')
    .trim()
    .min(5, 'Enter the address (building, street, area)')
    .max(300),
  // H12: a master-data code, not free text. The domain layer asserts it is an
  // active CITY (and that areaCode belongs to it) via assertCityArea.
  cityCode: masterDataCodeSchema,
  // Same as the applicant side: normalised so the AREA lookup matches master data.
  areaCode: masterDataCodeSchema.nullish().transform((v) => v ?? null),
};

/** Head office pin + the branch the company registers with (nearest suggested). */
export const companyHeadOfficeSchema = z.object({
  ...addressFields,
  branchId: z.uuid('Choose a branch'),
});
export type CompanyHeadOfficeInput = z.infer<typeof companyHeadOfficeSchema>;

/**
 * Head office pin for a field-visit-onboarded company. No branchId: the
 * company already has a branch from onboarding.
 */
export const onboardedCompanyHeadOfficeSchema = companyHeadOfficeSchema.omit({
  branchId: true,
});
export type OnboardedCompanyHeadOfficeInput = z.infer<typeof onboardedCompanyHeadOfficeSchema>;

/** Other workplaces (factories, shops, offices). Jobs (M8) are posted at one of these. */
export const companySiteSchema = z.object({
  label: z.string('Name this site').trim().min(2, 'Name this site, e.g. "SITE factory"').max(80),
  ...addressFields,
});
export type CompanySiteInput = z.infer<typeof companySiteSchema>;

export const companyPresignSchema = z.object({
  typeCode: masterDataCodeSchema,
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(DOCUMENT_MIME_TYPES, 'Upload a PDF, JPG or PNG file'),
  sizeBytes: z.number().int().positive(),
});

export type CompanyPresignInput = z.infer<typeof companyPresignSchema>;

// ─── Verification actions ──────────────────────────────────────────────

/**
 * M18: resubmitting after INFO_REQUESTED needs a note of at least this many
 * characters OR proof something changed (a new/accepted document, an edited
 * field). The schema alone cannot see the database, so the note stays optional
 * here and the OR is enforced by the resubmit guard in
 * `apps/web/src/domains/company/profile.ts` (resubmitMyCompany).
 */
export const RESUBMIT_NOTE_MIN_LENGTH = 10;

/** A resubmit note counts only when it actually says something (M18). */
export function isResubmitNoteSufficient(note: string | null | undefined): boolean {
  return (note?.trim().length ?? 0) >= RESUBMIT_NOTE_MIN_LENGTH;
}

export const resubmitSchema = z.object({
  note: optionalText(2000),
});

export const releaseSchema = z.object({
  /** True when the verifier knows the company (owner decision 7); they cannot claim it again. */
  conflict: z.boolean().default(false),
  note: optionalText(500),
});

export const assignVerifierSchema = z.object({
  verifierId: z.uuid('Choose a verifier'),
  reason,
});

export const documentReviewSchema = z
  .object({
    decision: z.enum(['ACCEPTED', 'REJECTED']),
    note: optionalText(500),
  })
  .refine((v) => v.decision === 'ACCEPTED' || (v.note?.length ?? 0) >= 5, {
    message: 'Say what is wrong, so the employer can fix it',
    path: ['note'],
  });
export type DocumentReviewInput = z.infer<typeof documentReviewSchema>;

export const requestInfoSchema = z.object({
  note: note('Say what the employer needs to send or fix (at least 10 characters)'),
});

export const verifyCompanySchema = z.object({ note: optionalText(2000) });

export const rejectCompanySchema = z.object({
  reasonCode: masterDataCodeSchema,
  note: note('Explain the decision (at least 10 characters)'),
});

export const companyStatusSchema = z.object({
  status: z.enum(['SUSPENDED', 'VERIFIED']),
  reason,
});

export const transferCompanySchema = z.object({ branchId: z.uuid('Choose a branch'), reason });
