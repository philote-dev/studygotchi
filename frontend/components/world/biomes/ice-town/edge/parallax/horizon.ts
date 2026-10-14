/**
 * Painted horizon (edge technique `parallax`): pure data and builders, no three.js.
 *
 * The beyond is four concentric silhouette rings at increasing radius, each one merged strip of
 * vertical cards with a seeded low-poly profile along its top edge, under a sky-gradient dome.
 * Rings are real geometry so trucking the camera slides the near ring against the far ones; each
 * ring's colour sits further toward the sky colour (atmospheric perspective, applied per fragment
 * from the true camera distance so the rings also clear when the free camera drives up to them).
 *
 * Azimuths follow the land's convention: measured from +z (south, the harbour) toward +x (east),
 * so north is π. Lengths are metres.
 */
import { seeded } from '../../layout/biome-layout'
import type { SkyGrade } from '../../scene/sky-blend'

export const TAU = Math.PI * 2

/** Camera far plane (CameraRig) and the Water disc radius (scene/Terrain); the rings live between. */
export const CAMERA_FAR = 3000
export const WATER_RADIUS = 2400
/** Free-camera box corner is ≈ 650 m out; nothing of ours may come nearer than this. */
export const MIN_RING_RADIUS = 660
/** Sky dome radius: behind the last ring, under the water's rim, never clipped from the box corner. */
export const DOME_RADIUS = 2300
/** Dome tessellation (width, height); colour is per fragment so it can stay coarse. */
export const DOME_SEGMENTS: readonly [number, number] = [48, 16]
/** Ring strips start this far under the waterline so the sea always cuts them cleanly. */
export const BASE_DEPTH = 8
/** Day and night zenith colours (the haze at the horizon is the scene's fog / background). */
export const ZENITH = { day: '#b7c7df', night: '#0d1134' } as const
/** Height over which the sky climbs from the horizon haze to the zenith colour. */
export const SKY_GLOW_HEIGHT = 120
/** Night air is clearer: the distance haze is scaled by this after dark so moonlit ranges still read. */
export const NIGHT_HAZE = 0.8

export type FormKind = 'peak' | 'dome' | 'tabular' | 'shelf' | 'spire'
/** Which palette a silhouette column takes. */
export type SurfaceKind = 'rock' | 'ice' | 'city'

export interface RingPalette {
  foot: string
  body: string
  cap: string
  ice: string
  iceCap: string
  city: string
}

export interface RingSpec {
  id: 'skerries' | 'coast' | 'ranges' | 'great-range'
  name: string
  radius: number
  segments: number
  /** Fraction mixed toward the sky haze at the design distance (the ring's own radius). */
  haze: number
  /** Metres above the waterline over which the foot dissolves into the sea's fog. */
  baseFade: number
  /** Height of the dark foot band. */
  foot: number
  maxHeight: number
  /** Fraction of the circle that is land. */
  coverage: number
  /** Arc of one massif, radians. */
  massif: [number, number]
  peak: { halfWidth: [number, number]; height: [number, number]; sharp: [number, number]; kinds: FormKind[] }
  /** Fraction of maxHeight above which the top row takes the cap colour. */
  snowLine: number
  day: RingPalette
  night: RingPalette
  /** Distant-location tease: a frozen city skyline with an observatory beside it. */
  city?: { azimuth: number; arc: number; height: number }
  /** A long low ice shelf (continuing the authored glacier) with pressure ridges. */
  shelf?: { azimuth: number; arc: number; height: number }
  /** A beacon island: a low tabular island with one spire. */
  beacon?: { azimuth: number; height: number; spire: number }
}

const deg = (d: number) => (d * Math.PI) / 180

export const RINGS: readonly RingSpec[] = [
  {
    id: 'skerries',
    name: 'Skerries and icebergs',
    radius: 700,
    segments: 1080,
    haze: 0.5,
    baseFade: 10,
    foot: 5,
    maxHeight: 30,
    coverage: 0.46,
    massif: [0.12, 0.3],
    peak: { halfWidth: [10, 32], height: [0.25, 0.75], sharp: [0.9, 1.6], kinds: ['tabular', 'peak', 'tabular', 'peak', 'dome'] },
    snowLine: 0.42,
    day: { foot: '#55688a', body: '#6c7d9b', cap: '#eef4f7', ice: '#b9cfdd', iceCap: '#f3f7fa', city: '#6a7490' },
    night: { foot: '#121630', body: '#2b3254', cap: '#7f8bad', ice: '#4a5680', iceCap: '#97a4c4', city: '#3a3a5c' },
    shelf: { azimuth: deg(270), arc: 0.9, height: 9 },
    beacon: { azimuth: deg(4), height: 6, spire: 18 },
  },
  {
    id: 'coast',
    name: 'Far coast and frozen city',
    radius: 1050,
    segments: 1080,
    haze: 0.6,
    baseFade: 16,
    foot: 8,
    maxHeight: 52,
    coverage: 0.6,
    massif: [0.35, 0.8],
    peak: { halfWidth: [55, 110], height: [0.35, 0.8], sharp: [0.8, 1.3], kinds: ['peak', 'peak', 'dome'] },
    snowLine: 0.6,
    day: { foot: '#64768f', body: '#7d8ba8', cap: '#e4ecf3', ice: '#c0d3df', iceCap: '#f0f5f8', city: '#6e7893' },
    night: { foot: '#171c38', body: '#3c4468', cap: '#8591b2', ice: '#4a5680', iceCap: '#97a4c4', city: '#574c5e' },
    // Across the strait beyond the research island (bearing ≈ 49°), where the town looks out over open sea.
    city: { azimuth: deg(55), arc: 0.16, height: 52 },
  },
  {
    id: 'ranges',
    name: 'Ranges',
    radius: 1500,
    segments: 720,
    haze: 0.72,
    baseFade: 26,
    foot: 12,
    maxHeight: 80,
    coverage: 0.7,
    massif: [0.5, 1.1],
    peak: { halfWidth: [90, 170], height: [0.45, 0.85], sharp: [1.0, 1.7], kinds: ['peak'] },
    snowLine: 0.55,
    day: { foot: '#7684a3', body: '#8b97b6', cap: '#dde6ef', ice: '#c4d5e1', iceCap: '#eef4f8', city: '#7d87a0' },
    night: { foot: '#1d2240', body: '#4c567e', cap: '#8f9abb', ice: '#4e5a80', iceCap: '#9aa6c6', city: '#4a4a6a' },
  },
  {
    id: 'great-range',
    name: 'Great range',
    radius: 2100,
    segments: 720,
    haze: 0.82,
    baseFade: 40,
    foot: 16,
    maxHeight: 105,
    coverage: 0.84,
    massif: [0.7, 1.4],
    peak: { halfWidth: [120, 220], height: [0.5, 0.9], sharp: [1.1, 1.8], kinds: ['peak'] },
    snowLine: 0.5,
    day: { foot: '#8a96b4', body: '#9aa5c2', cap: '#dbe4ee', ice: '#c8d8e3', iceCap: '#eef4f8', city: '#8f98b0' },
    night: { foot: '#222848', body: '#5a6490', cap: '#9ca7c6', ice: '#586490', iceCap: '#a0accc', city: '#505070' },
  },
]

/** Contrast against the sky left after the ring's design haze; strictly decreasing with distance. */
export function ringContrast(index: number): number {
  return 1 - RINGS[index].haze
}

/**
 * Exponential haze length so the ring reaches its design haze at its own radius:
 * haze(d) = 1 − e^(−d/λ). Near the camera the ring clears; far across the land it hazes more.
 */
export function hazeLambda(radius: number, haze: number): number {
  return -radius / Math.log(1 - haze)
}

export function hazeAt(distance: number, lambda: number): number {
  return 1 - Math.exp(-distance / lambda)
}

/** The ring's radius at an azimuth: a gentle seeded wobble so the waterline is never a compass circle. */
export function ringRadius(spec: RingSpec, index: number, azimuth: number): number {
  const phase = index * 1.7 + 0.4
  return spec.radius * (1 + 0.012 * Math.sin(3 * azimuth + phase) + 0.008 * Math.sin(7 * azimuth - 2 * phase))
}

/** Angle a far silhouette subtends from a camera: top elevation minus base elevation, degrees. */
export function apparentHeightDeg(cameraY: number, horizontal: number, baseY: number, topY: number): number {
  const top = Math.atan2(topY - cameraY, horizontal)
  const base = Math.atan2(baseY - cameraY, horizontal)
  return ((top - base) * 180) / Math.PI
}

/** sRGB hex → linear RGB, the same transfer three.Color applies to hex strings. */
export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  const channel = (c: number) => {
    const s = c / 255
    return s < 0.04045 ? s * 0.0773993808 : Math.pow(s * 0.9478672986 + 0.0521327014, 2.4)
  }
  return [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)]
}

/* ---------- silhouette ---------- */

interface Form {
  kind: FormKind
  azimuth: number
  /** Half base width, radians. */
  halfWidth: number
  height: number
  sharp: number
}

function wrap(a: number): number {
  return a - TAU * Math.round(a / TAU)
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

function formHeight(form: Form, azimuth: number): number {
  const u = Math.abs(wrap(azimuth - form.azimuth)) / form.halfWidth
  if (u >= 1) return 0
  switch (form.kind) {
    case 'peak':
      return form.height * Math.pow(1 - u, form.sharp)
    case 'dome':
      return form.height * Math.sqrt(1 - u * u)
    case 'tabular':
    case 'shelf':
      return form.height * Math.min(1, (1 - u) / 0.25)
    case 'spire':
      return form.height * Math.min(1, (1 - u) / 0.3)
  }
}

function surfaceOf(kind: FormKind): SurfaceKind {
  return kind === 'tabular' || kind === 'shelf' ? 'ice' : kind === 'spire' ? 'city' : 'rock'
}

function ringForms(seed: number, spec: RingSpec, index: number): Form[] {
  const rng = seeded(seed * 1013 + index * 7919 + 29)
  const forms: Form[] = []
  const R = spec.radius
  const massifMean = (spec.massif[0] + spec.massif[1]) / 2
  const gapMean = (massifMean * (1 - spec.coverage)) / spec.coverage
  const kinds = spec.peak.kinds

  let azimuth = rng() * TAU
  let used = 0
  let massifs = 0
  while (used < TAU - 0.02 && massifs < 64) {
    const arc = Math.min(TAU - used, lerp(spec.massif[0], spec.massif[1], rng()))
    massifs++
    const halfMean = ((spec.peak.halfWidth[0] + spec.peak.halfWidth[1]) / 2) / R
    const spacing = halfMean * 1.3
    const n = Math.max(1, Math.round(arc / spacing))
    const heroAt = Math.floor(n / 2)
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n
      const a = azimuth + t * arc + (rng() - 0.5) * spacing * 0.5
      const halfWidth = lerp(spec.peak.halfWidth[0], spec.peak.halfWidth[1], rng()) / R
      const kind = kinds[Math.floor(rng() * kinds.length)]
      const envelope = 0.45 + 0.55 * Math.pow(Math.sin(Math.PI * t), 0.7)
      const hero = i === heroAt
      const height = hero
        ? spec.maxHeight * (0.82 + 0.18 * rng())
        : Math.min(spec.maxHeight, spec.maxHeight * envelope * lerp(spec.peak.height[0], spec.peak.height[1], rng()))
      const sharp = lerp(spec.peak.sharp[0], spec.peak.sharp[1], rng()) + (hero ? 0.3 : 0)
      forms.push({ kind, azimuth: a, halfWidth, height, sharp })
      // Shoulders: one or two lower sub-peaks that jag the flank (the authored range does the same).
      if (kind === 'peak' || kind === 'dome') {
        const shoulders = 1 + (rng() < 0.5 ? 1 : 0)
        for (let s = 0; s < shoulders; s++) {
          const side = rng() < 0.5 ? -1 : 1
          forms.push({
            kind: 'peak',
            azimuth: a + side * halfWidth * (0.45 + 0.4 * rng()),
            halfWidth: halfWidth * (0.4 + 0.3 * rng()),
            height: height * (0.42 + 0.26 * rng()),
            sharp: 1.0 + rng() * 0.3,
          })
        }
      }
    }
    azimuth += arc
    used += arc
    const gap = Math.min(TAU - used, gapMean * lerp(0.6, 1.4, rng()))
    azimuth += gap
    used += gap
  }

  if (spec.shelf) {
    const { azimuth: c, arc, height } = spec.shelf
    forms.push({ kind: 'shelf', azimuth: c, halfWidth: arc / 2, height, sharp: 1 })
    for (let i = 0; i < 4; i++) {
      forms.push({ kind: 'peak', azimuth: c + (rng() - 0.5) * arc * 0.8, halfWidth: 14 / R + (rng() * 10) / R, height: height * (1.4 + rng() * 0.6), sharp: 1.2 })
    }
  }
  if (spec.beacon) {
    const { azimuth: c, height, spire } = spec.beacon
    forms.push({ kind: 'tabular', azimuth: c, halfWidth: 26 / R, height, sharp: 1 })
    forms.push({ kind: 'spire', azimuth: c, halfWidth: 6.5 / R, height: spire, sharp: 1 })
  }
  if (spec.city) {
    const { azimuth: c, arc, height } = spec.city
    // Low plinth of the city under the towers; a few wide blocks, more slim towers, one spire,
    // heights skewed low so the skyline is a jagged cluster rather than a mesa.
    forms.push({ kind: 'tabular', azimuth: c, halfWidth: arc / 2 + 0.02, height: height * 0.16, sharp: 1 })
    const towers = 16
    for (let i = 0; i < towers; i++) {
      const a = c + ((i + 0.5) / towers - 0.5) * arc + (rng() - 0.5) * (arc / towers) * 0.8
      const slim = rng() < 0.6
      const h = height * (0.22 + 0.7 * Math.pow(rng(), 1.8))
      forms.push({ kind: 'spire', azimuth: a, halfWidth: (slim ? 8 + rng() * 5 : 15 + rng() * 9) / R, height: h, sharp: 1 })
    }
    forms.push({ kind: 'spire', azimuth: c + arc * 0.08, halfWidth: 9 / R, height, sharp: 1 })
    forms.push({ kind: 'spire', azimuth: c - arc * 0.22, halfWidth: 11 / R, height: height * 0.78, sharp: 1 })
    // Observatory on its own hill just beside the city.
    const hill = c - arc / 2 - 0.1
    forms.push({ kind: 'peak', azimuth: hill, halfWidth: 0.07, height: height * 0.42, sharp: 0.6 })
    forms.push({ kind: 'dome', azimuth: hill, halfWidth: 0.026, height: height * 0.62, sharp: 1 })
  }
  return forms
}

export interface Profile {
  heights: Float32Array
  surfaces: SurfaceKind[]
}

/** Seeded silhouette: height per segment (metres above the waterline, 0 = open water) and its surface. */
export function ringSilhouette(seed: number, spec: RingSpec, index: number): Profile {
  const forms = ringForms(seed, spec, index)
  const n = spec.segments
  const heights = new Float32Array(n)
  const surfaces: SurfaceKind[] = new Array(n).fill('rock')
  for (let i = 0; i < n; i++) {
    const azimuth = (i / n) * TAU
    let best = 0
    let surface: SurfaceKind = 'rock'
    for (const form of forms) {
      const h = formHeight(form, azimuth)
      if (h > best) {
        best = h
        surface = surfaceOf(form.kind)
      }
    }
    heights[i] = Math.min(spec.maxHeight, best)
    surfaces[i] = surface
  }
  return { heights, surfaces }
}

export function ringProfile(seed: number, spec: RingSpec, index: number): Float32Array {
  return ringSilhouette(seed, spec, index).heights
}

/* ---------- mesh ---------- */

export interface RingMesh {
  rows: number
  position: Float32Array
  normal: Float32Array
  colorDay: Float32Array
  colorNight: Float32Array
  index: Uint16Array | Uint32Array
}

const ROWS = 4
/** Lit / half / shade steps baked into the flank colours (same language as the terrain's facets). */
const FACET: [number, number, number] = [1, 0.92, 0.84]
/** Sun azimuths (from +z toward +x) of the day key light (60, 90, 70) and the night light (−40, 60, 30). */
const SUN_AZIMUTH = { day: Math.atan2(60, 70), night: Math.atan2(-40, 30) }

function facetStep(slope: number, azimuth: number, sunAzimuth: number): number {
  // The flank on the sun's side of a peak is lit: the slope sign says which side this column is on.
  const lit = -Math.sign(slope) * Math.sin(wrap(sunAzimuth - azimuth))
  if (Math.abs(slope) < 0.06) return FACET[1]
  return lit > 0.25 ? FACET[0] : lit < -0.25 ? FACET[2] : FACET[1]
}

function paint(palette: RingPalette, surface: SurfaceKind, row: number, snowCap: boolean, step: number): [number, number, number] {
  let hex: string
  let k = step
  if (surface === 'city') {
    hex = row === 0 || row === 1 ? palette.foot : palette.city
  } else if (surface === 'ice') {
    hex = row <= 1 ? palette.foot : row === 2 ? palette.ice : palette.iceCap
    if (row === 3) k = 0.6 + 0.4 * step
  } else {
    hex = row <= 1 ? palette.foot : row === 2 || !snowCap ? palette.body : palette.cap
    if (row === 3 && snowCap) k = 0.55 + 0.45 * step
  }
  const [r, g, b] = hexToLinear(hex)
  return [r * k, g * k, b * k]
}

/**
 * One merged strip per ring: `segments` columns × 4 rows (under water, foot, body, top), closed
 * around the circle, front faces toward the axis. Colours are linear RGB, day and night pairs.
 */
export function buildRing(seed: number, spec: RingSpec, index: number): RingMesh {
  const { heights, surfaces } = ringSilhouette(seed, spec, index)
  const n = spec.segments
  const count = n * ROWS
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const colorDay = new Float32Array(count * 3)
  const colorNight = new Float32Array(count * 3)
  const indices = count > 65_535 ? new Uint32Array(n * (ROWS - 1) * 6) : new Uint16Array(n * (ROWS - 1) * 6)
  const segmentLength = (spec.radius * TAU) / n

  for (let i = 0; i < n; i++) {
    const azimuth = (i / n) * TAU
    const r = ringRadius(spec, index, azimuth)
    const sx = Math.sin(azimuth)
    const cz = Math.cos(azimuth)
    const h = heights[i]
    const water = h < 0.4
    const prev = heights[(i + n - 1) % n]
    const next = heights[(i + 1) % n]
    const slope = (next - prev) / (2 * segmentLength)
    const stepDay = facetStep(slope, azimuth, SUN_AZIMUTH.day)
    const stepNight = facetStep(slope, azimuth, SUN_AZIMUTH.night)
    const snowCap = h >= spec.snowLine * spec.maxHeight
    const ys = water
      ? [-BASE_DEPTH, -BASE_DEPTH, -BASE_DEPTH, -BASE_DEPTH]
      : [-BASE_DEPTH, Math.min(h, spec.foot), Math.max(Math.min(h, spec.foot), h * 0.62), h]
    for (let j = 0; j < ROWS; j++) {
      const v = (i * ROWS + j) * 3
      position[v] = sx * r
      position[v + 1] = ys[j]
      position[v + 2] = cz * r
      // Straight up, like the water: the pixel pass's normal-edge detector then leaves the painted
      // layers soft (no outline along their feet or between rings) instead of inking every far edge.
      normal[v] = 0
      normal[v + 1] = 1
      normal[v + 2] = 0
      const day = paint(spec.day, surfaces[i], j, snowCap, stepDay)
      const night = paint(spec.night, surfaces[i], j, snowCap, stepNight)
      colorDay[v] = day[0]
      colorDay[v + 1] = day[1]
      colorDay[v + 2] = day[2]
      colorNight[v] = night[0]
      colorNight[v + 1] = night[1]
      colorNight[v + 2] = night[2]
    }
  }

  let k = 0
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n
    for (let j = 0; j < ROWS - 1; j++) {
      const a = i * ROWS + j
      const b = i1 * ROWS + j
      const c = i1 * ROWS + j + 1
      const d = i * ROWS + j + 1
      // Counter-clockwise seen from inside the ring (the camera's side).
      indices[k++] = a
      indices[k++] = d
      indices[k++] = c
      indices[k++] = a
      indices[k++] = c
      indices[k++] = b
    }
  }
  return { rows: ROWS, position, normal, colorDay, colorNight, index: indices }
}

/** Triangles the technique draws: four ring strips plus the dome. */
export function triangleBudget(): number {
  return RINGS.reduce((sum, spec) => sum + spec.segments * (ROWS - 1) * 2, 0) + DOME_SEGMENTS[0] * DOME_SEGMENTS[1] * 2
}

/* ---------- sky ---------- */

/**
 * The technique leaves the grade's fog alone (220–640 m by day and night, the storm's 150–520):
 * the ring shader applies that same fog to every column's foot, so the fully fogged sea at 640 m
 * and the skerries' feet at 700 m are one colour without pulling the haze off the authored land.
 * `seaFogAt` is three's linear fog (a smoothstep of view depth), exposed so that fact is tested.
 */
export function seaFogAt(grade: SkyGrade, distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - grade.fogNear) / (grade.fogFar - grade.fogNear)))
  return t * t * (3 - 2 * t)
}
