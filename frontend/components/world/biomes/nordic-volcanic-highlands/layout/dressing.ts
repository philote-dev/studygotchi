/**
 * The ambient layer that makes the land read as a place at 0 %: fences along fields, lamp-fires
 * at lane junctions, benches at viewpoints, boats on the shores, carts, banners, moss hummocks
 * and small tarns on the blank moor, and the chimney positions every house smokes from. Pure,
 * seeded placement; the scene instances each kind and the colliders come from the same list.
 */
import type { Collider } from '../../collision/colliders'
import { type BiomeLayout, type DistrictProgress, type GeneratedDistrict, type Point, generateDistricts, populationFor, seeded } from './biome-layout'
import { LANDMARKS } from './landmarks'
import {
  ARCHIPELAGO_HOUSES,
  CANYON_HOUSES,
  GEOTHERMAL_HOUSES,
  HAMLET_HALLS,
  type Frame,
  type PlacedHouse,
  VILLAGE_ANCHORS,
  districtFrame,
  hamletHomes,
  landColliders,
  toWorld,
  villageHomes,
} from './placements'
import { LANES, PATH_NODES, sampleLane } from './paths'
import { isLandAt } from './terrain'

export type DressingKind = 'fence' | 'brazier' | 'bench' | 'boat' | 'cart' | 'banner' | 'hummock' | 'tarn' | 'post'

export interface Dressing {
  kind: DressingKind
  x: number
  z: number
  yaw: number
  /** Length (fences, benches), radius (hummocks, tarns) or scale (boats, carts). */
  size: number
  /** Extra height / brightness jitter 0..1. */
  k: number
}

/* ---------- fixed pieces ---------- */

/** Fence runs: [x, z, yaw, length]. Fields beside the lanes and the sheep country. */
const FENCES: ReadonlyArray<readonly [number, number, number, number]> = [
  [-140, -22, 0.35, 16],
  [-84, 60, -0.2, 18],
  [-64, -2, 1.2, 16],
  [-150, -80, 0.9, 14],
  [-80, -50, -0.3, 12],
  [112, 30, 0.6, 20],
  [146, 86, 1.3, 16],
  [84, -42, -0.4, 16],
  [118, 134, 0.1, 22],
  [-52, 128, 0.2, 12],
]

/** Lamp-fires at lane junctions and gates: [x, z]. */
const BRAZIERS: ReadonlyArray<Point> = [
  [-119, 32],
  [-70, -11],
  [-96, 7],
  [-117, -45],
  [-48, -41],
  [-131, -113],
  [-63, -103],
  [-85, 75],
  [-122, 105],
  [59, 7],
  [101, 10],
  [100, -55],
  [128, 57],
  [10, 85],
  [44, 33],
  [-141, 26],
]

/** Benches at viewpoints: [x, z, yaw]. */
const BENCHES: ReadonlyArray<readonly [number, number, number]> = [
  [-46, 114, 0.4],
  [46, 36, -1.1],
  [-66, -100, 1.6],
  [-128, -102, 0.2],
  [124, 60, -0.6],
  [-150, 28, 2.4],
  [14, 90, -1.4],
]

/** Boats drawn up on shores: [x, z, yaw, scale]. */
const BOATS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-54, 92, 0.6, 1],
  [-44, 100, 0.3, 0.8],
  [38, 36, -1.1, 1],
  [8, 92, -1.6, 0.9],
  [-30, 128, 0.2, 1],
  [26, 128, -0.9, 0.8],
  [-34, -4, 2.1, 0.9],
]

/** Carts: [x, z, yaw]. */
const CARTS: ReadonlyArray<readonly [number, number, number]> = [
  [-66, -2, 0.4],
  [-112, 12, -0.3],
  [70, 0, 1.0],
  [112, -56, 0.6],
  [120, 52, -0.9],
]

/** Banners: [x, z, yaw]; the colour alternates red / cream in the scene. */
const BANNERS: ReadonlyArray<readonly [number, number, number]> = [
  [-120, 34, 0.2],
  [-114, -40, 0.6],
  [-44, -34, -0.4],
  [56, 8, 0.9],
  [-36, 116, 0.2],
]

/** Small tarns on the moor: [x, z, radius]. */
const TARNS: ReadonlyArray<readonly [number, number, number]> = [
  [-186, -40, 7],
  [-130, 70, 5.5],
  [-70, 136, 4.5],
  [150, -24, 5],
  [160, 118, 6],
  [-168, 110, 5],
]

export const DRESSING_FIXED: readonly Dressing[] = [
  ...FENCES.map(([x, z, yaw, size]) => ({ kind: 'fence' as const, x, z, yaw, size, k: 0 })),
  ...BRAZIERS.map(([x, z], i) => ({ kind: 'brazier' as const, x, z, yaw: i * 0.7, size: 1, k: (i % 5) / 5 })),
  ...BENCHES.map(([x, z, yaw]) => ({ kind: 'bench' as const, x, z, yaw, size: 2.2, k: 0 })),
  ...BOATS.map(([x, z, yaw, size]) => ({ kind: 'boat' as const, x, z, yaw, size, k: 0 })),
  ...CARTS.map(([x, z, yaw]) => ({ kind: 'cart' as const, x, z, yaw, size: 1, k: 0 })),
  ...BANNERS.map(([x, z, yaw], i) => ({ kind: 'banner' as const, x, z, yaw, size: 6.5, k: i % 2 })),
  ...TARNS.map(([x, z, size]) => ({ kind: 'tarn' as const, x, z, yaw: 0, size, k: 0 })),
]

/* ---------- seeded moss hummocks on the blank moor ---------- */

/** Everything a hummock must keep clear of: lanes, places, authored structures, water. */
function blockedForHummocks(layout: BiomeLayout, seed: number): Array<[number, number, number]> {
  const blocks: Array<[number, number, number]> = []
  for (const l of LANDMARKS) blocks.push([l.x, l.z, l.radius + 3])
  for (const d of generateDistricts(layout, seed)) blocks.push([d.center[0], d.center[1], d.footprintRadius + 18])
  blocks.push([layout.landmark.center[0], layout.landmark.center[1], 24])
  for (const lane of LANES) for (const [x, z] of sampleLane(lane.points, 4)) blocks.push([x, z, 4])
  for (const route of layout.routes) for (const [x, z] of sampleLane(route, 4)) blocks.push([x, z, 5])
  for (const d of DRESSING_FIXED) blocks.push([d.x, d.z, d.size + 3])
  for (const p of layout.preserves) blocks.push([p.center[0], p.center[1], Math.max(p.size[0], p.size[1]) / 2 + 4])
  return blocks
}

export function mossHummocksOnLand(layout: BiomeLayout, seed: number, count = 70): Dressing[] {
  const rng = seeded(seed * 97 + 41)
  const blocks = blockedForHummocks(layout, seed)
  const out: Dressing[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 40) {
    const x = -165 + rng() * 330
    const z = -150 + rng() * 300
    if (!isLandAt(x, z, 4)) continue
    if (blocks.some(([bx, bz, r]) => Math.hypot(bx - x, bz - z) < r)) continue
    const size = 1.6 + rng() * 2.6
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.size + size + 4)) continue
    out.push({ kind: 'hummock', x, z, yaw: rng() * Math.PI, size, k: rng() })
  }
  return out
}

export function dressing(layout: BiomeLayout, seed: number): Dressing[] {
  return [...DRESSING_FIXED, ...mossHummocksOnLand(layout, seed)]
}

/* ---------- chimneys of every authored house (for the smoke) ---------- */

/** NordicHouse chimney top in the house's local frame: (−width·0.28, height + 3.25, −0.7). */
function chimney(frame: Frame, h: PlacedHouse): [number, number, number] {
  const width = 5 * h.w
  const cs = Math.cos(h.yaw)
  const sn = Math.sin(h.yaw)
  const lx = h.p[0] + -width * 0.28 * cs + -0.7 * sn
  const lz = h.p[2] - -width * 0.28 * sn + -0.7 * cs
  const [x, z] = toWorld(frame, lx, lz)
  return [x, 3.6 + h.p[1] + h.height + 3.25, z]
}

/** Chimney tops of the houses standing at this progress (district groups sit at y ≈ 3.6). */
export function houseChimneys(layout: BiomeLayout, seed: number, progress: DistrictProgress): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const push = (frame: Frame, houses: readonly PlacedHouse[]) => houses.forEach((h) => out.push(chimney(frame, h)))
  for (const district of generateDistricts(layout, seed) as GeneratedDistrict[]) {
    const count = populationFor(district, progress[district.id] ?? 0).structures
    const frame = districtFrame(district)
    if (district.id === 'fjord-village') {
      push(frame, VILLAGE_ANCHORS)
      push(frame, villageHomes(seed, count))
    } else if (district.id === 'basalt-canyon') push(frame, CANYON_HOUSES.filter((h) => count >= h.minCount))
    else if (district.id === 'highland-hamlet') {
      push(frame, HAMLET_HALLS)
      push(frame, hamletHomes(seed, count))
    } else if (district.id === 'geothermal-farms') push(frame, GEOTHERMAL_HOUSES.filter((h) => count >= h.minCount))
    else push({ x: 0, z: 0, yaw: 0 }, ARCHIPELAGO_HOUSES.filter((h) => count >= h.minCount))
  }
  return out
}

/* ---------- colliders ---------- */

export function dressingColliders(items: readonly Dressing[]): Array<Collider & { tag: string; id: string }> {
  const out: Array<Collider & { tag: string; id: string }> = []
  items.forEach((d, i) => {
    const id = `${d.kind}-${i}`
    switch (d.kind) {
      case 'fence':
        out.push({ kind: 'box', x: d.x, z: d.z, hx: d.size / 2, hz: 0.25, yaw: d.yaw, tag: 'fence', id })
        break
      case 'bench':
        out.push({ kind: 'box', x: d.x, z: d.z, hx: d.size / 2 + 0.2, hz: 0.5, yaw: d.yaw, tag: 'bench', id })
        break
      case 'boat':
        out.push({ kind: 'box', x: d.x, z: d.z, hx: 0.9 * d.size, hz: 2.2 * d.size, yaw: d.yaw, tag: 'boat', id })
        break
      case 'cart':
        out.push({ kind: 'box', x: d.x, z: d.z, hx: 1.1, hz: 0.8, yaw: d.yaw, tag: 'cart', id })
        break
      case 'brazier':
        out.push({ kind: 'circle', x: d.x, z: d.z, r: 0.7, tag: 'brazier', id })
        break
      case 'banner':
      case 'post':
        out.push({ kind: 'circle', x: d.x, z: d.z, r: 0.3, tag: 'post', id })
        break
      case 'hummock':
        out.push({ kind: 'circle', x: d.x, z: d.z, r: d.size * 0.9, tag: 'hummock', id })
        break
      default:
        out.push({ kind: 'circle', x: d.x, z: d.z, r: d.size + 0.4, tag: 'tarn', id })
    }
  })
  return out
}

/** Authored structures the dressing must not sit on (for the tests). */
export function authoredColliders(layout: BiomeLayout, seed: number) {
  return landColliders(layout, seed, Object.fromEntries(layout.districts.map((d) => [d.id, 1])))
}

export { PATH_NODES }
