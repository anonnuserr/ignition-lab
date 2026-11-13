// The Lawson chart: triple product against temperature, with the calculated
// thresholds, every experiment in the data set, and the user's own plasma.

import * as d3 from "d3";
import * as P from "./physics.js";
import { hideTooltip, powerOfTen, sciText, showTooltip } from "./ui.js";

export const CATEGORY_STYLE = {
  "Tokamak": { symbol: d3.symbolCircle, color: "#3987e5", size: 62 },
  "Spherical tokamak": { symbol: d3.symbolTriangle, color: "#199e70", size: 62 },
  "Stellarator": { symbol: d3.symbolSquare, color: "#d95926", size: 54 },
  "Other magnetic concepts": { symbol: d3.symbolDiamond, color: "#8f8d86", size: 30 },
  "Laser inertial fusion": { symbol: d3.symbolStar, color: "#f0efec", size: 70 },
};

const RANGES = {
  near: { x: [1, 100], y: [1e19, 1e23] },
  all: { x: [0.008, 100], y: [3e12, 1e23] },
};

// Ordered one-hue ramp: brighter means a more demanding threshold.
const CURVES = [
  { q: 1, label: "Q = 1", color: "#2a78d6" },
  { q: 10, label: "Q = 10", color: "#6da7ec" },
  { q: Infinity, label: "Ignition", color: "#cde2fb" },
];
const LASER_COLOR = "#f0efec";

// [project, shot] -> [label, dx, dy, anchor], shown in the "near" range.
const NEAR_LABELS = [
  ["ITER", "Projected", "ITER (projected)", 12, -12, "start"],
  ["SPARC", "Projected", "SPARC (projected)", 12, 16, "start"],
  ["JET", "26087", "JET 1991", -4, -16, "end"],
  ["TFTR", "83546", "TFTR 1995", 6, -14, "start"],
  ["JT-60U", "E31872", "JT-60U 1998", -12, 16, "end"],
  ["NIF", "N210808", "NIF 2021 (ignited)", 10, -12, "start"],
  ["W7-X", "W7X 20171207.006", "W7-X 2017", 0, 20, "middle"],
];
const ALL_LABELS = [
  ["ZETA", "140 kA - 180 kA discharges", "ZETA 1957", -10, 4, "end"],
  ["T-3", "Hz = 25 kOe, Iz = 85 kA discharges", "T-3 1969", -10, 14, "end"],
  ["LHD", "High triple product", "LHD 2008", -10, -6, "end"],
  ["ITER", "Projected", "ITER (projected)", -12, -10, "end"],
  ["NIF", "N210808", "NIF 2021", -4, -14, "end"],
];

export class LawsonChart {
  constructor(container, experiments) {
    this.container = container;
    this.experiments = experiments;
    this.range = "near";
    this.domain = { x: [...RANGES.near.x], y: [...RANGES.near.y] };
    this.showLaser = true;
    this.composition = P.PURE_DT;
    this.user = { T: 15, triple: 1e21 };
    this.reactor = null;
    this.onDrag = () => {};
    this.margin = { top: 18, right: 96, bottom: 48, left: 64 };

    this.svg = d3.select(container).append("svg").attr("role", "img")
      .attr("aria-label", "Triple product against ion temperature for fusion experiments, with calculated thresholds");
    const defs = this.svg.append("defs");
    this.clipId = "clip-" + Math.random().toString(36).slice(2, 8);
    this.clipRect = defs.append("clipPath").attr("id", this.clipId).append("rect");
    const glow = defs.append("radialGradient").attr("id", "userGlow");
    glow.append("stop").attr("offset", "0%").attr("stop-color", "#ffe9a8").attr("stop-opacity", 0.95);
    glow.append("stop").attr("offset", "35%").attr("stop-color", "#ff9d4d").attr("stop-opacity", 0.55);
    glow.append("stop").attr("offset", "70%").attr("stop-color", "#ff4fa3").attr("stop-opacity", 0.22);
    glow.append("stop").attr("offset", "100%").attr("stop-color", "#7b5cff").attr("stop-opacity", 0);

    this.gGrid = this.svg.append("g");
    this.gAxes = this.svg.append("g");
    this.gCurves = this.svg.append("g").attr("clip-path", `url(#${this.clipId})`);
    this.gPoints = this.svg.append("g").attr("clip-path", `url(#${this.clipId})`);
    this.gLabels = this.svg.append("g");
    this.gCurveLabels = this.svg.append("g");
    this.gReactor = this.svg.append("g").style("pointer-events", "none");
    this.gUser = this.svg.append("g").attr("class", "user-dot").attr("tabindex", 0)
      .attr("role", "slider").attr("aria-valuemin", P.T_MIN).attr("aria-valuemax", P.T_MAX)
      .attr("aria-label", "Your plasma. Drag, or use the arrow keys: left and right change temperature, up and down change the triple product.");
    this.gUser.append("circle").attr("r", 26).attr("fill", "url(#userGlow)");
    this.gUser.append("circle").attr("r", 7).attr("fill", "#fff").attr("stroke", "#07090d").attr("stroke-width", 2);
    this.userLabel = this.gUser.append("text").attr("y", -18).attr("text-anchor", "middle")
      .attr("class", "curve-label").style("font-weight", 600).text("Your plasma");

    // Keyboard: left/right change temperature, up/down change the triple product.
    this.gUser.on("keydown", (event) => {
      const steps = { ArrowLeft: [1 / 1.08, 1], ArrowRight: [1.08, 1], ArrowDown: [1, 1 / 1.2], ArrowUp: [1, 1.2] };
      const step = steps[event.key];
      if (!step) return;
      event.preventDefault();
      const big = event.shiftKey ? 3 : 1;
      const T = Math.min(P.T_MAX, Math.max(P.T_MIN, this.user.T * step[0] ** big));
      const triple = Math.min(this.domain.y[1], Math.max(this.domain.y[0], this.user.triple * step[1] ** big));
      this.onDrag(T, triple);
    });

    this.gUser.call(
      d3.drag().on("drag", (event) => {
        const [px, py] = d3.pointer(event, this.svg.node());
        const T = Math.min(P.T_MAX, Math.max(P.T_MIN, this.x.invert(px)));
        const triple = Math.min(this.domain.y[1], Math.max(this.domain.y[0], this.y.invert(py)));
        this.onDrag(T, triple);
      }),
    );

    this.svg.on("pointermove", (event) => this.hover(event)).on("pointerleave", () => hideTooltip());
    new ResizeObserver(() => this.render()).observe(container);
    this.render();
  }

  setRange(name) {
    if (name === this.range) return;
    this.range = name;
    const from = { x: this.domain.x.map(Math.log), y: this.domain.y.map(Math.log) };
    const to = { x: RANGES[name].x.map(Math.log), y: RANGES[name].y.map(Math.log) };
    const ease = d3.easeCubicInOut;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced ? 1 : 550;
    this.timer?.stop();
    this.timer = d3.timer((elapsed) => {
      const k = ease(Math.min(1, elapsed / duration));
      for (const axis of ["x", "y"]) {
        this.domain[axis] = [0, 1].map((i) => Math.exp(from[axis][i] + (to[axis][i] - from[axis][i]) * k));
      }
      this.render();
      if (elapsed >= duration) this.timer.stop();
    });
  }

  setLaser(show) { this.showLaser = show; this.render(); }
  setComposition(comp) { this.composition = comp; }
  setUser(user) { this.user = user; }
  setReactor(reactor) { this.reactor = reactor; }

  visiblePoints() {
    return this.experiments.filter((e) => this.showLaser || e.category !== "Laser inertial fusion");
  }

  curvePath(fn) {
    const lo = Math.max(P.T_MIN, this.domain.x[0]);
    const hi = Math.min(P.T_MAX, this.domain.x[1]);
    const n = 260;
    const points = [];
    for (let i = 0; i < n; i++) {
      const t = lo * Math.pow(hi / lo, i / (n - 1));
      const v = fn(t);
      if (Number.isFinite(v) && v < this.domain.y[1] * 50) points.push([t, Math.max(v, this.domain.y[0] / 50)]);
    }
    return points;
  }

  render() {
    const width = Math.max(320, this.container.clientWidth);
    const height = Math.round(Math.min(620, Math.max(380, width * 0.6)));
    const m = this.margin;
    // Named points need room; on a phone-width chart the legend and tooltips carry identity instead.
    const roomy = width >= 600;
    this.svg.attr("viewBox", `0 0 ${width} ${height}`);
    this.x = d3.scaleLog().domain(this.domain.x).range([m.left, width - m.right]);
    this.y = d3.scaleLog().domain(this.domain.y).range([height - m.bottom, m.top]);
    const { x, y } = this;
    this.clipRect.attr("x", m.left).attr("y", m.top).attr("width", width - m.left - m.right).attr("height", height - m.top - m.bottom);

    // Grid and axes (decades only).
    const decades = (domain) => {
      const out = [];
      for (let e = Math.ceil(Math.log10(domain[0]) - 1e-9); e <= Math.floor(Math.log10(domain[1]) + 1e-9); e++) out.push(e);
      return out;
    };
    const xTicks = decades(this.domain.x);
    let yTicks = decades(this.domain.y);
    if (yTicks.length > 7) yTicks = yTicks.filter((e) => e % 2 === 1);
    const extraX = this.range === "near" && this.domain.x[0] >= 0.9 ? [2, 5, 20, 50] : [];

    this.gGrid.selectAll("line.gx").data(xTicks).join("line").attr("class", "gridline gx")
      .attr("x1", (e) => x(10 ** e)).attr("x2", (e) => x(10 ** e)).attr("y1", m.top).attr("y2", height - m.bottom);
    this.gGrid.selectAll("line.gy").data(yTicks).join("line").attr("class", "gridline gy")
      .attr("y1", (e) => y(10 ** e)).attr("y2", (e) => y(10 ** e)).attr("x1", m.left).attr("x2", width - m.right);

    const xLabels = [...xTicks.map((e) => 10 ** e), ...extraX].filter((v) => v >= this.domain.x[0] * 0.999 && v <= this.domain.x[1] * 1.001);
    this.gAxes.selectAll("text.tx").data(xLabels, (d) => d).join("text").attr("class", "tick-label tx")
      .attr("x", (d) => x(d)).attr("y", height - m.bottom + 18).attr("text-anchor", "middle")
      .text((d) => (d >= 1 ? String(d) : String(Number(d.toPrecision(1)))));
    this.gAxes.selectAll("text.ty").data(yTicks, (d) => d).join("text").attr("class", "tick-label ty")
      .attr("x", m.left - 10).attr("y", (e) => y(10 ** e) + 4).attr("text-anchor", "end").text((e) => powerOfTen(e));
    this.gAxes.selectAll("line.axis-line").data([0]).join("line").attr("class", "axis-line")
      .attr("x1", m.left).attr("x2", width - m.right).attr("y1", height - m.bottom).attr("y2", height - m.bottom);
    this.gAxes.selectAll("text.xt").data([0]).join("text").attr("class", "axis-title xt")
      .attr("x", (m.left + width - m.right) / 2).attr("y", height - 8).attr("text-anchor", "middle").text("Ion temperature (keV)");
    this.gAxes.selectAll("text.yt").data([0]).join("text").attr("class", "axis-title yt")
      .attr("transform", `translate(14 ${(m.top + height - m.bottom) / 2}) rotate(-90)`).attr("text-anchor", "middle")
      .text("Triple product  n·T·τ  (keV m⁻³ s)");

    // Threshold curves.
    const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1]));
    const comp = this.composition;
    const impure = comp.zEff > 1.0001 || Math.abs(comp.tritiumFraction - 0.5) > 1e-6;
    const curves = CURVES.map((c) => ({ ...c, dash: null, width: 2, points: this.curvePath((t) => P.tripleProduct(t, c.q, comp)) }));
    if (impure) {
      curves.push({ q: "pure", label: "", color: "#8f8d86", dash: "2 5", width: 1.4,
        points: this.curvePath((t) => P.tripleProduct(t, Infinity, P.PURE_DT)) });
    }
    if (this.showLaser) {
      curves.push({ q: "laser", label: roomy ? "Laser ignition" : "Laser", color: LASER_COLOR, dash: "7 6", width: 1.6,
        points: this.curvePath((t) => t * P.laserIgnitionLawson(t)) });
    }
    this.gCurves.selectAll("path.curve").data(curves, (d) => String(d.q)).join("path").attr("class", "curve")
      .attr("stroke", (d) => d.color).attr("stroke-dasharray", (d) => d.dash).attr("stroke-width", (d) => d.width)
      .attr("opacity", (d) => (d.q === "laser" ? 0.75 : 1)).attr("d", (d) => line(d.points));

    // Direct labels at the right-hand end of each curve, nudged apart.
    const ends = curves.filter((c) => c.label && c.points.length).map((c) => {
      const last = c.points[c.points.length - 1];
      return { label: c.label, py: Math.min(height - m.bottom - 4, Math.max(m.top + 8, y(last[1]))) };
    }).sort((a, b) => a.py - b.py);
    for (let i = 1; i < ends.length; i++) if (ends[i].py - ends[i - 1].py < 15) ends[i].py = ends[i - 1].py + 15;
    this.gCurveLabels.selectAll("text").data(ends, (d) => d.label).join("text").attr("class", "curve-label")
      .attr("x", width - m.right + 8).attr("y", (d) => d.py + 4).text((d) => d.label);

    // Experiments.
    const points = this.visiblePoints();
    const symbol = d3.symbol();
    this.gPoints.selectAll("path.pt").data(points, (d) => d.project + d.shot).join("path").attr("class", "pt")
      .attr("d", (d) => symbol.type(CATEGORY_STYLE[d.category].symbol).size(CATEGORY_STYLE[d.category].size * (d.projected ? 1.5 : 1))())
      .attr("fill", (d) => (d.projected ? "#07090d" : CATEGORY_STYLE[d.category].color))
      .attr("stroke", (d) => (d.projected ? CATEGORY_STYLE[d.category].color : "#07090d"))
      .attr("stroke-width", (d) => (d.projected ? 2 : 1.4))
      .attr("transform", (d) => `translate(${x(d.T)} ${y(d.triple)})`);

    // A few named points.
    const settled = !this.timer || Math.abs(Math.log(this.domain.x[0] / RANGES[this.range].x[0])) < 1e-6;
    const wanted = settled && roomy ? (this.range === "near" ? NEAR_LABELS : ALL_LABELS) : [];
    const labelled = wanted.map(([project, shot, text, dx, dy, anchor]) => {
      const e = points.find((p) => p.project === project && p.shot === shot);
      return e ? { key: project + shot, text, dx, dy, anchor, px: x(e.T), py: y(e.triple) } : null;
    }).filter((d) => d && d.px >= m.left && d.px <= width - m.right && d.py >= m.top && d.py <= height - m.bottom);
    this.gLabels.selectAll("line.leader").data(labelled, (d) => d.key).join("line").attr("class", "leader")
      .attr("x1", (d) => d.px + Math.sign(d.dx) * 5).attr("y1", (d) => d.py + Math.sign(d.dy) * 5)
      .attr("x2", (d) => d.px + d.dx * 0.8).attr("y2", (d) => d.py + d.dy * 0.7);
    this.gLabels.selectAll("text.point-label").data(labelled, (d) => d.key).join("text").attr("class", "point-label")
      .attr("x", (d) => d.px + d.dx).attr("y", (d) => d.py + d.dy + 4).attr("text-anchor", (d) => d.anchor).text((d) => d.text);

    this.size = { width, height, roomy };
    this.renderMarkers();
  }

  /** Move only the user's plasma and the designer's reactor (cheap; used while dragging). */
  renderMarkers() {
    if (!this.size) return;
    const { width, height, roomy } = this.size;
    const m = this.margin;
    const { x, y } = this;
    const inside = (T, v) => T >= this.domain.x[0] && T <= this.domain.x[1] && v >= this.domain.y[0] && v <= this.domain.y[1];
    // The designer's operating point.
    const reactor = this.reactor && this.reactor.triple > 0 ? [this.reactor] : [];
    const rg = this.gReactor.selectAll("g").data(reactor.filter((r) => inside(r.T, r.triple))).join((enter) => {
      const g = enter.append("g");
      g.append("path").attr("d", d3.symbol().type(d3.symbolDiamond).size(190)()).attr("fill", "none")
        .attr("stroke", "#ff9d4d").attr("stroke-width", 2.2);
      g.append("text").attr("class", "curve-label").attr("x", -14).attr("y", 4).attr("text-anchor", "end")
        .style("fill", "#ffb86b").text("Your reactor");
      return g;
    });
    rg.attr("transform", (d) => `translate(${x(d.T)} ${y(d.triple)})`);
    rg.select("text").attr("display", roomy ? null : "none");

    // The user's plasma, clamped to the plot so it can always be grabbed.
    const ux = Math.min(width - m.right, Math.max(m.left, x(this.user.T)));
    const uy = Math.min(height - m.bottom, Math.max(m.top, y(this.user.triple)));
    this.gUser.attr("transform", `translate(${ux} ${uy})`)
      .attr("aria-valuenow", this.user.T.toFixed(2))
      .attr("aria-valuetext", `${this.user.T.toPrecision(3)} keV, triple product ${sciText(this.user.triple, 2)} keV per cubic metre seconds`);
    const off = !inside(this.user.T, this.user.triple);
    this.userLabel.text(off ? "Your plasma (off chart)" : "Your plasma").attr("y", uy - m.top < 40 ? 30 : -18);
  }

  hover(event) {
    if (!this.x) return;
    const [px, py] = d3.pointer(event, this.svg.node());
    const scale = this.svg.node().getBoundingClientRect().width / this.svg.node().viewBox.baseVal.width;
    let best = null;
    let bestDistance = 18 / scale;
    for (const e of this.visiblePoints()) {
      const d = Math.hypot(this.x(e.T) - px, this.y(e.triple) - py);
      if (d < bestDistance) {
        bestDistance = d;
        best = e;
      }
    }
    if (!best) return hideTooltip();
    const status = best.projected ? "Design projection" : best.concept;
    showTooltip(
      `<strong>${best.project}${best.projected ? "" : " · " + best.date.slice(0, 4)}</strong>${status}` +
        `${best.projected ? "" : "<br>Shot: " + best.shot}` +
        `<br>Temperature <span class="mono">${best.T} keV</span>` +
        `<br>Triple product <span class="mono">${sciText(best.triple, 1)}</span> keV m⁻³ s`,
      event.clientX, event.clientY,
    );
  }
}

/** Legend entries for the chart, as HTML. */
export function legendHTML() {
  const symbol = d3.symbol();
  const items = Object.entries(CATEGORY_STYLE).map(([name, style]) =>
    `<span><svg width="14" height="14" viewBox="-8 -8 16 16"><path d="${symbol.type(style.symbol).size(style.size)()}" fill="${style.color}"/></svg>${name}</span>`);
  items.push(`<span><svg width="14" height="14" viewBox="-8 -8 16 16"><circle r="5" fill="#07090d" stroke="#3987e5" stroke-width="2"/></svg>Design projection</span>`);
  items.push(`<span><svg width="14" height="14" viewBox="-8 -8 16 16"><path d="M0,-6L6,0L0,6L-6,0Z" fill="none" stroke="#ff9d4d" stroke-width="1.8"/></svg>Your reactor (from the designer)</span>`);
  items.push(`<span><svg width="22" height="14" viewBox="0 0 22 14"><line x1="1" x2="21" y1="7" y2="7" stroke="#cde2fb" stroke-width="2"/></svg>Magnetic confinement thresholds</span>`);
  items.push(`<span><svg width="22" height="14" viewBox="0 0 22 14"><line x1="1" x2="21" y1="7" y2="7" stroke="#f0efec" stroke-width="1.6" stroke-dasharray="5 4"/></svg>Laser hot-spot ignition</span>`);
  return items.join("");
}
