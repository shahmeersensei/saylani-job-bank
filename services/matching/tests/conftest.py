"""Shared fixtures: an eligible “perfect” applicant and a frontend job."""

import pytest

from app.types import (
    ApplicantProfile,
    ApplicantSkill,
    JobCriteria,
    JobSkill,
    SkillLevel,
)


@pytest.fixture
def frontend_job() -> JobCriteria:
    return JobCriteria(
        job_id="job-1",
        title="Frontend Developer",
        category_code="IT_SOFTWARE",
        job_type="FULL_TIME",
        shift="DAY",
        salary_min=40_000,
        salary_max=60_000,
        required_skills=[
            JobSkill(skill_code="JAVASCRIPT", min_level=SkillLevel.INTERMEDIATE),
            JobSkill(skill_code="REACT", min_level=SkillLevel.BEGINNER),
        ],
        preferred_skills=[JobSkill(skill_code="TYPESCRIPT", min_level=SkillLevel.BEGINNER)],
        min_education_code="BACHELORS_14",
        min_education_rank=5,
        min_experience_years=2,
        required_languages=["ENGLISH"],
        preferred_radius_m=8_000,
        max_radius_m=10_000,
    )


@pytest.fixture
def perfect_applicant() -> ApplicantProfile:
    return ApplicantProfile(
        applicant_id="app-1",
        gender="MALE",
        identity_status="VERIFIED",
        skills=[
            ApplicantSkill(skill_code="JAVASCRIPT", level=SkillLevel.EXPERT, years=3),
            ApplicantSkill(skill_code="REACT", level=SkillLevel.INTERMEDIATE, years=2),
            ApplicantSkill(skill_code="TYPESCRIPT", level=SkillLevel.INTERMEDIATE, years=1),
        ],
        education_code="BACHELORS_16",
        education_rank=6,
        total_experience_years=2.5,
        languages={"ENGLISH": "FLUENT", "URDU": "NATIVE"},
        min_salary_pkr=50_000,
        willing_radius_m=10_000,
        shifts=["DAY"],
        job_types=["FULL_TIME"],
        category_codes=["IT_SOFTWARE"],
        distance_m=4_200,
    )
