from app.weights import DEFAULT_WEIGHTS, WEIGHTS_VERSION


def test_default_weights_sum_to_100():
    assert DEFAULT_WEIGHTS.total() == 100.0


def test_every_factor_has_a_weight():
    assert set(DEFAULT_WEIGHTS.model_dump()) == {
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


def test_weights_version_is_stable():
    assert WEIGHTS_VERSION == "v2"
