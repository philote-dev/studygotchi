/**
 * The path network: hand-laid lanes (world XZ polylines) joining every place on the slabs to its
 * neighbours and to the authored highland track, two small streams, and a crossing wherever a
 * lane meets water (planks over the mill race, stepping stones over the bathhouse runoff).
 * The walkers travel this graph; the scene draws it as ribbons.
 */
import type { Point } from './biome-layout'

export type NodeId =
  | 'village'
  | 'canyon'
  | 'hamlet'
  | 'geothermal'
  | 'headland'
  | 'beacon'
  | 'stone-circle'
  | 'troll-rock'
  | 'rune-stone'
  | 'lava-cave'
  | 'glacier-lagoon'
  | 'mill'
  | 'longhouse'
  | 'fish-racks'
  | 'sauna'
  | 'sheep-fold'
  | 'stave-church'
  | 'bathhouse'
  | 'power-hut'
  | 'boat-yard'
  | 'shore'

export interface PathNode {
  id: NodeId
  /** Where a walker arriving here stands (the lane end, just outside the place). */
  at: Point
}

export interface Lane {
  from: NodeId
  to: NodeId
  points: Point[]
  /** Which bank the lane is on (walkers never swim). */
  bank: 'west' | 'east'
}

export type CrossingKind = 'planks' | 'stones'

export interface Crossing {
  kind: CrossingKind
  /** Centre of the crossing and its direction (yaw of the planks / the line of stones). */
  at: Point
  yaw: number
  length: number
}

export interface Stream {
  id: string
  points: Point[]
  width: number
  /** Warm runoff is tinted toward the geothermal colour. */
  warm: boolean
}

export const PATH_NODES: readonly PathNode[] = [
  { id: 'village', at: [-118, 30] },
  { id: 'canyon', at: [-116, -44] },
  { id: 'hamlet', at: [-48, -40] },
  { id: 'geothermal', at: [60, 6] },
  { id: 'headland', at: [117, -64] },
  { id: 'beacon', at: [-40, 116] },
  { id: 'stone-circle', at: [-140, 24] },
  { id: 'troll-rock', at: [-138, -94] },
  { id: 'rune-stone', at: [-96, -42] },
  { id: 'lava-cave', at: [-122, 104] },
  { id: 'glacier-lagoon', at: [-131, -112] },
  { id: 'mill', at: [-62, -104] },
  { id: 'longhouse', at: [-70, -10] },
  { id: 'fish-racks', at: [-100, 9] },
  { id: 'sauna', at: [10, 84] },
  { id: 'sheep-fold', at: [128, 56] },
  { id: 'stave-church', at: [-120, -4] },
  { id: 'bathhouse', at: [100, 8] },
  { id: 'power-hut', at: [100, -54] },
  { id: 'boat-yard', at: [-84, 74] },
  { id: 'shore', at: [44, 32] },
]

export const LANES: readonly Lane[] = [
  { from: 'longhouse', to: 'hamlet', bank: 'west', points: [[-70, -10], [-60, -26], [-48, -40]] },
  { from: 'longhouse', to: 'rune-stone', bank: 'west', points: [[-70, -10], [-78, -2], [-90, -8], [-92, -20], [-88, -32], [-92, -42], [-96, -42]] },
  { from: 'rune-stone', to: 'canyon', bank: 'west', points: [[-96, -42], [-106, -44], [-116, -44]] },
  { from: 'fish-racks', to: 'village', bank: 'west', points: [[-100, 9], [-108, 16], [-118, 30]] },
  { from: 'fish-racks', to: 'longhouse', bank: 'west', points: [[-100, 9], [-88, 6], [-78, -2], [-70, -10]] },
  { from: 'stave-church', to: 'stone-circle', bank: 'west', points: [[-120, -4], [-130, 8], [-140, 24]] },
  { from: 'stave-church', to: 'fish-racks', bank: 'west', points: [[-120, -4], [-110, 2], [-100, 9]] },
  { from: 'stone-circle', to: 'village', bank: 'west', points: [[-140, 24], [-130, 28], [-118, 30]] },
  { from: 'village', to: 'boat-yard', bank: 'west', points: [[-118, 30], [-127, 42], [-120, 58], [-108, 64], [-94, 70], [-84, 74]] },
  { from: 'boat-yard', to: 'lava-cave', bank: 'west', points: [[-84, 74], [-94, 86], [-108, 98], [-122, 104]] },
  { from: 'boat-yard', to: 'beacon', bank: 'west', points: [[-84, 74], [-80, 92], [-66, 100], [-54, 98], [-44, 110], [-40, 116]] },
  { from: 'canyon', to: 'troll-rock', bank: 'west', points: [[-116, -44], [-124, -56], [-132, -68], [-134, -84], [-138, -94]] },
  { from: 'troll-rock', to: 'glacier-lagoon', bank: 'west', points: [[-138, -94], [-136, -104], [-131, -112]] },
  // Leaves the lagoon node south-west first and keeps south of z = -129 past the tarn: the band-2 viewing deck
  // (4 × 8 m at local x = -17.5, world x ≈ -129.5…-125.5, z ≈ -116…-108) stands 1.5 m east of the node, and the
  // 15 m pool reaches z = -127, so a lane that drifted east beside the deck and then ran at z ≈ -126 grazed both.
  { from: 'glacier-lagoon', to: 'mill', bank: 'west', points: [[-131, -112], [-133, -119], [-129, -126], [-118, -131], [-104, -130], [-94, -122], [-78, -118], [-68, -110], [-62, -104]] },
  // Along the fjord bank (north of the authored boulder at -45,-109) over the mill race (planks), then up to the hamlet.
  { from: 'mill', to: 'hamlet', bank: 'west', points: [[-62, -104], [-52, -105], [-42, -106], [-36, -110], [-24, -96], [-30, -76], [-44, -60], [-48, -40]] },
  // Both east lanes ford the warm runoff on the same stepping stones at (66, 9), and round the bath hall's
  // north-east corner (≈ 94.7, 11.8) rather than cutting it.
  { from: 'geothermal', to: 'bathhouse', bank: 'east', points: [[60, 6], [66, 9], [74, 16], [82, 19], [92, 17], [97, 15], [100, 8]] },
  { from: 'bathhouse', to: 'shore', bank: 'east', points: [[100, 8], [97, 15], [92, 17], [80, 20], [70, 14], [66, 9], [58, 16], [50, 26], [44, 32]] },
  // North past the west end of the long pasture fence (≈ 104…120 × 24…36) and the boulder at (105, 26).
  { from: 'bathhouse', to: 'sheep-fold', bank: 'east', points: [[100, 8], [100, 24], [101, 36], [108, 44], [120, 48], [128, 56]] },
  // West of the stone fold (130.7, 65.4; r 6.2) and its bench, then the long loop round the inlet; arrives at the
  // sauna between the beached boat (x ≤ 10) and the bench at (14, 90).
  { from: 'sheep-fold', to: 'sauna', bank: 'east', points: [[128, 56], [123, 56], [119.5, 60], [120, 70], [126, 82], [134, 90], [120, 118], [96, 132], [70, 136], [46, 130], [30, 118], [20, 100], [15, 96], [12, 92], [11, 87], [10, 84]] },
  { from: 'bathhouse', to: 'power-hut', bank: 'east', points: [[100, 8], [104, -6], [104, -30], [100, -54]] },
  // North of the pipe manifold and round the turbine shed (centre 108,-62), not through them.
  { from: 'power-hut', to: 'headland', bank: 'east', points: [[100, -54], [104, -49], [112, -50], [116, -56], [117, -64]] },
]

export const STREAMS: readonly Stream[] = [
  // The mill race from the waterfall pond south-east to the fjord.
  { id: 'mill-race', points: [[-58, -118], [-40, -112], [-20, -104], [-8, -100]], width: 2.0, warm: false },
  // Warm runoff from the lowest bath pool west-south-west to the fjord bank.
  { id: 'bath-runoff', points: [[76, 0], [66, 9], [56, 13], [46, 17], [36, 20]], width: 1.4, warm: true },
]

/** Crossings: planks over the mill race where the hamlet lane meets it, stones over the runoff where the east lanes ford it. */
export const CROSSINGS: readonly Crossing[] = [
  { kind: 'planks', at: [-36, -110.4], yaw: Math.atan2(-(-110 + 106), -36 + 50), length: 6 },
  { kind: 'stones', at: [66, 9], yaw: Math.atan2(-(16 - 9), 74 - 66), length: 7 },
]

export function node(id: NodeId): PathNode {
  return PATH_NODES.find((n) => n.id === id)!
}

export function lanesAt(id: NodeId): Lane[] {
  return LANES.filter((l) => l.from === id || l.to === id)
}

/** Points of a lane in walking order from `from`. */
export function lanePoints(lane: Lane, from: NodeId): Point[] {
  return lane.from === from ? lane.points : [...lane.points].reverse()
}

/** Every lane sampled every `step` metres (for tests and the walkers' land checks). */
export function sampleLane(points: readonly Point[], step = 2): Point[] {
  const out: Point[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step))
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n])
  }
  out.push(points[points.length - 1])
  return out
}

/** Whether a point sits on a stream (within half its width plus a margin). */
export function onStream(x: number, z: number, margin = 0.6): Stream | null {
  for (const s of STREAMS) {
    for (let i = 0; i < s.points.length - 1; i++) {
      const [ax, az] = s.points[i]
      const [bx, bz] = s.points[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz || 1
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) <= s.width / 2 + margin) return s
    }
  }
  return null
}

/** Whether a point is on a crossing (planks: an oriented deck; stones: a ford round the point), which makes a stream walkable there. */
export function onCrossing(x: number, z: number): boolean {
  for (const c of CROSSINGS) {
    const dx = x - c.at[0]
    const dz = z - c.at[1]
    if (c.kind === 'stones') {
      if (Math.hypot(dx, dz) <= c.length / 2 + 0.5) return true
      continue
    }
    const along = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw)
    const across = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw)
    if (Math.abs(along) <= c.length / 2 + 0.5 && Math.abs(across) <= 1.6) return true
  }
  return false
}
