/**
 * Barriers and vistas: the pure plan. No three.js here; `../barriers/build.ts` turns it into
 * geometry and `../outer.tsx` renders it.
 *
 * The reachable land is enclosed by geography (Skyrim's mountain walls, God of War's framed
 * vistas): the authored mountain rows to the north, basalt column palisades east and west, the
 * fjord's own walls continuing up the arm to a glacier front, and the sea to the south. Four
 * composed windows, one per outward pose, frame a place you can see but never reach, each with
 * exactly one light at night.
 *
 * Camera geometry that shapes every number: FOV 26°, the outward poses look down 14–15°, so the
 * frame top is 1–2° below the horizon. The walls stand 300–315 m from their pose camera (their
 * tops 20–26 m, under the frame top there), the vistas 400–610 m along the centre ray.
 */
import { seeded } from '../../layout/biome-layout'
import { fbm, smoothstep } from '../../layout/noise'
import { EDGE_POSES, type EdgePose, type EdgePoseId, edgePosePosition } from '../poses'
import { ARM, CHURCH_HILL, GEYSER_FIELD, HEADLANDS, VOLCANO, armCentre, armHalfWidth, type OuterWorld } from '../outer/outer-world'

/* ---------- camera frame maths ---------- */

/** The lab camera: `STATIONS.overview.fov` on a 16:9 capture. */
export const FRAME = { fovDeg: 26, aspect: 16 / 9 } as const

export interface Cam {
  x: number
  y: number
  z: number
}

export function poseCamera(pose: EdgePose): Cam {
  const [x, y, z] = edgePosePosition(pose)
  return { x, y, z }
}

/** Direction the pose looks (camera → target), degrees from +z toward +x. */
export function viewBearingDeg(pose: EdgePose): number {
  return (pose.azimuthDeg + 180) % 360
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

export function frameHalfWidthDeg(): number {
  return (Math.atan(Math.tan((FRAME.fovDeg * Math.PI) / 360) * FRAME.aspect) * 180) / Math.PI
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
  return lateralDeg(pose, x, z) <= frameHalfWidthDeg() - margin
}

/** A point along a pose's centre ray, `along` metres from the camera (horizontal). */
export function alongRay(pose: EdgePose, along: number): [number, number] {
  const cam = poseCamera(pose)
  const view = (viewBearingDeg(pose) * Math.PI) / 180
  return [cam.x + Math.sin(view) * along, cam.z + Math.cos(view) * along]
}

/* ---------- massifs ---------- */

export type MassifKind = 'column' | 'wall' | 'serac' | 'talus'

export interface Massif {
  kind: MassifKind
  x: number
  z: number
  /** Facing: local +z points away from the land. */
  yaw: number
  /** Footprint half-extents along the local x and z, metres. */
  rx: number
  rz: number
  /** Ground height under the massif (its base is planted here, roots below). */
  seatY: number
  /** Top above the seat. */
  height: number
  sides: number
  /** 0 / 1 alternation for tone. */
  tone: 0 | 1
  tilt: number
  /** Columns: moss cap on top. Seracs: blue crevasse face. */
  cap: boolean
}

export type VistaId = 'north' | 'east' | 'south' | 'west'
export type VistaKind = 'volcano' | 'geysers' | 'longhouse' | 'church'

export interface Vista {
  id: VistaId
  kind: VistaKind
  poseId: EdgePoseId
  /** Where the place stands (world). */
  x: number
  z: number
  /** Ground height there. */
  seatY: number
  /** Faces the pose camera. */
  yaw: number
  /** Silhouette top above the seat. */
  height: number
  /** Metres from the pose camera along its centre ray. */
  fromCamera: number
  /** The one light at night (world). */
  lamp: [number, number, number]
  light: 'ember' | 'aqua' | 'warm'
}

export interface Window {
  id: VistaId
  poseId: EdgePoseId
  /** Lateral half-width of the clear sector around the pose's centre ray, metres at the wall. */
  halfWidth: number
  /** Where the pose's centre ray crosses the wall line. */
  crossing: [number, number]
}

export const VISTA_POSES: Record<VistaId, EdgePoseId> = { north: 'north-out', east: 'east-out', south: 'south-out', west: 'west-out' }

export function outwardPose(id: VistaId): EdgePose {
  return EDGE_POSES.find((pose) => pose.id === VISTA_POSES[id])!
}

/* ---------- palisades ---------- */

/** The east and west palisade lines: x = ±(PALISADE.x + wobble), z from `from` to `to`; columns packed tighter than their diameter so the wall is fluted, not a comb. */
export const PALISADE = { x: 302, from: -330, to: 230, spacing: 4.1, rows: 3, windowHalf: 34 } as const

function palisadeX(side: 1 | -1, z: number, seed: number): number {
  return side * (PALISADE.x + 16 * fbm(z * 0.01 + (seed % 13) * 0.7, side * 2.2, 2))
}

/** Tallest column: under the frame top of the east / west poses where the palisade stands (≈ 37 m). */
export const COLUMN_MAX_HEIGHT = 27

/** Column heights: a slow swell, chunky steps, taller lips at the window, tapering to the ends. */
function columnHeight(z: number, windowZ: number, seed: number, rng: () => number): number {
  const swell = 15 + 5 * Math.sin(z / 41 + seed * 0.1)
  const step = Math.round(fbm(z * 0.03 + 7, seed * 0.3, 2) * 10) * 0.9
  const lip = 7 * (1 - smoothstep(PALISADE.windowHalf + 2, PALISADE.windowHalf + 26, Math.abs(z - windowZ)))
  const end = Math.min(1, smoothstep(PALISADE.from, PALISADE.from + 60, z), smoothstep(PALISADE.to, PALISADE.to - 60, z))
  return Math.min(COLUMN_MAX_HEIGHT, Math.max(4, (swell + step + lip + rng() * 1.6) * (0.35 + 0.65 * end)))
}

export function palisadeColumns(world: OuterWorld, side: 1 | -1, windowZ: number, seed: number): Massif[] {
  const rng = seeded(seed * 17 + (side > 0 ? 3 : 5))
  const out: Massif[] = []
  const rowScale = [1, 0.86, 0.72]
  for (let row = 0; row < PALISADE.rows; row++) {
    for (let z = PALISADE.from + (row % 2) * (PALISADE.spacing / 2); z <= PALISADE.to; z += PALISADE.spacing) {
      if (Math.abs(z - windowZ) < PALISADE.windowHalf) continue
      const r = 2.3 + rng() * 0.6
      const x = palisadeX(side, z, seed) + side * row * 4.4 + (rng() - 0.5) * 0.8
      const zz = z + (rng() - 0.5) * 0.8
      const seatY = world.heightAt(x, zz)
      out.push({
        kind: 'column',
        x,
        z: zz,
        yaw: rng() * Math.PI,
        rx: r,
        rz: r,
        seatY,
        height: Math.max(3.2, columnHeight(z, windowZ, seed, rng) * rowScale[row]),
        sides: 6,
        tone: (rng() < 0.5 ? 0 : 1) as 0 | 1,
        tilt: (rng() - 0.5) * 0.04,
        cap: rng() < 0.45,
      })
    }
  }
  // Talus at the foot of the front row, land side: a low scree fan every few columns.
  for (let z = PALISADE.from + 6; z <= PALISADE.to; z += 22 + rng() * 10) {
    if (Math.abs(z - windowZ) < PALISADE.windowHalf + 4) continue
    const x = palisadeX(side, z, seed) - side * 5.5
    out.push({ kind: 'talus', x, z, yaw: rng() * Math.PI, rx: 6 + rng() * 4, rz: 4 + rng() * 2, seatY: world.heightAt(x, z), height: 2.2 + rng() * 1.6, sides: 6, tone: 0, tilt: 0, cap: false })
  }
  return out
}

/* ---------- fjord walls and the glacier front ---------- */

/** Cliff massifs on both banks of the arm, continuing the authored fjord walls to the glacier. */
export function fjordWalls(world: OuterWorld, seed: number): Massif[] {
  const rng = seeded(seed * 19 + 23)
  const out: Massif[] = []
  for (let i = 0; i < 4; i++) {
    const z = -224 - i * 30 + (rng() - 0.5) * 8
    for (const side of [-1, 1] as const) {
      const rx = 13 + rng() * 6
      const rz = 11 + rng() * 4
      const x = armCentre(z) + side * (armHalfWidth(z) + 12 + rx)
      const seatY = world.heightAt(x, z)
      out.push({
        kind: 'wall',
        x,
        z,
        yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        rx,
        rz,
        seatY,
        height: 30 + rng() * 14 + i * 2,
        sides: 7 + Math.round(rng() * 2),
        tone: ((i + (side > 0 ? 1 : 0)) % 2) as 0 | 1,
        tilt: (rng() - 0.5) * 0.08,
        cap: false,
      })
    }
  }
  return out
}

/** Sérac blocks across the arm head: the glacier's terminus, calving into the fjord. */
export function glacierFront(world: OuterWorld, seed: number): Massif[] {
  const rng = seeded(seed * 29 + 31)
  const out: Massif[] = []
  const z = ARM.zHead - 2
  const centre = armCentre(ARM.zHead)
  const span = armHalfWidth(ARM.zHead) + 9
  const n = 7
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const x = centre - span + t * span * 2
    const zz = z - 3 - Math.abs(t - 0.5) * 10 + (rng() - 0.5) * 3
    const rx = 5 + rng() * 1.5
    out.push({
      kind: 'serac',
      x,
      z: zz,
      yaw: (rng() - 0.5) * 0.5,
      rx,
      rz: 6 + rng() * 2,
      seatY: Math.max(world.heightAt(x, zz), -0.85),
      height: 15 + rng() * 5 + 2 * (1 - Math.abs(t - 0.5) * 2),
      sides: 6 + Math.round(rng()),
      tone: (i % 2) as 0 | 1,
      tilt: (rng() - 0.5) * 0.06,
      cap: rng() < 0.5,
    })
  }
  return out
}

/* ---------- vistas ---------- */

export function vistas(world: OuterWorld): Vista[] {
  const out: Vista[] = []
  // North: the volcano is a landform of the outer world; the vista record carries its summit and ember.
  {
    const pose = outwardPose('north')
    const cam = poseCamera(pose)
    const top = world.sample(VOLCANO.x, VOLCANO.z - VOLCANO.craterRadius - 2)
    // Seat: the moor at the volcano's south-east foot (the south foot itself is the arm head).
    const seat = world.heightAt(VOLCANO.x + 100, VOLCANO.z + 95)
    const lampR = VOLCANO.radius * 0.22
    const b = (VOLCANO.notchBearing * Math.PI) / 180
    const lx = VOLCANO.x + Math.sin(b) * lampR
    const lz = VOLCANO.z + Math.cos(b) * lampR
    out.push({
      id: 'north',
      kind: 'volcano',
      poseId: pose.id,
      x: VOLCANO.x,
      z: VOLCANO.z,
      seatY: seat,
      yaw: Math.atan2(cam.x - VOLCANO.x, cam.z - VOLCANO.z),
      height: top.height - seat,
      fromCamera: Math.hypot(VOLCANO.x - cam.x, VOLCANO.z - cam.z),
      lamp: [lx, world.heightAt(lx, lz) + 1.2, lz],
      light: 'ember',
    })
  }
  // East: the geyser field on its sinter flat, dead on the ray.
  {
    const pose = outwardPose('east')
    const cam = poseCamera(pose)
    const [x, z] = alongRay(pose, GEYSER_FIELD.x - cam.x)
    const seat = world.heightAt(x, z)
    out.push({ id: 'east', kind: 'geysers', poseId: pose.id, x, z, seatY: seat, yaw: Math.atan2(cam.x - x, cam.z - z), height: 22, fromCamera: Math.hypot(x - cam.x, z - cam.z), lamp: [x - 6, seat + 0.5, z + 9], light: 'aqua' })
  }
  // South: the chieftain's hall on the west headland of the bay.
  {
    const pose = outwardPose('south')
    const cam = poseCamera(pose)
    const h = HEADLANDS[0]
    const x = h.x + 8
    const z = h.z - 4
    const seat = world.heightAt(x, z)
    const yaw = Math.atan2(cam.x - x, cam.z - z)
    out.push({ id: 'south', kind: 'longhouse', poseId: pose.id, x, z, seatY: seat, yaw, height: 9.5, fromCamera: Math.hypot(x - cam.x, z - cam.z), lamp: [x + Math.sin(yaw) * 4.7, seat + 2.6, z + Math.cos(yaw) * 4.7], light: 'warm' })
  }
  // West: the stave church on its moss hill.
  {
    const pose = outwardPose('west')
    const cam = poseCamera(pose)
    const x = CHURCH_HILL.x
    const z = CHURCH_HILL.z
    const seat = world.heightAt(x, z)
    const yaw = Math.atan2(cam.x - x, cam.z - z)
    out.push({ id: 'west', kind: 'church', poseId: pose.id, x, z, seatY: seat, yaw, height: 14.5, fromCamera: Math.hypot(x - cam.x, z - cam.z), lamp: [x + Math.sin(yaw) * 7.4, seat + 2.4, z + Math.cos(yaw) * 7.4], light: 'warm' })
  }
  return out
}

/* ---------- windows ---------- */

export function windows(seed: number): Window[] {
  return (['north', 'east', 'south', 'west'] as VistaId[]).map((id) => {
    const pose = outwardPose(id)
    const cam = poseCamera(pose)
    let crossing: [number, number]
    let halfWidth: number
    if (id === 'east' || id === 'west') {
      const side = id === 'east' ? 1 : -1
      const z = cam.z
      crossing = [palisadeX(side, z, seed), z]
      halfWidth = PALISADE.windowHalf
    } else if (id === 'north') {
      crossing = [cam.x, ARM.zMouth - 10]
      halfWidth = armHalfWidth(ARM.zMouth - 10)
    } else {
      crossing = [cam.x, 520]
      halfWidth = 31
    }
    return { id, poseId: pose.id, halfWidth, crossing }
  })
}

/* ---------- geysers ---------- */

export interface GeyserEvent {
  startAt: number
  duration: number
  vent: 0 | 1 | 2
}

export const GEYSER_DURATION = 4.6

/** Eruptions every 16–30 s, vents in a seeded order; deterministic from the seed. */
export function geyserSchedule(seed: number, count = 80): GeyserEvent[] {
  const rng = seeded(seed * 43 + 17)
  const out: GeyserEvent[] = []
  let t = 5 + rng() * 6
  let vent = Math.floor(rng() * 3) as 0 | 1 | 2
  for (let i = 0; i < count; i++) {
    out.push({ startAt: t, duration: GEYSER_DURATION, vent })
    t += 16 + rng() * 14
    vent = ((vent + 1 + Math.floor(rng() * 2)) % 3) as 0 | 1 | 2
  }
  return out
}

export interface GeyserState {
  vent: 0 | 1 | 2
  /** 0..1 through the eruption. */
  k: number
}

export function geyserStateAt(schedule: GeyserEvent[], time: number): GeyserState | null {
  for (const event of schedule) {
    if (time < event.startAt) break
    const local = time - event.startAt
    if (local < event.duration) return { vent: event.vent, k: local / event.duration }
  }
  return null
}

/** Column height (m) and plume spread (0..1) through an eruption: fast rise, hang, drift away. */
export function geyserProfile(k: number): { column: number; spread: number } {
  const rise = smoothstep(0, 0.22, k)
  const fall = 1 - smoothstep(0.55, 1, k)
  return { column: 17 * rise * fall, spread: smoothstep(0.15, 1, k) }
}

/** A frozen lab time at which the geyser field is mid-eruption (for deterministic captures). */
export function geyserShowTime(seed: number): number {
  const schedule = geyserSchedule(seed, 3)
  return schedule[1].startAt + GEYSER_DURATION * 0.4
}

/* ---------- the plan ---------- */

export interface BarrierPlan {
  windows: Window[]
  massifs: Massif[]
  vistas: Vista[]
  geysers: GeyserEvent[]
}

export function barrierPlan(world: OuterWorld, seed: number): BarrierPlan {
  const wins = windows(seed)
  const east = wins.find((w) => w.id === 'east')!
  const west = wins.find((w) => w.id === 'west')!
  const massifs = [
    ...palisadeColumns(world, 1, east.crossing[1], seed),
    ...palisadeColumns(world, -1, west.crossing[1], seed),
    ...fjordWalls(world, seed),
    ...glacierFront(world, seed),
  ]
  return { windows: wins, massifs, vistas: vistas(world), geysers: geyserSchedule(seed) }
}

/** Distance from a point to the segment camera → vista (horizontal), for sightline checks. */
export function distanceToSightline(cam: Cam, target: { x: number; z: number }, x: number, z: number): number {
  const dx = target.x - cam.x
  const dz = target.z - cam.z
  const len2 = dx * dx + dz * dz || 1
  const t = Math.min(1, Math.max(0, ((x - cam.x) * dx + (z - cam.z) * dz) / len2))
  return Math.hypot(cam.x + dx * t - x, cam.z + dz * t - z)
}

/** Highest obstruction (massif tops and terrain) along the ray from the camera to a point, as a fraction of the ray height there. */
export function sightlineClear(world: OuterWorld, massifs: Massif[], cam: Cam, x: number, y: number, z: number, clearance = 1.5): boolean {
  const dx = x - cam.x
  const dz = z - cam.z
  const length = Math.hypot(dx, dz)
  const steps = Math.ceil(length / 6)
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const px = cam.x + dx * t
    const pz = cam.z + dz * t
    const py = cam.y + (y - cam.y) * t
    if (world.heightAt(px, pz) + clearance > py) return false
  }
  for (const m of massifs) {
    const d = distanceToSightline(cam, { x, z }, m.x, m.z)
    if (d > Math.max(m.rx, m.rz) + 1) continue
    // Height of the ray where it passes the massif.
    const t = Math.min(1, Math.max(0, ((m.x - cam.x) * dx + (m.z - cam.z) * dz) / (length * length)))
    const py = cam.y + (y - cam.y) * t
    if (m.seatY + m.height + clearance > py) return false
  }
  return true
}
