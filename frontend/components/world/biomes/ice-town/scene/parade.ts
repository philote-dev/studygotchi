import { CREATURE_DISPLAY_HEIGHT } from "@/lib/world/creature-scale";
import {
  ICE_TOWN_LAYOUT,
  type BiomeLayout,
  type IceDistrictKind,
} from "../layout/biome-layout";
import { anchorPoint, sampleTerrain } from "../layout/terrain";
import {
  type ColliderSet,
  openDirection,
  penetrationDepth,
  resolveCircle,
  separateCircles,
  steerAround,
  sweepCircle,
} from "../../collision/colliders";

/** Half-extent of the district landmark/building the walkers must stay outside. */
export const LANDMARK_FOOTPRINT_M: Record<IceDistrictKind, number> = {
  harbour: 6.5,
  town: 5.2,
  lake: 8,
  forest: 7.5,
  glacier: 7,
  station: 6,
};

/** Extra metres past the footprint so bodies clear walls, gantries, and plaza trees. */
export const PARADE_CLEARANCE_M = 5.5;

export const WALKER_DISTRICTS: readonly IceDistrictKind[] = [
  "harbour",
  "harbour",
  "town",
  "town",
  "lake",
  "forest",
  "forest",
  "glacier",
  "station",
];

/**
 * Mesh is 0.82 m; ice-town metres are larger. 4.9 puts a buddy at 4.0 m, under the 4.5–6 m houses
 * and ≥ 6 % of the viewport at the harbour district station (the scale rule; see the test).
 */
export const ICE_LAND_SCALE = 4.9;

/** Body radius for a creature drawn at `scale`: the roster bodies are ~0.45 × height wide. */
export function walkerRadius(scale: number): number {
  return CREATURE_DISPLAY_HEIGHT * scale * 0.225;
}

/** ≈ 0.9 m for the Ice cast. */
export const WALKER_RADIUS_M = walkerRadius(ICE_LAND_SCALE);

/** Whisker length for `steerAround`: about two body lengths, enough to swing round a pine. */
export const STEER_LOOKAHEAD_M = 2.2;

/* ---------- tuning ---------- */

/** Chase speed over the ring's own linear speed, so a detour is made up instead of accumulating. */
const CHASE_FACTOR = 1.35;
/** Slow-in radius around the parade point so arrival eases rather than overshoots. */
const ARRIVE_M = 1.5;
/** Heading ease (1/s): a creature turns, it does not snap. */
const TURN_RATE = 6;
/** Speed ease (1/s). */
const ACCEL_RATE = 5;
/** Below this ground speed while wanting to move counts as a stall. */
const STALL_SPEED = 0.15;
/** Stalled this long: back out along the most open direction for `ESCAPE_S`. */
const STALL_ESCAPE_S = 0.5;
const ESCAPE_S = 1.0;
/** Stalled this long: the ring target fast-forwards so it comes out from behind the obstacle. */
const STALL_FASTFORWARD_S = 0.8;
/** Boxed in this long: step to the next free ring point (never expected on the authored land). */
const STALL_RELOCATE_S = 3;
/** Safety-pass iterations after separation. */
const RESOLVE_ITERATIONS = 4;
const MAX_DT = 0.1;

export function paradeRadius(districtId: IceDistrictKind): number {
  return LANDMARK_FOOTPRINT_M[districtId] + PARADE_CLEARANCE_M;
}

export function isParadeLand(layout: BiomeLayout, x: number, z: number): boolean {
  const sample = sampleTerrain(layout, x, z);
  return sample.material !== "sea" && sample.height >= layout.seaLevel - 0.08;
}

/** Point on a ring around the district landmark, snapped onto land if the ring hits water. */
export function paradePoint(
  layout: BiomeLayout,
  districtId: IceDistrictKind,
  angle: number,
): { x: number; z: number } {
  const district = layout.districts.find((entry) => entry.id === districtId) ?? layout.districts[0];
  const [cx, cz] = anchorPoint(layout, district);
  const radius = paradeRadius(districtId);
  const minRadius = LANDMARK_FOOTPRINT_M[districtId] + 4;
  const tries = [0, 0.14, -0.14, 0.28, -0.28, 0.45, -0.45, 0.7, -0.7, 1.05, -1.05, Math.PI];
  for (const delta of tries) {
    for (const scale of [1, 1.12, 1.24, 0.94]) {
      const r = radius * scale;
      if (r < minRadius) continue;
      const a = angle + delta;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (isParadeLand(layout, x, z)) return { x, z };
    }
  }
  return { x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius };
}

export function paradeAnchor(layout: BiomeLayout, districtId: IceDistrictKind): [number, number] {
  const district = layout.districts.find((entry) => entry.id === districtId) ?? ICE_TOWN_LAYOUT.districts[0];
  return anchorPoint(layout, district);
}

/* ---------- cached terrain lookups ---------- */

/**
 * `sampleTerrain` costs ~16 µs and `paradePoint` up to ~150 µs where a ring snaps through
 * water, so the simulation reads both through caches keyed on quantised inputs: ring points
 * per 0.5° cell, land-ness per 0.5 m cell. Pure functions of the cell, so still deterministic.
 */
const PARADE_CELL = Math.PI / 360;
const PARADE_CELLS = 720;
const LAND_CELL = 0.5;
const LAND_OFFSET = 1 << 16;
const LAND_STRIDE = 1 << 17;

const paradeCache = new WeakMap<BiomeLayout, Map<string, Map<number, { x: number; z: number }>>>();
const landCache = new WeakMap<BiomeLayout, Map<number, boolean>>();

/** `paradePoint` on a 0.5° ring grid (the target hops ≤ 0.1 m; the body eases over it). */
export function paradePointCached(layout: BiomeLayout, districtId: IceDistrictKind, angle: number): { x: number; z: number } {
  let byDistrict = paradeCache.get(layout);
  if (!byDistrict) {
    byDistrict = new Map();
    paradeCache.set(layout, byDistrict);
  }
  let ring = byDistrict.get(districtId);
  if (!ring) {
    ring = new Map();
    byDistrict.set(districtId, ring);
  }
  const cell = ((Math.round(angle / PARADE_CELL) % PARADE_CELLS) + PARADE_CELLS) % PARADE_CELLS;
  let point = ring.get(cell);
  if (!point) {
    point = paradePoint(layout, districtId, cell * PARADE_CELL);
    ring.set(cell, point);
  }
  return point;
}

/**
 * Whether a whole 0.5 m cell is parade land. Cells well above the water on snow or rock pass on
 * their centre sample; cells near the waterline or on the glacier shelf (whose Worley seams are
 * ≥ 0.36 m cracks down to the sea) must pass a 3 × 3 stencil at 0.25 m pitch, so the cached
 * answer is conservative: never "land" where `isParadeLand` would say sea.
 */
function cellIsParadeLand(layout: BiomeLayout, cx: number, cz: number): boolean {
  const centre = sampleTerrain(layout, cx, cz);
  if (centre.material === "sea" || centre.height < layout.seaLevel - 0.08) return false;
  if (centre.material !== "ice" && centre.height >= layout.seaLevel + 1.0) return true;
  const h = LAND_CELL / 2;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;
      if (!isParadeLand(layout, cx + i * h, cz + j * h)) return false;
    }
  }
  return true;
}

/** `isParadeLand` over 0.5 m cells (see `cellIsParadeLand`). */
export function isParadeLandCached(layout: BiomeLayout, x: number, z: number): boolean {
  let grid = landCache.get(layout);
  if (!grid) {
    grid = new Map();
    landCache.set(layout, grid);
  }
  const ix = Math.round(x / LAND_CELL);
  const iz = Math.round(z / LAND_CELL);
  const key = (ix + LAND_OFFSET) * LAND_STRIDE + (iz + LAND_OFFSET);
  let land = grid.get(key);
  if (land === undefined) {
    land = cellIsParadeLand(layout, ix * LAND_CELL, iz * LAND_CELL);
    grid.set(key, land);
  }
  return land;
}

/* ---------- walker simulation ---------- */

/** One parading creature: a circle in XZ chasing a point that slides round its district ring. */
export interface WalkerBody {
  index: number;
  district: IceDistrictKind;
  /** Ring direction. */
  dir: 1 | -1;
  /** Ring angular speed, rad/s. */
  omega: number;
  /** Ring angle of the parade point being chased. */
  angle: number;
  x: number;
  z: number;
  /** Facing, atan2(dz, dx), eased. */
  heading: number;
  /** Ground speed, m/s, eased. */
  speed: number;
  /** `steerAround` hysteresis. */
  side: -1 | 0 | 1;
  /** Seconds spent wanting to move but not moving. */
  stall: number;
  /** Seconds left of backing out along the most open direction (0 when steering normally). */
  escape: number;
  /** Metres actually walked (sweep moves only; separation and safety pushes do not count). */
  travelled: number;
  /** Whether the body wants to walk (drives the walk clip). */
  moving: boolean;
  /** Whether the last step touched a collider or the shore. */
  blocked: boolean;
  r: number;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Ease `from` toward `to` along the shortest arc. */
function approachAngle(from: number, to: number, k: number): number {
  return wrapAngle(from + wrapAngle(to - from) * k);
}

/** Axis-separated slide along the shore grid; null when neither axis component lands on land. */
function slideAlongShore(layout: BiomeLayout, set: ColliderSet, x: number, z: number, toX: number, toZ: number, r: number): { x: number; z: number } | null {
  for (const [tx, tz] of [
    [toX, z],
    [x, toZ],
  ]) {
    if (Math.abs(tx - x) + Math.abs(tz - z) < 1e-9) continue;
    const slid = sweepCircle(set, x, z, tx, tz, r);
    if (isParadeLandCached(layout, slid.x, slid.z)) return { x: slid.x, z: slid.z };
  }
  return null;
}

/** Walker speeds as the original parade: 0.22–0.30 rad/s, alternating direction by index. */
function ringMotion(index: number): { dir: 1 | -1; omega: number } {
  return { dir: index % 2 === 0 ? 1 : -1, omega: 0.22 + (index % 3) * 0.04 };
}

/** First ring angle at or after `angle` whose parade point is clear of the colliders. */
function freeParadeAngle(layout: BiomeLayout, district: IceDistrictKind, angle: number, dir: number, set: ColliderSet, r: number): { angle: number; x: number; z: number } {
  let a = angle;
  let point = paradePointCached(layout, district, a);
  for (let i = 0; i < 80; i++) {
    const safe = resolveCircle(set, point.x, point.z, r, 6);
    if (penetrationDepth(set, safe.x, safe.z, r) < 1e-6 && isParadeLandCached(layout, safe.x, safe.z)) {
      return { angle: a, x: safe.x, z: safe.z };
    }
    a += 0.12 * dir;
    point = paradePointCached(layout, district, a);
  }
  return { angle: a, ...point };
}

/**
 * Walkers at their first clear ring points. `districts[i]` is walker i's district (the Ice cast
 * order); `count` lets a partial cast (progress < 75 %) run with the same indices.
 */
export function createWalkers(
  layout: BiomeLayout,
  set: ColliderSet,
  districts: readonly IceDistrictKind[] = WALKER_DISTRICTS,
  count = districts.length,
  r = WALKER_RADIUS_M,
): WalkerBody[] {
  const out: WalkerBody[] = [];
  for (let index = 0; index < Math.min(count, districts.length); index++) {
    out.push(createWalker(layout, set, districts, index, r));
  }
  return out;
}

export function createWalker(layout: BiomeLayout, set: ColliderSet, districts: readonly IceDistrictKind[], index: number, r = WALKER_RADIUS_M): WalkerBody {
  const district = districts[index];
  const { dir, omega } = ringMotion(index);
  const start = index * 0.85 + WALKER_DISTRICTS.indexOf(district) * 0.4;
  const free = freeParadeAngle(layout, district, start, dir, set, r);
  const ahead = paradePointCached(layout, district, free.angle + 0.05 * dir);
  return {
    index,
    district,
    dir,
    omega,
    angle: free.angle,
    x: free.x,
    z: free.z,
    heading: Math.atan2(ahead.z - free.z, ahead.x - free.x),
    speed: 0,
    side: 0,
    stall: 0,
    escape: 0,
    travelled: 0,
    moving: true,
    blocked: false,
    r,
  };
}

/**
 * Separation and the safety push only (no walking): keeps standing or dismantled residents out
 * of each other and out of any collider that appears around them.
 */
export function settleWalkers(layout: BiomeLayout, walkers: WalkerBody[], set: ColliderSet): void {
  separateCircles(walkers, WALKER_RADIUS_M);
  for (const w of walkers) {
    const safe = resolveCircle(set, w.x, w.z, w.r, RESOLVE_ITERATIONS);
    if (safe.hit && isParadeLandCached(layout, safe.x, safe.z)) {
      w.x = safe.x;
      w.z = safe.z;
    }
  }
}

/**
 * One fixed step for every walker. Per body: the ring angle advances as the original parade did
 * (fast-forwarding while stalled so the target comes round the obstacle); the body steers toward
 * its parade point with three whiskers, eases its heading and speed, sweeps its circle through
 * the colliders (sliding, no tunnelling), refuses steps into the sea, then all bodies are pushed
 * apart and given a final push out of any collider. Deterministic: no randomness, no clock.
 */
export function stepWalkers(layout: BiomeLayout, walkers: WalkerBody[], set: ColliderSet, dtRaw: number): void {
  const dt = Math.min(MAX_DT, Math.max(0, dtRaw));
  if (dt <= 0) return;
  const turnK = 1 - Math.exp(-dt * TURN_RATE);
  const accelK = 1 - Math.exp(-dt * ACCEL_RATE);
  const shore = (x: number, z: number) => !isParadeLandCached(layout, x, z);

  for (const w of walkers) {
    const fastForward = w.stall > STALL_FASTFORWARD_S ? 3 : 1;
    w.angle += dt * w.omega * w.dir * fastForward;
    const target = paradePointCached(layout, w.district, w.angle);
    const dx = target.x - w.x;
    const dz = target.z - w.z;
    const dist = Math.hypot(dx, dz);
    const maxSpeed = CHASE_FACTOR * w.omega * paradeRadius(w.district);
    const goal = dist < 0.05 ? 0 : maxSpeed * Math.min(1, dist / ARRIVE_M);
    const desired = dist > 1e-6 ? Math.atan2(dz, dx) : w.heading;

    const steer = steerAround(set, w.x, w.z, desired, w.r, STEER_LOOKAHEAD_M, w.side, shore);
    w.side = steer.side;
    w.blocked = steer.blocked;
    let aim = steer.heading;
    let want = goal;
    if (w.escape <= 0 && w.stall > STALL_ESCAPE_S) w.escape = ESCAPE_S;
    if (w.escape > 0) {
      // Pocket: commit to the most open way out for a moment, then steer normally again.
      const out = openDirection(set, w.x, w.z, w.r, STEER_LOOKAHEAD_M, desired, shore);
      aim = out.heading;
      want = out.free > w.r ? maxSpeed * 0.7 : 0;
      w.escape -= dt;
    }
    w.heading = approachAngle(w.heading, aim, turnK);
    w.speed += (want - w.speed) * accelK;
    w.moving = want > 0.2;

    const step = w.speed * dt;
    let walked = 0;
    if (step > 1e-6) {
      const moved = sweepCircle(set, w.x, w.z, w.x + Math.cos(w.heading) * step, w.z + Math.sin(w.heading) * step, w.r);
      // The shore is not a collider: a step into the sea slides along the land grid (x-only,
      // then z-only, each re-swept so the slide cannot enter a collider) before being refused.
      const landing = isParadeLandCached(layout, moved.x, moved.z)
        ? moved
        : slideAlongShore(layout, set, w.x, w.z, moved.x, moved.z, w.r);
      if (landing) {
        walked = Math.hypot(landing.x - w.x, landing.z - w.z);
        w.x = landing.x;
        w.z = landing.z;
        if (moved.hit || landing !== moved) w.blocked = true;
      } else {
        w.blocked = true;
        w.speed *= 0.5;
      }
    }
    w.travelled += walked;
    if (goal > 0.3 && walked / dt < STALL_SPEED) w.stall += dt;
    else w.stall = 0;
  }

  separateCircles(walkers, WALKER_RADIUS_M);

  for (const w of walkers) {
    const safe = resolveCircle(set, w.x, w.z, w.r, RESOLVE_ITERATIONS);
    if (safe.hit && isParadeLandCached(layout, safe.x, safe.z)) {
      w.x = safe.x;
      w.z = safe.z;
    }
    if (w.stall > STALL_RELOCATE_S) {
      // Boxed in: advance the ring angle until a clear point exists and step there.
      const free = freeParadeAngle(layout, w.district, w.angle + 0.3 * w.dir, w.dir, set, w.r);
      w.angle = free.angle;
      w.x = free.x;
      w.z = free.z;
      w.stall = 0;
      w.escape = 0;
      w.speed = 0;
      w.side = 0;
    }
  }
}
