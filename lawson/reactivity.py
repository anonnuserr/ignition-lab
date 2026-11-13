"""Deuterium-tritium fusion cross-section and thermal reactivity.

Three independent routes to the Maxwellian-averaged reactivity <sigma v> are
provided so that they can be checked against each other:

1. ``reactivity_dt``            - the Bosch-Hale closed-form fit (their Eq. 12,
                                  Table VII). This is the function used by the
                                  rest of the package.
2. ``reactivity_dt_integrated`` - direct numerical integration of the
                                  Bosch-Hale cross-section (their Eq. 8-9,
                                  Table IV) over a Maxwellian distribution.
3. ``reactivity_dt_quadratic``  - the textbook approximation
                                  <sigma v> = 1.1e-24 T^2 m^3/s, valid only
                                  for roughly 10-20 keV.

Reference: H.-S. Bosch and G. M. Hale, "Improved formulas for fusion
cross-sections and thermal reactivities", Nucl. Fusion 32, 611 (1992).
"""

from __future__ import annotations

import numpy as np

from .constants import B_GAMOW, C_LIGHT, MU_C2_KEV, T_MAX_KEV, T_MIN_KEV

# --- Cross-section (Bosch & Hale Table IV) ---------------------------------
# S-factor Pade coefficients, S in keV mb, centre-of-mass energy E in keV.
_A_LOW = (6.927e4, 7.454e8, 2.050e6, 5.2002e4, 0.0)
_B_LOW = (6.38e1, -9.95e-1, 6.981e-5, 1.728e-4)
_A_HIGH = (-1.4714e6, 0.0, 0.0, 0.0, 0.0)
_B_HIGH = (-8.4127e-3, 4.7983e-6, -1.0748e-9, 8.5184e-14)

#: Validity range of the cross-section parametrisation, keV (centre of mass).
E_MIN_KEV = 0.5
E_MAX_KEV = 4700.0
#: Energy at which Bosch & Hale recommend switching to the high-energy fit.
E_SWITCH_KEV = 530.0

# --- Reactivity fit (Bosch & Hale Table VII) --------------------------------
_C = (1.17302e-9, 1.51361e-2, 7.51886e-2, 4.60643e-3, 1.35000e-2, -1.06750e-4, 1.36600e-5)

MILLIBARN_TO_M2 = 1.0e-31


def _s_factor(energy, a, b):
    """Astrophysical S-factor in keV mb (Bosch & Hale Eq. 9)."""
    numerator = a[0] + energy * (a[1] + energy * (a[2] + energy * (a[3] + energy * a[4])))
    denominator = 1.0 + energy * (b[0] + energy * (b[1] + energy * (b[2] + energy * b[3])))
    return numerator / denominator


def cross_section_dt(energy_kev):
    """D-T fusion cross-section in barns.

    Parameters
    ----------
    energy_kev : float or array
        Centre-of-mass energy in keV, within 0.5-4700 keV.

    Returns
    -------
    float or ndarray
        Cross-section in barns (1 b = 1e-28 m^2).
    """
    energy = np.asarray(energy_kev, dtype=float)
    if np.any(energy < E_MIN_KEV) or np.any(energy > E_MAX_KEV):
        raise ValueError(
            f"Cross-section fit is valid for {E_MIN_KEV}-{E_MAX_KEV} keV (centre of mass)."
        )
    s_low = _s_factor(energy, _A_LOW, _B_LOW)
    s_high = _s_factor(energy, _A_HIGH, _B_HIGH)
    s = np.where(energy < E_SWITCH_KEV, s_low, s_high)
    sigma_mb = s / (energy * np.exp(B_GAMOW / np.sqrt(energy)))
    result = sigma_mb * 1.0e-3
    return float(result) if result.ndim == 0 else result


def _check_temperature(temperature):
    temperature = np.asarray(temperature, dtype=float)
    if np.any(temperature < T_MIN_KEV) or np.any(temperature > T_MAX_KEV):
        raise ValueError(
            f"Reactivity fit is valid for {T_MIN_KEV}-{T_MAX_KEV} keV; "
            "results outside this range are not physical."
        )
    return temperature


def reactivity_dt(temperature_kev):
    """D-T thermal reactivity <sigma v> in m^3/s from the Bosch-Hale fit.

    Parameters
    ----------
    temperature_kev : float or array
        Ion temperature in keV, within 0.2-100 keV.
    """
    t = _check_temperature(temperature_kev)
    c1, c2, c3, c4, c5, c6, c7 = _C
    theta = t / (1.0 - t * (c2 + t * (c4 + t * c6)) / (1.0 + t * (c3 + t * (c5 + t * c7))))
    xi = (B_GAMOW**2 / (4.0 * theta)) ** (1.0 / 3.0)
    sigma_v_cm3 = c1 * theta * np.sqrt(xi / (MU_C2_KEV * t**3)) * np.exp(-3.0 * xi)
    result = sigma_v_cm3 * 1.0e-6
    return float(result) if result.ndim == 0 else result


def reactivity_dt_integrated(temperature_kev, points=6000):
    """D-T thermal reactivity in m^3/s by direct Maxwellian integration.

    Evaluates

        <sigma v> = sqrt(8 / (pi mu)) (kT)^(-3/2) Int sigma(E) E exp(-E/kT) dE

    with the Bosch-Hale cross-section, on a logarithmic energy grid using the
    trapezoidal rule. This does not use the reactivity fit at all, so agreement
    between the two is a genuine check of both.
    """
    temperatures = np.atleast_1d(_check_temperature(temperature_kev))
    prefactor = C_LIGHT * np.sqrt(8.0 / (np.pi * MU_C2_KEV))
    out = np.empty_like(temperatures)
    for i, t in enumerate(temperatures):
        upper = min(E_MAX_KEV, 40.0 * t + 100.0)
        energy = np.geomspace(E_MIN_KEV, upper, points)
        sigma_m2 = cross_section_dt(energy) * 1.0e-28
        integrand = sigma_m2 * energy * np.exp(-energy / t)
        integral = np.sum(0.5 * (integrand[1:] + integrand[:-1]) * np.diff(energy))
        out[i] = prefactor * integral / t**1.5
    return float(out[0]) if np.ndim(temperature_kev) == 0 else out


def reactivity_dt_quadratic(temperature_kev):
    """Textbook approximation <sigma v> = 1.1e-24 T^2 m^3/s (T in keV).

    A common textbook shortcut (e.g. J. Wesson, *Tokamaks*), quoted as good to
    about 10% for 10-20 keV. Provided only to quantify the error it introduces.
    """
    t = np.asarray(temperature_kev, dtype=float)
    result = 1.1e-24 * t**2
    return float(result) if result.ndim == 0 else result
