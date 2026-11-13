"""Lawson criteria for a deuterium-tritium plasma.

Power balance of a uniform, steady-state plasma with T_i = T_e = T:

    P_abs + f_c P_F = P_B + W / tau_E

where P_F is the fusion power, f_c the fraction of it carried by charged
particles (alphas), P_B the bremsstrahlung loss, W the thermal energy and
tau_E the energy confinement time. Defining the fuel gain Q_fuel = P_F/P_abs
and solving for the Lawson parameter gives, for a pure 50:50 D-T plasma,

    n tau_E = 3 T / [ (f_c + 1/Q_fuel) <sigma v> eps_F / 4 - C_B T^(1/2) ]

which is Eq. (16) of Wurzel & Hsu, Phys. Plasmas 29, 062103 (2022).

This module implements a slightly more general form that also allows an
unequal fuel mix, helium ash and one fully ionised impurity species. With
electron density n_e, fuel-ion fraction f_DT = (n_D + n_T)/n_e, tritium
fraction x = n_T/(n_D + n_T) and total ion fraction f_i = sum(n_j)/n_e:

    n_e tau_E = (3/2)(1 + f_i) T
                / [ (f_c + 1/Q_fuel) x(1-x) f_DT^2 <sigma v> eps_F
                    - C_B Z_eff T^(1/2) ]

For x = 1/2, f_DT = f_i = Z_eff = 1 this reduces exactly to the equation above.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .constants import (
    ALPHA_FRACTION,
    C_BREMS,
    E_ALPHA_KEV,
    E_FUSION_KEV,
    KEV_TO_J,
    T_MAX_KEV,
    T_MIN_KEV,
)
from .reactivity import reactivity_dt


@dataclass(frozen=True)
class Plasma:
    """Composition of a quasi-neutral D-T plasma.

    Parameters
    ----------
    tritium_fraction : float
        n_T / (n_D + n_T). 0.5 is the optimum.
    helium_fraction : float
        Helium "ash" density over electron density, n_He / n_e (Z = 2).
    impurity_fraction : float
        Impurity density over electron density, n_Z / n_e.
    impurity_charge : int
        Charge of the impurity ion, assumed fully ionised.
    """

    tritium_fraction: float = 0.5
    helium_fraction: float = 0.0
    impurity_fraction: float = 0.0
    impurity_charge: int = 6

    def __post_init__(self):
        if not 0.0 < self.tritium_fraction < 1.0:
            raise ValueError("tritium_fraction must lie strictly between 0 and 1.")
        if self.helium_fraction < 0.0 or self.impurity_fraction < 0.0:
            raise ValueError("Impurity fractions cannot be negative.")
        if self.fuel_fraction <= 0.0:
            raise ValueError("Impurity content leaves no room for fuel ions.")

    @property
    def fuel_fraction(self):
        """(n_D + n_T) / n_e from quasi-neutrality."""
        return 1.0 - 2.0 * self.helium_fraction - self.impurity_charge * self.impurity_fraction

    @property
    def ion_fraction(self):
        """Total ion density over electron density."""
        return self.fuel_fraction + self.helium_fraction + self.impurity_fraction

    @property
    def z_eff(self):
        """Effective charge, sum(n_j Z_j^2) / n_e."""
        return (
            self.fuel_fraction
            + 4.0 * self.helium_fraction
            + self.impurity_charge**2 * self.impurity_fraction
        )

    @property
    def reactant_product(self):
        """n_D n_T / n_e^2."""
        x = self.tritium_fraction
        return x * (1.0 - x) * self.fuel_fraction**2


#: Pure, equimolar D-T plasma: the reference case.
PURE_DT = Plasma()


# --- Power densities (per n_e^2, so density-independent) --------------------

def fusion_power_coefficient(temperature_kev, plasma=PURE_DT):
    """Fusion power density divided by n_e^2, in W m^3."""
    return plasma.reactant_product * reactivity_dt(temperature_kev) * E_FUSION_KEV * KEV_TO_J


def alpha_power_coefficient(temperature_kev, plasma=PURE_DT):
    """Alpha-particle heating power density divided by n_e^2, in W m^3."""
    return ALPHA_FRACTION * fusion_power_coefficient(temperature_kev, plasma)


def bremsstrahlung_coefficient(temperature_kev, plasma=PURE_DT):
    """Bremsstrahlung power density divided by n_e^2, in W m^3."""
    return C_BREMS * plasma.z_eff * np.sqrt(np.asarray(temperature_kev, dtype=float))


# --- Lawson's first insight --------------------------------------------------

def ideal_ignition_temperature(plasma=PURE_DT):
    """Lowest temperature (keV) at which alpha heating balances bremsstrahlung.

    Below this temperature a plasma cannot ignite even with perfect
    confinement. Returns ``nan`` if no such temperature exists in 0.2-100 keV.
    """

    def net(t):
        return float(alpha_power_coefficient(t, plasma) - bremsstrahlung_coefficient(t, plasma))

    grid = np.geomspace(T_MIN_KEV, T_MAX_KEV, 2000)
    values = alpha_power_coefficient(grid, plasma) - bremsstrahlung_coefficient(grid, plasma)
    crossings = np.where((values[:-1] < 0.0) & (values[1:] >= 0.0))[0]
    if crossings.size == 0:
        return math.nan
    low, high = grid[crossings[0]], grid[crossings[0] + 1]
    for _ in range(80):
        mid = 0.5 * (low + high)
        if net(mid) >= 0.0:
            high = mid
        else:
            low = mid
    return 0.5 * (low + high)


# --- Lawson's second insight (pulsed, no self-heating) -----------------------

def q_fuel_pulsed(temperature_kev, n_tau):
    """Fuel gain of Lawson's pulsed scenario, pure D-T (Wurzel & Hsu Eq. 10).

    The plasma is heated instantly to T and held for a time tau; all fusion
    products and radiation escape, so there is no self-heating.
    """
    t = np.asarray(temperature_kev, dtype=float)
    fusion = reactivity_dt(t) * E_FUSION_KEV * KEV_TO_J / (12.0 * t * KEV_TO_J)
    radiation = C_BREMS * np.sqrt(t) / (3.0 * t * KEV_TO_J)
    return fusion / (radiation + 1.0 / n_tau)


# --- Steady-state criteria ----------------------------------------------------

def _denominator(t, q_fuel, plasma, bremsstrahlung):
    inverse_q = 0.0 if math.isinf(q_fuel) else 1.0 / q_fuel
    heating = (ALPHA_FRACTION + inverse_q) * fusion_power_coefficient(t, plasma)
    loss = bremsstrahlung_coefficient(t, plasma) if bremsstrahlung else 0.0
    return heating - loss


def lawson_parameter(temperature_kev, q_fuel=math.inf, plasma=PURE_DT, bremsstrahlung=True):
    """Required n_e tau_E (m^-3 s) to reach a given fuel gain at temperature T.

    Parameters
    ----------
    temperature_kev : float or array
        Temperature in keV (0.2-100).
    q_fuel : float
        Target fuel gain; ``math.inf`` (default) means ignition.
    plasma : Plasma
        Composition. Defaults to pure 50:50 D-T.
    bremsstrahlung : bool
        Set False to switch the radiation loss off (for comparison only).

    Returns
    -------
    float or ndarray
        Lawson parameter; ``inf`` where the target cannot be reached.
    """
    if q_fuel <= 0.0:
        raise ValueError("q_fuel must be positive.")
    t = np.asarray(temperature_kev, dtype=float)
    stored = 1.5 * (1.0 + plasma.ion_fraction) * t * KEV_TO_J
    denominator = np.asarray(_denominator(t, q_fuel, plasma, bremsstrahlung), dtype=float)
    result = np.full(t.shape, np.inf)
    np.divide(stored, denominator, out=result, where=denominator > 0.0)
    return float(result) if result.ndim == 0 else result


def triple_product(temperature_kev, q_fuel=math.inf, plasma=PURE_DT, bremsstrahlung=True):
    """Required n_e T tau_E (keV m^-3 s) to reach a given fuel gain."""
    t = np.asarray(temperature_kev, dtype=float)
    result = t * lawson_parameter(t, q_fuel, plasma, bremsstrahlung)
    return float(result) if np.ndim(result) == 0 else result


def _minimise(function, step=0.005):
    """Minimum of ``function`` over the fit's validity range; returns (T, value)."""
    count = int(round((T_MAX_KEV - T_MIN_KEV) / step)) + 1
    grid = np.linspace(T_MIN_KEV, T_MAX_KEV, count)
    step = grid[1] - grid[0]
    values = function(grid)
    i = int(np.argmin(values))
    if 0 < i < grid.size - 1 and np.all(np.isfinite(values[i - 1 : i + 2])):
        # Parabolic refinement through the three points around the minimum.
        y0, y1, y2 = values[i - 1 : i + 2]
        curvature = y0 - 2.0 * y1 + y2
        if curvature > 0.0:
            shift = 0.5 * (y0 - y2) / curvature
            return float(grid[i] + shift * step), float(y1 - 0.25 * (y0 - y2) * shift)
    return float(grid[i]), float(values[i])


def minimum_lawson_parameter(q_fuel=math.inf, plasma=PURE_DT, bremsstrahlung=True):
    """(T_keV, n tau_E) at the minimum of the Lawson-parameter curve."""
    return _minimise(lambda t: lawson_parameter(t, q_fuel, plasma, bremsstrahlung))


def minimum_triple_product(q_fuel=math.inf, plasma=PURE_DT, bremsstrahlung=True):
    """(T_keV, n T tau_E) at the minimum of the triple-product curve."""
    return _minimise(lambda t: triple_product(t, q_fuel, plasma, bremsstrahlung))


def q_fuel_from_state(temperature_kev, n_tau, plasma=PURE_DT):
    """Fuel gain a uniform plasma would reach at a given T and n_e tau_E.

    Inverse of :func:`lawson_parameter`. Returns ``inf`` when the state is at
    or beyond ignition.
    """
    t = float(temperature_kev)
    stored = 1.5 * (1.0 + plasma.ion_fraction) * t * KEV_TO_J
    fusion = float(fusion_power_coefficient(t, plasma))
    inverse_q = (stored / n_tau + float(bremsstrahlung_coefficient(t, plasma))) / fusion - ALPHA_FRACTION
    return math.inf if inverse_q <= 0.0 else 1.0 / inverse_q


# --- Inertial confinement ------------------------------------------------------

def icf_ignition_lawson_parameter(temperature_kev, f_alpha=1.4, theta_alpha=0.93):
    """Required n tau_stag (m^-3 s) for hot-spot ignition in laser fusion.

    Eq. (2) of Wurzel & Hsu, Phys. Plasmas 32, 112106 (2025):

        (n tau_stag) = (2 f_alpha / theta_alpha) * 12 T / (<sigma v> eps_alpha)

    with f_alpha = 1.4 (the Christopherson criterion) and theta_alpha = 0.93
    (fraction of alpha energy deposited in the hot spot, NIF conditions).
    tau_stag is the measured burn duration (full width at half maximum).
    """
    t = np.asarray(temperature_kev, dtype=float)
    ideal = 12.0 * t * KEV_TO_J / (reactivity_dt(t) * E_ALPHA_KEV * KEV_TO_J)
    result = (2.0 * f_alpha / theta_alpha) * ideal
    return float(result) if result.ndim == 0 else result
