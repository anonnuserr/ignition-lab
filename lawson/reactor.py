"""Zero-dimensional performance model of a tokamak ("reactor designer").

Given a machine (size, shape, magnetic field, plasma current) and an operating
scenario (density, heating power, confinement quality, impurities), the model
finds the plasma temperature at which heating and losses balance, and from it
the fusion power, the gain Q and the usual operating-limit indicators.

Method
------
The approach is the standard one used to scope ITER and SPARC:

* **Profiles.** Density and temperature vary across the plasma as
  x(rho) = x0 (1 - rho^2)^(nu - 1), where nu is the *peaking factor*
  (central value over volume average). Volume integrals are evaluated with
  dV = V d(rho^2).
* **Fusion power.** P_fus = eps_F * Int n_D n_T <sigma v>(T) dV, with the
  Bosch-Hale reactivity.
* **Radiation.** Bremsstrahlung, C_B Z_eff Int n_e^2 T^(1/2) dV, multiplied by
  a user-set factor to represent impurity line radiation.
* **Confinement.** The IPB98(y,2) H-mode scaling law [1]:

      tau_E = 0.0562 H I^0.93 B^0.15 n19^0.41 P^-0.69 R^1.97 kappa^0.78
              eps^0.58 M^0.19

  with I in MA, B in T, n19 the line-averaged density in 1e19 m^-3, P the
  power lost by transport in MW (heating plus alpha power minus radiation),
  R in m, kappa the areal elongation, eps = a/R and M the mean fuel mass.
* **Power balance.** The central temperature is found such that the thermal
  energy W equals tau_E times the loss power.

Formulas and their sources
--------------------------
[1] ITER Physics Basis, Nucl. Fusion 39, 2175 (1999); coefficients and
    definitions as quoted in Creely et al., J. Plasma Phys. 86, 865860502
    (2020), Eq. (4.1).
[2] Safety factor: ITER Physics Basis Ch. 1, Eq. (A-11).
[3] Greenwald density limit: n_G = I / (pi a^2), in 1e20 m^-3.
[4] Plasma volume and surface area: Sauter, Fusion Eng. Des. 112, 633 (2016),
    in the form used by the open code cfspopcon.
[5] H-mode power threshold: Martin and Takizuka, J. Phys.: Conf. Ser. 123,
    012033 (2008), with the 2/M isotope correction.

Limits of the model are listed in the project README.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .constants import ALPHA_FRACTION, C_BREMS, E_FUSION_KEV, KEV_TO_J, T_MAX_KEV, T_MIN_KEV
from .reactivity import reactivity_dt

MU_0 = 4.0e-7 * math.pi

#: IPB98(y,2) coefficient and exponents.
IPB98 = {"c": 0.0562, "i": 0.93, "b": 0.15, "n": 0.41, "p": -0.69, "r": 1.97, "k": 0.78, "e": 0.58, "m": 0.19}

#: Martin (2008) L-H threshold: P = c n20^n B^b S^s (MW), for deuterium.
MARTIN = {"c": 0.0488, "n": 0.717, "b": 0.803, "s": 0.941}

#: Quadrature order for the profile integrals.
QUADRATURE_POINTS = 48
_NODES, _WEIGHTS = np.polynomial.legendre.leggauss(QUADRATURE_POINTS)
#: Nodes and weights mapped to u = rho^2 in [0, 1].
U_NODES = 0.5 * (_NODES + 1.0)
U_WEIGHTS = 0.5 * _WEIGHTS

#: Central temperatures scanned when looking for the operating point, keV.
T0_SCAN = np.geomspace(0.5, T_MAX_KEV, 90)


@dataclass(frozen=True)
class Composition:
    """Fuel mix and impurity content of the plasma.

    Parameters
    ----------
    tritium_fraction : float
        n_T / (n_D + n_T).
    impurities : tuple of (charge, fraction)
        Fully ionised impurity species, each given as (Z, n_Z / n_e). Helium
        ash is the entry with Z = 2.
    """

    tritium_fraction: float = 0.5
    impurities: tuple = ()

    def __post_init__(self):
        if not 0.0 < self.tritium_fraction < 1.0:
            raise ValueError("tritium_fraction must lie strictly between 0 and 1.")
        if any(f < 0.0 for _, f in self.impurities):
            raise ValueError("Impurity fractions cannot be negative.")
        if self.fuel_fraction <= 0.0:
            raise ValueError("Impurity content leaves no room for fuel ions.")

    @property
    def fuel_fraction(self):
        """(n_D + n_T) / n_e."""
        return 1.0 - sum(z * f for z, f in self.impurities)

    @property
    def ion_fraction(self):
        """Total ion density over electron density."""
        return self.fuel_fraction + sum(f for _, f in self.impurities)

    @property
    def z_eff(self):
        return self.fuel_fraction + sum(z * z * f for z, f in self.impurities)

    @property
    def reactant_product(self):
        """n_D n_T / n_e^2."""
        x = self.tritium_fraction
        return x * (1.0 - x) * self.fuel_fraction**2

    @property
    def fuel_mass(self):
        """Mean mass of the fuel ions in atomic mass units."""
        return 2.0 + self.tritium_fraction


@dataclass(frozen=True)
class Tokamak:
    """Size, shape, field and current of the machine.

    Parameters
    ----------
    major_radius, minor_radius : float
        R and a in metres.
    elongation : float
        Areal elongation kappa_a (cross-section area over pi a^2).
    triangularity : float
        Triangularity at the 95% flux surface.
    field : float
        Toroidal magnetic field on axis, tesla.
    current : float
        Plasma current, megaamperes.
    """

    major_radius: float
    minor_radius: float
    elongation: float
    triangularity: float
    field: float
    current: float

    def __post_init__(self):
        if min(self.major_radius, self.minor_radius, self.elongation, self.field, self.current) <= 0.0:
            raise ValueError("Machine parameters must be positive.")
        if self.minor_radius >= self.major_radius:
            raise ValueError("Minor radius must be smaller than major radius.")

    @property
    def inverse_aspect_ratio(self):
        return self.minor_radius / self.major_radius

    @property
    def volume(self):
        """Plasma volume in m^3 [4]."""
        eps = self.inverse_aspect_ratio
        return 2.0 * math.pi * self.major_radius**3 * eps**2 * self.elongation * (math.pi - (math.pi - 8.0 / 3.0) * eps)

    @property
    def surface_area(self):
        """Plasma surface area in m^2 [4]."""
        eps = self.inverse_aspect_ratio
        return 2.0 * math.pi * self.major_radius**2 * eps * self.elongation * (math.pi + 2.0 - (math.pi - 2.0) * eps)

    @property
    def greenwald_density(self):
        """Greenwald density limit in m^-3 [3]."""
        return 1.0e20 * self.current / (math.pi * self.minor_radius**2)

    @property
    def shaping_factor(self):
        """Shape term of the safety-factor formula, without the aspect-ratio correction."""
        d = self.triangularity
        return (1.0 + self.elongation**2 * (1.0 + 2.0 * d**2 - 1.2 * d**3)) / 2.0

    @property
    def q_cylindrical(self):
        """Cylindrical safety factor q* (Uckan form), without the aspect-ratio term."""
        return 5.0 * self.minor_radius**2 * self.field / (self.major_radius * self.current) * self.shaping_factor

    @property
    def q95(self):
        """Edge safety factor q95 [2]."""
        eps = self.inverse_aspect_ratio
        return self.q_cylindrical * (1.17 - 0.65 * eps) / (1.0 - eps**2) ** 2

    def with_q95(self, q95):
        """Return a copy whose plasma current gives the requested q95."""
        return Tokamak(
            self.major_radius, self.minor_radius, self.elongation, self.triangularity, self.field,
            self.current * self.q95 / q95,
        )


@dataclass(frozen=True)
class Scenario:
    """Operating point of the plasma.

    Parameters
    ----------
    density : float
        Volume-averaged electron density, m^-3.
    heating_power : float
        External heating power absorbed by the plasma, MW (auxiliary plus ohmic).
    h_factor : float
        Confinement relative to the IPB98(y,2) scaling; 1.0 is standard H-mode.
    density_peaking, temperature_peaking : float
        Central value over volume average, >= 1.
    radiation_factor : float
        Core radiation as a multiple of bremsstrahlung, >= 1.
    composition : Composition
        Fuel mix and impurities.
    """

    density: float
    heating_power: float
    h_factor: float = 1.0
    density_peaking: float = 1.3
    temperature_peaking: float = 2.5
    radiation_factor: float = 1.0
    composition: Composition = field(default_factory=Composition)

    def __post_init__(self):
        if self.density <= 0.0 or self.heating_power < 0.0 or self.h_factor <= 0.0:
            raise ValueError("Density and H-factor must be positive; heating power cannot be negative.")
        if self.density_peaking < 1.0 or self.temperature_peaking < 1.0:
            raise ValueError("Peaking factors must be at least 1.")
        if self.radiation_factor < 1.0:
            raise ValueError("radiation_factor must be at least 1.")


@dataclass(frozen=True)
class Performance:
    """Result of :func:`solve`. Powers in MW, energy in MJ, temperatures in keV."""

    status: str                 # "steady", "runaway" or "no_solution"
    central_temperature: float
    average_temperature: float
    central_density: float      # m^-3
    line_density: float         # m^-3
    greenwald_fraction: float
    fusion_power: float
    alpha_power: float
    radiated_power: float
    loss_power: float
    gain: float                 # Q = fusion power / external heating
    confinement_time: float     # s
    stored_energy: float        # MJ
    beta_percent: float
    beta_normalised: float
    q95: float
    lh_threshold: float         # MW
    lh_margin: float            # loss power / threshold
    neutron_wall_load: float    # MW m^-2
    triple_product: float       # central n T tau_E, keV m^-3 s
    lawson_parameter: float     # central n tau_E, m^-3 s
    volume: float
    surface_area: float
    ignition_possible: bool     # a self-sustaining state exists with zero heating
    radiation_barrier: bool     # at full density, the heating cannot burn through radiation


def line_average_factor(peaking):
    """Line-averaged over central value for the profile (1 - rho^2)^(peaking - 1)."""
    alpha = peaking - 1.0
    return 0.5 * math.sqrt(math.pi) * math.gamma(alpha + 1.0) / math.gamma(alpha + 1.5)


def _reactivity_unbounded(temperature):
    """Bosch-Hale reactivity, taken as zero outside the fit's validity range."""
    temperature = np.asarray(temperature, dtype=float)
    inside = (temperature >= T_MIN_KEV) & (temperature <= T_MAX_KEV)
    out = np.zeros_like(temperature)
    out[inside] = reactivity_dt(temperature[inside])
    return out


def confinement_time(machine, line_density, loss_power, fuel_mass, h_factor=1.0):
    """IPB98(y,2) energy confinement time in seconds [1].

    ``line_density`` in m^-3, ``loss_power`` in MW.
    """
    c = IPB98
    return (
        h_factor * c["c"] * machine.current ** c["i"] * machine.field ** c["b"]
        * (line_density / 1.0e19) ** c["n"] * loss_power ** c["p"] * machine.major_radius ** c["r"]
        * machine.elongation ** c["k"] * machine.inverse_aspect_ratio ** c["e"] * fuel_mass ** c["m"]
    )


def lh_threshold(machine, line_density, fuel_mass):
    """H-mode power threshold in MW [5]."""
    c = MARTIN
    deuterium = c["c"] * (line_density / 1.0e20) ** c["n"] * machine.field ** c["b"] * machine.surface_area ** c["s"]
    return deuterium * 2.0 / fuel_mass


def _powers(machine, scenario, t0):
    """Fusion, bremsstrahlung and stored energy for an array of central temperatures.

    Returns (fusion MW, radiated MW, stored energy MJ).
    """
    comp = scenario.composition
    t0 = np.atleast_1d(np.asarray(t0, dtype=float))
    a_n = scenario.density_peaking - 1.0
    a_t = scenario.temperature_peaking - 1.0
    n0 = scenario.density * scenario.density_peaking
    shape = 1.0 - U_NODES
    temperature = t0[:, None] * shape[None, :] ** a_t
    density_sq = (n0 * shape**a_n) ** 2
    rate = np.sum(U_WEIGHTS[None, :] * density_sq[None, :] * _reactivity_unbounded(temperature), axis=1)
    fusion = comp.reactant_product * rate * E_FUSION_KEV * KEV_TO_J * machine.volume
    brems = C_BREMS * comp.z_eff * n0**2 * np.sqrt(t0) * machine.volume / (1.0 + 2.0 * a_n + 0.5 * a_t)
    stored = 1.5 * (1.0 + comp.ion_fraction) * n0 * t0 * KEV_TO_J * machine.volume / (1.0 + a_n + a_t)
    return fusion / 1.0e6, scenario.radiation_factor * brems / 1.0e6, stored / 1.0e6


def _residual(machine, scenario, t0, heating):
    """Energy balance at central temperature ``t0``.

    Returns (residual, transport_power). The residual is the stored energy
    minus what confinement can hold: negative means the plasma heats up,
    positive means it cools. Where radiation exceeds all heating, the
    transport power is not positive and the plasma cools by radiation alone.
    """
    fusion, radiated, stored = _powers(machine, scenario, t0)
    loss = heating + ALPHA_FRACTION * fusion - radiated
    line_density = scenario.density * scenario.density_peaking * line_average_factor(scenario.density_peaking)
    safe_loss = np.where(loss > 0.0, loss, 1.0)
    tau = confinement_time(machine, line_density, safe_loss, scenario.composition.fuel_mass, scenario.h_factor)
    return np.where(loss > 0.0, stored - tau * safe_loss, stored + 1.0), loss


def _operating_temperature(machine, scenario, heating):
    """Steady central temperature.

    Returns (temperature or None, status, radiation_barrier).

    The plasma is followed up in temperature from 0.5 keV and stops at the
    first stable balance between heating and transport.

    A balance in which core radiation carries more power than transport is a
    radiation barrier, not a confined steady state: the heat flowing out by
    transport is so small that the confinement scaling, which diverges as that
    power goes to zero, no longer applies, and at the full operating density
    the heating cannot burn through. Real machines avoid it by heating the
    plasma before raising its density. Such a balance is skipped and reported,
    and the search continues above it.
    """
    residual, loss = _residual(machine, scenario, T0_SCAN, heating)
    barrier = False
    for i in range(len(T0_SCAN) - 1):
        if residual[i] < 0.0 <= residual[i + 1]:
            if loss[i + 1] <= 0.0:
                barrier = True
                continue
            low, high = T0_SCAN[i], T0_SCAN[i + 1]
            for _ in range(50):
                mid = 0.5 * (low + high)
                if _residual(machine, scenario, mid, heating)[0][0] >= 0.0:
                    high = mid
                else:
                    low = mid
            t = 0.5 * (low + high)
            fusion, radiated, _ = (float(v[0]) for v in _powers(machine, scenario, t))
            if radiated >= heating + ALPHA_FRACTION * fusion - radiated:
                barrier = True
                continue
            return t, "steady", barrier
    return None, ("runaway" if residual[-1] < 0.0 else "no_solution"), barrier


def solve(machine: Tokamak, scenario: Scenario) -> Performance:
    """Find the steady operating point of ``scenario`` in ``machine``."""
    comp = scenario.composition
    t0, status, barrier = _operating_temperature(machine, scenario, scenario.heating_power)
    if t0 is None:
        t0 = T_MAX_KEV if status == "runaway" else float("nan")

    n0 = scenario.density * scenario.density_peaking
    line_density = n0 * line_average_factor(scenario.density_peaking)
    threshold = lh_threshold(machine, line_density, comp.fuel_mass)
    ignition_possible = _operating_temperature(machine, scenario, 0.0)[1] in ("steady", "runaway")

    if math.isnan(t0):
        nan = float("nan")
        return Performance(
            status, nan, nan, n0, line_density, line_density / machine.greenwald_density, 0.0, 0.0, 0.0, 0.0, 0.0,
            nan, 0.0, 0.0, 0.0, machine.q95, threshold, 0.0, 0.0, 0.0, 0.0, machine.volume, machine.surface_area,
            ignition_possible, barrier,
        )

    fusion, radiated, stored = (float(x[0]) for x in _powers(machine, scenario, t0))
    alpha = ALPHA_FRACTION * fusion
    loss = scenario.heating_power + alpha - radiated
    tau = stored / loss if loss > 0.0 else float("nan")
    pressure = stored * 1.0e6 / (1.5 * machine.volume)
    beta = 2.0 * MU_0 * pressure / machine.field**2
    beta_percent = 100.0 * beta
    gain = fusion / scenario.heating_power if scenario.heating_power > 0.0 else math.inf
    return Performance(
        status=status,
        central_temperature=float(t0),
        average_temperature=float(t0) / scenario.temperature_peaking,
        central_density=n0,
        line_density=line_density,
        greenwald_fraction=line_density / machine.greenwald_density,
        fusion_power=fusion,
        alpha_power=alpha,
        radiated_power=radiated,
        loss_power=loss,
        gain=gain,
        confinement_time=tau,
        stored_energy=stored,
        beta_percent=beta_percent,
        beta_normalised=beta_percent * machine.minor_radius * machine.field / machine.current,
        q95=machine.q95,
        lh_threshold=threshold,
        lh_margin=loss / threshold,
        neutron_wall_load=(1.0 - ALPHA_FRACTION) * fusion / machine.surface_area,
        triple_product=n0 * float(t0) * tau,
        lawson_parameter=n0 * tau,
        volume=machine.volume,
        surface_area=machine.surface_area,
        ignition_possible=ignition_possible,
        radiation_barrier=barrier,
    )


# --- Reference designs ---------------------------------------------------------------

#: SPARC full-field H-mode. Every input is from Creely et al. (2020), Tables 1-2
#: and Section 4: R, a, B, I, kappa_a = 1.75, delta_95 = 0.45, <n_e> = 3.1e20,
#: P_RF + P_ohmic = 11.1 + 1.7 MW, H98 = 1, T peaking 2.5, density peaking about
#: 1.4, fuel dilution 0.85 with 6% helium, radiation about 2.25 x bremsstrahlung.
SPARC = Tokamak(major_radius=1.85, minor_radius=0.57, elongation=1.75, triangularity=0.45, field=12.2, current=8.7)
SPARC_SCENARIO = Scenario(
    density=3.1e20,
    heating_power=12.8,
    h_factor=1.0,
    density_peaking=1.4,
    temperature_peaking=2.5,
    radiation_factor=2.25,
    composition=Composition(impurities=((2, 0.06), (8, 0.00375))),
)
#: Published SPARC projections (Creely et al. 2020, Table 2).
SPARC_PUBLISHED = {
    "fusion_power": 140.0, "gain": 11.0, "confinement_time": 0.77, "average_temperature": 7.3,
    "beta_normalised": 1.0, "greenwald_fraction": 0.37, "q_cylindrical": 3.05,
}

#: ITER 15 MA baseline (Q = 10 inductive scenario).
#:
#: Sourced inputs: R, a, B and I from Creely et al. (2020), Table 1 (citing
#: Shimada et al. 2007); 40 MW of heating and a line-averaged density of
#: 1.01e20 m^-3 from the ITER Q = 10 reference scenario.
#:
#: Assumed inputs, NOT taken from a source read for this project:
#: kappa_a = 1.75 and delta_95 = 0.33; a nearly flat density profile; helium
#: 3.2% plus a lumped Z = 7 impurity at 1.45%, which has the same fuel dilution
#: and Z_eff (1.67) as 2% beryllium with 0.12% argon; core radiation
#: 1.6 x bremsstrahlung.
#:
#: The temperature peaking of 1.6 is set so that the model reproduces the
#: design gain. With the SPARC value of 2.5 the same inputs give Q of about 17.
#: See ``ITER_PEAKING_SENSITIVITY`` in the tests and the README.
ITER = Tokamak(major_radius=6.2, minor_radius=2.0, elongation=1.75, triangularity=0.33, field=5.3, current=15.0)
ITER_SCENARIO = Scenario(
    density=1.01e20 / (1.05 * line_average_factor(1.05)),
    heating_power=40.0,
    h_factor=1.0,
    density_peaking=1.05,
    temperature_peaking=1.6,
    radiation_factor=1.6,
    composition=Composition(impurities=((2, 0.032), (7, 0.0145))),
)
#: Published ITER design values for the Q = 10 scenario.
ITER_PUBLISHED = {"fusion_power": 400.0, "gain": 10.0, "confinement_time": 3.7, "volume": 830.0}
