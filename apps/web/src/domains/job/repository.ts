import 'server-only';
import { schema } from '@jobbank/db';
import type { GenderPreference, JobStatus, JobType, ShiftType, SkillLevel } from '@jobbank/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { NotFoundError } from '@/domains/shared/errors';
import { db, type DbExecutor } from '@/lib/db';

export const j = schema.jobs;
export const jl = schema.jobLocations;
export const jr = schema.jobRequirements;
export const js = schema.jobSkills;

export type JobRow = typeof j.$inferSelect;
export type JobLocationRow = typeof jl.$inferSelect;
export type JobRequirementsRow = typeof jr.$inferSelect;
export type JobSkillRow = typeof js.$inferSelect;

// ─── Views ──────────────────────────────────────────────────────────────

export interface JobLocationView {
  id: string;
  companyLocationId: string | null;
  addressLine: string;
  cityCode: string;
}

export interface JobRequirementsView {
  educationLevelCode: string | null;
  minExperienceYears: number | null;
  languageCodes: string[];
  otherRequirements: string | null;
}

export interface JobSkillView {
  skillCode: string;
  required: boolean;
  minLevel: SkillLevel;
}

export interface JobView {
  id: string;
  companyId: string;
  branchId: string;
  title: string;
  categoryCode: string;
  description: string;
  jobType: JobType;
  shift: ShiftType;
  genderPreference: GenderPreference;
  vacancies: number;
  vacanciesFilled: number;
  salaryMin: number | null;
  salaryMax: number | null;
  status: JobStatus;
  closesAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  locations: JobLocationView[];
  requirements: JobRequirementsView | null;
  skills: JobSkillView[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Loading ────────────────────────────────────────────────────────────

export async function loadJob(
  executor: DbExecutor,
  jobId: string,
  options: { forUpdate?: boolean } = {},
): Promise<JobRow> {
  const query = executor.select().from(j).where(eq(j.id, jobId));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Job', jobId);
  return row;
}

export async function buildJobView(executor: DbExecutor, row: JobRow): Promise<JobView> {
  const [locations, [reqs], skills] = await Promise.all([
    executor.select().from(jl).where(eq(jl.jobId, row.id)).orderBy(asc(jl.createdAt)),
    executor.select().from(jr).where(eq(jr.jobId, row.id)),
    executor.select().from(js).where(eq(js.jobId, row.id)).orderBy(asc(js.skillCode)),
  ]);

  return {
    id: row.id,
    companyId: row.companyId,
    branchId: row.branchId,
    title: row.title,
    categoryCode: row.categoryCode,
    description: row.description,
    jobType: row.jobType as JobType,
    shift: row.shift as ShiftType,
    genderPreference: row.genderPreference as GenderPreference,
    vacancies: row.vacancies,
    vacanciesFilled: row.vacanciesFilled,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    status: row.status as JobStatus,
    closesAt: row.closesAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    locations: locations.map((l) => ({
      id: l.id,
      companyLocationId: l.companyLocationId,
      addressLine: l.addressLine,
      cityCode: l.cityCode,
    })),
    requirements: reqs
      ? {
          educationLevelCode: reqs.educationLevelCode,
          minExperienceYears: reqs.minExperienceYears,
          languageCodes: reqs.languageCodes ?? [],
          otherRequirements: reqs.otherRequirements,
        }
      : null,
    skills: skills.map((s) => ({
      skillCode: s.skillCode,
      required: s.required,
      minLevel: s.minLevel as SkillLevel,
    })),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getJob(jobId: string): Promise<JobView> {
  const row = await loadJob(db, jobId);
  return buildJobView(db, row);
}

export async function jobsByCompany(executor: DbExecutor, companyId: string): Promise<JobRow[]> {
  return executor.select().from(j).where(eq(j.companyId, companyId)).orderBy(desc(j.createdAt));
}
