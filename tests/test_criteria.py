"""Internal consistency of the power-balance model."""

import math

import numpy as np
import pytest

from lawson import (
    PURE_DT,
    Plasma,
    alpha_power_coefficient,
    bremsstrahlung_coefficient,
    ideal_ignition_temperature,
    lawson_parameter,
    minimum_triple_product,
    q_fuel_from_state,
    q_fuel_pulsed,
    triple_product,
)
from lawson.constants import ALPHA_FRACTION, C_BREMS, E_FUSION_KEV, KEV_TO_J
from lawson.reactivity import reactivity_dt


def test_general_formula_reduces_to_textbook_form_for_pure_dt():
    """n tau_E = 3T / [(f_c + 1/Q) <sv> eps_F / 4 - C_B sqrt(T)]."""
    temperature, q_fuel = 15.0, 10.0
    expected = (3.0 * temperature * KEV_TO_J) / (
        (ALPHA_FRACTION + 1.0 / q_fuel) * reactivity_dt(temperature) * E_FUSION_KEV * KEV_TO_J / 4.0
        - C_BREMS * math.sqrt(temperature)
    )
    assert lawson_parameter(temperature, q_fuel) == pytest.approx(expected, rel=1e-12)


def test_pure_plasma_composition():
    assert PURE_DT.fuel_fraction == 1.0
    assert PURE_DT.ion_fraction == 1.0
    assert PURE_DT.z_eff == 1.0
    assert PURE_DT.reactant_product == 0.25


def test_quasi_neutrality_with_impurities():
    plasma = Plasma(helium_fraction=0.05, impurity_fraction=0.01, impurity_charge=6)
    electrons_from_ions = plasma.fuel_fraction + 2 * 0.05 + 6 * 0.01
    assert electrons_from_ions == pytest.approx(1.0)
    assert plasma.z_eff == pytest.approx(plasma.fuel_fraction + 4 * 0.05 + 36 * 0.01)


def test_ignition_is_impossible_below_ideal_ignition_temperature():
    threshold = ideal_ignition_temperature()
    assert math.isinf(lawson_parameter(threshold - 0.2))
    assert math.isfinite(lawson_parameter(threshold + 0.2))


def test_alpha_heating_equals_bremsstrahlung_at_ideal_ignition_temperature():
    threshold = ideal_ignition_temperature()
    assert alpha_power_coefficient(threshold) == pytest.approx(
        bremsstrahlung_coefficient(threshold), rel=1e-9
    )


def test_higher_gain_needs_better_confinement():
    values = [lawson_parameter(15.0, q) for q in (1.0, 2.0, 5.0, 10.0, math.inf)]
    assert values == sorted(values)


def test_gain_and_lawson_parameter_are_inverse_functions():
    for q_fuel in (0.5, 1.0, 7.0, 30.0):
        n_tau = lawson_parameter(15.0, q_fuel)
        assert q_fuel_from_state(15.0, n_tau) == pytest.approx(q_fuel, rel=1e-9)
    assert math.isinf(q_fuel_from_state(15.0, 2.0 * lawson_parameter(15.0)))


def test_triple_product_is_temperature_times_lawson_parameter():
    temperature = np.array([8.0, 15.0, 30.0])
    assert np.allclose(triple_product(temperature), temperature * lawson_parameter(temperature))


def test_bremsstrahlung_raises_the_ignition_threshold():
    with_loss = minimum_triple_product(bremsstrahlung=True)[1]
    without_loss = minimum_triple_product(bremsstrahlung=False)[1]
    assert without_loss < with_loss < 1.15 * without_loss


def test_pulsed_gain_saturates_at_the_radiation_limit():
    """With no self-heating, Q is capped at fusion power / bremsstrahlung power."""
    temperature = 20.0
    cap = reactivity_dt(temperature) * E_FUSION_KEV * KEV_TO_J / (4.0 * C_BREMS * math.sqrt(temperature))
    assert q_fuel_pulsed(temperature, 1e30) == pytest.approx(cap, rel=1e-6)
    assert q_fuel_pulsed(temperature, 1e19) < q_fuel_pulsed(temperature, 1e20) < cap


def test_invalid_inputs_are_rejected():
    with pytest.raises(ValueError):
        lawson_parameter(15.0, q_fuel=0.0)
    with pytest.raises(ValueError):
        Plasma(tritium_fraction=1.0)
    with pytest.raises(ValueError):
        Plasma(helium_fraction=0.6)
