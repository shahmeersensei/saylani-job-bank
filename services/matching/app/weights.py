"""Scoring weights: business-approved, versioned, must sum to 100.

A test asserts the total — changing a weight without rebalancing fails CI.
"""

from pydantic import BaseModel

#: The weight allocation itself — unchanged by scoring logic revisions like
#: semantic skill credit, so it versions independently. v2: introduced the
#: text_fit (profile↔job embedding similarity) factor and rebalanced.
WEIGHTS_VERSION = "v2"


class Weights(BaseModel):
    required_skills: float = 25.0
    preferred_skills: float = 13.0
    experience: float = 14.0
    education: float = 10.0
    languages: float = 5.0
    distance: float = 14.0
    salary: float = 10.0
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
                self.distance,
                self.salary,
                self.preferences,
                self.text_fit,
            )
        )


DEFAULT_WEIGHTS = Weights()

FACTOR_NAMES = tuple(DEFAULT_WEIGHTS.model_dump().keys())
