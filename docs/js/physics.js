// Physics engine for the web app.
//
// This is a line-for-line port of the Python package in ../../lawson
// (reactivity.py, criteria.py, reactor.py). It is checked against values
// exported from the Python code by docs/tests/physics.test.mjs, so the numbers
// shown in the browser are the same numbers the tested Python model produces.
//
// Units: temperature in keV, density in m^-3, time in s, power in MW unless
// stated, energy in MJ.

export const KEV_TO_J = 1.602176634e-16;
export const E_FUSION_KEV = 17.6e3;
export const ALPHA_FRACTION = 0.2;
export const E_ALPHA_KEV = ALPHA_FRACTION * E_FUSION_KEV;
export const C_BREMS = 5.34e-37; // W m^3 keV^-1/2
export const B_GAMOW = 34.3827;
export const MU_C2_KEV = 1124656.0;
export const T_MIN = 0.2;
export const T_MAX = 100.0;
const MU_0 = 4.0e-7 * Math.PI;

// --- Reactivity (Bosch & Hale 1992, Table VII) ------------------------------------

const C = [1.17302e-9, 1.51361e-2, 7.51886e-2, 4.60643e-3, 1.35e-2, -1.0675e-4, 1.366e-5];

/** D-T thermal reactivity in m^3/s; zero outside the fit's 0.2-100 keV range. */
export function reactivity(t) {
  if (!(t >= T_MIN && t <= T_MAX)) return 0.0;
  const theta = t / (1.0 - (t * (C[1] + t * (C[3] + t * C[5]))) / (1.0 + t * (C[2] + t * (C[4] + t * C[6]))));
  const xi = Math.cbrt((B_GAMOW * B_GAMOW) / (4.0 * theta));
  return C[0] * theta * Math.sqrt(xi / (MU_C2_KEV * t * t * t)) * Math.exp(-3.0 * xi) * 1.0e-6;
}

// --- Composition -----------------------------------------------------------------------

/**
 * Fuel mix and impurity content.
 * @param {number} tritiumFraction n_T / (n_D + n_T)
 * @param {Array<[number, number]>} impurities list of [charge, n_Z / n_e]; helium is charge 2
 */
export function composition(tritiumFraction = 0.5, impurities = []) {
  let fuel = 1.0;
  let ions = 0.0;
  let zEff = 0.0;
  for (const [z, f] of impurities) {
    fuel -= z * f;
    ions += f;
    zEff += z * z * f;
  }
  return {
    tritiumFraction,
    impurities,
    fuelFraction: fuel,
    ionFraction: fuel + ions,
    zEff: fuel + zEff,
    reactantProduct: tritiumFraction * (1.0 - tritiumFraction) * fuel * fuel,
    fuelMass: 2.0 + tritiumFraction,
    valid: fuel > 0.0 && tritiumFraction > 0.0 && tritiumFraction < 1.0,
  };
}

export const PURE_DT = composition();

// --- Lawson criteria (uniform plasma) ------------------------------------------------

/** Fusion power density over n_e^2, W m^3. */
export function fusionCoefficient(t, comp = PURE_DT) {
  return comp.reactantProduct * reactivity(t) * E_FUSION_KEV * KEV_TO_J;
}

/** Alpha heating power density over n_e^2, W m^3. */
export function alphaCoefficient(t, comp = PURE_DT) {
  return ALPHA_FRACTION * fusionCoefficient(t, comp);
}

/** Bremsstrahlung power density over n_e^2, W m^3. */
export function bremsCoefficient(t, comp = PURE_DT) {
  return C_BREMS * comp.zEff * Math.sqrt(t);
}

/** Required n_e tau_E (m^-3 s) for fuel gain q (Infinity = ignition); Infinity if unreachable. */
export function lawsonParameter(t, q = Infinity, comp = PURE_DT, brems = true) {
  const inverseQ = Number.isFinite(q) ? 1.0 / q : 0.0;
  const stored = 1.5 * (1.0 + comp.ionFraction) * t * KEV_TO_J;
  const denominator = (ALPHA_FRACTION + inverseQ) * fusionCoefficient(t, comp) - (brems ? bremsCoefficient(t, comp) : 0.0);
  return denominator > 0.0 ? stored / denominator : Infinity;
}

/** Required n_e T tau_E (keV m^-3 s). */
export function tripleProduct(t, q = Infinity, comp = PURE_DT, brems = true) {
  return t * lawsonParameter(t, q, comp, brems);
}

function minimise(fn) {
  const step = 0.005;
  const count = Math.round((T_MAX - T_MIN) / step) + 1;
  const h = (T_MAX - T_MIN) / (count - 1);
  let best = Infinity;
  let index = 0;
  for (let i = 0; i < count; i++) {
    const v = fn(T_MIN + i * h);
    if (v < best) {
      best = v;
      index = i;
    }
  }
  const t = T_MIN + index * h;
  if (index > 0 && index < count - 1) {
    const y0 = fn(t - h);
    const y2 = fn(t + h);
    if (Number.isFinite(y0) && Number.isFinite(y2)) {
      const curvature = y0 - 2.0 * best + y2;
      if (curvature > 0.0) {
        const shift = (0.5 * (y0 - y2)) / curvature;
        return { temperature: t + shift * h, value: best - 0.25 * (y0 - y2) * shift };
      }
    }
  }
  return { temperature: t, value: best };
}

export function minimumLawsonParameter(q = Infinity, comp = PURE_DT, brems = true) {
  return minimise((t) => lawsonParameter(t, q, comp, brems));
}

export function minimumTripleProduct(q = Infinity, comp = PURE_DT, brems = true) {
  return minimise((t) => tripleProduct(t, q, comp, brems));
}

/** Lowest temperature at which alpha heating balances bremsstrahlung; NaN if none. */
export function idealIgnitionTemperature(comp = PURE_DT) {
  const net = (t) => alphaCoefficient(t, comp) - bremsCoefficient(t, comp);
  const n = 2000;
  const ratio = Math.pow(T_MAX / T_MIN, 1.0 / (n - 1));
  let previousT = T_MIN;
  let previous = net(previousT);
  for (let i = 1; i < n; i++) {
    const t = i === n - 1 ? T_MAX : T_MIN * Math.pow(ratio, i);
    const value = net(t);
    if (previous < 0.0 && value >= 0.0) {
      let low = previousT;
      let high = t;
      for (let k = 0; k < 80; k++) {
        const mid = 0.5 * (low + high);
        if (net(mid) >= 0.0) high = mid;
        else low = mid;
      }
      return 0.5 * (low + high);
    }
    previousT = t;
    previous = value;
  }
  return NaN;
}

/** Fuel gain a uniform plasma would reach at temperature t and n_e tau_E; Infinity if ignited. */
export function gainFromState(t, nTau, comp = PURE_DT) {
  const fusion = fusionCoefficient(t, comp);
  if (!(fusion > 0.0)) return 0.0;
  const stored = 1.5 * (1.0 + comp.ionFraction) * t * KEV_TO_J;
  const inverseQ = (stored / nTau + bremsCoefficient(t, comp)) / fusion - ALPHA_FRACTION;
  return inverseQ <= 0.0 ? Infinity : 1.0 / inverseQ;
}

/** Hot-spot ignition threshold n tau_stag for laser fusion (Wurzel & Hsu 2025, Eq. 2). */
export function laserIgnitionLawson(t, fAlpha = 1.4, thetaAlpha = 0.93) {
  const sv = reactivity(t);
  if (!(sv > 0.0)) return Infinity;
  return ((2.0 * fAlpha) / thetaAlpha) * ((12.0 * t * KEV_TO_J) / (sv * E_ALPHA_KEV * KEV_TO_J));
}

/**
 * Power flows of a uniform plasma per unit volume (W m^-3) at a given state.
 * External heating is whatever is needed to hold the state steady.
 */
export function powerBalance(t, density, tau, comp = PURE_DT) {
  const n2 = density * density;
  const fusion = fusionCoefficient(t, comp) * n2;
  const alpha = ALPHA_FRACTION * fusion;
  const radiation = bremsCoefficient(t, comp) * n2;
  const transport = (1.5 * (1.0 + comp.ionFraction) * density * t * KEV_TO_J) / tau;
  const external = Math.max(0.0, transport + radiation - alpha);
  return { fusion, alpha, neutron: fusion - alpha, radiation, transport, external };
}

// --- Tokamak model -------------------------------------------------------------------------

const IPB98 = { c: 0.0562, i: 0.93, b: 0.15, n: 0.41, p: -0.69, r: 1.97, k: 0.78, e: 0.58, m: 0.19 };
const MARTIN = { c: 0.0488, n: 0.717, b: 0.803, s: 0.941 };

function gaussLegendre(n) {
  const nodes = new Array(n);
  const weights = new Array(n);
  const m = Math.floor((n + 1) / 2);
  for (let i = 0; i < m; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let derivative = 1.0;
    for (let iteration = 0; iteration < 100; iteration++) {
      let p0 = 1.0;
      let p1 = x;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      derivative = (n * (x * p1 - p0)) / (x * x - 1.0);
      const dx = p1 / derivative;
      x -= dx;
      if (Math.abs(dx) < 1e-16) break;
    }
    nodes[i] = -x;
    nodes[n - 1 - i] = x;
    const w = 2.0 / ((1.0 - x * x) * derivative * derivative);
    weights[i] = w;
    weights[n - 1 - i] = w;
  }
  return { nodes, weights };
}

const QUADRATURE_POINTS = 48;
const GL = gaussLegendre(QUADRATURE_POINTS);
const U_NODES = GL.nodes.map((x) => 0.5 * (x + 1.0));
const U_WEIGHTS = GL.weights.map((w) => 0.5 * w);

const SCAN_POINTS = 90;
const T0_SCAN = Array.from({ length: SCAN_POINTS }, (_, i) =>
  i === SCAN_POINTS - 1 ? T_MAX : 0.5 * Math.pow(T_MAX / 0.5, i / (SCAN_POINTS - 1)),
);

// Lanczos approximation of the gamma function.
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
function gamma(x) {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1.0 - x));
  x -= 1.0;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return Math.sqrt(2.0 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

/** Line-averaged over central value for the profile (1 - rho^2)^(peaking - 1). */
export function lineAverageFactor(peaking) {
  const alpha = peaking - 1.0;
  return (0.5 * Math.sqrt(Math.PI) * gamma(alpha + 1.0)) / gamma(alpha + 1.5);
}

/** Derived geometry and limits of a machine {R, a, kappa, delta, B, I}. */
export function machineProperties(machine) {
  const { R, a, kappa, delta, B, I } = machine;
  const eps = a / R;
  const volume = 2.0 * Math.PI * R ** 3 * eps ** 2 * kappa * (Math.PI - (Math.PI - 8.0 / 3.0) * eps);
  const surface = 2.0 * Math.PI * R ** 2 * eps * kappa * (Math.PI + 2.0 - (Math.PI - 2.0) * eps);
  const shaping = (1.0 + kappa ** 2 * (1.0 + 2.0 * delta ** 2 - 1.2 * delta ** 3)) / 2.0;
  const qCylindrical = ((5.0 * a ** 2 * B) / (R * I)) * shaping;
  const q95 = (qCylindrical * (1.17 - 0.65 * eps)) / (1.0 - eps ** 2) ** 2;
  return { eps, volume, surface, greenwald: (1.0e20 * I) / (Math.PI * a ** 2), shaping, qCylindrical, q95 };
}

/** Plasma current (MA) that gives the requested q95 for the machine's shape and field. */
export function currentForQ95(machine, q95) {
  return (machine.I * machineProperties(machine).q95) / q95;
}

/** IPB98(y,2) confinement time in s; lineDensity in m^-3, lossPower in MW. */
export function confinementTime(machine, lineDensity, lossPower, fuelMass, hFactor = 1.0) {
  const c = IPB98;
  return (
    hFactor * c.c * machine.I ** c.i * machine.B ** c.b * (lineDensity / 1.0e19) ** c.n * lossPower ** c.p *
    machine.R ** c.r * machine.kappa ** c.k * (machine.a / machine.R) ** c.e * fuelMass ** c.m
  );
}

/** H-mode power threshold in MW (Martin 2008, with the 2/M isotope correction). */
export function lhThreshold(machine, lineDensity, fuelMass, surface) {
  const c = MARTIN;
  return (c.c * (lineDensity / 1.0e20) ** c.n * machine.B ** c.b * surface ** c.s * 2.0) / fuelMass;
}

function powers(volume, scenario, comp, t0) {
  const aN = scenario.densityPeaking - 1.0;
  const aT = scenario.temperaturePeaking - 1.0;
  const n0 = scenario.density * scenario.densityPeaking;
  let rate = 0.0;
  for (let j = 0; j < QUADRATURE_POINTS; j++) {
    const shape = 1.0 - U_NODES[j];
    const n = n0 * Math.pow(shape, aN);
    rate += U_WEIGHTS[j] * n * n * reactivity(t0 * Math.pow(shape, aT));
  }
  const fusion = (comp.reactantProduct * rate * E_FUSION_KEV * KEV_TO_J * volume) / 1.0e6;
  const brems = (C_BREMS * comp.zEff * n0 * n0 * Math.sqrt(t0) * volume) / (1.0 + 2.0 * aN + 0.5 * aT) / 1.0e6;
  const stored = (1.5 * (1.0 + comp.ionFraction) * n0 * t0 * KEV_TO_J * volume) / (1.0 + aN + aT) / 1.0e6;
  return { fusion, radiated: scenario.radiationFactor * brems, stored };
}

// Energy balance at central temperature t0: a negative value means the plasma
// heats up. `loss` is the transport power; where it is not positive, radiation
// exceeds all heating and the plasma cools by radiation alone.
function residual(machine, props, scenario, comp, lineDensity, t0, heating) {
  const p = powers(props.volume, scenario, comp, t0);
  const loss = heating + ALPHA_FRACTION * p.fusion - p.radiated;
  if (!(loss > 0.0)) return { value: p.stored + 1.0, loss };
  return { value: p.stored - confinementTime(machine, lineDensity, loss, comp.fuelMass, scenario.hFactor) * loss, loss };
}

// Follows the plasma up in temperature and stops at the first stable balance
// between heating and transport. A balance in which core radiation carries more
// power than transport is a radiation barrier, not a confined steady state: it
// is skipped and reported, and the search continues above it.
function operatingTemperature(machine, props, scenario, comp, lineDensity, heating) {
  let previous = residual(machine, props, scenario, comp, lineDensity, T0_SCAN[0], heating);
  let barrier = false;
  for (let i = 1; i < SCAN_POINTS; i++) {
    const current = residual(machine, props, scenario, comp, lineDensity, T0_SCAN[i], heating);
    if (previous.value < 0.0 && current.value >= 0.0) {
      if (!(current.loss > 0.0)) {
        barrier = true;
      } else {
        let low = T0_SCAN[i - 1];
        let high = T0_SCAN[i];
        for (let k = 0; k < 50; k++) {
          const mid = 0.5 * (low + high);
          if (residual(machine, props, scenario, comp, lineDensity, mid, heating).value >= 0.0) high = mid;
          else low = mid;
        }
        const t = 0.5 * (low + high);
        const p = powers(props.volume, scenario, comp, t);
        if (p.radiated >= heating + ALPHA_FRACTION * p.fusion - p.radiated) barrier = true;
        else return { t0: t, status: "steady", barrier };
      }
    }
    previous = current;
  }
  return { t0: null, status: previous.value < 0.0 ? "runaway" : "no_solution", barrier };
}

/**
 * Steady operating point of a tokamak.
 * @param machine {R, a, kappa, delta, B, I}  metres, tesla, megaamperes
 * @param scenario {density, heating, hFactor, densityPeaking, temperaturePeaking, radiationFactor, composition}
 * @param options {ignitionCheck: false} skips the search for a self-sustaining state (faster)
 */
export function solveReactor(machine, scenario, options = {}) {
  const comp = scenario.composition;
  const props = machineProperties(machine);
  const n0 = scenario.density * scenario.densityPeaking;
  const lineDensity = n0 * lineAverageFactor(scenario.densityPeaking);
  const found = operatingTemperature(machine, props, scenario, comp, lineDensity, scenario.heating);
  const threshold = lhThreshold(machine, lineDensity, comp.fuelMass, props.surface);
  const unheated = options.ignitionCheck === false
    ? "skipped"
    : operatingTemperature(machine, props, scenario, comp, lineDensity, 0.0).status;
  const base = {
    status: found.status,
    centralDensity: n0,
    lineDensity,
    greenwaldFraction: lineDensity / props.greenwald,
    q95: props.q95,
    qCylindrical: props.qCylindrical,
    lhThreshold: threshold,
    volume: props.volume,
    surface: props.surface,
    ignitionPossible: unheated === "steady" || unheated === "runaway",
    radiationBarrier: found.barrier,
  };
  if (found.status === "no_solution") {
    return {
      ...base, centralTemperature: NaN, averageTemperature: NaN, fusionPower: 0, alphaPower: 0, radiatedPower: 0,
      lossPower: 0, gain: 0, confinementTime: NaN, storedEnergy: 0, betaPercent: 0, betaNormalised: 0, lhMargin: 0,
      neutronWallLoad: 0, tripleProduct: 0, lawsonParameter: 0,
    };
  }
  const t0 = found.t0 === null ? T_MAX : found.t0;
  const p = powers(props.volume, scenario, comp, t0);
  const alpha = ALPHA_FRACTION * p.fusion;
  const loss = scenario.heating + alpha - p.radiated;
  const tau = loss > 0.0 ? p.stored / loss : NaN;
  const pressure = (p.stored * 1.0e6) / (1.5 * props.volume);
  const betaPercent = (100.0 * 2.0 * MU_0 * pressure) / (machine.B * machine.B);
  return {
    ...base,
    centralTemperature: t0,
    averageTemperature: t0 / scenario.temperaturePeaking,
    fusionPower: p.fusion,
    alphaPower: alpha,
    radiatedPower: p.radiated,
    lossPower: loss,
    gain: scenario.heating > 0.0 ? p.fusion / scenario.heating : Infinity,
    confinementTime: tau,
    storedEnergy: p.stored,
    betaPercent,
    betaNormalised: (betaPercent * machine.a * machine.B) / machine.I,
    lhMargin: loss / threshold,
    neutronWallLoad: ((1.0 - ALPHA_FRACTION) * p.fusion) / props.surface,
    tripleProduct: n0 * t0 * tau,
    lawsonParameter: n0 * tau,
  };
}
