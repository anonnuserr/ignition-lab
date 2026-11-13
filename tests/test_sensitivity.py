"""Checks on the sensitivity analysis."""

import numpy as np
import pytest

from lawson import sensitivity


def test_no_impurity_means_no_penalty():
    for species in sensitivity.SPECIES:
        assert sensitivity.impurity_penalty(species, [0.0])[0] == pytest.approx(1.0)


def test_penalty_grows_with_concentration():
    penalty = sensitivity.impurity_penalty("Helium", np.linspace(0.0, 0.2, 9))
    assert np.all(np.diff(penalty) > 0.0)


def test_higher_charge_is_more_harmful_per_ion():
    concentration = [0.01]
    penalties = [sensitivity.impurity_penalty(s, concentration)[0] for s in ("Helium", "Beryllium", "Carbon", "Neon")]
    assert penalties == sorted(penalties)


def test_penalty_exceeds_pure_dilution():
    """Dilution alone costs 1/f_DT^2 in fusion power; radiation adds to it."""
    summary = sensitivity.impurity_summary("Helium", 0.10)
    assert summary["penalty"] > 1.0 / summary["fuel_fraction"] ** 2 * 0.9
    assert summary["ideal_ignition_temperature_kev"] > 4.3


def test_fuel_mix_penalty_is_symmetric_with_minimum_at_half():
    fractions = np.array([0.3, 0.4, 0.5, 0.6, 0.7])
    penalty = sensitivity.fuel_mix_penalty(fractions)
    assert penalty[2] == pytest.approx(1.0)
    assert np.allclose(penalty, penalty[::-1])
    assert np.all(penalty >= 1.0)


def test_textbook_shortcut_overestimates_by_about_five_percent():
    ratio = sensitivity.textbook_triple_product() / sensitivity.reference_triple_product()
    assert sensitivity.textbook_triple_product() == pytest.approx(3.1e21, rel=0.01)
    assert 1.03 < ratio < 1.07
