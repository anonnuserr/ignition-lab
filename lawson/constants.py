"""Physical constants and reaction data used throughout the package.

Units follow the convention of the fusion literature: temperatures and
energies in keV, densities in m^-3, times in s, powers in W.

Sources
-------
* Reaction constants (Gamow constant, reduced mass, fit coefficients):
  H.-S. Bosch and G. M. Hale, Nucl. Fusion 32, 611 (1992), Tables IV and VII.
* Energy per reaction, charged-particle fraction and bremsstrahlung
  coefficient: S. E. Wurzel and S. C. Hsu, Phys. Plasmas 29, 062103 (2022),
  Eqs. (1) and (7). Using the same values as the reference paper is what
  makes a like-for-like benchmark possible.
"""

#: 1 keV in joules (exact, 2019 SI).
KEV_TO_J = 1.602176634e-16

#: Speed of light in m/s (exact).
C_LIGHT = 299_792_458.0

#: Total energy released per D-T reaction, keV. (The Q-value is 17.589 MeV;
#: 17.6 MeV is the rounded value used by the reference paper.)
E_FUSION_KEV = 17.6e3

#: Fraction of the fusion energy carried by the charged alpha particle.
ALPHA_FRACTION = 0.2

#: Energy of the alpha particle per reaction, keV.
E_ALPHA_KEV = ALPHA_FRACTION * E_FUSION_KEV

#: Bremsstrahlung coefficient, W m^3 keV^-1/2, for P_B = C_B n_e^2 Z_eff T^1/2.
C_BREMS = 5.34e-37

#: Gamow constant for D-T, keV^1/2.
B_GAMOW = 34.3827

#: Reduced mass of the D-T pair times c^2, keV.
MU_C2_KEV = 1_124_656.0

#: Validity range of the Bosch-Hale reactivity fit, keV.
T_MIN_KEV = 0.2
T_MAX_KEV = 100.0
