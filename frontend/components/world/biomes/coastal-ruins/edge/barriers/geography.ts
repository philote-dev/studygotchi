/**
 * Barriers and vistas: the pure plan. No three.js here; `../barriers/build.ts` turns it into geometry.
 *
 * The reachable coast is enclosed by in-world geography (Skyrim's walls, Journey's dunes, God of
 * War's framed vistas): on the sea side a broken ring of limestone sea stacks, needles, capes,
 * islets and arches stands 250–310 m out in open water; on the land side the authored escarpment
 * and the continuation hills do the barring. Four composed windows, one per outward pose, frame a
 * distant place you can see but never reach: north, a far acropolis on a hill through the hills'
 * saddle; east, a ruined lighthouse island; south, a harbour city in the haze; west, a monumental
 * sea arch. One light each at night.
 *
 * Camera geometry that shapes every number: FOV 27°, the outward poses look down 14–16°, so the
 * frame top is only 0.5–2.5° below the horizon. The ring base lands 20–30 % down the frame and the
 * vistas 310–500 m from their pose camera, inside the frame, hazed.
 */
import { type BiomeLayout, seeded } from '../../layout/biome-layout'
import { smoothstep } from '../../layout/terrain'
import { EDGE_POSES, type EdgePose, type EdgePoseId, edgePosePosition, viewBearingDeg } from '../poses'
import { ACROPOLIS_FROM_CAMERA, ACROPOLIS_TOP, acropolisSite, fbmN, outerLandField } from '../endless/outer-world'

export { viewBearingDeg }

/* ---------- camera frame maths ---------- */

/** The land camera: `STATIONS.*.fov` (27°) on a 16:9 capture. */
export const FRAME = { fovDeg: 27, aspect: 16 / 9 } as const

export interface Cam {
  x: number
  y: number
  z: number
}

export function poseCamera(pose: EdgePose): Cam {
  const [x, y, z] = edgePosePosition(pose)
  return { x, y, z }
}

export function wrapDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

export function bearingDeltaDeg(a: number, b: number): number {
  return Math.abs(wrapDeg(a - b))
}

export function bearingOf(x: number, z: number): number {
  return ((Math.atan2(x, z) * 180) / Math.PI + 360) % 360
}

/** Degrees below the horizontal from the camera to a point (positive = looking down). */
export function elevationDownDeg(cam: Cam, x: number, y: number, z: number): number {
  return (Math.atan2(cam.y - y, Math.hypot(x - cam.x, z - cam.z)) * 180) / Math.PI
}

export function frameTopDeg(pose: EdgePose): number {
  return pose.pitchDeg - FRAME.fovDeg / 2
}

export function frameBottomDeg(pose: EdgePose): number {
  return pose.pitchDeg + FRAME.fovDeg / 2
}

export function frameHalfWidthDeg(aspect: number = FRAME.aspect): number {
  return (Math.atan(Math.tan((FRAME.fovDeg * Math.PI) / 360) * aspect) * 180) / Math.PI
}

/** Horizontal angle of a point off the pose's view direction. */
export function lateralDeg(pose: EdgePose, x: number, z: number): number {
  const cam = poseCamera(pose)
  return bearingDeltaDeg(bearingOf(x - cam.x, z - cam.z), viewBearingDeg(pose))
}

/** Whether a world point lands inside the pose's frame, with a safety margin (degrees; negative widens the frame). */
export function inPoseFrame(pose: EdgePose, x: number, y: number, z: number, margin = 0.6, aspect: number = FRAME.aspect): boolean {
  const down = elevationDownDeg(poseCamera(pose), x, y, z)
  if (down < frameTopDeg(pose) + margin || down > frameBottomDeg(pose) - margin) return false
  return lateralDeg(pose, x, z) <= frameHalfWidthDeg(aspect) - margin
}

/* ---------- the ring ---------- */

/** Metres of open water every wall keeps from any coast (authored or continued). */
export const COAST_CLEARANCE = 40

/** Ring radius: wobbled so it is a coast and not a circle. */
const RING = { base: 278, wobble: 26 } as const

export function ringRadiusAt(bearingDeg: number, seed: number): number {
  const a = (bearingDeg * Math.PI) / 180
  const wobble = fbmN(Math.cos(a) * 2.1 + (seed % 97) * 0.37, Math.sin(a) * 2.1 + 3.3, 2) * 2 * RING.wobble
  return RING.base + wobble
}

export type VistaId = 'north' | 'east' | 'south' | 'west'

export interface VistaGap {
  id: VistaId
  poseId: EdgePoseId
  /** Bearing from the land centre (degrees from +z toward +x) of the window's centre. */
  bearingDeg: number
  halfWidthDeg: number
  /** Where the pose's view ray crosses the ring (the north ray crosses land; its gap is the hills' saddle). */
  crossing: [number, number]
}

const VISTA_POSES: Record<VistaId, EdgePoseId> = { north: 'north-out', east: 'east-out', south: 'south-out', west: 'west-out' }
const GAP_HALF_WIDTH: Record<VistaId, number> = { north: 11, east: 12, south: 12, west: 12 }

export function outwardPose(id: VistaId): EdgePose {
  return EDGE_POSES.find((pose) => pose.id === VISTA_POSES[id])!
}

/** Where a pose's centre view ray crosses the ring (iterated, since the radius depends on the bearing). */
export function ringCrossing(pose: EdgePose, seed: number): { x: number; z: number; bearingDeg: number; distance: number } {
  const cam = poseCamera(pose)
  const view = (viewBearingDeg(pose) * Math.PI) / 180
  const vx = Math.sin(view)
  const vz = Math.cos(view)
  let radius: number = RING.base
  let x = 0
  let z = 0
  let t = 0
  for (let i = 0; i < 4; i++) {
    const b = cam.x * vx + cam.z * vz
    const c = cam.x * cam.x + cam.z * cam.z - radius * radius
    t = -b + Math.sqrt(Math.max(0, b * b - c))
    x = cam.x + vx * t
    z = cam.z + vz * t
    radius = ringRadiusAt(bearingOf(x, z), seed)
  }
  return { x, z, bearingDeg: bearingOf(x, z), distance: t }
}

export function vistaGaps(seed: number): VistaGap[] {
  return (['north', 'east', 'south', 'west'] as VistaId[]).map((id) => {
    const pose = outwardPose(id)
    const crossing = ringCrossing(pose, seed)
    return { id, poseId: pose.id, bearingDeg: crossing.bearingDeg, halfWidthDeg: GAP_HALF_WIDTH[id], crossing: [crossing.x, crossing.z] }
  })
}

export function gapAt(gaps: VistaGap[], bearingDeg: number, extraDeg = 0): VistaGap | null {
  return gaps.find((gap) => bearingDeltaDeg(bearingDeg, gap.bearingDeg) <= gap.halfWidthDeg + extraDeg) ?? null
}

export type MassifKind = 'stack' | 'needle' | 'cape' | 'islet' | 'arch'

export interface Massif {
  kind: MassifKind
  x: number
  z: number
  /** Facing: local +z points away from the land. */
  yaw: number
  /** Footprint half-extents along the ring tangent (rx) and radially (rz), metres. */
  rx: number
  rz: number
  /** Top above sea level. The roots go under. */
  height: number
  /** Top polygon as a fraction of the base. */
  taper: number
  sides: number
  /** Scrub cap on top (stacks, capes, islets) or a bare needle tip. */
  cap: boolean
  /** 0 warm limestone, 1 pale weathered: alternated for rhythm. */
  tone: 0 | 1
  tilt: number
  /** Arch only: span between the legs. */
  span?: number
}

interface Pick {
  kind: MassifKind
  rx: [number, number]
  rz: [number, number]
  height: [number, number]
  taper: [number, number]
  sides: [number, number]
  cap: boolean
  weight: number
}

/** The coast's vocabulary. Heights in metres above the sea; the frame crops ~30 m and up at the ring. */
const VOCAB: Pick[] = [
  { kind: 'stack', rx: [4, 9], rz: [4, 8], height: [12, 26], taper: [0.55, 0.8], sides: [5, 7], cap: true, weight: 5 },
  { kind: 'needle', rx: [2.5, 5], rz: [2.5, 4.5], height: [24, 38], taper: [0.3, 0.5], sides: [5, 5], cap: false, weight: 2 },
  { kind: 'cape', rx: [20, 34], rz: [8, 13], height: [8, 16], taper: [0.8, 0.92], sides: [7, 9], cap: true, weight: 3 },
  { kind: 'islet', rx: [12, 22], rz: [9, 16], height: [4, 9], taper: [0.86, 0.95], sides: [6, 8], cap: true, weight: 3 },
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

/** True where a wall may stand: open sea, clear of every coast by `COAST_CLEARANCE` plus its own footprint. */
export function clearOfCoast(layout: BiomeLayout, x: number, z: number, footprint = 0): boolean {
  return outerLandField(layout, x, z) < -(COAST_CLEARANCE + footprint)
}

function placeOnRing(layout: BiomeLayout, bearingDeg: number, radius: number, footprint: number): { x: number; z: number; radius: number } | null {
  const a = (bearingDeg * Math.PI) / 180
  for (let push = 0; push < 4; push++) {
    const r = radius + push * 10
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    if (clearOfCoast(layout, x, z, footprint)) return { x, z, radius: r }
  }
  return null
}

/**
 * Walk the ring and drop massifs in clusters with sea between them, skipping the windows and
 * standing a tall stack on each side of every sea window so it reads as a frame, not a missing tooth.
 * Where the ring meets land (the whole north) nothing is placed: the hills bar that side.
 */
export function ringMassifs(layout: BiomeLayout, seed: number, gaps: VistaGap[]): Massif[] {
  const rng = seeded(seed * 13 + 101)
  const out: Massif[] = []
  const tooClose = (x: number, z: number, rx: number, rz: number) =>
    out.some((m) => Math.hypot(m.x - x, m.z - z) < Math.min(m.rx, m.rz) * 0.5 + Math.min(rx, rz) * 0.5 + 3)
  const add = (kind: MassifKind, bearingDeg: number, p: Pick | null, overrides: Partial<Massif> = {}, radiusOffset = 0) => {
    const rx = overrides.rx ?? (p ? range(rng, p.rx) : 12)
    const rz = overrides.rz ?? (p ? range(rng, p.rz) : 8)
    const spot = placeOnRing(layout, bearingDeg, ringRadiusAt(bearingDeg, seed) + radiusOffset, Math.max(rx, rz) + 2)
    if (!spot || tooClose(spot.x, spot.z, rx, rz)) return
    const a = (bearingDeg * Math.PI) / 180
    out.push({
      kind,
      x: spot.x,
      z: spot.z,
      yaw: a + (rng() - 0.5) * 0.5,
      rx,
      rz,
      height: overrides.height ?? (p ? range(rng, p.height) : 20),
      taper: overrides.taper ?? (p ? range(rng, p.taper) : 0.7),
      sides: overrides.sides ?? (p ? Math.round(range(rng, p.sides)) : 6),
      cap: overrides.cap ?? p?.cap ?? true,
      tone: overrides.tone ?? ((rng() < 0.6 ? 0 : 1) as 0 | 1),
      tilt: overrides.tilt ?? (rng() - 0.5) * 0.1,
      ...(overrides.span !== undefined ? { span: overrides.span } : {}),
    })
  }

  // Window frames first: a lip stack, a tall stack hard against it and a second piece behind, so
  // each window is cut through a wall two pieces deep. The seaward frame of the west and east
  // windows is a sea-stack arch (their landward sides run into the mainland shore).
  const west = gaps.find((g) => g.id === 'west')!
  const east = gaps.find((g) => g.id === 'east')!
  for (const gap of gaps) {
    if (gap.id === 'north') continue
    for (const side of [-1, 1]) {
      const lip = gap.bearingDeg + side * (gap.halfWidthDeg + 1.5)
      const frame = gap.bearingDeg + side * (gap.halfWidthDeg + 6.5)
      const back = gap.bearingDeg + side * (gap.halfWidthDeg + 15)
      if ((gap === west && side === 1) || (gap === east && side === -1)) {
        add('stack', lip, VOCAB[0], { height: 12 + rng() * 4, rx: 4 + rng() * 2, rz: 4 + rng() * 2 })
        add('arch', frame, null, { rx: 16, rz: 7, height: 19 + rng() * 3, taper: 1, sides: 7, cap: true, tone: 0, tilt: 0, span: 22 }, 4)
        add('stack', back, VOCAB[0], { height: 20 + rng() * 6 }, 12)
        continue
      }
      add('stack', lip, VOCAB[0], { height: 12 + rng() * 5, rx: 4 + rng() * 2, rz: 4 + rng() * 2 })
      add('stack', frame, VOCAB[0], { rx: 7 + rng() * 2.5, rz: 6 + rng() * 2, height: 20 + rng() * 6, tone: 0, cap: true })
      if (rng() < 0.5) add('needle', back, VOCAB[1], {}, 10)
      else add('cape', back, VOCAB[2], { tone: 1 }, 14)
    }
  }

  // The rest of the coast: clusters of 2–5 pieces, open water between clusters, a second row
  // behind about half of them so the wall has depth. Bearings that land on land are skipped.
  const EXCLUDE = 20
  const south = gaps.find((g) => g.id === 'south')!
  let bearing = south.bearingDeg + south.halfWidthDeg + EXCLUDE
  const end = bearing + 360
  let archCount = 1
  while (bearing < end) {
    const b = bearing % 360
    const radius = ringRadiusAt(b, seed)
    const degPerMetre = 180 / (Math.PI * radius)
    const gap = gapAt(gaps.filter((g) => g.id !== 'north'), b, EXCLUDE)
    if (gap) {
      let next = gap.bearingDeg + gap.halfWidthDeg + EXCLUDE + 0.5
      while (next <= bearing) next += 360
      bearing = next
      continue
    }
    const clusterSize = 3 + Math.floor(rng() * 4)
    for (let i = 0; i < clusterSize && bearing < end; i++) {
      const p = pick(rng)
      const rxTry = range(rng, p.rx)
      const half = rxTry * degPerMetre
      const centre = (bearing + half) % 360
      if (gapAt(gaps.filter((g) => g.id !== 'north'), centre, EXCLUDE)) break
      if (archCount < 3 && p.kind === 'stack' && rng() < 0.22) {
        add('arch', centre, null, { rx: 14, rz: 6, height: 14 + rng() * 6, taper: 1, sides: 7, cap: true, tone: (rng() < 0.5 ? 0 : 1) as 0 | 1, tilt: 0, span: 16 + rng() * 10 })
        archCount++
      } else if (p.kind === 'islet') add(p.kind, centre, p, { rx: rxTry }, -(18 + rng() * 14))
      else add(p.kind, centre, p, { rx: rxTry })
      if (rng() < 0.7) {
        const q = rng() < 0.55 ? VOCAB[0] : rng() < 0.5 ? VOCAB[1] : VOCAB[2]
        const behind = (centre + (rng() - 0.5) * half * 1.2 + 360) % 360
        add(q.kind, behind, q, { tone: 1 }, 24 + rng() * 16)
      }
      bearing += (rxTry * 2 * (0.5 + rng() * 0.25) + 2) * degPerMetre
    }
    if (rng() < 0.5) bearing += (10 + rng() * 20) * degPerMetre
  }
  // A few low islets inside the ring line, in the bay itself, clear of the windows.
  for (let k = 0; k < 10 && out.filter((m) => m.kind === 'islet').length < 5; k++) {
    const b = (south.bearingDeg - 80 + rng() * 160 + 360) % 360
    if (gapAt(gaps.filter((g) => g.id !== 'north'), b, EXCLUDE)) continue
    add('islet', b, VOCAB[3], {}, -(30 + rng() * 40))
  }
  return out
}

/**
 * Whether the mainland coast itself frames the ring at a bearing: on the east and west the ring's
 * arc runs into the straight side coasts, and there the shore (with the authored islet stacks on
 * it) is the window's frame on that side.
 */
export function coastFramesBearing(layout: BiomeLayout, bearingDeg: number, seed: number): boolean {
  const a = (bearingDeg * Math.PI) / 180
  const r = ringRadiusAt(bearingDeg, seed)
  return outerLandField(layout, Math.sin(a) * r, Math.cos(a) * r) > -90
}

/* ---------- vistas ---------- */

export type VistaKind = 'acropolis' | 'lighthouse' | 'harbour-city' | 'sea-arch'

export interface Vista {
  id: VistaId
  kind: VistaKind
  x: number
  z: number
  /** Faces the pose camera. */
  yaw: number
  /** Silhouette top above the sea, metres. */
  height: number
  /** Metres from the pose camera along its centre ray. */
  fromCamera: number
  /** Metres from the land centre. */
  distance: number
  /** Exactly one light each at night. */
  lights: 1
}

const VISTA_SPEC: Record<VistaId, { kind: VistaKind; fromCamera: number; height: number }> = {
  north: { kind: 'acropolis', fromCamera: ACROPOLIS_FROM_CAMERA, height: ACROPOLIS_TOP },
  east: { kind: 'lighthouse', fromCamera: 420, height: 16 },
  south: { kind: 'harbour-city', fromCamera: 440, height: 17 },
  west: { kind: 'sea-arch', fromCamera: 380, height: 26 },
}

export function vistas(): Vista[] {
  const site = acropolisSite()
  return (['north', 'east', 'south', 'west'] as VistaId[]).map((id) => {
    const pose = outwardPose(id)
    const cam = poseCamera(pose)
    const spec = VISTA_SPEC[id]
    const view = (viewBearingDeg(pose) * Math.PI) / 180
    const x = id === 'north' ? site.x : cam.x + Math.sin(view) * spec.fromCamera
    const z = id === 'north' ? site.z : cam.z + Math.cos(view) * spec.fromCamera
    return {
      id,
      kind: spec.kind,
      x,
      z,
      yaw: Math.atan2(cam.x - x, cam.z - z),
      height: spec.height,
      fromCamera: Math.hypot(x - cam.x, z - cam.z),
      distance: Math.hypot(x, z),
      lights: 1,
    }
  })
}

/* ---------- the plan ---------- */

export interface BarrierPlan {
  gaps: VistaGap[]
  ring: Massif[]
  vistas: Vista[]
}

export function barrierPlan(layout: BiomeLayout, seed: number): BarrierPlan {
  const gaps = vistaGaps(seed)
  return { gaps, ring: ringMassifs(layout, seed, gaps), vistas: vistas() }
}

/** Distance from a point to the segment camera → vista (horizontal), for sightline checks. */
export function distanceToSightline(cam: Cam, vista: { x: number; z: number }, x: number, z: number): number {
  const dx = vista.x - cam.x
  const dz = vista.z - cam.z
  const len2 = dx * dx + dz * dz || 1
  const t = Math.min(1, Math.max(0, ((x - cam.x) * dx + (z - cam.z) * dz) / len2))
  return Math.hypot(cam.x + dx * t - x, cam.z + dz * t - z)
}

/** Keep-clear discs for the far island scatter: every vista and a corridor along each sightline. */
export function vistaKeepClear(plan: BarrierPlan): Array<{ x: number; z: number; r: number }> {
  const out: Array<{ x: number; z: number; r: number }> = []
  for (const vista of plan.vistas) {
    out.push({ x: vista.x, z: vista.z, r: 130 })
    const cam = poseCamera(outwardPose(vista.id))
    const steps = Math.ceil(vista.fromCamera / 40)
    for (let i = 1; i < steps; i++) {
      const k = i / steps
      out.push({ x: cam.x + (vista.x - cam.x) * k, z: cam.z + (vista.z - cam.z) * k, r: 40 + 50 * k })
    }
  }
  return out
}

export { smoothstep }
