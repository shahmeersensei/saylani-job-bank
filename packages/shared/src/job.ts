import { z } from 'zod';
import { JOB_TYPES, SKILL_LEVELS } from './applicant';

// ─── Job status ─────────────────────────────────────────────────────────

export const JOB_STATUSES = ['DRAFT', 'OPEN', 'PAUSED', 'FILLED', 'CLOSED', 'EXPIRED'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: 'Draft',
  OPEN: 'Open',
  PAUSED: 'Paused',
  FILLED: 'Filled',
  CLOSED: 'Closed',
  EXPIRED: 'Expired',
};

export const OPEN_JOB_STATUSES = ['OPEN'] as const satisfies readonly JobStatus[];

// ─── Job type / shift ───────────────────────────────────────────────────

// JOB_TYPES / JobType / JOB_TYPE_LABELS already exported from applicant.ts

export const SHIFT_TYPES = ['DAY', 'NIGHT', 'ROTATING', 'FLEXIBLE'] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];
export const SHIFT_TYPE_LABELS: Record<ShiftType, string> = {
  DAY: 'Day shift',
  NIGHT: 'Night shift',
  ROTATING: 'Rotating',
  FLEXIBLE: 'Flexible',
};

export const GENDER_PREFERENCES = ['ANY', 'MALE', 'FEMALE'] as const;
export type GenderPreference = (typeof GENDER_PREFERENCES)[number];
export const GENDER_PREFERENCE_LABELS: Record<GenderPreference, string> = {
  ANY: 'Open to all',
  MALE: 'Male only',
  FEMALE: 'Female only',
};

// SKILL_LEVELS / SkillLevel / SKILL_LEVEL_LABELS already exported from applicant.ts

// ─── Schemas ────────────────────────────────────────────────────────────

const optText = (max = 2000) => z.string().trim().max(max).optional();

export const createJobSchema = z.object({
  title: z.string().trim().min(3).max(200),
  categoryCode: z.string().trim().min(1).max(50),
  description: z.string().trim().min(10).max(5000),
  jobType: z.enum(JOB_TYPES),
  shift: z.enum(SHIFT_TYPES),
  genderPreference: z.enum(GENDER_PREFERENCES).default('ANY'),
  vacancies: z.number().int().min(1).max(9999),
  salaryMin: z.number().int().min(0).optional(),
  salaryMax: z.number().int().min(0).optional(),
  closesAt: z.string().datetime().optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

export const updateJobSchema = createJobSchema.partial();
export type UpdateJobInput = z.infer<typeof updateJobSchema>;

export const jobStatusSchema = z.object({
  status: z.enum(['OPEN', 'PAUSED', 'CLOSED']),
  note: z.string().trim().max(500).optional(),
});
export type JobStatusInput = z.infer<typeof jobStatusSchema>;

export const jobLocationSchema = z.object({
  companyLocationId: z.uuid().optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  addressLine: z.string().trim().min(3).max(300).optional(),
  cityCode: z.string().trim().min(1).max(50).optional(),
});
export type JobLocationInput = z.infer<typeof jobLocationSchema>;

export const jobRequirementsSchema = z.object({
  educationLevelCode: z.string().trim().max(50).optional(),
  minExperienceYears: z.number().int().min(0).max(50).optional(),
  languageCodes: z.array(z.string().trim().min(1)).max(10).optional(),
  otherRequirements: z.string().trim().max(1000).optional(),
});
export type JobRequirementsInput = z.infer<typeof jobRequirementsSchema>;

export const jobSkillSchema = z.object({
  skillCode: z.string().trim().min(1).max(50),
  required: z.boolean().default(true),
  minLevel: z.enum(SKILL_LEVELS).default('BEGINNER'),
});
export const jobSkillsSchema = z.object({
  skills: z.array(jobSkillSchema).max(20),
});
export type JobSkillInput = z.infer<typeof jobSkillSchema>;
export type JobSkillsInput = z.infer<typeof jobSkillsSchema>;
