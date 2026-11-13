"""Sensitivity of the ignition threshold to plasma composition and to the
reactivity model.

Every function returns the *penalty factor*: the minimum triple product needed
for ignition in the perturbed case divided by the pure 50:50 D-T value. A
penalty of 1.5 means the plasma must reach a 50% higher n_e T tau_E to ignite.

Scope and limits
----------------
* Only bremsstrahlung is included as a radiation loss. Line radiation and
  synchrotron radiation are neglected, so the impurity penalties are lower
  bounds.
* Impurities are treated as fully ionised, which is a good approximation for
  low-Z species (He, Be, C, Ne) at ignition temperatures but not for
  high-Z wall materials such as tungsten, which are therefore not modelled.
"""

from __future__ import annotations

import math

import numpy as np

from .constants import E_ALPHA_KEV, KEV_TO_J
from .criteria import PURE_DT, Plasma, ideal_ignition_temperature, minimum_triple_product
from .reactivity import reactivity_dt, reactivity_dt_quadratic

#: Low-Z impurity species considered: name -> nuclear charge.
SPECIES = {"Helium": 2, "Beryllium": 4, "Carbon": 6, "Neon": 10}


def _plasma_with(species: str, fraction: float) -> Plasma:
    charge = SPECIES[species]
    if charge == 2:
        return Plasma(helium_fraction=fraction)
    return Plasma(impurity_fraction=fraction, impurity_charge=charge)


def reference_triple_product() -> float:
    """Minimum ignition triple product of pure 50:50 D-T, keV m^-3 s."""
    return minimum_triple_product(math.inf, PURE_DT)[1]


def impurity_penalty(species: str, fractions) -> np.ndarray:
    """Ignition penalty factor against impurity concentration n_Z / n_e."""
    reference = reference_triple_product()
    return np.array(
        [minimum_triple_product(math.inf, _plasma_with(species, f))[1] / reference for f in fractions]
    )


def impurity_summary(species: str, fraction: float) -> dict:
    """Z_eff, fuel dilution, ideal ignition temperature and penalty for one case."""
    plasma = _plasma_with(species, fraction)
    t_min, value = minimum_triple_product(math.inf, plasma)
    return {
        "species": species,
        "fraction": fraction,
        "z_eff": plasma.z_eff,
        "fuel_fraction": plasma.fuel_fraction,
        "ideal_ignition_temperature_kev": ideal_ignition_temperature(plasma),
        "optimum_temperature_kev": t_min,
        "min_triple_product": value,
        "penalty": value / reference_triple_product(),
    }


def fuel_mix_penalty(tritium_fractions) -> np.ndarray:
    """Ignition penalty factor against tritium fraction n_T / (n_D + n_T)."""
    reference = reference_triple_product()
    return np.array(
        [minimum_triple_product(math.inf, Plasma(tritium_fraction=x))[1] / reference for x in tritium_fractions]
    )


def quadratic_approximation_error(temperatures) -> np.ndarray:
    """Relative error of the <sigma v> = 1.1e-24 T^2 approximation."""
    t = np.asarray(temperatures, dtype=float)
    return reactivity_dt_quadratic(t) / reactivity_dt(t) - 1.0


def textbook_triple_product() -> float:
    """Ignition triple product from the textbook shortcut, keV m^-3 s.

    With <sigma v> = 1.1e-24 T^2 and bremsstrahlung neglected, the ignition
    condition n T tau_E = 12 T^2 / (<sigma v> eps_alpha) becomes a constant.
    """
    return 12.0 * KEV_TO_J / (1.1e-24 * E_ALPHA_KEV * KEV_TO_J)
