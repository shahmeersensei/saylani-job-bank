"""Scoring: weights, boundaries, radius fixtures (7.9 / 9.5 / 10.1 km), tie-breaks."""

from app.scoring import format_distance_km, score_candidate, sort_matches
from app.types import ApplicantProfile, ApplicantSkill, MatchResult, SkillLevel


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
        "distance",
        "salary",
        "preferences",
        "text_fit",
    }
    for factor in match.factors:
        assert 0 <= factor.score <= factor.weight
        assert factor.reason


def test_distance_7_9_scores_more_than_9_5(frontend_job, perfect_applicant):
    near = perfect_applicant.model_copy(update={"distance_m": 7_900})
    far = perfect_applicant.model_copy(update={"distance_m": 9_500})
    near_match = score_candidate(frontend_job, near)
    far_match = score_candidate(frontend_job, far)

    near_distance = next(f for f in near_match.factors if f.factor == "distance")
    far_distance = next(f for f in far_match.factors if f.factor == "distance")

    # 7.9 km is inside the preferred 8 km → full points.
    assert near_distance.score == near_distance.weight
    # 9.5 km is between preferred (8) and max (10) → linear decay, strictly less.
    assert 0 < far_distance.score < near_distance.score
    assert near_match.score > far_match.score


def test_missing_optional_data_is_neutral(frontend_job, perfect_applicant):
    thin = perfect_applicant.model_copy(update={"min_salary_pkr": None, "shifts": []})
    match = score_candidate(frontend_job, thin)
    salary = next(f for f in match.factors if f.factor == "salary")
    preferences = next(f for f in match.factors if f.factor == "preferences")
    assert salary.score == salary.weight
    assert preferences.score == preferences.weight


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


def test_display_distance_rounds_to_one_decimal():
    assert format_distance_km(10_900) == "10.9 km"
    assert format_distance_km(4_240) == "4.2 km"
    assert format_distance_km(7_950) == "8.0 km"


def test_sort_by_score_then_distance_then_id():
    matches = [
        MatchResult(applicant_id="b", eligible=True, score=70, distance_m=3_000),
        MatchResult(applicant_id="a", eligible=True, score=70, distance_m=3_000),
        MatchResult(applicant_id="c", eligible=True, score=90, distance_m=9_000),
        MatchResult(applicant_id="d", eligible=True, score=70, distance_m=1_000),
    ]
    ordered = [m.applicant_id for m in sort_matches(matches)]
    assert ordered == ["c", "d", "a", "b"]


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
    # 1 exact (JAVASCRIPT) + 0.5 semantic (NEXTJS ≈ REACT) = 1.5 / 2 → 18.75 / 25.
    assert required.score == 18.75
    assert required.detail["semantic"] is True
    assert "similar skills" in required.reason


def test_without_semantics_no_partial_credit(frontend_job, perfect_applicant):
    similar = _nextjs_applicant(perfect_applicant)
    match = score_candidate(frontend_job, similar)
    required = next(f for f in match.factors if f.factor == "required_skills")
    assert required.score == 12.5  # exact-only: 1 / 2
    assert required.detail["semantic"] is False


def test_low_similarity_is_not_credited(frontend_job, perfect_applicant):
    similar = _nextjs_applicant(perfect_applicant)
    weak = lambda a, b: 0.4  # noqa: E731 — below SEMANTIC_MIN_SIMILARITY (0.75)
    match = score_candidate(frontend_job, similar, semantic=weak)
    required = next(f for f in match.factors if f.factor == "required_skills")
    assert required.score == 12.5


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
