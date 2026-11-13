"""Checks on the zero-dimensional tokamak model."""

import dataclasses
import math

import numpy as np
import pytest

from lawson import reactor
from lawson.reactor import (
    ITER,
    ITER_PUBLISHED,
    ITER_SCENARIO,
    SPARC,
    SPARC_PUBLISHED,
    SPARC_SCENARIO,
    Composition,
    Scenario,
    Tokamak,
    solve,
)


# --- Reproduction of published designs ------------------------------------------------

def test_sparc_projection_is_reproduced():
    """Creely et al. (2020), Table 2. Every model input is taken from that paper."""
    result = solve(SPARC, SPARC_SCENARIO)
    assert result.status == "steady"
    assert result.fusion_power == pytest.approx(SPARC_PUBLISHED["fusion_power"], rel=0.05)
    assert result.gain == pytest.approx(SPARC_PUBLISHED["gain"], rel=0.05)
    assert result.confinement_time == pytest.approx(SPARC_PUBLISHED["confinement_time"], rel=0.05)
    assert result.average_temperature == pytest.approx(SPARC_PUBLISHED["average_temperature"], rel=0.06)
    assert result.beta_normalised == pytest.approx(SPARC_PUBLISHED["beta_normalised"], abs=0.15)


def test_sparc_conservative_confinement_still_gives_about_q2():
    """The paper states Q > 2 is reached with H98 = 0.7; the model gives about 2."""
    result = solve(SPARC, dataclasses.replace(SPARC_SCENARIO, h_factor=0.7))
    assert 1.5 < result.gain < 3.0


def test_sparc_cylindrical_safety_factor():
    """Table 2 lists q* (Uckan) = 3.05."""
    assert SPARC.q_cylindrical == pytest.approx(SPARC_PUBLISHED["q_cylindrical"], abs=0.03)


def test_sparc_density_is_the_published_greenwald_fraction():
    """The paper's f_G = 0.37 is volume-averaged density over the Greenwald density."""
    assert SPARC_SCENARIO.density / SPARC.greenwald_density == pytest.approx(0.37, abs=0.01)


def test_iter_design_point_is_reproduced_with_broad_temperature_profile():
    result = solve(ITER, ITER_SCENARIO)
    assert result.gain == pytest.approx(ITER_PUBLISHED["gain"], rel=0.05)
    assert result.fusion_power == pytest.approx(ITER_PUBLISHED["fusion_power"], rel=0.05)
    assert result.confinement_time == pytest.approx(ITER_PUBLISHED["confinement_time"], rel=0.05)
    assert result.greenwald_fraction == pytest.approx(0.85, abs=0.01)
    assert ITER.q95 == pytest.approx(3.0, abs=0.2)


def test_iter_volume_matches_published_value():
    assert ITER.volume == pytest.approx(ITER_PUBLISHED["volume"], rel=0.03)


def test_iter_gain_is_sensitive_to_temperature_peaking():
    """The same ITER inputs give Q of about 10 or about 17 depending on one assumption."""
    peaked = solve(ITER, dataclasses.replace(ITER_SCENARIO, temperature_peaking=2.5))
    assert 15.0 < peaked.gain < 20.0
    assert peaked.gain > 1.5 * solve(ITER, ITER_SCENARIO).gain


# --- Formulas ---------------------------------------------------------------------------

def test_confinement_scaling_matches_hand_calculation():
    """IPB98(y,2) at ITER-like values: about 3.6 s for 87 MW of loss power."""
    machine = Tokamak(6.2, 2.0, 1.7, 0.33, 5.3, 15.0)
    tau = reactor.confinement_time(machine, 1.01e20, 87.0, 2.5)
    expected = (
        0.0562 * 15.0**0.93 * 5.3**0.15 * 10.1**0.41 * 87.0**-0.69 * 6.2**1.97 * 1.7**0.78
        * (2.0 / 6.2) ** 0.58 * 2.5**0.19
    )
    assert tau == pytest.approx(expected, rel=1e-12)
    assert tau == pytest.approx(3.6, abs=0.1)


def test_greenwald_density():
    assert ITER.greenwald_density == pytest.approx(15.0 / (math.pi * 4.0) * 1e20)


def test_torus_volume_reduces_to_simple_formula_at_large_aspect_ratio():
    slim = Tokamak(100.0, 1.0, 1.0, 0.0, 5.0, 1.0)
    assert slim.volume == pytest.approx(2.0 * math.pi**2 * 100.0, rel=0.01)


def test_line_average_factor_limits():
    assert reactor.line_average_factor(1.0) == pytest.approx(1.0)
    assert reactor.line_average_factor(2.0) == pytest.approx(2.0 / 3.0)


def test_profile_quadrature_matches_closed_forms():
    """Numerical profile integrals agree with the analytic stored energy and volume average."""
    alpha = 0.7
    numeric = np.sum(reactor.U_WEIGHTS * (1.0 - reactor.U_NODES) ** alpha)
    assert numeric == pytest.approx(1.0 / (1.0 + alpha), rel=1e-4)


def test_h_mode_threshold_scaling():
    """Martin (2008): 0.0488 n20^0.717 B^0.803 S^0.941, times 2/M."""
    machine = Tokamak(6.2, 2.0, 1.75, 0.33, 5.3, 15.0)
    expected = 0.0488 * 1.0**0.717 * 5.3**0.803 * machine.surface_area**0.941 * 2.0 / 2.5
    assert reactor.lh_threshold(machine, 1.0e20, 2.5) == pytest.approx(expected, rel=1e-12)


def test_composition_bookkeeping():
    comp = Composition(impurities=((2, 0.032), (4, 0.02), (18, 0.0012)))
    assert comp.fuel_fraction + 2 * 0.032 + 4 * 0.02 + 18 * 0.0012 == pytest.approx(1.0)
    assert comp.z_eff == pytest.approx(1.67, abs=0.01)
    assert Composition().z_eff == 1.0
    assert Composition().fuel_mass == 2.5


# --- Behaviour ----------------------------------------------------------------------------

def test_power_balance_closes():
    result = solve(SPARC, SPARC_SCENARIO)
    assert result.loss_power == pytest.approx(
        SPARC_SCENARIO.heating_power + result.alpha_power - result.radiated_power
    )
    assert result.stored_energy == pytest.approx(result.confinement_time * result.loss_power)
    line = result.line_density
    tau = reactor.confinement_time(SPARC, line, result.loss_power, 2.5, SPARC_SCENARIO.h_factor)
    assert tau == pytest.approx(result.confinement_time, rel=1e-6)


def test_better_confinement_and_bigger_machines_raise_gain():
    base = solve(SPARC, SPARC_SCENARIO).gain
    assert solve(SPARC, dataclasses.replace(SPARC_SCENARIO, h_factor=1.1)).gain > base
    bigger = Tokamak(2.2, 2.2 * 0.57 / 1.85, 1.75, 0.45, 12.2, SPARC.current).with_q95(SPARC.q95)
    assert bigger.q95 == pytest.approx(SPARC.q95, rel=1e-9)
    assert solve(bigger, SPARC_SCENARIO).gain > base


def test_impurities_lower_gain():
    clean = dataclasses.replace(SPARC_SCENARIO, composition=Composition())
    assert solve(SPARC, clean).gain > solve(SPARC, SPARC_SCENARIO).gain


def test_with_q95_sets_the_current():
    assert SPARC.with_q95(4.0).q95 == pytest.approx(4.0)


def test_no_fusion_without_heating_in_a_small_cold_machine():
    small = Tokamak(1.0, 0.3, 1.6, 0.3, 2.0, 0.5)
    result = solve(small, Scenario(density=3e19, heating_power=0.0))
    assert result.status == "no_solution"
    assert result.fusion_power == 0.0
    assert not result.ignition_possible


def test_radiation_barrier_is_skipped_and_reported():
    """A large, dense, high-field machine with modest heating.

    At full density the heating cannot overcome radiation near 1 keV, but a
    burning state exists above it. The model reports that state and flags the
    barrier rather than returning a radiatively collapsed plasma.
    """
    big = Tokamak(6.0, 6.0 / 3.25, 1.75, 0.45, 12.0, 1.0).with_q95(3.62)
    scenario = Scenario(density=0.37 * big.greenwald_density, heating_power=12.8, density_peaking=1.4,
                        temperature_peaking=2.5, radiation_factor=2.25, composition=SPARC_SCENARIO.composition)
    result = solve(big, scenario)
    assert result.radiation_barrier
    assert result.status in ("steady", "runaway")
    assert result.gain > 10.0
    assert not solve(SPARC, SPARC_SCENARIO).radiation_barrier
    assert not solve(ITER, ITER_SCENARIO).radiation_barrier


def test_reported_operating_points_are_transport_dominated():
    """Wherever the model reports a steady state, transport carries more power than radiation."""
    import random

    rng = random.Random(7)
    for _ in range(300):
        r = rng.uniform(0.8, 9.0)
        machine = Tokamak(r, r / rng.uniform(2.4, 4.5), rng.uniform(1.3, 2.0), rng.uniform(0.0, 0.6),
                          rng.uniform(1.5, 14.0), 1.0).with_q95(rng.uniform(2.6, 5.0))
        scenario = Scenario(
            density=rng.uniform(0.25, 0.95) * machine.greenwald_density, heating_power=rng.uniform(0.0, 80.0),
            h_factor=rng.uniform(0.7, 1.3), radiation_factor=rng.uniform(1.0, 2.5),
            composition=Composition(impurities=((2, rng.uniform(0.0, 0.08)), (6, rng.uniform(0.0, 0.01)))),
        )
        result = solve(machine, scenario)
        if result.status == "steady":
            assert result.loss_power > result.radiated_power


def test_published_designs_are_unchanged_by_the_barrier_logic():
    assert solve(SPARC, SPARC_SCENARIO).gain == pytest.approx(11.05, abs=0.05)
    assert solve(ITER, ITER_SCENARIO).gain == pytest.approx(10.3, abs=0.1)


def test_invalid_inputs_are_rejected():
    with pytest.raises(ValueError):
        Tokamak(1.0, 1.5, 1.7, 0.3, 5.0, 1.0)
    with pytest.raises(ValueError):
        Scenario(density=1e20, heating_power=-1.0)
    with pytest.raises(ValueError):
        Scenario(density=1e20, heating_power=10.0, temperature_peaking=0.8)
    with pytest.raises(ValueError):
        Composition(impurities=((6, 0.2),))
