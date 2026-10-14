/**
 * Endless continuation: the pure outer world beyond the authored slabs. No three.js in here.
 *
 * Coordinates as in the layout: x east, z south, y up, metres. The authored plate is the
 * rectangle `PLATE_RECT` (two flat land slabs cut by the S-fjord); everything here lives outside
 * it in three LOD rings whose lattices meet, and continues the land's own language:
 *
 *  north  the fjord leaves the plate as a narrowing arm between tall banks and ends at a glacier
 *         front under a broad, ice-capped shield volcano; mountain rows recede behind, with a
 *         low misted corridor kept open up the volcano's axis so the sky shows over its summit;
 *  south  the fjord opens into a bay with black-sand banks and two headlands, then open sea to
 *         the horizon with a few far skerries;
 *  east   black-sand flats and cooled lava fields (lobes and ropes) under the palisade line;
 *  west   moss moor with hummocks, two glacier tongues coming down from a far ice cap.
 *
 * Aerial perspective is baked per face (`haze`), so the far rings dissolve into the sky colour
 * before the fog finishes the job.
 */
import { seeded } from '../../layout/biome-layout'
import { cellular, fbm, lerp, ridged, smoothstep } from '../../layout/noise'
import {
  GROUND_Y,
  HIDDEN_SEA_Y,
  PLATE_RECT,
  SEAM_LIFT,
  WATER_PLANE_HALF,
  WATER_Y,
  inPlateRect,
  plateRectDistance,
  seamHeightAt,
} from '../../layout/terrain'

/* ---------- rings ---------- */

export interface RingSpec {
  ring: 1 | 2 | 3
  /** Chebyshev inner radius; ring 1 uses the plate rectangle instead. */
  inner: number
  outer: number
  /** Lattice cell in metres; every boundary sits on both neighbouring lattices. */
  cell: number
}

/** Chebyshev radius of the last ring: fogged out from anywhere in the camera box. */
export const OUTER_REACH = 2400

/** Plate → 560 m at 10 m, 560–1200 m at 20 m, 1200–2400 m at 80 m. */
export const RINGS: readonly RingSpec[] = [
  { ring: 1, inner: 0, outer: 560, cell: 10 },
  { ring: 2, inner: 560, outer: 1200, cell: 20 },
  { ring: 3, inner: 1200, outer: OUTER_REACH, cell: 80 },
]

export function chebyshev(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z))
}

/** Whether a point is inside the ring's inner boundary (the plate rectangle for ring 1). */
export function insideRingInner(ring: RingSpec, x: number, z: number): boolean {
  return ring.ring === 1 ? inPlateRect(x, z) : chebyshev(x, z) < ring.inner - 1e-6
}

export function ringAt(x: number, z: number): RingSpec | null {
  if (inPlateRect(x, z)) return null
  const d = chebyshev(x, z)
  for (const ring of RINGS) if (d < ring.outer) return ring
  return null
}

/* ---------- geography ---------- */

/** The fjord arm north of the plate: the authored mouth is x ∈ [−6, 44] at z = −200. */
export const ARM = { x0: 19, width0: 25, widthHead: 19, zMouth: PLATE_RECT.minZ, zHead: -332 } as const
/** The bay south of the plate: the authored mouth is x ∈ [−28, 34] at z = 520. */
export const BAY = { xc0: 3, drift: 0.05, width0: 31, widen: 0.55, zMouth: PLATE_RECT.maxZ, zOpen: 830 } as const
/** Ice-capped shield volcano at the head of the arm (the north vista). */
export const VOLCANO = { x: 30, z: -440, radius: 135, height: 34, craterRadius: 18, craterDepth: 6, notchBearing: 358, tongueHalfWidth: 26 } as const
/** Sinter flat the geyser field (east vista) stands on: lava lobes and relief are damped inside. */
export const GEYSER_FIELD = { x: 396, z: -20, r: 62 } as const
/** Moss hill the stave church (west vista) stands on. */
export const CHURCH_HILL = { x: -386, z: -42, r: 48, h: 9 } as const

export interface Blob {
  x: number
  z: number
  rx: number
  rz: number
  h: number
}

/** Bay headlands: the west one carries the longhouse (south vista). */
export const HEADLANDS: readonly Blob[] = [
  { x: -70, z: 585, rx: 52, rz: 44, h: 9 },
  { x: 150, z: 640, rx: 64, rz: 52, h: 7 },
]
export const SKERRIES: readonly Blob[] = [
  { x: -380, z: 1150, rx: 95, rz: 80, h: 14 },
  { x: 260, z: 1400, rx: 130, rz: 100, h: 18 },
  { x: -120, z: 1720, rx: 160, rz: 130, h: 22 },
]

/** Glacier tongues coming down from the north-west ice cap; `b` is the snout. */
export const TONGUES = [
  { ax: -900, az: -430, bx: -362, bz: -150, half: 55 },
  { ax: -820, az: 270, bx: -350, bz: 150, half: 44 },
] as const

/**
 * Window corridors: sectors where the mountain rows and tuyas are suppressed so each vista
 * reads against haze and sky. North runs to the reach (sky over the volcano); east and west
 * only keep the first 900 m low, the far rows fill the frame top as a hazed backdrop.
 */
export const CORRIDORS = {
  north: { x: ARM.x0, from: -380, halfWidth0: 75, grow: 0.22 },
  east: { z: -20, from: 300, to: 900, halfWidth0: 60, grow: 0.25 },
  west: { z: -45, from: 300, to: 900, halfWidth0: 60, grow: 0.25 },
} as const

export function armCentre(z: number): number {
  return ARM.x0 + 6 * Math.sin((z - ARM.zMouth) / 60)
}

export function armHalfWidth(z: number): number {
  return lerp(ARM.width0, ARM.widthHead, smoothstep(ARM.zMouth, ARM.zHead, z))
}

export function bayCentre(z: number): number {
  return BAY.xc0 + (z - BAY.zMouth) * BAY.drift
}

export function bayHalfWidth(z: number): number {
  return BAY.width0 + (z - BAY.zMouth) * BAY.widen
}

function bayEnd(x: number): number {
  return BAY.zOpen + 45 * fbm(x * 0.004 + 2.5, 7.7, 2)
}

/** Metres inside an elliptical blob (negative outside), with a ragged edge. */
function blobField(b: Blob, x: number, z: number): number {
  const u = (x - b.x) / b.rx
  const v = (z - b.z) / b.rz
  const r = Math.hypot(u, v) * (1 + 0.22 * fbm(x * 0.02 + 5, z * 0.02 + 1, 2))
  return (1 - r) * Math.min(b.rx, b.rz)
}

function blobHeight(b: Blob, x: number, z: number): number {
  const u = (x - b.x) / b.rx
  const v = (z - b.z) / b.rz
  const r2 = u * u + v * v
  return r2 >= 1 ? 0 : b.h * (1 - r2) * (0.85 + 0.3 * fbm(x * 0.03, z * 0.03, 2))
}

/** Unified land field, metres, positive inside land. The plate itself counts as land. */
export function landField(x: number, z: number): number {
  if (inPlateRect(x, z)) return 60
  if (z > BAY.zMouth) {
    let land = Math.min(Math.abs(x - bayCentre(z)) - bayHalfWidth(z), bayEnd(x) - z)
    land += 7 * fbm(x * 0.02 + 1.1, z * 0.02 + 3.3, 2) * smoothstep(0, 30, z - BAY.zMouth)
    for (const h of HEADLANDS) land = Math.max(land, blobField(h, x, z))
    for (const s of SKERRIES) land = Math.max(land, blobField(s, x, z))
    return land
  }
  if (z < ARM.zMouth) {
    let land = Math.abs(x - armCentre(z)) - armHalfWidth(z)
    if (z < ARM.zHead) land = Math.max(land, ARM.zHead - z)
    return land
  }
  return plateRectDistance(x, z) + 40
}

/** 0 outside a window corridor, 1 well inside (rows and tuyas are multiplied by 1 − this). */
export function corridorMask(x: number, z: number): number {
  let mask = 0
  const n = CORRIDORS.north
  if (z < n.from) {
    const hw = n.halfWidth0 + n.grow * Math.max(0, -z - 440)
    mask = Math.max(mask, (1 - smoothstep(hw, hw + 70, Math.abs(x - n.x))) * smoothstep(n.from, n.from - 60, z))
  }
  for (const c of [CORRIDORS.east, CORRIDORS.west]) {
    const along = c === CORRIDORS.east ? x : -x
    if (along > c.from && along < c.to + 150) {
      const hw = c.halfWidth0 + c.grow * (along - c.from)
      mask = Math.max(mask, (1 - smoothstep(hw, hw + 50, Math.abs(z - c.z))) * (1 - smoothstep(c.to, c.to + 150, along)))
    }
  }
  return mask
}

/* ---------- mountain rows and tuyas ---------- */

export interface OuterPeak {
  x: number
  z: number
  height: number
  radius: number
  /** 3, 4, 5 behind the authored rear row; 6 is the ghost row at the horizon. */
  row: 3 | 4 | 5 | 6
  sharp: number
  shoulders: Array<{ dx: number; dz: number; radius: number; height: number }>
}

interface RowSpec {
  row: 3 | 4 | 5 | 6
  z: number
  /** Forward curve z = z0 + curve·x², so the rows wrap round the east and west at a distance. */
  curve: number
  count: number
  spacing: number
  height: [number, number]
  radius: [number, number]
}

/** Each row is farther, taller and apparently smaller than the authored rear row (z ≈ −190, ≤ 65 m). */
const ROWS: RowSpec[] = [
  { row: 3, z: -310, curve: 0.0004, count: 15, spacing: 60, height: [62, 96], radius: [40, 56] },
  { row: 4, z: -460, curve: 0.0003, count: 15, spacing: 80, height: [96, 140], radius: [60, 82] },
  { row: 5, z: -670, curve: 0.00018, count: 15, spacing: 105, height: [140, 200], radius: [86, 116] },
  { row: 6, z: -1150, curve: 0.00005, count: 13, spacing: 250, height: [220, 320], radius: [200, 280] },
]

export function buildRows(seed: number): OuterPeak[] {
  const out: OuterPeak[] = []
  for (const spec of ROWS) {
    const rng = seeded(seed * 13 + spec.row * 101 + 5)
    for (let i = 0; i < spec.count; i++) {
      const x = (i - (spec.count - 1) / 2) * spec.spacing + (rng() - 0.5) * spec.spacing * 0.5
      const z = spec.z + spec.curve * x * x + (rng() - 0.5) * spec.spacing * 0.3
      const hero = (i + spec.row) % 3 === 1
      const height = spec.height[0] + (hero ? 0.75 + rng() * 0.25 : rng() * 0.6) * (spec.height[1] - spec.height[0])
      const radius = spec.radius[0] + rng() * (spec.radius[1] - spec.radius[0])
      const sharp = hero ? 1.35 + rng() * 0.3 : 1.1 + rng() * 0.3
      const n = 3 + (rng() < 0.5 ? 1 : 0)
      const shoulders: OuterPeak['shoulders'] = []
      for (let s = 0; s < n; s++) {
        const a = (s / n) * Math.PI * 2 + rng() * 1.2
        const d = radius * (0.55 + rng() * 0.35)
        shoulders.push({ dx: Math.cos(a) * d, dz: Math.sin(a) * d, radius: radius * (0.4 + rng() * 0.25), height: height * (0.4 + rng() * 0.25) })
      }
      // No peak stands in a window corridor or on the volcano; the corridor mask thins the flanks of the rest.
      if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.radius + radius * 0.6) continue
      if (corridorMask(x, z) > 0.35) continue
      out.push({ x, z, height, radius, row: spec.row, sharp, shoulders })
    }
  }
  return out
}

export interface Tuya {
  x: number
  z: number
  radius: number
  height: number
}

/** Flat-topped table mountains east, west and over the far south sea. */
export function buildTuyas(seed: number): Tuya[] {
  const rng = seeded(seed * 37 + 11)
  const out: Tuya[] = []
  // Bearings from +z (south) toward +x; (bearing range, distance range).
  const slots: Array<[number, number, number, number]> = [
    [62, 82, 560, 760],
    [88, 108, 900, 1300],
    [112, 132, 620, 900],
    [230, 250, 640, 880],
    [256, 278, 980, 1400],
    [282, 300, 560, 760],
    [20, 40, 1250, 1700],
    [320, 340, 1300, 1750],
  ]
  for (const [b0, b1, d0, d1] of slots) {
    const bearing = ((b0 + rng() * (b1 - b0)) * Math.PI) / 180
    const distance = d0 + rng() * (d1 - d0)
    const x = Math.sin(bearing) * distance
    const z = Math.cos(bearing) * distance
    const far = smoothstep(500, 1700, distance)
    out.push({ x, z, radius: (70 + rng() * 60) * (1 + far * 0.8), height: (42 + rng() * 40) * (1 + far * 0.9) })
  }
  return out
}

function cone(h: number, r: number, d: number, sharp: number): number {
  const k = Math.max(0, 1 - d / r)
  return h * Math.pow(k, sharp)
}

function rowsHeight(peaks: OuterPeak[], x: number, z: number): { height: number; peakFrac: number; row: number } {
  let max = 0
  let sum = 0
  let dominant = 1
  let row = 0
  let jag = 0
  let crease = 0
  for (const p of peaks) {
    const dx = x - p.x
    const dz = z - p.z
    if (Math.abs(dx) > p.radius * 1.4 || Math.abs(dz) > p.radius * 1.4) continue
    if (jag === 0) {
      jag = 1 + fbm(x * 0.03 + 2.2, z * 0.03, 2) * 0.4
      const r = 1 - Math.abs(fbm(x * 0.018 + 1.1, z * 0.018 + 7.3, 3)) * 2.2
      crease = 0.76 + 0.28 * Math.max(0, r)
    }
    let h = cone(p.height, p.radius, Math.hypot(dx, dz) * jag, p.sharp)
    for (const s of p.shoulders) h = Math.max(h, cone(s.height, s.radius, Math.hypot(dx - s.dx, dz - s.dz) * jag, 1.0))
    h *= crease
    if (h > max) {
      max = h
      dominant = p.height
      row = p.row
    }
    sum += h
  }
  return { height: max + (sum - max) * 0.15, peakFrac: max > 0 ? max / dominant : 0, row }
}

function tuyasHeight(tuyas: Tuya[], x: number, z: number): { height: number; top: number } {
  let height = 0
  let top = 0
  for (const t of tuyas) {
    const d = Math.hypot(x - t.x, z - t.z) * (1 + 0.12 * fbm(x * 0.01 + 1, z * 0.01 + 2, 2))
    if (d > t.radius) continue
    // Steep sides to a flat cap at 0.42 R.
    const k = Math.min(1, (t.radius - d) / (t.radius * 0.58))
    const h = t.height * (k < 1 ? Math.pow(k, 1.3) : 1)
    if (h > height) {
      height = h
      top = k >= 1 ? 1 : 0
    }
  }
  return { height, top }
}

/* ---------- the volcano and the ice ---------- */

export function volcanoHeight(x: number, z: number): { height: number; k: number; crater: boolean; notch: boolean } {
  const dx = x - VOLCANO.x
  const dz = z - VOLCANO.z
  const d = Math.hypot(dx, dz)
  const k = Math.max(0, 1 - d / VOLCANO.radius)
  if (k <= 0) return { height: 0, k: 0, crater: false, notch: false }
  // A shield: gentle convex flanks, lava channels as faint radial ridges.
  let h = VOLCANO.height * Math.pow(k, 1.25) * (0.94 + 0.12 * fbm(x * 0.02, z * 0.02, 2))
  const crater = d < VOLCANO.craterRadius
  if (crater) h -= ((VOLCANO.craterRadius - d) / VOLCANO.craterRadius) * VOLCANO.craterDepth
  // One notch on the rim toward the fjord so the ember glow reads from the north pose.
  const bearing = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360
  const dBearing = Math.abs(((bearing - VOLCANO.notchBearing + 540) % 360) - 180)
  const notch = k > 0.74 && dBearing < 16
  if (notch) h -= 5 * smoothstep(16, 6, dBearing) * smoothstep(0.74, 0.86, k)
  return { height: h, k, crater, notch }
}

/** Is the volcano's glacier tongue here: the south flank sector from the cap down to the arm head. */
function volcanoTongue(x: number, z: number, k: number): boolean {
  if (k <= 0) return false
  return Math.abs(x - (VOLCANO.x - 6)) < VOLCANO.tongueHalfWidth * (1 + 0.3 * (1 - k)) && z > VOLCANO.z
}

function tongueField(x: number, z: number): { inside: number; along: number } {
  let best = { inside: -1e9, along: 0 }
  for (const t of TONGUES) {
    const dx = t.bx - t.ax
    const dz = t.bz - t.az
    const len2 = dx * dx + dz * dz
    const u = Math.min(1, Math.max(0, ((x - t.ax) * dx + (z - t.az) * dz) / len2))
    const px = t.ax + dx * u
    const pz = t.az + dz * u
    const half = t.half * (1 + 0.25 * fbm(x * 0.012 + 3, z * 0.012 + 8, 2)) * (0.6 + 0.4 * (1 - u))
    const inside = half - Math.hypot(x - px, z - pz)
    if (inside > best.inside) best = { inside, along: u }
  }
  return best
}

/* ---------- materials, haze ---------- */

export type OuterMaterial = 'sea' | 'wet' | 'moss' | 'sand' | 'lava' | 'mountain' | 'snow' | 'ice' | 'tuya'

export interface OuterSample {
  height: number
  material: OuterMaterial
  /** On a mountain cone: this point's height as a fraction of the dominant peak (snow). */
  peakFrac: number
  /** Row of the dominant peak, 0 off the rows. */
  row: number
  /** 0–1 toward the sky colour: the baked aerial perspective. */
  haze: number
  /** 1 on the lava field, 0 off it (ember cracks and crust noise). */
  lava: number
}

const ROW_HAZE: Record<number, number> = { 3: 0.12, 4: 0.3, 5: 0.5, 6: 0.82 }
const SNOW_LINE = 0.8

export function groundHaze(x: number, z: number): number {
  const d = plateRectDistance(x, z)
  return 0.05 + 0.85 * smoothstep(150, 1200, d)
}

/** Where the authored water plane ends, the outer world's own sea begins at the same height. */
export function seaSurfaceY(x: number, z: number): number {
  return Math.abs(x) < WATER_PLANE_HALF && Math.abs(z) < WATER_PLANE_HALF ? HIDDEN_SEA_Y : WATER_Y
}

export function lavaMask(x: number, z: number, d: number): number {
  const east = smoothstep(240, 420, x) * smoothstep(-340, -150, z)
  const southEast = smoothstep(430, 540, z) * smoothstep(130, 260, x)
  const n = 0.5 + 1.1 * fbm(x * 0.003 + 1.7, z * 0.003 - 4.2, 3)
  // The field lies between the palisade and the far flats: beyond ~420 m the crust gives way to sand.
  return smoothstep(0.5, 0.75, 0.45 * n + 0.6 * east + 0.35 * southEast) * smoothstep(25, 70, d) * (1 - smoothstep(380, 520, d))
}

/* ---------- the world ---------- */

export interface OuterWorld {
  seed: number
  rings: readonly RingSpec[]
  peaks: OuterPeak[]
  tuyas: Tuya[]
  /** The heightfield outside the plate; inside it, the hidden floor under the authored water. */
  sample(x: number, z: number): OuterSample
  /** The height the seam vertices take: the slab top plus the lift, or the hidden sea. */
  seamHeight(x: number, z: number): number
  landField(x: number, z: number): number
  hazeAt(x: number, z: number): number
  /** Terrain height for the camera floor: the outer surface, or the slab inside the plate. */
  heightAt(x: number, z: number): number
}

export function createOuterWorld(seed: number): OuterWorld {
  const peaks = buildRows(seed)
  const tuyas = buildTuyas(seed)

  const sample = (x: number, z: number): OuterSample => {
    if (inPlateRect(x, z)) return { height: HIDDEN_SEA_Y - 0.4, material: 'sea', peakFrac: 0, row: 0, haze: 0, lava: 0 }
    const d = plateRectDistance(x, z)
    const haze = groundHaze(x, z)
    const land = landField(x, z)
    const seaY = seaSurfaceY(x, z)

    if (land <= -2.5) {
      return { height: seaY, material: 'sea', peakFrac: 0, row: 0, haze, lava: 0 }
    }

    // Land. Near the seam the surface is the slab top; the moor rises and roughens with distance.
    const near = smoothstep(0, 60, d)
    const open = 1 - corridorMask(x, z)
    const relief = near * (1.0 * fbm(x * 0.035, z * 0.035, 3) + 0.4 * fbm(x * 0.12 + 4, z * 0.12 + 1, 2))
    // The moor rises with distance, except up the window corridors, which stay low for the sky.
    const rise = smoothstep(80, 420, d) * (6 + 9 * (0.5 + fbm(x * 0.004 + 3, z * 0.004 + 7, 3))) * (0.35 + 0.65 * open)
    let ground = GROUND_Y + SEAM_LIFT + relief + rise
    let material: OuterMaterial = 'moss'

    // The vista flats: the geyser field's sinter apron and the church hill are smooth ground.
    const fieldK = 1 - smoothstep(GEYSER_FIELD.r - 20, GEYSER_FIELD.r, Math.hypot(x - GEYSER_FIELD.x, z - GEYSER_FIELD.z))
    const hillK = 1 - smoothstep(0, CHURCH_HILL.r, Math.hypot(x - CHURCH_HILL.x, z - CHURCH_HILL.z))
    ground -= relief * Math.max(fieldK, hillK)
    ground += CHURCH_HILL.h * hillK * hillK

    // Black sand and the cooled lava field (east / south-east), ropes and lobes on the crust.
    const lava = lavaMask(x, z, d) * (1 - fieldK)
    const beach = z > BAY.zMouth ? 1 - smoothstep(8, 30, land) : 0
    const sandScore = 0.5 + 0.9 * fbm(x * 0.005 + 9, z * 0.005 + 2, 3) + 0.35 * smoothstep(240, 420, x) + 0.6 * beach
    const sandK = smoothstep(0.52, 0.66, sandScore) * smoothstep(15, 60, d)
    if (lava > 0.001) {
      const warp = fbm(x * 0.006 + 1, z * 0.006 + 2, 2) * 30
      const lobe = 1 - smoothstep(22, 36, cellular(x + warp, z - warp, 95).f1)
      ground += lava * (1.4 * ridged(x * 0.025 + 3, z * 0.025, 3) + 2.2 * lobe)
    }
    if (lava > 0.5) material = 'lava'
    else if (sandK > 0.5 || beach > 0.5 || fieldK > 0.5) material = 'sand'

    // Headlands and skerries in the bay.
    if (z > BAY.zMouth) {
      for (const b of HEADLANDS) ground += blobHeight(b, x, z)
      for (const b of SKERRIES) ground += blobHeight(b, x, z)
    }

    // Mountain rows and tuyas, thinned in the window corridors and off the volcano.
    const v = volcanoHeight(x, z)
    const rowsOpen = open * (1 - smoothstep(0.05, 0.3, v.k))
    const rows = rowsHeight(peaks, x, z)
    const tuya = tuyasHeight(tuyas, x, z)
    let peakFrac = 0
    let row = 0
    let rowHaze = haze
    let ice = false
    if (rowsOpen > 0.001) {
      if (rows.height * rowsOpen > 3) {
        ground += rows.height * rowsOpen
        material = rows.peakFrac >= SNOW_LINE ? 'snow' : 'mountain'
        peakFrac = rows.peakFrac
        row = rows.row
        rowHaze = lerp(haze, Math.max(haze, ROW_HAZE[row] ?? haze), smoothstep(0.05, 0.4, peakFrac))
      } else if (rows.height * rowsOpen > 0.2) {
        ground += rows.height * rowsOpen
      }
      if (tuya.height * rowsOpen > 2) {
        ground += tuya.height * rowsOpen
        material = 'tuya'
      }
    }

    // The volcano, its ice cap and the tongue down to the arm head.
    if (v.k > 0) {
      ground += v.height
      if (v.crater || v.notch) material = 'lava'
      else if (v.k > 0.84 || volcanoTongue(x, z, v.k)) ice = true
      else material = 'mountain'
    }

    // Western glacier tongues and the far north-west ice cap.
    const tongue = tongueField(x, z)
    if (tongue.inside > 0) {
      const thick = smoothstep(0, 12, tongue.inside)
      ground += thick * (3 + 55 * Math.pow(1 - tongue.along, 1.3) + 1.2 * ridged(x * 0.03 + 7, z * 0.03 + 2, 2))
      if (tongue.inside > 3) ice = true
    }
    const cap = smoothstep(-700, -1100, z) * smoothstep(-150, -500, x)
    if (cap > 0) {
      ground += cap * (40 + 20 * (0.5 + fbm(x * 0.002, z * 0.002, 3)))
      if (cap > 0.5) ice = true
    }
    if (ice) material = 'ice'

    // The shore: black-sand ramps into the bay, steep fjord-arm banks that climb into walls.
    const inArm = z < ARM.zMouth && z > ARM.zHead - 40 && Math.abs(x - armCentre(z)) < 110
    // Banks: steep in the arm; at the bay mouth they continue the slab's vertical fjord walls for
    // the first 90 m (no step down at the plate corner), then ease into black-sand beaches.
    const rampWidth = inArm ? 7 : z > BAY.zMouth ? lerp(3, 14, smoothstep(0, 90, z - BAY.zMouth)) : 14
    const cliffK = smoothstep(-2.5, rampWidth, land)
    if (inArm) {
      // Banks climb into fjord walls between the authored walls' end and the glacier front.
      const wallK = smoothstep(ARM.zMouth - 20, ARM.zMouth - 90, z) * smoothstep(ARM.zHead, ARM.zHead + 35, z)
      ground += wallK * smoothstep(5, 42, land) * (26 + 18 * (0.5 + fbm(x * 0.02 + 6, z * 0.02 + 1, 2)))
    }
    const height = seaY + (ground - seaY) * cliffK
    if (cliffK < 0.999) {
      if (height < seaY + 0.05) return { height, material: 'sea', peakFrac: 0, row: 0, haze, lava: 0 }
      if (height < seaY + 0.9) return { height, material: 'wet', peakFrac: 0, row: 0, haze, lava: 0 }
      if (material === 'moss' && !ice) material = 'sand'
    }
    return { height, material, peakFrac, row, haze: rowHaze, lava }
  }

  return {
    seed,
    rings: RINGS,
    peaks,
    tuyas,
    sample,
    seamHeight: seamHeightAt,
    landField,
    hazeAt: groundHaze,
    heightAt: (x, z) => (inPlateRect(x, z) ? GROUND_Y : sample(x, z).height),
  }
}

/* ---------- fog ---------- */

/**
 * The land's own fog follows the camera distance (`fogRange` in the layout). Under the outer
 * world the far end is pushed out so the rings dissolve by aerial perspective, and the fog colour
 * is the sky colour so the end of the last ring is never a band against the background. Nothing
 * in the product overview frame is nearer than the fog start at that pose, so the overview is
 * unchanged.
 */
export function outerFogRange(cameraDistance: number, night: boolean): { near: number; far: number } {
  return night ? { near: cameraDistance + 240, far: cameraDistance + 1150 } : { near: cameraDistance + 280, far: cameraDistance + 1320 }
}
