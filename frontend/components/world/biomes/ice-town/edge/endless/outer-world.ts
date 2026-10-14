/**
 * Endless shelf: the pure outer world beyond the authored ice plate. No three.js in here.
 *
 * Coordinates as in the layout: x east, z south, y up, metres. The authored plate is the square
 * |x|,|z| < worldExtent (170). Everything here lives outside it, in three Chebyshev LOD rings whose
 * lattices line up at the shared boundaries, and continues the land's own noise language (`fbm`,
 * `foothill`, `landField`) so the coast runs out into pack ice with open leads, the back land
 * carries on into a second, third and ghost row of mountains, and the far ice fades toward the sky.
 */
import { type BiomeLayout, type MountainProfile, mountainProfile, seeded } from '../../layout/biome-layout'
import { hash2 } from '../../layout/geometry'
import { backFade, coastRampWidth, easedBeltHeight, fbm, foothill, landField, mountainHeight, mountainPeaks, sampleTerrain, smoothstep } from '../../layout/terrain'
import type { SkyGrade } from '../../scene/sky-blend'

/* ---------- rings ---------- */

export interface RingSpec {
  ring: 0 | 1 | 2 | 3
  /** Chebyshev inner / outer radius in metres. */
  inner: number
  outer: number
  /** Lattice cell in metres; divides both radii and the next ring's cell is a multiple of it. */
  cell: number
}

/** Chebyshev radius of the last ring: the far frustum from anywhere in the camera box is fogged out before this. */
export const OUTER_REACH = 2240

/** The lattice cell at a Chebyshev radius, with each LOD step eased over 60 m (for sizing pack features). */
export function latticeCellAt(cheb: number): number {
  return 5 + 5 * smoothstep(270, 330, cheb) + 10 * smoothstep(470, 530, cheb) + 60 * smoothstep(1090, 1150, cheb)
}

/** Between these (Euclidean) distances open leads rise from under the water disc to just above it. */
export const FAR_LEAD_START = 350
export const FAR_LEAD_END = 650

/**
 * 170–300 m at 5 m (the near field a low camera stands in), 300–500 m at 10 m, 500–1120 m at 20 m,
 * 1120–2240 m at 80 m: every boundary sits on both neighbouring lattices.
 */
export function ringSpecs(plateHalf: number): RingSpec[] {
  const inner = Math.round(plateHalf / 10) * 10
  return [
    { ring: 0, inner, outer: 300, cell: 5 },
    { ring: 1, inner: 300, outer: 500, cell: 10 },
    { ring: 2, inner: 500, outer: 1120, cell: 20 },
    { ring: 3, inner: 1120, outer: OUTER_REACH, cell: 80 },
  ]
}

export function chebyshev(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z))
}

export function ringAt(x: number, z: number, rings: RingSpec[]): RingSpec | null {
  const d = chebyshev(x, z)
  for (const ring of rings) if (d >= ring.inner && d < ring.outer) return ring
  return null
}

/* ---------- coast distance (exact EDT over a sampled plate) ---------- */

export interface CoastField {
  step: number
  margin: number
  /** The distance grid itself (`n × n`, metres), so a build can hand it to another thread. */
  grid: Float64Array
  /** Metres to the nearest authored non-sea point; ≥ 60 anywhere beyond the sampled margin. */
  distance(x: number, z: number): number
}

const primedCoast = new WeakMap<BiomeLayout, Map<string, Float64Array>>()

/** Install a coast grid computed elsewhere (the land build Worker) so `buildCoastField` skips its 9 k terrain samples. */
export function primeCoastGrid(layout: BiomeLayout, step: number, margin: number, grid: Float64Array): void {
  let per = primedCoast.get(layout)
  if (!per) {
    per = new Map()
    primedCoast.set(layout, per)
  }
  per.set(`${step}:${margin}`, grid)
}

/** The distance field around a finished grid. */
export function coastFieldFromGrid(layout: BiomeLayout, step: number, margin: number, grid: Float64Array): CoastField {
  const half = layout.worldExtent + margin
  const n = Math.floor((2 * half) / step) + 1
  const at = (i: number, j: number) => grid[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))]
  return {
    step,
    margin,
    grid,
    distance(x, z) {
      const outside = Math.max(0, Math.abs(x) - half, Math.abs(z) - half)
      if (outside > 0) return Math.max(margin, outside + margin)
      const gx = (x + half) / step
      const gz = (z + half) / step
      const i = Math.floor(gx)
      const j = Math.floor(gz)
      const u = gx - i
      const w = gz - j
      const a = at(i, j)
      const b = at(i + 1, j)
      const c = at(i, j + 1)
      const e = at(i + 1, j + 1)
      return a + (b - a) * u + (c - a) * w + (a - b - c + e) * u * w
    },
  }
}

const INF = 1e12

/** Felzenszwalb–Huttenlocher 1-D squared distance transform, in place into `d`. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, zz: Float64Array): void {
  let k = 0
  v[0] = 0
  zz[0] = -Infinity
  zz[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= zz[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    zz[k] = s
    zz[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (zz[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

/**
 * Samples the authored terrain on a `step` grid over the plate plus `margin`, marks every non-sea
 * cell solid, and returns an exact Euclidean distance-to-solid field (bilinear between cells).
 */
export function buildCoastField(layout: BiomeLayout, step = 5, margin = 70): CoastField {
  const primed = primedCoast.get(layout)?.get(`${step}:${margin}`)
  if (primed) return coastFieldFromGrid(layout, step, margin, primed)
  const half = layout.worldExtent + margin
  const n = Math.floor((2 * half) / step) + 1
  const grid = new Float64Array(n * n)
  for (let j = 0; j < n; j++) {
    const z = -half + j * step
    for (let i = 0; i < n; i++) {
      const x = -half + i * step
      const inPlate = Math.abs(x) <= layout.worldExtent && Math.abs(z) <= layout.worldExtent
      grid[j * n + i] = inPlate && sampleTerrain(layout, x, z).material !== 'sea' ? 0 : INF
    }
  }
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const zz = new Float64Array(n + 1)
  // Columns, then rows.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) f[j] = grid[j * n + i]
    edt1d(f, n, d, v, zz)
    for (let j = 0; j < n; j++) grid[j * n + i] = d[j]
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) f[i] = grid[j * n + i]
    edt1d(f, n, d, v, zz)
    for (let i = 0; i < n; i++) grid[j * n + i] = Math.sqrt(d[i]) * step
  }
  return coastFieldFromGrid(layout, step, margin, grid)
}

/* ---------- noise helpers ---------- */

/** Worley F1 / F2 in metres on a `cell` grid (same idea as the shelf plates, coarser). */
function cellular(x: number, z: number, cell: number): { f1: number; f2: number } {
  const px = x / cell
  const pz = z / cell
  const ix = Math.floor(px)
  const iz = Math.floor(pz)
  let f1 = Number.POSITIVE_INFINITY
  let f2 = Number.POSITIVE_INFINITY
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx
      const cz = iz + dz
      const fx = cx + 0.08 + 0.84 * hash2(cx * 3.7 + 11.1, cz * 7.9)
      const fz = cz + 0.08 + 0.84 * hash2(cx * 5.3, cz * 2.1 + 4.4)
      const d = Math.hypot(fx - px, fz - pz) * cell
      if (d < f1) {
        f2 = f1
        f1 = d
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  return { f1, f2 }
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

/** Polynomial smooth maximum: fills the V where two distance fields cross by up to r / 4. */
function smoothMax(a: number, b: number, r: number): number {
  if (r <= 1e-6) return Math.max(a, b)
  const h = Math.max(r - Math.abs(a - b), 0) / r
  return Math.max(a, b) + h * h * r * 0.25
}

function cone(h: number, r: number, d: number, sharp: number): number {
  const k = Math.max(0, 1 - d / r)
  return h * Math.pow(k, sharp)
}

/* ---------- outer mountain rows ---------- */

export interface OuterPeak {
  x: number
  z: number
  height: number
  radius: number
  /** 4, 5, 6 behind the authored range; 7 is the ghost row at the horizon. */
  row: 4 | 5 | 6 | 7
  sharp: number
  shoulders: Array<{ dx: number; dz: number; radius: number; height: number }>
}

interface OuterRowSpec {
  row: 4 | 5 | 6 | 7
  z: number
  /** Gentle forward curve z = z0 + curve·x²; flatter than the authored arc so the ends stay back. */
  curve: number
  count: number
  spacing: number
  height: [number, number]
  radius: [number, number]
}

/**
 * Row 4 stands far enough back that every foot (radius) clears the 60 m of open water off the
 * plate's sea corners; each row after it is farther, taller, and apparently smaller.
 */
const OUTER_ROWS: OuterRowSpec[] = [
  { row: 4, z: -296, curve: 0.0002, count: 11, spacing: 44, height: [50, 72], radius: [36, 44] },
  { row: 5, z: -425, curve: 0.0002, count: 13, spacing: 62, height: [72, 100], radius: [50, 64] },
  { row: 6, z: -600, curve: 0.0001, count: 13, spacing: 88, height: [100, 135], radius: [70, 90] },
  { row: 7, z: -1100, curve: 0.00004, count: 11, spacing: 250, height: [170, 230], radius: [170, 230] },
]

function buildOuterRows(seed: number, dropRows: readonly number[]): OuterPeak[] {
  const out: OuterPeak[] = []
  for (const spec of OUTER_ROWS) {
    if (dropRows.includes(spec.row)) continue
    const rng = seeded(seed * 13 + spec.row * 101 + 5)
    for (let i = 0; i < spec.count; i++) {
      const x = (i - (spec.count - 1) / 2) * spec.spacing + (rng() - 0.5) * spec.spacing * 0.5
      const z = spec.z + spec.curve * x * x + (rng() - 0.5) * spec.spacing * 0.3
      const hero = (i + spec.row) % 3 === 1
      const height = spec.height[0] + (hero ? 0.75 + rng() * 0.25 : rng() * 0.6) * (spec.height[1] - spec.height[0])
      const radius = spec.radius[0] + rng() * (spec.radius[1] - spec.radius[0])
      const sharp = hero ? 1.4 + rng() * 0.3 : 1.15 + rng() * 0.3
      const n = 3 + (rng() < 0.5 ? 1 : 0)
      const shoulders: OuterPeak['shoulders'] = []
      for (let s = 0; s < n; s++) {
        const a = (s / n) * Math.PI * 2 + rng() * 1.2
        const d = radius * (0.55 + rng() * 0.35)
        shoulders.push({ dx: Math.cos(a) * d, dz: Math.sin(a) * d, radius: radius * (0.4 + rng() * 0.25), height: height * (0.4 + rng() * 0.25) })
      }
      out.push({ x, z, height, radius, row: spec.row, sharp, shoulders })
    }
  }
  return out
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
      // Coarser than the authored range: these are read from 200 m and up, on 10–80 m cells.
      jag = 1 + fbm(x * 0.03 + 2.2, z * 0.03, 2) * 0.4
      const ridged = 1 - Math.abs(fbm(x * 0.018 + 1.1, z * 0.018 + 7.3, 3)) * 2.2
      crease = 0.76 + 0.28 * Math.max(0, ridged)
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

/* ---------- far ice islands (hero far shapes) ---------- */

interface Dome {
  x: number
  z: number
  radius: number
  height: number
}

function buildDomes(seed: number): Dome[] {
  const rng = seeded(seed * 29 + 3)
  const out: Dome[] = []
  // Three tabular ice islands in the sea half (south-east, south, west), 700–1400 m out.
  for (const [a0, a1] of [
    [0.1, 0.5],
    [0.7, 1.1],
    [1.55, 1.95],
  ]) {
    const a = (a0 + rng() * (a1 - a0)) * Math.PI
    const d = 700 + rng() * 700
    out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, radius: 140 + rng() * 120, height: 18 + rng() * 22 })
  }
  return out
}

/* ---------- the world ---------- */

export type OuterMaterial = 'sea' | 'ice' | 'snow' | 'rock' | 'mountain'

export interface OuterSample {
  height: number
  material: OuterMaterial
  /** On a mountain cone: this point's height as a fraction of the dominant peak (snow caps). */
  peakFrac: number
  /** Row of the dominant peak, 0 off the rows. */
  row: number
  /** 0–1 toward the sky colour: the baked aerial perspective. */
  haze: number
}

/** A capsule (segment a→b with a radius) inside which our land and rows give way to flat pack ice. */
export interface Clearing {
  ax: number
  az: number
  bx: number
  bz: number
  radius: number
}

export interface OuterWorldOptions {
  /**
   * The authored range's profile (`mountainProfile(max(0.62, courseProgress))`), so the seam is
   * sampled with the same rows the plate was built with; the back rows' skirts cross the plate
   * edge, so a different band is a step at the seam. Defaults to band 2.
   */
  mountainProfile?: MountainProfile
  /** Metres to push the northern mass's shore north of its default (−150 at x = 0). */
  northShoreShift?: number
  /** Mountain rows to leave out (e.g. 4 when another technique's ring stands there). */
  dropRows?: readonly number[]
  /** Flat pack-ice clearings for other techniques' landmarks. */
  clearings?: readonly Clearing[]
}

export interface OuterWorld {
  layout: BiomeLayout
  seed: number
  plateHalf: number
  seaLevel: number
  /** Authored open-sea floor height; everything of ours inside the plate stays below it. */
  seaFloor: number
  rings: RingSpec[]
  coast: CoastField
  peaks: OuterPeak[]
  options: OuterWorldOptions
  /** Our heightfield; inside the plate it is a hidden floor under the authored sea bed. */
  sample(x: number, z: number): OuterSample
  /** The authored height on the plate edge (band-2 range, the lab's floor), for a watertight seam. */
  seamHeight(x: number, z: number): number
  /** Unified land field (authored continuation ∪ the northern mass), metres, positive inside. */
  landField(x: number, z: number): number
  /** Haze for a bare distance (used by the far detail instances). */
  hazeAt(x: number, z: number): number
}

const CONTINUATION_REACH = 420

/**
 * Behind the range the authored capes carry on north as our snowfield: this many metres of land
 * field past the authored coast stay land before the shelf's own rules (the 60 m of open water
 * off every authored coast) apply. Gated to the back of the plate so the sea corners stay open.
 * 90 m bridges the notch between the two capes, whose shores sit only 10–25 m past the plate edge.
 */
export const CONTINUATION_MARGIN = 90

/**
 * The region behind the range where the capes carry on: from the plate's back edge to 320 m
 * north, 140 m either side of centre (the range spans ±105, the capes' shoulders cross the plate
 * edge at ±135), as a land-field value. On the seam line it equals the authored land field, so
 * our field is the plate's there; past it it grows 4 m per metre from that value, faster than the
 * capes' notch falls away (~1.2 per metre), so the land never dips before the continuation holds
 * it. The side gates are distance fields with gradient ≤ 1, so the ramp width alone decides the
 * slope there.
 */
export function continuationZone(layout: BiomeLayout, x: number, z: number, plateHalf = layout.worldExtent): number {
  const seamLand = Math.max(0, landField(layout, x, -plateHalf))
  return Math.min(140 - Math.abs(x), seamLand + 4 * (-z - plateHalf), 320 + z)
}

/** The northern mainland the back capes run into; pushed back in the corners so the plate's sea corners stay open. */
function northMass(x: number, z: number, shift: number): number {
  const corner = smoothstep(90, 200, Math.abs(x)) * 85
  const shore = -150 - shift - corner + fbm(x * 0.006 + 11.3, 2.2, 3) * 40 + fbm(x * 0.02 + 5.1, 9.9, 2) * 12
  return shore - z
}

/** 0 outside every clearing, 1 well inside one (soft 40 % rim). */
function clearingMask(clearings: readonly Clearing[], x: number, z: number): number {
  let mask = 0
  for (const c of clearings) {
    const dx = c.bx - c.ax
    const dz = c.bz - c.az
    const len2 = dx * dx + dz * dz || 1
    const t = Math.min(1, Math.max(0, ((x - c.ax) * dx + (z - c.az) * dz) / len2))
    const d = Math.hypot(c.ax + dx * t - x, c.az + dz * t - z)
    mask = Math.max(mask, 1 - smoothstep(c.radius * 0.6, c.radius, d))
  }
  return mask
}

function groundHaze(x: number, z: number): number {
  const d = Math.max(0, Math.hypot(x, z) - 180)
  return 0.1 + 0.78 * smoothstep(0, 1400, d)
}

/** Continues the authored ROW_HAZE (0, 0, 0.22, 0.42) so the first outer row matches the authored back row. */
const ROW_HAZE: Record<number, number> = { 4: 0.44, 5: 0.56, 6: 0.7, 7: 0.85 }
/** The plate's per-row haze (`scene/Terrain.tsx` ROW_HAZE), for the authored rows' skirts beyond the seam. */
const AUTHORED_ROW_HAZE = [0, 0, 0.22, 0.42]

const worldCache = new WeakMap<BiomeLayout, Map<string, OuterWorld>>()
/** The lab's floor: BiomeScene builds the plate with `mountainProfile(max(0.62, fraction))`. */
const DEFAULT_PROFILE = mountainProfile(0.62)

/**
 * The outer world for a layout, seed and options. Worlds are immutable, so equal inputs return the
 * same instance: the combination's two scenes (shelf and barriers) read one heightfield and pay
 * for one build.
 */
/** The cache key of an outer world: its seed and what of the options shapes it (the profile only by band). */
export function outerWorldKey(seed: number, options: OuterWorldOptions = {}): string {
  return `${seed}:${JSON.stringify({ b: options.mountainProfile?.band ?? DEFAULT_PROFILE.band, s: options.northShoreShift ?? 0, d: options.dropRows ?? [], c: options.clearings ?? [] })}`
}

export function createOuterWorld(layout: BiomeLayout, seed: number, options: OuterWorldOptions = {}): OuterWorld {
  const key = outerWorldKey(seed, options)
  let perLayout = worldCache.get(layout)
  if (!perLayout) {
    perLayout = new Map()
    worldCache.set(layout, perLayout)
  }
  const cached = perLayout.get(key)
  if (cached) return cached
  const world = buildOuterWorld(layout, seed, options)
  perLayout.set(key, world)
  return world
}

function buildOuterWorld(layout: BiomeLayout, seed: number, options: OuterWorldOptions): OuterWorld {
  const plateHalf = layout.worldExtent
  const seaLevel = layout.seaLevel
  const seaFloor = Math.min(sampleTerrain(layout, 0, plateHalf - 4).height, seaLevel - 0.5)
  const rings = ringSpecs(plateHalf)
  const coast = buildCoastField(layout)
  const shift = options.northShoreShift ?? 0
  const clearings = options.clearings ?? []
  const peaks = buildOuterRows(seed, options.dropRows ?? [])
  const domes = buildDomes(seed)
  const profile = options.mountainProfile ?? DEFAULT_PROFILE
  const authoredPeaks = mountainPeaks(layout, profile)

  const unifiedLand = (x: number, z: number): number => {
    const cheb = chebyshev(x, z)
    const authored = cheb < CONTINUATION_REACH ? landField(layout, x, z) : -1e9
    // Inside a clearing the northern mass withdraws; the authored continuation always stands.
    const north = northMass(x, z, shift) - 400 * clearingMask(clearings, x, z)
    // The northern mass keeps 60 m of open water off every authored coast, except behind the
    // range, where the capes carry straight on into it. Every term is a distance field, so the
    // joined shore has no steps (a step here was the "blue rim" seen from behind the range).
    const limit = Math.max(coast.distance(x, z) - 64, Math.min(authored + CONTINUATION_MARGIN, continuationZone(layout, x, z, plateHalf)))
    // A smooth max: where the capes fall away and the northern mass rises, a hard max leaves a
    // V in the field that the wide back ramp would dig into a swale. Hard at the seam itself, so
    // the first row of our vertices still equals the authored field exactly.
    return smoothMax(authored, Math.min(north, limit), 60 * smoothstep(0, 40, cheb - plateHalf))
  }

  const hazeAt = (x: number, z: number) => groundHaze(x, z)

  const sample = (x: number, z: number): OuterSample => {
    const cheb = chebyshev(x, z)
    if (cheb < plateHalf) return { height: seaFloor - 0.6, material: 'sea', peakFrac: 0, row: 0, haze: 0 }
    const haze = groundHaze(x, z)
    const land = unifiedLand(x, z)

    if (land > -2.5) {
      // Coasts: the authored rule (a 1.6 m cliff on the open coasts, a 26 m snow ramp behind the
      // range) where the authored land continues; our own shores ramp over at least 14 m so a cell
      // never reads as a wall.
      const authoredNear = cheb < CONTINUATION_REACH ? landField(layout, x, z) : -1e9
      const rampWidth = Math.max(coastRampWidth(layout, x, z), lerp(14, 1.6, smoothstep(-40, -10, authoredNear)))
      const cliffK = smoothstep(0, rampWidth, land)
      const relief = layout.relief * 1.4 * fbm(x * 0.05, z * 0.05)
      // The foothill belt eases down behind the range exactly as the authored terrain does.
      const fade = backFade(layout, x, z)
      const foot = foothill(layout, x, z)
      const belt = easedBeltHeight(foot, fade)
      const cleared = clearingMask(clearings, x, z)
      // The north climbs gently toward a far ice cap, and carries the outer rows.
      const rise = smoothstep(-240, -900, z) * (8 + 16 * fbm(x * 0.003 + 4.4, z * 0.003 + 1.7, 3)) * (1 - cleared)
      const cap = smoothstep(-1100, -2100, z) * 70
      const rows = rowsHeight(peaks, x, z)
      const rowHeight = rows.height * (1 - cleared)
      let ground = layout.groundHeight + relief + belt + rise + cap
      // Rock knuckles use the authored threshold at the seam (so the colours meet) but are gone
      // 25 m out: on 5–80 m cells every knuckle becomes a whole lavender tile.
      const rockThreshold = lerp(0.25, 1.2, smoothstep(3, 25, cheb - plateHalf))
      let material: OuterMaterial = foot.rock * (1 - fade) * (1 - fade) > rockThreshold ? 'rock' : 'snow'
      let peakFrac = 0
      let row = 0
      // The authored back rows' north skirts cross the plate edge (bands 3–4): carry the same
      // cones on past the seam exactly as the plate computes them.
      if (foot.k > 0.05 && cheb < CONTINUATION_REACH) {
        const m = mountainHeight(authoredPeaks, x, z)
        if (m.height > 0.2) {
          ground += m.height * Math.min(1, foot.k * 1.6)
          if (m.height > 3) {
            material = 'mountain'
            peakFrac = m.peakFrac
            row = m.row
          }
        }
      }
      if (rowHeight > 0.2) {
        ground += rowHeight
        if (rowHeight > 3) {
          material = 'mountain'
          peakFrac = rows.peakFrac
          row = rows.row
        }
      }
      const height = seaFloor + (ground - seaFloor) * cliffK
      if (cliffK < 0.5) return { height, material: height < seaLevel + 0.05 ? 'sea' : 'snow', peakFrac: 0, row: 0, haze }
      // Our rows haze in with their peaks; the authored rows' skirts carried past the seam take
      // the plate's own per-row haze so the colours meet.
      const rowHaze = row >= 4 ? lerp(haze, Math.max(haze, ROW_HAZE[row]), smoothstep(0.05, 0.4, peakFrac)) : row > 0 ? Math.max(haze, AUTHORED_ROW_HAZE[row]) : haze
      return { height, material, peakFrac, row, haze: rowHaze }
    }

    // Open water, then pack ice: a moat beyond the plate edge and 60 m off every authored coast.
    const cd = coast.distance(x, z)
    const offshore = cd - 64 - 20 * (0.5 + fbm(x * 0.02 + 3.3, z * 0.02 + 1.1, 2))
    const moat = cheb - plateHalf - 16 - 30 * (0.5 + fbm(x * 0.011 + 7.7, z * 0.011 + 4.4, 3))
    const pack = Math.min(offshore, moat)
    let dome = 0
    for (const d of domes) {
      const dist = Math.hypot(x - d.x, z - d.z) * (1 + fbm(x * 0.01 + 3, z * 0.01, 2) * 0.5)
      dome = Math.max(dome, d.height * Math.pow(Math.max(0, 1 - dist / d.radius), 0.6))
    }
    if (pack < -12 && dome <= 0) return { height: seaLevel - 1.0, material: 'sea', peakFrac: 0, row: 0, haze }

    const edgeK = smoothstep(-6, 8, pack)
    const deep = smoothstep(0, 80, pack)
    // Features grow with (Euclidean) distance, and never fall below ~2 cells of the lattice they
    // will be sampled on, with the lattice steps eased over 60 m so no ring boundary shows as a
    // change of texture or a lead that stops dead.
    const d = Math.hypot(x, z)
    const scale = 1 + 4 * smoothstep(250, 2000, d)
    const cellHere = latticeCellAt(cheb)
    const minFeature = 2.2 * cellHere
    const warp = fbm(z * 0.004 + 1.7, x * 0.004 + 9.2, 2) * 40
    const plateCell = Math.max(60 * scale, 3 * cellHere)
    const { f1, f2 } = cellular(x + warp, z - warp, plateCell)
    // Broken floes at the pack edge: 60 m plates with 14 m of water between, closing up inside.
    const seamW = Math.max(14 * scale, minFeature)
    const plates = (1 - smoothstep(seamW, seamW + 4 * scale, f2 - f1)) * (1 - 0.92 * deep)
    // Lead systems inside the pack: the edges of much larger cells, 10–16 m wide (or two cells),
    // and only in some regions so the pack reads as one shelf.
    const leads = cellular(x - warp * 0.5 + 777, z + warp * 0.5 - 333, Math.max(180 * scale, 3 * plateCell))
    const leadW = Math.max(10 * scale, minFeature)
    const leadCore = 1 - smoothstep(leadW, leadW * 1.6, leads.f2 - leads.f1)
    const leadMask = smoothstep(0.02, 0.14, fbm(x * 0.004 + 13, z * 0.004 + 17, 2))
    const lead = leadCore * deep * leadMask
    const sheet = smoothstep(600, 1400, d)
    const open = Math.max(plates, lead) * (1 - 0.85 * sheet)
    const ridge = Math.max(0, fbm(x * 0.05 + 1, z * 0.05, 2) - 0.17) * 7
    const top =
      seaLevel +
      0.85 +
      0.5 * fbm(x * 0.02, z * 0.02, 2) +
      ridge +
      sheet * (2.5 + 5 * fbm(x * 0.0025, z * 0.0025, 3) + 3 * (0.5 + fbm(x * 0.008 + 2, z * 0.008 + 6, 2)))
    // Open water near the plate drops under the water disc; far leads sit just above it so they
    // are our own hazed faces (the disc has no aerial perspective and streaks the horizon).
    const floor = lerp(seaLevel - 1.0, seaLevel + 0.08, smoothstep(FAR_LEAD_START, FAR_LEAD_END, d))
    let height = lerp(floor, top, edgeK * (1 - open))
    if (dome > 0) height = Math.max(height, seaLevel + dome)
    const material: OuterMaterial = dome > 0 ? (dome > 2 ? 'snow' : 'ice') : open > 0.6 ? 'sea' : height > seaLevel + 0.05 ? (sheet > 0.6 ? 'snow' : 'ice') : 'sea'
    return { height, material, peakFrac: 0, row: 0, haze }
  }

  const seamHeight = (x: number, z: number) => sampleTerrain(layout, x, z, profile, authoredPeaks).height

  return { layout, seed, plateHalf, seaLevel, seaFloor, rings, coast, peaks, options, sample, seamHeight, landField: unifiedLand, hazeAt }
}

/* ---------- sky ---------- */

/**
 * Day: the sky is pale, so sky-tinted far ice dissolves by 1.7 km. Night: the sky is dark but lit
 * snow is not, so the fog must do the work earlier or the far pack sits as a lighter plateau
 * above the black water (seen in the lab's south-out night capture at 1.5 km). Storm stays dense.
 */
/** Only the far plane moves: `fogNear` stays the product's 220 so the town's own haze is untouched. */
export const ENDLESS_FOG_FAR = { day: 1700, night: 1250 } as const

/**
 * Aerial perspective: the far plane is pushed out so the outer rings dissolve into the sky by
 * distance rather than ending at a fog wall. The near plane and the storm (the catastrophe's own
 * weather, tuned in `scene/`) are left exactly as the base grade has them.
 */
export function endlessFog(grade: SkyGrade, context: { night: boolean; storm: boolean }): SkyGrade {
  if (context.storm) return grade
  return { ...grade, fogFar: context.night ? ENDLESS_FOG_FAR.night : ENDLESS_FOG_FAR.day }
}

/* ---------- far detail placements ---------- */

export interface FloeInstance {
  x: number
  z: number
  r: number
  yaw: number
}

/** Drift ice on the open water of the moat and the broken pack edge. */
export function driftFloes(world: OuterWorld, count = 240): FloeInstance[] {
  const rng = seeded(world.seed * 17 + 23)
  const out: FloeInstance[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 14) {
    const a = rng() * Math.PI * 2
    const d = world.plateHalf + 4 + Math.pow(rng(), 1.6) * 520
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (chebyshev(x, z) <= world.plateHalf + 2) continue
    if (world.coast.distance(x, z) < 60) continue
    const s = world.sample(x, z)
    if (s.height >= world.seaLevel - 0.3) continue
    if (world.landField(x, z) > -12) continue
    const r = 1.6 + rng() * rng() * 4.4
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < r + o.r + 3)) continue
    out.push({ x, z, r, yaw: rng() * Math.PI })
  }
  return out
}

export interface BergInstance {
  x: number
  z: number
  yaw: number
  length: number
  width: number
  height: number
  hero: boolean
}

/** Tabular icebergs frozen into the pack 300–1300 m out; two or three heroes among them. */
export function tabularBergs(world: OuterWorld): BergInstance[] {
  const rng = seeded(world.seed * 41 + 7)
  const out: BergInstance[] = []
  let guard = 0
  const want = 14
  while (out.length < want && guard++ < 600) {
    const hero = out.length < 3
    const a = rng() * Math.PI * 2
    const d = hero ? 650 + rng() * 400 : 320 + rng() * 980
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (chebyshev(x, z) <= world.plateHalf + 40) continue
    if (world.landField(x, z) > -40) continue
    const s = world.sample(x, z)
    if (s.material === 'sea' && s.height < world.seaLevel - 0.5 && d > 500) continue
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 110)) continue
    const length = hero ? 40 + rng() * 16 : 16 + rng() * 14
    out.push({ x, z, yaw: rng() * Math.PI * 2, length, width: length * (0.55 + rng() * 0.3), height: hero ? 8 + rng() * 3 : 3.5 + rng() * 3, hero })
  }
  return out
}

export interface HummockInstance {
  x: number
  y: number
  z: number
  yaw: number
  w: number
  h: number
}

/** Pressure-ridge hummocks scattered on the pack, densest in the near field, so it reads chunky up close and at mid range. */
export function packHummocks(world: OuterWorld, count = 420): HummockInstance[] {
  const rng = seeded(world.seed * 53 + 11)
  const out: HummockInstance[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 10) {
    const a = rng() * Math.PI * 2
    const d = world.plateHalf + 20 + Math.pow(rng(), 1.5) * 820
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (chebyshev(x, z) <= world.plateHalf + 2) continue
    const s = world.sample(x, z)
    if (s.material !== 'ice' || s.height < world.seaLevel + 0.4) continue
    const far = smoothstep(200, 900, d)
    const w = (2.2 + rng() * 4) * (1 + far * 2.2)
    out.push({ x, y: s.height - 0.15, z, yaw: rng() * Math.PI, w, h: (0.7 + rng() * 1.5) * (1 + far * 1.4) })
  }
  return out
}

export interface DuneInstance {
  x: number
  y: number
  z: number
  yaw: number
  length: number
  width: number
  height: number
}

/** Prevailing wind for the snow dunes (sastrugi), degrees from +z toward +x: out of the north-west. */
export const DUNE_WIND_DEG = 150

/**
 * Sastrugi: wind-carved snow ridges on the near pack and the snowfield behind the range, aligned
 * with the prevailing wind with a little scatter. They break the flat facets the camera stands
 * next to without adding another heightfield.
 */
export function snowDunes(world: OuterWorld, count = 460): DuneInstance[] {
  const rng = seeded(world.seed * 61 + 19)
  const out: DuneInstance[] = []
  const wind = (DUNE_WIND_DEG * Math.PI) / 180
  let guard = 0
  while (out.length < count && guard++ < count * 10) {
    const a = rng() * Math.PI * 2
    const d = world.plateHalf + 6 + Math.pow(rng(), 1.3) * 300
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (chebyshev(x, z) <= world.plateHalf + 2) continue
    const s = world.sample(x, z)
    if ((s.material !== 'ice' && s.material !== 'snow') || s.height < world.seaLevel + 0.3) continue
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 6)) continue
    const length = 6 + rng() * 10
    out.push({ x, y: s.height - 0.05, z, yaw: wind + (rng() - 0.5) * 0.5, length, width: 0.9 + rng() * 0.9, height: 0.22 + rng() * 0.3 })
  }
  return out
}
