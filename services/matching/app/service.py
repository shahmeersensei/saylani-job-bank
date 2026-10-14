"""Orchestration: one job → eligibility gate → scored shortlist → persistence."""

from __future__ import annotations

import logging

from psycopg_pool import AsyncConnectionPool

from .cache import get_profile_cache
from .config import get_settings
from .eligibility import check_eligibility
from .embeddings import SkillSimilarity, ensure_profile_fit, job_fit_text
from .repository import (
    DuplicateActiveRun,
    JobNotMatchable,
    create_run,
    load_candidate_pool,
    load_full_profiles,
    load_job_criteria,
    mark_run_failed,
    save_run_result,
)
from .scoring import score_candidate, sort_matches
from .types import CRITERIA_VERSION, SCORING_VERSION, MatchResult, MatchRunReport
from .weights import DEFAULT_WEIGHTS

log = logging.getLogger("matching.service")


async def run_job_match(pool: AsyncConnectionPool, job_id: str, trigger: str) -> MatchRunReport:
    """Run the full pipeline for one job. Idempotent per job while a run is active."""
    async with pool.connection() as conn:
        async with conn.transaction():
            run_id = await create_run(conn, job_id, trigger)

        try:
            async with conn.transaction():
                job = await load_job_criteria(conn, job_id)
                pool_rows = await load_candidate_pool(conn, job_id, job.max_radius_m)

            # Version-keyed Redis cache: unchanged profiles skip all detail
            # queries; misses fall back to Postgres and repopulate the cache.
            cache = get_profile_cache()
            versions = {str(r["applicant_id"]): r["profile_version"] for r in pool_rows}
            profiles_by_id, missing = await cache.get_many(versions)
            if missing:
                async with conn.transaction():
                    fetched = await load_full_profiles(conn, missing)
                profiles_by_id.update(fetched)
                await cache.set_many(fetched, versions)

            profiles = []
            for row in pool_rows:
                profile = profiles_by_id.get(str(row["applicant_id"]))
                if profile is None:
                    continue
                distance = row["distance_m"]
                profiles.append(
                    profile.model_copy(
                        update={"distance_m": float(distance) if distance is not None else None}
                    )
                )

            # Phase 3: skill embeddings enable semantic (fuzzy) skill credit.
            # v3: profile↔job text similarity powers the text_fit factor.
            semantic = None
            fit = None
            if get_settings().semantic_enabled and profiles:
                skill_codes: set[str] = {s.skill_code for s in job.required_skills} | {
                    s.skill_code for s in job.preferred_skills
                }
                for profile in profiles:
                    skill_codes.update(s.skill_code for s in profile.skills)
                async with conn.transaction():
                    skillsim = await SkillSimilarity.load(conn, skill_codes)
                    fit_result = await ensure_profile_fit(
                        conn,
                        job_id,
                        job_fit_text(job.title, job.category_code, job.description),
                        profiles,
                    )
                if skillsim.available:
                    semantic = skillsim.similarity
                if fit_result.available:
                    fit = fit_result.similarity

            matches: list[MatchResult] = []
            for profile in profiles:
                eligibility = check_eligibility(job, profile, semantic)
                if not eligibility.eligible:
                    continue  # fail reasons stay out of the employer shortlist
                matches.append(score_candidate(job, profile, DEFAULT_WEIGHTS, semantic, fit))
            matches = sort_matches(matches)

            async with conn.transaction():
                await save_run_result(conn, run_id, job_id, matches, len(profiles))

            log.info(
                "match run %s for job %s: %d candidates, %d eligible",
                run_id,
                job_id,
                len(profiles),
                len(matches),
            )
            return MatchRunReport(
                job_id=job_id,
                run_id=run_id,
                status="COMPLETED",
                candidate_count=len(profiles),
                eligible_count=len(matches),
                matches=matches,
            )

        except JobNotMatchable as exc:
            # Permanent for this attempt: record it, never return an empty
            # shortlist as if it were a real result.
            async with conn.transaction():
                await mark_run_failed(conn, run_id, str(exc))
            log.warning("job %s not matchable: %s", job_id, exc)
            return MatchRunReport(
                job_id=job_id,
                run_id=run_id,
                status="FAILED",
                error=str(exc),
            )
        except Exception as exc:
            async with conn.transaction():
                await mark_run_failed(conn, run_id, f"{type(exc).__name__}: {exc}")
            raise


__all__ = [
    "run_job_match",
    "JobNotMatchable",
    "DuplicateActiveRun",
    "CRITERIA_VERSION",
    "SCORING_VERSION",
]
