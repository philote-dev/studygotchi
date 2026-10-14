/**
 * Barriers and vistas: the pure plan. No three.js here; `../outer/outer-world.ts` folds the hills,
 * the lake and the crag into its heightfield and `../outer.tsx` renders the rest.
 *
 * The kingdom is enclosed by in-world geography (Skyrim's walls, Journey's dunes): a ridge line of
 * hill rows across the north behind the Green Crown, forest edges standing just past the plate on
 * the east and west, and a lake across the south. Four composed windows, one per outward lab pose,
 * each frame a distant place you can see but never reach: a castle on a crag in the ridge's
 * saddle, a cathedral spire over a walled city in the eastern haze, a windmill on a western hill
 * and a monastery on the far shore of the lake. At night each has exactly one light.
 *
 * Camera geometry that shapes the numbers: FOV 36°, the outward poses look down 14–16°, so the
 * frame top is 2–4° above the horizon and the horizon itself is in frame. A landmark 370–600 m from
 * its pose camera with its top 50–60 m up fills 11–17 % of the frame height and stays under the
 * frame edge.
 */
import { type GeneratedKingdom, seeded } from '../../layout/biome-layout'
import { fbm, smoothstep } from '../noise'
import { EDGE_POSES, type EdgePose, type EdgePoseId, poseCamera, viewBearingDeg } from '../poses'

export type VistaId = 'north' | 'east' | 'south' | 'west'
export type VistaKind = 'crag-castle' | 'walled-city' | 'windmill-hill' | 'lake-monastery'

export interface Vista {
  id: VistaId
  kind: VistaKind
  poseId: EdgePoseId
  x: number
  z: number
  /** Faces the pose camera (rotation.y). */
  yaw: number
  /** Metres from the pose camera along its centre ray. */
  fromCamera: number
  /** Silhouette height above the local ground (the built landmark, not the hill under it). */
  height: number
  light: 'warm' | 'cool'
}

export interface Peak {
  x: number
  z: number
  height: number
  radius: number
  /** Cone sharpness exponent: 1 straight flanks, >1 steeper near the top. */
  sharp: number
  /** Limestone shoulder on top. */
  cap: boolean
  /** Flat top: fraction of the radius that is level summit (a crag a castle can stand on). */
  plateau?: number
}

export type RowId = 'A' | 'B' | 'C' | 'D'

export interface HillRow {
  id: RowId
  /** Base z of the row (negative = north) and the forward curve z = z0 + curve · x². */
  z0: number
  curve: number
  peaks: Peak[]
}

export interface Saddle {
  x: number
  z: number
  /** No row-A peak stands within this many metres (along x) of the saddle. */
  halfWidth: number
}

export interface Lake {
  cx: number
  cz: number
  rx: number
  rz: number
  angle: number
  /** Water surface relative to the plate top (the authored river sits at −0.72). */
  level: number
}

export interface ForestWall {
  side: 'east' | 'west'
  /** |x| where the wall begins (just past the plate) and its depth outward, before noise. */
  inner: number
  depth: number
  zMin: number
  zMax: number
  /** The composed gap: centre z and half-width along the wall. */
  gapZ: number
  gapHalf: number
}

export interface BarrierPlan {
  vistas: Vista[]
  rows: HillRow[]
  saddle: Saddle
  crag: Peak
  millHill: Peak
  cityRise: Peak
  lake: Lake
  walls: ForestWall[]
  /** Woods behind the far shore of the lake, with a gap on the south ray. */
  lakeWoods: { zMin: number; zMax: number; xMin: number; xMax: number; gapX: number; gapHalf: number }
}

const VISTA_POSES: Record<VistaId, EdgePoseId> = { north: 'north-out', east: 'east-out', south: 'south-out', west: 'west-out' }

const VISTA_SPEC: Record<VistaId, { kind: VistaKind; fromCamera: number; height: number; light: 'warm' | 'cool' }> = {
  north: { kind: 'crag-castle', fromCamera: 560, height: 19, light: 'warm' },
  east: { kind: 'walled-city', fromCamera: 600, height: 48, light: 'cool' },
  south: { kind: 'lake-monastery', fromCamera: 512, height: 30, light: 'warm' },
  west: { kind: 'windmill-hill', fromCamera: 480, height: 18, light: 'warm' },
}

export function outwardPose(id: VistaId): EdgePose {
  return EDGE_POSES.find((pose) => pose.id === VISTA_POSES[id])!
}

/** A point `distance` metres along a pose's centre ray (horizontal). */
export function alongRay(pose: EdgePose, distance: number): { x: number; z: number } {
  const cam = poseCamera(pose)
  const view = (viewBearingDeg(pose) * Math.PI) / 180
  return { x: cam.x + Math.sin(view) * distance, z: cam.z + Math.cos(view) * distance }
}

export function vistas(): Vista[] {
  return (['north', 'east', 'south', 'west'] as VistaId[]).map((id) => {
    const pose = outwardPose(id)
    const cam = poseCamera(pose)
    const spec = VISTA_SPEC[id]
    const { x, z } = alongRay(pose, spec.fromCamera)
    return { id, kind: spec.kind, poseId: pose.id, x, z, yaw: Math.atan2(cam.x - x, cam.z - z), fromCamera: spec.fromCamera, height: spec.height, light: spec.light }
  })
}

/* ---------- the ridge line ---------- */

interface RowSpec {
  id: RowId
  z0: number
  curve: number
  span: number
  spacing: number
  height: [number, number]
  radius: [number, number]
  sharp: [number, number]
  capChance: number
}

/**
 * Row A is the ridge line proper: the enclosing barrier 100 m behind the plate's north edge. Each
 * row after it is farther, taller and broader; D is the ghost row at the horizon. Every row stays
 * under the product overview's frame-top ray (height < 0.364 · distance − 112 from the overview
 * camera), so the shipped overview never sees them.
 */
const ROWS: RowSpec[] = [
  { id: 'A', z0: -400, curve: 0.00025, span: 560, spacing: 96, height: [24, 40], radius: [56, 80], sharp: [1.2, 1.5], capChance: 0 },
  { id: 'B', z0: -600, curve: 0.0002, span: 720, spacing: 128, height: [50, 75], radius: [92, 130], sharp: [1.2, 1.6], capChance: 0.3 },
  { id: 'C', z0: -850, curve: 0.00012, span: 940, spacing: 170, height: [85, 120], radius: [140, 190], sharp: [1.3, 1.7], capChance: 0.4 },
  { id: 'D', z0: -1250, curve: 0.00006, span: 1300, spacing: 290, height: [150, 200], radius: [240, 320], sharp: [1.4, 1.8], capChance: 0.5 },
]

export function rowZ(row: { z0: number; curve: number }, x: number): number {
  return row.z0 + row.curve * x * x
}

/** Where the north pose's centre ray crosses row A: the saddle (window) is cut here. */
export function saddleFor(rowA: RowSpec | HillRow): Saddle {
  const pose = outwardPose('north')
  const cam = poseCamera(pose)
  const view = (viewBearingDeg(pose) * Math.PI) / 180
  const vx = Math.sin(view)
  const vz = Math.cos(view)
  let t = 400
  for (let i = 0; i < 6; i++) {
    const x = cam.x + vx * t
    const target = rowZ(rowA, x)
    t = (target - cam.z) / vz
  }
  return { x: cam.x + vx * t, z: cam.z + vz * t, halfWidth: 70 }
}

function range(rng: () => number, [a, b]: [number, number]): number {
  return a + rng() * (b - a)
}

export function buildRows(seed: number, saddle: Saddle): HillRow[] {
  return ROWS.map((spec) => {
    const rng = seeded(seed * 31 + spec.id.charCodeAt(0) * 7 + 3)
    const peaks: Peak[] = []
    const count = Math.floor((2 * spec.span) / spec.spacing) + 1
    for (let i = 0; i < count; i++) {
      const x = -spec.span + i * spec.spacing + (rng() - 0.5) * spec.spacing * 0.45
      const z = rowZ(spec, x) + (rng() - 0.5) * spec.spacing * 0.25
      const hero = (i + spec.id.charCodeAt(0)) % 3 === 1
      let height = spec.height[0] + (hero ? 0.7 + rng() * 0.3 : rng() * 0.55) * (spec.height[1] - spec.height[0])
      const radius = range(rng, spec.radius)
      const sharp = range(rng, spec.sharp)
      const cap = rng() < spec.capChance
      if (spec.id === 'A') {
        // The window: no peak in the saddle; the two peaks flanking it stand tall so it reads as a cut.
        if (Math.abs(x - saddle.x) < saddle.halfWidth) continue
        if (Math.abs(x - saddle.x) < saddle.halfWidth + spec.spacing) height = spec.height[1] - rng() * 3
      }
      // Row B keeps a corridor behind the saddle so the crag castle stands against the hazed far rows, not a near hill.
      if (spec.id === 'B' && Math.abs(x - saddle.x) < 110) continue
      peaks.push({ x, z, height, radius, sharp, cap })
    }
    return { id: spec.id, z0: spec.z0, curve: spec.curve, peaks }
  })
}

/* ---------- the lake, the forest edges ---------- */

export function lakeFor(): Lake {
  // Centred on the south ray 80 m past the plate so the monastery stands on the far shore; the river runs into its near shore.
  const south = outwardPose('south')
  const mid = alongRay(south, 416)
  return { cx: mid.x, cz: mid.z, rx: 160, rz: 80, angle: 0.22, level: -0.72 }
}

/** Signed distance-like field for the lake: > 0 inside (metres toward the middle, warped), < 0 outside. */
export function lakeInside(lake: Lake, x: number, z: number): number {
  const dx = x - lake.cx
  const dz = z - lake.cz
  const c = Math.cos(-lake.angle)
  const s = Math.sin(-lake.angle)
  const u = dx * c - dz * s
  const v = dx * s + dz * c
  const r = Math.hypot(u / lake.rx, v / lake.rz)
  const warp = 1 + fbm(x * 0.009 + 4.2, z * 0.009 + 1.7, 3) * 0.24
  return (1 - r * warp) * Math.min(lake.rx, lake.rz)
}

export function wallsFor(plateHalfX: number): ForestWall[] {
  const east = outwardPose('east')
  const west = outwardPose('west')
  const inner = plateHalfX + 12
  const eastGap = crossX(east, inner + 18)
  const westGap = crossX(west, -(inner + 18))
  return [
    { side: 'east', inner, depth: 38, zMin: -440, zMax: 500, gapZ: eastGap, gapHalf: 26 },
    { side: 'west', inner, depth: 38, zMin: -440, zMax: 500, gapZ: westGap, gapHalf: 26 },
  ]
}

/** z where a pose's centre ray crosses the vertical line x = at. */
function crossX(pose: EdgePose, at: number): number {
  const cam = poseCamera(pose)
  const view = (viewBearingDeg(pose) * Math.PI) / 180
  const vx = Math.sin(view)
  const vz = Math.cos(view)
  const t = (at - cam.x) / vx
  return cam.z + vz * t
}

/** 0–1 density of the forest-edge walls at a point (soft edges, noisy outer line, the window cut out). */
export function wallDensity(walls: ForestWall[], x: number, z: number): number {
  let best = 0
  for (const wall of walls) {
    const sx = wall.side === 'east' ? x : -x
    const wobble = fbm(z * 0.012 + (wall.side === 'east' ? 3.1 : 8.7), 0.4, 3) * 26
    const start = wall.inner + wobble
    const end = start + wall.depth + fbm(z * 0.02 + 1.2, 7.7, 2) * 18
    const across = smoothstep(start - 4, start + 6, sx) * (1 - smoothstep(end - 8, end + 4, sx))
    const along = smoothstep(wall.zMin, wall.zMin + 70, z) * (1 - smoothstep(wall.zMax - 70, wall.zMax, z))
    const gap = smoothstep(wall.gapHalf, wall.gapHalf + 14, Math.abs(z - wall.gapZ))
    best = Math.max(best, across * along * gap)
  }
  return best
}

/* ---------- the plan ---------- */

export function barrierPlan(layout: GeneratedKingdom, seed: number): BarrierPlan {
  const plateHalfX = Math.ceil((layout.worldSize[0] / 2 + 160) / 60) * 60
  const landmarks = vistas()
  const saddle = saddleFor(ROWS[0])
  const rows = buildRows(seed, saddle)
  const north = landmarks.find((v) => v.id === 'north')!
  const west = landmarks.find((v) => v.id === 'west')!
  const east = landmarks.find((v) => v.id === 'east')!
  const south = landmarks.find((v) => v.id === 'south')!
  const lake = lakeFor()
  return {
    vistas: landmarks,
    rows,
    saddle,
    crag: { x: north.x, z: north.z, height: 32, radius: 48, sharp: 1.9, cap: true, plateau: 0.28 },
    millHill: { x: west.x, z: west.z, height: 26, radius: 74, sharp: 1.1, cap: false, plateau: 0.14 },
    cityRise: { x: east.x, z: east.z, height: 5, radius: 130, sharp: 1, cap: false },
    lake,
    walls: wallsFor(plateHalfX),
    lakeWoods: { zMin: lake.cz + lake.rz + 36, zMax: lake.cz + lake.rz + 120, xMin: lake.cx - 190, xMax: lake.cx + 190, gapX: south.x, gapHalf: 34 },
  }
}

/** 0–1 density of the woods behind the lake's far shore. */
export function lakeWoodsDensity(plan: BarrierPlan, x: number, z: number): number {
  const w = plan.lakeWoods
  const along = smoothstep(w.xMin, w.xMin + 60, x) * (1 - smoothstep(w.xMax - 60, w.xMax, x))
  const across = smoothstep(w.zMin - 6, w.zMin + 10, z + fbm(x * 0.015, 2.2, 2) * 20) * (1 - smoothstep(w.zMax - 20, w.zMax, z))
  const gap = smoothstep(w.gapHalf, w.gapHalf + 16, Math.abs(x - w.gapX))
  return along * across * gap
}

/** Height of the hill rows at a point: cones with a crease texture; also which row dominates. */
export function rowsHeight(rows: HillRow[], x: number, z: number): { height: number; row: RowId | null; peakFrac: number; cap: boolean } {
  let max = 0
  let sum = 0
  let row: RowId | null = null
  let dominant = 1
  let cap = false
  let jag = 0
  for (const r of rows) {
    for (const p of r.peaks) {
      const dx = x - p.x
      const dz = z - p.z
      if (Math.abs(dx) > p.radius || Math.abs(dz) > p.radius) continue
      if (jag === 0) jag = 1 + fbm(x * 0.02 + 2.2, z * 0.02, 2) * 0.5
      const d = Math.hypot(dx, dz) * jag
      const k = Math.max(0, 1 - d / p.radius)
      const h = p.height * Math.pow(k, p.sharp)
      if (h > max) {
        max = h
        row = r.id
        dominant = p.height
        cap = p.cap
      }
      sum += h
    }
  }
  return { height: max + (sum - max) * 0.2, row, peakFrac: max > 0 ? max / dominant : 0, cap }
}

export function peakHeight(peak: Peak, x: number, z: number): number {
  const d = Math.hypot(x - peak.x, z - peak.z)
  const plateau = peak.plateau ?? 0
  const k = Math.min(1, Math.max(0, 1 - d / peak.radius) / (1 - plateau))
  return peak.height * Math.pow(k, peak.sharp)
}
