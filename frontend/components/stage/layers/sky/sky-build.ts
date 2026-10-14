/**
 * Pure builders for the sky layer: star field, far galaxy hint and far object
 * instances, from one seed, one placement and the view. No three.js objects
 * (only `Color` for sRGB -> linear), so everything runs in vitest and the
 * renderer just uploads the arrays.
 */
import { Color, SRGBColorSpace } from "three";
import type { SkyPlacement, PlacedObject } from "@/lib/stage/placement";
import { clamp, gaussian, int, mulberry32, pick, range, type Rng } from "@/lib/stage/rng";
import type { StageTheme } from "../../lib/uniforms";
import { backdropDistance, toWorld, unitsPerViewportHeight, viewHalfExtent } from "../../lib/view";
import {
  CLUSTER_PALETTE,
  GALAXY_PALETTES,
  NEBULA_PALETTES,
  PLANETARY_PALETTES,
  SKY_TOKEN_FALLBACK,
  SMUDGE_CORE,
  SMUDGE_PALETTE,
  STAR_TINTS,
  parseCssColor,
  type GalaxyPalette,
  type SkyTokens,
} from "./sky-palette";
import { QUAD_KIND } from "./sky-shaders";

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

export const SHAPE = { cell: 0, plus: 1 } as const;

export interface SkyPointBuffers {
  count: number;
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  phase: Float32Array;
  shape: Float32Array;
  drift: Float32Array;
}

export class SkyPointWriter {
  readonly position: Float32Array;
  readonly color: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly phase: Float32Array;
  readonly shape: Float32Array;
  readonly drift: Float32Array;
  count = 0;

  constructor(readonly capacity: number) {
    this.position = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.phase = new Float32Array(capacity);
    this.shape = new Float32Array(capacity);
    this.drift = new Float32Array(capacity);
  }

  push(x: number, y: number, z: number, c: Color, alpha: number, size: number, phase: number, shape: number, drift: number): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.position[i * 3] = x;
    this.position[i * 3 + 1] = y;
    this.position[i * 3 + 2] = z;
    this.color[i * 3] = c.r;
    this.color[i * 3 + 1] = c.g;
    this.color[i * 3 + 2] = c.b;
    this.size[i] = size;
    this.alpha[i] = alpha;
    this.phase[i] = phase;
    this.shape[i] = shape;
    this.drift[i] = drift;
  }

  finish(): SkyPointBuffers {
    const n = this.count;
    return {
      count: n,
      position: this.position.subarray(0, n * 3),
      color: this.color.subarray(0, n * 3),
      size: this.size.subarray(0, n),
      alpha: this.alpha.subarray(0, n),
      phase: this.phase.subarray(0, n),
      shape: this.shape.subarray(0, n),
      drift: this.drift.subarray(0, n),
    };
  }
}

/** Linear colour + straight alpha from a CSS token string (falls back when unparsable). */
export function tokenColor(value: string, fallback: string): { color: Color; alpha: number } {
  const parsed = parseCssColor(value) ?? parseCssColor(fallback) ?? [1, 1, 1, 1];
  return { color: new Color().setRGB(parsed[0], parsed[1], parsed[2], SRGBColorSpace), alpha: parsed[3] };
}

// ---------------------------------------------------------------------------
// Star field: three parallax depths in one draw
// ---------------------------------------------------------------------------

export interface StarLayer {
  share: number;
  /** World distance of the layer (camera at the origin). */
  distance: number;
  size: 1 | 3;
  tier: "soft" | "star" | "bright";
  /** Drift factor: near layers slide faster (parallax). */
  drift: number;
}

export const STAR_LAYERS: readonly StarLayer[] = [
  { share: 0.62, distance: 150, size: 1, tier: "soft", drift: 0.35 },
  { share: 0.32, distance: 95, size: 1, tier: "star", drift: 0.6 },
  { share: 0.06, distance: 50, size: 3, tier: "bright", drift: 1 },
];

/** NDC units per second for the near layer: one screen width in roughly 23 minutes. Calm. */
export const STAR_DRIFT_NDC_PER_S = 0.0016;

/** Stars are laid over ndc [-1.1, 1.1] on both axes so the drift wrap is seamless. */
export const STAR_NDC_EXTENT = 1.1;

/** Total stars for a viewport; ~760 at 1440 x 900, of which ~530 are on screen at once. */
export function starCount(width: number, height: number): number {
  return clamp(Math.round((width * height) / 1700), 300, 1800);
}

export interface StarFieldInput {
  seed: number;
  theme: StageTheme;
  width: number;
  height: number;
  fovDeg: number;
  tokens: SkyTokens;
}

export function writeStarField(w: SkyPointWriter, input: StarFieldInput): number {
  const rng = mulberry32(input.seed ^ 0x51a7);
  const aspect = input.width / Math.max(1, input.height);
  const count = starCount(input.width, input.height);
  const fallback = SKY_TOKEN_FALLBACK[input.theme];
  const star = tokenColor(input.tokens.star, fallback.star);
  const soft = tokenColor(input.tokens.starSoft, fallback.starSoft);
  const warm = new Color(STAR_TINTS.warm);
  const blue = new Color(STAR_TINTS.blue);
  const dark = input.theme === "dark";
  let written = 0;
  for (const layer of STAR_LAYERS) {
    const n = Math.round(count * layer.share);
    for (let k = 0; k < n; k++) {
      const nx = range(rng, -STAR_NDC_EXTENT, STAR_NDC_EXTENT);
      const ny = range(rng, -STAR_NDC_EXTENT, STAR_NDC_EXTENT);
      const distance = layer.distance * (0.92 + 0.16 * rng());
      const { halfW, halfH } = viewHalfExtent(input.fovDeg, aspect, distance);
      let c = star.color;
      let alpha = star.alpha;
      if (layer.tier === "soft") {
        c = soft.color;
        alpha = soft.alpha;
      } else if (layer.tier === "bright" && dark) {
        const roll = rng();
        c = roll < 0.3 ? warm : roll < 0.55 ? blue : star.color;
      } else if (layer.tier === "star" && !dark) {
        alpha = Math.min(1, star.alpha * 0.85);
      }
      w.push(nx * halfW, ny * halfH, -distance, c, alpha, layer.size, rng(), layer.size > 1 ? SHAPE.plus : SHAPE.cell, layer.drift);
      written++;
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// Far galaxy hint
// ---------------------------------------------------------------------------

export const GALAXY_KIND = { disc: 0, bead: 2, bulge: 3 } as const;
export const GALAXY_COUNTS = { disc: 1040, bulge: 110 } as const;
/** Pattern turns once per 48 s; the outer disc orbits once per 96 s (inner stars faster). */
export const GALAXY_PATTERN_PERIOD_S = 48;
export const GALAXY_OUTER_ORBIT_S = 96;

export interface FarGalaxySpec {
  seed: number;
  arms: 2 | 3;
  twist: number;
  spinDir: 1 | -1;
  /** Signed log-spiral coefficient: theta(a) = thetaBar + b ln(a / 0.18). Sign = -spinDir so arms trail. */
  b: number;
  thetaBar: number;
  coreSize: number;
  beadDensity: number;
  eccentricity: number;
  v0: number;
  aCore: number;
  patternPeriodS: number;
  thickness: number;
  palette: GalaxyPalette;
}

export interface GalaxyBuffers {
  count: number;
  /** a, eScale, psi0, dTheta per point. */
  orbit: Float32Array;
  /** y = thickness offset (x, z unused: the orbit gives them). */
  position: Float32Array;
  kind: Float32Array;
  color: Float32Array;
  phase: Float32Array;
}

export function generateFarGalaxySpec(seed: number): FarGalaxySpec {
  const rng = mulberry32(seed);
  const arms = pick(rng, [2, 2, 3] as const);
  const twist = range(rng, 2.0, 3.2);
  const spinDir: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const coreSize = range(rng, 0.11, 0.2);
  const beadDensity = range(rng, 0.03, 0.06);
  const palette = pick(rng, GALAXY_PALETTES);
  const thetaBar = rng() * TAU;
  const thickness = range(rng, 0.02, 0.05);
  return {
    seed,
    arms,
    twist,
    spinDir,
    b: -spinDir * twist,
    thetaBar,
    coreSize,
    beadDensity,
    // Crowding factor ~0.94 so the arms read as arms at one cell per star.
    eccentricity: 0.94 / Math.sqrt(1 + arms * arms * twist * twist),
    v0: TAU / GALAXY_OUTER_ORBIT_S,
    aCore: Math.max(0.08, coreSize * 0.9),
    patternPeriodS: GALAXY_PATTERN_PERIOD_S,
    thickness,
    palette,
  };
}

/** Signed pattern speed in rad/s. */
export function galaxyPatternSpeed(spec: FarGalaxySpec): number {
  return (spec.spinDir * TAU) / spec.patternPeriodS;
}

/** CPU mirror of the vertex shader's orbit: disc-plane position of one point at time t. */
export function galaxyStarPosition(spec: FarGalaxySpec, orbit: readonly [number, number, number, number], t: number): { x: number; z: number; r: number } {
  const [a, eScale, psi0, dTheta] = orbit;
  const omega = (spec.spinDir * spec.v0) / Math.max(a, spec.aCore);
  const psi = psi0 + omega * t;
  const theta = spec.thetaBar + spec.b * Math.log(Math.max(a, 0.18) / 0.18) + dTheta + galaxyPatternSpeed(spec) * t;
  const e = eScale * spec.eccentricity;
  const r = a * (1 + e * Math.cos(spec.arms * (psi - theta)));
  return { x: r * Math.cos(psi), z: r * Math.sin(psi), r };
}

export function buildFarGalaxy(spec: FarGalaxySpec): GalaxyBuffers {
  const rng = mulberry32(spec.seed ^ 0x9e3779b9);
  const n = GALAXY_COUNTS.disc + GALAXY_COUNTS.bulge;
  const orbit = new Float32Array(n * 4);
  const position = new Float32Array(n * 3);
  const kind = new Float32Array(n);
  const color = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const core = new Color(spec.palette.core);
  const arm = new Color(spec.palette.arm);
  const tip = new Color(spec.palette.tip);
  const bead = new Color(spec.palette.bead);
  const beadAlt = new Color(spec.palette.beadAlt);
  const white = new Color("#fffaf0");
  const c = new Color();
  let i = 0;
  const put = (a: number, eScale: number, psi0: number, dTheta: number, k: number, y: number) => {
    orbit.set([a, eScale, psi0, dTheta], i * 4);
    position.set([0, y, 0], i * 3);
    kind[i] = k;
    color.set([c.r, c.g, c.b], i * 3);
    phase[i] = rng();
    i++;
  };
  // Disc: more inward (pow 0.7); 86 % hug the crowding (eScale 1), the rest a soft disc; some become HII beads.
  for (let k = 0; k < GALAXY_COUNTS.disc; k++) {
    const a = 0.06 + 0.96 * Math.pow(rng(), 0.7);
    const hug = rng() < 0.86;
    const psi0 = rng() * TAU;
    const isBead = hug && a > 0.3 && a < 0.92 && rng() < spec.beadDensity;
    c.copy(core).lerp(arm, Math.min(1, a * 1.15));
    if (a > 0.7 && rng() < 0.35) c.lerp(tip, 0.6);
    if (isBead) c.copy(rng() < 0.65 ? bead : beadAlt);
    const y = gaussian(rng) * spec.thickness * (1 + 0.6 * (1 - a));
    put(a, hug ? 1 : 0.3, psi0, isBead ? spec.spinDir * 0.14 : 0, isBead ? GALAXY_KIND.bead : GALAXY_KIND.disc, y);
  }
  // Bulge: Gaussian ball on circular orbits, warm, only a little whiter at the very centre
  // (the dithered bulge glow quad carries the heat; too many white cells read as a blob).
  for (let k = 0; k < GALAXY_COUNTS.bulge; k++) {
    const a = Math.min(0.5, Math.abs(gaussian(rng)) * spec.coreSize + 0.01);
    const heat = Math.exp(-(a * a) / (2 * spec.coreSize * spec.coreSize * 0.3));
    c.copy(core).lerp(white, heat * 0.45);
    put(a, 0, rng() * TAU, 0, GALAXY_KIND.bulge, gaussian(rng) * spec.coreSize * 0.45);
  }
  return { count: i, orbit, position, kind, color, phase };
}

// ---------------------------------------------------------------------------
// Far objects: instanced quads + crisp points
// ---------------------------------------------------------------------------

export interface QuadInstances {
  count: number;
  matrices: Float32Array;
  kind: Float32Array;
  params: Float32Array;
  params2: Float32Array;
  c0: Float32Array;
  c1: Float32Array;
  c2: Float32Array;
  c3: Float32Array;
}

export const QUAD_CAPACITY = 24;

class QuadWriter {
  readonly matrices = new Float32Array(QUAD_CAPACITY * 16);
  readonly kind = new Float32Array(QUAD_CAPACITY);
  readonly params = new Float32Array(QUAD_CAPACITY * 4);
  readonly params2 = new Float32Array(QUAD_CAPACITY * 4);
  readonly c0 = new Float32Array(QUAD_CAPACITY * 3);
  readonly c1 = new Float32Array(QUAD_CAPACITY * 3);
  readonly c2 = new Float32Array(QUAD_CAPACITY * 3);
  readonly c3 = new Float32Array(QUAD_CAPACITY * 3);
  count = 0;

  push(matrix: Float32Array, kind: number, params: readonly number[], params2: readonly number[], colors: readonly [Color, Color, Color, Color]): void {
    if (this.count >= QUAD_CAPACITY) return;
    const i = this.count++;
    this.matrices.set(matrix, i * 16);
    this.kind[i] = kind;
    this.params.set(params, i * 4);
    this.params2.set(params2, i * 4);
    const cs = [this.c0, this.c1, this.c2, this.c3];
    colors.forEach((c, k) => cs[k].set([c.r, c.g, c.b], i * 3));
  }

  finish(): QuadInstances {
    const n = this.count;
    return {
      count: n,
      matrices: this.matrices.subarray(0, n * 16),
      kind: this.kind.subarray(0, n),
      params: this.params.subarray(0, n * 4),
      params2: this.params2.subarray(0, n * 4),
      c0: this.c0.subarray(0, n * 3),
      c1: this.c1.subarray(0, n * 3),
      c2: this.c2.subarray(0, n * 3),
      c3: this.c3.subarray(0, n * 3),
    };
  }
}

/** A quad's world matrix: a unit plane (-0.5..0.5) scaled to the full box, rotated about the view axis. */
export function quadMatrix(center: readonly [number, number, number], halfW: number, halfH: number, rotation: number): Float32Array {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const sx = halfW * 2;
  const sy = halfH * 2;
  // Column-major: columns are the rotated, scaled basis vectors, then the translation.
  return new Float32Array([c * sx, s * sx, 0, 0, -s * sy, c * sy, 0, 0, 0, 0, 1, 0, center[0], center[1], center[2], 1]);
}

interface ObjectFrame {
  center: [number, number, number];
  halfW: number;
  halfH: number;
  rotation: number;
  distance: number;
}

function objectFrame(o: Pick<PlacedObject, "u" | "v" | "size" | "aspect" | "rotation" | "depth">, fovDeg: number, aspect: number): ObjectFrame {
  const distance = backdropDistance(o.depth);
  const center = toWorld(o.u, o.v, distance, fovDeg, aspect);
  const halfH = (o.size * unitsPerViewportHeight(fovDeg, distance)) / 2;
  return { center, halfW: halfH * o.aspect, halfH, rotation: o.rotation, distance };
}

/** Object-box local (-1..1) -> world, through the object's rotation. */
function localToWorld(f: ObjectFrame, lx: number, ly: number): [number, number, number] {
  const x = lx * f.halfW;
  const y = ly * f.halfH;
  const c = Math.cos(f.rotation);
  const s = Math.sin(f.rotation);
  return [f.center[0] + c * x - s * y, f.center[1] + s * x + c * y, f.center[2]];
}

export interface ObjectsInput {
  theme: StageTheme;
  fovDeg: number;
  aspect: number;
  placement: SkyPlacement;
}

const scratch = new Color();

export function writeObjects(points: SkyPointWriter, quads: QuadWriter, input: ObjectsInput): void {
  const dark = input.theme === "dark";
  for (const o of input.placement.objects) {
    const rng: Rng = mulberry32(o.seed);
    const f = objectFrame(o, input.fovDeg, input.aspect);
    const seedF = range(rng, 0, 100);
    if (o.kind === "nebula") {
      const pal = NEBULA_PALETTES[o.variant] ?? NEBULA_PALETTES.orion;
      const heart: [number, number] = [range(rng, -0.25, 0.25), range(rng, -0.2, 0.2)];
      quads.push(
        quadMatrix(f.center, f.halfW, f.halfH, f.rotation),
        QUAD_KIND.nebula,
        [dark ? 0.72 : 0.42, range(rng, 1.6, 2.4), range(rng, 0.4, 0.65), seedF],
        [heart[0], heart[1], 0.6, range(rng, 0.8, 1.25)],
        [new Color(pal.deep), new Color(pal.mid), new Color(pal.bright), new Color(pal.heart)],
      );
      // A few embedded stars: tiny, one 3x3 near the heart.
      const n = int(rng, 6, 10);
      for (let k = 0; k < n; k++) {
        const big = k === 0;
        const lx = big ? heart[0] + range(rng, -0.1, 0.1) : range(rng, -0.85, 0.85);
        const ly = big ? heart[1] + range(rng, -0.08, 0.08) : range(rng, -0.85, 0.85);
        scratch.set(dark ? pick(rng, pal.stars) : "#17151d");
        const [x, y, z] = localToWorld(f, lx, ly);
        points.push(x, y, z, scratch, dark ? 0.9 : 0.6, big ? 3 : 1, rng(), big ? SHAPE.plus : SHAPE.cell, 0);
      }
    } else if (o.kind === "planetary") {
      const pal = PLANETARY_PALETTES[o.variant] ?? PLANETARY_PALETTES.ring;
      quads.push(
        quadMatrix(f.center, f.halfW, f.halfH, f.rotation),
        QUAD_KIND.planetary,
        [dark ? 0.85 : 0.7, range(rng, 0.74, 0.9), range(rng, 0, TAU), seedF],
        [0, 0, 0, 0],
        [new Color(pal.inner), new Color(pal.a), new Color(pal.b), new Color(pal.c)],
      );
      scratch.set(dark ? pal.dwarf : "#17151d");
      points.push(f.center[0], f.center[1], f.center[2], scratch, 1, 3, rng(), SHAPE.plus, 0);
      for (let k = 0; k < 3; k++) {
        const ang = range(rng, 0, TAU);
        const r = range(rng, 0.78, 0.96);
        const [x, y, z] = localToWorld(f, Math.cos(ang) * r, Math.sin(ang) * r);
        scratch.set(dark ? "#dfe8ff" : "#17151d");
        points.push(x, y, z, scratch, dark ? 0.9 : 0.6, 1, rng(), SHAPE.cell, 0);
      }
    } else if (o.kind === "cluster") {
      const squash = range(rng, 0.7, 1);
      const roll = range(rng, 0, Math.PI);
      const place = (sigma: number): [number, number] => {
        const x = gaussian(rng) * sigma;
        const y = gaussian(rng) * sigma * squash;
        return [Math.cos(roll) * x - Math.sin(roll) * y, Math.sin(roll) * x + Math.cos(roll) * y];
      };
      const bright: [number, number][] = [];
      const nBright = int(rng, 4, 6);
      for (let k = 0; k < nBright; k++) {
        const [lx, ly] = place(0.28);
        if (bright.length < 3) bright.push([clamp(lx, -0.8, 0.8), clamp(ly, -0.8, 0.8)]);
        const [x, y, z] = localToWorld(f, lx, ly);
        scratch.set(dark ? CLUSTER_PALETTE.bright : "#17151d");
        points.push(x, y, z, scratch, 1, 3, rng(), SHAPE.plus, 0);
      }
      const n = int(rng, 28, 44);
      for (let k = 0; k < n; k++) {
        const [lx, ly] = place(0.36);
        const [x, y, z] = localToWorld(f, lx, ly);
        scratch.set(dark ? pick(rng, CLUSTER_PALETTE.stars) : "#17151d");
        points.push(x, y, z, scratch, dark ? 0.9 : 0.55, 1, rng(), SHAPE.cell, 0);
      }
      while (bright.length < 3) bright.push([0, 0]);
      quads.push(
        quadMatrix(f.center, f.halfW, f.halfH, f.rotation),
        QUAD_KIND.clusterHaze,
        [dark ? 0.65 : 0.45, bright[2][0], bright[2][1], seedF],
        [bright[0][0], bright[0][1], bright[1][0], bright[1][1]],
        [new Color(CLUSTER_PALETTE.glow[0]), new Color(CLUSTER_PALETTE.glow[1]), new Color(CLUSTER_PALETTE.glow[2]), new Color(CLUSTER_PALETTE.bright)],
      );
    } else if (o.kind === "smudges") {
      // A loose ring of tiny tilted ellipses and lensed arcs bending around an unseen mass.
      const n = int(rng, 5, 8);
      const arcShare = 0.35;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * TAU + range(rng, -0.3, 0.3);
        const r = range(rng, 0.35, 0.85);
        const [x, y, z] = localToWorld(f, Math.cos(ang) * r, Math.sin(ang) * r);
        const arc = rng() < arcShare;
        const w = range(rng, 0.12, 0.24) * f.halfH;
        const rot = arc ? ang + f.rotation + Math.PI / 2 : range(rng, 0, Math.PI);
        const tint = new Color(pick(rng, SMUDGE_PALETTE));
        quads.push(
          quadMatrix([x, y, z], w, w, rot),
          arc ? QUAD_KIND.arc : QUAD_KIND.ellipse,
          [dark ? 0.9 : 0.7, arc ? range(rng, 0.9, 1.8) : range(rng, 0.35, 0.75), 0, range(rng, 0, 100)],
          [0, 0, 0, 0],
          [tint, tint, tint, new Color(SMUDGE_CORE)],
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Whole sky
// ---------------------------------------------------------------------------

export interface GalaxyTransform {
  position: [number, number, number];
  /** Disc radius in world units. */
  radius: number;
  tilt: number;
  roll: number;
}

export interface SkyBuildInput {
  seed: number;
  theme: StageTheme;
  width: number;
  height: number;
  fovDeg: number;
  tokens: SkyTokens;
  placement: SkyPlacement;
}

export interface SkyBuild {
  points: SkyPointBuffers;
  quads: QuadInstances;
  galaxy: { spec: FarGalaxySpec; buffers: GalaxyBuffers; transform: GalaxyTransform };
  stats: { stars: number; objectPoints: number; galaxyPoints: number; quads: number; points: number; draws: number };
}

/** Draw calls the sky issues per frame: points, galaxy, quads, plus the composer's upscale quad. */
export const SKY_DRAW_CALLS = 4;
export const SKY_POINT_BUDGET = 6000;

export function buildSky(input: SkyBuildInput): SkyBuild {
  const aspect = input.width / Math.max(1, input.height);
  const points = new SkyPointWriter(2400);
  const stars = writeStarField(points, input);
  const quads = new QuadWriter();
  writeObjects(points, quads, { theme: input.theme, fovDeg: input.fovDeg, aspect, placement: input.placement });

  const g = input.placement.galaxy;
  const spec = generateFarGalaxySpec(g.seed);
  const buffers = buildFarGalaxy(spec);
  const distance = backdropDistance(g.depth);
  const radius = (g.size * unitsPerViewportHeight(input.fovDeg, distance)) / 2;
  const position = toWorld(g.u, g.v, distance, input.fovDeg, aspect);
  // Bulge glow as a billboard ellipse in the disc's projected frame.
  const glowR = radius * 0.5;
  quads.push(
    quadMatrix(position, glowR, glowR * Math.cos(g.tilt), g.roll),
    QUAD_KIND.bulge,
    [input.theme === "dark" ? 0.7 : 0.55, 0, 0, 0],
    [0, 0, 0, 0],
    [new Color(spec.palette.glow[0]), new Color(spec.palette.glow[1]), new Color(spec.palette.glow[2]), new Color(spec.palette.core)],
  );

  const p = points.finish();
  const q = quads.finish();
  return {
    points: p,
    quads: q,
    galaxy: { spec, buffers, transform: { position, radius, tilt: g.tilt, roll: g.roll } },
    stats: {
      stars,
      objectPoints: p.count - stars,
      galaxyPoints: buffers.count,
      quads: q.count,
      points: p.count + buffers.count,
      draws: SKY_DRAW_CALLS,
    },
  };
}
