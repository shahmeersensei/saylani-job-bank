"""Backfill the pgvector `embeddings` table (Phase 3).

Embeds skills (master_data), applicant profiles and jobs with the local
sentence-transformers model. Idempotent — upserts on (entity_type, entity_id,
model), so run it again after profile/job edits or model upgrades.

Usage:
  .venv/Scripts/python.exe scripts/backfill_embeddings.py
  .venv/Scripts/python.exe scripts/backfill_embeddings.py --only skills
  .venv/Scripts/python.exe scripts/backfill_embeddings.py --only applicants --limit 50
"""

from __future__ import annotations

import argparse
import asyncio
import selectors
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from psycopg import AsyncConnection

from app.config import get_settings
from app.embeddings import embed_texts, skill_entity_id

BATCH = 64

UPSERT = """
INSERT INTO embeddings (entity_type, entity_id, model, content, embedding)
VALUES (%s, %s, %s, %s, %s::vector)
ON CONFLICT (entity_type, entity_id, model)
DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, updated_at = now()
"""


def _to_pg_vector(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


async def upsert_rows(conn: AsyncConnection, model: str, rows: list[tuple[str, Any, str]]) -> None:
    """rows: (entity_type, entity_uuid, content) — encoded in batches."""
    for start in range(0, len(rows), BATCH):
        chunk = rows[start : start + BATCH]
        vectors = await asyncio.to_thread(embed_texts, [content for _, _, content in chunk])
        async with conn.cursor() as cur:
            await cur.executemany(
                UPSERT,
                [
                    (entity_type, str(entity_id), model, content, _to_pg_vector(vec))
                    for (entity_type, entity_id, content), vec in zip(chunk, vectors, strict=True)
                ],
            )
        print(f"  … {min(start + BATCH, len(rows))}/{len(rows)}", flush=True)


async def backfill_skills(conn: AsyncConnection, model: str) -> int:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT code, label, description FROM master_data "
            "WHERE type = 'SKILL' AND is_active ORDER BY code"
        )
        rows = await cur.fetchall()
    payload = [
        ("SKILL", skill_entity_id(code), f"{label} ({code}). {description or ''}".strip())
        for code, label, description in rows
    ]
    await upsert_rows(conn, model, payload)
    return len(payload)


APPLICANT_TEXT_SQL = """
SELECT a.id,
       COALESCE((
         SELECT string_agg(DISTINCT md.label, ', ')
         FROM applicant_skills s
         JOIN master_data md ON md.type = 'SKILL' AND md.code = s.skill_code
         WHERE s.applicant_id = a.id
       ), 'none') AS skills,
       COALESCE((
         SELECT md.label FROM applicant_education e
         JOIN master_data md ON md.type = 'EDUCATION_LEVEL' AND md.code = e.level_code
         WHERE e.applicant_id = a.id
         ORDER BY (md.meta->>'rank')::int DESC LIMIT 1
       ), 'not recorded') AS education,
       COALESCE((
         SELECT string_agg(DISTINCT l.language_code, ', ')
         FROM applicant_languages l WHERE l.applicant_id = a.id
       ), 'none') AS languages,
       COALESCE((
         SELECT SUM(
           EXTRACT(YEAR FROM AGE(COALESCE(end_month, CURRENT_DATE), start_month)) * 12
           + EXTRACT(MONTH FROM AGE(COALESCE(end_month, CURRENT_DATE), start_month))
         ) FROM applicant_experience x WHERE x.applicant_id = a.id
       ), 0) AS months
FROM applicants a
"""


async def backfill_applicants(conn: AsyncConnection, model: str, limit: int | None) -> int:
    sql = APPLICANT_TEXT_SQL + (" LIMIT %s" if limit else "")
    async with conn.cursor() as cur:
        await cur.execute(sql, (limit,) if limit else ())
        rows = await cur.fetchall()
    payload = [
        (
            "APPLICANT",
            applicant_id,
            f"Skills: {skills}. Education: {education}. Languages: {languages}. "
            f"Experience: {months / 12:.1f} years.",
        )
        for applicant_id, skills, education, languages, months in rows
    ]
    await upsert_rows(conn, model, payload)
    return len(payload)


async def backfill_jobs(conn: AsyncConnection, model: str) -> int:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id, title, category_code, description FROM jobs "
            "WHERE status IN ('OPEN', 'PAUSED', 'FILLED', 'CLOSED') ORDER BY created_at"
        )
        rows = await cur.fetchall()
    payload = [
        (
            "JOB",
            job_id,
            f"{title}. Category: {category_code}. {description or ''}".strip(),
        )
        for job_id, title, category_code, description in rows
    ]
    await upsert_rows(conn, model, payload)
    return len(payload)


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--only", choices=["all", "skills", "applicants", "jobs"], default="all"
    )
    parser.add_argument("--limit", type=int, default=None, help="cap applicant rows")
    args = parser.parse_args()

    settings = get_settings()
    model = settings.embedding_model
    print(f"model: {model} (loading on first embed…)")
    t0 = time.perf_counter()

    async with await AsyncConnection.connect(settings.database_url) as conn:
        await conn.execute("BEGIN")
        try:
            if args.only in ("all", "skills"):
                n = await backfill_skills(conn, model)
                print(f"skills: {n} embedded")
            if args.only in ("all", "applicants"):
                n = await backfill_applicants(conn, model, args.limit)
                print(f"applicants: {n} embedded")
            if args.only in ("all", "jobs"):
                n = await backfill_jobs(conn, model)
                print(f"jobs: {n} embedded")
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise

    print(f"done in {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    asyncio.run(
        main(),
        loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()),
    )
