import {
  GENDER_PREFERENCES,
  JOB_STATUSES,
  JOB_TYPES,
  SHIFT_TYPES,
  SKILL_LEVELS,
} from '@jobbank/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from '../types/geography';

// ─── jobs ──────────────────────────────────────────────────────────────

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    title: text('title').notNull(),
    categoryCode: text('category_code').notNull(),
    description: text('description').notNull(),
    jobType: text('job_type', { enum: JOB_TYPES }).notNull(),
    shift: text('shift', { enum: SHIFT_TYPES }).notNull(),
    genderPreference: text('gender_preference', { enum: GENDER_PREFERENCES })
      .notNull()
      .default('ANY'),
    vacancies: smallint('vacancies').notNull(),
    vacanciesFilled: smallint('vacancies_filled').notNull().default(0),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('DRAFT'),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jobs_company_idx').on(t.companyId),
    index('jobs_branch_status_idx').on(t.branchId, t.status),
    index('jobs_category_idx').on(t.categoryCode),
    check(
      'jobs_salary_order',
      sql`salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max`,
    ),
    check('jobs_vacancies_positive', sql`vacancies > 0`),
    check('jobs_filled_lte_vacancies', sql`vacancies_filled <= vacancies`),
  ],
);

// ─── job_locations ─────────────────────────────────────────────────────

export const jobLocations = pgTable(
  'job_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').notNull(),
    /** Optionally linked to a company location. */
    companyLocationId: uuid('company_location_id'),
    addressLine: text('address_line').notNull(),
    cityCode: text('city_code').notNull(),
    location: geographyPoint('location').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('job_locations_job_idx').on(t.jobId),
    index('job_locations_gist_idx').using('gist', t.location),
  ],
);

// ─── job_requirements ──────────────────────────────────────────────────

export const jobRequirements = pgTable('job_requirements', {
  jobId: uuid('job_id').primaryKey(),
  educationLevelCode: text('education_level_code'),
  minExperienceYears: smallint('min_experience_years'),
  languageCodes: text('language_codes').array(),
  otherRequirements: text('other_requirements'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── job_skills ────────────────────────────────────────────────────────

export const jobSkills = pgTable(
  'job_skills',
  {
    jobId: uuid('job_id').notNull(),
    skillCode: text('skill_code').notNull(),
    required: boolean('required').notNull().default(true),
    minLevel: text('min_level', { enum: SKILL_LEVELS }).notNull().default('BEGINNER'),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.skillCode] }), index('job_skills_job_idx').on(t.jobId)],
);
