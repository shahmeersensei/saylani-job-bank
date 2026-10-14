"""Phase 3: local sentence-transformers embeddings (all-MiniLM-L6-v2, 384-dim).

- `embed_texts` lazily loads the model once per process.
- `SkillSimilarity` loads skill vectors from the `embeddings` table and answers
  cosine-similarity queries so the scorer can give partial credit when a
  candidate's skill is semantically close to a required skill
  (e.g. RETAIL_SALES ≈ SALES) instead of an exact code match only.
- `ProfileFit` (scoring v3) compares the job's own text (title + category +
  description) against each applicant's profile text; `ensure_profile_fit`
  embeds whatever is missing or stale (profile/job edits) at run time, so the
  factor keeps working without a manual backfill.
- Everything degrades gracefully: no model / no rows → scoring stays exact.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from .config import get_settings
from .types import (  # noqa: F401 (re-export)
    SEMANTIC_MIN_SIMILARITY,
    SEMANTIC_PARTIAL_CREDIT,
    TEXT_FIT_FLOOR_SIMILARITY,
    TEXT_FIT_FULL_SIMILARITY,
    ApplicantProfile,
)

log = logging.getLogger("matching.embeddings")

_MODEL: Any = None


def skill_entity_id(skill_code: str) -> uuid.UUID:
    """Deterministic uuid for a skill code (embeddings.entity_id is uuid)."""
    return uuid.uuid5(uuid.NAMESPACE_URL, f"jobbank:skill:{skill_code}")


def get_model() -> Any:
    """Lazy-load the sentence-transformers model (import errors stay local)."""
    global _MODEL
    if _MODEL is None:
        from sentence_transformers import SentenceTransformer

        _MODEL = SentenceTransformer(get_settings().embedding_model)
    return _MODEL


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Normalized embeddings (cosine = plain dot product)."""
    import numpy as np

    matrix = get_model().encode(texts, normalize_embeddings=True)
    return np.asarray(matrix).tolist()


def _as_vector(value: Any) -> list[float] | None:
    """pgvector arrives as list[float] (adapter) or '[0.1,...]' text — accept both."""
    if value is None:
        return None
    if isinstance(value, str):
        value = json.loads(value)
    return [float(x) for x in value]


class SkillSimilarity:
    """Cosine table over skill embeddings, memoised per (code_a, code_b) pair."""

    def __init__(self, vectors: dict[str, list[float]]) -> None:
        self._vectors = vectors
        self._memo: dict[tuple[str, str], float] = {}

    @property
    def available(self) -> bool:
        return bool(self._vectors)

    @classmethod
    async def load(
        cls, conn: AsyncConnection, skill_codes: set[str] | list[str]
    ) -> SkillSimilarity:
        """Fetch embeddings for the given skill codes (one query, tiny result)."""
        codes = sorted({c for c in skill_codes if c})
        if not codes:
            return cls({})
        wanted = {str(skill_entity_id(c)): c for c in codes}
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT entity_id, embedding FROM embeddings
                WHERE entity_type = 'SKILL' AND model = %s
                  AND entity_id = ANY(%s::uuid[])
                """,
                (get_settings().embedding_model, list(wanted.keys())),
            )
            rows = await cur.fetchall()
        vectors: dict[str, list[float]] = {}
        for row in rows:
            code = wanted.get(str(row["entity_id"]))
            vec = _as_vector(row["embedding"])
            if code is not None and vec is not None:
                vectors[code] = vec
        if not vectors:
            log.info("no skill embeddings found (run scripts/backfill_embeddings.py)")
        return cls(vectors)

    def similarity(self, code_a: str, code_b: str) -> float:
        if code_a == code_b:
            return 1.0
        key = (code_a, code_b) if code_a < code_b else (code_b, code_a)
        cached = self._memo.get(key)
        if cached is not None:
            return cached
        va = self._vectors.get(code_a)
        vb = self._vectors.get(code_b)
        # Stored normalized → cosine is the dot product. Missing vector = no opinion.
        sim = (
            0.0
            if va is None or vb is None
            else float(sum(x * y for x, y in zip(va, vb, strict=True)))
        )
        self._memo[key] = sim
        return sim


def job_fit_text(title: str, category_code: str, description: str) -> str:
    """Text embedded for a JOB entity — mirrors scripts/backfill_embeddings.py."""
    return f"{title}. Category: {category_code}. {description or ''}".strip()


def applicant_fit_text(profile: ApplicantProfile) -> str:
    """Text embedded for an APPLICANT entity — mirrors the backfill SQL shape,
    using codes/labels already on the loaded profile (no extra queries)."""
    skills = ", ".join(sorted({s.skill_code for s in profile.skills})) or "none"
    languages = ", ".join(sorted(profile.languages)) or "none"
    education = profile.education_code or "not recorded"
    return (
        f"Skills: {skills}. Education: {education}. Languages: {languages}. "
        f"Experience: {profile.total_experience_years:.1f} years."
    )


def _cosine(a: list[float], b: list[float]) -> float:
    return float(sum(x * y for x, y in zip(a, b, strict=True)))


class ProfileFit:
    """Cosine(job text, applicant text) per applicant_id — the v3 text_fit factor.

    Missing applicant vector = no opinion (caller treats as neutral). A missing
    job vector means the factor is unavailable entirely.
    """

    def __init__(self, job_vec: list[float] | None, applicant_vecs: dict[str, list[float]]):
        self._job = job_vec
        self._applicants = applicant_vecs

    @property
    def available(self) -> bool:
        return self._job is not None

    def similarity(self, applicant_id: str) -> float | None:
        vec = self._applicants.get(applicant_id)
        if self._job is None or vec is None:
            return None
        return _cosine(self._job, vec)


_UPSERT = """
INSERT INTO embeddings (entity_type, entity_id, model, content, embedding)
VALUES (%s, %s, %s, %s, %s::vector)
ON CONFLICT (entity_type, entity_id, model)
DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, updated_at = now()
"""


def _to_pg_vector(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


async def ensure_profile_fit(
    conn: AsyncConnection,
    job_id: str,
    job_text: str,
    profiles: list[ApplicantProfile],
) -> ProfileFit:
    """Load job↔applicant vectors, embedding whatever is missing or stale.

    Stale detection: the stored `content` no longer equals the text we would
    embed today (job edited, profile skills changed). Failure to load the
    model degrades to an unavailable factor — scoring never crashes on it.
    """
    model = get_settings().embedding_model
    applicant_texts = {p.applicant_id: applicant_fit_text(p) for p in profiles}
    wanted: list[tuple[str, uuid.UUID, str]] = [("JOB", uuid.UUID(job_id), job_text)]
    wanted += [("APPLICANT", uuid.UUID(aid), text) for aid, text in applicant_texts.items()]

    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT entity_type, entity_id, content, embedding FROM embeddings
            WHERE model = %s AND entity_id = ANY(%s::uuid[])
              AND entity_type IN ('JOB', 'APPLICANT')
            """,
            (model, [str(eid) for _, eid, _ in wanted]),
        )
        rows = await cur.fetchall()

    stored: dict[tuple[str, str], tuple[str, list[float] | None]] = {}
    for row in rows:
        stored[(row["entity_type"], str(row["entity_id"]))] = (
            row["content"],
            _as_vector(row["embedding"]),
        )

    stale: list[tuple[str, uuid.UUID, str]] = []
    for entity_type, entity_id, text in wanted:
        content, vec = stored.get((entity_type, str(entity_id)), (None, None))
        if vec is None or content != text:
            stale.append((entity_type, entity_id, text))

    if stale:
        try:
            vectors = await asyncio.to_thread(embed_texts, [text for _, _, text in stale])
        except Exception as exc:  # model missing / OOM — factor stays unavailable
            log.warning("profile-fit embedding failed: %s", exc)
            vectors = []
        if vectors:
            async with conn.cursor() as cur:
                await cur.executemany(
                    _UPSERT,
                    [
                        (entity_type, str(entity_id), model, text, _to_pg_vector(vec))
                        for (entity_type, entity_id, text), vec in zip(stale, vectors, strict=True)
                    ],
                )
            for (entity_type, entity_id, text), vec in zip(stale, vectors, strict=True):
                stored[(entity_type, str(entity_id))] = (text, vec)

    job_vec = stored.get(("JOB", str(uuid.UUID(job_id))), (None, None))[1]
    applicant_vecs = {
        aid: vec
        for aid in applicant_texts
        if (vec := stored.get(("APPLICANT", aid), (None, None))[1]) is not None
    }
    return ProfileFit(job_vec, applicant_vecs)
