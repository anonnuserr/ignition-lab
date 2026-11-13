// Small interface helpers shared by the explorer and the designer.

const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

/** "10" raised to an integer power, in plain Unicode (for SVG text). */
export function powerOfTen(exponent) {
  return "10" + String(exponent).split("").map((c) => SUPERSCRIPT[c]).join("");
}

function split(value, digits) {
  let exponent = Math.floor(Math.log10(Math.abs(value)));
  let mantissa = value / 10 ** exponent;
  if (Number(mantissa.toFixed(digits)) >= 10) {
    mantissa /= 10;
    exponent += 1;
  }
  return [mantissa.toFixed(digits), exponent];
}

/** Scientific notation as HTML, e.g. 2.95 x 10^21. */
export function sci(value, digits = 2) {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "–";
  if (value === 0) return "0";
  const [m, e] = split(value, digits);
  return `${m} × 10<sup>${e}</sup>`;
}

/** Scientific notation as plain text. */
export function sciText(value, digits = 2) {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "–";
  if (value === 0) return "0";
  const [m, e] = split(value, digits);
  return `${m} × ${powerOfTen(e)}`;
}

/** A number with a sensible count of significant figures. */
export function num(value, significant = 3) {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "–";
  if (value === 0) return "0";
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.max(0, significant - 1 - magnitude);
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Fuel gain for display. */
export function gainText(q) {
  if (!Number.isFinite(q)) return "∞";
  if (q === 0) return "0";
  if (q < 0.001) return "< 0.001";
  if (q >= 100) return Math.round(q).toLocaleString("en-US");
  return num(q, q < 0.1 ? 2 : 3);
}

/**
 * A labelled slider.
 * spec: { label, min, max, step, log, value, format(value) -> html, hint, onInput(value) }
 * Returns { set(value, silent), get(), element }.
 */
export function createSlider(container, spec) {
  const id = "ctl-" + Math.random().toString(36).slice(2, 9);
  const wrap = document.createElement("div");
  wrap.className = "ctl";
  wrap.innerHTML =
    `<div class="ctl-head"><label for="${id}">${spec.label}</label><output for="${id}"></output></div>` +
    `<input type="range" id="${id}">` + (spec.hint ? `<p class="ctl-hint">${spec.hint}</p>` : "");
  const input = wrap.querySelector("input");
  const output = wrap.querySelector("output");
  const hint = wrap.querySelector(".ctl-hint");
  const STEPS = 1000;
  let minimum = spec.min;
  let maximum = spec.max;

  const toPosition = (v) => (spec.log ? Math.log(v / minimum) / Math.log(maximum / minimum) : (v - minimum) / (maximum - minimum));
  const fromPosition = (p) => {
    const raw = spec.log ? minimum * Math.pow(maximum / minimum, p) : minimum + p * (maximum - minimum);
    return spec.step && !spec.log ? Math.round(raw / spec.step) * spec.step : raw;
  };
  input.min = 0;
  input.max = STEPS;
  input.step = 1;

  let current = spec.value;
  function paint() {
    const p = Math.min(1, Math.max(0, toPosition(current)));
    input.value = Math.round(p * STEPS);
    input.style.setProperty("--fill", `${(p * 100).toFixed(2)}%`);
    output.innerHTML = spec.format(current);
    input.setAttribute("aria-valuetext", output.textContent);
  }
  input.addEventListener("input", () => {
    current = fromPosition(input.value / STEPS);
    paint();
    spec.onInput(current);
  });
  paint();
  container.appendChild(wrap);
  return {
    element: wrap,
    get: () => current,
    set(value, silent = true) {
      current = Math.min(maximum, Math.max(minimum, value));
      paint();
      if (!silent) spec.onInput(current);
    },
    setRange(min, max) {
      minimum = min;
      maximum = max;
      current = Math.min(maximum, Math.max(minimum, current));
      paint();
    },
    setHint(html) {
      if (hint) hint.innerHTML = html;
    },
  };
}

/** A labelled dropdown. options: [[value, label], ...] */
export function createSelect(container, spec) {
  const id = "ctl-" + Math.random().toString(36).slice(2, 9);
  const wrap = document.createElement("div");
  wrap.className = "ctl";
  wrap.innerHTML = `<div class="ctl-head"><label for="${id}">${spec.label}</label></div><select id="${id}"></select>`;
  const select = wrap.querySelector("select");
  for (const [value, label] of spec.options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = spec.value;
  select.addEventListener("change", () => spec.onInput(Number(select.value)));
  container.appendChild(wrap);
  return { element: wrap, get: () => Number(select.value), set: (v) => { select.value = v; } };
}

const tooltip = () => document.getElementById("tooltip");

export function showTooltip(html, clientX, clientY) {
  const el = tooltip();
  el.innerHTML = html;
  el.hidden = false;
  const box = el.getBoundingClientRect();
  let x = clientX + 16;
  let y = clientY + 16;
  if (x + box.width > window.innerWidth - 8) x = clientX - box.width - 16;
  if (y + box.height > window.innerHeight - 8) y = clientY - box.height - 16;
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
}

export function hideTooltip() {
  tooltip().hidden = true;
}

/** Run `fn` at most once per animation frame. */
export function perFrame(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

/** Run `fn` once input has been quiet for `ms`. */
export function debounce(fn, ms) {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

/** Labels for the plasma state implied by a fuel gain. */
export function gainState(q) {
  if (!Number.isFinite(q)) return { key: "ignited", label: "Ignited", note: "Fusion alone keeps the plasma hot. No external heating is needed." };
  if (q >= 5) return { key: "burning", label: "Burning plasma", note: "Fusion's own alpha particles now supply most of the heating." };
  if (q >= 1) return { key: "gain", label: "Net fuel gain", note: "More fusion power comes out than heating power goes in." };
  return { key: "cold", label: "Below breakeven", note: "Less fusion power comes out than heating power goes in." };
}
