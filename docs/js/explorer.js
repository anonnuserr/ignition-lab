// Part one: the Lawson explorer.

import * as P from "./physics.js";
import { LawsonChart, legendHTML } from "./charts.js";
import { DATA } from "./data.js";
import { createSelect, createSlider, gainState, gainText, num, perFrame, sci } from "./ui.js";

export const IMPURITIES = [
  [0, "None"],
  [4, "Beryllium (Z = 4)"],
  [6, "Carbon (Z = 6)"],
  [7, "Nitrogen (Z = 7)"],
  [8, "Oxygen (Z = 8)"],
  [10, "Neon (Z = 10)"],
];

// [project, shot, chip label]
const PRESETS = [
  ["JET", "26087", "JET", "1991"],
  ["TFTR", "83546", "TFTR", "1995"],
  ["JT-60U", "E31872", "JT-60U", "1998"],
  ["W7-X", "W7X 20171207.006", "W7-X", "2017"],
  ["ITER", "Projected", "ITER", "projected"],
  ["SPARC", "Projected", "SPARC", "projected"],
];

export function initExplorer() {
  const state = { T: 15, n: 1.0e20, tau: 1.0, tritium: 0.5, helium: 0, impurityZ: 0, impurity: 0 };
  const chart = new LawsonChart(document.getElementById("lawsonChart"), DATA.experiments);
  document.getElementById("lawsonLegend").innerHTML = legendHTML();

  const controls = document.getElementById("explorerControls");
  const purity = document.getElementById("explorerPurity");
  const sliders = {};
  const refresh = perFrame(update);
  const set = (key) => (value) => {
    state[key] = value;
    clearPreset();
    refresh();
  };

  sliders.T = createSlider(controls, {
    label: "Temperature", min: P.T_MIN, max: P.T_MAX, log: true, value: state.T,
    format: (v) => `${num(v, 3)} keV <small>${num(v * 11.604, 3)} million °C</small>`, onInput: set("T"),
  });
  sliders.n = createSlider(controls, {
    label: "Density", min: 1e18, max: 1e22, log: true, value: state.n,
    format: (v) => `${sci(v, 1)} m<sup>−3</sup>`, hint: "Fuel particles per cubic metre. Air is about 2.5 × 10<sup>25</sup>.",
    onInput: set("n"),
  });
  sliders.tau = createSlider(controls, {
    label: "Confinement time", min: 1e-4, max: 30, log: true, value: state.tau,
    format: (v) => (v >= 1 ? `${num(v, 3)} s` : `${num(v * 1000, 3)} ms`),
    hint: "How long the plasma holds its heat before it leaks away.", onInput: set("tau"),
  });
  sliders.tritium = createSlider(purity, {
    label: "Tritium in the fuel", min: 0.1, max: 0.9, step: 0.01, value: state.tritium,
    format: (v) => `${Math.round(v * 100)}% <small>${Math.round((1 - v) * 100)}% deuterium</small>`, onInput: set("tritium"),
  });
  sliders.helium = createSlider(purity, {
    label: "Helium ash", min: 0, max: 0.25, step: 0.005, value: state.helium,
    format: (v) => `${num(v * 100, 2)}%`, hint: "Spent fuel that stays in the plasma and dilutes it.", onInput: set("helium"),
  });
  sliders.impurityZ = createSelect(purity, {
    label: "Wall impurity", options: IMPURITIES, value: 0,
    onInput: (z) => {
      state.impurityZ = z;
      if (z === 0) { state.impurity = 0; sliders.impurity.set(0); }
      else if (state.impurity === 0) { state.impurity = 0.005; sliders.impurity.set(0.005); }
      clampImpurity();
      refresh();
    },
  });
  sliders.impurity = createSlider(purity, {
    label: "Impurity amount", min: 0, max: 0.05, step: 0.0005, value: 0,
    format: (v) => `${num(v * 100, 2)}%`, onInput: (v) => { state.impurity = state.impurityZ === 0 ? 0 : v; clampImpurity(); refresh(); },
  });

  /** Keep some fuel in the plasma: impurities cannot use up every electron. */
  function clampImpurity() {
    if (state.impurityZ === 0) return;
    const room = 0.9 - 2 * state.helium;
    const limit = Math.max(0, room / state.impurityZ);
    if (state.impurity > limit) {
      state.impurity = limit;
      sliders.impurity.set(limit);
    }
  }

  // Presets taken from the data set.
  const presetBox = document.getElementById("explorerPresets");
  let activeChip = null;
  function clearPreset() {
    activeChip?.classList.remove("is-active");
    activeChip = null;
  }
  for (const [project, shot, label, tag] of PRESETS) {
    const e = DATA.experiments.find((d) => d.project === project && d.shot === shot);
    if (!e || !e.n) continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.innerHTML = `${label}<small>${tag}</small>`;
    chip.addEventListener("click", () => {
      Object.assign(state, { T: e.T, n: e.n, tau: e.tau, tritium: 0.5, helium: 0, impurityZ: 0, impurity: 0 });
      for (const key of ["T", "n", "tau", "tritium", "helium", "impurity"]) sliders[key].set(state[key]);
      sliders.impurityZ.set(0);
      clearPreset();
      activeChip = chip;
      chip.classList.add("is-active");
      refresh();
    });
    presetBox.appendChild(chip);
  }

  // Chart controls.
  document.querySelectorAll("#explorer [data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#explorer [data-range]").forEach((b) => b.classList.toggle("is-active", b === button));
      chart.setRange(button.dataset.range);
    });
  });
  document.getElementById("showLaser").addEventListener("change", (event) => chart.setLaser(event.target.checked));

  chart.onDrag = (T, triple) => {
    state.T = T;
    state.tau = Math.min(30, Math.max(1e-4, triple / (state.n * T)));
    if (Math.abs(state.n * T * state.tau / triple - 1) > 0.01) {
      state.n = Math.min(1e22, Math.max(1e18, triple / (T * state.tau)));
      sliders.n.set(state.n);
    }
    sliders.T.set(state.T);
    sliders.tau.set(state.tau);
    clearPreset();
    refresh();
  };

  const readouts = document.getElementById("explorerReadouts");
  const bars = document.getElementById("balanceBars");
  const note = document.getElementById("balanceNote");

  let lastComposition = "";

  function update() {
    const impurities = [[2, state.helium]];
    if (state.impurityZ) impurities.push([state.impurityZ, state.impurity]);
    const comp = P.composition(state.tritium, impurities);
    const nTau = state.n * state.tau;
    const triple = nTau * state.T;
    const gain = P.gainFromState(state.T, nTau, comp);
    const needed = P.lawsonParameter(state.T, Infinity, comp);
    const share = Number.isFinite(needed) ? nTau / needed : 0;
    const ideal = P.idealIgnitionTemperature(comp);
    const st = gainState(gain);

    const shareText = !Number.isFinite(needed)
      ? "Ignition is impossible at this temperature"
      : `Needs ${sci(needed * state.T, 2)} to ignite at this temperature`;
    readouts.innerHTML = `
      <div class="readout hero-readout">
        <div class="label">Fuel gain Q</div>
        <div class="value">${gainText(gain)}</div>
        <div class="state ${st.key}">${st.label}</div>
        <div class="sub">${st.note}</div>
      </div>
      <div class="readout">
        <div class="label">Triple product</div>
        <div class="value">${sci(triple, 2)}</div>
        <div class="sub">keV m<sup>−3</sup> s. ${shareText}.</div>
      </div>
      <div class="readout">
        <div class="label">Progress to ignition</div>
        <div class="value">${share >= 1 ? "100" : num(share * 100, share < 0.01 ? 1 : 2)}<small>%</small></div>
        <div class="sub">Share of the confinement needed for ignition at ${num(state.T, 3)} keV.</div>
      </div>
      <div class="readout">
        <div class="label">Coldest plasma that can ignite</div>
        <div class="value">${Number.isFinite(ideal) ? num(ideal, 3) : "–"}<small>keV</small></div>
        <div class="sub">Below this, radiation always beats self-heating${comp.zEff > 1.0001 ? " for this fuel purity" : ""}.</div>
      </div>`;

    // Power balance, per cubic metre.
    const p = P.powerBalance(state.T, state.n, state.tau, comp);
    const mw = (w) => w / 1e6;
    const heating = p.alpha + p.external;
    const losses = p.radiation + p.transport;
    const scale = Math.max(heating, losses);
    const unit = (w) => (mw(w) >= 0.01 ? `${num(mw(w), 3)} MW` : `${num(w / 1e3, 3)} kW`);
    const row = (name, parts) => `
      <div class="bar-row"><span class="name">${name}</span>
        <div class="bar" role="img" aria-label="${name}: ${parts.map((s) => `${s[0]} ${unit(s[1])}`).join(", ")} per cubic metre">
          ${parts.map((s) => `<i style="flex-grow:${Math.max(0, s[1] / scale).toFixed(5)};flex-basis:0;background:${s[2]}"></i>`).join("")}
          <i style="flex-grow:${Math.max(0, 1 - parts.reduce((a, s) => a + s[1], 0) / scale).toFixed(5)};flex-basis:0;background:transparent"></i>
        </div></div>
      <div class="bar-key">${parts.map((s) => `<span><b style="background:${s[2]}"></b>${s[0]} <em>${unit(s[1])}</em></span>`).join("")}</div>`;
    bars.innerHTML =
      row("Heating in", [["External heating", p.external, "var(--s-blue)"], ["Alpha self-heating", p.alpha, "var(--s-orange)"]]) +
      row("Losses out", [["Heat leaking out", p.transport, "var(--s-aqua)"], ["Radiation", p.radiation, "var(--s-yellow)"]]);
    note.innerHTML = heating > losses * 1.0001
      ? `Per cubic metre. Self-heating exceeds the losses, so this plasma would keep heating up.`
      : `Per cubic metre, in steady state. A further <strong>${unit(p.neutron)}</strong> leaves as neutrons: the power a reactor would harvest.`;

    // Curves only change with the fuel's composition; otherwise just move the dot.
    const compositionKey = `${state.tritium}|${impurities.map((i) => i.join(":")).join(",")}`;
    chart.setUser({ T: state.T, triple });
    if (compositionKey !== lastComposition) {
      lastComposition = compositionKey;
      chart.setComposition(comp);
      chart.render();
    } else {
      chart.renderMarkers();
    }
  }

  update();
  return {
    /** Show the reactor designer's operating point on the chart. */
    setReactor(point) {
      chart.setReactor(point);
      chart.renderMarkers();
    },
  };
}
