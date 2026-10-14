"""Eligibility gate — mandatory criteria, pass/fail with reasons.

Pure functions: the same inputs always give the same result. A failed candidate
never reaches the scored shortlist; the reasons are for staff diagnostics.
"""

from collections.abc import Callable

from .types import (
    SEMANTIC_MIN_SIMILARITY,
    SKILL_LEVEL_RANK,
    ApplicantProfile,
    EligibilityResult,
    JobCriteria,
    JobSkill,
)

#: similarity(job_skill_code, applicant_skill_code) → cosine in [0, 1]
SemanticSim = Callable[[str, str], float]


def _skill_passes(
    job_skill: JobSkill, applicant, semantic: SemanticSim | None = None
) -> bool:
    best_sim = 0.0
    for skill in applicant.skills:
        if SKILL_LEVEL_RANK[skill.level] < SKILL_LEVEL_RANK[job_skill.min_level]:
            continue
        if skill.skill_code == job_skill.skill_code:
            return True
        if semantic is not None:
            sim = semantic(job_skill.skill_code, skill.skill_code)
            if sim > best_sim:
                best_sim = sim
    return best_sim >= SEMANTIC_MIN_SIMILARITY


def check_eligibility(
    job: JobCriteria,
    applicant: ApplicantProfile,
    semantic: SemanticSim | None = None,
) -> EligibilityResult:
    reasons: list[str] = []

    # ── Location (hard): must be inside the job's max radius AND the applicant's
    # own willing radius. Distance comes from PostGIS; None = no home pin.
    if applicant.distance_m is None:
        reasons.append("No home location on profile")
    else:
        if applicant.distance_m > job.max_radius_m:
            reasons.append(
                f"Outside maximum radius ({applicant.distance_m / 1000:.1f} km; "
                f"max {job.max_radius_m / 1000:.0f} km)"
            )
        if (
            applicant.willing_radius_m is not None
            and applicant.distance_m > applicant.willing_radius_m
        ):
            reasons.append(
                f"Outside applicant's willing radius ({applicant.distance_m / 1000:.1f} km; "
                f"willing {applicant.willing_radius_m / 1000:.0f} km)"
            )

    # ── Required skills with minimum levels (semantic similarity accepted when
    # embeddings are available; exact codes remain the fast path).
    for req in job.required_skills:
        if not _skill_passes(req, applicant, semantic):
            reasons.append(f"Missing required skill {req.skill_code} (min {req.min_level.value})")

    # ── Education (minimum rank from master data)
    if job.min_education_code is not None and job.min_education_rank is not None:
        if applicant.education_rank < job.min_education_rank:
            reasons.append(
                f"Education below minimum ({applicant.education_code or 'none'}; "
                f"requires {job.min_education_code})"
            )

    # ── Experience years
    if job.min_experience_years is not None:
        if applicant.total_experience_years < job.min_experience_years:
            reasons.append(
                f"Experience {applicant.total_experience_years:g} years; "
                f"requires {job.min_experience_years}"
            )

    # ── Languages (any proficiency satisfies the requirement)
    for lang in job.required_languages:
        if lang not in applicant.languages:
            reasons.append(f"Missing required language {lang}")

    # ── Gender preference is an explicit job requirement (PRD), never a ranking
    # signal: it either passes here or the applicant is out.
    if job.gender_preference in ("MALE", "FEMALE") and applicant.gender not in (
        job.gender_preference,
        "UNDISCLOSED",
    ):
        reasons.append(f"Job is restricted to {job.gender_preference.lower()} candidates")

    return EligibilityResult(eligible=not reasons, reasons=reasons)
