import { z } from 'zod';
import { DOCUMENT_MIME_TYPES, masterDataCodeSchema } from './master-data';
import { pkMobileSchema, tokenPkMobileSchema } from './phone';

/**
 * Applicant domain contracts (M6), shared by the API and the UI.
 * Owner decisions (2026-10-02): identity verification is a separate staff check; minimum
 * age 18; father's/husband's name required; CNIC stored in full but never sent to employers.
 * The DRAFT status was removed 2026-11-09 (user decision): a profile is ACTIVE from
 * creation, even while personal details, location or documents are still missing.
 * Completeness is now informational (percent + missing sections) and only gates
 * coming back from INACTIVE/RESTRICTED via REACTIVATE.
 */

export const APPLICANT_STATUSES = ['ACTIVE', 'INACTIVE', 'RESTRICTED'] as const;
export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number];
export const APPLICANT_REGISTRATION_SOURCES = ['SELF_SERVICE', 'STAFF_ASSISTED'] as const;
export type ApplicantRegistrationSource = (typeof APPLICANT_REGISTRATION_SOURCES)[number];

export const APPLICANT_STATUS_LABELS: Record<ApplicantStatus, string> = {
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
export const ASSISTED_REGISTRATION_GENDERS = ['MALE', 'FEMALE'] as const;

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
  'ROTATING',
  'TEMPORARY',
  'DAILY_WAGE',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  FULL_TIME: 'Full time',
  PART_TIME: 'Part time',
  CONTRACT: 'Contract',
  ROTATING: 'Rotating',
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

export interface ApplicantDocumentRequirement {
  code: string;
  required: boolean;
  requiredForCategories: readonly string[];
  requiredAlternativeForCategories: readonly string[];
}

/** Number of distinct required document requirements that are still unmet. */
export function missingApplicantDocumentRequirements(
  types: readonly ApplicantDocumentRequirement[],
  categories: Iterable<string>,
  presentTypes: Iterable<string>,
): number {
  const selectedCategories = new Set(categories);
  const uploadedTypes = new Set(presentTypes);
  let missing = types.filter(
    (type) =>
      (type.required ||
        type.requiredForCategories.some((category) => selectedCategories.has(category))) &&
      !uploadedTypes.has(type.code),
  ).length;

  for (const category of selectedCategories) {
    const alternatives = types.filter((type) =>
      type.requiredAlternativeForCategories.includes(category),
    );
    if (alternatives.length > 0 && !alternatives.some((type) => uploadedTypes.has(type.code))) {
      missing += 1;
    }
  }

  return missing;
}

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

/**
 * Staff registering a candidate at a counter. The candidate may have no phone at all.
 * Adapted from the Najam port (2026-11-11): NO email field — a walk-in candidate's
 * unverified real email must never be stored (it would look verified); the server
 * forces a placeholder email. `branchId` is optional: when staff work in several
 * branches they may name one, and the server validates it against their branches.
 */
const { email: _counterEmail, ...counterPersonalFields } = personalFields;
export const counterRegisterSchema = z.object({
  ...counterPersonalFields,
  phone: z.string().trim().max(20).nullish(),
  consentConfirmed: z.literal(true, 'Confirm that the candidate agreed'),
  branchId: z.uuid().optional(),
});
export type CounterRegisterInput = z.infer<typeof counterRegisterSchema>;

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

/**
 * Approximate city centres for the seeded CITY list. Used only when the
 * server geocode lookup returns nothing or is unreachable (the laptop
 * network has blocked external geocoders before), so a form can still be
 * saved: the exact address text is saved and the pin is the city centre,
 * near enough for the nearest-branch lookup. Never a substitute for a real
 * geocode result when one is available.
 */
export const CITY_CENTRES: Record<string, { lat: number; lng: number }> = {
  KARACHI: { lat: 24.8607, lng: 67.0011 },
  LAHORE: { lat: 31.5204, lng: 74.3587 },
  ISLAMABAD: { lat: 33.6844, lng: 73.0479 },
  RAWALPINDI: { lat: 33.6007, lng: 73.0679 },
  FAISALABAD: { lat: 31.4504, lng: 73.135 },
  MULTAN: { lat: 30.1575, lng: 71.5249 },
  HYDERABAD: { lat: 25.396, lng: 68.3578 },
  GUJRANWALA: { lat: 32.1877, lng: 74.1945 },
  PESHAWAR: { lat: 34.0151, lng: 71.5249 },
  QUETTA: { lat: 30.1798, lng: 66.975 },
  SIALKOT: { lat: 32.4945, lng: 74.5229 },
  SARGODHA: { lat: 32.0837, lng: 72.6711 },
  BAHAWALPUR: { lat: 29.3544, lng: 71.6911 },
  SUKKUR: { lat: 27.7052, lng: 68.8574 },
  LARKANA: { lat: 27.5589, lng: 68.212 },
  ABBOTTABAD: { lat: 34.1688, lng: 73.2215 },
  MARDAN: { lat: 34.1986, lng: 72.0231 },
  GUJRAT: { lat: 32.5731, lng: 74.1005 },
  SHEIKHUPURA: { lat: 31.7166, lng: 73.985 },
  RAHIM_YAR_KHAN: { lat: 28.4202, lng: 70.2989 },
  MUZAFFARABAD: { lat: 34.37, lng: 73.471 },
  GILGIT: { lat: 35.8819, lng: 74.4645 },
};

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
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cityCode: masterDataCodeSchema,
  areaCode: masterDataCodeSchema.nullish().transform((v) => v ?? null),
});
export type ApplicantLocationInput = z.infer<typeof applicantLocationSchema>;

/**
 * Assisted (staff) address: the counter no longer collects a map pin
 * (2026-11-16, Home location field removed from the staff form), so new
 * registrations carry `location: null` and matching has no distance for
 * them. The applicant's own location step keeps the pin required — only
 * the staff paths use this variant.
 */
export const assistedAddressSchema = applicantLocationSchema.extend({
  location: pakistanPointSchema.nullable(),
});
export type AssistedAddressInput = z.infer<typeof assistedAddressSchema>;

export const branchOptionsQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// ─── Profile sections (each saved as a whole list) ─────────────────────

const unique = <T>(key: (item: T) => string, message: string) =>
  [(items: T[]) => new Set(items.map(key)).size === items.length, { message }] as const;

export const educationItemSchema = z
  .object({
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
  })
  .refine(
    (item) =>
      item.isCurrent ||
      item.completionYear == null ||
      item.completionYear <= new Date().getUTCFullYear(),
    {
      message: 'Completion year cannot be in the future unless this is your current education',
      path: ['completionYear'],
    },
  );
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
        years: z.number().int().min(0).max(50).default(0),
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
        })
        .refine((c) => !c.issuedMonth || c.issuedMonth <= currentMonth(), {
          message: 'Cannot be in the future',
          path: ['issuedMonth'],
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
  availableFrom: z.iso
    .date()
    // A past "available from" is meaningless for matching (you are available
    // now); the date must be today or later, in Pakistan time.
    .refine((d) => d >= karachiDay(), { message: 'Available from cannot be in the past' })
    .nullish()
    .transform((v) => v ?? null),
});
export type PreferencesInput = z.infer<typeof preferencesSchema>;

export const staffRegisterApplicantSchema = registerApplicantSchema.extend({
  phone: pkMobileSchema,
  branchId: z.uuid('Choose a branch'),
  /**
   * Step 2 (2026-11-08): the first-counter token this registration completes.
   * When set, the token must be ISSUED, unexpired, for this branch and CNIC —
   * the server completes it (ISSUED → COMPLETED, applicant linked) in the same
   * transaction as the registration, so a failed registration never completes
   * a token and a completed token always has its applicant.
   */
  tokenId: z.uuid().optional(),
  address: assistedAddressSchema.optional(),
  /** Permanent home address (section 5). Same fields as the current address, no map pin. */
  permanentAddress: z
    .object({
      addressLine: z.string().trim().max(300),
      cityCode: masterDataCodeSchema,
      areaCode: masterDataCodeSchema.nullish().transform((v) => v ?? null),
    })
    .optional(),
  /** Free-text notes (section 6) for assessing the applicant's suitability. */
  additionalNotes: optionalText(2000),
  education: educationSchema.optional(),
  experience: experienceSchema.optional(),
  skills: skillsSchema.optional(),
  languages: languagesSchema.optional(),
  certifications: certificationsSchema.optional(),
  preferences: preferencesSchema.optional(),
});
export type StaffRegisterApplicantInput = z.infer<typeof staffRegisterApplicantSchema>;

// ─── First-counter tokens ──────────────────────────────────────────────

/**
 * Token-only first step (2026-11-07 reversal of the full-registration-at-first-
 * counter flow): the first counter collects only a CNIC + name, issues a
 * numbered token for the day, and prints it. The full registration happens at
 * a later step and links back through applicantId.
 */
export const APPLICANT_TOKEN_STATUSES = ['ISSUED', 'COMPLETED', 'CANCELLED'] as const;
export type ApplicantTokenStatus = (typeof APPLICANT_TOKEN_STATUSES)[number];

/**
 * Daily token numbers cap (N6 decision, 2026-11-08): a branch-day never issues
 * past 9999. Four digits is the widest the slip layout tolerates (the big
 * number shrinks via `.token-slip__number-value--wide`); 9999 tokens in one
 * branch-day is far beyond any real counter day, so hitting the cap is a
 * "come back tomorrow / contact a Super Admin" error, not a silent overflow
 * into 5-digit codes that would break the slip and the `{BRANCH}-{NNN}` shape.
 */
export const MAX_TOKEN_NUMBER = 9999;

/**
 * Token-issue CNIC (2026-11-17): the same 13-digit rule as cnicSchema, but
 * empty / wrong-length / invalid are told apart — "CNIC is required." /
 * "CNIC must contain exactly 13 digits." / "Please enter a valid CNIC
 * number." Letters and symbols are invalid (the CNIC input strips them
 * while typing, so a pasted "42101A1234567" arrives short and fails the
 * length check). cnicSchema stays untouched: registration forms keep their
 * existing wording.
 */
export const tokenCnicSchema = z
  .string('CNIC is required.')
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(
    z.string().superRefine((digits, ctx) => {
      if (digits.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'CNIC is required.' });
        return;
      }
      if (/[^0-9]/.test(digits)) {
        ctx.addIssue({ code: 'custom', message: 'Please enter a valid CNIC number.' });
        return;
      }
      if (digits.length !== 13) {
        ctx.addIssue({ code: 'custom', message: 'CNIC must contain exactly 13 digits.' });
        return;
      }
      if (!/^[1-9]\d{12}$/.test(digits)) {
        ctx.addIssue({ code: 'custom', message: 'Please enter a valid CNIC number.' });
      }
    }),
  );

/**
 * Token-issue applicant name (2026-11-17): required, 3–100 characters
 * after trimming, letters (any Unicode) with spaces, hyphens and
 * apostrophes — the same character rule as personName, but numbers-only
 * names are rejected explicitly and the messages match the token task.
 * personName (max 120) stays untouched for registration forms.
 */
export const tokenApplicantNameSchema = z
  .string('Applicant name is required.')
  .transform((value) => value.trim())
  .pipe(
    z.string().superRefine((name, ctx) => {
      if (name.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'Applicant name is required.' });
        return;
      }
      if (name.length < 3) {
        ctx.addIssue({
          code: 'custom',
          message: 'Applicant name must contain at least 3 characters.',
        });
        return;
      }
      if (name.length > 100) {
        ctx.addIssue({
          code: 'custom',
          message: 'Applicant name must be 100 characters or fewer.',
        });
        return;
      }
      if (!/\p{L}/u.test(name) || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u.test(name)) {
        ctx.addIssue({ code: 'custom', message: 'Please enter a valid applicant name.' });
      }
    }),
  );

export const issueApplicantTokenSchema = z.object({
  branchId: z.uuid('Choose a branch'),
  cnic: tokenCnicSchema,
  applicantName: tokenApplicantNameSchema,
  phone: tokenPkMobileSchema,
});
export type IssueApplicantTokenInput = z.infer<typeof issueApplicantTokenSchema>;

/** "KHI-GULSHAN" + 7 → "KHI-GULSHAN-007". The number resets each branch-day. */
export function tokenCodeFor(branchCode: string, tokenNumber: number): string {
  return `${branchCode}-${String(tokenNumber).padStart(3, '0')}`;
}

/**
 * Split a token code back into its branch code and daily number. Branch codes
 * contain dashes ("KHI-GULSHAN"), so the split is at the LAST dash; the suffix
 * must be all digits.
 */
export function parseTokenCode(code: string): { branchCode: string; tokenNumber: number } | null {
  const at = code.lastIndexOf('-');
  if (at <= 0) return null;
  const branchCode = code.slice(0, at);
  const suffix = code.slice(at + 1);
  if (!/^\d+$/.test(suffix)) return null;
  return { branchCode, tokenNumber: Number(suffix) };
}

/** Calendar date (YYYY-MM-DD) in Pakistan time — token numbers reset on this day. */
export function karachiDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * The instant a token issued at `issuedAt` expires: midnight Pakistan time
 * at the start of the next calendar day. A token issued any time on
 * 20/11/2026 expires as the date changes to 21/11/2026, not 24 hours later.
 */
export function tokenExpiresAt(issuedAt: Date = new Date()): Date {
  return karachiDayEnd(issuedAt);
}

/**
 * End of the Pakistan day containing `date`, as an instant: midnight at the
 * start of the next Pakistan day. Token numbers reset on this boundary, and
 * a token issued on this day expires at this instant (`tokenExpiresAt`).
 * Stored on the row as `expires_at` (migration 0035); existing rows are not
 * rewritten when the rule changes.
 */
export function karachiDayEnd(date: Date = new Date()): Date {
  const day = karachiDay(date);
  const end = new Date(`${day}T00:00:00.000+05:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

/** Response contract for the token-issue route (mirrors ApplicantTokenView). */
export const applicantTokenSchema = z.object({
  id: z.string(),
  tokenNumber: z.number().int().positive(),
  tokenCode: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  branchName: z.string(),
  cnic: z.string(),
  applicantName: z.string(),
  phone: z.string(),
  issuedAt: z.string(),
  /** Midnight Pakistan time at the end of the issue day. */
  expiresAt: z.string(),
  /** True once `expiresAt` has passed (derived server-side, so lookups show it). */
  expired: z.boolean(),
  status: z.enum(APPLICANT_TOKEN_STATUSES),
  applicantId: z.string().nullable(),
  /**
   * Applicant ID reserved when the token was issued (8-character
   * registration reference). Null on tokens issued before that ID existed;
   * the slip then shows the token code.
   */
  registrationReference: z.string().nullable(),
  /**
   * Token codes cancelled when this token was issued (a previous live token
   * for the same CNIC + branch, superseded by this visit — 2026-11-17
   * fresh-number-per-visit rule). Only set on a freshly issued token.
   */
  supersededTokenCodes: z.array(z.string()).optional(),
});
export type ApplicantTokenView = z.infer<typeof applicantTokenSchema>;

/**
 * GET /api/v1/applicants/tokens — one of three lookups, all staff-scoped:
 * by token code, by CNIC + branch (+ day, default today), or the whole
 * branch-day list (branch + day, default today). `day` is a YYYY-MM-DD date.
 */
export const tokenLookupQuerySchema = z
  .object({
    tokenCode: z.string().trim().min(1).max(80).optional(),
    cnic: z.string().trim().min(1).max(20).optional(),
    branchId: z.uuid().optional(),
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-08')
      .optional(),
  })
  .refine((v) => v.tokenCode ?? (v.cnic && v.branchId) ?? v.branchId, {
    message: 'Look up by token code, or by CNIC and branch, or list a branch day',
  });
export type TokenLookupQuery = z.infer<typeof tokenLookupQuerySchema>;

/** POST /api/v1/applicants/tokens/{id}/cancel — optional reason for the audit log. */
export const cancelApplicantTokenSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type CancelApplicantTokenInput = z.infer<typeof cancelApplicantTokenSchema>;

export const assistedApplicantRegistrationSchema = z.object({
  branchId: z.uuid(),
  ...personalFields,
  gender: z.enum(ASSISTED_REGISTRATION_GENDERS, 'Choose Male or Female'),
  // Audit 2026-11-11 (M-02): same validator as the dialog path
  // (pkMobileSchema) — the old min/max length check accepted landlines
  // and short numbers the server domain then had to reject, with
  // different error text. The address keeps its line/city/area, but the
  // map pin is gone (2026-11-16): the staff form no longer collects a
  // home location, so `address.location` is null for new registrations
  // and the profile-update path preserves an existing pin instead of
  // wiping it.
  phone: pkMobileSchema,
  address: assistedAddressSchema,
  education: educationSchema.optional().default({ items: [] }),
  experience: experienceSchema.optional().default({ hasNoExperience: false, items: [] }),
  skills: skillsSchema.optional().default({ items: [] }),
  languages: languagesSchema.optional().default({ items: [] }),
  certifications: certificationsSchema.optional().default({ items: [] }),
  preferences: preferencesSchema.optional(),
});
export type AssistedApplicantRegistrationInput = z.infer<
  typeof assistedApplicantRegistrationSchema
>;

const profileRecordIdsSchema = z
  .object({
    education: z.array(z.uuid().nullable()).max(10),
    experience: z.array(z.uuid().nullable()).max(15),
    certifications: z.array(z.uuid().nullable()).max(15),
  })
  .superRefine((records, ctx) => {
    for (const [section, ids] of Object.entries(records)) {
      const present = ids.filter((id): id is string => id !== null);
      if (new Set(present).size !== present.length) {
        ctx.addIssue({
          code: 'custom',
          path: [section],
          message: 'A profile record cannot be submitted more than once',
        });
      }
    }
  });

/** Full staff profile update; sign-in phone and branch assignment are intentionally excluded. */
export const staffApplicantProfileUpdateSchema = assistedApplicantRegistrationSchema
  .omit({ branchId: true, phone: true })
  .extend({
    gender: z.enum(GENDERS, 'Choose an option'),
    address: assistedAddressSchema,
    preferences: preferencesSchema.nullable().optional(),
    recordIds: profileRecordIdsSchema,
  })
  .refine(
    (profile) =>
      profile.recordIds.education.length === profile.education.items.length &&
      profile.recordIds.experience.length === profile.experience.items.length &&
      profile.recordIds.certifications.length === profile.certifications.items.length,
    {
      path: ['recordIds'],
      message: 'Profile record identifiers must match the submitted records',
    },
  );
export type StaffApplicantProfileUpdateInput = z.infer<typeof staffApplicantProfileUpdateSchema>;
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

export const changePhoneSchema = z.object({
  phone: pkMobileSchema,
  reason,
  // Audit 2026-11-11 (M-21): the new number must prove itself — a 6-digit
  // code texted to it (requestPhoneChangeCode), consumed here. Without this
  // a staff account could move any applicant to an attacker-controlled
  // number and then sign in by phone OTP.
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code sent to the new number'),
});
/** Request the verification code for a phone change (step 1 of M-21). */
export const requestPhoneChangeCodeSchema = z.object({ phone: pkMobileSchema });
export const transferApplicantSchema = z.object({
  branchId: z.uuid('Choose a branch'),
  expectedBranchId: z.uuid('Invalid current branch').optional(),
  reason,
});

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

/** Sections that count a profile as complete (owner decision 1a). Completeness is informational now that profiles are ACTIVE from creation; it still gates REACTIVATE from INACTIVE/RESTRICTED. */
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
