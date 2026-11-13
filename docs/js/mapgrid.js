// The design-space map: fusion gain over a grid of major radius and field.
// Used by the background worker, and directly on the page if workers are
// unavailable. The grid is computed in two passes so a coarse map can be shown
// quickly: every second point first, then the rest.

import * as P from "./physics.js";

/**
 * @param params { nx, ny (odd), R: [min, max], B: [min, max], aspect, kappa, delta, q95,
 *                 scenario: { greenwaldFraction, heating, hFactor, densityPeaking,
 *                             temperaturePeaking, radiationFactor, tritiumFraction, impurities } }
 * @param onCoarse optional callback receiving the coarse grid first
 * @returns { nx, ny, values, betas }  values: gain (0 = no burn, 1000 = ignited)
 */
export function computeMapGrid(params, onCoarse) {
  const { nx, ny, R, B, aspect, kappa, delta, q95, scenario } = params;
  const composition = P.composition(scenario.tritiumFraction, scenario.impurities);
  const lineFactor = scenario.densityPeaking * P.lineAverageFactor(scenario.densityPeaking);
  const values = new Float64Array(nx * ny);
  const betas = new Float64Array(nx * ny);

  const solveCell = (i, j) => {
    const radius = R[0] + ((R[1] - R[0]) * i) / (nx - 1);
    const field = B[0] + ((B[1] - B[0]) * j) / (ny - 1);
    const machine = { R: radius, a: radius / aspect, kappa, delta, B: field, I: 1 };
    machine.I = P.currentForQ95(machine, q95);
    const density = (scenario.greenwaldFraction * P.machineProperties(machine).greenwald) / lineFactor;
    const result = P.solveReactor(machine, { ...scenario, density, composition }, { ignitionCheck: false });
    values[j * nx + i] = result.status === "no_solution" ? 0
      : result.status === "runaway" || !Number.isFinite(result.gain) ? 1e3 : result.gain;
    betas[j * nx + i] = result.betaNormalised || 0;
  };

  for (let j = 0; j < ny; j += 2) for (let i = 0; i < nx; i += 2) solveCell(i, j);
  if (onCoarse) {
    const cx = (nx + 1) / 2;
    const cy = (ny + 1) / 2;
    const coarseValues = new Float64Array(cx * cy);
    const coarseBetas = new Float64Array(cx * cy);
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        coarseValues[j * cx + i] = values[2 * j * nx + 2 * i];
        coarseBetas[j * cx + i] = betas[2 * j * nx + 2 * i];
      }
    }
    onCoarse({ nx: cx, ny: cy, values: coarseValues, betas: coarseBetas });
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) if (j % 2 || i % 2) solveCell(i, j);
  }
  return { nx, ny, values, betas };
}
