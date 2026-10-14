"""End-to-end smoke test against the dev database.

Activates three seeded applicants, places them ~0 km / ~4.8 km / ~9.5 km from a
new OPEN job (SALES required), runs the real pipeline (PostGIS pool ->
eligibility -> scoring -> persistence) and prints the shortlist. Everything is
restored/cleaned up afterwards.

Usage:  .venv/Scripts/python.exe scripts/smoke.py
"""

import asyncio
import json
import selectors
import uuid

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.config import get_settings
from app.repository import read_latest_matches
from app.service import run_job_match

# ~0.045 deg of longitude is roughly 4.5 km at Karachi's latitude.
OFFSET_DEG = [0.0, 0.05, 0.094]


async def main() -> None:
    settings = get_settings()
    tag = uuid.uuid4().hex[:8]
    touched: list[str] = []
    saved_status: dict[str, str] = {}
    saved_points: dict[str, tuple[float, float]] = {}
    company_id: str | None = None
    job_id = str(uuid.uuid4())

    async with await AsyncConnection.connect(settings.database_url) as conn:
        await conn.execute("BEGIN")
        try:
            cur = await conn.execute(
                """
                SELECT a.id, ST_X(aa.location::geometry) AS lng, ST_Y(aa.location::geometry) AS lat,
                       aa.address_line, aa.city_code
                FROM applicants a
                JOIN applicant_addresses aa ON aa.applicant_id = a.id
                ORDER BY a.created_at LIMIT 3
                """
            )
            applicants = await cur.fetchall()
            assert len(applicants) == 3, "need 3 seeded applicants with addresses"
            base_lng, base_lat = float(applicants[0][1]), float(applicants[0][2])

            for i, (aid, lng, lat, _address_line, _city_code) in enumerate(applicants):
                aid = str(aid)
                saved_points[aid] = (float(lng), float(lat))
                cur = await conn.execute("SELECT status FROM applicants WHERE id = %s", (aid,))
                saved_status[aid] = (await cur.fetchone())[0]

                # Pins at ~0 / ~4.8 / ~9.5 km east of the JOB SITE (applicant #1's pin).
                await conn.execute(
                    """
                    UPDATE applicant_addresses
                    SET location = ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                    WHERE applicant_id = %s
                    """,
                    (base_lng + OFFSET_DEG[i], base_lat, aid),
                )
                await conn.execute(
                    """
                    UPDATE applicants SET status = 'ACTIVE',
                       branch_id = (SELECT id FROM branches ORDER BY created_at LIMIT 1),
                       identity_status = 'VERIFIED', has_no_experience = false
                    WHERE id = %s
                    """,
                    (aid,),
                )
                await conn.execute("DELETE FROM applicant_skills WHERE applicant_id = %s", (aid,))
                await conn.execute(
                    "INSERT INTO applicant_skills (applicant_id, skill_code, level, years) "
                    "VALUES (%s, 'SALES', %s, %s)",
                    (aid, ["INTERMEDIATE", "BEGINNER", "EXPERT"][i], [3, 1, 5][i]),
                )
                if i == 2:
                    await conn.execute(
                        "INSERT INTO applicant_skills (applicant_id, skill_code, level, years) "
                        "VALUES (%s, 'CUSTOMER_SERVICE', 'INTERMEDIATE', 2)",
                        (aid,),
                    )
                # Work experience so the experience gate has real months to count.
                await conn.execute(
                    "DELETE FROM applicant_experience WHERE applicant_id = %s", (aid,)
                )
                await conn.execute(
                    """
                    INSERT INTO applicant_experience
                      (applicant_id, employer_name, job_title, start_month, end_month, is_current)
                    VALUES (%s, 'Previous Shop', 'Salesman', DATE '2021-06-01',
                            CASE WHEN %s = 0 THEN NULL ELSE DATE '2024-01-01' END, %s = 0)
                    """,
                    (aid, i, i),
                )
                await conn.execute(
                    "DELETE FROM applicant_preferences WHERE applicant_id = %s", (aid,)
                )
                await conn.execute(
                    """
                    INSERT INTO applicant_preferences
                      (applicant_id, min_salary_pkr, shifts, job_types,
                       category_codes, willing_radius_m)
                    VALUES (%s, %s, '{DAY}', '{FULL_TIME}', '{CALL_CENTRE}', 10000)
                    """,
                    (aid, [35_000, 45_000, 30_000][i]),
                )
                touched.append(aid)

            user_id = (
                await (
                    await conn.execute("SELECT id FROM users ORDER BY created_at LIMIT 1")
                ).fetchone()
            )[0]
            branch_id = (
                await (
                    await conn.execute("SELECT id FROM branches ORDER BY created_at LIMIT 1")
                ).fetchone()
            )[0]

            company_id = str(uuid.uuid4())
            await conn.execute(
                """
                INSERT INTO companies (id, branch_id, legal_name, legal_structure, ntn,
                                       industry_code, size_band, status, created_by, verified_at)
                VALUES (%s, %s, %s, 'PRIVATE_LIMITED', %s, 'RETAIL', '1_10', 'VERIFIED', %s, now())
                """,
                (
                    company_id,
                    branch_id,
                    f"Smoke Traders {tag}",
                    f"{int(tag[:6], 16) % 10**7:07d}",
                    user_id,
                ),
            )

            await conn.execute(
                """
                INSERT INTO jobs (id, company_id, branch_id, title, category_code, description,
                                  job_type, shift, vacancies, salary_min, salary_max, status,
                                  published_at, created_by)
                VALUES (%s, %s, %s, 'Sales Associate', 'CALL_CENTRE',
                        'Shop sales and customer handling', 'FULL_TIME', 'DAY', 2, 30000, 50000,
                        'OPEN', now(), %s)
                """,
                (job_id, company_id, branch_id, user_id),
            )
            await conn.execute(
                """
                INSERT INTO job_locations (job_id, address_line, city_code, location)
                SELECT %s, %s, %s, location FROM applicant_addresses
                WHERE applicant_id = %s
                """,
                (job_id, applicants[0][3], applicants[0][4], applicants[0][0]),
            )
            await conn.execute(
                "INSERT INTO job_skills (job_id, skill_code, required, min_level) "
                "VALUES (%s, 'SALES', true, 'BEGINNER')",
                (job_id,),
            )
            await conn.execute(
                "INSERT INTO job_requirements (job_id, min_experience_years) VALUES (%s, 1)",
                (job_id,),
            )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise

        pool = AsyncConnectionPool(conninfo=settings.database_url, open=False)
        await pool.open()
        try:
            import time

            t0 = time.perf_counter()
            report = await run_job_match(pool, job_id, "MANUAL")
            cold_ms = (time.perf_counter() - t0) * 1000
            print(
                f"\n=== Match run: {report.status} | candidates={report.candidate_count} "
                f"eligible={report.eligible_count} | cold {cold_ms:.0f}ms ==="
            )

            # Simulate an employer rejection; the warm re-run must carry it over.
            async with pool.connection() as c1:
                await c1.execute(
                    """
                    UPDATE job_matches
                    SET review_status = 'REJECTED', review_reason_code = 'SKILLS_MISMATCH',
                        review_note = 'smoke carry-forward check', reviewed_at = now()
                    WHERE job_id = %s
                    """,
                    (job_id,),
                )

            # Second run should hit the Redis profile cache for all candidates.
            from redis.asyncio import Redis

            redis = Redis.from_url(settings.redis_url, decode_responses=True)
            try:
                cached_keys = await redis.keys("mj:ap:v1:*")
            finally:
                await redis.aclose()
            t0 = time.perf_counter()
            report2 = await run_job_match(pool, job_id, "MANUAL")
            warm_ms = (time.perf_counter() - t0) * 1000
            print(
                f"=== Warm run: {report2.status} | candidates={report2.candidate_count} "
                f"eligible={report2.eligible_count} | warm {warm_ms:.0f}ms "
                f"| cached profiles: {len(cached_keys)} ==="
            )

            if report.error:
                print(f"ERROR: {report.error}")

            # v3: every scored match carries the text_fit factor (neutral or real).
            assert report.matches, "expected a non-empty shortlist"
            for m in report.matches:
                names = {f.factor for f in m.factors}
                assert "text_fit" in names, f"text_fit missing from {names}"
                tf = next(f for f in m.factors if f.factor == "text_fit")
                assert 0 <= tf.score <= tf.weight
            print(f"=== text_fit factor present on {len(report.matches)} matches ===")

            async with pool.connection() as c2:
                page = await read_latest_matches(c2, job_id, limit=10)
            print(json.dumps(page, indent=2, default=str))

            async with pool.connection() as c4:
                async with c4.cursor() as cur4:
                    await cur4.execute(
                        "SELECT review_status, review_reason_code FROM job_matches "
                        "WHERE job_id = %s",
                        (job_id,),
                    )
                    carried = await cur4.fetchall()
            assert carried and all(
                r[0] == "REJECTED" and r[1] == "SKILLS_MISMATCH" for r in carried
            ), f"decisions did not carry forward: {carried}"
            print("\n=== Carry-forward OK: employer decisions survived the re-run ===")
        finally:
            await pool.close()

        async with await AsyncConnection.connect(settings.database_url) as c3:
            await c3.execute("BEGIN")
            await c3.execute("DELETE FROM match_outbox WHERE payload->>'job_id' = %s", (job_id,))
            await c3.execute("DELETE FROM jobs WHERE id = %s", (job_id,))
            if company_id:
                await c3.execute("DELETE FROM companies WHERE id = %s", (company_id,))
            for aid in touched:
                await c3.execute("DELETE FROM applicant_skills WHERE applicant_id = %s", (aid,))
                await c3.execute("DELETE FROM applicant_experience WHERE applicant_id = %s", (aid,))
                await c3.execute(
                    "DELETE FROM applicant_preferences WHERE applicant_id = %s", (aid,)
                )
                lng, lat = saved_points[aid]
                await c3.execute(
                    """
                    UPDATE applicant_addresses
                    SET location = ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                    WHERE applicant_id = %s
                    """,
                    (lng, lat, aid),
                )
                await c3.execute(
                    "UPDATE applicants SET status = %s WHERE id = %s", (saved_status[aid], aid)
                )
            await c3.execute("COMMIT")
        print("\ncleanup done")


if __name__ == "__main__":
    # psycopg async on Windows needs the selector event loop (not Proactor).
    asyncio.run(
        main(),
        loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()),
    )
