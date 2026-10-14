/**
 * Barriers and vistas: the pure plan. No three.js here; the renderer in `../barriers.tsx` turns
 * this into geometry.
 *
 * The idea (Skyrim's mountain walls, Journey's dunes, God of War's framed vistas): the reachable
 * land is enclosed by in-world geography (a fjord ring of ice cliffs, spires, tabular bergs and
 * sea stacks) and four composed gaps in that ring frame distant places the player can see but
 * never reach, one per outward comparison pose.
 *
 * Geometry of the lab camera that shapes every number here: FOV 26°, the outward poses look down
 * 15–18°, so the frame top is only 2–5° below the horizon and cuts the sea 570–990 m from the
 * camera. Nothing farther than that is in frame at all, and anything above ~25–32 m at the ring
 * is cropped by the frame edge. So the ring sits at 225–290 m (its base lands 20–30 % down the
 * frame) and the vista landmarks at 310–450 m from their pose camera (inside the frame, hazed).
 */
import { type BiomeLayout, mountainProfile, seeded } from '../../layout/biome-layout'
import { type Sample, fbm, landField, mountainPeaks, sampleTerrain, smoothstep } from '../../layout/terrain'
import { type OuterWorld, outerWorldKey } from '../endless/outer-world'
import { EDGE_POSES, type EdgePose, type EdgePoseId, edgePosePosition } from '../poses'

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

/** Smallest absolute difference between two bearings. */
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

/* ---------- the ring ---------- */

/** Metres of open water every wall keeps from any coast (the brief's coastal exclusion). */
export const COAST_CLEARANCE = 40

/** Ring radius: closer on the open sides, pushed out over the back capes, wobbled so it is a coast and not a circle. */
const RING = { base: 238, northBump: 44, northCentreDeg: 190, northWidthDeg: 62, wobble: 14 } as const

export function ringRadiusAt(bearingDeg: number, seed: number): number {
  const a = (bearingDeg * Math.PI) / 180
  const north = 1 - smoothstep(0, RING.northWidthDeg, bearingDeltaDeg(bearingDeg, RING.northCentreDeg))
  const wobble = fbm(Math.cos(a) * 2.1 + (seed % 97) * 0.37, Math.sin(a) * 2.1 + 3.3, 2) * 2 * RING.wobble
  return RING.base + RING.northBump * north + wobble
}

export type VistaId = 'north' | 'east' | 'south' | 'west'

export interface VistaGap {
  id: VistaId
  poseId: EdgePoseId
  /** Bearing from the land centre (degrees from +z toward +x) of the window's centre. */
  bearingDeg: number
  halfWidthDeg: number
  /** Where the pose's view ray crosses the ring. */
  crossing: [number, number]
}

const VISTA_POSES: Record<VistaId, EdgePoseId> = { north: 'north-out', east: 'east-out', south: 'south-out', west: 'west-out' }

/**
 * Gap half-widths: wide enough for the window to read, narrow enough that walls frame both sides.
 * The north window is wider so the notch over the range shows the shelf's outer rows, not our frames.
 */
const GAP_HALF_WIDTH: Record<VistaId, number> = { north: 15, east: 12, south: 12, west: 12 }

export function outwardPose(id: VistaId): EdgePose {
  return EDGE_POSES.find((pose) => pose.id === VISTA_POSES[id])!
}

/**
 * Where a pose's centre view ray crosses the ring. The ring radius depends on the bearing of the
 * crossing itself, so iterate a few times from a mean radius.
 */
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

export type MassifKind = 'cliff' | 'spire' | 'tabular' | 'stack' | 'arch' | 'headland'

export interface Massif {
  kind: MassifKind
  x: number
  z: number
  /** Facing: local +z points away from the land. */
  yaw: number
  /** Footprint half-extents along the ring tangent (rx) and radially (rz), metres. */
  rx: number
  rz: number
  /** Top above sea level. The roots go 6 m under. */
  height: number
  /** Top polygon as a fraction of the base. */
  taper: number
  sides: number
  /** Snow slab on top (cliffs and tabulars) or a bare spire tip. */
  cap: boolean
  /** 0 pale ice, 1 cliff ice: alternated for rhythm. */
  tone: 0 | 1
  tilt: number
  /** Arch only: span between the legs. */
  span?: number
  /** Where the base sits: the sea by default; on the shelf, the pack ice under the footprint. */
  seatY?: number
  /** How far under the seat the roots go (deeper on uneven pack so nothing floats). */
  rootDepth?: number
}

function range(rng: () => number, [a, b]: [number, number]): number {
  return a + rng() * (b - a)
}

/** Past the plate by this much, the layout's open-ended glacier shelf has been eased under the water by the apron. */
export const SHELF_SINK_DEPTH = 48

/**
 * Open water: the terrain says sea, or the point is north of the plate where only the land itself
 * (not the phantom shelf strip the layout leaves open to the north) counts as coast.
 */
export function openSea(layout: BiomeLayout, x: number, z: number): boolean {
  if (landField(layout, x, z) >= 0) return false
  if (sampleTerrain(layout, x, z).material === 'sea') return true
  return -z > layout.worldExtent + SHELF_SINK_DEPTH
}

/** True where a wall may stand: open sea, clear of every coast by `COAST_CLEARANCE` plus its own footprint. */
export function clearOfCoast(layout: BiomeLayout, x: number, z: number, footprint = 0): boolean {
  if (!openSea(layout, x, z)) return false
  return landField(layout, x, z) < -(COAST_CLEARANCE + footprint)
}

function placeOnRing(layout: BiomeLayout, bearingDeg: number, radius: number, footprint: number): { x: number; z: number; radius: number } | null {
  const a = (bearingDeg * Math.PI) / 180
  for (let push = 0; push < 9; push++) {
    const r = radius + push * 12
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    if (clearOfCoast(layout, x, z, footprint)) return { x, z, radius: r }
  }
  return null
}

/** Headlands stand this far out: beyond every coast, inside the fog, and out of frame from every pose that looks across the plate. */
export const HEADLAND_RADIUS: [number, number] = [240, 300]
/** No headland block rises above this (the gate is the one tall thing). */
export const HEADLAND_MAX_HEIGHT = 18

export type HeadlandId = 'gate' | 'south-east' | 'east-south'

export interface Headland {
  id: HeadlandId
  /** Which window this headland frames, and on which side of it. */
  gap: VistaId
  side: -1 | 1
  /** Bearing from the land centre of the headland's middle. */
  bearingDeg: number
}

/**
 * Three low pale headlands instead of a ring: they stand on the bearings no pose's view ray
 * crosses, each framing one side of a window: the gate (the arch) west of the south window, a
 * broken headland east of it, and one south of the east window. Everything else is the shelf's.
 */
export function headlands(gaps: VistaGap[]): Headland[] {
  const south = gaps.find((g) => g.id === 'south')!
  const east = gaps.find((g) => g.id === 'east')!
  return [
    { id: 'gate', gap: 'south', side: -1, bearingDeg: wrapDeg(south.bearingDeg - (south.halfWidthDeg + 6.5)) },
    { id: 'south-east', gap: 'south', side: 1, bearingDeg: wrapDeg(south.bearingDeg + (south.halfWidthDeg + 13)) },
    { id: 'east-south', gap: 'east', side: 1, bearingDeg: wrapDeg(east.bearingDeg + (east.halfWidthDeg + 13)) },
  ]
}

/**
 * The massifs of the three headlands. Each headland is a short broken line of low blocks, every
 * one a different height, with a sea stack or two off its tip toward the window; the gate is the
 * arch with low rocks at its feet.
 */
export function headlandMassifs(layout: BiomeLayout, seed: number, gaps: VistaGap[]): Massif[] {
  const rng = seeded(seed * 13 + 101)
  const out: Massif[] = []
  const tooClose = (x: number, z: number, rx: number, rz: number) =>
    out.some((m) => Math.hypot(m.x - x, m.z - z) < Math.min(m.rx, m.rz) * 0.5 + Math.min(rx, rz) * 0.5 + 2)
  const add = (kind: MassifKind, bearingDeg: number, radius: number, spec: Partial<Massif> & Pick<Massif, 'rx' | 'rz' | 'height'>) => {
    const spot = placeOnRing(layout, bearingDeg, radius, Math.max(spec.rx, spec.rz) + 2)
    if (!spot || tooClose(spot.x, spot.z, spec.rx, spec.rz)) return
    const a = (bearingDeg * Math.PI) / 180
    out.push({
      kind,
      x: spot.x,
      z: spot.z,
      yaw: spec.yaw ?? a + (rng() - 0.5) * 0.6,
      rx: spec.rx,
      rz: spec.rz,
      height: spec.height,
      taper: spec.taper ?? 0.35 + rng() * 0.3,
      sides: spec.sides ?? 5 + Math.floor(rng() * 3),
      cap: spec.cap ?? false,
      tone: spec.tone ?? 0,
      tilt: spec.tilt ?? (rng() - 0.5) * 0.14,
      ...(spec.span !== undefined ? { span: spec.span } : {}),
    })
  }

  for (const head of headlands(gaps)) {
    const gap = gaps.find((g) => g.id === head.gap)!
    // First row 245–265 m out: from the horizon-max camera (372 m out, 83 m up) even a 16 m block
    // this close is under the frame's bottom edge; the second row stands 22–36 m behind.
    const base = HEADLAND_RADIUS[0] + 5 + rng() * 20
    // Toward the window: a stack at the lip, low.
    const lip = gap.bearingDeg + head.side * (gap.halfWidthDeg + 2.5)
    add('stack', lip, base - 8 + rng() * 10, { rx: 4 + rng() * 3, rz: 4 + rng() * 2, height: 5 + rng() * 4, taper: 0.5 + rng() * 0.2 })
    if (head.id === 'gate') {
      add('arch', head.bearingDeg, base + 10, { rx: 34, rz: 10, height: 36, taper: 1, sides: 9, cap: false, tone: 0, tilt: 0, span: 56, yaw: (head.bearingDeg * Math.PI) / 180 })
      // Low rocks at the feet of the legs and one behind, all on the far side of the arch from the window.
      for (const d of [-9, 5, -3]) add('headland', head.bearingDeg + d, base + (d === -3 ? 34 : 4) + rng() * 8, { rx: 7 + rng() * 5, rz: 5 + rng() * 3, height: 5 + rng() * 5 })
      continue
    }
    // A broken line of 5–6 blocks spread over ~20° and two rows, each a different height, the
    // tallest in the middle, so the skyline is a serration and never a slab.
    const count = 5 + Math.floor(rng() * 2)
    const heights = [7, 16, 10, 13, 8, 11].slice(0, count).map((h) => h + (rng() - 0.5) * 3)
    for (let i = 0; i < count; i++) {
      const t = (i / (count - 1) - 0.5) * 2
      const bearing = head.bearingDeg + t * 10
      const rx = 9 + rng() * 7
      const rz = 6 + rng() * 5
      const row = i % 2 === 0 ? 0 : 22 + rng() * 14
      add('headland', bearing, base + row + rng() * 8, { rx, rz, height: Math.min(HEADLAND_MAX_HEIGHT, heights[i]) })
    }
  }
  return out
}

/* ---------- vistas ---------- */

export type VistaKind = 'observatory' | 'lighthouse' | 'icebreaker' | 'cathedral'

export interface Vista {
  id: VistaId
  kind: VistaKind
  x: number
  z: number
  /** Faces the pose camera. */
  yaw: number
  /** Silhouette height above the sea, metres. */
  height: number
  /** Metres from the pose camera along its centre ray. */
  fromCamera: number
  /** Metres from the land centre. */
  distance: number
  light: 'warm' | 'cyan'
  /** Base height: the sea, or on the shelf the ice / ground under the landmark. */
  seatY?: number
  /** North only, with the shelf: the observatory stands on the shelf's own mountains, no ridge of ours. */
  onShelf?: boolean
}

/**
 * Per window: how far along the pose's centre ray the landmark stands and how tall it is. The
 * numbers put its base 9–14 % down the frame and its top just under the frame edge.
 */
const VISTA_SPEC: Record<VistaId, { kind: VistaKind; fromCamera: number; height: number; light: 'warm' | 'cyan' }> = {
  north: { kind: 'observatory', fromCamera: 355, height: 18.5, light: 'warm' },
  east: { kind: 'lighthouse', fromCamera: 330, height: 15.5, light: 'cyan' },
  south: { kind: 'icebreaker', fromCamera: 400, height: 15, light: 'warm' },
  west: { kind: 'cathedral', fromCamera: 315, height: 15, light: 'cyan' },
}

/** Degrees off the centre ray (positive = to the camera's left): the far lighthouse steps aside so it never stacks over the authored one. */
const VISTA_SIDE_DEG: Record<VistaId, number> = { north: 0, east: 2.4, south: 0, west: 0 }

export function vistas(layout?: BiomeLayout): Vista[] {
  return (['north', 'east', 'south', 'west'] as VistaId[]).map((id) => {
    const pose = outwardPose(id)
    const cam = poseCamera(pose)
    const spec = VISTA_SPEC[id]
    const view = ((viewBearingDeg(pose) + VISTA_SIDE_DEG[id]) * Math.PI) / 180
    const x = cam.x + Math.sin(view) * spec.fromCamera
    const z = cam.z + Math.cos(view) * spec.fromCamera
    const vista: Vista = { id, kind: spec.kind, x, z, yaw: Math.atan2(cam.x - x, cam.z - z), height: spec.height, fromCamera: spec.fromCamera, distance: Math.hypot(x, z), light: spec.light }
    if (id === 'north' && layout) {
      // The observatory ridge stands on the snowfield: seat it on the highest ground under its footprint.
      let seat = layout.seaLevel
      for (let i = 0; i < 9; i++) {
        const a = (i / 8) * Math.PI * 2
        const r = i === 8 ? 0 : 40
        seat = Math.max(seat, snowfieldHeight(layout, x + Math.cos(a) * r, z + Math.sin(a) * r))
      }
      vista.seatY = seat
      vista.height = Math.max(12, spec.height - seat)
    }
    return vista
  })
}

/* ---------- floe fields ---------- */

export type Floe = [x: number, z: number, radius: number, yaw: number]

/** Sparse floes between the ring and the fog so the water beyond the walls has scale, plus a mid field inside the ring. */
export function floeFields(layout: BiomeLayout, seed: number, massifs: Massif[], landmarks: Vista[]): { mid: Floe[]; far: Floe[] } {
  const rng = seeded(seed * 17 + 5)
  const mid: Floe[] = []
  const far: Floe[] = []
  const blocked = (x: number, z: number, r: number) =>
    massifs.some((m) => Math.hypot(m.x - x, m.z - z) < Math.max(m.rx, m.rz) + r + 6) ||
    landmarks.some((v) => Math.hypot(v.x - x, v.z - z) < 70) ||
    (z < -layout.worldExtent && snowfieldHeight(layout, x, z) > layout.seaLevel - 0.5)
  let guard = 0
  while (mid.length < 48 && guard++ < 600) {
    const a = rng() * Math.PI * 2
    const r = 150 + rng() * 60
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const radius = 2.5 + rng() * 4
    if (!clearOfCoast(layout, x, z, radius)) continue
    if (blocked(x, z, radius)) continue
    if (mid.some(([fx, fz, fr]) => Math.hypot(fx - x, fz - z) < fr + radius + 10)) continue
    mid.push([x, z, radius, rng() * Math.PI])
  }
  guard = 0
  while (far.length < 150 && guard++ < 1500) {
    const a = rng() * Math.PI * 2
    const r = 300 + Math.pow(rng(), 0.75) * 760
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const radius = 3 + rng() * 7
    if (blocked(x, z, radius)) continue
    if (far.some(([fx, fz, fr]) => Math.hypot(fx - x, fz - z) < fr + radius + 22)) continue
    far.push([x, z, radius, rng() * Math.PI])
  }
  return { mid, far }
}

/* ---------- apron ---------- */

export interface Apron {
  /** World x range the snow apron covers; z runs from `maxZ` (the plate edge) north to `minZ`. */
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  stepX: number
  /** Row spacing grows with distance from the plate edge: fine at the seam, coarse in the fog. */
  rows: number[]
}

/** How far north of the plate edge the snowfield runs: past the fog's far plane from every pose, so it never ends in view. */
export const SNOWFIELD_REACH = 1000
/**
 * Where its shores run: the east shore straight at +320; the west shore starts at −300 by the plate
 * (out of the west-out frame) and swings out to −560 farther north, under the north-out frame's
 * left edge. Both ease under the water over 120 m.
 */
export const SNOWFIELD_EAST = 320
export const SNOWFIELD_WEST: [number, number] = [300, 560]

/**
 * The terrain plate ends at ±worldExtent, and on the north side the back land is still 8–13 m
 * above the sea there: a straight cut you can see from any high camera. The apron continues the
 * same heightfield past the plate, then eases it into a low snowfield that runs north into the
 * fog, so every notch over the range shows snow fading into haze and never a sea / sky line.
 */
export function apronFor(layout: BiomeLayout): Apron {
  const e = layout.worldExtent
  const rows: number[] = []
  // z offsets from the plate edge, northward: 3 m steps for the first 60 m, then 8, 16, 32 and 64 m in the fog.
  for (let d = 0; d <= 60; d += 3) rows.push(d)
  for (let d = 68; d <= 140; d += 8) rows.push(d)
  for (let d = 156; d <= 300; d += 16) rows.push(d)
  for (let d = 332; d <= 620; d += 32) rows.push(d)
  for (let d = 684; d <= SNOWFIELD_REACH; d += 64) rows.push(d)
  return { minX: -SNOWFIELD_WEST[1] - 40, maxX: SNOWFIELD_EAST + 40, minZ: -e - SNOWFIELD_REACH, maxZ: -e, stepX: 4, rows: rows.map((d) => -e - d) }
}

/** The low snowfield's own height: a plain just above the sea, climbing gently northward, with wavy shores east, west and far north. */
export function snowfieldHeight(layout: BiomeLayout, x: number, z: number): number {
  const e = layout.worldExtent
  const north = -z - e
  const plain = 1.8 + 1.1 * fbm(x * 0.03 + 2.2, z * 0.03, 2) + 0.5 * fbm(x * 0.09, z * 0.09, 2)
  const rise = smoothstep(60, SNOWFIELD_REACH * 0.7, north) * (5 + 3 * fbm(x * 0.004 + 4.4, z * 0.004 + 1.7, 2))
  const west = SNOWFIELD_WEST[0] + smoothstep(0, 300, north) * (SNOWFIELD_WEST[1] - SNOWFIELD_WEST[0])
  const inside = x < 0 ? west + x : SNOWFIELD_EAST - x
  const shoreX = smoothstep(0, 120, inside - 36 * fbm(z * 0.012 + 3.3, 1.1, 2))
  const shoreN = smoothstep(SNOWFIELD_REACH, SNOWFIELD_REACH - 200, north + 30 * fbm(x * 0.012 + 7.7, 2.2, 2))
  const land = shoreX * shoreN
  const floor = layout.seaLevel - 0.7
  return floor + (layout.seaLevel + plain + rise - floor) * land
}

/**
 * Heightfield of the apron: the plate's own sample (full range, so the seam at the plate edge is
 * exact at 100 %), eased past the plate into the snowfield: the back capes keep their own height
 * where they stand above it, and the glacier shelf the layout leaves open to the north is folded
 * into the same plain, so the apron has no straight edge of its own.
 */
export function apronSample(layout: BiomeLayout, x: number, z: number, profile = mountainProfile(1), peaks = mountainPeaks(layout, profile)): Sample {
  const s = sampleTerrain(layout, x, z, profile, peaks)
  const k = smoothstep(layout.worldExtent + 10, layout.worldExtent + SHELF_SINK_DEPTH, -z)
  if (k <= 0) return s
  const field = snowfieldHeight(layout, x, z)
  const blended = s.height + (field - s.height) * k
  const height = landField(layout, x, z) > 0 ? Math.max(s.height, blended) : blended
  const material = height < layout.seaLevel + 0.05 ? 'sea' : s.material === 'sea' || s.material === 'ice' ? 'snow' : s.material
  return { ...s, height, material }
}

/** Plate-edge samples that stand above the sea: the apron must cover every one of them. */
export function exposedPlateEdge(layout: BiomeLayout, step = 2): Array<[number, number]> {
  const e = layout.worldExtent
  const out: Array<[number, number]> = []
  for (let t = -e; t <= e; t += step) {
    for (const [x, z] of [
      [t, -e],
      [t, e],
      [-e, t],
      [e, t],
    ] as Array<[number, number]>) {
      if (sampleTerrain(layout, x, z).height > layout.seaLevel) out.push([x, z])
    }
  }
  return out
}

/* ---------- seating on the endless shelf ---------- */

/** Shelf land this high under a wall means the shelf's own geography encloses there; the wall is dropped. */
export const SHELF_LAND_LIMIT = 10
export const DEFAULT_ROOT = 8

export interface Seat {
  seatY: number
  rootDepth: number
  /** Highest / lowest shelf height under the footprint. */
  maxH: number
  minH: number
  /** Standing on the shelf's land (northern mass, capes), not on pack ice or water. */
  onLand: boolean
  /** Material at the centre. */
  material: string
}

/** Sample the shelf under a footprint: the seat is the highest point (never below the sea), roots cover the lowest. */
export function shelfSeat(world: OuterWorld, x: number, z: number, footprint: number): Seat {
  let maxH = Number.NEGATIVE_INFINITY
  let minH = Number.POSITIVE_INFINITY
  const centre = world.sample(x, z)
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * Math.PI * 2
    const r = i === 8 ? 0 : footprint
    const h = world.sample(x + Math.cos(a) * r, z + Math.sin(a) * r).height
    maxH = Math.max(maxH, h)
    minH = Math.min(minH, h)
  }
  const seatY = Math.max(world.seaLevel, maxH)
  return {
    seatY,
    rootDepth: Math.max(DEFAULT_ROOT, seatY - minH + 3),
    maxH,
    minH,
    onLand: world.landField(x, z) > 0 && maxH > world.seaLevel + 3,
    material: centre.material,
  }
}

/** Sea stacks stand in open water: if the spot is pack ice, look for a lead or the moat nearby. */
export function nearestLead(world: OuterWorld, x: number, z: number, reach = 26): [number, number] | null {
  if (world.sample(x, z).material === 'sea') return [x, z]
  for (const r of [10, 18, reach]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + r * 0.1
      const px = x + Math.cos(a) * r
      const pz = z + Math.sin(a) * r
      if (world.landField(px, pz) > 0) continue
      if (world.sample(px, pz).material === 'sea') return [px, pz]
    }
  }
  return null
}

/**
 * With the shelf present every wall sits on what is under it. Pack ice and leads carry the ring;
 * where the shelf has already raised land (the northern mass behind the range) the wall is dropped,
 * because the land is the barrier there. Sea stacks move into the nearest lead.
 */
export function seatRingOnShelf(world: OuterWorld, layout: BiomeLayout, ring: Massif[]): Massif[] {
  const out: Massif[] = []
  for (const m of ring) {
    let x = m.x
    let z = m.z
    if (m.kind === 'stack') {
      const lead = nearestLead(world, x, z)
      if (lead && clearOfCoast(layout, lead[0], lead[1], Math.max(m.rx, m.rz) + 2)) [x, z] = lead
    }
    const seat = shelfSeat(world, x, z, Math.max(m.rx, m.rz))
    if (seat.onLand && seat.maxH > world.seaLevel + SHELF_LAND_LIMIT) continue
    if (seat.maxH - seat.minH > 16) continue
    out.push({ ...m, x, z, seatY: seat.seatY, rootDepth: seat.rootDepth })
  }
  return out
}

/** Ground height for sightlines: the authored plate inside, the shelf outside. */
function groundWithShelf(layout: BiomeLayout, world: OuterWorld, x: number, z: number, profile = mountainProfile(1), peaks = mountainPeaks(layout, profile)): number {
  return Math.max(Math.abs(x), Math.abs(z)) < layout.worldExtent ? sampleTerrain(layout, x, z, profile, peaks).height : world.sample(x, z).height
}

/** Whether the segment camera → point clears the ground (coarse 6 m steps). */
export function sightlineClear(layout: BiomeLayout, world: OuterWorld, cam: Cam, x: number, y: number, z: number): boolean {
  const profile = mountainProfile(1)
  const peaks = mountainPeaks(layout, profile)
  const dx = x - cam.x
  const dz = z - cam.z
  const d = Math.hypot(dx, dz)
  for (let t = 40; t < d - 3; t += 6) {
    const k = t / d
    if (groundWithShelf(layout, world, cam.x + dx * k, cam.z + dz * k, profile, peaks) > cam.y + (y - cam.y) * k) return false
  }
  return true
}

const OBSERVATORY_RISE = 9

/**
 * The north window with the shelf: the observatory stands on the shelf's second mountain row (the
 * first outer row behind the authored range), on the forward saddle between two of its peaks: the
 * highest shelf-land spot near the pose's centre ray from which the dome, drum and light are all
 * inside the frame and not hidden by the authored peaks.
 */
export function northSaddleOnShelf(layout: BiomeLayout, world: OuterWorld): { x: number; z: number; height: number } | null {
  const pose = outwardPose('north')
  const cam = poseCamera(pose)
  const view = (viewBearingDeg(pose) * Math.PI) / 180
  const top = frameTopDeg(pose)
  let best: { x: number; z: number; height: number; score: number } | null = null
  for (let d = 262; d <= 330; d += 6) {
    for (let side = -42; side <= 42; side += 6) {
      const x = cam.x + Math.sin(view) * d + Math.cos(view) * side
      const z = cam.z + Math.cos(view) * d - Math.sin(view) * side
      const s = world.sample(x, z)
      if (s.material !== 'mountain' && s.material !== 'snow' && s.material !== 'rock') continue
      if (s.height < 12) continue
      const domeTop = s.height + OBSERVATORY_RISE
      if (elevationDownDeg(cam, x, domeTop, z) < top + 0.45) continue
      if (!sightlineClear(layout, world, cam, x, s.height + 2, z) || !sightlineClear(layout, world, cam, x, domeTop - 1, z)) continue
      const score = s.height - Math.abs(side) * 0.08
      if (!best || score > best.score) best = { x, z, height: s.height, score }
    }
  }
  return best ? { x: best.x, z: best.z, height: best.height } : null
}

/** Vistas on the shelf: seated on the ice or ground under them; the north one moves onto the shelf's mountains. */
export function seatVistasOnShelf(layout: BiomeLayout, world: OuterWorld, landmarks: Vista[]): Vista[] {
  return landmarks.map((v) => {
    if (v.id === 'north') {
      const saddle = northSaddleOnShelf(layout, world)
      if (saddle) {
        const pose = outwardPose('north')
        const cam = poseCamera(pose)
        return { ...v, x: saddle.x, z: saddle.z, yaw: Math.atan2(cam.x - saddle.x, cam.z - saddle.z), seatY: saddle.height, height: OBSERVATORY_RISE, onShelf: true, fromCamera: Math.hypot(saddle.x - cam.x, saddle.z - cam.z), distance: Math.hypot(saddle.x, saddle.z) }
      }
    }
    // Seated on the pack: keep the silhouette's top where it was so the frame edge never crops it.
    const seat = Math.min(shelfSeat(world, v.x, v.z, 12).seatY, world.seaLevel + 4)
    return { ...v, seatY: seat, height: Math.max(12, VISTA_SPEC[v.id].height - Math.max(0, seat)) }
  })
}

/* ---------- the plan ---------- */

export interface BarrierPlan {
  gaps: VistaGap[]
  ring: Massif[]
  vistas: Vista[]
  floes: { mid: Floe[]; far: Floe[] }
  apron: Apron
  /** True when the plan was seated on the endless shelf. */
  shelf: boolean
}

const planCache = new WeakMap<BiomeLayout, Map<string, BarrierPlan>>()

/** The memo key of a plan: its seed and the shelf it is seated on (by the shelf's own key), or none. */
export function barrierPlanKey(seed: number, shelf: OuterWorld | null | undefined): string {
  return `${seed}:${shelf ? outerWorldKey(shelf.seed, shelf.options) : 'apron'}`
}

/** Install a plan computed elsewhere (the land build Worker) under its key. */
export function primeBarrierPlan(layout: BiomeLayout, key: string, plan: BarrierPlan): void {
  let per = planCache.get(layout)
  if (!per) {
    per = new Map()
    planCache.set(layout, per)
  }
  per.set(key, plan)
}

/** Plans are pure in (layout, seed, shelf) and kept per layout: a land that mounts again pays nothing. */
export function barrierPlan(layout: BiomeLayout, seed: number, options: { shelf?: OuterWorld | null } = {}): BarrierPlan {
  const key = barrierPlanKey(seed, options.shelf)
  const hit = planCache.get(layout)?.get(key)
  if (hit) return hit
  const plan = computeBarrierPlan(layout, seed, options)
  primeBarrierPlan(layout, key, plan)
  return plan
}

function computeBarrierPlan(layout: BiomeLayout, seed: number, options: { shelf?: OuterWorld | null } = {}): BarrierPlan {
  const gaps = vistaGaps(seed)
  let ring = headlandMassifs(layout, seed, gaps)
  let landmarks = vistas(layout)
  const world = options.shelf ?? null
  if (world) {
    ring = seatRingOnShelf(world, layout, ring)
    landmarks = seatVistasOnShelf(layout, world, landmarks)
  }
  return { gaps, ring, vistas: landmarks, floes: floeFields(layout, seed, ring, landmarks), apron: apronFor(layout), shelf: world !== null }
}

/** Distance from a point to the segment camera → vista (horizontal), for sightline checks. */
export function distanceToSightline(cam: Cam, vista: Vista, x: number, z: number): number {
  const dx = vista.x - cam.x
  const dz = vista.z - cam.z
  const len2 = dx * dx + dz * dz || 1
  const t = Math.min(1, Math.max(0, ((x - cam.x) * dx + (z - cam.z) * dz) / len2))
  return Math.hypot(cam.x + dx * t - x, cam.z + dz * t - z)
}
