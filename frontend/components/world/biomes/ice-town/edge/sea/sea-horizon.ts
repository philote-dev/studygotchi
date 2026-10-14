import { ICE_TOWN_PALETTE as P, type BiomeLayout, type WhaleEvent, seeded, whaleSchedule } from '../../layout/biome-layout'
import { landField } from '../../layout/terrain'
import type { SkyGrade } from '../../scene/sky-blend'

/**
 * Living sea horizon: pure numbers and seeded placement for the `sea` edge technique. No three.js
 * here so the geometry can be tested against the land and the camera box.
 *
 * Distances are metres from the plate centre unless they say "depth" (view depth from the camera,
 * the quantity three's linear fog uses).
 */
export const SEA_HORIZON = {
  /** The far-water annulus starts here; the authored water and every coast lie inside (the farthest land on the plate is 230 m out). */
  innerRadius: 236,
  /** Annulus outer edge and the radius of the horizon haze wall. */
  horizonRadius: 2300,
  /** The wall reaches this high so its top edge is never in frame (camera box top 300 m, pitch >= 12 deg). */
  wallHeight: 400,
  /** The wall starts this far under the water so the authored disc edge behind it is covered. */
  wallDepth: 4,
  /** Height over which the horizon glow fades into the sky. */
  glowHeight: 110,
  /** View depth where the water's haze starts to diverge from the scene fog (beyond any authored water). */
  hazeNear: 950,
  /** View depth where the far water is fully the haze colour (before the nearest wall section). */
  hazeFar: 1450,
  /** The annulus floats this far above the authored water disc. */
  surfaceLift: 0.03,
} as const

/** Scene fog for the technique: the land stays crisp, the horizon is a gradient, not a wall. */
export const SEA_FOG = {
  calm: { near: 300, far: 2200 },
  storm: { near: 200, far: 1300 },
} as const

export function seaSky(grade: SkyGrade, context: { night: boolean; storm: boolean }): SkyGrade {
  const fog = context.storm ? SEA_FOG.storm : SEA_FOG.calm
  return { ...grade, fogNear: fog.near, fogFar: fog.far }
}

export interface SeaPalette {
  /** Albedo of the far water at its inner edge: the authored water colour, exactly. */
  water: string
  /** Albedo the far water pales toward at the horizon. */
  far: string
  /** Screen colour of the horizon haze band (what the water and the sky both meet). */
  haze: string
  /** Pack ice and berg tops. */
  snow: string
  /** Berg bodies and tabular walls. */
  ice: string
  /** Berg shade side and floe underside. */
  iceShade: string
  /** Moon path tint (night only). */
  moon: string
  /** Emissive lift for the pack ice so far shade faces stay pale in the haze instead of reading as dark streaks. */
  shadowLift: string
}

export function seaPalette(night: boolean, storm: boolean): SeaPalette {
  if (night) {
    return {
      water: P.waterNight,
      far: '#2a486c',
      haze: '#2f3a60',
      snow: P.snowShadow,
      ice: '#b9cfe0',
      iceShade: '#6f93b0',
      moon: '#b4c2ee',
      shadowLift: '#141d2e',
    }
  }
  if (storm) {
    return {
      water: P.water,
      far: '#5a7589',
      haze: '#596a80',
      snow: '#dde6ee',
      ice: '#c3d6e3',
      iceShade: '#7fa3bb',
      moon: '#000000',
      shadowLift: '#3a4652',
    }
  }
  return {
    water: P.water,
    far: '#93bccb',
    haze: '#cfdfe8',
    snow: P.snow,
    ice: P.paleIce,
    iceShade: P.cliffIce,
    moon: '#000000',
    shadowLift: '#5c7684',
  }
}

/* ---------- colour helpers (sRGB hex, good enough for albedo ramps) ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function lerpHex(a: string, b: string, k: number): string {
  if (k <= 0) return a
  if (k >= 1) return b
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k)
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Where the water's own paling (independent of the camera) is complete. */
const FAR_WATER_RADIUS = 1000

/** Albedo of the far water at a radius: the authored colour at the inner edge, paling toward `far`. */
export function waterAlbedo(radius: number, palette: SeaPalette): string {
  if (radius <= SEA_HORIZON.innerRadius) return palette.water
  if (radius >= SEA_HORIZON.horizonRadius) return palette.far
  return lerpHex(palette.water, palette.far, smoothstep(SEA_HORIZON.innerRadius, FAR_WATER_RADIUS, radius))
}

/** Ring radii for the annulus, denser near the inner edge where the gradient is steepest. */
export function annulusRadii(count: number): number[] {
  const out: number[] = []
  const inner = SEA_HORIZON.innerRadius
  const outer = SEA_HORIZON.horizonRadius
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    out.push(i === count - 1 ? outer : inner + (outer - inner) * t * t)
  }
  return out
}

/* ---------- pack ice ---------- */

export type PackKind = 'floe' | 'berg' | 'tabular'

export interface PackBand {
  index: number
  rMin: number
  rMax: number
  count: number
  kind: PackKind
  /** Footprint radius range, metres. */
  size: [number, number]
  /** Height above the water, metres. */
  height: [number, number]
}

/** Three depth bands: flat floes near, mixed floes and bergs in the middle, tabular bergs toward the horizon. */
export const PACK_BANDS: readonly PackBand[] = [
  { index: 0, rMin: 250, rMax: 520, count: 48, kind: 'floe', size: [3, 8], height: [0.45, 0.7] },
  { index: 1, rMin: 520, rMax: 1000, count: 74, kind: 'berg', size: [5, 13], height: [3, 9] },
  { index: 2, rMin: 1000, rMax: 1900, count: 104, kind: 'tabular', size: [14, 34], height: [6, 15] },
]

export interface PackPiece {
  band: number
  kind: PackKind
  x: number
  z: number
  r: number
  yaw: number
  /** Footprint radius. */
  size: number
  height: number
  /** 0..1 brightness jitter for the instance tint. */
  tint: number
}

/** Icebreaker crossing: a chord through the south sea so the harbour poses see it pass. */
export const ICEBREAKER_PATH = {
  radius: 700,
  halfSweepDeg: 32,
  /** Bearing of the chord's midpoint (edge-pose convention: from +z toward +x). */
  bearingDeg: 0,
  speed: 12,
} as const

const SEA_MARGIN = -8

/** Seeded pack ice in three bands, on open sea, clear of the mirage places and the far whales. */
export function packIce(layout: BiomeLayout, seed: number): PackPiece[] {
  const rng = seeded(seed * 53 + 101)
  const sites = mirageSites(seed)
  const spouts = spoutSites(layout, seed)
  const out: PackPiece[] = []
  for (const band of PACK_BANDS) {
    let guard = 0
    let placed = 0
    while (placed < band.count && guard++ < band.count * 20) {
      const a = rng() * Math.PI * 2
      // Uniform in area within the band.
      const r = Math.sqrt(band.rMin * band.rMin + rng() * (band.rMax * band.rMax - band.rMin * band.rMin))
      const x = Math.sin(a) * r
      const z = Math.cos(a) * r
      if (landField(layout, x, z) >= SEA_MARGIN) continue
      if (sites.some((site) => Math.hypot(x - site.x, z - site.z) <= 120 + 40)) continue
      if (spouts.some((spout) => Math.hypot(x - spout.x, z - spout.z) <= 24 + band.size[1])) continue
      const size = band.size[0] + rng() * (band.size[1] - band.size[0])
      if (out.some((p) => p.band === band.index && Math.hypot(p.x - x, p.z - z) < (p.size + size) * 1.3)) continue
      out.push({
        band: band.index,
        kind: band.kind,
        x,
        z,
        r,
        yaw: rng() * Math.PI * 2,
        size,
        height: band.height[0] + rng() * (band.height[1] - band.height[0]),
        tint: rng(),
      })
      placed++
    }
  }
  return out
}

/* ---------- mirage places ---------- */

export type MirageId = 'cabin-island' | 'volcano-berg' | 'ice-cathedral' | 'tabular-giant'

export interface MirageSite {
  id: MirageId
  x: number
  z: number
  r: number
  yaw: number
}

/**
 * Authored bearings (edge-pose convention: 0 = south / +z, 90 = east / +x) so the hero poses
 * each have one in reach, with seeded radius and yaw: the cabin island SSE for the harbour view,
 * the volcano ESE off the research island, the cathedral NNE behind the range, the tabular giant
 * WNW where the low-horizon pose sees open sea past the glacier.
 */
const MIRAGE_SPOTS: Array<{ id: MirageId; bearingDeg: number; radius: [number, number] }> = [
  { id: 'cabin-island', bearingDeg: 20, radius: [820, 920] },
  { id: 'volcano-berg', bearingDeg: 70, radius: [1040, 1180] },
  { id: 'ice-cathedral', bearingDeg: 160, radius: [1240, 1400] },
  { id: 'tabular-giant', bearingDeg: 240, radius: [780, 880] },
]

export function mirageSites(seed: number): MirageSite[] {
  const rng = seeded(seed * 19 + 5)
  return MIRAGE_SPOTS.map((spot) => {
    const bearing = ((spot.bearingDeg + (rng() - 0.5) * 10) * Math.PI) / 180
    const r = spot.radius[0] + rng() * (spot.radius[1] - spot.radius[0])
    return { id: spot.id, x: Math.sin(bearing) * r, z: Math.cos(bearing) * r, r, yaw: rng() * Math.PI * 2 }
  })
}

/* ---------- icebreaker ---------- */

export interface Crossing {
  startAt: number
  duration: number
  dir: 1 | -1
}

const CHORD_HALF = Math.sin((ICEBREAKER_PATH.halfSweepDeg * Math.PI) / 180) * ICEBREAKER_PATH.radius
const CHORD_OFFSET = Math.cos((ICEBREAKER_PATH.halfSweepDeg * Math.PI) / 180) * ICEBREAKER_PATH.radius
const CROSSING_SECONDS = (CHORD_HALF * 2) / ICEBREAKER_PATH.speed

/** One crossing about every 90 s (seeded 78–102), direction alternating. */
export function icebreakerSchedule(seed: number, count = 60): Crossing[] {
  const rng = seeded(seed * 41 + 13)
  const out: Crossing[] = []
  let t = 6 + rng() * 20
  let dir: 1 | -1 = rng() < 0.5 ? 1 : -1
  for (let i = 0; i < count; i++) {
    out.push({ startAt: t, duration: CROSSING_SECONDS, dir })
    t += 78 + rng() * 24
    dir = dir === 1 ? -1 : 1
  }
  return out
}

export interface IcebreakerState {
  visible: boolean
  x: number
  z: number
  yaw: number
  /** 0..1 along the chord. */
  k: number
}

const ICEBREAKER_HIDDEN: IcebreakerState = { visible: false, x: 0, z: 0, yaw: 0, k: 0 }

export function icebreakerStateAt(schedule: Crossing[], time: number): IcebreakerState {
  for (const crossing of schedule) {
    if (time < crossing.startAt) break
    const local = time - crossing.startAt
    if (local >= crossing.duration) continue
    const k = local / crossing.duration
    const along = (k * 2 - 1) * CHORD_HALF * crossing.dir
    const bearing = (ICEBREAKER_PATH.bearingDeg * Math.PI) / 180
    // Chord frame: `out` points from the centre toward the chord midpoint, `side` runs along the chord.
    const outX = Math.sin(bearing)
    const outZ = Math.cos(bearing)
    const sideX = outZ
    const sideZ = -outX
    const x = outX * CHORD_OFFSET + sideX * along
    const z = outZ * CHORD_OFFSET + sideZ * along
    const yaw = Math.atan2(sideX * crossing.dir, sideZ * crossing.dir)
    return { visible: true, x, z, yaw, k }
  }
  return ICEBREAKER_HIDDEN
}

/* ---------- far whale spouts ---------- */

export interface SpoutSite {
  x: number
  z: number
  r: number
  yaw: number
  schedule: WhaleEvent[]
}

/** Three far whales in the middle distance, each on its own seeded surfacing schedule. */
export function spoutSites(layout: BiomeLayout, seed: number, count = 3): SpoutSite[] {
  const rng = seeded(seed * 29 + 3)
  const out: SpoutSite[] = []
  let guard = 0
  while (out.length < count && guard++ < 200) {
    // Spread around the compass so each outward pose has a chance of one.
    const slot = out.length
    const a = ((slot / count) * 360 + 30 + rng() * 60) * (Math.PI / 180)
    const r = 300 + rng() * 300
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    if (landField(layout, x, z) >= -20) continue
    out.push({ x, z, r, yaw: rng() * Math.PI * 2, schedule: whaleSchedule(seed * 7 + slot * 13 + 1) })
  }
  return out
}
