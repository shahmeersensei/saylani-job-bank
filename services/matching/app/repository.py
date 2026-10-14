"""Database access: PostGIS candidate pools, criteria resolution, persistence.

Uses psycopg 3 (async). All geo filters run in SQL so the GiST index does the
heavy lifting; scoring stays in Python (pure, testable).
"""

from __future__ import annotations

import time
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .types import (
    CRITERIA_VERSION,
    EDUCATION_RANKS,
    SCORING_VERSION,
    ApplicantProfile,
    ApplicantSkill,
    JobCriteria,
    JobSkill,
    MatchResult,
    SkillLevel,
)


class JobNotMatchable(Exception):
    """The job cannot produce a shortlist right now (permanent for this attempt)."""


class DuplicateActiveRun(Exception):
    """Another run is already PENDING/RUNNING for this job (outbox dedupe)."""


async def load_education_ranks(conn: AsyncConnection) -> dict[str, int]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT code, (meta->>'rank')::int AS rank
            FROM master_data WHERE type = 'EDUCATION_LEVEL' AND is_active
            """
        )
        rows = await cur.fetchall()
    return {r["code"]: r["rank"] for r in rows} or dict(EDUCATION_RANKS)


async def load_job_criteria(
    conn: AsyncConnection, job_id: str, hard_cap_m: int = 10_000
) -> JobCriteria:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT j.id, j.title, j.category_code, j.description, j.job_type, j.shift,
                   j.gender_preference, j.salary_min, j.salary_max, j.status,
                   j.closes_at, j.vacancies, j.vacancies_filled, j.branch_id,
                   c.status AS company_status,
                   EXISTS (SELECT 1 FROM job_locations jl WHERE jl.job_id = j.id) AS has_location
            FROM jobs j
            JOIN companies c ON c.id = j.company_id
            WHERE j.id = %s
            """,
            (job_id,),
        )
        job = await cur.fetchone()
        if job is None:
            raise JobNotMatchable(f"Job {job_id} not found")

        problems: list[str] = []
        if job["status"] != "OPEN":
            problems.append(f"job status is {job['status']} (must be OPEN)")
        if job["company_status"] != "VERIFIED":
            problems.append(f"company status is {job['company_status']} (must be VERIFIED)")
        if job["closes_at"] is not None and job["closes_at"].timestamp() <= time.time():
            problems.append("job has expired (closes_at in the past)")
        if job["vacancies_filled"] >= job["vacancies"]:
            problems.append("no vacancies left")
        if not job["has_location"]:
            problems.append("job has no location pin")
        if problems:
            raise JobNotMatchable("; ".join(problems))

        await cur.execute(
            "SELECT skill_code, min_level, required FROM job_skills "
            "WHERE job_id = %s ORDER BY required DESC, skill_code",
            (job_id,),
        )
        required_skills: list[JobSkill] = []
        preferred_skills: list[JobSkill] = []
        for r in await cur.fetchall():
            skill = JobSkill(skill_code=r["skill_code"], min_level=SkillLevel(r["min_level"]))
            (required_skills if r["required"] else preferred_skills).append(skill)

        await cur.execute(
            "SELECT education_level_code, min_experience_years, language_codes "
            "FROM job_requirements WHERE job_id = %s",
            (job_id,),
        )
        req = await cur.fetchone()

        # Radius: most specific policy wins (branch → category → global), capped.
        await cur.execute(
            """
            WITH picks AS (
                SELECT 'BRANCH' AS src, preferred_m, max_m
                FROM match_radius_policies WHERE branch_id = %s
                UNION ALL
                SELECT 'CATEGORY', p.preferred_m, p.max_m
                FROM match_radius_policies p
                JOIN master_data md ON md.id = p.category_id
                WHERE md.type = 'JOB_CATEGORY' AND md.code = %s
                UNION ALL
                SELECT 'GLOBAL', preferred_m, max_m
                FROM match_radius_policies WHERE scope = 'GLOBAL'
            )
            SELECT src, preferred_m, max_m FROM picks
            ORDER BY CASE src WHEN 'BRANCH' THEN 0 WHEN 'CATEGORY' THEN 1 ELSE 2 END
            LIMIT 1
            """,
            (job["branch_id"], job["category_code"]),
        )
        radius = await cur.fetchone()
        preferred_m = min(radius["preferred_m"], hard_cap_m) if radius else 8_000
        max_m = min(radius["max_m"], hard_cap_m) if radius else hard_cap_m

    ranks = await load_education_ranks(conn)
    edu_code = req["education_level_code"] if req else None

    return JobCriteria(
        job_id=str(job["id"]),
        title=job["title"],
        category_code=job["category_code"],
        description=job["description"] or "",
        job_type=job["job_type"],
        shift=job["shift"],
        gender_preference=job["gender_preference"],
        salary_min=job["salary_min"],
        salary_max=job["salary_max"],
        required_skills=required_skills,
        preferred_skills=preferred_skills,
        min_education_code=edu_code,
        min_education_rank=ranks.get(edu_code) if edu_code else None,
        min_experience_years=req["min_experience_years"] if req else None,
        required_languages=list(req["language_codes"] or []) if req else [],
        preferred_radius_m=preferred_m,
        max_radius_m=max_m,
    )


async def load_candidate_pool(
    conn: AsyncConnection, job_id: str, max_radius_m: int
) -> list[dict[str, Any]]:
    """ACTIVE applicants inside the max radius with distance + profile version.

    Only identity/distance/version here: everything else lives in the Redis
    profile cache (keyed by updated_at) or is fetched on a cache miss.
    """
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT a.id AS applicant_id,
                   ST_Distance(aa.location, jl.location) AS distance_m,
                   a.updated_at AS profile_version
            FROM applicants a
            JOIN applicant_addresses aa ON aa.applicant_id = a.id
            CROSS JOIN (SELECT location FROM job_locations WHERE job_id = %s LIMIT 1) jl
            WHERE a.status = 'ACTIVE'
              AND ST_DWithin(aa.location, jl.location, %s)
            """,
            (job_id, max_radius_m),
        )
        return list(await cur.fetchall())


async def load_full_profiles(
    conn: AsyncConnection, applicant_ids: list[str]
) -> dict[str, ApplicantProfile]:
    """Full profiles (everything except distance) for cache misses."""
    if not applicant_ids:
        return {}

    base: dict[str, dict[str, Any]] = {
        aid: {
            "gender": "UNDISCLOSED",
            "identity_status": "UNVERIFIED",
            "has_no_experience": False,
            "min_salary_pkr": None,
            "willing_radius_m": None,
            "shifts": [],
            "job_types": [],
            "category_codes": [],
            "skills": [],
            "languages": {},
            "education_code": None,
            "education_rank": 0,
            "total_experience_years": 0.0,
        }
        for aid in applicant_ids
    }

    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT a.id AS applicant_id, a.gender, a.identity_status, a.has_no_experience,
                   p.min_salary_pkr, p.willing_radius_m, p.shifts, p.job_types, p.category_codes
            FROM applicants a
            LEFT JOIN applicant_preferences p ON p.applicant_id = a.id
            WHERE a.id = ANY(%s::uuid[])
            """,
            (applicant_ids,),
        )
        for r in await cur.fetchall():
            b = base.get(str(r["applicant_id"]))
            if b is None:
                continue
            b["gender"] = r["gender"]
            b["identity_status"] = r["identity_status"]
            b["has_no_experience"] = r["has_no_experience"]
            b["min_salary_pkr"] = r["min_salary_pkr"]
            b["willing_radius_m"] = r["willing_radius_m"]
            b["shifts"] = list(r["shifts"] or [])
            b["job_types"] = list(r["job_types"] or [])
            b["category_codes"] = list(r["category_codes"] or [])

        await cur.execute(
            "SELECT applicant_id, skill_code, level, years FROM applicant_skills "
            "WHERE applicant_id = ANY(%s::uuid[])",
            (applicant_ids,),
        )
        for r in await cur.fetchall():
            base[str(r["applicant_id"])]["skills"].append(
                ApplicantSkill(
                    skill_code=r["skill_code"], level=SkillLevel(r["level"]), years=r["years"]
                )
            )

        await cur.execute(
            "SELECT applicant_id, language_code, proficiency FROM applicant_languages "
            "WHERE applicant_id = ANY(%s::uuid[])",
            (applicant_ids,),
        )
        for r in await cur.fetchall():
            base[str(r["applicant_id"])]["languages"][r["language_code"]] = r["proficiency"]

        await cur.execute(
            """
            SELECT DISTINCT ON (e.applicant_id) e.applicant_id, md.code,
                   (md.meta->>'rank')::int AS rank
            FROM applicant_education e
            JOIN master_data md ON md.code = e.level_code AND md.type = 'EDUCATION_LEVEL'
            WHERE e.applicant_id = ANY(%s::uuid[])
            ORDER BY e.applicant_id, (md.meta->>'rank')::int DESC
            """,
            (applicant_ids,),
        )
        for r in await cur.fetchall():
            b = base[str(r["applicant_id"])]
            b["education_code"] = r["code"]
            b["education_rank"] = r["rank"] or 0

        await cur.execute(
            """
            SELECT applicant_id,
                   COALESCE(SUM(
                     EXTRACT(YEAR FROM AGE(COALESCE(end_month, CURRENT_DATE), start_month)) * 12
                     + EXTRACT(MONTH FROM AGE(COALESCE(end_month, CURRENT_DATE), start_month))
                   ), 0) AS months
            FROM applicant_experience
            WHERE applicant_id = ANY(%s::uuid[])
            GROUP BY applicant_id
            """,
            (applicant_ids,),
        )
        for r in await cur.fetchall():
            base[str(r["applicant_id"])]["total_experience_years"] = round(
                float(r["months"]) / 12.0, 2
            )

    profiles: dict[str, ApplicantProfile] = {}
    for aid, fields in base.items():
        skills = fields.pop("skills")
        languages = fields.pop("languages")
        profiles[aid] = ApplicantProfile(
            applicant_id=aid,
            skills=skills,
            languages=languages,
            **fields,
        )
    return profiles


# ─── Run + shortlist persistence ─────────────────────────────────────────


async def create_run(conn: AsyncConnection, job_id: str, trigger: str) -> str:
    async with conn.cursor(row_factory=dict_row) as cur:
        try:
            await cur.execute(
                """
                INSERT INTO match_runs
                    (job_id, trigger_type, status, criteria_version, scoring_version)
                VALUES (%s, %s, 'RUNNING', %s, %s)
                RETURNING id
                """,
                (job_id, trigger, CRITERIA_VERSION, SCORING_VERSION),
            )
        except Exception as exc:  # unique active-run index → duplicate event
            if getattr(exc, "sqlstate", None) == "23505":
                await cur.execute(
                    "SELECT id FROM match_runs "
                    "WHERE job_id = %s AND status IN ('PENDING','RUNNING')",
                    (job_id,),
                )
                existing = await cur.fetchone()
                raise DuplicateActiveRun(
                    str(existing["id"]) if existing else "active run exists"
                ) from exc
            raise
        row = await cur.fetchone()
        await cur.execute(
            "UPDATE match_runs SET started_at = now() WHERE id = %s", (row["id"],)
        )
        return str(row["id"])


async def mark_run_failed(conn: AsyncConnection, run_id: str, error: str) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE match_runs SET status = 'FAILED', error = %s, completed_at = now(), "
            "updated_at = now() WHERE id = %s",
            (error[:2000], run_id),
        )


async def save_run_result(
    conn: AsyncConnection,
    run_id: str,
    job_id: str,
    matches: list[MatchResult],
    candidate_count: int,
) -> None:
    """Persist the shortlist set-based (one INSERT for matches, one per factors
    chunk); review decisions carry over from the previous completed run."""
    async with conn.cursor(row_factory=dict_row) as cur:
        if matches:
            await cur.execute(
                """
                WITH incoming AS (
                  SELECT * FROM unnest(%s::uuid[], %s::float8[], %s::float8[], %s::text[])
                    AS t(applicant_id, score, distance_m, summary)
                ), prev AS (
                  SELECT DISTINCT ON (jm.applicant_id) jm.applicant_id, jm.review_status,
                         jm.review_reason_code, jm.review_note, jm.reviewed_by, jm.reviewed_at,
                         jm.applicant_response, jm.refusal_reason_code, jm.responded_at
                  FROM job_matches jm
                  JOIN match_runs mr ON mr.id = jm.run_id
                  WHERE jm.job_id = %s AND mr.status = 'COMPLETED'
                  ORDER BY jm.applicant_id, mr.created_at DESC
                )
                INSERT INTO job_matches
                  (run_id, job_id, applicant_id, score, distance_m, review_status,
                   review_reason_code, review_note, reviewed_by, reviewed_at,
                   applicant_response, refusal_reason_code, responded_at, summary)
                SELECT %s::uuid, %s::uuid, i.applicant_id, i.score, i.distance_m,
                       COALESCE(p.review_status, 'NEW'),
                       p.review_reason_code, p.review_note, p.reviewed_by, p.reviewed_at,
                       p.applicant_response, p.refusal_reason_code, p.responded_at, i.summary
                FROM incoming i
                LEFT JOIN prev p ON p.applicant_id = i.applicant_id
                RETURNING id, applicant_id
                """,
                (
                    [m.applicant_id for m in matches],
                    [m.score for m in matches],
                    [m.distance_m for m in matches],
                    [m.summary for m in matches],
                    job_id,
                    run_id,
                    job_id,
                ),
            )
            match_id_by_applicant = {
                str(r["applicant_id"]): str(r["id"]) for r in await cur.fetchall()
            }

            factor_rows: list[tuple] = []
            for match in matches:
                jm_id = match_id_by_applicant.get(match.applicant_id)
                if jm_id is None:
                    continue
                for f in match.factors:
                    factor_rows.append(
                        (jm_id, f.factor, f.score, f.weight, f.reason, Jsonb(f.detail))
                    )
            for start in range(0, len(factor_rows), 500):
                chunk = factor_rows[start : start + 500]
                placeholders = ", ".join(["(%s, %s, %s, %s, %s, %s)"] * len(chunk))
                await cur.execute(
                    "INSERT INTO job_match_factors "
                    "(job_match_id, factor, score, weight, reason, detail) "
                    f"VALUES {placeholders} "
                    "ON CONFLICT (job_match_id, factor) DO NOTHING",
                    [value for row in chunk for value in row],
                )

        await cur.execute(
            """
            UPDATE match_runs
            SET status = 'COMPLETED', candidate_count = %s, eligible_count = %s,
                completed_at = now(), updated_at = now()
            WHERE id = %s
            """,
            (candidate_count, len(matches), run_id),
        )


async def read_latest_matches(
    conn: AsyncConnection, job_id: str, limit: int = 50, offset: int = 0
) -> dict[str, Any]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT id, status, trigger_type, criteria_version, scoring_version,
                   candidate_count, eligible_count, error, started_at, completed_at
            FROM match_runs
            WHERE job_id = %s AND status IN ('COMPLETED', 'FAILED')
            ORDER BY created_at DESC LIMIT 1
            """,
            (job_id,),
        )
        run = await cur.fetchone()
        if run is None:
            return {"run": None, "matches": [], "total": 0}

        await cur.execute(
            "SELECT count(*) AS total FROM job_matches WHERE run_id = %s", (run["id"],)
        )
        total = (await cur.fetchone())["total"]

        await cur.execute(
            """
            SELECT id, applicant_id, score, distance_m, review_status, summary, generated_at
            FROM job_matches WHERE run_id = %s
            ORDER BY score DESC NULLS LAST, distance_m ASC NULLS LAST, applicant_id ASC
            LIMIT %s OFFSET %s
            """,
            (run["id"], limit, offset),
        )
        rows = await cur.fetchall()

        matches: list[dict[str, Any]] = []
        if rows:
            await cur.execute(
                """
                SELECT job_match_id, factor, score, weight, reason, detail
                FROM job_match_factors
                WHERE job_match_id = ANY(%s::uuid[])
                """,
                ([r["id"] for r in rows],),
            )
            factors_by_match: dict[str, list[dict[str, Any]]] = {}
            for f in await cur.fetchall():
                factors_by_match.setdefault(str(f["job_match_id"]), []).append(
                    {
                        "factor": f["factor"],
                        "score": float(f["score"]),
                        "weight": float(f["weight"]),
                        "reason": f["reason"],
                        "detail": f["detail"],
                    }
                )
            for r in rows:
                matches.append(
                    {
                        "applicant_id": str(r["applicant_id"]),
                        "score": r["score"],
                        "distance_m": r["distance_m"],
                        "distance_km": round(r["distance_m"] / 1000, 1)
                        if r["distance_m"] is not None
                        else None,
                        "review_status": r["review_status"],
                        "summary": r["summary"],
                        "factors": factors_by_match.get(str(r["id"]), []),
                    }
                )

        return {
            "run": {**run, "id": str(run["id"])},
            "matches": matches,
            "total": total,
        }


# ─── Outbox ──────────────────────────────────────────────────────────────


async def claim_outbox_item(conn: AsyncConnection) -> dict[str, Any] | None:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT id, event_type, dedupe_key, payload, attempts
            FROM match_outbox
            WHERE status = 'PENDING' AND next_attempt_at <= now()
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
            """
        )
        return await cur.fetchone()


async def mark_outbox_processed(conn: AsyncConnection, outbox_id: str) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE match_outbox SET status = 'PROCESSED', processed_at = now() "
            "WHERE id = %s",
            (outbox_id,),
        )


async def mark_outbox_retry(
    conn: AsyncConnection, outbox_id: str, attempts: int, error: str, backoff_seconds: float,
    failed: bool,
) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE match_outbox
            SET attempts = %s, last_error = %s,
                next_attempt_at = now() + make_interval(secs => %s),
                status = CASE WHEN %s THEN 'FAILED' ELSE status END
            WHERE id = %s
            """,
            (attempts, error[:2000], backoff_seconds, failed, outbox_id),
        )
