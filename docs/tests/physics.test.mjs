// Checks the JavaScript physics engine against values exported from the
// tested Python model.
//
//   node docs/tests/physics.test.mjs
//
// Regenerate the reference values with:  python tools/export_web_data.py

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as P from "../js/physics.js";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "vectors.json"), "utf8"));

let checks = 0;
const failures = [];
const decode = (v) => (v === "inf" ? Infinity : v === "-inf" ? -Infinity : v === "nan" ? NaN : v);

function close(actual, expected, tolerance, label) {
  checks++;
  expected = decode(expected);
  const ok =
    (Number.isNaN(expected) && Number.isNaN(actual)) ||
    (!Number.isFinite(expected) && actual === expected) ||
    (expected === 0 ? Math.abs(actual) < 1e-12 : Math.abs(actual / expected - 1) <= tolerance);
  if (!ok) failures.push(`${label}: got ${actual}, expected ${expected}`);
}

function same(actual, expected, label) {
  checks++;
  if (actual !== expected) failures.push(`${label}: got ${actual}, expected ${expected}`);
}

for (const [t, value] of vectors.reactivity) close(P.reactivity(t), value, 1e-12, `reactivity(${t})`);

for (const c of vectors.lawson) {
  const comp = P.composition(c.tritium, c.impurities);
  const q = decode(c.q);
  close(P.lawsonParameter(c.T, q, comp), c.lawson, 1e-11, `lawson T=${c.T} q=${c.q}`);
  close(P.lawsonParameter(c.T, q, comp, false), c.lawsonNoBrems, 1e-11, `lawson (no brems) T=${c.T} q=${c.q}`);
}

for (const c of vectors.minima) {
  const comp = P.composition(c.tritium, c.impurities);
  const q = decode(c.q);
  const l = P.minimumLawsonParameter(q, comp);
  const t = P.minimumTripleProduct(q, comp);
  close(l.temperature, c.lawson[0], 1e-6, `min lawson T q=${c.q}`);
  close(l.value, c.lawson[1], 1e-9, `min lawson value q=${c.q}`);
  close(t.temperature, c.triple[0], 1e-6, `min triple T q=${c.q}`);
  close(t.value, c.triple[1], 1e-9, `min triple value q=${c.q}`);
  close(P.idealIgnitionTemperature(comp), c.idealIgnition, 1e-9, "ideal ignition temperature");
}

for (const c of vectors.gains) close(P.gainFromState(c.T, c.nTau), c.gain, 1e-10, `gain T=${c.T}`);
for (const [t, value] of vectors.laser) close(P.laserIgnitionLawson(t), value, 1e-12, `laser(${t})`);
for (const [p, value] of vectors.lineAverage) close(P.lineAverageFactor(p), value, 1e-12, `lineAverage(${p})`);

vectors.reactor.forEach((c, index) => {
  const scenario = { ...c.scenario, composition: P.composition(c.scenario.tritiumFraction, c.scenario.impurities) };
  const r = P.solveReactor(c.machine, scenario);
  const label = `reactor #${index}`;
  same(r.status, c.result.status, `${label} status`);
  same(r.ignitionPossible, c.result.ignitionPossible, `${label} ignitionPossible`);
  same(r.radiationBarrier, c.result.radiationBarrier, `${label} radiationBarrier`);
  for (const key of ["q95", "greenwaldFraction", "lhThreshold", "volume", "surface"]) {
    close(r[key], c.result[key], 1e-11, `${label} ${key}`);
  }
  for (const key of [
    "centralTemperature", "fusionPower", "radiatedPower", "lossPower", "gain", "confinementTime", "storedEnergy",
    "betaNormalised", "tripleProduct",
  ]) {
    close(r[key], c.result[key], 1e-8, `${label} ${key}`);
  }
});

if (failures.length) {
  console.error(`${failures.length} of ${checks} checks FAILED`);
  for (const f of failures.slice(0, 25)) console.error("  " + f);
  process.exit(1);
}
console.log(`${checks} checks passed: the JavaScript engine matches the Python model.`);
