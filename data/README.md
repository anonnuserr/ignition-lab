# Experimental data

`experiments.csv` holds 103 published or projected results from 54 fusion devices.

## Source

Every row is transcribed from Tables 1-3 of

> S. E. Wurzel and S. C. Hsu, "Continuing progress toward fusion energy
> breakeven and gain as measured against the Lawson criteria",
> Phys. Plasmas 32, 112106 (2025). https://doi.org/10.1063/5.0297357
> (open access: https://arxiv.org/abs/2505.03834)

The `source` column gives the table (`WH2025 Table 1`, `2` or `3`). The primary
reference for each individual shot is listed in that paper and in its 2022
predecessor, Phys. Plasmas 29, 062103. The authors' own code and data are at
https://github.com/swurzel/lawson-criterion-paper (MIT licence).

No value in this file was measured, inferred or adjusted by this project.

## Columns

| Column | Meaning |
|---|---|
| `project`, `concept` | Device and confinement concept, as named in the source |
| `confinement` | `MCF` (magnetic) or `ICF` (laser inertial) |
| `date` | Date of the experiment (year only where the source gives only the year) |
| `shot` | Shot identifier, as given in the source (spacing and one spelling normalised) |
| `projected` | `1` for design projections (SPARC, ITER), `0` for achieved results |
| `T_i_keV` | MCF: central ion temperature. ICF: burn-averaged ion temperature |
| `n_i_m3` | MCF only: central ion density |
| `tau_E_s` | MCF only: energy confinement time, corrected for transient heating |
| `lawson_parameter_m3s` | MCF: n_i0 x tau_E*. ICF: n x tau_stag |
| `triple_product_keV_m3s` | Lawson parameter x temperature |

## What was left out, and why

* **Footnote flags.** The source marks values that were inferred rather than
  measured directly (peak from volume-average, ion from electron quantities,
  confinement-time conversion). The flags are not reproduced here; consult the
  source tables before relying on any single value.
* **Table 3 rows for the Z Facility (MagLIF) and FIREX.** MagLIF is a
  magneto-inertial concept to which neither ignition curve in this project
  applies directly, and FIREX has no reported ion temperature.
* **Table 4** (scientific gain against date) is not used by this project.

## Integrity check

`tests/test_data.py` verifies that, for every row, the tabulated Lawson
parameter equals density x confinement time and the tabulated triple product
equals Lawson parameter x temperature, to within the rounding of the source.
This guards against transcription errors.
