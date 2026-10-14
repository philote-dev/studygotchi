/**
 * Placement data for everything the jungle scene puts on the ground, in one pure module so the
 * meshes (scene/JungleScene.tsx) and the collision footprints (collision/footprints.ts) read the
 * same numbers and cannot drift. District tables are in the district's local frame (metres,
 * before the district group's centre and yaw); terrain tables are world XZ. No three.js here.
 */
import { JUNGLE_LAYOUT as L, populationFor, seeded, type SeededDistrict } from './jungle-layout'

/* ---------- district tables (local frame) ---------- */

/** Great Canopy Village: [x, z, trunk height, yaw, scale]; pods take the first `primary`, spans the first `secondary`. */
export const CANOPY_SPOTS = [
  [-12, -8, 7, 0.45, 1.05],
  [9, -11, 11, -0.7, 0.92],
  [-19, 4, 5.5, 1.15, 0.88],
  [15, 2, 8.5, -1.2, 1.08],
  [-7, 12, 13, 2.45, 0.95],
  [21, 11, 6.5, -2.4, 0.86],
  [-23, -14, 10, 0.2, 0.82],
  [3, -19, 15, -0.15, 0.9],
  [24, -6, 12, -1.7, 0.78],
  [-16, 17, 8, 2.8, 0.86],
] as const

/** Lagoon Quarter stilt homes: [x, z, yaw, scale] (StiltHome index + 1). */
export const LAGOON_SPOTS = [
  [-15, -8, -0.25, 1.1],
  [-7, 3, 0.45, 0.86],
  [6, -6, -0.75, 1.25],
  [14, 2, 0.2, 0.95],
  [-18, 10, 0.8, 0.8],
  [3, 12, -0.15, 1.05],
  [19, 12, -0.55, 0.82],
  [11, -14, 0.65, 0.9],
] as const

/** The stilt hall: local position, yaw and non-uniform scale (StiltHome index 0). */
export const STILT_HALL = { position: [-1, -1] as const, yaw: 0.18, scale: [1.75, 1.2, 1.05] as const }

/** Lagoon boardwalks (deck ribbons 2.5 m up): points and width. */
export const LAGOON_BOARDWALKS = [
  { points: [[-18, -7], [-8, -3], [0, -1], [10, -5], [18, 1]] as Array<[number, number]>, width: 1.6, color: 'deck' as const },
  { points: [[-7, -3], [-9, 6], [-17, 10]] as Array<[number, number]>, width: 1.4, color: '#b1844d' },
  { points: [[4, -2], [5, 7], [4, 14]] as Array<[number, number]>, width: 1.45, color: '#c29250' },
]

/** Fishing piers: index → [x, z, yaw, length] (the first `secondary` are shown). */
export function lagoonPier(index: number): { x: number; z: number; yaw: number; length: number } {
  return { x: -12 + index * 8.5, z: 17 + (index % 2) * 3, yaw: index % 2 ? -0.22 : 0.18, length: 9 + index }
}

export const LAGOON_CANOES = [
  { position: [14, 0.55, 17] as const, yaw: -0.45, color: 'coral' as const },
  { position: [-18, 0.25, 14] as const, yaw: 0, color: '#dca34f' },
]

/** Falls Terraces rock shelves: [x, y, z, width, depth]. */
export const FALLS_SHELVES = [
  [0, 6.3, -20, 13, 4.2],
  [-1.5, 3.6, -11, 17, 3.2],
  [1, 1.5, -2, 21, 2.2],
] as const

/** Falls upper homes: [x, z, trunk height, yaw] (ElevatedTreehouse index + 2, scale 0.76 + (i % 3) · 0.08). */
export const FALLS_HOMES = [
  [-14, -16, 7.5, 0.5],
  [13, -15, 6, -0.7],
  [-17, -3, 4.5, 1.2],
  [16, 0, 3.2, -1.1],
  [-10, 10, 2.2, 2.4],
] as const

export function fallsHomeScale(index: number): number {
  return 0.76 + (index % 3) * 0.08
}

/** Falls mist stalls: [x, z, yaw]; box 3.8 + (i % 2) wide, 2.7 deep. */
export const FALLS_STALLS = [
  [-14, 8, 0.2],
  [-8, 12, -0.35],
  [-2, 11, 0.45],
  [6, 14, -0.2],
] as const

export const FALLS_SHELF_TREE = { position: [-7, 5.5, -11] as const, scale: 0.75, height: 15, broad: 0.95 }

/** Ruin Commons market canopies: [x, z, yaw]; box 4.2 + (i % 3) wide, 3.2 deep. */
export const RUINS_HOMES = [
  [-14, 7, -0.2],
  [-8, 13, 0.4],
  [2, 14, -0.5],
  [11, 11, 0.25],
  [15, 3, -0.8],
  [-17, -5, 0.75],
  [7, -9, -0.3],
  [-5, -12, 0.55],
] as const

/** Ruin Commons archive bays: [x, z, yaw]; box 4.8 × 3.6 plus a 1.2 m tower. */
export const RUINS_ARCHIVES = [
  [-11, -9, 0.5],
  [-4, -11, -0.1],
  [8, -12, 0.25],
  [14, -7, -0.45],
] as const

/** RootGate pillars: [x, y, width, height] (depth 2.6 + (i % 2) · 0.7, z offset i % 2 ? 0.35 : 0). */
export const ROOT_GATE_PILLARS = [
  [-5.3, 3.6, 2.3, 7.2],
  [-2.9, 6.6, 1.8, 3],
  [4.8, 4.7, 2.5, 9.4],
  [2.6, 8.2, 2, 2.8],
] as const

/** RootGate fallen blocks: index → local position, 2.4 × 0.6 × 1.8, yaw i · 0.61. */
export function rootGateBlock(index: number): { x: number; z: number; yaw: number } {
  return { x: -8 + (index % 5) * 3.6, z: -4 + Math.floor(index / 5) * 8, yaw: index * 0.61 }
}
export const ROOT_GATE_BLOCKS = 9
export const ROOT_GATE_ROOTS = [-4.6, 4.5] as const

/** Riverworks farm plots: [x, z, yaw, width, depth]. */
export const FARM_PLOTS = [
  [-17, -11, -0.28, 7, 3.4],
  [-16, -2, 0.18, 5.5, 4.4],
  [-13, 8, -0.5, 8, 3.2],
  [13, -13, 0.38, 6.5, 4],
  [15, -3, -0.15, 8.5, 3.3],
  [16, 8, 0.52, 6, 4.5],
  [-4, 15, -0.32, 7.5, 3.5],
  [9, 17, 0.2, 5.5, 3.8],
] as const

/** Riverworks mill sheds: [x, z, yaw]; box 4.4 + i · 0.4 wide, 3.7 deep. */
export const MILL_SHEDS = [
  [9, -7, 0.35],
  [13, 3, -0.28],
  [-10, 13, 0.5],
  [6, 15, -0.15],
] as const

/** The sluice the waterwheel sits in (local ribbon, 7 m wet band, 4.6 m water). */
export const SLUICE_POINTS: Array<[number, number]> = [
  [-9, -18],
  [-5, -10],
  [0, -3],
  [2, 5],
  [10, 16],
]
export const SLUICE_WET_WIDTH = 7
export const SLUICE_BRIDGE = { position: [1, 1, 8] as const, yaw: -0.12, size: [10, 0.35, 2.3] as const }

/** Lamp posts, every district, band ≥ 2: [x, z] before the seeded ±1 m jitter. */
export const LAMP_SPOTS = [
  [-15, -10],
  [13, -7],
  [-8, 14],
  [16, 12],
] as const

/** District vegetation: [x, z, scale]; JungleTree 11 + (i % 2) · 3 tall, broad 0.7, yaw i · 1.3. */
export const DISTRICT_TREES = [
  [-20, -17, 0.55],
  [20, -16, 0.7],
  [-24, 12, 0.48],
  [23, 15, 0.62],
] as const

/** The seeded lamp jitter the scene draws: the first 8 numbers of this stream, in lamp order. */
export function lampRng(seed: number, district: SeededDistrict): () => number {
  return seeded(seed * 151 + district.id.length * 37)
}

/* ---------- terrain tables (world frame) ---------- */

/** Wild tree clusters: [x, z, scale]; a 13 + (i % 3) · 2 tree at the origin, a 9 + (i % 2) · 2 tree at (5, 2), reeds at (−4, 4). */
export const WILD_VEGETATION = [
  [-122, -42, 0.75],
  [-108, 42, 0.65],
  [-34, -92, 0.72],
  [61, -72, 0.62],
  [110, -44, 0.7],
  [128, 12, 0.6],
  [-126, 78, 0.58],
] as const

/** Ground clusters: [x, z, variant]; scale 0.8 + (v % 3) · 0.12, yaw v · 0.73. */
export const GROUND_CLUSTERS = [
  [-116, -8, 0],
  [-104, 27, 1],
  [-48, -72, 2],
  [53, -63, 3],
  [113, -13, 4],
  [116, 66, 5],
  [-124, 94, 6],
  [34, 92, 7],
] as const

/** GroundCluster variant 0 (mod 3): three logs lying along local z at these x offsets, 2.6 m long. */
export const CLUSTER_LOGS = [-1.3, 0, 1.25] as const
/** GroundCluster variant 1 (mod 3): three boulders [x, y, z, scale]. */
export const CLUSTER_ROCKS = [
  [-1.2, 0.55, 0, 0.85],
  [0.4, 0.38, 0.5, 0.58],
  [1.35, 0.28, -0.35, 0.45],
] as const

/** Waterfall rocks: [x, z, scale]; dodecahedron radius 2.4 · scale. */
export const FALL_ROCKS = [
  [8, -118, 1.3],
  [36, -116, 1.1],
  [7, -103, 0.85],
  [38, -99, 0.9],
] as const

/** The three waterfall cliff shelves: [x, y, z, sx, sy, sz] (dodecahedra). */
export const FALL_CLIFFS = [
  [22, 7.2, -118, 16, 4.8, 4],
  [22, 4.2, -108, 13, 3.1, 4.5],
  [22, 2, -98, 11, 1.5, 4.8],
] as const

/** Lagoon water lobes: [x, z, sx, sy, sz, which]; dodecahedra turned by index · 0.37. */
export const LAGOON_LOBES = [
  [65, 24, 35, 0.18, 29, 'wet'],
  [86, 33, 26, 0.18, 22, 'wet'],
  [51, 29, 21, 0.16, 18, 'wet'],
  [66, 24, 30, 0.22, 25, 'water'],
  [86, 32, 22, 0.22, 18, 'water'],
  [53, 30, 17, 0.2, 15, 'water'],
  [72, 27, 22, 0.24, 17, 'light'],
] as const

/** Ground paths (walkable; the collider tests assert the network stays clear). */
export const PATHS: Array<Array<[number, number]>> = [
  [[-82, 54], [-71, 35], [-63, 11], [-54, -12]],
  [[-45, -22], [-23, -34], [-4, -40], [10, -48]],
  [[25, 68], [44, 62], [54, 52], [62, 44]],
]
export const PATH_WIDTH = 3.4
export const SHRINE_BOARDWALK: Array<[number, number]> = [[84, 46], [92, 59], [102, 67]]

export const LAGOON_REED_SPOTS = [
  [48, 49],
  [57, 55],
  [96, 18],
  [102, 30],
] as const

/* ---------- transforms ---------- */

/** three.js `rotation.y = yaw`: world = centre + (lx cos + lz sin, −lx sin + lz cos) · scale. */
export function worldFromLocal(cx: number, cz: number, yaw: number, lx: number, lz: number, scale = 1): [number, number] {
  const cs = Math.cos(yaw)
  const sn = Math.sin(yaw)
  return [cx + (lx * cs + lz * sn) * scale, cz + (-lx * sn + lz * cs) * scale]
}

export function districtYaw(district: SeededDistrict): number {
  return (district.yaw * Math.PI) / 180
}

/** A district-local point in world XZ. */
export function districtPoint(district: SeededDistrict, lx: number, lz: number): [number, number] {
  return worldFromLocal(district.center[0], district.center[1], districtYaw(district), lx, lz)
}

/* ---------- unified placement list ---------- */

export type PlacementKind =
  | 'mother-tree'
  | 'treehouse'
  | 'ladder'
  | 'stilt-home'
  | 'pier'
  | 'boardwalk'
  | 'canoe'
  | 'shelf'
  | 'stall'
  | 'tree'
  | 'hut'
  | 'archive'
  | 'gate-pillar'
  | 'gate-root'
  | 'gate-block'
  | 'mill'
  | 'wheel'
  | 'footbridge'
  | 'fence'
  | 'shed'
  | 'lamp'
  | 'log'
  | 'rock'
  | 'cliff'
  | 'shrine'
  | 'rope-bridge'

/** One placed object in world XZ: `yaw` is three's rotation.y of the object's group. */
export interface Placement {
  kind: PlacementKind
  id: string
  district: string | null
  x: number
  z: number
  yaw: number
  /** Uniform group scale applied to the object's local geometry. */
  scale: number
  /** Kind-specific local half-extents or radii at scale 1 (see `footprints.ts`). */
  size: number[]
}

function push(out: Placement[], kind: PlacementKind, id: string, district: string | null, xz: [number, number], yaw: number, scale: number, size: number[]): void {
  out.push({ kind, id, district, x: xz[0], z: xz[1], yaw, scale, size })
}

/** Ribbon → oriented segments (centre, yaw along the segment, half-length, half-width). */
export function ribbonSegments(points: Array<[number, number]>, width: number): Array<{ x: number; z: number; yaw: number; hz: number; hx: number }> {
  const out: Array<{ x: number; z: number; yaw: number; hz: number; hx: number }> = []
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) continue
    // Local z runs along the segment: three's rotation.y = atan2(dx, dz) sends local +z to (dx, dz).
    out.push({ x: (ax + bx) / 2, z: (az + bz) / 2, yaw: Math.atan2(dx, dz), hz: len / 2, hx: width / 2 })
  }
  return out
}

/** Elevated treehouse trunk bottom radius (index as the scene passes it). */
export function treehouseTrunkRadius(index: number): number {
  return 0.75 + (index % 3) * 0.25
}

/** Stilt home deck footprint (StiltHome `index`): [half width, half depth] of the deck slab. */
export function stiltHomeDeck(index: number): [number, number] {
  const width = 2.6 + (index % 3) * 0.7
  const depth = 2.2 + ((index + 1) % 3) * 0.55
  return [(width + 1.2) / 2, (depth + 1) / 2]
}

/** Everything one district places, in world XZ, at the given progress. */
export function districtPlacements(district: SeededDistrict, progress: number, seed: number): Placement[] {
  const out: Placement[] = []
  const pop = populationFor(district, progress)
  const yaw = districtYaw(district)
  const at = (lx: number, lz: number) => districtPoint(district, lx, lz)
  const d = district.id

  if (d === 'canopy') {
    push(out, 'mother-tree', `${d}:mother`, d, at(0, 0), yaw, 1, [4.6])
    CANOPY_SPOTS.slice(0, pop.primary).forEach(([x, z, , rotation, scale], index) => {
      const r = treehouseTrunkRadius(index)
      push(out, 'treehouse', `${d}:pod:${index}`, d, at(x, z), yaw + rotation, scale, [r])
      // The ladder leans against the trunk at local (r + 0.65, 0.7).
      const [lx, lz] = worldFromLocal(0, 0, rotation, r + 0.65, 0.7, scale)
      push(out, 'ladder', `${d}:ladder:${index}`, d, at(x + lx, z + lz), yaw + rotation, scale, [0.5])
    })
  }
  if (d === 'falls') {
    FALLS_SHELVES.forEach(([x, , z, width, depth], index) => {
      push(out, 'shelf', `${d}:shelf:${index}`, d, at(x, z), yaw, 1, [width * 0.42, depth * 0.42])
    })
    FALLS_HOMES.slice(0, Math.min(5, pop.primary)).forEach(([x, z, , rotation], index) => {
      const scale = fallsHomeScale(index)
      const r = treehouseTrunkRadius(index + 2)
      push(out, 'treehouse', `${d}:home:${index}`, d, at(x, z), yaw + rotation, scale, [r])
      const [lx, lz] = worldFromLocal(0, 0, rotation, r + 0.65, 0.7, scale)
      push(out, 'ladder', `${d}:ladder:${index}`, d, at(x + lx, z + lz), yaw + rotation, scale, [0.5])
    })
    FALLS_STALLS.slice(0, pop.secondary).forEach(([x, z, rotation], index) => {
      push(out, 'stall', `${d}:stall:${index}`, d, at(x, z), yaw + rotation, 1, [(3.8 + (index % 2)) / 2, 1.35])
    })
    push(out, 'tree', `${d}:shelf-tree`, d, at(FALLS_SHELF_TREE.position[0], FALLS_SHELF_TREE.position[2]), yaw, FALLS_SHELF_TREE.scale, [1.1 * FALLS_SHELF_TREE.broad])
  }
  if (d === 'lagoon') {
    const hall = stiltHomeDeck(0)
    const [hx, hz] = STILT_HALL.position
    push(out, 'stilt-home', `${d}:hall`, d, at(hx, hz), yaw + STILT_HALL.yaw, 1, [hall[0] * STILT_HALL.scale[0], hall[1] * STILT_HALL.scale[2]])
    LAGOON_SPOTS.slice(0, pop.primary).forEach(([x, z, rotation, scale], index) => {
      const deck = stiltHomeDeck(index + 1)
      push(out, 'stilt-home', `${d}:stilt:${index}`, d, at(x, z), yaw + rotation, scale, [deck[0], deck[1]])
    })
    LAGOON_BOARDWALKS.forEach((walk, w) => {
      ribbonSegments(walk.points, walk.width).forEach((segment, s) => {
        push(out, 'boardwalk', `${d}:walk:${w}:${s}`, d, at(segment.x, segment.z), yaw + segment.yaw, 1, [segment.hx, segment.hz])
      })
    })
    for (let index = 0; index < pop.secondary; index++) {
      const pier = lagoonPier(index)
      push(out, 'pier', `${d}:pier:${index}`, d, at(pier.x, pier.z), yaw + pier.yaw, 1, [0.9, pier.length / 2])
    }
    LAGOON_CANOES.forEach((canoe, index) => {
      push(out, 'canoe', `${d}:canoe:${index}`, d, at(canoe.position[0], canoe.position[2]), yaw + canoe.yaw, 1, [2.6, 0.75])
    })
  }
  if (d === 'ruins') {
    ROOT_GATE_PILLARS.forEach(([x, , w], index) => {
      push(out, 'gate-pillar', `${d}:pillar:${index}`, d, at(x, index % 2 ? 0.35 : 0), yaw, 1, [w / 2, (2.6 + (index % 2) * 0.7) / 2])
    })
    ROOT_GATE_ROOTS.forEach((x, index) => push(out, 'gate-root', `${d}:root:${index}`, d, at(x, 0.8), yaw, 1, [1.05]))
    for (let index = 0; index < ROOT_GATE_BLOCKS; index++) {
      const block = rootGateBlock(index)
      push(out, 'gate-block', `${d}:block:${index}`, d, at(block.x, block.z), yaw + block.yaw, 1, [1.2, 0.9])
    }
    RUINS_HOMES.slice(0, pop.primary).forEach(([x, z, rotation], index) => {
      push(out, 'hut', `${d}:hut:${index}`, d, at(x, z), yaw + rotation, 1, [(4.2 + (index % 3)) / 2, 1.6])
    })
    RUINS_ARCHIVES.slice(0, pop.secondary).forEach(([x, z, rotation], index) => {
      push(out, 'archive', `${d}:archive:${index}`, d, at(x, z), yaw + rotation, 1, [2.4, 1.9])
    })
  }
  if (d === 'riverworks') {
    push(out, 'mill', `${d}:mill`, d, at(-2.6, 0), yaw, 1, [2.6, 2.75])
    push(out, 'wheel', `${d}:wheel`, d, at(1.1, 0), yaw, 1, [0.35, 3.2])
    push(out, 'footbridge', `${d}:footbridge`, d, at(SLUICE_BRIDGE.position[0], SLUICE_BRIDGE.position[2]), yaw + SLUICE_BRIDGE.yaw, 1, [SLUICE_BRIDGE.size[0] / 2, SLUICE_BRIDGE.size[2] / 2])
    FARM_PLOTS.slice(0, pop.primary).forEach(([x, z, rotation, width, depth], index) => {
      // Two fence runs: the back rail along local x and the side rail along local z.
      const [bx, bz] = worldFromLocal(0, 0, rotation, 0, -depth * 0.48)
      push(out, 'fence', `${d}:fence:${index}:back`, d, at(x + bx, z + bz), yaw + rotation, 1, [width * 0.45, 0.16])
      const [sx, sz] = worldFromLocal(0, 0, rotation, width * 0.46, 0)
      push(out, 'fence', `${d}:fence:${index}:side`, d, at(x + sx, z + sz), yaw + rotation, 1, [0.15, depth * 0.39])
    })
    MILL_SHEDS.slice(0, pop.secondary).forEach(([x, z, rotation], index) => {
      push(out, 'shed', `${d}:shed:${index}`, d, at(x, z), yaw + rotation, 1, [(4.4 + index * 0.4) / 2, 1.85])
    })
  }
  if (pop.lamps) {
    const rng = lampRng(seed, district)
    LAMP_SPOTS.forEach(([x, z], index) => {
      const jx = (rng() - 0.5) * 2
      const jz = (rng() - 0.5) * 2
      push(out, 'lamp', `${d}:lamp:${index}`, d, at(x + jx, z + jz), yaw, 1, [0.12])
    })
  }
  DISTRICT_TREES.forEach(([x, z, scale], index) => {
    push(out, 'tree', `${d}:tree:${index}`, d, at(x, z), yaw + index * 1.3, scale, [1.1 * 0.7])
  })
  return out
}

/** Everything the terrain places (progress-independent), world XZ. */
export function terrainPlacements(): Placement[] {
  const out: Placement[] = []
  WILD_VEGETATION.forEach(([x, z, scale], index) => {
    const yaw = index * 0.9
    push(out, 'tree', `wild:${index}:a`, null, [x, z], yaw, scale, [1.1 * 0.72])
    const [bx, bz] = worldFromLocal(x, z, yaw, 5, 2, scale)
    push(out, 'tree', `wild:${index}:b`, null, [bx, bz], yaw, scale, [1.1 * 0.55])
  })
  GROUND_CLUSTERS.forEach(([x, z, variant]) => {
    const scale = 0.8 + (variant % 3) * 0.12
    const yaw = variant * 0.73
    if (variant % 3 === 0) {
      CLUSTER_LOGS.forEach((lx, index) => {
        const [wx, wz] = worldFromLocal(x, z, yaw, lx, 0, scale)
        push(out, 'log', `cluster:${variant}:log:${index}`, null, [wx, wz], yaw + index * 0.17, scale, [0.26, 1.3])
      })
    }
    if (variant % 3 === 1) {
      CLUSTER_ROCKS.forEach(([lx, , lz, s], index) => {
        const [wx, wz] = worldFromLocal(x, z, yaw, lx, lz, scale)
        push(out, 'rock', `cluster:${variant}:rock:${index}`, null, [wx, wz], yaw, scale, [s * 0.9])
      })
    }
  })
  FALL_ROCKS.forEach(([x, z, scale], index) => push(out, 'rock', `fall-rock:${index}`, null, [x, z], index * 0.8, scale, [2.4 * 0.85]))
  FALL_CLIFFS.forEach(([x, , z, sx, , sz], index) => push(out, 'cliff', `fall-cliff:${index}`, null, [x, z], 0, 1, [sx * 0.8, sz * 0.8]))
  push(out, 'shrine', 'shrine:plinth', null, [L.headland.center[0], L.headland.center[1]], 0, 1, [6.3])
  L.bridges.forEach((bridge) => {
    const dx = bridge.b[0] - bridge.a[0]
    const dz = bridge.b[1] - bridge.a[1]
    push(out, 'rope-bridge', `bridge:${bridge.id}`, null, [(bridge.a[0] + bridge.b[0]) / 2, (bridge.a[1] + bridge.b[1]) / 2], Math.atan2(dx, dz), 1, [1.1, Math.hypot(dx, dz) / 2])
  })
  return out
}

export function junglePlacements(districts: SeededDistrict[], progress: Record<string, number>, seed: number): Placement[] {
  const out = terrainPlacements()
  for (const district of districts) out.push(...districtPlacements(district, progress[district.id] ?? 0, seed))
  return out
}

/* ---------- water ---------- */

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz || 1
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len2))
  return Math.hypot(ax + dx * t - px, az + dz * t - pz)
}

export function polylineDistance(points: ReadonlyArray<readonly [number, number]>, x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 1; i < points.length; i++) {
    const d = segmentDistance(x, z, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
    if (d < best) best = d
  }
  return best
}

/**
 * Whether world (x, z) is water a walker must not enter: the river's wet band, the lagoon lobes
 * (each dodecahedron read as an ellipse at 0.9 of its scale), and the Riverworks sluice.
 */
export function isJungleWater(x: number, z: number, districts: readonly SeededDistrict[]): boolean {
  if (polylineDistance(L.hydrology.river, x, z) < L.hydrology.wetWidth / 2) return true
  for (let index = 0; index < LAGOON_LOBES.length; index++) {
    const [cx, cz, sx, , sz] = LAGOON_LOBES[index]
    const yaw = index * 0.37
    const dx = x - cx
    const dz = z - cz
    const cs = Math.cos(yaw)
    const sn = Math.sin(yaw)
    const lx = dx * cs - dz * sn
    const lz = dx * sn + dz * cs
    const u = lx / (sx * 0.9)
    const v = lz / (sz * 0.9)
    if (u * u + v * v < 1) return true
  }
  const riverworks = districts.find((district) => district.id === 'riverworks')
  if (riverworks) {
    const yaw = districtYaw(riverworks)
    const dx = x - riverworks.center[0]
    const dz = z - riverworks.center[1]
    const cs = Math.cos(yaw)
    const sn = Math.sin(yaw)
    const lx = dx * cs - dz * sn
    const lz = dx * sn + dz * cs
    if (polylineDistance(SLUICE_POINTS, lx, lz) < SLUICE_WET_WIDTH / 2) return true
  }
  return false
}

/** The authored plate: flat ground, |x|, |z| ≤ worldExtent. */
export function isOnPlate(x: number, z: number): boolean {
  return Math.abs(x) <= L.worldExtent && Math.abs(z) <= L.worldExtent
}
