"""Loader for the table of experimental results in ``data/experiments.csv``."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "experiments.csv"

#: Plot categories, in legend order.
CATEGORIES = (
    "Tokamak",
    "Spherical tokamak",
    "Stellarator",
    "Other magnetic concepts",
    "Laser inertial fusion",
)


@dataclass(frozen=True)
class Experiment:
    project: str
    concept: str
    confinement: str
    date: str
    shot: str
    projected: bool
    temperature_kev: float
    density_m3: Optional[float]
    confinement_time_s: Optional[float]
    lawson_parameter: float
    triple_product: float
    source: str

    @property
    def year(self) -> int:
        return int(self.date[:4])

    @property
    def category(self) -> str:
        if self.confinement == "ICF":
            return "Laser inertial fusion"
        if self.concept == "Tokamak":
            return "Tokamak"
        if self.concept == "Spherical Tokamak":
            return "Spherical tokamak"
        if self.concept == "Stellarator":
            return "Stellarator"
        return "Other magnetic concepts"


def _optional(value: str) -> Optional[float]:
    return float(value) if value.strip() else None


def load_experiments(path: Path = DATA_FILE) -> list[Experiment]:
    """Read the experiment table into a list of :class:`Experiment`."""
    with open(path, newline="", encoding="utf-8") as handle:
        return [
            Experiment(
                project=row["project"],
                concept=row["concept"],
                confinement=row["confinement"],
                date=row["date"],
                shot=row["shot"],
                projected=row["projected"] == "1",
                temperature_kev=float(row["T_i_keV"]),
                density_m3=_optional(row["n_i_m3"]),
                confinement_time_s=_optional(row["tau_E_s"]),
                lawson_parameter=float(row["lawson_parameter_m3s"]),
                triple_product=float(row["triple_product_keV_m3s"]),
                source=row["source"],
            )
            for row in csv.DictReader(handle)
        ]
