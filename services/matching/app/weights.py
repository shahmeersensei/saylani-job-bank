"""Scoring weights: business-approved, versioned, must sum to 100.

A test asserts the total — changing a weight without rebalancing fails CI.
"""

from pydantic import BaseModel

#: The weight allocation itself — unchanged by scoring logic revisions like
#: semantic skill credit, so it versions independently. v2: introduced the
#: text_fit (profile↔job embedding similarity) factor and rebalanced.
#: v3: the distance factor is gone with the radius feature (2026-11-17);
#: its 14 points move to the factors that decide fit — required skills +6,
#: experience +3, preferred skills +2, salary +2, education +1.
WEIGHTS_VERSION = "v3"


class Weights(BaseModel):
    required_skills: float = 31.0
    preferred_skills: float = 15.0
    experience: float = 17.0
    education: float = 11.0
    languages: float = 5.0
    salary: float = 12.0
    preferences: float = 4.0
    text_fit: float = 5.0

    def total(self) -> float:
        return sum(
            (
                self.required_skills,
                self.preferred_skills,
                self.experience,
                self.education,
                self.languages,
                self.salary,
                self.preferences,
                self.text_fit,
            )
        )


DEFAULT_WEIGHTS = Weights()

FACTOR_NAMES = tuple(DEFAULT_WEIGHTS.model_dump().keys())
