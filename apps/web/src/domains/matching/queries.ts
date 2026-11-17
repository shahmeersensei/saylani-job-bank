import 'server-only';
import { schema } from '@jobbank/db';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db';
import { getRedis } from '@/lib/redis/client';

const mr = schema.matchRuns;
const jm = schema.jobMatches;
const jmf = schema.jobMatchFactors;
const mo = schema.matchOutbox;
const ap = schema.applicants;

export type MatchTrigger = 'PUBLISH' | 'RESUME' | 'PROFILE_UPDATE' | 'MANUAL';

/** Written inside the publish transaction; the Python worker picks it up. */
export async function enqueueJobMatch(
  executor: DbExecutor,
  jobId: string,
  trigger: MatchTrigger,
): Promise<void> {
  await executor
    .insert(mo)
    .values({
      eventType: 'JOB_MATCH_REQUESTED',
      dedupeKey: jobId,
      payload: { job_id: jobId, trigger },
    })
    .onConflictDoNothing();
}

export interface JobMatchFactorView {
  factor: string;
  score: number;
  weight: number;
  reason: string;
  /**
   * Audit 2026-11-11 (L-10): false when the factor defaulted to full weight
   * for lack of data ("neutral"). Old runs predate the flag — their detail
   * has no has_data key, which reads as true (cannot be judged thin).
   */
  hasData: boolean;
}

export interface JobMatchView {
  applicantId: string;
  /** Applicant display name from the applicants table (null if deleted). */
  fullName: string | null;
  score: number | null;
  reviewStatus: string;
  /** REJECTION_REASON code + note behind a REJECTED decision. */
  reviewReasonCode: string | null;
  reviewNote: string | null;
  /** Applicant's answer to a HIRED decision (ACCEPTED / DECLINED). */
  applicantResponse: string | null;
  refusalReasonCode: string | null;
  summary: string;
  factors: JobMatchFactorView[];
  /**
   * Audit 2026-11-11 (L-10): share of factors scored from real data
   * (0–1), null when the run stored no factors. thinProfile is true when
   * fewer than half the factors had real data — the score may still be high
   * (missing data is neutral), but staff should treat it as weakly evidenced.
   */
  completeness: number | null;
  thinProfile: boolean;
}

export interface MatchRunSummary {
  id: string;
  status: string;
  triggerType: string;
  criteriaVersion: number;
  scoringVersion: string;
  candidateCount: number | null;
  eligibleCount: number | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface MatchesPage {
  run: MatchRunSummary | null;
  matches: JobMatchView[];
  total: number;
}

/** Short pages are immutable per run (run_id in the key), so a fresh run's new
 * run_id misses old entries automatically; TTL only sweeps leftovers. */
const SHORTLIST_TTL_SECONDS = 60;

const shortlistCacheKey = (jobId: string, runId: string, page: number, pageSize: number) =>
  `mj:sl:v1:${jobId}:${runId}:${page}:${pageSize}`;

function reviveDates(raw: MatchesPage): MatchesPage {
  if (raw.run) {
    // JSON round-trip turned Date fields into ISO strings.
    if (raw.run.startedAt) raw.run.startedAt = new Date(raw.run.startedAt as unknown as string);
    if (raw.run.completedAt)
      raw.run.completedAt = new Date(raw.run.completedAt as unknown as string);
  }
  return raw;
}

/** Latest run's shortlist, score-sorted, with the factor breakdown per match. */
export async function getLatestJobMatches(
  executor: DbExecutor,
  jobId: string,
  opts: { page: number; pageSize: number },
): Promise<MatchesPage> {
  const [runRow] = await executor
    .select()
    .from(mr)
    .where(and(eq(mr.jobId, jobId), inArray(mr.status, ['COMPLETED', 'FAILED'])))
    .orderBy(desc(mr.createdAt))
    .limit(1);
  if (!runRow) return { run: null, matches: [], total: 0 };

  const redis = getRedis();
  const cacheKey = shortlistCacheKey(jobId, runRow.id, opts.page, opts.pageSize);
  if (redis) {
    try {
      const hit = await redis.get(cacheKey);
      if (hit) return reviveDates(JSON.parse(hit) as MatchesPage);
    } catch {
      // cache trouble must never break the shortlist view — fall through to DB
    }
  }

  const page = await finishPage(executor, runRow, opts);

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(page), 'EX', SHORTLIST_TTL_SECONDS);
    } catch {
      // best-effort write; next request just hits the DB again
    }
  }
  return page;
}

async function finishPage(
  executor: DbExecutor,
  runRow: typeof mr.$inferSelect,
  opts: { page: number; pageSize: number },
): Promise<MatchesPage> {
  const totalRow = await executor
    .select({ total: count() })
    .from(jm)
    .where(eq(jm.runId, runRow.id));
  const total = totalRow[0]?.total ?? 0;

  const rows = await executor
    .select({ match: jm, fullName: ap.fullName })
    .from(jm)
    .leftJoin(ap, eq(ap.id, jm.applicantId))
    .where(eq(jm.runId, runRow.id))
    .orderBy(desc(jm.score))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);

  const factors = rows.length
    ? await executor
        .select()
        .from(jmf)
        .where(
          inArray(
            jmf.jobMatchId,
            rows.map((r) => r.match.id),
          ),
        )
    : [];

  return {
    run: {
      id: runRow.id,
      status: runRow.status,
      triggerType: runRow.triggerType,
      criteriaVersion: runRow.criteriaVersion,
      scoringVersion: runRow.scoringVersion,
      candidateCount: runRow.candidateCount,
      eligibleCount: runRow.eligibleCount,
      error: runRow.error,
      startedAt: runRow.startedAt,
      completedAt: runRow.completedAt,
    },
    matches: rows.map(({ match: r, fullName }) => {
      const matchFactors = factors
        .filter((f) => f.jobMatchId === r.id)
        .map((f) => ({
          factor: f.factor,
          score: Number(f.score),
          weight: Number(f.weight),
          reason: f.reason,
          // Old runs predate the flag: a missing key reads as "had data".
          hasData: (f.detail as { has_data?: unknown } | null)?.has_data !== false,
        }));
      // Audit 2026-11-11 (L-10): completeness is the share of factors with
      // real data; thin when fewer than half had any. No factors (old or
      // empty runs) → null / false, never thin by default.
      const completeness =
        matchFactors.length > 0
          ? Math.round((matchFactors.filter((f) => f.hasData).length / matchFactors.length) * 100) /
            100
          : null;
      return {
        applicantId: r.applicantId,
        fullName,
        score: r.score,
        reviewStatus: r.reviewStatus,
        reviewReasonCode: r.reviewReasonCode,
        reviewNote: r.reviewNote,
        applicantResponse: r.applicantResponse,
        refusalReasonCode: r.refusalReasonCode,
        summary: r.summary,
        factors: matchFactors,
        completeness,
        thinProfile: completeness !== null && completeness < 0.5,
      };
    }),
    total,
  };
}

/** Best-effort drop of every cached shortlist page for a job (after review edits). */
export async function invalidateShortlistCache(jobId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `mj:sl:v1:${jobId}:*`, 'COUNT', 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    // cache trouble must never fail the write path; TTL (60s) bounds staleness
  }
}
