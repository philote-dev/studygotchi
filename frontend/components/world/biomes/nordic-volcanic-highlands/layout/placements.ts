/**
 * Placement data for everything that stands on the highlands: the district tables the scene
 * renders from, and the same tables turned into ground-plane colliders (shared collision API)
 * so the walkers steer round exactly what is drawn. Local district coordinates become world
 * coordinates with the three.js convention `world = centre + R(yaw) · local`.
 */
import type { Collider } from '../../collision/colliders'
import { NORDIC_PALETTE as P, type BiomeLayout, type DistrictProgress, type GeneratedDistrict, generateDistricts, populationFor, seeded } from './biome-layout'

export type Vec3 = [number, number, number]

/* ---------- houses ---------- */

export interface HouseSpec {
  p: Vec3
  yaw: number
  c: string
  w: number
  roof: string
  height?: number
}

export interface PlacedHouse extends HouseSpec {
  height: number
}

export const VILLAGE_HOMES: readonly HouseSpec[] = [
  { p: [7, 0.4, -10], yaw: -0.12, c: P.red, w: 1.15, roof: P.turf },
  { p: [-1, 0.8, -8], yaw: 0.18, c: P.cream, w: 0.9, roof: '#455b3d' },
  { p: [-10, 1.4, -5], yaw: -0.2, c: P.ochre, w: 1.05, roof: P.turf },
  { p: [4, 0.7, 2], yaw: 0.12, c: '#b84d3f', w: 0.85, roof: '#455b3d' },
  { p: [-5, 1.4, 5], yaw: -0.08, c: P.cream, w: 1.25, roof: P.turf },
  { p: [-15, 2.1, 5], yaw: 0.25, c: '#d09a43', w: 0.8, roof: '#4c613e' },
  { p: [2, 1.4, 12], yaw: -0.28, c: '#a94138', w: 1.1, roof: P.turf },
  { p: [-9, 2.2, 14], yaw: 0.18, c: P.cream, w: 0.85, roof: '#40573c' },
  { p: [-18, 2.9, 13], yaw: -0.12, c: P.red, w: 1.3, roof: P.turf },
  { p: [-3, 2.5, 21], yaw: 0.22, c: P.ochre, w: 0.9, roof: '#40573c' },
  { p: [-14, 3.2, 23], yaw: -0.22, c: P.cream, w: 1.05, roof: P.turf },
]

/** Fixed village buildings (the quay's boathouses). */
export const VILLAGE_ANCHORS: readonly PlacedHouse[] = [
  { p: [16, 0.3, -7], yaw: 0.08, c: P.ochre, w: 1.35, roof: '#3f4d3b', height: 3.1 },
  { p: [24, 0.2, 7], yaw: -0.08, c: '#a74235', w: 0.9, roof: '#38473a', height: 2.8 },
]

/** Village homes with the seeded jitter the scene draws (same rng call order as before). */
export function villageHomes(seed: number, count: number): PlacedHouse[] {
  const rng = seeded(seed * 73 + 1)
  return VILLAGE_HOMES.slice(0, count).map((home, i) => {
    const x = home.p[0] + (rng() - 0.5) * 1.2
    const z = home.p[2] + (rng() - 0.5) * 1.2
    const yaw = home.yaw + (rng() - 0.5) * 0.12
    return { ...home, p: [x, home.p[1], z], yaw, height: i % 4 === 0 ? 3.8 : 3.2 }
  })
}

export const HAMLET_HOMES: readonly HouseSpec[] = [
  { p: [-19, 0.3, -5], yaw: -0.28, c: P.red, w: 1.15, roof: '#40563b' },
  { p: [-10, 0.7, -1], yaw: -0.12, c: P.cream, w: 0.8, roof: P.turf },
  { p: [-1, 1.1, 2], yaw: 0.18, c: '#b54c3d', w: 1.05, roof: '#40563b' },
  { p: [9, 1.6, 4], yaw: -0.16, c: P.cream, w: 0.85, roof: P.turf },
  { p: [18, 2.1, 7], yaw: 0.24, c: P.ochre, w: 1.1, roof: '#465c40' },
  { p: [-14, 1.2, 10], yaw: 0.22, c: P.cream, w: 0.95, roof: P.turf },
  { p: [-4, 1.7, 13], yaw: -0.25, c: P.red, w: 0.8, roof: '#40563b' },
  { p: [7, 2.3, 15], yaw: 0.15, c: P.cream, w: 1.2, roof: P.turf },
  { p: [18, 2.8, 18], yaw: -0.18, c: '#a94439', w: 0.85, roof: '#40563b' },
  { p: [-4, 2.8, 23], yaw: 0.2, c: P.ochre, w: 1, roof: P.turf },
]

export const HAMLET_HALLS: readonly PlacedHouse[] = [
  { p: [-10, 0.6, -12], yaw: -0.24, c: '#9e463c', w: 1.8, roof: P.turf, height: 4.2 },
  { p: [7, 1.1, -10], yaw: 0.28, c: '#6f5545', w: 1.55, roof: '#455e3f', height: 4 },
]

export function hamletHomes(seed: number, count: number): PlacedHouse[] {
  const rng = seeded(seed * 53 + 9)
  return HAMLET_HOMES.slice(0, count).map((home, i) => {
    const x = home.p[0] + (rng() - 0.5) * 1.2
    const z = home.p[2] + (rng() - 0.5) * 1.2
    const yaw = home.yaw + (rng() - 0.5) * 0.12
    return { ...home, p: [x, home.p[1], z], yaw, height: i % 3 === 0 ? 3.6 : 3 }
  })
}

/** Dry-stone walls of the hamlet: beam segments a → b (local). */
export const HAMLET_WALLS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [-25, 0.6, -18, -6, 1.3, -17], [-6, 1.3, -17, 15, 1.5, -15],
  [15, 1.5, -15, 28, 2.2, -9], [-27, 0.8, 18, -10, 2, 27],
]
export const HAMLET_ROCKS: ReadonlyArray<Vec3> = [[-24, 1.5, 9], [25, 2.2, 12], [24, 1.8, -2]]
export const HAMLET_SHEEP = Array.from({ length: 6 }, (_, i) => [-20 + (i % 3) * 6, 1, 20 + Math.floor(i / 3) * 5] as Vec3)

/* ---------- canyon ---------- */

/** [x, y, z, radius, height] */
export const CANYON_COLUMNS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [-18, 5.5, -12, 4.8, 10], [-13, 7, -13, 4.5, 13], [-8, 5.8, -14, 4.6, 10],
  [9, 6.2, -14, 4.8, 11], [14, 8, -13, 4.7, 15], [19, 5.5, -11, 4.5, 10],
  [-20, 4.6, -3, 4.2, 8], [-15, 5.7, 2, 4.2, 10], [15, 5.4, 1, 4.3, 9], [21, 4.3, -3, 4, 7],
]
export const CANYON_HOUSES: ReadonlyArray<PlacedHouse & { minCount: number }> = [
  { p: [20, 0.2, 14], yaw: -0.2, c: '#74534a', w: 0.9, roof: '#30383a', height: 2.9, minCount: 3 },
  { p: [23, 0.2, 6], yaw: 0.28, c: '#5c5654', w: 0.75, roof: '#343b3b', height: 2.7, minCount: 6 },
]

/* ---------- geothermal ---------- */

/** [x, z, radius, sx, sz, rotation] */
export const GEOTHERMAL_POOLS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [-11, -12, 5.8, 1.25, 0.84, -0.12], [2, -15, 4.8, 1.1, 0.8, 0.18], [12, -10, 4.2, 1.25, 0.76, -0.3],
]
/** [x, z, sx, sz, rotation, colour] */
export const GEOTHERMAL_PLOTS: ReadonlyArray<readonly [number, number, number, number, number, string]> = [
  [-13, 13, 5.5, 9, -0.18, '#4f6248'], [-3, 15, 6.5, 10, 0.12, '#65724f'],
  [8, 14, 5.5, 8, -0.1, '#465d47'], [17, 11, 5, 7, 0.25, '#68764f'],
]
export const GEOTHERMAL_HOUSES: ReadonlyArray<PlacedHouse & { minCount: number }> = [
  { p: [-20, 0.2, 4], yaw: -0.2, c: P.red, w: 1.05, roof: '#465b40', height: 3.4, minCount: 1 },
  { p: [24, 0.5, 13], yaw: 0.25, c: P.cream, w: 0.9, roof: P.turf, height: 3.4, minCount: 4 },
  { p: [-21, 0.5, 15], yaw: 0.12, c: P.ochre, w: 0.8, roof: '#40553c', height: 2.8, minCount: 7 },
]
export const TRIPOD_FEET: ReadonlyArray<Vec3> = [[-4, 0, -10], [5, 0, -10], [0, 0, -2]]

/* ---------- archipelago (boat-only; colliders for completeness) ---------- */

export const ARCHIPELAGO_HOUSES: ReadonlyArray<PlacedHouse & { minCount: number }> = [
  { p: [87, 10.2, 78], yaw: 0.2, c: '#5b5554', w: 0.8, roof: '#2c3536', height: 2.8, minCount: 1 },
  { p: [46, 9.4, 58], yaw: -0.45, c: '#6e4a3f', w: 0.68, roof: '#30383a', height: 2.5, minCount: 2 },
]

/* ---------- fixed ground ---------- */

export const RELIEF: ReadonlyArray<{ p: Vec3; s: Vec3; c: string; r: number }> = [
  { p: [-174, 4.1, -105], s: [30, 2.2, 21], c: '#5d6c52', r: 0.2 },
  { p: [-79, 4.4, -99], s: [24, 2.8, 17], c: '#637256', r: 0.7 },
  { p: [-145, 4.1, 54], s: [28, 2.1, 22], c: '#71805e', r: 0.1 },
  { p: [-71, 4.2, 111], s: [20, 2.1, 16], c: '#5f7054', r: 0.5 },
  { p: [112, 4.4, -117], s: [26, 2.6, 18], c: '#59664f', r: 0.35 },
  { p: [145, 4.2, 20], s: [24, 2.1, 19], c: '#71805f', r: 0.6 },
  { p: [143, 4.1, 115], s: [32, 2.4, 18], c: '#5f6e54', r: -0.2 },
]
/** [x, y, z, sx, sy, sz, rotation] */
export const ROCKS: ReadonlyArray<readonly [number, number, number, number, number, number, number]> = [
  [-151, 6.1, -26, 3.2, 1.8, 2.5, 0.2], [-137, 5.6, -18, 1.8, 1.1, 1.5, 0.8],
  [-93, 5.7, 93, 2.4, 1.3, 1.8, 0.5], [-119, 5.5, 111, 1.6, 1, 1.4, 1.1],
  [-66, 5.8, -117, 2.5, 1.5, 2, 0.4], [-45, 5.3, -109, 1.5, 0.8, 1.2, 0.9],
  [105, 5.9, 26, 2.7, 1.5, 2.1, 0.7], [134, 5.4, 38, 1.5, 0.9, 1.4, 0.2],
  [98, 5.6, 124, 2.1, 1.2, 1.8, 0.9], [150, 6.2, 102, 3.5, 1.7, 2.2, 0.3],
]
/** [x, z, sx, sz, colour] flat heather patches (no collider). */
export const HEATHER: ReadonlyArray<readonly [number, number, number, number, string]> = [
  [-162, -54, 10, 6, '#6a655f'], [-112, 4, 12, 7, '#7b6b67'], [-92, 118, 10, 6, '#6d665d'],
  [-57, 73, 8, 5, '#88906d'], [87, -83, 11, 6, '#7a6c68'], [127, 41, 9, 5, '#6f6662'],
  [142, 131, 13, 7, '#79816a'], [34, -105, 9, 5, '#596850'],
]

/* ---------- world transform ---------- */

export interface Frame {
  x: number
  z: number
  yaw: number
}

export function districtFrame(district: GeneratedDistrict): Frame {
  return { x: district.center[0], z: district.center[1], yaw: (district.yawDeg * Math.PI) / 180 }
}

/** `world = centre + R(yaw) · local` (three.js `rotation.y`). */
export function toWorld(frame: Frame, lx: number, lz: number): [number, number] {
  const cs = Math.cos(frame.yaw)
  const sn = Math.sin(frame.yaw)
  return [frame.x + lx * cs + lz * sn, frame.z - lx * sn + lz * cs]
}

/* ---------- colliders ---------- */

export type PlacementKind =
  | 'house'
  | 'hall'
  | 'dock'
  | 'column'
  | 'rock'
  | 'pool'
  | 'plot'
  | 'wall'
  | 'fence'
  | 'sheep'
  | 'post'
  | 'cart'
  | 'pipe'
  | 'adit'
  | 'forge'
  | 'greenhouse'
  | 'platform'
  | 'relief'

export type Placed = Collider & { tag: PlacementKind; id: string }

function house(frame: Frame, h: PlacedHouse, tag: 'house' | 'hall', id: string): Placed {
  const [x, z] = toWorld(frame, h.p[0], h.p[2])
  // Base slab: (5·w + 0.5) along local x by 4.5 along local z.
  return { kind: 'box', x, z, hx: (5 * h.w + 0.5) / 2, hz: 2.25, yaw: frame.yaw + h.yaw, tag, id }
}

function box(frame: Frame, lx: number, lz: number, sx: number, sz: number, yaw: number, tag: PlacementKind, id: string): Placed {
  const [x, z] = toWorld(frame, lx, lz)
  return { kind: 'box', x, z, hx: sx / 2, hz: sz / 2, yaw: frame.yaw + yaw, tag, id }
}

function circle(frame: Frame, lx: number, lz: number, r: number, tag: PlacementKind, id: string): Placed {
  const [x, z] = toWorld(frame, lx, lz)
  return { kind: 'circle', x, z, r, tag, id }
}

/** A beam a → b in the ground plane becomes a thin box along it. */
function segment(frame: Frame, ax: number, az: number, bx: number, bz: number, width: number, tag: PlacementKind, id: string): Placed {
  const mx = (ax + bx) / 2
  const mz = (az + bz) / 2
  const dx = bx - ax
  const dz = bz - az
  const length = Math.hypot(dx, dz)
  // Local +x along the segment: R(yaw)·(1,0) = (cos yaw, −sin yaw) must equal (dx, dz)/length.
  const yaw = Math.atan2(-dz, dx)
  return box(frame, mx, mz, length, width, yaw, tag, id)
}

const WORLD: Frame = { x: 0, z: 0, yaw: 0 }

export function villageColliders(district: GeneratedDistrict, count: number, seed: number): Placed[] {
  const f = districtFrame(district)
  const id = district.id
  const out: Placed[] = [
    box(f, 33, -1, 38, 4.2, 0, 'dock', `${id}:quay`),
    box(f, 49, -7, 4.2, 16, 0, 'dock', `${id}:quay-head`),
    box(f, 26, 6, 18, 3.2, 0, 'dock', `${id}:quay-south`),
  ]
  VILLAGE_ANCHORS.forEach((h, i) => out.push(house(f, h, 'hall', `${id}:boathouse-${i}`)))
  villageHomes(seed, count).forEach((h, i) => out.push(house(f, h, 'house', `${id}:home-${i}`)))
  if (count >= 6) out.push(segment(f, -22, 28, -2, 28, 0.4, 'fence', `${id}:rack`))
  return out
}

export function canyonColliders(district: GeneratedDistrict, count: number): Placed[] {
  const f = districtFrame(district)
  const id = district.id
  const out: Placed[] = []
  CANYON_COLUMNS.forEach(([x, , z, radius], i) => out.push(circle(f, x, z, radius * 0.93, 'column', `${id}:column-${i}`)))
  out.push(box(f, -10, -11.2, 8, 2.2, 0, 'adit', `${id}:adit`))
  out.push(circle(f, -17, 9, 0.5, 'post', `${id}:gantry-a`))
  out.push(circle(f, -7, 9, 0.5, 'post', `${id}:gantry-b`))
  out.push(box(f, 10, 10, 10, 7, 0, 'forge', `${id}:forge`))
  out.push(box(f, 0, 6, 3.4, 3, 0, 'cart', `${id}:cart`))
  CANYON_HOUSES.forEach((h, i) => {
    if (count >= h.minCount) out.push(house(f, h, 'house', `${id}:house-${i}`))
  })
  out.push(circle(f, 24, -16, 5.9, 'rock', `${id}:boulder-a`))
  out.push(circle(f, -25, 14, 5, 'rock', `${id}:boulder-b`))
  return out
}

export function hamletColliders(district: GeneratedDistrict, count: number, seed: number): Placed[] {
  const f = districtFrame(district)
  const id = district.id
  const out: Placed[] = []
  HAMLET_HALLS.forEach((h, i) => out.push(house(f, h, 'hall', `${id}:hall-${i}`)))
  hamletHomes(seed, count).forEach((h, i) => out.push(house(f, h, 'house', `${id}:home-${i}`)))
  HAMLET_WALLS.forEach(([ax, , az, bx, , bz], i) => out.push(segment(f, ax, az, bx, bz, 0.6, 'wall', `${id}:wall-${i}`)))
  if (count >= 5) {
    out.push(segment(f, -24, 30, 18, 30, 0.4, 'fence', `${id}:fence`))
    HAMLET_SHEEP.forEach(([x, , z], i) => out.push(circle(f, x, z, 1.05, 'sheep', `${id}:sheep-${i}`)))
  }
  HAMLET_ROCKS.forEach(([x, , z], i) => out.push(circle(f, x, z, 2, 'rock', `${id}:rock-${i}`)))
  return out
}

export function geothermalColliders(district: GeneratedDistrict, count: number): Placed[] {
  const f = districtFrame(district)
  const id = district.id
  const out: Placed[] = []
  GEOTHERMAL_POOLS.forEach(([x, z, r, sx, sz], i) => out.push(circle(f, x, z, (r + 0.7) * 1.15 * Math.max(sx, sz), 'pool', `${id}:pool-${i}`)))
  TRIPOD_FEET.forEach(([x, , z], i) => out.push(circle(f, x, z, 0.45, 'post', `${id}:tripod-${i}`)))
  GEOTHERMAL_PLOTS.forEach(([x, z, sx, sz, rotation], i) => out.push(box(f, x, z, sx, sz, rotation, 'plot', `${id}:plot-${i}`)))
  if (count >= 4) out.push(box(f, 17, 1, 10, 7, -0.22, 'greenhouse', `${id}:greenhouse`))
  GEOTHERMAL_HOUSES.forEach((h, i) => {
    if (count >= h.minCount) out.push(house(f, h, 'house', `${id}:house-${i}`))
  })
  out.push(segment(f, -11, -5, -9, 8, 0.4, 'pipe', `${id}:pipe-a`))
  out.push(segment(f, 2, -9, 9, 6, 0.4, 'pipe', `${id}:pipe-b`))
  out.push(box(f, 7, 6, 17, 0.7, 0, 'pipe', `${id}:main-pipe`))
  return out
}

export function archipelagoColliders(layout: BiomeLayout, district: GeneratedDistrict, count: number): Placed[] {
  const id = district.id
  const out: Placed[] = []
  layout.lavaBasin.islets.forEach((islet, i) => out.push(circle(WORLD, islet.center[0], islet.center[1], Math.max(islet.radii[0], islet.radii[1]) * 0.95, 'rock', `${id}:islet-${i}`)))
  ARCHIPELAGO_HOUSES.forEach((h, i) => {
    if (count >= h.minCount) out.push(house(WORLD, h, 'house', `${id}:shelter-${i}`))
  })
  if (count >= 4) out.push(circle(WORLD, 91, 70, 3.2, 'post', `${id}:beacon`))
  return out
}

export function landmarkColliders(layout: BiomeLayout): Placed[] {
  const [x, z] = layout.landmark.center
  const f: Frame = { x, z, yaw: (layout.landmark.yawDeg * Math.PI) / 180 }
  return [
    circle(f, 0, 0, 16.5, 'platform', 'landmark:headland'),
    circle(f, -9, 6, 7.6, 'rock', 'landmark:shoulder-a'),
    circle(f, 10, -5, 6.6, 'rock', 'landmark:shoulder-b'),
  ]
}

export function fixedColliders(): Placed[] {
  const out: Placed[] = []
  RELIEF.forEach((item, i) => out.push(circle(WORLD, item.p[0], item.p[2], ((item.s[0] + item.s[2]) / 2) * 0.86, 'relief', `relief-${i}`)))
  ROCKS.forEach(([x, , z, sx, , sz], i) => out.push(circle(WORLD, x, z, ((sx + sz) / 2) * 0.95, 'rock', `rock-${i}`)))
  return out
}

/** Every collider on the land for a seed and a progress map (what `Districts` draws for them). */
export function landColliders(layout: BiomeLayout, seed: number, progress: DistrictProgress): Placed[] {
  const out: Placed[] = [...fixedColliders(), ...landmarkColliders(layout)]
  for (const district of generateDistricts(layout, seed)) {
    const count = populationFor(district, progress[district.id] ?? 0).structures
    if (district.id === 'fjord-village') out.push(...villageColliders(district, count, seed))
    else if (district.id === 'basalt-canyon') out.push(...canyonColliders(district, count))
    else if (district.id === 'highland-hamlet') out.push(...hamletColliders(district, count, seed))
    else if (district.id === 'geothermal-farms') out.push(...geothermalColliders(district, count))
    else out.push(...archipelagoColliders(layout, district, count))
  }
  return out
}
