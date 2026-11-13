"""Regenerate every figure and every number quoted in the report.

Usage
-----
    python make_figures.py

Outputs
-------
    figures/fig1_reactivity.{png,svg}
    figures/fig2_ideal_ignition.{png,svg}
    figures/fig3_lawson_parameter.{png,svg}
    figures/fig4_triple_product_experiments.{png,svg}
    figures/fig5_sensitivity.{png,svg}
    results/summary.json
    results/experiment_margins.csv
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.patches
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D

import lawson as lw
from lawson import sensitivity
from lawson.constants import ALPHA_FRACTION, C_BREMS, E_FUSION_KEV, KEV_TO_J
from lawson.experiments import CATEGORIES, load_experiments

ROOT = Path(__file__).resolve().parent
FIGURES = ROOT / "figures"
RESULTS = ROOT / "results"

# --- Visual style -------------------------------------------------------------
INK, INK_2, MUTED = "#0b0b0b", "#52514e", "#898781"
GRID, AXIS = "#e1e0d9", "#c3c2b7"
BLUE, ORANGE, AQUA, YELLOW = "#2a78d6", "#eb6834", "#1baf7a", "#eda100"
# One-hue ramp, light to dark, for ordered gain levels.
BLUE_RAMP = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"]

plt.rcParams.update(
    {
        "font.family": "sans-serif",
        "font.sans-serif": ["Segoe UI", "Helvetica Neue", "Arial", "DejaVu Sans"],
        "font.size": 9,
        "text.color": INK,
        "axes.edgecolor": AXIS,
        "axes.linewidth": 0.8,
        "axes.labelcolor": INK_2,
        "axes.labelsize": 9,
        "axes.titlesize": 9.5,
        "axes.titleweight": "bold",
        "axes.titlelocation": "left",
        "axes.titlepad": 8,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "axes.axisbelow": True,
        "grid.color": GRID,
        "grid.linewidth": 0.6,
        "xtick.color": AXIS,
        "ytick.color": AXIS,
        "xtick.labelcolor": INK_2,
        "ytick.labelcolor": INK_2,
        "xtick.labelsize": 8.5,
        "ytick.labelsize": 8.5,
        "lines.linewidth": 2.0,
        "legend.frameon": False,
        "legend.fontsize": 8.5,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "savefig.dpi": 300,
        "savefig.bbox": "tight",
        "mathtext.default": "regular",
    }
)


def save(fig, name):
    FIGURES.mkdir(exist_ok=True)
    for extension in ("png", "svg"):
        fig.savefig(FIGURES / f"{name}.{extension}")
    plt.close(fig)


def plain_ticks(axis, values):
    axis.set_ticks(values)
    axis.set_ticklabels([f"{v:g}" for v in values])
    axis.set_minor_formatter(matplotlib.ticker.NullFormatter())


# --- Figure 1: reactivity -------------------------------------------------------
def figure_reactivity():
    temperature = np.geomspace(0.2, 100.0, 500)
    fit = lw.reactivity_dt(temperature)
    samples = np.geomspace(0.2, 100.0, 19)
    integrated_samples = lw.reactivity_dt_integrated(samples)
    deviation = 100.0 * (lw.reactivity_dt_integrated(temperature) / fit - 1.0)
    window = np.linspace(5.0, 30.0, 200)
    quadratic_error = 100.0 * sensitivity.quadratic_approximation_error(window)

    fig, (top, bottom) = plt.subplots(
        2, 1, figsize=(6.3, 5.6), sharex=True, gridspec_kw={"height_ratios": [2.1, 1], "hspace": 0.16}
    )
    top.loglog(temperature, fit, color=BLUE, label="Closed-form fit (Bosch & Hale)")
    top.loglog(
        samples, integrated_samples, "o", ms=5, mfc="white", mec=INK, mew=1.1,
        label="Maxwellian integral of the cross-section",
    )
    top.loglog(window, lw.reactivity_dt_quadratic(window), "--", color=ORANGE, lw=1.6,
               label=r"Textbook shortcut, $1.1\times10^{-24}\,T^2$")
    top.set_ylabel(r"Reactivity $\langle\sigma v\rangle$  (m$^3$ s$^{-1}$)")
    top.set_ylim(1e-32, 3e-21)
    top.set_title("(a) Deuterium-tritium thermal reactivity")
    top.legend(loc="lower right")

    bottom.axhline(0.0, color=AXIS, lw=0.8)
    bottom.semilogx(temperature, deviation, color=INK, lw=1.6)
    bottom.semilogx(window, quadratic_error, "--", color=ORANGE, lw=1.6)
    bottom.set_ylim(-14.0, 14.0)
    bottom.set_ylabel("Deviation from fit (%)")
    bottom.set_xlabel("Ion temperature $T$ (keV)")
    bottom.set_title("(b) Difference from the closed-form fit")
    bottom.annotate("integral", xy=(1.6, 0.9), xytext=(0.9, 6.0), color=INK, fontsize=8.5,
                    arrowprops={"arrowstyle": "-", "color": MUTED, "lw": 0.7})
    bottom.annotate("textbook shortcut", xy=(15.0, -9.6), xytext=(1.3, -9.5), color=INK, fontsize=8.5,
                    va="center", arrowprops={"arrowstyle": "-", "color": MUTED, "lw": 0.7})
    bottom.set_xlim(0.2, 100.0)
    plain_ticks(bottom.xaxis, [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100])
    save(fig, "fig1_reactivity")

    inside = np.linspace(10.0, 20.0, 1001)
    inside_error = sensitivity.quadratic_approximation_error(inside)
    check = np.geomspace(0.5, 100.0, 300)
    check_dev = lw.reactivity_dt_integrated(check) / lw.reactivity_dt(check) - 1.0
    peak_grid = np.linspace(40.0, 100.0, 60001)
    peak = lw.reactivity_dt(peak_grid)
    return {
        "fit_vs_integral_max_deviation_percent_0p5_to_100_keV": float(100 * np.max(np.abs(check_dev))),
        "fit_vs_integral_deviation_percent_at_0p2_keV": float(deviation[0]),
        "peak_reactivity_m3_s": float(peak.max()),
        "peak_reactivity_temperature_kev": float(peak_grid[peak.argmax()]),
        "reactivity_m3_s": {f"{t:g} keV": float(lw.reactivity_dt(t)) for t in (1, 5, 10, 15, 20, 50, 100)},
        "quadratic_max_error_percent_10_to_20_keV": float(100 * np.max(np.abs(inside_error))),
        "quadratic_max_error_temperature_kev": float(inside[np.argmax(np.abs(inside_error))]),
        "quadratic_error_percent_at_5_keV": float(100 * sensitivity.quadratic_approximation_error(5.0)),
        "quadratic_error_percent_at_30_keV": float(100 * sensitivity.quadratic_approximation_error(30.0)),
    }


# --- Figure 2: ideal ignition temperature -----------------------------------------
def figure_ideal_ignition():
    temperature = np.geomspace(1.0, 100.0, 400)
    alpha = lw.alpha_power_coefficient(temperature)
    brems = lw.bremsstrahlung_coefficient(temperature)
    threshold = lw.ideal_ignition_temperature()
    crossing = float(lw.bremsstrahlung_coefficient(threshold))

    fig, ax = plt.subplots(figsize=(6.3, 3.9))
    ax.axvspan(1.0, threshold, color="#f0efec", lw=0)
    ax.loglog(temperature, alpha, color=BLUE, label="Alpha-particle heating")
    ax.loglog(temperature, brems, color=ORANGE, label="Bremsstrahlung loss")
    ax.plot([threshold], [crossing], "o", ms=7, mfc="white", mec=INK, mew=1.3, zorder=5)
    ax.annotate(
        f"Ideal ignition temperature\n{threshold:.2f} keV",
        xy=(threshold, crossing), xytext=(6.3, 2.2e-37), fontsize=8.5, color=INK, va="top",
        arrowprops={"arrowstyle": "-", "color": MUTED, "lw": 0.7},
    )
    ax.text(1.08, 1.6e-34, "Radiation exceeds\nself-heating:\nignition impossible", fontsize=8.5,
            color=INK_2, va="top")
    ax.text(17.0, float(lw.alpha_power_coefficient(17.0)) * 1.7, "Alpha heating", color=INK,
            fontsize=8.5, ha="right")
    ax.text(40.0, float(lw.bremsstrahlung_coefficient(40.0)) * 0.6, "Bremsstrahlung", color=INK,
            fontsize=8.5, ha="center")
    ax.set_xlim(1.0, 100.0)
    ax.set_ylim(1e-38, 3e-34)
    ax.set_xlabel("Temperature $T$ (keV)")
    ax.set_ylabel(r"Power density / $n^2$  (W m$^3$)")
    ax.set_title("Self-heating against radiation loss in a 50:50 D-T plasma")
    plain_ticks(ax.xaxis, [1, 2, 5, 10, 20, 50, 100])
    ax.legend(loc="lower right")
    save(fig, "fig2_ideal_ignition")
    return {"ideal_ignition_temperature_kev": float(threshold)}


# --- Figure 3: Lawson parameter ------------------------------------------------------
GAINS = [(1.0, "$Q$ = 1"), (2.0, "$Q$ = 2"), (5.0, "$Q$ = 5"), (10.0, "$Q$ = 10"), (math.inf, "Ignition")]


def figure_lawson_parameter():
    temperature = np.geomspace(3.0, 100.0, 600)
    fig, ax = plt.subplots(figsize=(6.3, 4.3))
    table = {}
    for (gain, label), colour in zip(GAINS, BLUE_RAMP):
        values = lw.lawson_parameter(temperature, gain)
        finite = np.isfinite(values)
        ax.loglog(temperature[finite], values[finite], color=colour)
        t_min, v_min = lw.minimum_lawson_parameter(gain)
        ax.plot([t_min], [v_min], "o", ms=5.5, mfc="white", mec=colour, mew=1.4, zorder=5)
        ax.text(104.0, float(lw.lawson_parameter(100.0, gain)), label, color=INK, fontsize=8.5,
                va="center", clip_on=False)
        tp_t, tp_v = lw.minimum_triple_product(gain)
        key = "ignition" if math.isinf(gain) else f"Q={gain:g}"
        table[key] = {
            "min_lawson_parameter_m3s": v_min,
            "temperature_at_min_lawson_parameter_kev": t_min,
            "min_triple_product_kev_m3s": tp_v,
            "temperature_at_min_triple_product_kev": tp_t,
        }
    t_ign, v_ign = lw.minimum_lawson_parameter()
    ax.annotate(
        f"Minimum for ignition\n{v_ign / 1e20:.2f}" + r"$\times10^{20}$ m$^{-3}$ s at " + f"{t_ign:.0f} keV",
        xy=(t_ign, v_ign), xytext=(8.5, 2.2e21), fontsize=8.5, color=INK, ha="left",
        arrowprops={"arrowstyle": "-", "color": MUTED, "lw": 0.7},
    )
    ax.set_xlim(3.0, 100.0)
    ax.set_ylim(1e19, 1e22)
    ax.set_xlabel("Temperature $T$ (keV)")
    ax.set_ylabel(r"Lawson parameter $n\tau_E$  (m$^{-3}$ s)")
    ax.set_title("Confinement needed for a given fuel gain $Q$ (uniform 50:50 D-T plasma)")
    plain_ticks(ax.xaxis, [3, 5, 10, 20, 50, 100])
    legend = [Line2D([], [], color=c, lw=2, label=lab) for (_, lab), c in zip(GAINS, BLUE_RAMP)]
    legend.append(Line2D([], [], marker="o", ls="", mfc="white", mec=INK_2, mew=1.2, ms=5.5, label="Minimum of each curve"))
    ax.legend(handles=legend, loc="lower left", ncols=2)
    save(fig, "fig3_lawson_parameter")
    return table


# --- Figure 4: triple product with experiments ---------------------------------------
MARKERS = {
    "Tokamak": {"marker": "o", "color": BLUE, "size": 34},
    "Spherical tokamak": {"marker": "^", "color": AQUA, "size": 40},
    "Stellarator": {"marker": "s", "color": ORANGE, "size": 32},
    "Other magnetic concepts": {"marker": "D", "color": MUTED, "size": 16},
    "Laser inertial fusion": {"marker": "*", "color": INK, "size": 70},
}

# (project, shot) -> (label, text offset in points, horizontal alignment)
OVERVIEW_LABELS = {
    ("ZETA", "140 kA - 180 kA discharges"): ("ZETA 1957", (-10, 0), "right"),
    ("T-3", "Hz = 25 kOe, Iz = 85 kA discharges"): ("T-3 1969", (-12, -13), "right"),
    ("LHD", "High triple product"): ("LHD 2008", (-9, 6), "right"),
    ("C-2W", "118340"): ("C-2W 2021", (9, -9), "left"),
    ("NOVA", "100 atm fill"): ("NOVA 1994", (-9, 7), "right"),
}
CLOSEUP_LABELS = {
    ("ITER", "Projected"): ("ITER (upper)\nSPARC (lower)\nprojected", (20, 44), "left"),
    ("JET", "26087"): ("JET 1991", (-20, 22), "right"),
    ("TFTR", "83546"): ("TFTR 1995", (4, 17), "center"),
    ("JT-60U", "E31872"): ("JT-60U 1998", (-26, -4), "right"),
    ("JET", "99972"): ("JET 2021", (10, -9), "left"),
    ("JET", "104600"): ("JET 2023", (-10, 9), "right"),
    ("W7-X", "W7X 20171207.006"): ("W7-X 2017", (0, -14), "center"),
    ("Alcator C", "Multiple pellet injection"): ("Alcator C 1984", (4, 13), "left"),
    ("C-Mod", "1160930042"): ("C-Mod 2016", (10, -9), "left"),
    ("ST40", "10009"): ("ST40 2022", (10, 3), "left"),
    ("NIF", "N210808"): ("NIF, 8 Aug 2021\n(ignited)", (0, 34), "center"),
    ("NIF", "N190918"): ("NIF 2014 to\nearly 2021", (-52, 0), "right"),
    ("OMEGA", "104949"): ("OMEGA 2022", (-12, 9), "right"),
}
CLOSEUP_X = (1.0, 100.0)
CLOSEUP_Y = (1e19, 1e23)
CURVES = [(1.0, "$Q$ = 1", BLUE_RAMP[0]), (10.0, "$Q$ = 10", BLUE_RAMP[2]), (math.inf, "Ignition", BLUE_RAMP[4])]


def _draw_curves(ax, labels):
    temperature = np.geomspace(1.5, 100.0, 800)
    for gain, label, colour in CURVES:
        values = lw.triple_product(temperature, gain)
        finite = np.isfinite(values) & (values < 1e25)
        ax.loglog(temperature[finite], values[finite], color=colour, zorder=2)
        if labels:
            ax.text(106.0, float(lw.triple_product(100.0, gain)), label, color=INK, fontsize=8.5,
                    va="center", clip_on=False)
    laser_t = np.geomspace(1.5, 100.0, 400)
    ax.loglog(laser_t, laser_t * lw.icf_ignition_lawson_parameter(laser_t), "--", color=INK, lw=1.5, zorder=2)


def _draw_points(ax, experiments, labels, scale=1.0):
    for category in CATEGORIES:
        style = MARKERS[category]
        achieved = [e for e in experiments if e.category == category and not e.projected]
        ax.scatter(
            [e.temperature_kev for e in achieved], [e.triple_product for e in achieved],
            marker=style["marker"], s=style["size"] * scale, color=style["color"], edgecolors="white",
            linewidths=0.7, zorder=4,
        )
        projected = [e for e in experiments if e.category == category and e.projected]
        ax.scatter(
            [e.temperature_kev for e in projected], [e.triple_product for e in projected],
            marker=style["marker"], s=(style["size"] + 12) * scale, facecolors="white",
            edgecolors=style["color"], linewidths=1.5, zorder=4,
        )
    for e in experiments:
        key = (e.project, e.shot)
        if key in labels:
            text, offset, align = labels[key]
            ax.annotate(text, xy=(e.temperature_kev, e.triple_product), xytext=offset,
                        textcoords="offset points", fontsize=8, color=INK, ha=align, va="center",
                        arrowprops={"arrowstyle": "-", "color": MUTED, "lw": 0.6, "shrinkA": 0, "shrinkB": 3},
                        zorder=6)


def figure_triple_product(experiments):
    fig, (overview, closeup) = plt.subplots(2, 1, figsize=(6.6, 8.6), gridspec_kw={"hspace": 0.3})

    # (a) Overview of every result.
    _draw_curves(overview, labels=False)
    _draw_points(overview, experiments, OVERVIEW_LABELS, scale=0.8)
    overview.add_patch(matplotlib.patches.Rectangle(
        (CLOSEUP_X[0], CLOSEUP_Y[0]), CLOSEUP_X[1] - CLOSEUP_X[0], CLOSEUP_Y[1] - CLOSEUP_Y[0],
        fill=False, ec=INK_2, lw=0.8, ls=":", zorder=3))
    overview.text(1.1, 5.5e22, "panel (b)", fontsize=8, color=INK_2, va="top")
    overview.set_xlim(0.008, 100.0)
    overview.set_ylim(3e12, 1e23)
    overview.set_ylabel(r"Triple product $n\,T\,\tau$  (keV m$^{-3}$ s)")
    overview.set_title("(a) All results, 1957 to 2023")
    plain_ticks(overview.xaxis, [0.01, 0.1, 1, 10, 100])
    handles = [
        Line2D([], [], marker=MARKERS[c]["marker"], ls="", color=MARKERS[c]["color"], mec="white",
               ms=math.sqrt(MARKERS[c]["size"]) * 1.15, label=c)
        for c in CATEGORIES
    ]
    handles.append(Line2D([], [], marker="o", ls="", mfc="white", mec=BLUE, mew=1.5, ms=7, label="Design projection"))
    overview.legend(handles=handles, loc="lower right", fontsize=8)

    # (b) Close-up of the region near the thresholds.
    _draw_curves(closeup, labels=True)
    _draw_points(closeup, experiments, CLOSEUP_LABELS)
    closeup.annotate("Laser fusion:\nhot-spot ignition", xy=(2.3, float(2.3 * lw.icf_ignition_lawson_parameter(2.3))),
                     xytext=(1.12, 2.2e22), fontsize=8.5, color=INK, ha="left", va="center",
                     arrowprops={"arrowstyle": "-", "color": MUTED, "lw": 0.7})
    closeup.set_xlim(*CLOSEUP_X)
    closeup.set_ylim(*CLOSEUP_Y)
    closeup.set_xlabel("Ion temperature $T_i$ (keV)")
    closeup.set_ylabel(r"Triple product $n\,T\,\tau$  (keV m$^{-3}$ s)")
    closeup.set_title("(b) Close-up near the gain and ignition thresholds")
    plain_ticks(closeup.xaxis, [1, 2, 5, 10, 20, 50, 100])
    curve_handles = [Line2D([], [], color=c, lw=2, label=f"Magnetic, uniform plasma: {lab}") for _, lab, c in CURVES]
    curve_handles.append(Line2D([], [], color=INK, lw=1.5, ls="--", label="Laser: hot-spot ignition"))
    closeup.legend(handles=curve_handles, loc="upper center", bbox_to_anchor=(0.5, -0.14), ncols=2, fontsize=8)
    save(fig, "fig4_triple_product_experiments")


def experiment_margins(experiments):
    """Achieved Lawson parameter against the model requirement at the same temperature."""
    rows = []
    for e in experiments:
        if not 0.2 <= e.temperature_kev <= 100.0:
            continue
        if e.confinement == "MCF":
            required = float(lw.lawson_parameter(e.temperature_kev))
            gain = lw.q_fuel_from_state(e.temperature_kev, e.lawson_parameter)
        else:
            required = float(lw.icf_ignition_lawson_parameter(e.temperature_kev))
            gain = None
        fraction = e.lawson_parameter / required if math.isfinite(required) else 0.0
        rows.append(
            {
                "project": e.project,
                "shot": e.shot,
                "date": e.date,
                "category": e.category,
                "projected": int(e.projected),
                "T_i_keV": e.temperature_kev,
                "lawson_parameter_m3s": e.lawson_parameter,
                "required_for_ignition_m3s": required,
                "fraction_of_ignition_requirement": fraction,
                "uniform_plasma_equivalent_Q_fuel": "" if gain is None else gain,
            }
        )
    rows.sort(key=lambda r: -r["fraction_of_ignition_requirement"])
    RESULTS.mkdir(exist_ok=True)
    with open(RESULTS / "experiment_margins.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            formatted = dict(row)
            for key in ("lawson_parameter_m3s", "required_for_ignition_m3s"):
                formatted[key] = f"{row[key]:.3e}"
            formatted["fraction_of_ignition_requirement"] = f"{row['fraction_of_ignition_requirement']:.4f}"
            if row["uniform_plasma_equivalent_Q_fuel"] != "":
                formatted["uniform_plasma_equivalent_Q_fuel"] = f"{row['uniform_plasma_equivalent_Q_fuel']:.3f}"
            writer.writerow(formatted)
    return rows


# --- Figure 5: sensitivity ----------------------------------------------------------------
SPECIES_STYLE = [
    ("Helium", BLUE, 0.20, "Helium ash (Z = 2)"),
    ("Beryllium", ORANGE, 0.08, "Beryllium (Z = 4)"),
    ("Carbon", AQUA, 0.04, "Carbon (Z = 6)"),
    ("Neon", YELLOW, 0.02, "Neon (Z = 10)"),
]


def figure_sensitivity():
    fig, (left, right) = plt.subplots(1, 2, figsize=(6.6, 3.5), gridspec_kw={"width_ratios": [1.45, 1], "wspace": 0.3})
    for species, colour, maximum, label in SPECIES_STYLE:
        fractions = np.geomspace(1e-3, maximum, 60)
        penalty = sensitivity.impurity_penalty(species, fractions)
        left.semilogx(100 * fractions, penalty, color=colour, label=label)
        left.text(100 * fractions[-1], penalty[-1] + 0.06, species, color=INK, fontsize=8.5, ha="center", va="bottom")
    left.axhline(1.0, color=AXIS, lw=0.8)
    left.set_xlim(0.1, 30.0)
    left.set_ylim(0.95, 3.4)
    left.set_xlabel(r"Impurity concentration $n_Z/n_e$ (%)")
    left.set_ylabel("Ignition triple product / pure D-T value")
    left.set_title("(a) Impurities and helium ash")
    plain_ticks(left.xaxis, [0.1, 0.3, 1, 3, 10, 30])
    left.legend(loc="upper left", fontsize=8)

    mix = np.linspace(0.25, 0.75, 101)
    right.plot(100 * mix, sensitivity.fuel_mix_penalty(mix), color=BLUE)
    right.axhline(1.0, color=AXIS, lw=0.8)
    right.set_ylim(0.95, 3.4)
    right.set_xlim(25, 75)
    right.set_xlabel("Tritium fraction of the fuel (%)")
    right.set_title("(b) Fuel mix")
    right.set_xticks([30, 40, 50, 60, 70])
    save(fig, "fig5_sensitivity")

    cases = [("Helium", 0.05), ("Helium", 0.10), ("Helium", 0.20), ("Beryllium", 0.02),
             ("Carbon", 0.01), ("Carbon", 0.02), ("Neon", 0.005), ("Neon", 0.01)]
    return {
        "reference_min_triple_product_kev_m3s": sensitivity.reference_triple_product(),
        "impurity_cases": [
            {k: (float(v) if isinstance(v, (float, np.floating)) else v) for k, v in sensitivity.impurity_summary(s, f).items()}
            for s, f in cases
        ],
        "fuel_mix_penalty": {f"{x:.2f}": float(sensitivity.fuel_mix_penalty([x])[0]) for x in (0.30, 0.40, 0.45, 0.50)},
        "textbook_triple_product_kev_m3s": sensitivity.textbook_triple_product(),
        "textbook_over_reference": sensitivity.textbook_triple_product() / sensitivity.reference_triple_product(),
        "no_bremsstrahlung_min_triple_product_kev_m3s": lw.minimum_triple_product(bremsstrahlung=False)[1],
    }


# --- Cross-check with directly integrated cross-sections ---------------------------------
def integrated_cross_check():
    """Benchmark thresholds recomputed with the integrated reactivity.

    The reference paper integrates the cross-section numerically rather than
    using the closed-form fit, so this is the like-for-like comparison.
    """
    temperature = np.arange(8.0, 40.0001, 0.02)
    sigma_v = lw.reactivity_dt_integrated(temperature, points=3000)
    out = {}
    for gain, key in ((1.0, "Q=1"), (math.inf, "ignition")):
        inverse_q = 0.0 if math.isinf(gain) else 1.0 / gain
        n_tau = (3.0 * temperature * KEV_TO_J) / (
            (ALPHA_FRACTION + inverse_q) * sigma_v * E_FUSION_KEV * KEV_TO_J / 4.0
            - C_BREMS * np.sqrt(temperature)
        )
        i, j = int(np.argmin(n_tau)), int(np.argmin(n_tau * temperature))
        out[key] = {
            "min_lawson_parameter_m3s": float(n_tau[i]),
            "temperature_at_min_lawson_parameter_kev": float(temperature[i]),
            "min_triple_product_kev_m3s": float((n_tau * temperature)[j]),
            "temperature_at_min_triple_product_kev": float(temperature[j]),
        }
    return out


def main():
    experiments = load_experiments()
    summary = {"reactivity": figure_reactivity()}
    summary.update(figure_ideal_ignition())
    summary["thresholds_fit"] = figure_lawson_parameter()
    summary["thresholds_integrated_cross_sections"] = integrated_cross_check()
    summary["published_wurzel_hsu_2022"] = {
        "ideal_ignition_temperature_kev": 4.3,
        "Q=1": {"min_lawson_parameter_m3s": 2.5e19, "temperature_kev": 26, "min_triple_product_kev_m3s": 4.6e20, "temperature_tp_kev": 14},
        "ignition": {"min_lawson_parameter_m3s": 1.6e20, "temperature_kev": 26, "min_triple_product_kev_m3s": 2.9e21, "temperature_tp_kev": 14},
    }
    figure_triple_product(experiments)
    margins = experiment_margins(experiments)
    summary["experiments"] = {
        "rows": len(experiments),
        "devices": len({e.project for e in experiments}),
        "by_category": {c: sum(e.category == c for e in experiments) for c in CATEGORIES},
        "top_margins": [
            {k: r[k] for k in ("project", "shot", "date", "T_i_keV", "fraction_of_ignition_requirement", "uniform_plasma_equivalent_Q_fuel", "projected")}
            for r in margins[:16]
        ],
    }
    summary["sensitivity"] = figure_sensitivity()
    RESULTS.mkdir(exist_ok=True)
    with open(RESULTS / "summary.json", "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2, default=lambda o: None if isinstance(o, float) and math.isinf(o) else str(o))
    print(f"Wrote 5 figures to {FIGURES.name}/ and results to {RESULTS.name}/")


if __name__ == "__main__":
    main()
