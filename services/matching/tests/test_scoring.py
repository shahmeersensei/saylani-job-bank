"""Scoring: weights, boundaries, tie-breaks."""

from app.scoring import score_candidate, sort_matches
from app.types import ApplicantProfile, ApplicantSkill, JobCriteria, MatchResult, SkillLevel


def _points(match: MatchResult) -> float:
    return sum(f.score for f in match.factors)


def test_perfect_applicant_scores_high(frontend_job, perfect_applicant):
    match = score_candidate(frontend_job, perfect_applicant)
    assert match.score is not None
    assert match.score >= 95
    # Factor points sum equals the (rounded) total within rounding error.
    assert abs(_points(match) - match.score) <= 1


def test_every_factor_present(frontend_job, perfect_applicant):
    match = score_candidate(frontend_job, perfect_applicant)
    assert {f.factor for f in match.factors} == {
        "required_skills",
        "preferred_skills",
        "experience",
        "education",
        "languages",
        "salary",
        "preferences",
        "text_fit",
    }
    for factor in match.factors:
        assert 0 <= factor.score <= factor.weight
        assert factor.reason


def test_missing_optional_data_is_neutral(frontend_job, perfect_applicant):
    thin = perfect_applicant.model_copy(update={"min_salary_pkr": None, "shifts": []})
    match = score_candidate(frontend_job, thin)
    salary = next(f for f in match.factors if f.factor == "salary")
    preferences = next(f for f in match.factors if f.factor == "preferences")
    assert salary.score == salary.weight
    assert preferences.score == preferences.weight


def test_thin_profile_flagged_without_changing_score():
    """Audit 2026-11-11 (L-10): an empty profile vs a job with no
    requirements still scores high (missing data is neutral — weights
    unchanged) but is flagged thin: no factor had real data to judge."""
    bare_job = JobCriteria(
        job_id="job-thin",
        title="General Helper",
        category_code="GENERAL",
        job_type="FULL_TIME",
        shift="DAY",
        required_skills=[],
        preferred_skills=[],
        min_experience_years=None,
        min_education_code=None,
        min_education_rank=None,
        required_languages=[],
        salary_max=None,
    )
    bare_applicant = ApplicantProfile(applicant_id="thin-1")
    match = score_candidate(bare_job, bare_applicant)
    # All eight factors are neutral at full weight (no data anywhere).
    assert match.score == 100
    assert match.completeness == 0.0
    assert match.thin_profile is True
    assert all(f.has_data is False for f in match.factors)
    assert all(f.detail["has_data"] is False for f in match.factors)


def test_full_profile_is_not_thin(frontend_job, perfect_applicant):
    match = score_candidate(frontend_job, perfect_applicant)
    # Only text_fit lacks data without embeddings (7 of 8 factors real).
    assert match.completeness == 0.88
    assert match.thin_profile is False
    text_fit = next(f for f in match.factors if f.factor == "text_fit")
    assert text_fit.has_data is False
    assert all(
        f.has_data for f in match.factors if f.factor != "text_fit"
    )


def test_salary_gap_reduces_score(frontend_job, perfect_applicant):
    wants_more = perfect_applicant.model_copy(update={"min_salary_pkr": 80_000})
    match = score_candidate(frontend_job, wants_more)
    salary = next(f for f in match.factors if f.factor == "salary")
    assert 0 < salary.score < salary.weight


def test_preferred_skills_partial(frontend_job, perfect_applicant):
    no_ts = perfect_applicant.model_copy(
        update={"skills": [s for s in perfect_applicant.skills if s.skill_code != "TYPESCRIPT"]}
    )
    match = score_candidate(frontend_job, no_ts)
    preferred = next(f for f in match.factors if f.factor == "preferred_skills")
    assert preferred.score == 0  # 0/1 matched
    assert "0/1" in preferred.reason


def test_sort_by_score_then_id():
    matches = [
        MatchResult(applicant_id="b", eligible=True, score=70),
        MatchResult(applicant_id="a", eligible=True, score=70),
        MatchResult(applicant_id="c", eligible=True, score=90),
        MatchResult(applicant_id="d", eligible=True, score=70),
    ]
    ordered = [m.applicant_id for m in sort_matches(matches)]
    assert ordered == ["c", "a", "b", "d"]


# ── Phase 3: semantic (embedding-based) skill credit ─────────────────────


def _nextjs_applicant(perfect_applicant: ApplicantProfile) -> ApplicantProfile:
    """Same as the perfect fixture but NEXTJS instead of REACT."""
    skills = [
        (
            ApplicantSkill(skill_code="NEXTJS", level=SkillLevel.INTERMEDIATE, years=2)
            if s.skill_code == "REACT"
            else s
        )
        for s in perfect_applicant.skills
    ]
    return perfect_applicant.model_copy(update={"skills": skills})


def _react_nextjs_sim(a: str, b: str) -> float:
    return 0.85 if {a, b} == {"REACT", "NEXTJS"} else 0.0


def test_semantic_skill_earns_partial_credit(frontend_job, perfect_applicant):
    similar = _nextjs_applicant(perfect_applicant)
    match = score_candidate(frontend_job, similar, semantic=_react_nextjs_sim)
    required = next(f for f in match.factors if f.factor == "required_skills")
    # 1 exact (JAVASCRIPT) + 0.5 semantic (NEXTJS ≈ REACT) = 1.5 / 2 → 23.25 / 31.
    assert required.score == 23.25
    assert required.detail["semantic"] is True
    assert "similar skills" in required.reason


def test_without_semantics_no_partial_credit(frontend_job, perfect_applicant):
    similar = _nextjs_applicant(perfect_applicant)
    match = score_candidate(frontend_job, similar)
    required = next(f for f in match.factors if f.factor == "required_skills")
    assert required.score == 15.5  # exact-only: 1 / 2
    assert required.detail["semantic"] is False


def test_low_similarity_is_not_credited(frontend_job, perfect_applicant):
    similar = _nextjs_applicant(perfect_applicant)
    weak = lambda a, b: 0.4  # noqa: E731 — below SEMANTIC_MIN_SIMILARITY (0.75)
    match = score_candidate(frontend_job, similar, semantic=weak)
    required = next(f for f in match.factors if f.factor == "required_skills")
    assert required.score == 15.5


# ── v3: profile↔job text fit (embedding similarity) ──────────────────────


def _text_fit(match, applicant_id="a1"):
    return next(f for f in match.factors if f.factor == "text_fit")


def test_text_fit_neutral_without_embeddings(frontend_job, perfect_applicant):
    match = score_candidate(frontend_job, perfect_applicant)
    fit = _text_fit(match)
    assert fit.score == fit.weight  # no embeddings yet → full weight (neutral)
    assert "neutral" in fit.reason


def test_text_fit_neutral_when_applicant_not_embedded(frontend_job, perfect_applicant):
    match = score_candidate(frontend_job, perfect_applicant, fit=lambda aid: None)
    fit = _text_fit(match)
    assert fit.score == fit.weight


def test_text_fit_strong_similarity_earns_full_weight(frontend_job, perfect_applicant):
    match = score_candidate(frontend_job, perfect_applicant, fit=lambda aid: 0.60)
    fit = _text_fit(match)
    assert fit.score == fit.weight
    assert "strong" in fit.reason


def test_text_fit_zero_below_floor(frontend_job, perfect_applicant):
    match = score_candidate(frontend_job, perfect_applicant, fit=lambda aid: 0.05)
    fit = _text_fit(match)
    assert fit.score == 0


def test_text_fit_mid_similarity_is_partial(frontend_job, perfect_applicant):
    # floor 0.15, ceiling 0.45 → 0.30 is exactly half the ramp → half weight.
    match = score_candidate(frontend_job, perfect_applicant, fit=lambda aid: 0.30)
    fit = _text_fit(match)
    assert fit.score == fit.weight / 2
    assert "partial" in fit.reason


def test_text_fit_distinguishes_similar_from_dissimilar(frontend_job, perfect_applicant):
    related = score_candidate(frontend_job, perfect_applicant, fit=lambda aid: 0.5)
    unrelated = score_candidate(frontend_job, perfect_applicant, fit=lambda aid: 0.1)
    assert _text_fit(related).score > _text_fit(unrelated).score
    assert related.score > unrelated.score
