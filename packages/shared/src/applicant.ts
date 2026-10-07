import { z } from 'zod';
import { DOCUMENT_MIME_TYPES, masterDataCodeSchema } from './master-data';
import { RADIUS_LIMITS } from './settings';

/**
 * Applicant domain contracts (M6), shared by the API and the UI.
 * Owner decisions (2026-10-02): auto-activation once personal details, location + branch and
 * the required documents are in; identity verification is a separate staff check; minimum
 * age 18; father's/husband's name required; CNIC stored in full but never sent to employers.
 */

export const APPLICANT_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'RESTRICTED'] as const;
export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number];

export const APPLICANT_STATUS_LABELS: Record<ApplicantStatus, string> = {
  DRAFT: 'Profile incomplete',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  RESTRICTED: 'Restricted',
};

export const IDENTITY_STATUSES = ['UNVERIFIED', 'VERIFIED', 'REJECTED'] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const IDENTITY_STATUS_LABELS: Record<IdentityStatus, string> = {
  UNVERIFIED: 'Not verified yet',
  VERIFIED: 'Identity verified',
  REJECTED: 'Identity check failed',
};

export const IDENTITY_METHODS = ['DOCUMENT_REVIEW', 'IN_PERSON'] as const;
export type IdentityMethod = (typeof IDENTITY_METHODS)[number];

export const IDENTITY_METHOD_LABELS: Record<IdentityMethod, string> = {
  DOCUMENT_REVIEW: 'Checked the uploaded CNIC images',
  IN_PERSON: 'Saw the original CNIC in person',
};

export const IDENTITY_OUTCOMES = ['VERIFIED', 'REJECTED'] as const;
export type IdentityOutcome = (typeof IDENTITY_OUTCOMES)[number];

export const GENDERS = ['MALE', 'FEMALE', 'UNDISCLOSED'] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  UNDISCLOSED: 'Prefer not to say',
};

export const SKILL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'EXPERT'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  EXPERT: 'Expert',
};

export const LANGUAGE_PROFICIENCIES = ['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'] as const;
export type LanguageProficiency = (typeof LANGUAGE_PROFICIENCIES)[number];

export const LANGUAGE_PROFICIENCY_LABELS: Record<LanguageProficiency, string> = {
  BASIC: 'Basic',
  CONVERSATIONAL: 'Conversational',
  FLUENT: 'Fluent',
  NATIVE: 'Native',
};

export const SHIFTS = ['DAY', 'EVENING', 'NIGHT', 'ROTATING'] as const;
export type Shift = (typeof SHIFTS)[number];

export const SHIFT_LABELS: Record<Shift, string> = {
  DAY: 'Day',
  EVENING: 'Evening',
  NIGHT: 'Night',
  ROTATING: 'Rotating shifts',
};

export const JOB_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERNSHIP',
  'TEMPORARY',
  'DAILY_WAGE',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  FULL_TIME: 'Full time',
  PART_TIME: 'Part time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  TEMPORARY: 'Temporary',
  DAILY_WAGE: 'Daily wage',
};

export const APPLICANT_DOCUMENT_STATUSES = [
  'PENDING_UPLOAD',
  'UPLOADED',
  'ACCEPTED',
  'REJECTED',
] as const;
export type ApplicantDocumentStatus = (typeof APPLICANT_DOCUMENT_STATUSES)[number];

export const MIN_APPLICANT_AGE = 18;
export const MAX_APPLICANT_AGE = 80;

// ─── Field schemas ─────────────────────────────────────────────────────

/** "42101-1234567-1" or "4210112345671" → "4210112345671". */
export const cnicSchema = z
  .string('Enter your CNIC number')
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[1-9]\d{12}$/, 'Enter the 13-digit CNIC number'));

const personName = (label: string) =>
  z
    .string(`Enter ${label}`)
    .trim()
    .min(3, `Enter ${label} (at least 3 letters)`)
    .max(120)
    .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u, 'Use letters only');

/** Whole years between an ISO date of birth and `today` (UTC calendar dates). */
export function ageOn(dateOfBirth: string, today: Date = new Date()): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const month = today.getUTCMonth() + 1;
  if (month < m || (month === m && today.getUTCDate() < d)) age -= 1;
  return age;
}

export const dateOfBirthSchema = z.iso
  .date('Enter your date of birth')
  .refine((dob) => ageOn(dob) >= MIN_APPLICANT_AGE, {
    message: `You must be at least ${MIN_APPLICANT_AGE} years old to register`,
  })
  .refine((dob) => ageOn(dob) <= MAX_APPLICANT_AGE, { message: 'Check the date of birth' });

/** "YYYY-MM" month, e.g. a job start date. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the format YYYY-MM');

const currentMonth = () => new Date().toISOString().slice(0, 7);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

// ─── Personal details ──────────────────────────────────────────────────

const personalFields = {
  fullName: personName('your full name'),
  fatherName: personName("your father's or husband's name"),
  cnic: cnicSchema,
  dateOfBirth: dateOfBirthSchema,
  gender: z.enum(GENDERS, 'Choose an option'),
  email: z
    .email('Enter a valid email address')
    .trim()
    .toLowerCase()
    .max(254)
    .nullish()
    .or(z.literal('').transform(() => null)),
};

export const registerApplicantSchema = z.object(personalFields);
export type RegisterApplicantInput = z.infer<typeof registerApplicantSchema>;

/** Every field optional and without defaults (a default would overwrite on every PATCH). */
export const updatePersonalSchema = z.object(personalFields).partial();
export type UpdatePersonalInput = z.infer<typeof updatePersonalSchema>;

/** Staff correcting identity fields after a check; the reason goes to the audit log. */
export const staffEditApplicantSchema = z
  .object(personalFields)
  .partial()
  .extend({ reason: z.string().trim().min(5, 'Give a short reason').max(500) })
  .refine((v) => Object.keys(v).some((key) => key !== 'reason'), {
    message: 'Change at least one field',
  });

// ─── Location ──────────────────────────────────────────────────────────

/** Rough bounding box of Pakistan (incl. AJK and Gilgit-Baltistan). */
export const PAKISTAN_BOUNDS = { minLat: 23.5, maxLat: 37.2, minLng: 60.8, maxLng: 77.9 } as const;

export const pakistanPointSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .refine(
    ({ lat, lng }) =>
      lat >= PAKISTAN_BOUNDS.minLat &&
      lat <= PAKISTAN_BOUNDS.maxLat &&
      lng >= PAKISTAN_BOUNDS.minLng &&
      lng <= PAKISTAN_BOUNDS.maxLng,
    'Pick a location in Pakistan',
  );

export const applicantLocationSchema = z.object({
  location: pakistanPointSchema,
  addressLine: z
    .string('Enter your address')
    .trim()
    .min(5, 'Enter your address (house, street, block)')
    .max(300),
  cityCode: masterDataCodeSchema,
  areaCode: masterDataCodeSchema.nullish().transform((v) => v ?? null),
  /** The branch the applicant chose (the nearest one is suggested). Locked once ACTIVE. */
  branchId: z.uuid('Choose a branch'),
});
export type ApplicantLocationInput = z.infer<typeof applicantLocationSchema>;

export const branchOptionsQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// ─── Profile sections (each saved as a whole list) ─────────────────────

const unique = <T>(key: (item: T) => string, message: string) =>
  [(items: T[]) => new Set(items.map(key)).size === items.length, { message }] as const;

export const educationItemSchema = z.object({
  levelCode: masterDataCodeSchema,
  institution: optionalText(160),
  fieldOfStudy: optionalText(120),
  completionYear: z
    .number()
    .int()
    .min(1950)
    .max(new Date().getUTCFullYear() + 6)
    .nullish()
    .transform((v) => v ?? null),
  isCurrent: z.boolean().default(false),
  grade: optionalText(40),
});
export const educationSchema = z.object({ items: z.array(educationItemSchema).max(10) });
export type EducationInput = z.infer<typeof educationSchema>;

export const experienceItemSchema = z
  .object({
    employerName: z.string().trim().min(2, 'Enter the employer').max(160),
    jobTitle: z.string().trim().min(2, 'Enter your job title').max(120),
    categoryCode: masterDataCodeSchema.nullish().transform((v) => v ?? null),
    startMonth: monthSchema,
    endMonth: monthSchema.nullish().transform((v) => v ?? null),
    isCurrent: z.boolean().default(false),
    description: optionalText(1000),
  })
  .superRefine((item, ctx) => {
    if (item.startMonth > currentMonth())
      ctx.addIssue({ code: 'custom', path: ['startMonth'], message: 'Cannot be in the future' });
    if (item.isCurrent && item.endMonth)
      ctx.addIssue({
        code: 'custom',
        path: ['endMonth'],
        message: 'Leave the end empty for your current job',
      });
    if (!item.isCurrent && !item.endMonth)
      ctx.addIssue({ code: 'custom', path: ['endMonth'], message: 'Enter when this job ended' });
    if (item.endMonth && item.endMonth < item.startMonth)
      ctx.addIssue({ code: 'custom', path: ['endMonth'], message: 'Must be after the start' });
    if (item.endMonth && item.endMonth > currentMonth())
      ctx.addIssue({ code: 'custom', path: ['endMonth'], message: 'Cannot be in the future' });
  });
export const experienceSchema = z
  .object({ hasNoExperience: z.boolean(), items: z.array(experienceItemSchema).max(15) })
  .refine((v) => !(v.hasNoExperience && v.items.length > 0), {
    message: 'Remove the jobs, or untick "I have no work experience"',
    path: ['hasNoExperience'],
  });
export type ExperienceInput = z.infer<typeof experienceSchema>;

export const skillsSchema = z.object({
  items: z
    .array(
      z.object({
        skillCode: masterDataCodeSchema,
        level: z.enum(SKILL_LEVELS),
        years: z.number().int().min(0).max(50),
      }),
    )
    .max(30)
    .refine(...unique((s: { skillCode: string }) => s.skillCode, 'Each skill only once')),
});
export type SkillsInput = z.infer<typeof skillsSchema>;

export const languagesSchema = z.object({
  items: z
    .array(
      z.object({ languageCode: masterDataCodeSchema, proficiency: z.enum(LANGUAGE_PROFICIENCIES) }),
    )
    .max(10)
    .refine(...unique((l: { languageCode: string }) => l.languageCode, 'Each language only once')),
});
export type LanguagesInput = z.infer<typeof languagesSchema>;

export const certificationsSchema = z.object({
  items: z
    .array(
      z
        .object({
          name: z.string().trim().min(2, 'Enter the certificate name').max(160),
          issuer: optionalText(160),
          issuedMonth: monthSchema.nullish().transform((v) => v ?? null),
          expiresMonth: monthSchema.nullish().transform((v) => v ?? null),
        })
        .refine((c) => !c.issuedMonth || !c.expiresMonth || c.expiresMonth >= c.issuedMonth, {
          message: 'Must be after the issue date',
          path: ['expiresMonth'],
        }),
    )
    .max(15),
});
export type CertificationsInput = z.infer<typeof certificationsSchema>;

export const preferencesSchema = z.object({
  categoryCodes: z
    .array(masterDataCodeSchema)
    .min(1, 'Choose at least one kind of job')
    .max(10)
    .refine(...unique((c: string) => c, 'Each category only once')),
  minSalaryPkr: z
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .nullish()
    .transform((v) => v ?? null),
  shifts: z
    .array(z.enum(SHIFTS))
    .max(SHIFTS.length)
    .refine(...unique((s: string) => s, 'Each shift only once')),
  jobTypes: z
    .array(z.enum(JOB_TYPES))
    .max(JOB_TYPES.length)
    .refine(...unique((s: string) => s, 'Each job type only once')),
  /** How far the applicant will travel; null = as far as the branch policy allows. */
  willingRadiusM: z
    .number()
    .int()
    .min(RADIUS_LIMITS.minM, `At least ${RADIUS_LIMITS.minM / 1000} km`)
    .max(RADIUS_LIMITS.maxM, `At most ${RADIUS_LIMITS.maxM / 1000} km`)
    .nullish()
    .transform((v) => v ?? null),
  availableFrom: z.iso
    .date()
    .nullish()
    .transform((v) => v ?? null),
});
export type PreferencesInput = z.infer<typeof preferencesSchema>;

// ─── Documents ─────────────────────────────────────────────────────────

export const presignDocumentSchema = z.object({
  typeCode: masterDataCodeSchema,
  /** Shown to the applicant and staff only; never used in the storage key. */
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(DOCUMENT_MIME_TYPES, 'Upload a PDF, JPG or PNG file'),
  sizeBytes: z.number().int().positive(),
});
export type PresignDocumentInput = z.infer<typeof presignDocumentSchema>;

// ─── Status, identity, staff actions ───────────────────────────────────

/** Applicants pause or resume their own profile. */
export const selfStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });

const reason = z.string().trim().min(5, 'Give a short reason (at least 5 characters)').max(500);

export const staffStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']), reason });

export const identityVerificationSchema = z
  .object({
    outcome: z.enum(IDENTITY_OUTCOMES),
    method: z.enum(IDENTITY_METHODS),
    notes: optionalText(1000),
  })
  .refine((v) => v.outcome === 'VERIFIED' || (v.notes?.length ?? 0) >= 5, {
    message: 'Explain what was wrong, so the applicant can fix it',
    path: ['notes'],
  });
export type IdentityVerificationInput = z.infer<typeof identityVerificationSchema>;

export const changePhoneSchema = z.object({ phone: z.string().trim().min(10).max(20), reason });
export const transferApplicantSchema = z.object({ branchId: z.uuid('Choose a branch'), reason });

// ─── Completeness & activation ─────────────────────────────────────────

export const PROFILE_SECTIONS = [
  { id: 'personal', label: 'Personal details', weight: 20 },
  { id: 'location', label: 'Home location & branch', weight: 20 },
  { id: 'skills', label: 'Skills', weight: 15 },
  { id: 'education', label: 'Education', weight: 10 },
  { id: 'experience', label: 'Work experience', weight: 10 },
  { id: 'preferences', label: 'Job preferences', weight: 10 },
  { id: 'documents', label: 'Required documents', weight: 10 },
  { id: 'languages', label: 'Languages', weight: 5 },
] as const;
export type ProfileSectionId = (typeof PROFILE_SECTIONS)[number]['id'];

/** Sections that must be done before a DRAFT profile becomes ACTIVE (owner decision 1a). */
export const ACTIVATION_SECTIONS: readonly ProfileSectionId[] = [
  'personal',
  'location',
  'documents',
];

export interface ProfileFacts {
  hasPersonal: boolean;
  /** Address pin and a chosen branch. */
  hasLocation: boolean;
  skillCount: number;
  educationCount: number;
  experienceCount: number;
  hasNoExperience: boolean;
  hasPreferences: boolean;
  /** Required document types (DOCUMENT_TYPE meta.required) with no current upload. */
  missingRequiredDocuments: number;
  languageCount: number;
}

export interface Completeness {
  /** 0–100. */
  percent: number;
  sections: { id: ProfileSectionId; label: string; weight: number; done: boolean }[];
  /** Sections still blocking activation (empty = the profile can be ACTIVE). */
  activationMissing: ProfileSectionId[];
}

export function computeCompleteness(facts: ProfileFacts): Completeness {
  const done: Record<ProfileSectionId, boolean> = {
    personal: facts.hasPersonal,
    location: facts.hasLocation,
    skills: facts.skillCount > 0,
    education: facts.educationCount > 0,
    experience: facts.experienceCount > 0 || facts.hasNoExperience,
    preferences: facts.hasPreferences,
    documents: facts.missingRequiredDocuments === 0,
    languages: facts.languageCount > 0,
  };
  const sections = PROFILE_SECTIONS.map((s) => ({ ...s, done: done[s.id] }));
  return {
    percent: sections.reduce((sum, s) => sum + (s.done ? s.weight : 0), 0),
    sections,
    activationMissing: ACTIVATION_SECTIONS.filter((id) => !done[id]),
  };
}
