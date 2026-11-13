// Background worker for the design-space map, so the page never waits for the
// roughly 1,400 reactor solutions behind each map.

import { computeMapGrid } from "./mapgrid.js";

self.onmessage = (event) => {
  const { id, params } = event.data;
  const send = (stage, grid) =>
    self.postMessage({ id, stage, ...grid }, [grid.values.buffer, grid.betas.buffer]);
  const full = computeMapGrid(params, (coarse) => send("coarse", coarse));
  send("final", full);
};
