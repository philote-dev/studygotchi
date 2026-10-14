/**
 * Galaxy-rung scenery buffers, built by the SKY layer's own object builder
 * (`writeObjects`: the nebula, planetary shell, open cluster and lensed
 * smudge recipes, palettes and star sprinkles), so the scenery between the
 * clusters is drawn by the same code as the far backdrop.
 *
 * `writeObjects` lays objects on the camera's view plane from viewport
 * fractions (u right, v down) at a backdrop distance. The scenery lives in
 * the galaxy's PATTERN frame instead (disc radius 1, y up), so this module
 * inverts that mapping: each object gets the u, v and `size` that make the
 * builder's view-plane frame coincide with the disc plane once the renderer
 * seats the result under a group rotated -pi/2 about X and lifted by
 * `SCENERY_BUILD_DISTANCE` (`sceneryGroupTransform`). The quads then lie in
 * the disc like the beads and ride the arms.
 */
import type { PlacedObject, SkyPlacement } from "@/lib/stage/placement";
import type { GalaxyScenery } from "@/lib/stage/galaxy-scenery";
import type { StageTheme } from "../../lib/uniforms";
import { BACKDROP_DISTANCE, backdropDistance, unitsPerViewportHeight, viewHalfExtent } from "../../lib/view";
import { QUAD_CAPACITY, SkyPointWriter, writeObjects, type QuadInstances, type SkyPointBuffers } from "../sky/sky-build";

/** The builder's object depth: the middle of the backdrop band, a round number for the inverse. */
export const SCENERY_BUILD_DEPTH = 0.5;
export const SCENERY_BUILD_DISTANCE = backdropDistance(SCENERY_BUILD_DEPTH);
/** The fov the inverse mapping assumes (any value works as long as both directions share it). */
const BUILD_FOV_DEG = 40;
const BUILD_ASPECT = 1;

/** Same shape as the sky builder's private quad writer (it is not exported); `writeObjects` types it structurally. */
class SceneryQuadWriter {
  readonly matrices = new Float32Array(QUAD_CAPACITY * 16);
  readonly kind = new Float32Array(QUAD_CAPACITY);
  readonly params = new Float32Array(QUAD_CAPACITY * 4);
  readonly params2 = new Float32Array(QUAD_CAPACITY * 4);
  readonly c0 = new Float32Array(QUAD_CAPACITY * 3);
  readonly c1 = new Float32Array(QUAD_CAPACITY * 3);
  readonly c2 = new Float32Array(QUAD_CAPACITY * 3);
  readonly c3 = new Float32Array(QUAD_CAPACITY * 3);
  count = 0;

  push(matrix: Float32Array, kind: number, params: readonly number[], params2: readonly number[], colors: readonly [{ r: number; g: number; b: number }, { r: number; g: number; b: number }, { r: number; g: number; b: number }, { r: number; g: number; b: number }]): void {
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

/**
 * Where the renderer seats the built buffers inside the pattern group: the
 * builder put everything on the plane z = -distance in a camera frame
 * (x right, y up); rotating that frame -pi/2 about X maps (x, y, -d) to
 * (x, -d, -y), and lifting by d lands it on the disc plane as (x, 0, -y).
 */
export function sceneryGroupTransform(): { rotationX: number; position: [number, number, number] } {
  return { rotationX: -Math.PI / 2, position: [0, SCENERY_BUILD_DISTANCE, 0] };
}

/** The builder's `PlacedObject` for a scenery object: u, v, size so its view-plane frame is the disc-plane box. */
export function sceneryToPlacedObjects(scenery: GalaxyScenery): PlacedObject[] {
  const d = SCENERY_BUILD_DISTANCE;
  const { halfW, halfH } = viewHalfExtent(BUILD_FOV_DEG, BUILD_ASPECT, d);
  const perHeight = unitsPerViewportHeight(BUILD_FOV_DEG, d);
  return scenery.objects.map((o) => {
    // Disc (x, 0, z) <- builder (x, y = -z): see sceneryGroupTransform.
    const x = o.position[0];
    const y = -o.position[2];
    return {
      id: o.id,
      kind: o.kind,
      // The builder only reads geometry from this record; the rung is the galaxy's.
      rung: "backdrop",
      u: 0.5 + x / (2 * halfW),
      v: 0.5 - y / (2 * halfH),
      size: o.size / perHeight,
      aspect: o.aspect,
      rotation: o.rotation,
      depth: SCENERY_BUILD_DEPTH,
      seed: o.seed,
      variant: o.variant,
      edge: "centre",
    };
  });
}

export interface GalaxySceneryBuild {
  points: SkyPointBuffers;
  quads: QuadInstances;
  stats: { objects: number; points: number; quads: number; draws: number };
}

/** Draws the scenery issues per frame: one instanced quad draw and one points draw. */
export const GALAXY_SCENERY_DRAW_CALLS = 2;

export function buildGalaxyScenery(scenery: GalaxyScenery, theme: StageTheme): GalaxySceneryBuild {
  const points = new SkyPointWriter(400);
  const quads = new SceneryQuadWriter();
  const placement: SkyPlacement = {
    seed: scenery.seed,
    rung: "backdrop",
    aspect: BUILD_ASPECT,
    galaxy: { u: 0.5, v: 0.5, size: 0, tilt: 0, roll: 0, depth: 1, seed: 0 },
    objects: sceneryToPlacedObjects(scenery),
    safeAreas: [],
  };
  writeObjects(points, quads, { theme, fovDeg: BUILD_FOV_DEG, aspect: BUILD_ASPECT, placement });
  const p = points.finish();
  const q = quads.finish();
  return { points: p, quads: q, stats: { objects: scenery.objects.length, points: p.count, quads: q.count, draws: GALAXY_SCENERY_DRAW_CALLS } };
}

/** Sanity for tests: the build distance sits inside the backdrop band. */
export const SCENERY_BUILD_BAND = BACKDROP_DISTANCE;
