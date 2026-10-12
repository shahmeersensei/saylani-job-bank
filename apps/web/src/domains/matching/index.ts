'server-only';
import { schema } from '@jobbank/db';
import type { JobType, ShiftType, SkillLevel } from '@jobbank/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { ApplicantProfile } from '@/domains/applicant/repository';

// ─── Types ────────────────────────────────────────────────────────────────

export type MatchStrength = 'GREAT' | 'GOOD' | 'POSSIBLE';

export interface MatchedJob {
  jobId: string;
  title: string;
  companyName: string;
  companyId: string;
  categoryCode: string;
  jobType: JobType;
  shift: ShiftType;
  genderPreference: string;
  salaryMin: number | null;
  salaryMax: number | null;
  vacancies: number;
  vacanciesFilled: number;
  publishedAt: string | null;
  cityCode: string;
  /** 0-100 composite match score. */
  score: number;
  strength: MatchStrength;
  matchReasons: string[];
}

// ─── Internal helpers ──────────────────────────────────────────────────────

const SKILL_RANK: Record<SkillLevel, number> = { BEGINNER: 0, INTERMEDIATE: 1, EXPERT: 2 };

function strengthFrom(score: number): MatchStrength {
  if (score >= 65) return 'GREAT';
  if (score >= 35) return 'GOOD';
  return 'POSSIBLE';
}

interface JobSnap {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  categoryCode: string;
  jobType: string;
  shift: string;
  genderPreference: string;
  salaryMin: number | null;
  salaryMax: number | null;
  vacancies: number;
  vacanciesFilled: number;
  publishedAt: Date | null;
  cityCode: string;
  skills: { skillCode: string; required: boolean; minLevel: string }[];
  requirements: {
    educationLevelCode: string | null;
    minExperienceYears: number | null;
    languageCodes: string[] | null;
  } | null;
}

function scoreJob(profile: ApplicantProfile, job: JobSnap): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // ── Category preference (+30) ─────────────────────────────────────────
  const prefCats = profile.preferences?.categoryCodes ?? [];
  if (prefCats.includes(job.categoryCode)) {
    score += 30;
    reasons.push('Matches your preferred job category');
  }

  // ── Job type preference (+15) ──────────────────────────────────────────
  const prefTypes = profile.preferences?.jobTypes ?? [];
  if (prefTypes.length === 0 || prefTypes.includes(job.jobType as JobType)) {
    score += 15;
    if (prefTypes.includes(job.jobType as JobType)) {
      reasons.push('Matches your preferred employment type');
    }
  }

  // ── Shift preference (+10) ─────────────────────────────────────────────
  const prefShifts = profile.preferences?.shifts ?? [];
  if (
    job.shift === 'FLEXIBLE' ||
    prefShifts.length === 0 ||
    prefShifts.some((s) => s === job.shift)
  ) {
    score += 10;
    if (prefShifts.some((s) => s === job.shift)) {
      reasons.push('Shift timing suits your preference');
    }
  }

  // ── Salary match (+15) ────────────────────────────────────────────────
  const minWanted = profile.preferences?.minSalaryPkr ?? null;
  if (minWanted === null) {
    score += 5;
  } else if (job.salaryMax !== null && job.salaryMax >= minWanted) {
    score += 15;
    reasons.push('Salary meets your expectation');
  } else if (job.salaryMin !== null && job.salaryMin >= minWanted) {
    score += 10;
    reasons.push('Base salary meets your expectation');
  } else if (job.salaryMin === null && job.salaryMax === null) {
    score += 5; // undisclosed — neutral
  }

  // ── Skills match (+up to 20) ──────────────────────────────────────────
  const mySkillMap = new Map(profile.skills.map((s) => [s.skillCode, s.level as SkillLevel]));
  let skillHits = 0;
  let requiredMissed = 0;
  for (const js of job.skills) {
    const myLevel = mySkillMap.get(js.skillCode);
    if (myLevel) {
      const myRank = SKILL_RANK[myLevel] ?? 0;
      const reqRank = SKILL_RANK[js.minLevel as SkillLevel] ?? 0;
      if (myRank >= reqRank) {
        skillHits++;
      } else if (js.required) {
        requiredMissed++;
      }
    } else if (js.required) {
      requiredMissed++;
    }
  }
  if (skillHits > 0) {
    score += Math.min(20, skillHits * 4);
    reasons.push(
      skillHits === 1 ? 'You have 1 matching skill' : `You have ${skillHits} matching skills`,
    );
  }
  score -= requiredMissed * 5;

  // ── Language match (+5) ───────────────────────────────────────────────
  const reqLangs = job.requirements?.languageCodes ?? [];
  if (reqLangs.length > 0) {
    const myLangs = new Set(profile.languages.map((l) => l.languageCode));
    const langHits = reqLangs.filter((l) => myLangs.has(l)).length;
    if (langHits > 0) {
      score += 5;
      reasons.push('You speak a required language');
    } else {
      score -= 5;
    }
  }

  // ── Experience requirement (+10 / -5) ─────────────────────────────────
  const minExpYears = job.requirements?.minExperienceYears ?? 0;
  if (minExpYears > 0) {
    const totalMonths = profile.experience.reduce((sum, e) => {
      if (!e.startMonth) return sum;
      const start = new Date(e.startMonth + '-01');
      const end = e.endMonth ? new Date(e.endMonth + '-01') : new Date();
      return sum + Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));
    }, 0);
    const totalYears = totalMonths / 12;
    if (totalYears >= minExpYears) {
      score += 10;
      reasons.push('You meet the experience requirement');
    } else if (totalYears >= minExpYears * 0.5) {
      score += 3;
    } else if (!profile.hasNoExperience) {
      score -= 5;
    }
  } else {
    score += 5;
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Returns OPEN jobs in the same city as the applicant, ranked by match score.
 * Requires an ACTIVE profile with a saved address.
 */
export async function listMatchedJobs(profile: ApplicantProfile): Promise<MatchedJob[]> {
  const cityCode = profile.address?.cityCode;
  if (!cityCode) return [];

  const { jobs: j, jobLocations: jl, jobRequirements: jr, jobSkills: js, companies: c } = schema;

  // Step 1: get job IDs that have a location in the same city
  const locRows = await db
    .selectDistinct({ jobId: jl.jobId })
    .from(jl)
    .where(sql`upper(${jl.cityCode}) = upper(${cityCode})`);

  if (locRows.length === 0) return [];
  const cityJobIds = locRows.map((r) => r.jobId);

  // Step 2: load OPEN jobs in those IDs, joined with company name
  const jobRows = await db
    .select({
      id: j.id,
      companyId: j.companyId,
      companyName: c.legalName,
      tradeName: c.tradeName,
      title: j.title,
      categoryCode: j.categoryCode,
      jobType: j.jobType,
      shift: j.shift,
      genderPreference: j.genderPreference,
      salaryMin: j.salaryMin,
      salaryMax: j.salaryMax,
      vacancies: j.vacancies,
      vacanciesFilled: j.vacanciesFilled,
      publishedAt: j.publishedAt,
    })
    .from(j)
    .innerJoin(c, eq(c.id, j.companyId))
    .where(and(eq(j.status, 'OPEN'), inArray(j.id, cityJobIds)));

  if (jobRows.length === 0) return [];

  const jobIds = jobRows.map((r) => r.id);

  // Step 3: bulk load skills + requirements
  const [allSkills, allReqs, allLocs] = await Promise.all([
    db.select().from(js).where(inArray(js.jobId, jobIds)),
    db.select().from(jr).where(inArray(jr.jobId, jobIds)),
    db.select({ jobId: jl.jobId, cityCode: jl.cityCode }).from(jl).where(inArray(jl.jobId, jobIds)),
  ]);

  const skillsByJob = new Map<string, typeof allSkills>();
  for (const s of allSkills) {
    const arr = skillsByJob.get(s.jobId) ?? [];
    arr.push(s);
    skillsByJob.set(s.jobId, arr);
  }
  const reqByJob = new Map(allReqs.map((r) => [r.jobId, r]));
  const locByJob = new Map(allLocs.map((l) => [l.jobId, l.cityCode]));

  // Step 4: gender filter + score
  const gender = profile.personal.gender;
  const matched: MatchedJob[] = [];

  for (const row of jobRows) {
    // Hard filter: gender preference
    if (
      (row.genderPreference === 'MALE' && gender !== 'MALE') ||
      (row.genderPreference === 'FEMALE' && gender !== 'FEMALE')
    ) {
      continue;
    }

    const req = reqByJob.get(row.id) ?? null;
    const snap: JobSnap = {
      id: row.id,
      companyId: row.companyId,
      companyName: row.tradeName ?? row.companyName,
      title: row.title,
      categoryCode: row.categoryCode,
      jobType: row.jobType,
      shift: row.shift,
      genderPreference: row.genderPreference,
      salaryMin: row.salaryMin,
      salaryMax: row.salaryMax,
      vacancies: row.vacancies,
      vacanciesFilled: row.vacanciesFilled,
      publishedAt: row.publishedAt,
      cityCode: locByJob.get(row.id) ?? cityCode,
      skills: skillsByJob.get(row.id) ?? [],
      requirements: req
        ? {
            educationLevelCode: req.educationLevelCode,
            minExperienceYears: req.minExperienceYears,
            languageCodes: req.languageCodes,
          }
        : null,
    };

    const { score, reasons } = scoreJob(profile, snap);

    matched.push({
      jobId: row.id,
      title: row.title,
      companyName: snap.companyName,
      companyId: row.companyId,
      categoryCode: row.categoryCode,
      jobType: row.jobType as JobType,
      shift: row.shift as ShiftType,
      genderPreference: row.genderPreference,
      salaryMin: row.salaryMin,
      salaryMax: row.salaryMax,
      vacancies: row.vacancies,
      vacanciesFilled: row.vacanciesFilled,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      cityCode: snap.cityCode,
      score,
      strength: strengthFrom(score),
      matchReasons: reasons,
    });
  }

  // Sort: score desc, then newest first
  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });

  return matched;
}
