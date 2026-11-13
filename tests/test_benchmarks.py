"""Reproduction of published values.

Reference: S. E. Wurzel and S. C. Hsu, Phys. Plasmas 29, 062103 (2022).
The published values are quoted to two significant figures; a 4% tolerance
covers that rounding plus the small difference between the reactivity fit used
here and the directly integrated cross-sections used in the reference.
"""

import math

import pytest

from lawson import (
    icf_ignition_lawson_parameter,
    ideal_ignition_temperature,
    minimum_lawson_parameter,
    minimum_triple_product,
)

TOLERANCE = 0.04


def test_ideal_ignition_temperature():
    """Sec. III A: alpha heating exceeds bremsstrahlung above 4.3 keV."""
    assert ideal_ignition_temperature() == pytest.approx(4.3, abs=0.05)


@pytest.mark.parametrize(
    "q_fuel, published_temperature, published_value",
    [(1.0, 26.0, 2.5e19), (math.inf, 26.0, 1.6e20)],
)
def test_minimum_lawson_parameter(q_fuel, published_temperature, published_value):
    """Table 2: minimum n tau_E and the temperature at which it occurs."""
    temperature, value = minimum_lawson_parameter(q_fuel)
    assert value == pytest.approx(published_value, rel=TOLERANCE)
    assert temperature == pytest.approx(published_temperature, abs=0.5)


@pytest.mark.parametrize(
    "q_fuel, published_temperature, published_value",
    [(1.0, 14.0, 4.6e20), (math.inf, 14.0, 2.9e21)],
)
def test_minimum_triple_product(q_fuel, published_temperature, published_value):
    """Table 3: minimum n T tau_E and the temperature at which it occurs."""
    temperature, value = minimum_triple_product(q_fuel)
    assert value == pytest.approx(published_value, rel=TOLERANCE)
    assert temperature == pytest.approx(published_temperature, abs=0.5)


def test_icf_threshold_is_three_times_the_idealised_case():
    """2025 update, Sec. III C: f_alpha = 1.4, theta_alpha = 0.93 give a factor of three."""
    ratio = icf_ignition_lawson_parameter(10.0) / icf_ignition_lawson_parameter(
        10.0, f_alpha=0.5, theta_alpha=1.0
    )
    assert ratio == pytest.approx(3.0, abs=0.02)
