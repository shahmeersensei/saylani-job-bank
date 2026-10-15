"""Eligibility gate: every mandatory rule, pass and fail."""

from app.eligibility import check_eligibility
from app.types import ApplicantSkill, SkillLevel


def test_perfect_applicant_passes(frontend_job, perfect_applicant):
    result = check_eligibility(frontend_job, perfect_applicant)
    assert result.eligible
    assert result.reasons == []


def test_missing_required_skill_fails(frontend_job, perfect_applicant):
    perfect_applicant.skills = [s for s in perfect_applicant.skills if s.skill_code != "REACT"]
    result = check_eligibility(frontend_job, perfect_applicant)
    assert not result.eligible
    assert any("REACT" in r for r in result.reasons)


def test_semantic_similarity_satisfies_required_skill(frontend_job, perfect_applicant):
    # Applicant has NEXTJS (similar to REACT at 0.85 cosine) — passes only with semantics.
    perfect_applicant.skills = [
        (
            ApplicantSkill(skill_code="NEXTJS", level=SkillLevel.INTERMEDIATE, years=2)
            if s.skill_code == "REACT"
            else s
        )
        for s in perfect_applicant.skills
    ]
    sim = lambda a, b: 0.85 if {a, b} == {"REACT", "NEXTJS"} else 0.0  # noqa: E731
    assert not check_eligibility(frontend_job, perfect_applicant).eligible
    result = check_eligibility(frontend_job, perfect_applicant, semantic=sim)
    assert result.eligible


def test_skill_level_below_minimum_fails(frontend_job, perfect_applicant):
    # JAVASCRIPT required at INTERMEDIATE; applicant is only BEGINNER.
    perfect_applicant.skills[0] = ApplicantSkill(
        skill_code="JAVASCRIPT", level=SkillLevel.BEGINNER, years=3
    )
    result = check_eligibility(frontend_job, perfect_applicant)
    assert not result.eligible
    assert any("JAVASCRIPT" in r for r in result.reasons)


def test_experience_below_minimum_fails(frontend_job, perfect_applicant):
    perfect_applicant.total_experience_years = 1.0
    result = check_eligibility(frontend_job, perfect_applicant)
    assert not result.eligible
    assert any("Experience" in r for r in result.reasons)


def test_education_below_minimum_fails(frontend_job, perfect_applicant):
    perfect_applicant.education_code = "MATRIC"
    perfect_applicant.education_rank = 3
    result = check_eligibility(frontend_job, perfect_applicant)
    assert not result.eligible
    assert any("Education" in r for r in result.reasons)


def test_missing_language_fails(frontend_job, perfect_applicant):
    perfect_applicant.languages = {"URDU": "NATIVE"}
    result = check_eligibility(frontend_job, perfect_applicant)
    assert not result.eligible
    assert any("ENGLISH" in r for r in result.reasons)


def test_no_location_fails(frontend_job, perfect_applicant):
    perfect_applicant.distance_m = None
    result = check_eligibility(frontend_job, perfect_applicant)
    assert not result.eligible
    assert any("location" in r.lower() for r in result.reasons)


def test_beyond_max_radius_fails_even_if_rounded_label_would_show_10_0(
    frontend_job, perfect_applicant
):
    # 10 900 m = 10.9 km → beyond the 10 km hard cap (display rounds, policy does not).
    perfect_applicant.distance_m = 10_900
    result = check_eligibility(frontend_job, perfect_applicant)
    assert not result.eligible
    assert any("radius" in r.lower() for r in result.reasons)


def test_willing_radius_smaller_than_distance_fails(frontend_job, perfect_applicant):
    perfect_applicant.distance_m = 7_000
    perfect_applicant.willing_radius_m = 5_000
    result = check_eligibility(frontend_job, perfect_applicant)
    assert not result.eligible
    assert any("willing" in r.lower() for r in result.reasons)


def test_gender_preference_is_hard_and_explicit(frontend_job, perfect_applicant):
    frontend_job.gender_preference = "FEMALE"
    perfect_applicant.gender = "MALE"
    result = check_eligibility(frontend_job, perfect_applicant)
    assert not result.eligible
    assert any("female" in r.lower() for r in result.reasons)

    # UNDISCLOSED is never excluded by a gender preference (privacy guardrail).
    perfect_applicant.gender = "UNDISCLOSED"
    assert check_eligibility(frontend_job, perfect_applicant).eligible
