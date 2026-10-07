import { z } from 'zod';
import { pakistanPointSchema } from './applicant';
import { passwordSchema, sixDigitCodeSchema } from './auth';
import { DOCUMENT_MIME_TYPES, masterDataCodeSchema } from './master-data';

/**
 * Company & verification contracts (M7), shared by the API and the UI.
 * Owner decisions (2026-10-02, all recommended defaults): employers sign up with email +
 * password after confirming a 6-digit code; one company per employer account; documents
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
 * Default required documents per legal structure (owner decision 3). Seeded into
 * `company_document_requirements`; Super Admin can change them later.
 */
export const DEFAULT_COMPANY_DOCUMENT_REQUIREMENTS: Record<LegalStructure, readonly string[]> = {
  SOLE_PROPRIETOR: ['AUTHORISED_PERSON_CNIC', 'ADDRESS_PROOF', 'NTN_CERTIFICATE'],
  PARTNERSHIP: [
    'AUTHORISED_PERSON_CNIC',
    'ADDRESS_PROOF',
    'NTN_CERTIFICATE',
    'BUSINESS_REGISTRATION',
  ],
  PRIVATE_LIMITED: [
    'AUTHORISED_PERSON_CNIC',
    'ADDRESS_PROOF',
    'SECP_REGISTRATION',
    'NTN_CERTIFICATE',
  ],
  PUBLIC_LIMITED: [
    'AUTHORISED_PERSON_CNIC',
    'ADDRESS_PROOF',
    'SECP_REGISTRATION',
    'NTN_CERTIFICATE',
  ],
  NGO_TRUST: [
    'AUTHORISED_PERSON_CNIC',
    'ADDRESS_PROOF',
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

/** Pakistani mobile or landline → E.164 ("021 3456 7890" → "+922134567890"). */
export const pkPhoneSchema = z
  .string('Enter a phone number')
  .transform((value) => {
    let digits = value.replace(/\D/g, '');
    if (digits.startsWith('0092')) digits = digits.slice(4);
    else if (digits.startsWith('92') && digits.length >= 11) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = digits.slice(1);
    return digits;
  })
  .pipe(z.string().regex(/^[1-9]\d{8,9}$/, 'Enter a Pakistani phone number, e.g. 0300 1234567'))
  .transform((national) => `+92${national}`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const optionalEmail = z
  .email('Enter a valid email address')
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .or(z.literal('').transform(() => null))
  .transform((value) => value ?? null);

const websiteSchema = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((value) => {
    if (!value) return null;
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  })
  .pipe(z.url('Enter a website address, e.g. www.example.com').nullable());

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
  name: z.string('Enter a name').trim().min(3, 'Enter the full name').max(120),
  designation: optionalText(120),
  phone: pkPhoneSchema,
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
  cityCode: masterDataCodeSchema,
  areaCode: masterDataCodeSchema.nullish().transform((v) => v ?? null),
};

/** Head office pin + the branch the company registers with (nearest suggested). */
export const companyHeadOfficeSchema = z.object({
  ...addressFields,
  branchId: z.uuid('Choose a branch'),
});
export type CompanyHeadOfficeInput = z.infer<typeof companyHeadOfficeSchema>;

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
