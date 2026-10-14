/**
 * Barriers and vistas: the pure plan. No three.js here; `build.ts` turns it into geometry and
 * `../outer/heightfield.ts` reads the gaps, the gorge and the volcano so the land agrees with it.
 *
 * The idea (Skyrim's mountain walls, Journey's dunes, God of War's framed vistas): the reachable
 * land is enclosed by in-world geography — a rounded-square wall of waterfall cliffs and giant
 * buttress-root trees standing 46–60 m outside the plate — and four composed gaps in that wall,
 * one per outward comparison pose, frame distant places the player can see but never reach: a
 * stepped temple on a far ridge (north), a river delta opening to a hazy sea (east), a rope
 * bridge over a gorge (south) and a volcano with a plume (west). Each has one light at night.
 *
 * Camera frame that shapes the numbers: FOV 34°, the outward poses look down 14–16°, so the
 * frame top sits 1–3° above the horizon. Wall tops at 22–40 m stand 250–300 m from the pose
 * cameras (in frame, framing the window); the landmarks stand 350–450 m out, hazed.
 */
import { JUNGLE_LAYOUT as L, seeded } from '../../layout/jungle-layout'
import { polylineDistance } from '../../layout/placements'
import { JUNGLE_FRAME } from '../../camera/stations'
import { arcNoise, bearingDeltaDeg, bearingOf, chebyshev, smoothstep } from '../noise'
import { EDGE_POSES, type EdgePose, type EdgePoseId, edgePosePosition, viewBearingDeg } from '../poses'

/* ---------- camera frame maths ---------- */

export interface Cam {
  x: number
  y: number
  z: number
}

export function poseCamera(pose: EdgePose): Cam {
  const [x, y, z] = edgePosePosition(pose)
  return { x, y, z }
}

/** Degrees below the horizontal from the camera to a point (positive = looking down). */
export function elevationDownDeg(cam: Cam, x: number, y: number, z: number): number {
  return (Math.atan2(cam.y - y, Math.hypot(x - cam.x, z - cam.z)) * 180) / Math.PI
}

export function frameTopDeg(pose: EdgePose): number {
  return pose.pitchDeg - pose.fov / 2
}

export function frameBottomDeg(pose: EdgePose): number {
  return pose.pitchDeg + pose.fov / 2
}

export function frameHalfWidthDeg(pose: EdgePose): number {
  return (Math.atan(Math.tan((pose.fov * Math.PI) / 360) * JUNGLE_FRAME.aspect) * 180) / Math.PI
}

/** Horizontal angle of a point off the pose's view direction. */
export function lateralDeg(pose: EdgePose, x: number, z: number): number {
  const cam = poseCamera(pose)
  return bearingDeltaDeg(bearingOf(x - cam.x, z - cam.z), viewBearingDeg(pose))
}

/** Whether a world point lands inside the pose's frame, with a safety margin (degrees). */
export function inPoseFrame(pose: EdgePose, x: number, y: number, z: number, margin = 0.6): boolean {
  const down = elevationDownDeg(poseCamera(pose), x, y, z)
  if (down < frameTopDeg(pose) + margin || down > frameBottomDeg(pose) - margin) return false
  return lateralDeg(pose, x, z) <= frameHalfWidthDeg(pose) - margin
}

/* ---------- the wall ---------- */

export const PLATE_HALF = L.worldExtent

/**
 * The wall follows the plate as a rounded square: this Chebyshev distance, wobbled per bearing.
 * Its nearest foot stays ≥ 242 m out: the product overview's frame top meets the ground 40 m past
 * the plate (z = −230), so the wall never shows in the overview and that pose stays pixel-identical
 * to the land as shipped.
 */
const WALL = { base: 252, wobble: 10 } as const

/** Metres every wall piece keeps from the outer river's centreline. */
export const RIVER_CLEARANCE = 26

export function wallChebAt(bearingDeg: number, seed: number): number {
  return WALL.base + WALL.wobble * (2 * arcNoise(bearingDeg, 2.1, (seed % 97) * 0.37, 2) - 1)
}

/** The point at Chebyshev distance `cheb` along a bearing. */
export function pointAtCheb(bearingDeg: number, cheb: number): [number, number] {
  const a = (bearingDeg * Math.PI) / 180
  const sx = Math.sin(a)
  const cz = Math.cos(a)
  const t = cheb / Math.max(Math.abs(sx), Math.abs(cz))
  return [sx * t, cz * t]
}

export type VistaId = 'north' | 'east' | 'south' | 'west'

export interface VistaGap {
  id: VistaId
  poseId: EdgePoseId
  /** Bearing from the land centre of the window's centre. */
  bearingDeg: number
  /** Half-width of the opening in the wall, degrees of bearing. */
  halfWidthDeg: number
  /** Where the pose's centre ray crosses the wall. */
  crossing: [number, number]
  /** Metres from the pose camera to the crossing. */
  distance: number
}

const VISTA_POSES: Record<VistaId, EdgePoseId> = { north: 'north-out', east: 'east-out', south: 'south-out', west: 'west-out' }
const GAP_HALF_WIDTH: Record<VistaId, number> = { north: 10, east: 12, south: 10, west: 10 }

export function outwardPose(id: VistaId): EdgePose {
  return EDGE_POSES.find((pose) => pose.id === VISTA_POSES[id])!
}

/** Where a pose's centre view ray crosses the wall (iterated: the wall's distance depends on the crossing's bearing). */
export function wallCrossing(pose: EdgePose, seed: number): { x: number; z: number; bearingDeg: number; distance: number } {
  const cam = poseCamera(pose)
  const view = (viewBearingDeg(pose) * Math.PI) / 180
  const vx = Math.sin(view)
  const vz = Math.cos(view)
  let cheb: number = WALL.base
  let x = cam.x
  let z = cam.z
  let t = 0
  for (let i = 0; i < 6; i++) {
    // March along the ray until Chebyshev distance reaches `cheb`.
    let lo = 0
    let hi = 1200
    for (let k = 0; k < 40; k++) {
      t = (lo + hi) / 2
      if (chebyshev(cam.x + vx * t, cam.z + vz * t) < cheb) lo = t
      else hi = t
    }
    x = cam.x + vx * t
    z = cam.z + vz * t
    cheb = wallChebAt(bearingOf(x, z), seed)
  }
  return { x, z, bearingDeg: bearingOf(x, z), distance: t }
}

export function vistaGaps(seed: number): VistaGap[] {
  return (['north', 'east', 'south', 'west'] as VistaId[]).map((id) => {
    const pose = outwardPose(id)
    const crossing = wallCrossing(pose, seed)
    return { id, poseId: pose.id, bearingDeg: crossing.bearingDeg, halfWidthDeg: GAP_HALF_WIDTH[id], crossing: [crossing.x, crossing.z], distance: crossing.distance }
  })
}

export function gapAt(gaps: readonly VistaGap[], bearingDeg: number, extraDeg = 0): VistaGap | null {
  return gaps.find((gap) => bearingDeltaDeg(bearingDeg, gap.bearingDeg) <= gap.halfWidthDeg + extraDeg) ?? null
}

/** 1 inside a window (plus a soft shoulder), 0 in the wall; what the heightfield rows use to open their saddles. */
export function windowFactor(gaps: readonly VistaGap[], bearingDeg: number, shoulderDeg = 8): number {
  let best = 0
  for (const gap of gaps) {
    const delta = bearingDeltaDeg(bearingDeg, gap.bearingDeg)
    best = Math.max(best, 1 - smoothstep(gap.halfWidthDeg, gap.halfWidthDeg + shoulderDeg, delta))
  }
  return best
}

/* ---------- massifs ---------- */

export type MassifKind = 'cliff' | 'buttress' | 'stack' | 'mound'

export interface Massif {
  kind: MassifKind
  x: number
  z: number
  /** Facing: local +z points away from the land. */
  yaw: number
  /** Footprint half-extents along the wall (rx) and radially (rz). */
  rx: number
  rz: number
  /** Top above the local ground. */
  height: number
  taper: number
  sides: number
  /** Cliffs only: a white fall down the land-facing face. */
  fall: boolean
  /** 0 mossy green-grey, 1 darker wet rock. */
  tone: 0 | 1
  tilt: number
}

interface Pick {
  kind: MassifKind
  rx: [number, number]
  rz: [number, number]
  height: [number, number]
  taper: [number, number]
  sides: [number, number]
  weight: number
}

/** The wall's vocabulary. Heights are metres above the ground at the foot. */
const VOCAB: Pick[] = [
  { kind: 'cliff', rx: [20, 36], rz: [9, 15], height: [22, 36], taper: [0.74, 0.9], sides: [7, 9], weight: 5 },
  { kind: 'buttress', rx: [3.2, 4.6], rz: [3.2, 4.6], height: [34, 48], taper: [0.5, 0.62], sides: [6, 7], weight: 3 },
  { kind: 'stack', rx: [5, 8], rz: [5, 8], height: [12, 22], taper: [0.45, 0.7], sides: [5, 6], weight: 2 },
  { kind: 'mound', rx: [24, 40], rz: [14, 22], height: [8, 14], taper: [0.8, 0.92], sides: [6, 7], weight: 3 },
]

function range(rng: () => number, [a, b]: [number, number]): number {
  return a + rng() * (b - a)
}

function pick(rng: () => number): Pick {
  const total = VOCAB.reduce((s, p) => s + p.weight, 0)
  let roll = rng() * total
  for (const p of VOCAB) {
    roll -= p.weight
    if (roll <= 0) return p
  }
  return VOCAB[0]
}

/** Outer river centreline the walls and scatter keep clear of (continues the authored outflow from (116, 46)). */
export const OUTER_RIVER: ReadonlyArray<readonly [number, number]> = [
  [116, 46],
  [150, 52],
  [190, 57],
  [236, 66],
  [286, 82],
  [340, 92],
  [400, 110],
  [470, 118],
  [540, 134],
  [610, 150],
  [700, 166],
]

/** Two side channels fanning from the delta apex (380, 104) to the coast; the sea swallows their ends. */
export const DELTA_CHANNELS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [380, 104],
    [440, 86],
    [510, 62],
    [580, 48],
    [720, 30],
  ],
  [
    [380, 104],
    [430, 140],
    [500, 182],
    [570, 214],
    [720, 236],
  ],
]

/** Distance to the main channel's centreline. */
export function riverDistance(x: number, z: number): number {
  return polylineDistance(OUTER_RIVER, x, z)
}

/** Distance to the nearest of the main channel and the delta channels (the valley follows all three). */
export function channelDistance(x: number, z: number): number {
  let best = polylineDistance(OUTER_RIVER, x, z)
  for (const channel of DELTA_CHANNELS) best = Math.min(best, polylineDistance(channel, x, z))
  return best
}

/** True where a wall piece may stand: outside the plate by its footprint and clear of the river. */
export function clearForWall(x: number, z: number, footprint: number): boolean {
  if (chebyshev(x, z) < PLATE_HALF + footprint + 4) return false
  return riverDistance(x, z) > RIVER_CLEARANCE + footprint
}

/**
 * Walk the wall and drop massifs in clusters, skipping the four windows and standing a cliff
 * and a buttress tree on each side of every window so it reads as a frame, not a missing tooth.
 */
export function wallMassifs(seed: number, gaps: readonly VistaGap[]): Massif[] {
  const rng = seeded(seed * 13 + 101)
  const out: Massif[] = []
  const tooClose = (x: number, z: number, rx: number, rz: number) =>
    out.some((m) => Math.hypot(m.x - x, m.z - z) < Math.min(m.rx, m.rz) * 0.6 + Math.min(rx, rz) * 0.6 + 2)
  const add = (kind: MassifKind, bearingDeg: number, p: Pick | null, overrides: Partial<Massif> = {}, chebOffset = 0): void => {
    const rx = overrides.rx ?? (p ? range(rng, p.rx) : 20)
    const rz = overrides.rz ?? (p ? range(rng, p.rz) : 12)
    const footprint = Math.max(rx, rz)
    let spot: [number, number] | null = null
    for (let push = 0; push < 8 && !spot; push++) {
      const candidate = pointAtCheb(bearingDeg, wallChebAt(bearingDeg, seed) + chebOffset + push * 10)
      if (clearForWall(candidate[0], candidate[1], footprint)) spot = candidate
    }
    if (!spot || tooClose(spot[0], spot[1], rx, rz)) return
    const a = (bearingDeg * Math.PI) / 180
    out.push({
      kind,
      x: spot[0],
      z: spot[1],
      yaw: a + (rng() - 0.5) * 0.4,
      rx,
      rz,
      height: overrides.height ?? (p ? range(rng, p.height) : 28),
      taper: overrides.taper ?? (p ? range(rng, p.taper) : 0.8),
      sides: overrides.sides ?? (p ? Math.round(range(rng, p.sides)) : 7),
      fall: overrides.fall ?? (kind === 'cliff' && rng() < 0.4),
      tone: overrides.tone ?? ((rng() < 0.6 ? 0 : 1) as 0 | 1),
      tilt: overrides.tilt ?? (rng() - 0.5) * 0.08,
    })
  }

  // Window frames first: a tall fall-cliff hard against each lip and a buttress tree behind it.
  for (const gap of gaps) {
    for (const side of [-1, 1]) {
      const lip = gap.bearingDeg + side * (gap.halfWidthDeg + 4.5)
      const back = gap.bearingDeg + side * (gap.halfWidthDeg + 11)
      add('cliff', lip, VOCAB[0], { rx: 24 + rng() * 6, rz: 11 + rng() * 3, height: 28 + rng() * 8, fall: side === 1, tone: 0 })
      add('buttress', back, VOCAB[1], { height: 40 + rng() * 8 }, 14)
    }
  }

  // The rest of the wall: clusters of 2–5 pieces with forest between, a second row behind half.
  const EXCLUDE = 16
  const south = gaps.find((g) => g.id === 'south')!
  let bearing = south.bearingDeg + south.halfWidthDeg + EXCLUDE
  const end = bearing + 360
  let guard = 0
  while (bearing < end && guard++ < 400) {
    const b = bearing % 360
    const [px, pz] = pointAtCheb(b, wallChebAt(b, seed))
    const radius = Math.hypot(px, pz)
    const degPerMetre = 180 / (Math.PI * radius)
    const gap = gapAt(gaps, b, EXCLUDE)
    if (gap) {
      let next = gap.bearingDeg + gap.halfWidthDeg + EXCLUDE + 0.5
      while (next <= bearing) next += 360
      bearing = next
      continue
    }
    const clusterSize = 2 + Math.floor(rng() * 4)
    for (let i = 0; i < clusterSize && bearing < end; i++) {
      const p = pick(rng)
      const rxTry = range(rng, p.rx)
      const half = rxTry * degPerMetre
      const centre = (bearing + half) % 360
      if (gapAt(gaps, centre, EXCLUDE)) break
      add(p.kind, centre, p, { rx: rxTry })
      if (rng() < 0.55) {
        const q = rng() < 0.5 ? VOCAB[0] : rng() < 0.5 ? VOCAB[1] : VOCAB[3]
        const behind = (centre + (rng() - 0.5) * half + 360) % 360
        add(q.kind, behind, q, { tone: 1 }, 28 + rng() * 16)
      }
      bearing += (rxTry * 2 * (0.6 + rng() * 0.3) + 3) * degPerMetre
    }
    if (rng() < 0.5) bearing += (10 + rng() * 22) * degPerMetre
  }
  return out
}

/* ---------- vistas ---------- */

export type VistaKind = 'temple' | 'delta' | 'bridge' | 'volcano'

export interface Vista {
  id: VistaId
  kind: VistaKind
  /** Landmark centre (the crater for the volcano, the gorge centre for the bridge). */
  x: number
  z: number
  /** Faces the pose camera. */
  yaw: number
  /** Silhouette height above its ground, metres. */
  height: number
  /** Metres from the pose camera along its centre ray. */
  fromCamera: number
  /** Metres from the land centre. */
  distance: number
  light: 'torch' | 'lantern' | 'ember' | 'beacon'
}

/** Per window: how far along the pose's centre ray the landmark stands and how tall it is. */
const VISTA_SPEC: Record<VistaId, { kind: VistaKind; fromCamera: number; height: number; light: Vista['light'] }> = {
  north: { kind: 'temple', fromCamera: 355, height: 24, light: 'torch' },
  east: { kind: 'delta', fromCamera: 400, height: 15, light: 'beacon' },
  south: { kind: 'bridge', fromCamera: 345, height: 18, light: 'lantern' },
  // At 14° down with a 34° frame only 3° of sky is in frame: a 1.2 km volcano can be 64 m tall
  // before its summit is cropped; the plume rises out of the frame, which reads as the volcano.
  west: { kind: 'volcano', fromCamera: 1180, height: 64, light: 'ember' },
}

export function vistas(): Vista[] {
  return (['north', 'east', 'south', 'west'] as VistaId[]).map((id) => {
    const pose = outwardPose(id)
    const cam = poseCamera(pose)
    const spec = VISTA_SPEC[id]
    const view = (viewBearingDeg(pose) * Math.PI) / 180
    const x = cam.x + Math.sin(view) * spec.fromCamera
    const z = cam.z + Math.cos(view) * spec.fromCamera
    return { id, kind: spec.kind, x, z, yaw: Math.atan2(cam.x - x, cam.z - z), height: spec.height, fromCamera: spec.fromCamera, distance: Math.hypot(x, z), light: spec.light }
  })
}

export function vistaOf(id: VistaId): Vista {
  return vistas().find((v) => v.id === id)!
}

/**
 * The gorge the south rope bridge spans: a canyon running along the south-out view ray (so it
 * recedes from the camera) centred on the vista; the bridge crosses it left to right, side-on.
 */
export interface Gorge {
  x: number
  z: number
  /** Direction along the trench (toward the pose camera). */
  yaw: number
  halfLength: number
  halfWidth: number
  depth: number
}

export function gorge(): Gorge {
  const v = vistaOf('south')
  return { x: v.x, z: v.z, yaw: v.yaw, halfLength: 52, halfWidth: 16, depth: 28 }
}

/** The volcano: a cone added to the heightfield at the west vista, its crater glowing at night. */
export interface Volcano {
  x: number
  z: number
  radius: number
  height: number
  craterRadius: number
}

export function volcano(): Volcano {
  const v = vistaOf('west')
  return { x: v.x, z: v.z, radius: 190, height: v.height, craterRadius: 16 }
}

/** Where the east river opens into the sea: the shoreline's x at a given z (wobbled), and the delta's apex. */
export const SHORE = { x: 640, wobble: 60, deltaApexX: 380 } as const

/* ---------- the plan ---------- */

export interface BarrierPlan {
  gaps: VistaGap[]
  wall: Massif[]
  vistas: Vista[]
  gorge: Gorge
  volcano: Volcano
}

export function barrierPlan(seed: number): BarrierPlan {
  const gaps = vistaGaps(seed)
  return { gaps, wall: wallMassifs(seed, gaps), vistas: vistas(), gorge: gorge(), volcano: volcano() }
}

/** Distance from a point to the horizontal segment camera → vista, for sightline checks. */
export function distanceToSightline(cam: Cam, vista: Vista, x: number, z: number): number {
  const dx = vista.x - cam.x
  const dz = vista.z - cam.z
  const len2 = dx * dx + dz * dz || 1
  const t = Math.min(1, Math.max(0, ((x - cam.x) * dx + (z - cam.z) * dz) / len2))
  return Math.hypot(cam.x + dx * t - x, cam.z + dz * t - z)
}
