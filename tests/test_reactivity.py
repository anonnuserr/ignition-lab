"""Checks on the D-T cross-section and reactivity."""

import numpy as np
import pytest

from lawson import (
    cross_section_dt,
    reactivity_dt,
    reactivity_dt_integrated,
    reactivity_dt_quadratic,
)


def test_cross_section_resonance_peak():
    """The D-T cross-section peaks at about 5 barns near 64 keV (centre of mass)."""
    energy = np.linspace(20.0, 150.0, 13001)
    sigma = cross_section_dt(energy)
    assert 4.9 < sigma.max() < 5.2
    assert 60.0 < energy[sigma.argmax()] < 70.0


def test_cross_section_continuous_at_switch_energy():
    """Low- and high-energy fits join smoothly at 530 keV."""
    assert cross_section_dt(529.9) == pytest.approx(cross_section_dt(530.1), rel=5e-3)


def test_fit_agrees_with_direct_integration():
    """Two independent Bosch-Hale parametrisations give the same reactivity.

    The closed-form fit and the Maxwellian integral of the cross-section share
    no coefficients, so agreement to about 1% validates both implementations.
    """
    temperature = np.geomspace(0.5, 100.0, 60)
    ratio = reactivity_dt_integrated(temperature) / reactivity_dt(temperature)
    assert np.max(np.abs(ratio - 1.0)) < 0.01


def test_integration_is_converged():
    coarse = reactivity_dt_integrated(15.0, points=3000)
    fine = reactivity_dt_integrated(15.0, points=12000)
    assert coarse == pytest.approx(fine, rel=1e-5)


def test_reactivity_peak():
    """Reactivity peaks at roughly 9e-22 m^3/s between 60 and 70 keV."""
    temperature = np.linspace(40.0, 100.0, 6001)
    sigma_v = reactivity_dt(temperature)
    assert 8.8e-22 < sigma_v.max() < 9.1e-22
    assert 60.0 < temperature[sigma_v.argmax()] < 70.0


def test_reactivity_rises_steeply_at_low_temperature():
    assert reactivity_dt(10.0) / reactivity_dt(1.0) > 1.0e4


@pytest.mark.parametrize("temperature", [0.1, 150.0])
def test_reactivity_rejects_temperatures_outside_fit_range(temperature):
    with pytest.raises(ValueError):
        reactivity_dt(temperature)


@pytest.mark.parametrize("energy", [0.1, 5000.0])
def test_cross_section_rejects_energies_outside_fit_range(energy):
    with pytest.raises(ValueError):
        cross_section_dt(energy)


def test_quadratic_approximation_is_good_only_in_its_window():
    """1.1e-24 T^2 is within about 10% for 10-20 keV and much worse outside it.

    The largest deviation in the window is 10.5%, at about 16.5 keV.
    """
    inside = np.linspace(10.0, 20.0, 101)
    error = reactivity_dt_quadratic(inside) / reactivity_dt(inside) - 1.0
    assert 0.09 < np.max(np.abs(error)) < 0.11
    assert abs(reactivity_dt_quadratic(5.0) / reactivity_dt(5.0) - 1.0) > 0.5
