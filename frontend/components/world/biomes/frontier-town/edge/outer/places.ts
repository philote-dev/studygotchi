/**
 * The inhabited beyond: a mid-field layer of themed places between the plate and the fog, the
 * lanes that join them into one connected graph, and the one light each shows at night. Pure
 * plan (no three.js, no heights): positions are art-directed in world metres and only jittered
 * by the seed, so the overview never changes and the tests can reason about them.
 *
 * Bands: near places stand 220–450 m from the land centre (the apron inside the barriers and the
 * windows), far ones 450–650 m (beyond the walls, bigger so they still read, fewer so the horizon
 * thins out). Everything is outside the look box by PLACE_CLEARANCE and inside the fog.
 */
import { seededRng } from './noise'
import type { TrestlePlan } from './desert'
import { type Window, windows as planWindows } from './vistas'

export type PlaceKind = 'ranch' | 'ghost-town' | 'mine' | 'rail-yard' | 'pueblo' | 'ferry' | 'chapel' | 'cemetery' | 'crossroads' | 'cattle-drive'

export type Band = 'near' | 'far'

export interface Place {
  id: string
  kind: PlaceKind
  x: number
  z: number
  /** Local +z points toward the land centre (or along the rails for the yard). */
  yaw: number
  /** Footprint radius, metres (the overlap tests; the flat pad unless `padR` says otherwise). */
  r: number
  /** Smaller flat pad for places whose own landform must stay inside the footprint (the mine's knob). */
  padR?: number
  /** Toybox scale: far places are built bigger. */
  scale: number
  band: Band
  /** Metres from the land centre. */
  distance: number
  /** Local offset of the one night light (metres at scale 1; y above the pad). */
  light: [number, number, number]
  /** Local chimney top for the smoke loop, if the place smokes. */
  chimney?: [number, number, number]
  /** Landform the place needs under it: the pueblo's table, the mine's knob. */
  landform?: { kind: 'table' | 'knob'; dx: number; dz: number; rx: number; rz: number; height: number }
}

/** Metres every place keeps from the plate (the look box) and the smallest / largest centre distance. */
export const PLACE_CLEARANCE = 60
export const PLACE_BAND = { min: 220, split: 450, max: 650 } as const
/** Where the rail yard sits along the trestle line, metres past the far abutment (beyond the cutting). */
export const YARD_OFFSET = 215

interface Seed {
  id: string
  kind: PlaceKind
  x: number
  z: number
  r: number
  padR?: number
  light: [number, number, number]
  chimney?: [number, number, number]
  landform?: Place['landform']
}

/** Art-directed positions; the seed only jitters them a few metres. */
function seeds(): Seed[] {
  return [
    { id: 'ranch-a', kind: 'ranch', x: -300, z: 212, r: 34, light: [-6, 3.2, 6], chimney: [-6, 5.6, 2] },
    { id: 'crossroads', kind: 'crossroads', x: 92, z: 232, r: 26, light: [0, 3.2, 2.9], chimney: [2.2, 7.4, -1.5] },
    { id: 'cemetery-east', kind: 'cemetery', x: 302, z: -214, r: 20, light: [0, 2.6, 9] },
    { id: 'ghost-town', kind: 'ghost-town', x: -306, z: -238, r: 34, light: [8, 2.4, 1] },
    { id: 'mine', kind: 'mine', x: -298, z: -62, r: 34, padR: 18, light: [10, 2.4, 6], chimney: [-4, 8.6, 4], landform: { kind: 'knob', dx: -24, dz: -18, rx: 16, rz: 13, height: 14 } },
    { id: 'chapel', kind: 'chapel', x: 200, z: 242, r: 20, light: [0, 2.2, 5.2] },
    { id: 'cattle-drive', kind: 'cattle-drive', x: -126, z: 362, r: 30, light: [14, 0.9, -4], chimney: [0, 1.2, 14] },
    { id: 'ferry', kind: 'ferry', x: 2, z: 328, r: 16, light: [3.5, 3.4, -4] },
    { id: 'pueblo', kind: 'pueblo', x: -330, z: 420, r: 36, light: [3, 4.4, 8], landform: { kind: 'table', dx: 0, dz: 0, rx: 46, rz: 40, height: 18 } },
    { id: 'ranch-east', kind: 'ranch', x: 500, z: 212, r: 40, light: [-6, 3.2, 6], chimney: [-6, 5.6, 2] },
    { id: 'ranch-south', kind: 'ranch', x: 300, z: 482, r: 40, light: [-6, 3.2, 6], chimney: [-6, 5.6, 2] },
    { id: 'cemetery-west', kind: 'cemetery', x: -470, z: 160, r: 24, light: [0, 2.6, 9] },
  ]
}

export function planPlaces(seed: number, windows: Window[] = planWindows(), trestle: TrestlePlan | null = null): Place[] {
  void windows
  const rng = seededRng(seed * 211 + 13)
  const out: Place[] = []
  const push = (s: Seed, yawOverride?: number) => {
    const x = s.x + (rng() - 0.5) * 12
    const z = s.z + (rng() - 0.5) * 12
    const distance = Math.hypot(x, z)
    const band: Band = distance < PLACE_BAND.split ? 'near' : 'far'
    const scale = band === 'far' ? 1.3 + rng() * 0.2 : 1 + rng() * 0.12
    const yaw = yawOverride ?? Math.atan2(-x, -z) + (rng() - 0.5) * 0.3
    out.push({ id: s.id, kind: s.kind, x, z, yaw, r: s.r * (band === 'far' ? 1.15 : 1), padR: s.padR, scale, band, distance, light: s.light, chimney: s.chimney, landform: s.landform })
  }
  for (const s of seeds()) push(s)
  if (trestle) {
    const b = (trestle.bearingDeg * Math.PI) / 180
    const dx = Math.sin(b)
    const dz = Math.cos(b)
    const x = trestle.far[0] + dx * YARD_OFFSET
    const z = trestle.far[1] + dz * YARD_OFFSET
    const distance = Math.hypot(x, z)
    out.push({
      id: 'rail-yard',
      kind: 'rail-yard',
      x,
      z,
      // Local +z runs back along the line toward the trestle (the way the train leaves).
      yaw: Math.atan2(-dx, -dz),
      r: 46,
      scale: 1.3,
      band: distance < PLACE_BAND.split ? 'near' : 'far',
      distance,
      light: [4, 7.5, 14],
      chimney: [-5, 6.2, -10],
    })
  }
  return out
}

export function place(places: Place[], id: string): Place {
  return places.find((p) => p.id === id)!
}

/* ---------- lanes ---------- */

export interface LaneNode {
  id: string
  x: number
  z: number
}

export interface Lane {
  id: string
  from: string
  to: string
  /** World polyline from `from` to `to` (both endpoints included). */
  points: Array<[number, number]>
  /** The stage-coach road carries milestones. */
  stage?: boolean
}

/** Junctions that are not places: the dune saddle and where lanes leave the plate. */
export function laneNodes(windows: Window[] = planWindows()): LaneNode[] {
  const south = windows.find((w) => w.id === 'south')!
  return [
    { id: 'saddle', x: south.along, z: 285 },
    { id: 'edge-south-west', x: -120, z: 176 },
    { id: 'edge-south-east', x: 92, z: 176 },
    { id: 'edge-west', x: -246, z: -62 },
    { id: 'edge-north-east', x: 246, z: -214 },
  ]
}

function via(a: { x: number; z: number }, b: { x: number; z: number }, waypoints: Array<[number, number]> = []): Array<[number, number]> {
  return [[a.x, a.z], ...waypoints, [b.x, b.z]]
}

export function planLanes(places: Place[], windows: Window[] = planWindows()): { nodes: LaneNode[]; lanes: Lane[] } {
  const nodes = laneNodes(windows)
  const node = (id: string) => nodes.find((n) => n.id === id)!
  const p = (id: string) => place(places, id)
  const lanes: Lane[] = [
    // The stage-coach road: out of the land's south-west, past the first ranch, on to the far cemetery.
    { id: 'stage-1', from: 'edge-south-west', to: 'ranch-a', points: via(node('edge-south-west'), p('ranch-a'), [[-200, 196]]), stage: true },
    { id: 'stage-2', from: 'ranch-a', to: 'cemetery-west', points: via(p('ranch-a'), p('cemetery-west'), [[-380, 200]]), stage: true },
    // Through the dune saddle to the wash, the ferry and the far south.
    { id: 'drive', from: 'ranch-a', to: 'cattle-drive', points: via(p('ranch-a'), p('cattle-drive'), [[-220, 262], [-170, 318]]) },
    { id: 'saddle-in', from: 'cattle-drive', to: 'saddle', points: via(p('cattle-drive'), node('saddle'), [[-60, 330]]) },
    { id: 'saddle-ferry', from: 'saddle', to: 'ferry', points: via(node('saddle'), p('ferry'), [[-12, 306]]) },
    { id: 'ferry-pueblo', from: 'ferry', to: 'pueblo', points: via(p('ferry'), p('pueblo'), [[-90, 362], [-220, 404]]) },
    { id: 'ferry-ranch-south', from: 'ferry', to: 'ranch-south', points: via(p('ferry'), p('ranch-south'), [[120, 392], [220, 446]]) },
    // The crossroads: south out of the land, west to the saddle, east to the chapel.
    { id: 'cross-in', from: 'edge-south-east', to: 'crossroads', points: via(node('edge-south-east'), p('crossroads')) },
    { id: 'cross-saddle', from: 'crossroads', to: 'saddle', points: via(p('crossroads'), node('saddle'), [[40, 262]]) },
    { id: 'cross-chapel', from: 'crossroads', to: 'chapel', points: via(p('crossroads'), p('chapel')) },
    // The east apron, up to the far cemetery past the gorge window, and round the gorge's end to the plateau.
    { id: 'apron-east', from: 'chapel', to: 'cemetery-east', points: via(p('chapel'), p('cemetery-east'), [[292, 170], [296, 60], [292, -60], [298, -150]]) },
    { id: 'plateau', from: 'chapel', to: 'ranch-east', points: via(p('chapel'), p('ranch-east'), [[300, 268], [372, 300], [446, 322], [500, 262]]) },
    { id: 'yard', from: 'ranch-east', to: 'rail-yard', points: via(p('ranch-east'), p('rail-yard')) },
    // The north apron behind the skyline joins the two sides; the mine road leaves the land's west edge.
    { id: 'north-apron', from: 'ghost-town', to: 'cemetery-east', points: via(p('ghost-town'), p('cemetery-east'), [[-160, -268], [0, -272], [160, -262]]) },
    { id: 'mine-road', from: 'edge-west', to: 'mine', points: via(node('edge-west'), p('mine')) },
    { id: 'mine-ghost', from: 'mine', to: 'ghost-town', points: via(p('mine'), p('ghost-town'), [[-304, -160]]) },
    { id: 'north-east-in', from: 'edge-north-east', to: 'cemetery-east', points: via(node('edge-north-east'), p('cemetery-east')) },
  ]
  return { nodes, lanes }
}

/** Every place reachable from every other over the lanes (junction nodes count as pass-throughs). */
export function laneGraphConnected(places: Place[], lanes: Lane[]): boolean {
  const adjacency = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set())
    if (!adjacency.has(b)) adjacency.set(b, new Set())
    adjacency.get(a)!.add(b)
    adjacency.get(b)!.add(a)
  }
  for (const lane of lanes) link(lane.from, lane.to)
  const seen = new Set<string>([places[0].id])
  const stack = [places[0].id]
  while (stack.length) {
    const id = stack.pop()!
    for (const next of adjacency.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        stack.push(next)
      }
    }
  }
  return places.every((p) => seen.has(p.id))
}

/** Lane polyline resampled every `step` metres: [x, z, yaw] per segment start, plus the segment length. */
export function laneSegments(lane: Lane, step = 10): Array<{ x: number; z: number; yaw: number; length: number }> {
  const out: Array<{ x: number; z: number; yaw: number; length: number }> = []
  for (let i = 1; i < lane.points.length; i++) {
    const [ax, az] = lane.points[i - 1]
    const [bx, bz] = lane.points[i]
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.ceil(len / step))
    const yaw = Math.atan2(bx - ax, bz - az)
    for (let k = 0; k < n; k++) {
      const t0 = k / n
      out.push({ x: ax + (bx - ax) * t0, z: az + (bz - az) * t0, yaw, length: len / n })
    }
  }
  return out
}

export function laneLength(lane: Lane): number {
  let total = 0
  for (let i = 1; i < lane.points.length; i++) total += Math.hypot(lane.points[i][0] - lane.points[i - 1][0], lane.points[i][1] - lane.points[i - 1][1])
  return total
}

export interface LanePoint {
  x: number
  z: number
  yaw: number
}

/** Point `s` metres along the lane (clamped), with the direction there, written into `out` (no allocation). */
export function laneAtInto(lane: Lane, s: number, out: LanePoint): LanePoint {
  let left = Math.max(0, s)
  for (let i = 1; i < lane.points.length; i++) {
    const [ax, az] = lane.points[i - 1]
    const [bx, bz] = lane.points[i]
    const len = Math.hypot(bx - ax, bz - az)
    if (left <= len || i === lane.points.length - 1) {
      const t = Math.min(1, left / Math.max(1e-6, len))
      out.x = ax + (bx - ax) * t
      out.z = az + (bz - az) * t
      out.yaw = Math.atan2(bx - ax, bz - az)
      return out
    }
    left -= len
  }
  const [x, z] = lane.points[lane.points.length - 1]
  out.x = x
  out.z = z
  out.yaw = 0
  return out
}

export function laneAt(lane: Lane, s: number): LanePoint {
  return laneAtInto(lane, s, { x: 0, z: 0, yaw: 0 })
}

/** Milestones every `spacing` metres along the stage road, standing just off its right-hand edge. */
export function milestones(lanes: Lane[], spacing = 60): Array<{ x: number; z: number; yaw: number }> {
  const out: Array<{ x: number; z: number; yaw: number }> = []
  for (const lane of lanes) {
    if (!lane.stage) continue
    const length = laneLength(lane)
    for (let s = spacing / 2; s < length; s += spacing) {
      const p = laneAt(lane, s)
      out.push({ x: p.x + Math.cos(p.yaw) * 2.6, z: p.z - Math.sin(p.yaw) * 2.6, yaw: p.yaw })
    }
  }
  return out
}

/* ---------- lights ---------- */

export interface PlaceLight {
  placeId: string
  x: number
  /** Height above the place's pad. */
  dy: number
  z: number
  /** 1 at the near band's inner edge, falling toward the horizon so the far lights are a dim scatter. */
  intensity: number
  radius: number
}

export function lightFalloff(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - 280) / (PLACE_BAND.max - 280)))
  return 1 - 0.5 * t
}

export function placeLights(places: Place[]): PlaceLight[] {
  return places.map((p) => {
    const [lx, ly, lz] = p.light
    const c = Math.cos(p.yaw)
    const s = Math.sin(p.yaw)
    const x = p.x + (lx * c + lz * s) * p.scale
    const z = p.z + (-lx * s + lz * c) * p.scale
    const far = Math.min(1, Math.max(0, (p.distance - 280) / (PLACE_BAND.max - 280)))
    return { placeId: p.id, x, dy: ly * p.scale, z, intensity: lightFalloff(p.distance), radius: (0.6 + far * 0.7) * p.scale }
  })
}

/* ---------- repeated things (instanced) ---------- */

export interface Scatter {
  placeId: string
  x: number
  z: number
  yaw: number
  scale: number
}

function local(p: Place, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.yaw)
  const s = Math.sin(p.yaw)
  return [p.x + (lx * c + lz * s) * p.scale, p.z + (-lx * s + lz * c) * p.scale]
}

/** Fence rails: corral rings at the ranches, the cemetery walls, the crossroads' pen. */
export function fenceRails(places: Place[]): Scatter[] {
  const out: Scatter[] = []
  for (const p of places) {
    if (p.kind === 'ranch') {
      const rings: Array<[number, number, number]> = [
        [10, 6, 8],
        [26, 2, 6],
      ]
      for (const [cx, cz, radius] of rings) {
        const n = Math.max(10, Math.round(radius * 1.8))
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * Math.PI * 2
          const a1 = ((i + 1) / n) * Math.PI * 2
          const mx = cx + ((Math.cos(a0) + Math.cos(a1)) / 2) * radius
          const mz = cz + ((Math.sin(a0) + Math.sin(a1)) / 2) * radius
          const [x, z] = local(p, mx, mz)
          const segYaw = Math.atan2(-(Math.sin(a1) - Math.sin(a0)), Math.cos(a1) - Math.cos(a0))
          out.push({ placeId: p.id, x, z, yaw: p.yaw + segYaw, scale: (2 * Math.PI * radius) / n * p.scale })
        }
      }
    } else if (p.kind === 'cemetery') {
      const w = 22
      const d = 15
      const run = (ax: number, az: number, bx: number, bz: number) => {
        const len = Math.hypot(bx - ax, bz - az)
        const n = Math.ceil(len / 3)
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n
          const [x, z] = local(p, ax + (bx - ax) * t, az + (bz - az) * t)
          out.push({ placeId: p.id, x, z, yaw: p.yaw + Math.atan2(-(bz - az), bx - ax), scale: (len / n) * p.scale })
        }
      }
      run(-w / 2, -d / 2, w / 2, -d / 2)
      run(-w / 2, d / 2, -3, d / 2)
      run(3, d / 2, w / 2, d / 2)
      run(-w / 2, -d / 2, -w / 2, d / 2)
      run(w / 2, -d / 2, w / 2, d / 2)
    } else if (p.kind === 'crossroads') {
      const run = (ax: number, az: number, bx: number, bz: number) => {
        const len = Math.hypot(bx - ax, bz - az)
        const n = Math.ceil(len / 3)
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n
          const [x, z] = local(p, ax + (bx - ax) * t, az + (bz - az) * t)
          out.push({ placeId: p.id, x, z, yaw: p.yaw + Math.atan2(-(bz - az), bx - ax), scale: (len / n) * p.scale })
        }
      }
      run(10, -12, 22, -12)
      run(22, -12, 22, -2)
      run(10, -2, 22, -2)
    }
  }
  return out
}

/** Cattle: a few in each ranch corral, a loose column on the drive. */
export function cattle(places: Place[], seed: number): Scatter[] {
  const rng = seededRng(seed * 31 + 77)
  const out: Scatter[] = []
  for (const p of places) {
    if (p.kind === 'ranch') {
      for (let i = 0; i < 6; i++) {
        const a = rng() * Math.PI * 2
        const r = rng() * 5.5
        const [x, z] = local(p, 10 + Math.cos(a) * r, 6 + Math.sin(a) * r)
        out.push({ placeId: p.id, x, z, yaw: rng() * Math.PI * 2, scale: (0.9 + rng() * 0.3) * p.scale })
      }
    } else if (p.kind === 'cattle-drive') {
      // Toybox-big so the column still reads as cattle at 300 m, strung out ahead of the dust.
      for (let i = 0; i < 30; i++) {
        const along = -26 + i * 1.9 + (rng() - 0.5) * 2
        const across = (rng() - 0.5) * 9
        const [x, z] = local(p, across, along)
        out.push({ placeId: p.id, x, z, yaw: p.yaw + Math.PI + (rng() - 0.5) * 0.5, scale: 1.2 + rng() * 0.35 })
      }
    }
  }
  return out
}

/** Cottonwoods by water and yards; a dead tree in each cemetery is in the static batch. */
export function trees(places: Place[], seed: number): Scatter[] {
  const rng = seededRng(seed * 47 + 5)
  const out: Scatter[] = []
  const spots: Partial<Record<PlaceKind, Array<[number, number]>>> = {
    ranch: [
      [-16, 10],
      [-20, -4],
      [20, -10],
    ],
    ferry: [
      [-12, 6],
      [13, -5],
      [-9, -9],
    ],
    crossroads: [
      [-12, 8],
      [14, 10],
    ],
    chapel: [
      [-9, -6],
      [10, 2],
    ],
    pueblo: [[14, -14]],
  }
  for (const p of places) {
    for (const [lx, lz] of spots[p.kind] ?? []) {
      const [x, z] = local(p, lx, lz)
      out.push({ placeId: p.id, x, z, yaw: rng() * Math.PI * 2, scale: (0.85 + rng() * 0.4) * p.scale })
    }
  }
  return out
}

/** Headstones and crosses inside the cemetery fences. */
export function graves(places: Place[], seed: number): Scatter[] {
  const rng = seededRng(seed * 71 + 3)
  const out: Scatter[] = []
  for (const p of places) {
    if (p.kind !== 'cemetery') continue
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        if (rng() < 0.15) continue
        const [x, z] = local(p, -8 + col * 4 + (rng() - 0.5) * 1.2, -4.5 + row * 4 + (rng() - 0.5) * 1.2)
        out.push({ placeId: p.id, x, z, yaw: p.yaw + (rng() - 0.5) * 0.4, scale: (0.8 + rng() * 0.5) * p.scale })
      }
    }
  }
  return out
}

/* ---------- motion sources ---------- */

export interface SmokeSource {
  placeId: string
  x: number
  dy: number
  z: number
  /** Dust plumes are tan and wide; chimney smoke is grey and thin. */
  dust: boolean
}

export function smokeSources(places: Place[]): SmokeSource[] {
  const out: SmokeSource[] = []
  for (const p of places) {
    if (!p.chimney) continue
    const [lx, ly, lz] = p.chimney
    const [x, z] = local(p, lx, lz)
    out.push({ placeId: p.id, x, dy: ly * p.scale, z, dust: p.kind === 'cattle-drive' })
  }
  return out
}

/** The two carts: one on the stage road, one on the long east apron lane. */
export function cartLanes(lanes: Lane[]): Lane[] {
  return ['stage-1', 'apron-east'].map((id) => lanes.find((lane) => lane.id === id)!)
}
