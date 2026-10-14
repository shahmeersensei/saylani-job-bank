"""Domain types for the matching engine.

Everything here is a plain, serialisable model: eligibility and scoring are pure
functions over these types, so unit tests need no database.
"""

from enum import StrEnum

from pydantic import BaseModel, Field

CRITERIA_VERSION = 1
#: v2 added semantic (embedding) skill credit; v3 adds the text_fit factor
#: (profile↔job embedding similarity in the score breakdown).
SCORING_VERSION = "v3"

#: Cosine similarity (embeddings) at/above which a non-exact skill counts as a
#: similar skill — used by the eligibility gate and for scoring partial credit.
SEMANTIC_MIN_SIMILARITY = 0.75
#: Fraction of a skill slot credited when the match is semantic, not exact.
SEMANTIC_PARTIAL_CREDIT = 0.5
#: Profile↔job text similarity (v3 text_fit factor). MiniLM profile/job
#: pairs: unrelated ≈ 0.0–0.15, topically related ≈ 0.25–0.5. Below the floor
#: scores zero; at/above the ceiling earns the full weight; linear in between.
TEXT_FIT_FLOOR_SIMILARITY = 0.15
TEXT_FIT_FULL_SIMILARITY = 0.45


class SkillLevel(StrEnum):
    BEGINNER = "BEGINNER"
    INTERMEDIATE = "INTERMEDIATE"
    EXPERT = "EXPERT"


SKILL_LEVEL_RANK: dict[SkillLevel, int] = {
    SkillLevel.BEGINNER: 0,
    SkillLevel.INTERMEDIATE: 1,
    SkillLevel.EXPERT: 2,
}

# Mirrors master_data EDUCATION_LEVEL meta.rank (packages/db/src/seed/master-data.ts).
# The repository prefers live ranks from the database; this is the fallback for tests.
EDUCATION_RANKS: dict[str, int] = {
    "NO_FORMAL": 0,
    "PRIMARY": 1,
    "MIDDLE": 2,
    "MATRIC": 3,
    "INTERMEDIATE": 4,
    "DAE": 4,
    "BACHELORS_14": 5,
    "BACHELORS_16": 6,
    "MASTERS": 7,
    "PHD": 8,
}

LANGUAGE_RANK: dict[str, int] = {
    "BASIC": 0,
    "CONVERSATIONAL": 1,
    "FLUENT": 2,
    "NATIVE": 3,
}


class ApplicantSkill(BaseModel):
    skill_code: str
    level: SkillLevel
    years: int = 0


class JobSkill(BaseModel):
    skill_code: str
    min_level: SkillLevel = SkillLevel.BEGINNER


class JobCriteria(BaseModel):
    """Everything the engine needs about the job, already resolved."""

    job_id: str
    title: str
    category_code: str
    description: str = ""
    job_type: str
    shift: str
    gender_preference: str = "ANY"  # ANY | MALE | FEMALE
    salary_min: int | None = None
    salary_max: int | None = None
    required_skills: list[JobSkill] = Field(default_factory=list)
    preferred_skills: list[JobSkill] = Field(default_factory=list)
    min_education_code: str | None = None
    min_education_rank: int | None = None
    min_experience_years: int | None = None
    required_languages: list[str] = Field(default_factory=list)
    preferred_radius_m: int = 8_000
    max_radius_m: int = 10_000


class ApplicantProfile(BaseModel):
    """Matchable snapshot of one ACTIVE applicant (no PII beyond ids/codes)."""

    applicant_id: str
    gender: str = "UNDISCLOSED"
    identity_status: str = "UNVERIFIED"
    skills: list[ApplicantSkill] = Field(default_factory=list)
    education_code: str | None = None
    education_rank: int = 0
    total_experience_years: float = 0.0
    has_no_experience: bool = False
    languages: dict[str, str] = Field(default_factory=dict)  # code → proficiency
    min_salary_pkr: int | None = None
    willing_radius_m: int | None = None
    shifts: list[str] = Field(default_factory=list)
    job_types: list[str] = Field(default_factory=list)
    category_codes: list[str] = Field(default_factory=list)
    distance_m: float | None = None  # filled by the repository (PostGIS)


class FactorScore(BaseModel):
    factor: str
    score: float
    weight: float
    reason: str
    detail: dict = Field(default_factory=dict)


class EligibilityResult(BaseModel):
    eligible: bool
    reasons: list[str] = Field(default_factory=list)  # why NOT eligible (empty = pass)


class MatchResult(BaseModel):
    applicant_id: str
    eligible: bool
    score: int | None = None
    distance_m: int | None = None
    summary: str = ""
    factors: list[FactorScore] = Field(default_factory=list)


class MatchRunReport(BaseModel):
    job_id: str
    run_id: str | None = None
    status: str  # COMPLETED | FAILED
    candidate_count: int = 0
    eligible_count: int = 0
    error: str | None = None
    matches: list[MatchResult] = Field(default_factory=list)
