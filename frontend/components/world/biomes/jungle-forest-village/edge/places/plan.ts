/**
 * The inhabited beyond: the pure plan for a mid-field layer of themed places at 280–650 m
 * (unreachable: outside the look box, inside the fog) between the wall and the far vistas.
 * No three.js here; `build.ts` turns it into geometry and `../outer/heightfield.ts` reads the
 * pads and pools so the land is flattened under each place.
 *
 * Thirteen places in three bands whose density thins and whose scale grows toward the horizon:
 * four stilt hamlets along the continued river, a shaman's island in a bend of the south delta
 * channel, a logging camp with a raft, fishing weirs with a river market, a ruined ziggurat
 * complex across the rope-bridge gorge, a quarry for the temple stone, rice terraces stepping
 * down a ridge, a canopy walkway grove, a waterfall pool with a shrine, and a parrot roost tree.
 * The river and dirt paths tie every place, the gates in the wall and the vistas into one
 * connected graph.
 */
import { seeded } from '../../layout/jungle-layout'
import { polylineDistance } from '../../layout/placements'
import { DELTA_CHANNELS, OUTER_RIVER, type BarrierPlan, type Gorge, gorge as planGorge, vistas } from '../barriers/geography'
import { bearingOf, wrapDeg } from '../noise'

export type PlaceKind = 'hamlet' | 'shaman' | 'logging' | 'weirs' | 'ziggurat' | 'quarry' | 'terraces' | 'walkway' | 'poolshrine' | 'parrot'
export type Band = 'near' | 'mid' | 'far'

/** Radii from the land centre (metres) of the three bands; the outermost sits well inside the fog. */
export const BANDS: Record<Band, [number, number]> = { near: [280, 400], mid: [400, 520], far: [520, 650] }

/** Primitive scale per band: things grow toward the horizon so they stay readable. */
export const BAND_SCALE: Record<Band, number> = { near: 1, mid: 1.2, far: 1.45 }

export interface Place {
  id: string
  kind: PlaceKind
  x: number
  z: number
  /** Facing (rotation.y); local +z is the place's front. */
  yaw: number
  /** Footprint radius, metres (clearance tests use it). */
  radius: number
  band: Band
  scale: number
  /** On a river bank: connected by water, not by a path. */
  riverside: boolean
  /** Metres from the land centre. */
  distance: number
}

interface PlaceSpec {
  id: string
  kind: PlaceKind
  x: number
  z: number
  yaw: number
  radius: number
  riverside: boolean
}

/**
 * Authored positions (metres). River places sit on the banks of the main channel or the delta
 * channels; the rest sit in the free sectors between the four windows. The seed only jitters
 * them by a couple of metres and turns them a little.
 */
const SPECS: readonly PlaceSpec[] = [
  { id: 'hamlet-gate', kind: 'hamlet', x: 282, z: 60, yaw: 0.3, radius: 26, riverside: true },
  { id: 'hamlet-bend', kind: 'hamlet', x: 326, z: 116, yaw: 3.3, radius: 28, riverside: true },
  { id: 'logging', kind: 'logging', x: 496, z: 98, yaw: 0.2, radius: 30, riverside: true },
  { id: 'shaman', kind: 'shaman', x: 462, z: 160, yaw: -0.6, radius: 28, riverside: true },
  { id: 'weirs', kind: 'weirs', x: 556, z: 164, yaw: 3.0, radius: 32, riverside: true },
  { id: 'hamlet-north', kind: 'hamlet', x: 560, z: 34, yaw: 0.1, radius: 30, riverside: true },
  { id: 'hamlet-south', kind: 'hamlet', x: 590, z: 250, yaw: 3.2, radius: 30, riverside: true },
  { id: 'ziggurat', kind: 'ziggurat', x: 92, z: 356, yaw: 2.9, radius: 48, riverside: false },
  { id: 'parrot', kind: 'parrot', x: 276, z: 329, yaw: 0.8, radius: 18, riverside: false },
  { id: 'quarry', kind: 'quarry', x: 221, z: -547, yaw: 0.4, radius: 44, riverside: false },
  { id: 'terraces', kind: 'terraces', x: -381, z: 220, yaw: 1.0, radius: 42, riverside: false },
  { id: 'walkway', kind: 'walkway', x: -332, z: -332, yaw: 0, radius: 40, riverside: false },
  // 4° off the west window's centre ray: in frame, clear of the lip cliffs, not in front of the volcano.
  { id: 'poolshrine', kind: 'poolshrine', x: -339, z: -24, yaw: 1.5, radius: 26, riverside: false },
]

export function bandOf(distance: number): Band {
  if (distance < BANDS.near[1]) return 'near'
  if (distance < BANDS.mid[1]) return 'mid'
  return 'far'
}

export function places(seed: number): Place[] {
  const rng = seeded(seed * 37 + 2026)
  return SPECS.map((spec) => {
    const x = spec.x + (rng() - 0.5) * 4
    const z = spec.z + (rng() - 0.5) * 4
    const distance = Math.hypot(x, z)
    const band = bandOf(distance)
    return { ...spec, x, z, yaw: spec.yaw + (rng() - 0.5) * 0.3, band, scale: BAND_SCALE[band], distance }
  })
}

/* ---------- lights ---------- */

export interface PlaceLight {
  /** Local offset of the one warm light (place frame, metres) and its height above the place's ground. */
  dx: number
  dz: number
  height: number
  radius: number
  /** Emissive intensity at night; dimmer with distance from the land. */
  intensity: number
}

/** Exactly one warm light per place: a cook fire, lantern or brazier, dimmer and a little larger the farther away. */
export function placeLight(p: Place): PlaceLight {
  const t = Math.min(1, Math.max(0, (p.distance - BANDS.near[0]) / (BANDS.far[1] - BANDS.near[0])))
  const radius = (0.9 + 0.9 * t) * p.scale
  const intensity = 2.2 - 1.3 * t
  switch (p.kind) {
    case 'hamlet':
      return { dx: 0, dz: 4, height: 0.9, radius, intensity } // the cook fire
    case 'shaman':
      return { dx: 0, dz: 0, height: 1.2, radius, intensity } // the fire on the island
    case 'logging':
      return { dx: -6, dz: 2, height: 0.9, radius, intensity } // the camp fire
    case 'weirs':
      return { dx: 0, dz: -6, height: 3.4, radius, intensity } // the market lantern
    case 'ziggurat':
      return { dx: 0, dz: 0, height: 19.5 * p.scale, radius, intensity } // the brazier on top
    case 'quarry':
      return { dx: 14, dz: 6, height: 11 * p.scale, radius, intensity } // the crane lamp
    case 'terraces':
      return { dx: 0, dz: -30, height: 4.2 * p.scale, radius, intensity } // the hut at the top
    case 'walkway':
      return { dx: 0, dz: 0, height: 24 * p.scale, radius, intensity } // a platform lantern
    case 'poolshrine':
      return { dx: -6, dz: 10, height: 2.4 * p.scale, radius, intensity } // the stone lantern
    default:
      return { dx: 6, dz: 4, height: 2.2 * p.scale, radius, intensity } // the parrot keeper's post
  }
}

/* ---------- terrain requests ---------- */

export interface Pad {
  x: number
  z: number
  radius: number
}

export interface Pool {
  x: number
  z: number
  radius: number
  /** How far the bed dips under the valley floor. */
  depth: number
}

/** Places that want flat ground under them (the terraces step down the slope on purpose). */
export function pads(list: readonly Place[]): Pad[] {
  const out: Pad[] = []
  for (const p of list) {
    if (p.kind === 'terraces' || p.kind === 'poolshrine' || p.kind === 'parrot') continue
    out.push({ x: p.x, z: p.z, radius: p.kind === 'hamlet' || p.kind === 'shaman' ? p.radius + 4 : p.radius })
  }
  return out
}

/** Still water: the shaman's bend pool round its island, the shrine's plunge pool. */
export function pools(list: readonly Place[]): Pool[] {
  const out: Pool[] = []
  for (const p of list) {
    if (p.kind === 'shaman') out.push({ x: p.x, z: p.z, radius: 26 * (p.scale * 0.9), depth: 0.9 })
    if (p.kind === 'poolshrine') {
      const [px, pz] = poolCentre(p)
      out.push({ x: px, z: pz, radius: 13, depth: 0.7 })
    }
  }
  return out
}

/** The shrine's pool lies in front (local +z) of its bluff. */
export function poolCentre(p: Place): [number, number] {
  return [p.x + Math.sin(p.yaw) * 14, p.z + Math.cos(p.yaw) * 14]
}

/* ---------- the graph ---------- */

export type NodeKind = 'land' | 'gate' | 'place' | 'vista' | 'river'
export type EdgeKind = 'river' | 'path' | 'bridge' | 'land'

export interface GraphNode {
  id: string
  kind: NodeKind
  x: number
  z: number
}

export interface GraphEdge {
  a: string
  b: string
  kind: EdgeKind
  /** Path edges: optional way-points between the ends (world XZ). */
  via?: Array<[number, number]>
}

export interface PathRibbon {
  id: string
  points: Array<[number, number]>
}

export interface PlacesPlan {
  seed: number
  places: Place[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Dirt paths (the `path` edges) as polylines on the ground. */
  paths: PathRibbon[]
  pads: Pad[]
  pools: Pool[]
  /** The two drifting canoes' tracks (polylines along the water). */
  canoeTracks: Array<Array<[number, number]>>
  gorge: Gorge
}

/** Where the four pose rays leave the wall: the land's gates. */
function gateNodes(barriers: BarrierPlan): GraphNode[] {
  return barriers.gaps.map((gap) => ({ id: `gate-${gap.id}`, kind: 'gate' as const, x: gap.crossing[0], z: gap.crossing[1] }))
}

/**
 * Between two nodes, a path that curves round the land (polar interpolation with a small
 * outward bulge) so it never cuts back through the wall; way-points are honoured in order.
 */
export function pathPoints(a: GraphNode, b: GraphNode, via: Array<[number, number]> = [], step = 10): Array<[number, number]> {
  const stops: Array<[number, number]> = [[a.x, a.z], ...via, [b.x, b.z]]
  const out: Array<[number, number]> = []
  for (let s = 1; s < stops.length; s++) {
    const [x0, z0] = stops[s - 1]
    const [x1, z1] = stops[s]
    const r0 = Math.hypot(x0, z0)
    const r1 = Math.hypot(x1, z1)
    const b0 = bearingOf(x0, z0)
    const db = wrapDeg(bearingOf(x1, z1) - b0)
    const arc = (Math.abs(db) * Math.PI * (r0 + r1)) / 360
    const n = Math.max(2, Math.ceil(Math.max(arc, Math.hypot(x1 - x0, z1 - z0)) / step))
    for (let i = s === 1 ? 0 : 1; i <= n; i++) {
      const t = i / n
      const r = r0 + (r1 - r0) * t + 10 * Math.sin(Math.PI * t)
      const bearing = ((b0 + db * t) * Math.PI) / 180
      out.push([Math.sin(bearing) * r, Math.cos(bearing) * r])
    }
  }
  return out
}

export function placesPlan(seed: number, barriers: BarrierPlan): PlacesPlan {
  const list = places(seed)
  const gorge = planGorge()
  const vistaList = vistas()
  const temple = vistaList.find((v) => v.id === 'north')!
  const beacon = vistaList.find((v) => v.id === 'east')!
  const bridgeEast: [number, number] = [gorge.x + Math.cos(gorge.yaw) * -(gorge.halfWidth + 5), gorge.z - Math.sin(gorge.yaw) * -(gorge.halfWidth + 5)]
  const bridgeWest: [number, number] = [gorge.x + Math.cos(gorge.yaw) * (gorge.halfWidth + 5), gorge.z - Math.sin(gorge.yaw) * (gorge.halfWidth + 5)]
  const apex = DELTA_CHANNELS[0][0]

  const nodes: GraphNode[] = [
    { id: 'land', kind: 'land', x: 0, z: 0 },
    { id: 'river-exit', kind: 'river', x: OUTER_RIVER[2][0], z: OUTER_RIVER[2][1] },
    { id: 'river-apex', kind: 'river', x: apex[0], z: apex[1] },
    ...gateNodes(barriers),
    { id: 'temple', kind: 'vista', x: temple.x, z: temple.z },
    { id: 'beacon', kind: 'vista', x: beacon.x, z: beacon.z },
    { id: 'bridge-east', kind: 'vista', x: bridgeEast[0], z: bridgeEast[1] },
    { id: 'bridge-west', kind: 'vista', x: bridgeWest[0], z: bridgeWest[1] },
    ...list.map((p) => ({ id: p.id, kind: 'place' as const, x: p.x, z: p.z })),
  ]
  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]))

  // The bridge path returns to the south gate round the gorge's near mouth.
  const southGate = nodeById['gate-south']

  const edges: GraphEdge[] = [
    // The land reaches its gates and the river exit.
    { a: 'land', b: 'gate-north', kind: 'land' },
    { a: 'land', b: 'gate-east', kind: 'land' },
    { a: 'land', b: 'gate-south', kind: 'land' },
    { a: 'land', b: 'gate-west', kind: 'land' },
    { a: 'land', b: 'river-exit', kind: 'land' },
    // The river: exit → hamlets → shaman's bend → beacon → apex → camp, weirs, delta hamlets.
    { a: 'river-exit', b: 'hamlet-gate', kind: 'river' },
    { a: 'hamlet-gate', b: 'hamlet-bend', kind: 'river' },
    { a: 'hamlet-bend', b: 'beacon', kind: 'river' },
    { a: 'beacon', b: 'river-apex', kind: 'river' },
    { a: 'river-apex', b: 'logging', kind: 'river' },
    { a: 'logging', b: 'weirs', kind: 'river' },
    { a: 'river-apex', b: 'hamlet-north', kind: 'river' },
    { a: 'river-apex', b: 'shaman', kind: 'river' },
    { a: 'shaman', b: 'hamlet-south', kind: 'river' },
    // Paths south: the ziggurat reaches the rope bridge, the bridge reaches the south gate.
    { a: 'ziggurat', b: 'bridge-east', kind: 'path' },
    { a: 'bridge-east', b: 'bridge-west', kind: 'bridge' },
    { a: 'bridge-west', b: 'gate-south', kind: 'path', via: [[southGate.x - 46, gorge.z - gorge.halfLength - 14]] },
    { a: 'ziggurat', b: 'parrot', kind: 'path' },
    { a: 'parrot', b: 'hamlet-south', kind: 'path' },
    // Paths north: the quarry feeds the temple; the temple reaches the north gate.
    { a: 'quarry', b: 'temple', kind: 'path' },
    { a: 'temple', b: 'gate-north', kind: 'path' },
    // Paths west: terraces → shrine pool → walkway grove → temple; the pool reaches the west gate.
    { a: 'terraces', b: 'poolshrine', kind: 'path' },
    { a: 'poolshrine', b: 'walkway', kind: 'path' },
    { a: 'walkway', b: 'temple', kind: 'path' },
    { a: 'poolshrine', b: 'gate-west', kind: 'path' },
  ]

  const paths: PathRibbon[] = edges
    .filter((e) => e.kind === 'path')
    .map((e) => ({ id: `${e.a}~${e.b}`, points: pathPoints(nodeById[e.a], nodeById[e.b], e.via) }))

  // Two canoes: one drifts the main channel from the gate to the apex, one the south channel to its hamlet.
  const mainStart = OUTER_RIVER.findIndex(([x]) => x >= 236)
  const canoeTracks: Array<Array<[number, number]>> = [
    OUTER_RIVER.slice(mainStart, OUTER_RIVER.findIndex(([x]) => x >= 400) + 1).map(([x, z]) => [x, z] as [number, number]),
    DELTA_CHANNELS[1].slice(0, 4).map(([x, z]) => [x, z] as [number, number]),
  ]

  return { seed, places: list, nodes, edges, paths, pads: pads(list), pools: pools(list), canoeTracks, gorge }
}

/** Breadth-first from the land: true when every node is reached by river, path, bridge or land edges. */
export function isGraphConnected(plan: PlacesPlan): boolean {
  const adjacency = new Map<string, string[]>()
  for (const n of plan.nodes) adjacency.set(n.id, [])
  for (const e of plan.edges) {
    adjacency.get(e.a)?.push(e.b)
    adjacency.get(e.b)?.push(e.a)
  }
  const seen = new Set<string>(['land'])
  const queue = ['land']
  while (queue.length) {
    const id = queue.shift()!
    for (const next of adjacency.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return plan.nodes.every((n) => seen.has(n.id))
}

/** Whether a point lies inside the gorge's trench (plus a margin). */
export function inGorge(gorge: Gorge, x: number, z: number, margin = 0): boolean {
  const dx = x - gorge.x
  const dz = z - gorge.z
  const along = Math.abs(dx * Math.sin(gorge.yaw) + dz * Math.cos(gorge.yaw))
  const across = Math.abs(dx * Math.cos(gorge.yaw) - dz * Math.sin(gorge.yaw))
  return along < gorge.halfLength + margin && across < gorge.halfWidth + margin
}

/** Distance from a point to the nearest place footprint edge (negative inside). */
export function placeClearance(list: readonly Place[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY
  for (const p of list) best = Math.min(best, Math.hypot(p.x - x, p.z - z) - p.radius)
  return best
}

/** Distance from a point to the nearest dirt path centreline. */
export function pathDistance(plan: PlacesPlan, x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY
  for (const path of plan.paths) best = Math.min(best, polylineDistance(path.points, x, z))
  return best
}

/** Per-band counts and densities (places per km² of the band's annulus). */
export function bandStats(list: readonly Place[]): Record<Band, { count: number; density: number }> {
  const out = {} as Record<Band, { count: number; density: number }>
  for (const band of ['near', 'mid', 'far'] as Band[]) {
    const [r0, r1] = BANDS[band]
    const count = list.filter((p) => p.band === band).length
    const area = (Math.PI * (r1 * r1 - r0 * r0)) / 1e6
    out[band] = { count, density: count / area }
  }
  return out
}
