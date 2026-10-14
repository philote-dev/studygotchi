/**
 * Stage geometry shared by the altitude model and the director: the four
 * layers' rest poses, the scale ladder's stops and the match-cut sizes.
 * Ported verbatim from the space lab's `stage/geometry.ts` (minus the lab
 * labels) so `altitude.ts` has no lab dependency. Pure, no three.js.
 *
 * Camera poses are in "stage space": the planet is a unit sphere at the
 * origin, the world diorama's ground is y = 0 at the origin, the course
 * cluster's core star is at the origin, and the galaxy sits at `SPACE.galaxy`.
 */

export type Vec3 = readonly [number, number, number];

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

export type Layer = "planet" | "world" | "space" | "cluster";

/** The scale ladder, bottom to top. `space` is the galaxy stop. */
export const LADDER: readonly Layer[] = ["world", "planet", "cluster", "space"];

/** Log-distance of each rest stop; thresholds between stops sit at x.5. */
export const STOP_L: Record<Layer, number> = { world: 0, planet: 1, cluster: 2, space: 3 };

/* ------------------------------------------------------------------ */
/* Vectors                                                             */
/* ------------------------------------------------------------------ */

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
export function scale(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k];
}
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function mixV(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
export function mixPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  return { position: mixV(a.position, b.position, t), target: mixV(a.target, b.target, t), fov: lerp(a.fov, b.fov, t) };
}
export function poseDistance(p: CameraPose): number {
  return length(sub(p.position, p.target));
}

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

export const PLANET = {
  radius: 1,
  seated: { position: [0, 0.62, 5.8] as Vec3, target: [0, 0, 0] as Vec3, fov: 26 },
  /** Unit direction of the active course marker on the visible face. */
  marker: norm([0.3, 0.34, 0.89]),
  /** Where the sky spiral sits, as yaw / pitch (radians) off the planet look direction. */
  skySlot: { yaw: 0.2, pitch: 0.125 },
  /** Sky spiral angular radius at rest and at the hit frame (radians). */
  skyBeta: { rest: 0.036, hit: 0.11 },
  /** FOV at the top of the planet band (L = 1.5), where the planet is a bead. */
  farFov: 30,
} as const;

/** Globe-side end of the dive: 0.55 R above the marker, looking at it (the CourseGlobe `diveCameraPosition` idea). */
export function planetDivePose(): CameraPose {
  return { position: scale(PLANET.marker, 1.55), target: scale(PLANET.marker, 1.0), fov: 22 };
}

export const WORLD = {
  arrival: { position: [0, 15, 30] as Vec3, target: [0, 1.5, 0] as Vec3, fov: 26 },
  diveFactor: 5.2,
  cloudHeight: 9,
  groundRadius: 16,
  propCount: 11,
} as const;

/** 5.2x above the arrival pose along the same forward vector (ice-town `divePose`). */
export function worldDivePose(): CameraPose {
  const dir = sub(WORLD.arrival.position, WORLD.arrival.target);
  return { position: add(WORLD.arrival.target, scale(dir, WORLD.diveFactor)), target: WORLD.arrival.target, fov: 22 };
}

const GALAXY_R = 60;
const GALAXY_D = GALAXY_R / Math.tan(PLANET.skyBeta.hit);

export const SPACE = {
  galaxyRadius: GALAXY_R,
  /** Galaxy centre; the hit-frame camera at the origin sees it at exactly `skyBeta.hit`. */
  galaxy: [0, 0, -GALAXY_D] as Vec3,
  hit: { position: [0, 0, 0] as Vec3, target: [0, 0, -GALAXY_D] as Vec3, fov: 40 },
  arrivalDistance: GALAXY_R * 3,
  dotCount: 24,
  /** Course-cluster beads on the arms (bead 0 is ours). */
  beadCount: 8,
  /** Bead sprite world radius and its size at the galaxy rest / the match cut (cells). */
  beadRadius: 0.5,
  beadCells: 3,
  /** FOV at the bottom of the galaxy band (L = 2.5), looking at the bead. */
  nearFov: 40,
} as const;

/** Orbited 4 degrees into the disc, 3 R out, the wider space FOV. */
export function spaceArrivalPose(): CameraPose {
  const yaw = (4 * Math.PI) / 180;
  const d = SPACE.arrivalDistance;
  return { position: add(SPACE.galaxy, [Math.sin(yaw) * d, d * 0.06, Math.cos(yaw) * d]), target: SPACE.galaxy, fov: 34 };
}

/** Default bead (our course) for tests and before the runtime reports the real arm position. */
export const DEFAULT_BEAD: Vec3 = add(SPACE.galaxy, [SPACE.galaxyRadius * 0.62, 0, SPACE.galaxyRadius * 0.1]);

export const CLUSTER = {
  /** Concept-star spread radius; the constellation lives inside it. */
  radius: 10,
  /** Core star world radius (grows from 3 cells at the hit to ~8 at rest). */
  coreRadius: 0.4,
  /** Fixed view direction, a little above the constellation plane. */
  viewDir: norm([0.18, 0.42, 0.89]),
  restDistance: 68,
  restFov: 30,
  inFov: 30,
  outFov: 40,
  /** 18..30 concept stars per cluster. */
  stars: { min: 18, max: 30 },
  /** The whole cluster collapses to this many cells at the galaxy threshold. */
  beadCells: 3,
} as const;

/* ------------------------------------------------------------------ */
/* Match-cut sizes                                                     */
/* ------------------------------------------------------------------ */

/** Reference pixel-pass height in cells (720 CSS px at a 2 px cell). Both sides of a match use the same reference. */
export const REF_CELLS = 360;

/** Diameter in cells of a world radius `r` seen at `distance` with vertical `fovDeg`. */
export function cellsFor(r: number, distance: number, fovDeg: number, refCells = REF_CELLS): number {
  const p11 = 1 / Math.tan((fovDeg * Math.PI) / 360);
  return (r * p11 * refCells) / distance;
}

/** Distance at which a world radius `r` spans `cells` cells at `fovDeg`. */
export function distanceForCells(r: number, cells: number, fovDeg: number, refCells = REF_CELLS): number {
  const p11 = 1 / Math.tan((fovDeg * Math.PI) / 360);
  return (r * p11 * refCells) / cells;
}

/** Planet seen as a 3-cell bead (top of the planet band). */
export const PLANET_FAR = distanceForCells(PLANET.radius, CLUSTER.beadCells, PLANET.farFov);
/** Core star at 3 cells (bottom of the cluster band): matches the planet bead. */
export const CLUSTER_IN = distanceForCells(CLUSTER.coreRadius, CLUSTER.beadCells, CLUSTER.inFov);
/** Whole constellation at 3 cells (top of the cluster band). */
export const CLUSTER_OUT = distanceForCells(CLUSTER.radius, CLUSTER.beadCells, CLUSTER.outFov);
/** Arm bead at 3 cells (bottom of the galaxy band): matches the collapsed cluster. */
export const GALAXY_NEAR = distanceForCells(SPACE.beadRadius, SPACE.beadCells, SPACE.nearFov);

export function clusterRestPose(): CameraPose {
  return { position: scale(CLUSTER.viewDir, CLUSTER.restDistance), target: [0, 0, 0], fov: CLUSTER.restFov };
}

export const REST: Record<Layer, CameraPose> = {
  planet: PLANET.seated,
  world: WORLD.arrival,
  space: spaceArrivalPose(),
  cluster: clusterRestPose(),
};
