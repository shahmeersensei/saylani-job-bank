import 'server-only';
import {
  type CreateJobInput,
  type JobLocationInput,
  type JobRequirementsInput,
  type JobSkillsInput,
  type JobStatusInput,
  type UpdateJobInput,
} from '@jobbank/shared';
import { and, eq, sql } from 'drizzle-orm';
import { requireOwnCompany } from '@/domains/company/repository';
import { runCommand } from '@/domains/shared/audit';
import { ForbiddenError, NotFoundError } from '@/domains/shared/errors';
import { assertPermission, type Actor } from '@/domains/shared/scope';
import { db } from '@/lib/db';
import type { RequestContext } from '@/domains/shared/audit';
import { jobMachine } from './machine';
import { buildJobView, j, jl, jr, js, loadJob, jobsByCompany, type JobView } from './repository';
import { jobEditability } from './rules';

type SignedIn = RequestContext & { actor: Actor };

// ─── Queries ────────────────────────────────────────────────────────────

export async function getMyJob(actor: Actor, jobId: string): Promise<JobView> {
  assertPermission(actor, 'job:manage_own');
  const company = await requireOwnCompany(db, actor);
  const row = await loadJob(db, jobId);
  if (row.companyId !== company.id) throw new NotFoundError('Job', jobId);
  return buildJobView(db, row);
}

export async function listMyJobs(actor: Actor): Promise<JobView[]> {
  assertPermission(actor, 'job:manage_own');
  const company = await requireOwnCompany(db, actor);
  const rows = await jobsByCompany(db, company.id);
  return Promise.all(rows.map((r) => buildJobView(db, r)));
}

// ─── Create / update ────────────────────────────────────────────────────

export async function createJob(ctx: SignedIn, input: CreateJobInput): Promise<JobView> {
  assertPermission(ctx.actor, 'job:manage_own');
  const company = await requireOwnCompany(db, ctx.actor);
  if (!company.branchId) throw new ForbiddenError('Company must have a branch before posting jobs');

  return runCommand(ctx, async ({ tx, audit }) => {
    const [row] = await tx
      .insert(j)
      .values({
        companyId: company.id,
        branchId: company.branchId!,
        title: input.title,
        categoryCode: input.categoryCode,
        description: input.description,
        jobType: input.jobType,
        shift: input.shift,
        genderPreference: input.genderPreference ?? 'ANY',
        vacancies: input.vacancies,
        salaryMin: input.salaryMin ?? null,
        salaryMax: input.salaryMax ?? null,
        status: 'DRAFT',
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        createdBy: ctx.actor.userId,
      })
      .returning();
    audit({ action: 'job.create', entityType: 'job', entityId: row!.id });
    return row!;
  }).then((row) => buildJobView(db, row));
}

export async function updateJob(
  ctx: SignedIn,
  jobId: string,
  input: UpdateJobInput,
): Promise<JobView> {
  assertPermission(ctx.actor, 'job:manage_own');
  const company = await requireOwnCompany(db, ctx.actor);
  const row = await loadJob(db, jobId);
  if (row.companyId !== company.id) throw new NotFoundError('Job', jobId);
  if (jobEditability(row.status) !== 'editable') {
    throw new ForbiddenError('Job can only be edited while in DRAFT status');
  }

  return runCommand(ctx, async ({ tx, audit }) => {
    const [updated] = await tx
      .update(j)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.categoryCode !== undefined && { categoryCode: input.categoryCode }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.jobType !== undefined && { jobType: input.jobType }),
        ...(input.shift !== undefined && { shift: input.shift }),
        ...(input.genderPreference !== undefined && { genderPreference: input.genderPreference }),
        ...(input.vacancies !== undefined && { vacancies: input.vacancies }),
        ...(input.salaryMin !== undefined && { salaryMin: input.salaryMin }),
        ...(input.salaryMax !== undefined && { salaryMax: input.salaryMax }),
        ...(input.closesAt !== undefined && {
          closesAt: input.closesAt ? new Date(input.closesAt) : null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(j.id, jobId))
      .returning();
    audit({ action: 'job.update', entityType: 'job', entityId: jobId });
    return updated!;
  }).then((row) => buildJobView(db, row));
}

export async function deleteJob(ctx: SignedIn, jobId: string): Promise<void> {
  assertPermission(ctx.actor, 'job:manage_own');
  const company = await requireOwnCompany(db, ctx.actor);
  const row = await loadJob(db, jobId);
  if (row.companyId !== company.id) throw new NotFoundError('Job', jobId);
  if (row.status !== 'DRAFT') throw new ForbiddenError('Only DRAFT jobs can be deleted');

  await runCommand(ctx, async ({ tx, audit }) => {
    await tx.delete(j).where(eq(j.id, jobId));
    audit({ action: 'job.delete', entityType: 'job', entityId: jobId });
  });
}

// ─── Status transitions ──────────────────────────────────────────────────

export async function transitionJobStatus(
  ctx: SignedIn,
  jobId: string,
  input: JobStatusInput,
): Promise<JobView> {
  assertPermission(ctx.actor, 'job:manage_own');
  const company = await requireOwnCompany(db, ctx.actor);

  return runCommand(ctx, async ({ tx, audit }) => {
    const row = await loadJob(tx, jobId, { forUpdate: true });
    if (row.companyId !== company.id) throw new NotFoundError('Job', jobId);

    const event =
      input.status === 'OPEN'
        ? row.status === 'DRAFT'
          ? 'PUBLISH'
          : 'RESUME'
        : input.status === 'PAUSED'
          ? 'PAUSE'
          : 'CLOSE';

    const check = jobMachine.check(row.status, event, {}, ctx.actor.roles);
    if (!check.ok) throw new ForbiddenError(check.message);

    const [updated] = await tx
      .update(j)
      .set({
        status: check.to,
        publishedAt: check.to === 'OPEN' && !row.publishedAt ? new Date() : row.publishedAt,
        closedAt: check.to === 'CLOSED' ? new Date() : row.closedAt,
        updatedAt: new Date(),
      })
      .where(eq(j.id, jobId))
      .returning();

    audit({
      action: `job.${event.toLowerCase()}`,
      entityType: 'job',
      entityId: jobId,
      before: { status: row.status },
      after: { status: check.to },
      reason: input.note ?? null,
    });
    return updated!;
  }).then((row) => buildJobView(db, row));
}

// ─── Sub-resource: location ──────────────────────────────────────────────

export async function setJobLocation(
  ctx: SignedIn,
  jobId: string,
  input: JobLocationInput,
): Promise<JobView> {
  assertPermission(ctx.actor, 'job:manage_own');
  const company = await requireOwnCompany(db, ctx.actor);
  const row = await loadJob(db, jobId);
  if (row.companyId !== company.id) throw new NotFoundError('Job', jobId);

  return runCommand(ctx, async ({ tx, audit }) => {
    // Replace all locations with the one provided
    await tx.delete(jl).where(eq(jl.jobId, jobId));
    if (input.addressLine && input.cityCode) {
      const lat = input.location?.lat ?? 24.8607;
      const lng = input.location?.lng ?? 67.0011;
      await tx.execute(
        sql`INSERT INTO job_locations (id, job_id, company_location_id, address_line, city_code, location)
            VALUES (gen_random_uuid(), ${jobId}, ${input.companyLocationId ?? null},
                    ${input.addressLine}, ${input.cityCode},
                    ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))`,
      );
    }
    audit({ action: 'job.set_location', entityType: 'job', entityId: jobId });
    return row;
  }).then((r) => buildJobView(db, r));
}

// ─── Sub-resource: requirements ─────────────────────────────────────────

export async function saveJobRequirements(
  ctx: SignedIn,
  jobId: string,
  input: JobRequirementsInput,
): Promise<JobView> {
  assertPermission(ctx.actor, 'job:manage_own');
  const company = await requireOwnCompany(db, ctx.actor);
  const row = await loadJob(db, jobId);
  if (row.companyId !== company.id) throw new NotFoundError('Job', jobId);

  return runCommand(ctx, async ({ tx, audit }) => {
    await tx
      .insert(jr)
      .values({
        jobId,
        educationLevelCode: input.educationLevelCode ?? null,
        minExperienceYears: input.minExperienceYears ?? null,
        languageCodes: input.languageCodes ?? null,
        otherRequirements: input.otherRequirements ?? null,
      })
      .onConflictDoUpdate({
        target: jr.jobId,
        set: {
          educationLevelCode: input.educationLevelCode ?? null,
          minExperienceYears: input.minExperienceYears ?? null,
          languageCodes: input.languageCodes ?? null,
          otherRequirements: input.otherRequirements ?? null,
          updatedAt: new Date(),
        },
      });
    audit({ action: 'job.save_requirements', entityType: 'job', entityId: jobId });
    return row;
  }).then((r) => buildJobView(db, r));
}

// ─── Sub-resource: skills ────────────────────────────────────────────────

export async function saveJobSkills(
  ctx: SignedIn,
  jobId: string,
  input: JobSkillsInput,
): Promise<JobView> {
  assertPermission(ctx.actor, 'job:manage_own');
  const company = await requireOwnCompany(db, ctx.actor);
  const row = await loadJob(db, jobId);
  if (row.companyId !== company.id) throw new NotFoundError('Job', jobId);

  return runCommand(ctx, async ({ tx, audit }) => {
    await tx.delete(js).where(eq(js.jobId, jobId));
    if (input.skills.length > 0) {
      await tx.insert(js).values(
        input.skills.map((s) => ({
          jobId,
          skillCode: s.skillCode,
          required: s.required ?? true,
          minLevel: s.minLevel ?? 'BEGINNER',
        })),
      );
    }
    audit({ action: 'job.save_skills', entityType: 'job', entityId: jobId });
    return row;
  }).then((r) => buildJobView(db, r));
}
