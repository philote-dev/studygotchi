/**
 * Stage altitude model (ported verbatim from the space lab's Stage v2
 * `altitude.ts`; the geometry it keys off lives in `./geometry`). Pure, no three.js.
 *
 * One scene at true relative scale, in PLANET UNITS (planet radius 1):
 *   - the world diorama sits on the planet's surface at the course marker,
 *     scaled so its dive pose and the planet's dive pose coincide;
 *   - the course cluster's core star IS the planet (cluster units x2.5, so
 *     the 0.4 core radius is the unit sphere);
 *   - the galaxy is anchored so the current course bead sits at the origin
 *     (galaxy units x50, so the 0.5 bead radius is the 25-unit cluster).
 *
 * One camera travels a single log-distance axis L (world 0, planet 1,
 * cluster 2, galaxy 3): `cameraAt(L)` is a monotone cubic through seven
 * keyed poses, so distance, direction, target and FOV are all C1 in L and
 * nothing jumps. Visibility is never flipped: `altitudeAt(L)` gives every
 * layer a smooth opacity / morph amount from altitude bands, and the old
 * match cuts become morphs (planet -> core star, cluster -> arm bead,
 * landmark -> marker) that both sides draw at the same size.
 */
import { CLUSTER, PLANET, SPACE, WORLD, add, cross, dot, length, norm, scale, sub, type CameraPose, type Vec3 } from "./geometry";

export type { CameraPose, Vec3 } from "./geometry";

/* ------------------------------------------------------------------ */
/* Scales and frames                                                   */
/* ------------------------------------------------------------------ */

/** World arrival distance (world units) and the dive factor above it. */
const WORLD_ARRIVAL_D = length(sub(WORLD.arrival.position, WORLD.arrival.target));
/** Dive altitude above the marker in planet units (the old planet dive pose: 0.55 R over the marker). */
export const DIVE_ALTITUDE = 0.55;
/** World units -> planet units: the world's dive pose (5.2x above arrival) is the planet's dive pose. */
export const WORLD_SCALE = DIVE_ALTITUDE / (WORLD_ARRIVAL_D * WORLD.diveFactor);
/** Cluster units -> planet units: the core star (0.4) is the planet (1). */
export const CLUSTER_SCALE = PLANET.radius / CLUSTER.coreRadius;
/** Galaxy units -> planet units: an arm bead (0.5) is the whole cluster (10 x 2.5). */
export const GALAXY_SCALE = (CLUSTER.radius * CLUSTER_SCALE) / SPACE.beadRadius;
/** Galaxy disc radius in planet units. */
export const GALAXY_WORLD_RADIUS = SPACE.galaxyRadius * GALAXY_SCALE;

/** Course marker normal: the world sits here. */
export const MARKER: Vec3 = PLANET.marker;
/** The seat direction: every pose from the planet seat to the galaxy's edge looks along it. */
export const SEAT_DIR: Vec3 = norm(PLANET.seated.position);
export const SEAT_DISTANCE = length(PLANET.seated.position);

/** Tangent frame at the marker: e1 points toward the seat side, e2 completes it. */
const E1: Vec3 = norm(sub(SEAT_DIR, scale(MARKER, dot(SEAT_DIR, MARKER))));
const E2: Vec3 = cross(MARKER, E1);

/** World frame basis (columns X, Y, Z) in planet space: Y up the marker normal, +Z toward the seat. */
export const WORLD_BASIS: { x: Vec3; y: Vec3; z: Vec3 } = { x: E2, y: MARKER, z: E1 };
/** World origin: the ground's top face touches the sphere at the marker. */
export const WORLD_ORIGIN: Vec3 = scale(MARKER, PLANET.radius);

/** World-frame point -> planet space. */
export function worldToPlanet(p: Vec3): Vec3 {
  const { x, y, z } = WORLD_BASIS;
  return add(WORLD_ORIGIN, scale(add(add(scale(x, p[0]), scale(y, p[1])), scale(z, p[2])), WORLD_SCALE));
}
/** World-frame direction -> planet space (unit). */
export function worldDirToPlanet(d: Vec3): Vec3 {
  const { x, y, z } = WORLD_BASIS;
  return norm(add(add(scale(x, d[0]), scale(y, d[1])), scale(z, d[2])));
}

/* ------------------------------------------------------------------ */
/* Camera path                                                         */
/* ------------------------------------------------------------------ */

export interface CameraContext {
  /** Galaxy centre in planet space (minus the current bead's offset; the runtime tracks the arm's spin). */
  galaxyCenter: Vec3;
}

/** Arrival offset from the galaxy centre (planet units), the old `spaceArrivalPose` scaled. */
const ARRIVAL_YAW = (4 * Math.PI) / 180;
export const GALAXY_ARRIVAL_DISTANCE = SPACE.arrivalDistance * GALAXY_SCALE;
const ARRIVAL_DIR: Vec3 = norm([Math.sin(ARRIVAL_YAW), 0.06, Math.cos(ARRIVAL_YAW)]);

/** Default galaxy centre for tests: our bead 0.62 R out along +x of the disc, 0.1 R deep. */
export const DEFAULT_GALAXY_CENTER: Vec3 = [-SPACE.galaxyRadius * 0.62 * GALAXY_SCALE, 0, -SPACE.galaxyRadius * 0.1 * GALAXY_SCALE];
export const DEFAULT_CAMERA_CONTEXT: CameraContext = { galaxyCenter: DEFAULT_GALAXY_CENTER };

/** Camera distance at each stop / threshold (planet units). Monotone in L. */
export const KEY_L: readonly number[] = [0, 0.5, 1, 1.5, 2, 2.5, 3];
export const KEY_DISTANCE: readonly number[] = [
  WORLD_ARRIVAL_D * WORLD_SCALE, // world arrival
  DIVE_ALTITUDE, // over the marker
  SEAT_DISTANCE, // planet seat
  Math.sqrt(SEAT_DISTANCE * CLUSTER.restDistance * CLUSTER_SCALE), // planet shrinking, cluster stars entering
  CLUSTER.restDistance * CLUSTER_SCALE, // cluster rest: constellation fills ~55 %
  2000, // the galaxy's edge: the cluster is a few cells
  GALAXY_ARRIVAL_DISTANCE, // galaxy rest
];
export const KEY_FOV: readonly number[] = [WORLD.arrival.fov, 22, PLANET.seated.fov, 28, CLUSTER.restFov, 37, 34];

const WORLD_FWD: Vec3 = worldDirToPlanet(norm(sub(WORLD.arrival.position, WORLD.arrival.target)));
/** Over the marker the camera looks steeply down (30 deg off the normal, toward the seat side). */
const DIVE_DIR: Vec3 = norm(add(scale(MARKER, Math.cos(Math.PI / 6)), scale(E1, Math.sin(Math.PI / 6))));

const KEY_DIR: readonly Vec3[] = [WORLD_FWD, DIVE_DIR, SEAT_DIR, SEAT_DIR, SEAT_DIR, SEAT_DIR, ARRIVAL_DIR];
const WORLD_TARGET: Vec3 = worldToPlanet(WORLD.arrival.target);
const ORIGIN: Vec3 = [0, 0, 0];

/* Monotone cubic (Fritsch-Carlson) through (xs, ys): C1, no overshoot. */
function pchipSlopes(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array<number>(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return m;
}

function pchipEval(xs: readonly number[], ys: readonly number[], m: readonly number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
  if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i];
  const t = (x - xs[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
}

/** Monotone cubic interpolant over the ladder keys. */
export function ladderCurve(ys: readonly number[]): (L: number) => number {
  const m = pchipSlopes(KEY_L, ys);
  return (L) => pchipEval(KEY_L, ys, m, L);
}

const LOG_D = ladderCurve(KEY_DISTANCE.map((d) => Math.log10(d)));
const FOV = ladderCurve(KEY_FOV);
const DIR_X = ladderCurve(KEY_DIR.map((d) => d[0]));
const DIR_Y = ladderCurve(KEY_DIR.map((d) => d[1]));
const DIR_Z = ladderCurve(KEY_DIR.map((d) => d[2]));

/** Camera distance from its look target at L (planet units). */
export function distanceAt(L: number): number {
  return Math.pow(10, LOG_D(L));
}

/** d(log10 distance) / dL: the zoom rate per unit of L (decades). */
export function zoomSlopeAt(L: number): number {
  const e = 1e-3;
  return (LOG_D(L + e) - LOG_D(L - e)) / (2 * e);
}

export function fovAt(L: number): number {
  return FOV(L);
}

export function directionAt(L: number): Vec3 {
  return norm([DIR_X(L), DIR_Y(L), DIR_Z(L)]);
}

/** Look target at L: the world's ground, the marker, the planet / cluster / bead origin, then the galaxy centre. */
export function targetAt(L: number, ctx: CameraContext = DEFAULT_CAMERA_CONTEXT): Vec3 {
  const keys: Vec3[] = [WORLD_TARGET, WORLD_ORIGIN, ORIGIN, ORIGIN, ORIGIN, ORIGIN, ctx.galaxyCenter];
  const x = ladderCurve(keys.map((k) => k[0]))(L);
  const y = ladderCurve(keys.map((k) => k[1]))(L);
  const z = ladderCurve(keys.map((k) => k[2]))(L);
  return [x, y, z];
}

export interface Stage2Camera extends CameraPose {
  distance: number;
  /** Camera up vector: the marker normal over the diorama, world Y from the seat on (a smooth roll between). */
  up: Vec3;
  /** Suggested near / far for the depth buffer at this altitude. */
  near: number;
  far: number;
}

const WORLD_Y: Vec3 = [0, 1, 0];

export function upAt(L: number): Vec3 {
  const k = smoothstep(0.5, 1.0, L);
  return norm(add(scale(MARKER, 1 - k), scale(WORLD_Y, k)));
}

export function cameraAt(L: number, ctx: CameraContext = DEFAULT_CAMERA_CONTEXT): Stage2Camera {
  const Lc = Math.max(-0.1, Math.min(3.1, L));
  const d = distanceAt(Lc);
  const dir = directionAt(Lc);
  const target = targetAt(Lc, ctx);
  return {
    position: add(target, scale(dir, d)),
    target,
    fov: fovAt(Lc),
    distance: d,
    up: upAt(Lc),
    near: d * 0.02,
    far: d * 1200,
  };
}

/* ------------------------------------------------------------------ */
/* Altitude bands                                                      */
/* ------------------------------------------------------------------ */

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Smooth bump centred on `c` with half-width `w` (1 at the centre, 0 outside). */
export function bump(c: number, w: number, x: number): number {
  const u = Math.min(1, Math.abs(x - c) / w);
  return 1 - u * u * (3 - 2 * u);
}

export interface Altitude {
  L: number;
  /** World diorama props and the central cone (opacity). */
  worldProps: number;
  /** World cloud ring (opacity): gone before the marker blob takes over. */
  worldClouds: number;
  /** World ground + sea discs (opacity). */
  worldGround: number;
  /** Course marker on the planet: scale (0.26 .. 1), flatten along the normal (0 round .. 1 flat), pin opacity, tint toward the ground colour, overall opacity. */
  markerScale: number;
  markerFlat: number;
  markerPin: number;
  markerTint: number;
  markerOpacity: number;
  /** Planet continents, moons and the station (opacity). */
  planetFeatures: number;
  /** Planet body tint: 0 blue toon ball, 1 the cream of the core star. */
  planetTint: number;
  /** Cluster core-star sprite brightness (the planet morphs into it). */
  coreBright: number;
  /** Concept stars: fade and pop-in order; constellation lines: alpha and draw progress. */
  clusterStars: number;
  clusterPop: number;
  clusterLines: number;
  clusterDraw: number;
  /** Galaxy points / glows, the course beads and the "you are here" ring. */
  galaxy: number;
  beads: number;
  ring: number;
  /** Camera-space cloud puffs crossing the lens at the cloud deck (L ~ 0.5). */
  puffs: number;
}

export function altitudeAt(L: number): Altitude {
  const Lc = Math.max(-0.1, Math.min(3.1, L));
  return {
    L: Lc,
    worldProps: 1 - smoothstep(0.72, 0.94, Lc),
    worldClouds: 1 - smoothstep(0.6, 0.78, Lc),
    worldGround: 1 - smoothstep(1.3, 1.6, Lc),
    markerScale: 0.26 + 0.74 * smoothstep(0.58, 1.0, Lc),
    markerFlat: 1 - smoothstep(0.58, 0.92, Lc),
    markerPin: smoothstep(0.78, 0.96, Lc),
    markerTint: 1 - smoothstep(0.6, 0.9, Lc),
    // Gone under the ground on the way down (the diorama takes over), sub-cell on the way up.
    markerOpacity: smoothstep(0.55, 0.85, Lc) * (1 - smoothstep(1.55, 1.85, Lc)),
    planetFeatures: 1 - smoothstep(1.5, 1.8, Lc),
    planetTint: smoothstep(1.55, 1.95, Lc),
    coreBright: smoothstep(1.6, 1.95, Lc) * (1 - smoothstep(2.55, 2.75, Lc)),
    clusterStars: smoothstep(1.4, 1.75, Lc) * (1 - smoothstep(2.35, 2.62, Lc)),
    clusterPop: smoothstep(1.45, 1.95, Lc),
    clusterLines: smoothstep(1.6, 1.9, Lc) * (1 - smoothstep(2.3, 2.55, Lc)),
    clusterDraw: smoothstep(1.65, 2.05, Lc),
    // The galaxy only materialises once the camera is clear of its disc plane (inside it the arm field is a plate across the lens).
    galaxy: smoothstep(2.3, 2.78, Lc),
    beads: smoothstep(2.3, 2.7, Lc),
    ring: smoothstep(2.65, 2.95, Lc),
    puffs: bump(0.5, 0.14, Lc),
  };
}

/** Which rest stop owns an altitude (for the readout). */
export function layerAtL(L: number): "world" | "planet" | "cluster" | "space" {
  const r = Math.round(Math.max(0, Math.min(3, L)));
  return r === 0 ? "world" : r === 1 ? "planet" : r === 2 ? "cluster" : "space";
}

export const STOP_L_V2: Record<"world" | "planet" | "cluster" | "space", number> = { world: 0, planet: 1, cluster: 2, space: 3 };

/* ------------------------------------------------------------------ */
/* Speed-driven dressing                                               */
/* ------------------------------------------------------------------ */

/** Zoom rate in decades per second from the spring velocity. */
export function zoomRate(L: number, dLdt: number): number {
  return zoomSlopeAt(L) * dLdt;
}

/** Streak tunnel from the zoom rate: nothing at rest, a thin tunnel at cruise, denser when fast. */
export function streaksFor(rate: number): { density: number; speed: number } {
  const r = Math.abs(rate);
  return { density: 0.45 * smoothstep(0.45, 2.4, r), speed: 0.5 + 1.5 * r };
}

/** Integer pixel size with hysteresis: 2 at rest, 3 while the zoom is fast. */
export function pixelFor(rate: number, current: number): number {
  const r = Math.abs(rate);
  if (current >= 3) return r < 0.7 ? 2 : 3;
  return r > 1.25 ? 3 : 2;
}
