// Entry point: wires the hero, the explorer, the designer and the method tables.

import * as P from "./physics.js";
import { DATA } from "./data.js";
import { initDesigner } from "./designer.js";
import { initExplorer } from "./explorer.js";
import { PlasmaView } from "./plasma3d.js";
import { num, sci } from "./ui.js";

// --- Navigation ------------------------------------------------------------------------
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 24);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// --- Tools -----------------------------------------------------------------------------
const explorer = initExplorer();
const heroView = new PlasmaView(document.getElementById("heroCanvas"), { offsetX: 0.25, distance: 1.42, person: false });
if (heroView.failed) {
  document.getElementById("heroCanvas").hidden = true;
  document.getElementById("heroCaption").hidden = true;
}
initDesigner({
  onDesign: (design) => heroView.setDesign(design),
  onOperatingPoint: (point) => explorer.setReactor(point),
});

// --- Equations -------------------------------------------------------------------------
function renderEquations() {
  if (!window.katex) return false;
  document.querySelectorAll(".equation[data-tex]").forEach((el) => {
    window.katex.render(el.dataset.tex, el, { displayMode: true, throwOnError: false });
  });
  return true;
}
if (!renderEquations()) window.addEventListener("load", renderEquations);

// --- Validation tables, computed live by the same engine -------------------------------
const delta = (model, published) => {
  const d = 100 * (model / published - 1);
  return `<span class="delta">${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%</span>`;
};
const table = (id, head, rows) => {
  document.getElementById(id).innerHTML =
    `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((c) => `<td class="num">${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
};

{
  const pub = DATA.publishedThresholds;
  const ideal = P.idealIgnitionTemperature();
  const l1 = P.minimumLawsonParameter(1);
  const li = P.minimumLawsonParameter(Infinity);
  const t1 = P.minimumTripleProduct(1);
  const ti = P.minimumTripleProduct(Infinity);
  const at = (m) => ` <span class="delta">at ${m.temperature.toFixed(1)} keV</span>`;
  table("thresholdTable", ["Quantity", "This model", "Published"], [
    ["Coldest plasma that can ignite", `${ideal.toFixed(2)} keV`, `${pub.idealIgnitionTemperature} keV`],
    ["Least nτ for Q = 1 (m⁻³ s)", sci(l1.value) + at(l1), sci(pub.lawsonQ1[0], 1) + delta(l1.value, pub.lawsonQ1[0])],
    ["Least nτ for ignition", sci(li.value) + at(li), sci(pub.lawsonIgnition[0], 1) + delta(li.value, pub.lawsonIgnition[0])],
    ["Least nTτ for Q = 1 (keV m⁻³ s)", sci(t1.value) + at(t1), sci(pub.tripleQ1[0], 1) + delta(t1.value, pub.tripleQ1[0])],
    ["Least nTτ for ignition", sci(ti.value) + at(ti), sci(pub.tripleIgnition[0], 1) + delta(ti.value, pub.tripleIgnition[0])],
  ]);
}

const solvePreset = (preset, overrides = {}) => {
  const s = { ...preset.scenario, ...overrides };
  return P.solveReactor(preset.machine, { ...s, composition: P.composition(s.tritiumFraction, s.impurities) });
};

{
  const preset = DATA.presets.sparc;
  const r = solvePreset(preset);
  const pub = preset.published;
  const q = P.machineProperties(preset.machine).qCylindrical;
  table("sparcTable", ["Quantity", "This model", "Published"], [
    ["Fusion power", `${num(r.fusionPower, 4)} MW`, `${pub.fusion_power} MW` + delta(r.fusionPower, pub.fusion_power)],
    ["Fusion gain Q", num(r.gain, 4), pub.gain.toFixed(1) + delta(r.gain, pub.gain)],
    ["Confinement time", `${r.confinementTime.toFixed(3)} s`, `${pub.confinement_time} s` + delta(r.confinementTime, pub.confinement_time)],
    ["Average temperature", `${r.averageTemperature.toFixed(2)} keV`, `${pub.average_temperature} keV` + delta(r.averageTemperature, pub.average_temperature)],
    ["Normalised pressure β<sub>N</sub>", r.betaNormalised.toFixed(2), pub.beta_normalised.toFixed(1)],
    ["Safety factor q* (Uckan)", q.toFixed(2), pub.q_cylindrical.toFixed(2)],
    ["Gain with pessimistic confinement (H = 0.7)", num(solvePreset(preset, { hFactor: 0.7 }).gain, 3), "above 2"],
  ]);
}

{
  const preset = DATA.presets.iter;
  const r = solvePreset(preset);
  const pub = preset.published;
  const peaked = (v) => num(solvePreset(preset, { temperaturePeaking: v }).gain, 3);
  table("iterTable", ["Quantity", "This model", "Published design"], [
    ["Fusion gain Q (temperature peaking 1.6)", num(r.gain, 3), pub.gain.toFixed(0) + delta(r.gain, pub.gain)],
    ["Fusion power", `${num(r.fusionPower, 3)} MW`, `${pub.fusion_power} MW` + delta(r.fusionPower, pub.fusion_power)],
    ["Confinement time", `${r.confinementTime.toFixed(2)} s`, `${pub.confinement_time} s` + delta(r.confinementTime, pub.confinement_time)],
    ["Plasma volume", `${num(r.volume, 3)} m³`, `about ${pub.volume} m³` + delta(r.volume, pub.volume)],
    ["Same inputs, peaking 2.0", `Q = ${peaked(2.0)}`, "–"],
    ["Same inputs, peaking 2.5 (as assumed for SPARC)", `Q = ${peaked(2.5)}`, "–"],
  ]);
}
