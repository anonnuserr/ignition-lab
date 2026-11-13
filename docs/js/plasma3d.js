// A three-dimensional view of the plasma, built from the design's real
// proportions: major radius, minor radius, elongation and triangularity.
// Nested glowing shells are coloured by the temperature profile the model
// predicts, a slice is cut away to show the cross-section, and a 1.8 m figure
// stands beside the machine for scale.
//
// Performance: every mesh is created once. When the design changes, vertex
// positions, normals and colours are rewritten in place (no new geometry,
// materials or shaders), so slider changes cost well under a millisecond of
// geometry work. A view that is off screen defers its update until it is seen.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const TEMPERATURE_STOPS = [
  [0, "#2a1fd6"], [3, "#7b5cff"], [8, "#ff4fa3"], [16, "#ff9d4d"], [30, "#ffe9a8"], [60, "#ffffff"],
].map(([t, hex]) => [t, new THREE.Color(hex)]);

/** Colour of a plasma at temperature t (keV), written into `target`. */
export function temperatureColor(t, target = new THREE.Color()) {
  const stops = TEMPERATURE_STOPS;
  if (!(t > 0)) return target.copy(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const k = (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return target.copy(stops[i - 1][1]).lerp(stops[i][1], k);
    }
  }
  return target.copy(stops[stops.length - 1][1]);
}

/** Outline of the plasma cross-section as [radius, height] pairs. */
export function sectionOutline(design, scale = 1, count = 72) {
  const shift = Math.asin(Math.max(-0.95, Math.min(0.95, design.delta)));
  const points = [];
  for (let i = 0; i < count; i++) {
    const theta = (2 * Math.PI * i) / count;
    points.push([
      design.R + scale * design.a * Math.cos(theta + shift * Math.sin(theta)),
      scale * design.kappa * design.a * Math.sin(theta),
    ]);
  }
  return points;
}

const CUT = Math.PI / 3.2;            // width of the cut-away slice
const ARC_START = CUT / 2;
const ARC_LENGTH = 2 * Math.PI - CUT;
const ARC_ENDS = [ARC_START, ARC_START + ARC_LENGTH];

const SHELL_SEGMENTS = 150;           // around the torus
const SHELL_RINGS = 64;               // around the cross-section
const SHELLS = [[1.0, 0.5], [0.76, 0.5], [0.52, 0.55], [0.28, 0.7]];
const CAP_LEVELS = [0, 0.2, 0.4, 0.6, 0.8, 0.92, 1.0];
const CAP_POINTS = 64;
const EDGE_POINTS = 96;
const COIL_COUNT = 18;
const COIL_POINTS = 48;

const SEGMENT_TRIG = Array.from({ length: SHELL_SEGMENTS + 1 }, (_, i) => {
  const phi = ARC_START + (ARC_LENGTH * i) / SHELL_SEGMENTS;
  return [Math.cos(phi), Math.sin(phi)];
});

/** An empty shell mesh geometry whose index and uv never change. */
function createShellGeometry() {
  const rings = SHELL_RINGS;
  const count = (SHELL_SEGMENTS + 1) * (rings + 1);
  const uvs = new Float32Array(count * 2);
  const indices = [];
  let u = 0;
  for (let i = 0; i <= SHELL_SEGMENTS; i++) {
    for (let j = 0; j <= rings; j++) {
      uvs[u++] = i / SHELL_SEGMENTS;
      uvs[u++] = j / rings;
    }
  }
  for (let i = 0; i < SHELL_SEGMENTS; i++) {
    for (let j = 0; j < rings; j++) {
      const a = i * (rings + 1) + j;
      const b = a + rings + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Rewrite a shell's vertices for a new cross-section, in place.
 * Normals are exact for a surface of revolution: if the outline has tangent
 * (dr, dz), the surface normal is (dz cos phi, -dr, dz sin phi), normalised.
 */
function updateShellGeometry(geometry, outline) {
  const rings = outline.length;
  const pos = geometry.attributes.position.array;
  const nor = geometry.attributes.normal.array;
  const nr = new Float32Array(rings);
  const nz = new Float32Array(rings);
  for (let j = 0; j < rings; j++) {
    const [r0, z0] = outline[(j - 1 + rings) % rings];
    const [r1, z1] = outline[(j + 1) % rings];
    const dr = r1 - r0;
    const dz = z1 - z0;
    const length = Math.hypot(dr, dz) || 1;
    nr[j] = dz / length;
    nz[j] = -dr / length;
  }
  let p = 0;
  for (let i = 0; i <= SHELL_SEGMENTS; i++) {
    const [cos, sin] = SEGMENT_TRIG[i];
    for (let j = 0; j <= rings; j++) {
      const k = j % rings;
      const r = outline[k][0];
      pos[p] = r * cos;
      pos[p + 1] = outline[k][1];
      pos[p + 2] = r * sin;
      nor[p] = nr[k] * cos;
      nor[p + 1] = nz[k];
      nor[p + 2] = nr[k] * sin;
      p += 3;
    }
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.normal.needsUpdate = true;
  geometry.computeBoundingSphere();
}

/** An empty cut-face geometry: nested outlines joined into rings. */
function createCapGeometry() {
  const count = CAP_LEVELS.length * CAP_POINTS;
  const indices = [];
  for (let l = 0; l < CAP_LEVELS.length - 1; l++) {
    for (let j = 0; j < CAP_POINTS; j++) {
      const a = l * CAP_POINTS + j;
      const b = l * CAP_POINTS + ((j + 1) % CAP_POINTS);
      indices.push(a, a + CAP_POINTS, b, b, a + CAP_POINTS, b + CAP_POINTS);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setIndex(indices);
  return geometry;
}

const VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uPoloidal;
  uniform float uToroidal;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float rim = pow(1.0 - facing, 1.7);
    // Bright filaments that follow the twisted magnetic field lines.
    float phase = 6.2831853 * (vUv.y * uPoloidal - vUv.x * uToroidal) + uTime;
    float filament = pow(0.5 + 0.5 * sin(phase), 6.0);
    float slow = 0.5 + 0.5 * sin(6.2831853 * (vUv.x * 3.0 + vUv.y) - uTime * 0.35);
    float alpha = uOpacity * (0.10 + 0.90 * rim) + uOpacity * 0.22 * filament * (0.4 + 0.6 * slow);
    vec3 color = uColor * (0.55 + 1.1 * rim + 0.8 * filament);
    gl_FragColor = vec4(color, alpha);
  }`;

export class PlasmaView {
  /**
   * @param canvas target canvas
   * @param options { interactive: drag to rotate, offsetX: shift sideways (fraction of width),
   *                  distance: camera distance factor, person: show the 1.8 m figure }
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = { interactive: false, offsetX: 0, distance: 1, person: true, ...options };
    this.failed = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (error) {
      this.failed = true;
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 2000);
    this.scene.add(new THREE.AmbientLight(0x8fa3c8, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 9, 6);
    this.scene.add(key);
    this.core = new THREE.PointLight(0xff7ab8, 2.0, 0, 1.4);
    this.scene.add(this.core);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.buildScene();

    this.clock = new THREE.Clock();
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.visible = true;
    this.pending = null;

    if (this.options.interactive) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableZoom = false;
      this.controls.enablePan = false;
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.minPolarAngle = 0.25;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
      this.controls.addEventListener("start", () => { this.userRotated = true; });
    }

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement || canvas);
    new IntersectionObserver((entries) => {
      this.visible = entries[0].isIntersecting;
      if (this.visible && this.pending) this.apply(this.pending);
    }, { threshold: 0.01 }).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Create every object once; later updates only rewrite their data. */
  buildScene() {
    this.materials = SHELLS.map(([, opacity]) => new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uTime: { value: 0 },
        uOpacity: { value: opacity },
        uPoloidal: { value: 14 },
        uToroidal: { value: 4 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }));
    this.shells = this.materials.map((material) => {
      const mesh = new THREE.Mesh(createShellGeometry(), material);
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    });

    const capMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.caps = ARC_ENDS.map(() => {
      const mesh = new THREE.Mesh(createCapGeometry(), capMaterial);
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    });

    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    this.edges = ARC_ENDS.map(() => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(EDGE_POINTS * 3), 3));
      const line = new THREE.LineLoop(geometry, edgeMaterial);
      line.frustumCulled = false;
      this.root.add(line);
      return line;
    });

    // Toroidal field coils: one shared tube shape, drawn 16 times by rotation.
    this.coilMaterial = new THREE.MeshStandardMaterial({ color: 0x566178, metalness: 0.75, roughness: 0.35, emissive: 0x0b111c });
    const angles = [];
    for (let k = 0; k < COIL_COUNT; k++) {
      const phi = (2 * Math.PI * (k + 0.5)) / COIL_COUNT;
      if (Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi))) >= CUT / 2 + 0.12) angles.push(phi);
    }
    this.coils = new THREE.InstancedMesh(new THREE.BufferGeometry(), this.coilMaterial, angles.length);
    const matrix = new THREE.Matrix4();
    angles.forEach((phi, i) => this.coils.setMatrixAt(i, matrix.makeRotationY(-phi)));
    this.coils.instanceMatrix.needsUpdate = true;
    this.coils.frustumCulled = false;
    this.root.add(this.coils);

    // The 1.8 m figure.
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8dbe4, roughness: 0.8, emissive: 0x30343f });
    this.person = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.02, 6, 14), skin);
    body.position.y = 0.68;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
    head.position.y = 1.67;
    this.person.add(body, head);
    this.person.visible = this.options.person;
    this.root.add(this.person);

    this.color = new THREE.Color();
  }

  resize() {
    if (this.failed) return;
    const width = this.canvas.clientWidth || 600;
    const height = this.canvas.clientHeight || 400;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const shift = width > 860 ? this.options.offsetX : 0;
    if (shift) this.camera.setViewOffset(width, height, -shift * width, 0, width, height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** design: { R, a, kappa, delta, T0, tPeak, q95 } in metres and keV. */
  setDesign(design) {
    if (this.failed) return;
    this.pending = design;
    if (this.visible) this.apply(design);
  }

  apply(design) {
    this.pending = null;
    const shapeKey = `${design.R}|${design.a}|${design.kappa}|${design.delta}`;
    if (shapeKey !== this.shapeKey) {
      this.shapeKey = shapeKey;
      this.updateShape(design);
    }
    this.updateTemperature(design);
  }

  updateShape(design) {
    SHELLS.forEach(([rho], index) => {
      updateShellGeometry(this.shells[index].geometry, sectionOutline(design, rho, SHELL_RINGS));
    });

    // Cut-face and edge positions.
    this.capOutlines = CAP_LEVELS.map((rho) => sectionOutline(design, Math.max(rho, 0.0001), CAP_POINTS));
    const edgeOutline = sectionOutline(design, 1, EDGE_POINTS);
    ARC_ENDS.forEach((phi, index) => {
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      const pos = this.caps[index].geometry.attributes.position;
      let p = 0;
      for (const outline of this.capOutlines) {
        for (const [r, z] of outline) {
          pos.array[p++] = r * cos;
          pos.array[p++] = z;
          pos.array[p++] = r * sin;
        }
      }
      pos.needsUpdate = true;
      const edge = this.edges[index].geometry.attributes.position;
      p = 0;
      for (const [r, z] of edgeOutline) {
        edge.array[p++] = r * cos;
        edge.array[p++] = z;
        edge.array[p++] = r * sin;
      }
      edge.needsUpdate = true;
    });

    // One coil shape in the plane phi = 0, shared by every coil.
    const clearance = 1 + (0.38 * design.a + 0.22) / design.a;
    const tube = Math.max(0.03, 0.028 * (design.R + design.a));
    const coilOutline = sectionOutline({ ...design, delta: design.delta * 0.7 }, clearance, COIL_POINTS);
    const curve = new THREE.CatmullRomCurve3(coilOutline.map(([r, z]) => new THREE.Vector3(Math.max(r, tube * 1.5), z, 0)), true);
    this.coils.geometry.dispose();
    this.coils.geometry = new THREE.TubeGeometry(curve, 72, tube, 8, true);

    // Floor grid in one-metre squares, rebuilt only when its size changes.
    const extent = design.R + design.a;
    const floor = -design.kappa * design.a * clearance - tube - 0.05;
    const cells = Math.min(80, Math.max(8, Math.ceil((extent * 3.2) / 2) * 2));
    if (cells !== this.gridCells) {
      this.gridCells = cells;
      if (this.grid) {
        this.scene.remove(this.grid);
        this.grid.geometry.dispose();
        this.grid.material.dispose();
      }
      this.grid = new THREE.GridHelper(cells, cells, 0x2b3550, 0x171c29);
      this.grid.material.transparent = true;
      this.grid.material.opacity = 0.75;
      this.scene.add(this.grid);
    }
    this.grid.position.y = floor;

    const stand = extent * clearance * 0.86 + 0.9;
    this.person.position.set(stand * Math.cos(0.1), floor, stand * Math.sin(0.1));

    // Frame the machine.
    const distance = (extent * 3.5 + 1.6) * this.options.distance;
    if (!this.userRotated || this.framed === undefined) {
      this.camera.position.set(distance * 0.8, distance * 0.4, distance * 0.46);
    } else {
      this.camera.position.setLength(distance);
    }
    this.framed = true;
    this.camera.lookAt(0, floor * 0.25, 0);
    if (this.controls) {
      this.controls.target.set(0, floor * 0.25, 0);
      this.controls.update();
    }
  }

  updateTemperature(design) {
    const hot = Number.isFinite(design.T0) && design.T0 > 0 ? design.T0 : 0.3;
    const exponent = Math.max(0, (design.tPeak || 2.5) - 1);
    const profile = (rho) => hot * Math.pow(Math.max(0, 1 - rho * rho), exponent);
    const pitch = Math.max(1.5, Math.min(8, design.q95 || 3));
    const toroidal = Math.max(2, Math.round(14 / pitch));

    SHELLS.forEach(([rho], index) => {
      const uniforms = this.materials[index].uniforms;
      temperatureColor(profile(Math.min(rho, 0.93)), uniforms.uColor.value);
      uniforms.uToroidal.value = toroidal;
    });

    // Cut faces: brighter and hotter towards the core.
    const color = this.color;
    for (const cap of this.caps) {
      const colors = cap.geometry.attributes.color;
      let p = 0;
      for (const rho of CAP_LEVELS) {
        temperatureColor(profile(rho), color);
        const dim = 0.25 + 0.75 * (1 - rho * rho);
        for (let j = 0; j < CAP_POINTS; j++) {
          colors.array[p++] = color.r * dim;
          colors.array[p++] = color.g * dim;
          colors.array[p++] = color.b * dim;
        }
      }
      colors.needsUpdate = true;
    }

    temperatureColor(profile(0.5), this.core.color);
    this.core.intensity = 1.2 + Math.min(2.5, hot / 12);
  }

  frame() {
    if (!this.visible || document.hidden) return;
    const delta = Math.min(0.05, this.clock.getDelta());
    const time = this.clock.elapsedTime;
    if (!this.reduced) {
      for (const material of this.materials) material.uniforms.uTime.value = time * 1.6;
      if (!this.userRotated) this.root.rotation.y += delta * 0.09;
    }
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }
}
