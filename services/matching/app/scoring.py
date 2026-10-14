"""Deterministic 0–100 scoring with a per-factor breakdown.

Every factor returns points earned, its weight and a short human reason, e.g.
"Required skills: 3/3 met" or "Location: 4.2 km (within preferred radius)".
Missing optional data is NEUTRAL (full weight) so a thin profile is not
punished for data the platform never asked for.
"""

from collections.abc import Callable

from .types import (
    SEMANTIC_MIN_SIMILARITY,
    SEMANTIC_PARTIAL_CREDIT,
    SKILL_LEVEL_RANK,
    TEXT_FIT_FLOOR_SIMILARITY,
    TEXT_FIT_FULL_SIMILARITY,
    ApplicantProfile,
    FactorScore,
    JobCriteria,
    JobSkill,
    MatchResult,
)
from .weights import DEFAULT_WEIGHTS, Weights

#: similarity(job_skill_code, applicant_skill_code) → cosine in [0, 1]
SemanticSim = Callable[[str, str], float]
#: applicant_id → cosine(job text, profile text) in [0, 1]; None = no opinion
TextFitSim = Callable[[str], float] | None


def format_distance_km(distance_m: float) -> str:
    """Display helper: distances are rounded to one decimal (10 900 m → 10.9 km)."""
    return f"{distance_m / 1000:.1f} km"


def _skill_match_count(
    job_skills: list[JobSkill], applicant, semantic: SemanticSim | None = None
) -> tuple[float, int]:
    """Returns (credits, exact_matches).

    Exact code + level matches credit 1.0. When embeddings are available, a
    level-sufficient skill whose embedding is close to the required skill
    (cosine ≥ SEMANTIC_MIN_SIMILARITY) credits SEMANTIC_PARTIAL_CREDIT instead.
    """
    credits = 0.0
    exact = 0
    for req in job_skills:
        best_sim = 0.0
        matched_exact = False
        for skill in applicant.skills:
            if SKILL_LEVEL_RANK[skill.level] < SKILL_LEVEL_RANK[req.min_level]:
                continue
            if skill.skill_code == req.skill_code:
                matched_exact = True
                break
            if semantic is not None:
                sim = semantic(req.skill_code, skill.skill_code)
                if sim > best_sim:
                    best_sim = sim
        if matched_exact:
            exact += 1
            credits += 1.0
        elif best_sim >= SEMANTIC_MIN_SIMILARITY:
            credits += SEMANTIC_PARTIAL_CREDIT
    return credits, exact


def _skill_reason(label: str, credits: float, exact: int, total: int) -> str:
    if exact == total:
        return f"{label}: {exact}/{total} met"
    if credits > exact:
        extra = credits - exact
        return f"{label}: {exact}/{total} met (+{extra:g} via similar skills)"
    display = f"{credits:g}" if credits != int(credits) else f"{int(credits)}"
    return f"{label}: {display}/{total} met"


def _factor(name: str, points: float, weight: float, reason: str, **detail) -> FactorScore:
    return FactorScore(
        factor=name,
        score=round(min(max(points, 0.0), weight), 2),
        weight=weight,
        reason=reason,
        detail=detail,
    )


def score_required_skills(
    job, applicant, weight: float, semantic: SemanticSim | None = None
) -> FactorScore:
    total = len(job.required_skills)
    if total == 0:
        return _factor("required_skills", weight, weight, "No required skills defined")
    credits, exact = _skill_match_count(job.required_skills, applicant, semantic)
    return _factor(
        "required_skills",
        weight * credits / total,
        weight,
        _skill_reason("Required skills", credits, exact, total),
        met=credits,
        total=total,
        semantic=(credits > exact),
    )


def score_preferred_skills(
    job, applicant, weight: float, semantic: SemanticSim | None = None
) -> FactorScore:
    total = len(job.preferred_skills)
    if total == 0:
        return _factor("preferred_skills", weight, weight, "No preferred skills defined")
    credits, exact = _skill_match_count(job.preferred_skills, applicant, semantic)
    return _factor(
        "preferred_skills",
        weight * credits / total,
        weight,
        _skill_reason("Preferred skills", credits, exact, total),
        met=credits,
        total=total,
        semantic=(credits > exact),
    )


def score_experience(job, applicant, weight: float) -> FactorScore:
    years = applicant.total_experience_years
    if job.min_experience_years is None:
        return _factor(
            "experience",
            weight,
            weight,
            f"Experience: {years:g} years (no minimum)",
            years=years,
        )
    ratio = min(1.0, years / job.min_experience_years) if job.min_experience_years > 0 else 1.0
    return _factor(
        "experience",
        weight * ratio,
        weight,
        f"Experience: {years:g} years; required {job.min_experience_years}",
        years=years,
        required=job.min_experience_years,
    )


def score_education(job, applicant, weight: float) -> FactorScore:
    if job.min_education_rank is None:
        return _factor(
            "education",
            weight,
            weight,
            f"Education: {applicant.education_code or 'not recorded'} (no minimum)",
        )
    if applicant.education_rank >= job.min_education_rank:
        return _factor(
            "education",
            weight,
            weight,
            f"Education meets minimum ({applicant.education_code}; "
            f"requires {job.min_education_code})",
        )
    ratio = applicant.education_rank / job.min_education_rank if job.min_education_rank else 1.0
    return _factor(
        "education",
        weight * ratio,
        weight,
        f"Education below minimum ({applicant.education_code or 'none'}; "
        f"requires {job.min_education_code})",
    )


def score_languages(job, applicant, weight: float) -> FactorScore:
    total = len(job.required_languages)
    if total == 0:
        return _factor("languages", weight, weight, "No required languages")
    met = sum(1 for lang in job.required_languages if lang in applicant.languages)
    return _factor(
        "languages",
        weight * met / total,
        weight,
        f"Languages: {met}/{total} match",
        met=met,
        total=total,
    )


def score_distance(job, applicant, weight: float) -> FactorScore:
    if applicant.distance_m is None:
        return _factor("distance", 0.0, weight, "Location: not on profile")
    preferred = job.preferred_radius_m
    maximum = max(job.max_radius_m, preferred)
    distance = applicant.distance_m
    label = format_distance_km(distance)
    if distance <= preferred:
        return _factor(
            "distance",
            weight,
            weight,
            f"Location: {label}; preferred radius {format_distance_km(preferred)}",
            distance_km=round(distance / 1000, 1),
        )
    # Linear decay from the preferred radius out to the maximum.
    remaining = max(0.0, (maximum - distance) / (maximum - preferred))
    return _factor(
        "distance",
        weight * remaining,
        weight,
        f"Location: {label}; beyond preferred radius "
        f"({format_distance_km(preferred)}–{format_distance_km(maximum)})",
        distance_km=round(distance / 1000, 1),
    )


def score_salary(job, applicant, weight: float) -> FactorScore:
    expectation = applicant.min_salary_pkr
    if expectation is None or job.salary_max is None:
        return _factor("salary", weight, weight, "Salary: no comparison data (neutral)")
    if job.salary_max >= expectation:
        return _factor(
            "salary",
            weight,
            weight,
            f"Salary: job up to {job.salary_max:,}; expectation {expectation:,}",
        )
    ratio = min(1.0, job.salary_max / expectation) if expectation > 0 else 1.0
    return _factor(
        "salary",
        weight * ratio,
        weight,
        f"Salary: job up to {job.salary_max:,}; expectation {expectation:,} (gap)",
        offered=job.salary_max,
        expected=expectation,
    )


def _list_fit(job_value: str, applicant_list: list[str]) -> float | None:
    """None = no preference recorded (neutral); otherwise 1.0/0.0."""
    if not applicant_list:
        return None
    return 1.0 if job_value in applicant_list else 0.0


def score_preferences(job, applicant, weight: float) -> FactorScore:
    fits: list[float] = []
    labels: list[str] = []

    shift_fit = _list_fit(job.shift, applicant.shifts)
    if shift_fit is not None:
        fits.append(shift_fit)
        labels.append(f"shift {'ok' if shift_fit else 'mismatch'}")

    type_fit = _list_fit(job.job_type, applicant.job_types)
    if type_fit is not None:
        fits.append(type_fit)
        labels.append(f"job type {'ok' if type_fit else 'mismatch'}")

    category_fit = _list_fit(job.category_code, applicant.category_codes)
    if category_fit is not None:
        fits.append(category_fit)
        labels.append(f"category {'ok' if category_fit else 'mismatch'}")

    if not fits:
        return _factor("preferences", weight, weight, "Preferences: none recorded (neutral)")
    average = sum(fits) / len(fits)
    return _factor(
        "preferences",
        weight * average,
        weight,
        "Preferences: " + (", ".join(labels) if labels else "neutral"),
    )


def score_text_fit(job, applicant, weight: float, fit: TextFitSim = None) -> FactorScore:
    """v3 factor: embedding similarity between the job text and the profile text.

    Catches topical fit the explicit factors miss (e.g. a "Retail Sales
    Associate" job vs a beautician who listed no sales skill codes). Missing
    similarity (no vectors yet) is neutral — full weight, same as other
    optional data. Linear ramp from floor (0 points) to ceiling (full weight).
    """
    if fit is None:
        return _factor("text_fit", weight, weight, "Profile fit: no embeddings yet (neutral)")
    sim = fit(applicant.applicant_id)
    if sim is None:
        return _factor("text_fit", weight, weight, "Profile fit: not embedded (neutral)")
    span = TEXT_FIT_FULL_SIMILARITY - TEXT_FIT_FLOOR_SIMILARITY
    ratio = min(1.0, max(0.0, (sim - TEXT_FIT_FLOOR_SIMILARITY) / span))
    label = "strong" if ratio >= 0.8 else "partial" if ratio > 0 else "weak"
    return _factor(
        "text_fit",
        weight * ratio,
        weight,
        f"Profile fit: {label} text match (similarity {sim:.2f})",
        similarity=round(sim, 3),
    )


def score_candidate(
    job: JobCriteria,
    applicant: ApplicantProfile,
    weights: Weights = DEFAULT_WEIGHTS,
    semantic: SemanticSim | None = None,
    fit: TextFitSim = None,
) -> MatchResult:
    factors = [
        score_required_skills(job, applicant, weights.required_skills, semantic),
        score_preferred_skills(job, applicant, weights.preferred_skills, semantic),
        score_experience(job, applicant, weights.experience),
        score_education(job, applicant, weights.education),
        score_languages(job, applicant, weights.languages),
        score_distance(job, applicant, weights.distance),
        score_salary(job, applicant, weights.salary),
        score_preferences(job, applicant, weights.preferences),
        score_text_fit(job, applicant, weights.text_fit, fit),
    ]
    total = round(sum(f.score for f in factors))
    total = min(100, max(0, total))
    summary = "; ".join(f.reason for f in factors)
    return MatchResult(
        applicant_id=applicant.applicant_id,
        eligible=True,
        score=total,
        distance_m=round(applicant.distance_m) if applicant.distance_m is not None else None,
        summary=summary,
        factors=factors,
    )


def sort_matches(matches: list[MatchResult]) -> list[MatchResult]:
    """Score descending; ties by nearer distance, then applicant id (stable)."""
    return sorted(
        matches,
        key=lambda m: (
            -(m.score or 0),
            m.distance_m if m.distance_m is not None else 2**31,
            m.applicant_id,
        ),
    )
