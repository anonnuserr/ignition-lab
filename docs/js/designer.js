// Part two: the reactor designer.

import * as d3 from "d3";
import * as P from "./physics.js";
import { DATA } from "./data.js";
import { IMPURITIES } from "./explorer.js";
import { PlasmaView, sectionOutline } from "./plasma3d.js";
import { computeMapGrid } from "./mapgrid.js";
import { createSelect, createSlider, debounce, gainState, gainText, hideTooltip, num, perFrame, showTooltip } from "./ui.js";

// Published separatrix shapes are converted to the areal elongation and 95%
// triangularity the model uses with the ratios given for SPARC in Creely et al.
// (2020): kappa_a / kappa_sep = 1.75 / 1.97 and delta_95 / delta_sep = 0.45 / 0.54.
const KAPPA_RATIO = 1.75 / 1.97;
const DELTA_RATIO = 0.45 / 0.54;

function stateFromPreset(preset) {
  const { machine, scenario } = preset;
  const props = P.machineProperties(machine);
  const helium = scenario.impurities.find((i) => i[0] === 2);
  const other = scenario.impurities.find((i) => i[0] !== 2);
  const line = scenario.density * scenario.densityPeaking * P.lineAverageFactor(scenario.densityPeaking);
  return {
    R: machine.R, aspect: machine.R / machine.a, kappa: machine.kappa, delta: machine.delta, B: machine.B, I: machine.I,
    fG: line / props.greenwald, heating: scenario.heating, H: scenario.hFactor,
    tPeak: scenario.temperaturePeaking, nPeak: scenario.densityPeaking,
    helium: helium ? helium[1] : 0, impurityZ: other ? other[0] : 0, impurity: other ? other[1] : 0,
    rad: scenario.radiationFactor, tritium: scenario.tritiumFraction,
  };
}

function stateFromMachine(m) {
  return {
    R: m.R, aspect: m.R / m.a, kappa: m.kappaSep * KAPPA_RATIO, delta: m.deltaSep * DELTA_RATIO, B: m.B, I: m.I,
    fG: 0.6, heating: m.heatingMax, H: 1.0, tPeak: 2.5, nPeak: 1.3,
    helium: 0.02, impurityZ: 6, impurity: 0.01, rad: 1.5, tritium: 0.5,
  };
}

const PRESETS = [
  { key: "sparc", label: "SPARC", tag: "published design", state: () => stateFromPreset(DATA.presets.sparc) },
  { key: "iter", label: "ITER", tag: "published design", state: () => stateFromPreset(DATA.presets.iter) },
  ...["KSTAR", "ASDEX Upgrade", "DIII-D", "EAST", "Alcator C-Mod"].map((name) => ({
    key: name, label: `${name} size`, tag: "if run with D-T fuel",
    state: () => stateFromMachine(DATA.machines.find((m) => m.name === name)),
  })),
];

// Readable units for values that can span many orders of magnitude:
// [factor relative to the model's unit, label], largest first. The model's own
// unit has factor 1.
const POWER = [[1e3, "GW"], [1, "MW"], [1e-3, "kW"], [1e-6, "W"]];
const TIME = [[1, "s"], [1e-3, "ms"], [1e-6, "µs"]];
const ENERGY = [[1e3, "GJ"], [1, "MJ"], [1e-3, "kJ"], [1e-6, "J"]];

/**
 * Three significant figures in a sensible unit. Larger units are used from 1
 * upwards (1.40 GW, not 1400 MW); the model's unit and smaller ones from 0.1
 * (0.768 s, 0.276 kW), so short numbers never overflow their card.
 */
function scaled(value, units) {
  if (!Number.isFinite(value) || value === 0) return { text: num(value, 3), unit: units.find((u) => u[0] === 1)[1] };
  for (const [factor, unit] of units) {
    const threshold = factor > 1 ? factor : 0.1 * factor;
    if (Math.abs(value) >= threshold) return { text: num(value / factor, 3), unit };
  }
  const [factor, unit] = units[units.length - 1];
  return { text: num(value / factor, 3), unit };
}
const withUnit = ({ text, unit }) => `${text}<small>${unit}</small>`;
const asText = ({ text, unit }) => `${text} ${unit}`;

const heatRamp =d3.interpolateRgbBasis(["#0c0e13", "#2a1208", "#6e2a0f", "#c24e1f", "#f08a3c", "#ffc98a", "#fff3dc"]);
const MAP = { nx: 45, ny: 31, R: [0.6, 9.0], B: [1.5, 14.0], qLow: 0.05, qHigh: 50 };
const mapColor = (q) => {
  const t = (Math.log10(Math.min(MAP.qHigh, Math.max(MAP.qLow, q))) - Math.log10(MAP.qLow)) / Math.log10(MAP.qHigh / MAP.qLow);
  return heatRamp(t);
};

export function initDesigner(links) {
  const state = PRESETS[0].state();
  const sliders = {};
  const refresh = perFrame(update);
  const refreshMap = debounce(() => requestMap(), 150);
  const set = (key) => (value) => {
    state[key] = value;
    clearPreset();
    refresh();
  };

  // --- Controls -----------------------------------------------------------------------
  const machineBox = document.getElementById("machineControls");
  const operationBox = document.getElementById("operationControls");
  const assumptionBox = document.getElementById("assumptionControls");

  sliders.R = createSlider(machineBox, { label: "Major radius", min: 0.5, max: 10, step: 0.01, value: state.R,
    format: (v) => `${num(v, 3)} m`, hint: "Distance from the machine's centre to the middle of the plasma.", onInput: set("R") });
  sliders.aspect = createSlider(machineBox, { label: "Aspect ratio", min: 2.0, max: 5.0, step: 0.01, value: state.aspect,
    format: (v) => `${num(v, 3)} <small>minor radius ${num(state.R / v, 3)} m</small>`, onInput: set("aspect") });
  sliders.kappa = createSlider(machineBox, { label: "Elongation", min: 1.0, max: 2.3, step: 0.01, value: state.kappa,
    format: (v) => num(v, 3), hint: "How much taller than wide the plasma is.", onInput: set("kappa") });
  sliders.delta = createSlider(machineBox, { label: "Triangularity", min: 0, max: 0.7, step: 0.01, value: state.delta,
    format: (v) => v.toFixed(2), hint: "How D-shaped the plasma is.", onInput: set("delta") });
  sliders.B = createSlider(machineBox, { label: "Magnetic field", min: 1, max: 15, step: 0.1, value: state.B,
    format: (v) => `${v.toFixed(1)} T`, onInput: set("B") });
  sliders.I = createSlider(machineBox, { label: "Plasma current", min: 0.2, max: 25, log: true, value: state.I,
    format: (v) => `${num(v, 3)} MA`, hint: " ", onInput: set("I") });
  const q3 = document.createElement("button");
  q3.type = "button";
  q3.className = "chip";
  q3.style.marginTop = "10px";
  q3.textContent = "Set the current for a safety factor of 3";
  q3.addEventListener("click", () => {
    state.I = Math.min(25, Math.max(0.2, P.currentForQ95(machine(), 3)));
    sliders.I.set(state.I);
    clearPreset();
    refresh();
  });
  machineBox.appendChild(q3);

  sliders.fG = createSlider(operationBox, { label: "Density", min: 0.1, max: 1.2, step: 0.01, value: state.fG,
    format: (v) => `${Math.round(v * 100)}% <small>of the density limit</small>`, hint: " ", onInput: set("fG") });
  sliders.heating = createSlider(operationBox, { label: "External heating", min: 0, max: 150, step: 0.1, value: state.heating,
    format: (v) => `${num(v, 3)} MW`, onInput: set("heating") });
  sliders.H = createSlider(operationBox, { label: "Confinement quality", min: 0.5, max: 1.5, step: 0.01, value: state.H,
    format: (v) => `${v.toFixed(2)} <small>× standard H-mode</small>`,
    hint: "1.0 is what today's tokamaks achieve on average. Below 1 is pessimistic.", onInput: set("H") });

  sliders.tPeak = createSlider(assumptionBox, { label: "Temperature peaking", min: 1.2, max: 3.2, step: 0.05, value: state.tPeak,
    format: (v) => v.toFixed(2), hint: "Centre temperature over the average. The result is very sensitive to this.", onInput: set("tPeak") });
  sliders.nPeak = createSlider(assumptionBox, { label: "Density peaking", min: 1.0, max: 1.8, step: 0.01, value: state.nPeak,
    format: (v) => v.toFixed(2), onInput: set("nPeak") });
  sliders.helium = createSlider(assumptionBox, { label: "Helium ash", min: 0, max: 0.15, step: 0.002, value: state.helium,
    format: (v) => `${num(v * 100, 2)}%`, onInput: (v) => { state.helium = v; clampImpurity(); clearPreset(); refresh(); } });
  sliders.impurityZ = createSelect(assumptionBox, { label: "Wall impurity", options: IMPURITIES, value: state.impurityZ,
    onInput: (z) => {
      state.impurityZ = z;
      if (z === 0) { state.impurity = 0; sliders.impurity.set(0); }
      else if (state.impurity === 0) { state.impurity = 0.005; sliders.impurity.set(0.005); }
      clampImpurity();
      clearPreset();
      refresh();
    } });
  sliders.impurity = createSlider(assumptionBox, { label: "Impurity amount", min: 0, max: 0.03, step: 0.00025, value: state.impurity,
    format: (v) => `${num(v * 100, 2)}%`, onInput: (v) => { state.impurity = state.impurityZ === 0 ? 0 : v; clampImpurity(); clearPreset(); refresh(); } });
  sliders.rad = createSlider(assumptionBox, { label: "Radiation factor", min: 1, max: 3, step: 0.05, value: state.rad,
    format: (v) => `${v.toFixed(2)} <small>× bremsstrahlung</small>`, hint: "Extra radiation from impurities.", onInput: set("rad") });
  sliders.tritium = createSlider(assumptionBox, { label: "Tritium in the fuel", min: 0.1, max: 0.9, step: 0.01, value: state.tritium,
    format: (v) => `${Math.round(v * 100)}%`, onInput: set("tritium") });

  function clampImpurity() {
    if (state.impurityZ === 0) return;
    const limit = Math.max(0, (0.9 - 2 * state.helium) / state.impurityZ);
    if (state.impurity > limit) {
      state.impurity = limit;
      sliders.impurity.set(limit);
    }
  }

  // --- Presets ---------------------------------------------------------------------------
  const presetBox = document.getElementById("designerPresets");
  let activeChip = null;
  function clearPreset() {
    activeChip?.classList.remove("is-active");
    activeChip = null;
  }
  function applyState(next) {
    Object.assign(state, next);
    for (const key of Object.keys(sliders)) sliders[key].set(state[key]);
  }
  PRESETS.forEach((preset, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.innerHTML = `${preset.label}<small>${preset.tag}</small>`;
    chip.addEventListener("click", () => {
      applyState(preset.state());
      clearPreset();
      activeChip = chip;
      chip.classList.add("is-active");
      refresh();
    });
    presetBox.appendChild(chip);
    if (index === 0) {
      activeChip = chip;
      chip.classList.add("is-active");
    }
  });

  // --- Model wiring -----------------------------------------------------------------------
  const machine = () => ({ R: state.R, a: state.R / state.aspect, kappa: state.kappa, delta: state.delta, B: state.B, I: state.I });
  function composition() {
    const impurities = [[2, state.helium]];
    if (state.impurityZ) impurities.push([state.impurityZ, state.impurity]);
    return P.composition(state.tritium, impurities);
  }
  function scenarioFor(m) {
    const nG = P.machineProperties(m).greenwald;
    return {
      density: (state.fG * nG) / (state.nPeak * P.lineAverageFactor(state.nPeak)),
      heating: state.heating, hFactor: state.H, densityPeaking: state.nPeak, temperaturePeaking: state.tPeak,
      radiationFactor: state.rad, composition: composition(),
    };
  }

  // --- Views ----------------------------------------------------------------------------------
  const view = new PlasmaView(document.getElementById("designCanvas"), { interactive: true });
  const view3d = document.getElementById("view3d");
  const viewSection = document.getElementById("viewSection");
  const viewHint = document.getElementById("viewHint");
  if (view.failed) {
    view3d.hidden = true;
    viewSection.hidden = false;
    document.querySelectorAll("#designer [data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === "section"));
    document.querySelector('#designer [data-view="3d"]').disabled = true;
  }
  document.querySelectorAll("#designer [data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#designer [data-view]").forEach((b) => b.classList.toggle("is-active", b === button));
      const three = button.dataset.view === "3d";
      view3d.hidden = !three;
      viewSection.hidden = three;
      viewHint.textContent = three ? "Drag to rotate. The figure is 1.8 m tall." : "All outlines share one scale.";
      if (three) view.resize();
      else drawSection();
    });
  });
  viewHint.textContent = "Drag to rotate. The figure is 1.8 m tall.";
  new ResizeObserver(() => { if (!viewSection.hidden) drawSection(); }).observe(viewSection);

  const readouts = document.getElementById("designerReadouts");
  const gauges = document.getElementById("limitGauges");
  const verdict = document.getElementById("designVerdict");
  let latest = null;

  function update() {
    // Slider annotations that depend on other values.
    const m = machine();
    const props = P.machineProperties(m);
    sliders.aspect.set(state.aspect);
    const scenario = scenarioFor(m);
    const r = P.solveReactor(m, scenario);
    latest = { m, props, scenario, r };

    sliders.I.setHint(`Safety factor q<sub>95</sub> = ${num(props.q95, 3)}. Lower current is safer but confines less well.`);
    sliders.fG.setHint(`Average density ${num(scenario.density / 1e20, 3)} × 10<sup>20</sup> m<sup>−3</sup>.`);

    const none = r.status === "no_solution";
    const runaway = r.status === "runaway";
    const gain = none ? 0 : runaway ? Infinity : r.gain;
    const st = none
      ? { key: "cold", label: "No fusion", note: "The plasma radiates away more than it is given and cannot stay hot." }
      : runaway
        ? { key: "ignited", label: "Ignited", note: "Self-heating outruns the losses. The plasma heats beyond the model's 100 keV range." }
        : gainState(gain);
    const million = (t) => num(t * 11.604, 3);
    readouts.innerHTML = `
      <div class="readout hero-readout">
        <div class="label">Fusion gain Q</div>
        <div class="value">${gainText(gain)}</div>
        <div class="state ${st.key}">${st.label}</div>
        <div class="sub">${st.note}</div>
      </div>
      <div class="readout">
        <div class="label">Fusion power</div>
        <div class="value">${none ? "0<small>MW</small>" : withUnit(scaled(r.fusionPower, POWER))}</div>
        <div class="sub">${none ? "No reactions to speak of." : `${asText(scaled(r.fusionPower * 0.8, POWER))} leaves as neutrons; ${asText(scaled(r.alphaPower, POWER))} heats the plasma.`}</div>
      </div>
      <div class="readout">
        <div class="label">Core temperature</div>
        <div class="value">${none ? "–" : num(r.centralTemperature, 3)}<small>keV</small></div>
        <div class="sub">${none ? "No steady state." : `${million(r.centralTemperature)} million °C at the centre; ${num(r.averageTemperature, 3)} keV on average.`}</div>
      </div>
      <div class="readout">
        <div class="label">Confinement time</div>
        <div class="value">${none || !Number.isFinite(r.confinementTime) ? "–<small>s</small>" : withUnit(scaled(r.confinementTime, TIME))}</div>
        <div class="sub">Predicted by the IPB98(y,2) scaling law.</div>
      </div>
      <div class="readout">
        <div class="label">Plasma volume</div>
        <div class="value">${num(props.volume, 3)}<small>m³</small></div>
        <div class="sub">${num((100 * props.volume) / 815, 2)}% of ITER's. Stored heat ${none ? "0 MJ" : asText(scaled(r.storedEnergy, ENERGY))}.</div>
      </div>`;

    drawGauges(r, props, none);
    const design = { ...m, T0: none ? 0.3 : r.centralTemperature, tPeak: state.tPeak, q95: props.q95 };
    view.setDesign(design);
    links.onDesign?.(design);
    links.onOperatingPoint?.(none ? null : { T: r.centralTemperature, triple: r.tripleProduct });
    if (!viewSection.hidden) drawSection();
    refreshMap();
  }

  // --- Limit gauges ------------------------------------------------------------------------------
  function gauge({ name, text, value, min, max, zones, status, foot }) {
    const position = (v) => `${(100 * Math.min(1, Math.max(0, (v - min) / (max - min)))).toFixed(1)}%`;
    const zoneHTML = zones.map(([from, to, color]) =>
      `<span class="gauge-zone" style="left:${position(from)};width:calc(${position(to)} - ${position(from)});background:${color}"></span>`).join("");
    const icon = { ok: "✓", warn: "!", bad: "✕" }[status[0]];
    return `<div class="gauge">
      <div class="gauge-head"><span class="name">${name}</span><span class="num">${text}</span></div>
      <div class="gauge-track">${zoneHTML}<span class="gauge-marker" style="left:${position(value)}"></span></div>
      <div class="gauge-foot"><span class="badge ${status[0]}">${icon} ${status[1]}</span><span>${foot}</span></div>
    </div>`;
  }

  function drawGauges(r, props, none) {
    const G = "var(--good)", W = "var(--warning)", C = "var(--critical)";
    const issues = [];
    const density = r.greenwaldFraction;
    const densityStatus = density > 1 ? ["bad", "Over the limit"] : density > 0.85 ? ["warn", "Close"] : ["ok", "Safe"];
    if (density > 1) issues.push("the density is above the Greenwald limit");
    const beta = none ? 0 : r.betaNormalised;
    const betaStatus = beta > 3.5 ? ["bad", "Unstable"] : beta > 2.8 ? ["warn", "Demanding"] : ["ok", "Stable"];
    if (beta > 3.5) issues.push("the plasma pressure is above the stability limit");
    const q = props.q95;
    const qStatus = q < 2 ? ["bad", "Unstable"] : q < 3 ? ["warn", "Risky"] : ["ok", "Safe"];
    if (q < 2) issues.push("the safety factor is below 2");
    const lh = none ? 0 : r.lhMargin;
    const lhStatus = lh < 0.8 ? ["bad", "Not reached"] : lh < 1 ? ["warn", "Marginal"] : ["ok", "Reached"];
    if (lh < 0.8) issues.push("there is too little power to hold the high-confinement mode the model assumes");

    gauges.innerHTML =
      gauge({ name: "Density limit", text: `${Math.round(density * 100)}%`, value: density, min: 0, max: 1.4,
        zones: [[0, 0.85, G], [0.85, 1, W], [1, 1.4, C]], status: densityStatus,
        foot: "Share of the Greenwald limit. Above it, plasmas usually disrupt." }) +
      gauge({ name: "Pressure limit", text: `β<sub>N</sub> = ${num(beta, 3)}`, value: beta, min: 0, max: 5,
        zones: [[0, 2.8, G], [2.8, 3.5, W], [3.5, 5, C]], status: betaStatus,
        foot: "Normalised pressure. Stability is lost somewhere between 2.8 and 3.5." }) +
      gauge({ name: "Safety factor", text: `q<sub>95</sub> = ${num(q, 3)}`, value: q, min: 1, max: 7,
        zones: [[1, 2, C], [2, 3, W], [3, 7, G]], status: qStatus,
        foot: "Twist of the magnetic field. Below 2 the plasma kinks; designs aim for about 3." }) +
      gauge({ name: "High-confinement mode", text: `${num(lh, 2)}×`, value: lh, min: 0, max: 4,
        zones: [[0, 0.8, C], [0.8, 1, W], [1, 4, G]], status: lhStatus,
        foot: `Power leaving the plasma against the ${num(r.lhThreshold, 3)} MW needed for H-mode.` }) +
      `<div class="gauge"><div class="gauge-head"><span class="name">Neutron load on the wall</span>
        <span class="num">${none ? "0" : num(r.neutronWallLoad, 3)} MW/m²</span></div>
        <div class="gauge-foot"><span>Fusion neutron power per square metre of plasma surface. No limit is applied here.</span></div></div>`;

    const startup = r.radiationBarrier && !none
      ? `<br><br><strong>Start-up note.</strong>At full density this heating cannot outpace radiation at low temperature. ` +
        `Real machines get past this barrier by heating the plasma before raising its density.`
      : "";
    verdict.innerHTML = none
      ? r.radiationBarrier
        ? `<strong>Radiation wins.</strong>At this density the plasma radiates away more than the heating supplies, so it never gets hot. Add heating, lower the density, or clean up the impurities.`
        : `<strong>This plasma does not burn.</strong>Add heating, raise the field or current, or make the machine bigger.`
      : (issues.length
        ? `<strong>Outside its limits.</strong>As set, ${issues.join(", and ")}. The gain shown would not be reached in practice.`
        : `<strong>Inside every limit shown.</strong>That is necessary for the design to work, but this model does not check the exhaust, the magnets or the wall.`) + startup;
  }

  // --- Cross-section, to scale ----------------------------------------------------------------------
  function drawSection() {
    if (!latest) return;
    const { m } = latest;
    const references = ["ITER", "SPARC"].map((name) => {
      const d = DATA.machines.find((x) => x.name === name);
      return { name, R: d.R, a: d.a, kappa: d.kappaSep, delta: d.deltaSep };
    });
    const all = [...references, { name: "Your design", ...m }];
    const maxR = Math.max(...all.map((d) => d.R + d.a)) + 0.6;
    const maxZ = Math.max(...all.map((d) => d.kappa * d.a), 1.2) + 0.5;
    const width = Math.max(320, viewSection.clientWidth - 20);
    const margin = { top: 22, right: 16, bottom: 40, left: 16 };
    const scale = Math.min((width - margin.left - margin.right) / maxR, 470 / (2 * maxZ));
    const height = Math.round(2 * maxZ * scale + margin.top + margin.bottom);
    const x = (r) => margin.left + r * scale;
    const y = (z) => margin.top + (maxZ - z) * scale;
    const path = (d) => "M" + sectionOutline(d, 1, 120).map(([r, z]) => `${x(r).toFixed(1)},${y(z).toFixed(1)}`).join("L") + "Z";

    const svg = d3.select(viewSection).selectAll("svg").data([0]).join("svg")
      .attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", "Plasma cross-sections of your design, ITER and SPARC drawn to the same scale");
    svg.selectAll("*").remove();
    const defs = svg.append("defs");
    const gradient = defs.append("radialGradient").attr("id", "sectionGlow");
    gradient.append("stop").attr("offset", "0%").attr("stop-color", "#ffe9a8").attr("stop-opacity", 0.95);
    gradient.append("stop").attr("offset", "45%").attr("stop-color", "#ff9d4d").attr("stop-opacity", 0.7);
    gradient.append("stop").attr("offset", "80%").attr("stop-color", "#ff4fa3").attr("stop-opacity", 0.45);
    gradient.append("stop").attr("offset", "100%").attr("stop-color", "#7b5cff").attr("stop-opacity", 0.3);

    // One-metre grid.
    for (let r = 0; r <= maxR; r++) svg.append("line").attr("class", "gridline").attr("x1", x(r)).attr("x2", x(r)).attr("y1", y(maxZ)).attr("y2", y(-maxZ));
    for (let z = -Math.floor(maxZ); z <= maxZ; z++) svg.append("line").attr("class", "gridline").attr("x1", x(0)).attr("x2", x(maxR)).attr("y1", y(z)).attr("y2", y(z));
    svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", y(maxZ)).attr("y2", y(-maxZ)).attr("stroke", "#8f8d86").attr("stroke-dasharray", "6 5");
    svg.append("text").attr("class", "point-label").attr("x", x(0) + 6).attr("y", y(maxZ) + 12).text("Centre of the machine");

    for (const d of references) {
      svg.append("path").attr("d", path(d)).attr("fill", "rgba(255,255,255,0.03)").attr("stroke", "#8f8d86").attr("stroke-width", 1.4);
      svg.append("text").attr("class", "point-label").attr("x", x(d.R)).attr("y", y(d.kappa * d.a) - 7).attr("text-anchor", "middle").text(d.name);
    }
    svg.append("path").attr("d", path(m)).attr("fill", "url(#sectionGlow)").attr("stroke", "#ffffff").attr("stroke-width", 2);
    svg.append("text").attr("class", "curve-label").attr("x", x(m.R)).attr("y", y(-m.kappa * m.a) + 17).attr("text-anchor", "middle")
      .style("font-weight", 600).text("Your design");

    // A 1.8 m figure and a scale bar.
    const foot = y(-maxZ + 0.1);
    const px = x(maxR - 0.45);
    svg.append("rect").attr("x", px - 0.17 * scale).attr("y", foot - 1.52 * scale).attr("width", 0.34 * scale).attr("height", 1.52 * scale)
      .attr("rx", 0.16 * scale).attr("fill", "#c3c2b7");
    svg.append("circle").attr("cx", px).attr("cy", foot - 1.67 * scale).attr("r", 0.13 * scale).attr("fill", "#c3c2b7");
    svg.append("text").attr("class", "point-label").attr("x", px - 0.3 * scale).attr("y", foot - 0.8 * scale).attr("text-anchor", "end").text("1.8 m person");
    const barY = height - 14;
    svg.append("line").attr("x1", x(0)).attr("x2", x(1)).attr("y1", barY).attr("y2", barY).attr("stroke", "#f0efec").attr("stroke-width", 2);
    svg.append("text").attr("class", "tick-label").attr("x", x(1) + 8).attr("y", barY + 4).text("1 metre (grid squares are 1 m)");
  }

  // --- Design-space map ------------------------------------------------------------------------------
  const mapBox = document.getElementById("designMap");
  const mapNote = document.getElementById("mapNote");
  let mapState = null;

  (function colorbar() {
    const box = document.getElementById("mapColorbar");
    const canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 10;
    const ctx = canvas.getContext("2d");
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = heatRamp(i / 179);
      ctx.fillRect(i, 0, 1, 10);
    }
    box.innerHTML = "<span>Q 0.05</span>";
    box.appendChild(canvas);
    box.insertAdjacentHTML("beforeend", "<span>50+</span>");
  })();

  // The grid of reactor solutions is computed in a background worker; the page
  // only paints it. A coarse map arrives first, then the full one.
  let mapWorker = null;
  let mapBusy = false;
  let mapJob = 0;
  let mapKey = "";
  let mapCache = null;
  let workersFailed = false;

  function mapParams() {
    return {
      nx: MAP.nx, ny: MAP.ny, R: MAP.R, B: MAP.B,
      aspect: state.aspect, kappa: state.kappa, delta: state.delta, q95: latest.props.q95,
      scenario: {
        greenwaldFraction: state.fG, heating: state.heating, hFactor: state.H, densityPeaking: state.nPeak,
        temperaturePeaking: state.tPeak, radiationFactor: state.rad, tritiumFraction: state.tritium,
        impurities: composition().impurities,
      },
    };
  }

  function finishMap(key, grid) {
    mapBusy = false;
    mapCache = { key, grid };
    mapBox.classList.remove("is-updating");
    paintMap(grid);
  }

  function startWorker() {
    try {
      mapWorker = new Worker(new URL("./map-worker.js", import.meta.url), { type: "module" });
    } catch (error) {
      workersFailed = true;
      return;
    }
    mapWorker.onmessage = (event) => {
      const { id, stage, nx, ny, values, betas } = event.data;
      if (id !== mapJob) return;
      if (stage === "coarse") paintMap({ nx, ny, values, betas });
      else finishMap(mapKey, { nx, ny, values, betas });
    };
    mapWorker.onerror = () => {
      workersFailed = true;
      mapWorker.terminate();
      mapWorker = null;
      mapBusy = false;
      requestMap();
    };
  }

  function requestMap() {
    if (!latest) return;
    const params = mapParams();
    const key = JSON.stringify(params);
    if (mapCache && mapCache.key === key) {
      paintMap(mapCache.grid);
      return;
    }
    if (mapBusy && key === mapKey) return;
    mapKey = key;
    mapJob += 1;
    mapBox.classList.add("is-updating");
    if (workersFailed) {
      setTimeout(() => finishMap(key, computeMapGrid(params)), 0);
      return;
    }
    if (mapBusy || !mapWorker) {
      mapWorker?.terminate();
      startWorker();
      if (workersFailed) return requestMap();
    }
    mapBusy = true;
    mapWorker.postMessage({ id: mapJob, params });
  }

  function paintMap(grid) {
    if (!latest) return;
    const { values, betas, nx, ny } = grid;
    const q95 = latest.props.q95;

    // Heat map image (row 0 at the top = highest field).
    const cell = document.createElement("canvas");
    cell.width = nx;
    cell.height = ny;
    const ctx = cell.getContext("2d");
    const image = ctx.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = d3.rgb(mapColor(values[(ny - 1 - j) * nx + i]));
        const k = 4 * (j * nx + i);
        image.data[k] = c.r; image.data[k + 1] = c.g; image.data[k + 2] = c.b; image.data[k + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    const smooth = document.createElement("canvas");
    smooth.width = nx * 10;
    smooth.height = ny * 10;
    const sctx = smooth.getContext("2d");
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(cell, 0, 0, smooth.width, smooth.height);

    const width = Math.max(320, mapBox.clientWidth);
    const height = Math.round(Math.min(480, Math.max(300, width * 0.42)));
    const margin = { top: 14, right: 20, bottom: 46, left: 56 };
    const x = d3.scaleLinear().domain(MAP.R).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain(MAP.B).range([height - margin.bottom, margin.top]);
    // Cell centres sit on the axis ends, so the image overhangs by half a cell.
    const halfX = (x(MAP.R[1]) - x(MAP.R[0])) / (nx - 1) / 2;
    const halfY = (y(MAP.B[0]) - y(MAP.B[1])) / (ny - 1) / 2;
    const clip = "mapClip";

    const svg = d3.select(mapBox).selectAll("svg").data([0]).join("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img").attr("aria-label", "Fusion gain as a function of major radius and magnetic field");
    svg.selectAll("*").remove();
    svg.append("defs").append("clipPath").attr("id", clip).append("rect")
      .attr("x", margin.left).attr("y", margin.top).attr("width", width - margin.left - margin.right).attr("height", height - margin.top - margin.bottom);
    const plot = svg.append("g").attr("clip-path", `url(#${clip})`);
    plot.append("image").attr("href", smooth.toDataURL()).attr("preserveAspectRatio", "none")
      .attr("x", x(MAP.R[0]) - halfX).attr("y", y(MAP.B[1]) - halfY)
      .attr("width", x(MAP.R[1]) - x(MAP.R[0]) + 2 * halfX).attr("height", y(MAP.B[0]) - y(MAP.B[1]) + 2 * halfY);

    // Contours of constant gain, and the pressure limit.
    const toScreen = d3.geoTransform({
      point(gx, gy) {
        this.stream.point(x(MAP.R[0]) + (gx - 0.5) * 2 * halfX, y(MAP.B[0]) - (gy - 0.5) * 2 * halfY);
      },
    });
    const geo = d3.geoPath(toScreen);
    // Places to keep clear of contour labels: machine markers, the design marker and earlier labels.
    const occupied = DATA.machines.map((d) => [x(d.R), y(d.B)]);
    occupied.push([x(state.R), y(state.B)]);
    const labelAt = (contour) => {
      let best = null;
      let bestScore = -Infinity;
      for (const polygon of contour.coordinates) {
        for (const ring of polygon) {
          for (let k = 0; k < ring.length; k += 2) {
            const [gx, gy] = ring[k];
            if (gx < 3 || gx > nx - 3 || gy < 2 || gy > ny - 2) continue;
            const px = x(MAP.R[0]) + (gx - 0.5) * 2 * halfX;
            const py = y(MAP.B[0]) - (gy - 0.5) * 2 * halfY;
            if (px < margin.left + 28 || px > width - margin.right - 28) continue;
            const clearance = Math.min(...occupied.map(([ox, oy]) => Math.hypot((ox - px) / 1.8, oy - py)));
            if (clearance > bestScore) {
              bestScore = clearance;
              best = [px, py];
            }
          }
        }
      }
      if (best) occupied.push(best);
      return best;
    };
    for (const contour of d3.contours().size([nx, ny]).thresholds([1, 5, 10])(values)) {
      plot.append("path").attr("d", geo(contour)).attr("fill", "none").attr("stroke", "#ffffff").attr("stroke-width", 1.3).attr("opacity", 0.85);
      const at = labelAt(contour);
      if (at) svg.append("g").attr("class", "map-marker").append("text").attr("x", at[0]).attr("y", at[1] + 4).attr("text-anchor", "middle").text(`Q = ${contour.value}`);
    }
    for (const contour of d3.contours().size([nx, ny]).thresholds([3.5])(betas)) {
      plot.append("path").attr("d", geo(contour)).attr("fill", "none").attr("stroke", "#e66767").attr("stroke-width", 1.6).attr("stroke-dasharray", "6 5");
      const at = labelAt(contour);
      if (at) svg.append("g").attr("class", "map-marker").append("text").attr("x", at[0]).attr("y", at[1] - 6).attr("text-anchor", "middle")
        .style("fill", "#f3a3a3").text("pressure limit");
    }

    // Axes.
    for (const t of x.ticks(9)) {
      svg.append("text").attr("class", "tick-label").attr("x", x(t)).attr("y", height - margin.bottom + 18).attr("text-anchor", "middle").text(t);
    }
    for (const t of y.ticks(6)) {
      svg.append("text").attr("class", "tick-label").attr("x", margin.left - 10).attr("y", y(t) + 4).attr("text-anchor", "end").text(t);
    }
    svg.append("text").attr("class", "axis-title").attr("x", (margin.left + width - margin.right) / 2).attr("y", height - 8).attr("text-anchor", "middle").text("Major radius (m)");
    svg.append("text").attr("class", "axis-title").attr("transform", `translate(14 ${(margin.top + height - margin.bottom) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle").text("Magnetic field on axis (T)");

    // Real machines, for orientation.
    const marks = svg.append("g").attr("class", "map-marker");
    const designShown = state.R >= MAP.R[0] && state.R <= MAP.R[1] && state.B >= MAP.B[0] && state.B <= MAP.B[1];
    let coincides = null;
    for (const d of DATA.machines) {
      if (d.R < MAP.R[0] || d.R > MAP.R[1] || d.B < MAP.B[0] || d.B > MAP.B[1]) continue;
      marks.append("circle").attr("cx", x(d.R)).attr("cy", y(d.B)).attr("r", 3.6).attr("fill", "#07090d").attr("stroke", "#f0efec").attr("stroke-width", 1.5);
      if (designShown && Math.hypot(x(d.R) - x(state.R), y(d.B) - y(state.B)) < 16) {
        coincides = d.name;
        continue;
      }
      const narrow = width < 600;
      if (narrow && !["ITER", "SPARC", "Alcator C-Mod"].includes(d.name)) continue;
      const left = d.R > 7.5 || (d.name === "ASDEX Upgrade" && x(d.R) - margin.left > 100);
      marks.append("text").attr("x", x(d.R) + (left ? -8 : 8)).attr("y", y(d.B) + (d.name === "EAST" ? 14 : d.name === "KSTAR" ? -6 : 4))
        .attr("text-anchor", left ? "end" : "start").text(d.name);
    }
    if (designShown) {
      const g = marks.append("g").attr("transform", `translate(${x(state.R)} ${y(state.B)})`);
      g.append("circle").attr("r", 11).attr("fill", "none").attr("stroke", "#ffffff").attr("stroke-width", 2.2);
      g.append("circle").attr("r", 3).attr("fill", "#ffffff");
      const high = y(state.B) - margin.top < 30;
      g.append("text").attr("x", 0).attr("y", high ? 27 : -17).attr("text-anchor", "middle").style("font-weight", 600)
        .text(coincides ? `Your design (${coincides})` : "Your design");
    }

    // Interaction.
    const cellAt = (event) => {
      const [px, py] = d3.pointer(event, svg.node());
      const R = x.invert(px);
      const B = y.invert(py);
      if (R < MAP.R[0] || R > MAP.R[1] || B < MAP.B[0] || B > MAP.B[1]) return null;
      const i = Math.round(((R - MAP.R[0]) / (MAP.R[1] - MAP.R[0])) * (nx - 1));
      const j = Math.round(((B - MAP.B[0]) / (MAP.B[1] - MAP.B[0])) * (ny - 1));
      return { R, B, q: values[j * nx + i] };
    };
    svg.style("cursor", "crosshair")
      .on("pointermove", (event) => {
        const c = cellAt(event);
        if (!c) return hideTooltip();
        showTooltip(`<strong>${num(c.R, 3)} m at ${num(c.B, 3)} T</strong>Fusion gain <span class="mono">Q = ${c.q >= 1e3 ? "∞ (ignited)" : gainText(c.q)}</span><br>Click to try this machine.`, event.clientX, event.clientY);
      })
      .on("pointerleave", hideTooltip)
      .on("click", (event) => {
        const c = cellAt(event);
        if (!c) return;
        state.R = Math.round(c.R * 100) / 100;
        state.B = Math.round(c.B * 10) / 10;
        state.I = Math.min(25, Math.max(0.2, P.currentForQ95({ ...machine(), I: 1 }, q95)));
        for (const key of ["R", "B", "I"]) sliders[key].set(state[key]);
        clearPreset();
        refresh();
      });

    mapNote.innerHTML = `Every point is a machine with your shape, your safety factor (q<sub>95</sub> = ${num(q95, 3)}), your density fraction, ` +
      `${num(state.heating, 3)} MW of heating and your physics assumptions, at a different size and field. ` +
      `White lines mark Q = 1, 5 and 10. Dots are real machines at their own size and field. Click anywhere to jump to that design.`;
    mapState = { values };
  }
  let mapWidth = mapBox.clientWidth;
  new ResizeObserver(debounce(() => {
    if (Math.abs(mapBox.clientWidth - mapWidth) < 2) return;
    mapWidth = mapBox.clientWidth;
    if (mapCache) paintMap(mapCache.grid);
  }, 200)).observe(mapBox);

  update();
  return { getDesign: () => latest };
}
