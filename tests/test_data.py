"""Integrity of the transcribed experimental data and its physical consistency."""

import math

import pytest

from lawson import icf_ignition_lawson_parameter, lawson_parameter
from lawson.experiments import CATEGORIES, load_experiments

EXPERIMENTS = load_experiments()


def test_table_size():
    assert len(EXPERIMENTS) == 103
    assert sum(e.confinement == "ICF" for e in EXPERIMENTS) == 23
    assert sum(e.projected for e in EXPERIMENTS) == 2


def test_every_row_has_a_known_category_and_source():
    for e in EXPERIMENTS:
        assert e.category in CATEGORIES
        assert e.source.startswith("WH2025 Table")
        assert 1950 <= e.year <= 2040


@pytest.mark.parametrize("e", [e for e in EXPERIMENTS if e.density_m3 is not None], ids=lambda e: f"{e.project}-{e.shot}")
def test_lawson_parameter_matches_density_times_confinement_time(e):
    """Tabulated n tau equals n x tau to within two-significant-figure rounding."""
    assert e.density_m3 * e.confinement_time_s == pytest.approx(e.lawson_parameter, rel=0.06)


@pytest.mark.parametrize("e", EXPERIMENTS, ids=lambda e: f"{e.project}-{e.shot}")
def test_triple_product_matches_lawson_parameter_times_temperature(e):
    assert e.lawson_parameter * e.temperature_kev == pytest.approx(e.triple_product, rel=0.06)


def test_no_magnetic_experiment_has_reached_idealised_ignition():
    """Every achieved magnetic-confinement result lies below the ignition curve."""
    for e in EXPERIMENTS:
        if e.confinement == "MCF" and not e.projected and 0.2 <= e.temperature_kev <= 100.0:
            assert e.lawson_parameter < lawson_parameter(e.temperature_kev)


def test_iter_and_sparc_projections_exceed_idealised_ignition():
    for e in EXPERIMENTS:
        if e.projected:
            assert e.lawson_parameter > lawson_parameter(e.temperature_kev)


def test_only_nif_n210808_crosses_the_laser_ignition_threshold():
    """Independent check: the model singles out the one shot known to have ignited."""
    above = [
        e.shot
        for e in EXPERIMENTS
        if e.confinement == "ICF"
        and e.temperature_kev >= 0.2
        and e.lawson_parameter > icf_ignition_lawson_parameter(e.temperature_kev)
    ]
    assert above == ["N210808"]


def test_best_tokamak_results_reach_a_fifth_of_the_ignition_requirement():
    best = max(
        e.lawson_parameter / lawson_parameter(e.temperature_kev)
        for e in EXPERIMENTS
        if e.confinement == "MCF" and not e.projected and 4.5 <= e.temperature_kev <= 100.0
    )
    assert 0.15 < best < 0.25
    assert math.isfinite(best)
