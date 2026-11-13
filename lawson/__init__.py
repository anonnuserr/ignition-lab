"""Lawson criteria for deuterium-tritium fusion: reactivity, ignition and gain."""

from .criteria import (
    PURE_DT,
    Plasma,
    alpha_power_coefficient,
    bremsstrahlung_coefficient,
    fusion_power_coefficient,
    icf_ignition_lawson_parameter,
    ideal_ignition_temperature,
    lawson_parameter,
    minimum_lawson_parameter,
    minimum_triple_product,
    q_fuel_from_state,
    q_fuel_pulsed,
    triple_product,
)
from .reactivity import (
    cross_section_dt,
    reactivity_dt,
    reactivity_dt_integrated,
    reactivity_dt_quadratic,
)

__version__ = "1.0.0"

__all__ = [
    "PURE_DT",
    "Plasma",
    "alpha_power_coefficient",
    "bremsstrahlung_coefficient",
    "cross_section_dt",
    "fusion_power_coefficient",
    "icf_ignition_lawson_parameter",
    "ideal_ignition_temperature",
    "lawson_parameter",
    "minimum_lawson_parameter",
    "minimum_triple_product",
    "q_fuel_from_state",
    "q_fuel_pulsed",
    "reactivity_dt",
    "reactivity_dt_integrated",
    "reactivity_dt_quadratic",
    "triple_product",
]
