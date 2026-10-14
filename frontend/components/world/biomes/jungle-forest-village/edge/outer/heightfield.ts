/**
 * Endless jungle: the pure outer world beyond the authored plate. No three.js in here.
 *
 * Coordinates as in the layout: x east, z south, y up, metres. The authored plate is the flat
 * square |x|,|z| < worldExtent (190) at y = 0. Everything here lives outside it, in three
 * Chebyshev LOD rings whose lattices line up at the shared boundaries. The ground swells gently
 * away from the seam into a rolling canopy, then into four concentric ridge rows that each sit
 * further toward the mist colour (the aerial perspective is baked per face and the scene fog
 * finishes the job at ~1.5 km). The lagoon's outflow continues east down its own valley to a
 * delta and a hazy sea; the south ray carries the rope-bridge gorge; the west ray the volcano.
 */
import { JUNGLE_LAYOUT as L } from '../../layout/jungle-layout'
import { SHORE, type BarrierPlan, type Gorge, type VistaGap, type Volcano, barrierPlan, channelDistance, windowFactor } from '../barriers/geography'
import { type Pad, type PlacesPlan, type Pool, placesPlan } from '../places/plan'
import { arcNoise, bearingOf, chebyshev, clamp, fbm, lerp, ridged, smoothstep } from '../noise'

/* ---------- rings ---------- */

export interface RingSpec {
  ring: 1 | 2 | 3
  /** Chebyshev inner / outer radius in metres. */
  inner: number
  outer: number
  /** Lattice cell in metres; divides both radii and the next ring's cell is a multiple of it. */
  cell: number
}

/** Chebyshev radius of the last ring: the far frustum from anywhere in the camera box is fogged out before this. */
export const OUTER_REACH = 2240

/** 190–500 m at 10 m, 500–1120 m at 20 m, 1120–2240 m at 80 m: every boundary sits on both lattices. */
export function ringSpecs(plateHalf: number): RingSpec[] {
  const inner = Math.round(plateHalf / 10) * 10
  return [
    { ring: 1, inner, outer: 500, cell: 10 },
    { ring: 2, inner: 500, outer: 1120, cell: 20 },
    { ring: 3, inner: 1120, outer: OUTER_REACH, cell: 80 },
  ]
}

export function ringAt(x: number, z: number, rings: RingSpec[]): RingSpec | null {
  const d = chebyshev(x, z)
  for (const ring of rings) if (d >= ring.inner && d < ring.outer) return ring
  return null
}

/* ---------- ridge rows ---------- */

export interface RowSpec {
  row: 1 | 2 | 3 | 4
  /** Mean radius from the land centre and half-width of the ridge's foot. */
  radius: number
  width: number
  height: [number, number]
  /** Fraction toward the mist colour baked into the row's faces. */
  haze: number
}

/** Four rows, each farther, taller and paler; rows 1–2 open a saddle at every window, row 3 at the volcano's. */
export const ROWS: readonly RowSpec[] = [
  { row: 1, radius: 300, width: 95, height: [14, 26], haze: 0.12 },
  { row: 2, radius: 540, width: 140, height: [55, 85], haze: 0.42 },
  { row: 3, radius: 880, width: 220, height: [100, 140], haze: 0.64 },
  { row: 4, radius: 1300, width: 340, height: [160, 220], haze: 0.84 },
]

/* ---------- the world ---------- */

export type OuterMaterial = 'ground' | 'canopy' | 'bank' | 'wet' | 'sea' | 'volcano' | 'crater'

export interface OuterSample {
  height: number
  material: OuterMaterial
  /** 0 open woodland floor (the plate's green), 1 closed canopy top. */
  canopy: number
  /** 0–1 toward the mist colour: the baked aerial perspective. */
  haze: number
  /** Row of the dominant ridge, 0 off the rows. */
  row: number
  /** This point's ridge height as a fraction of the row's local crest. */
  peakFrac: number
}

/** A still pool dug into the land, with the height its water surface sits at. */
export interface WorldPool extends Pool {
  surface: number
}

export interface OuterWorld {
  seed: number
  plateHalf: number
  rings: RingSpec[]
  gaps: VistaGap[]
  gorge: Gorge
  volcano: Volcano
  /** The wall and vistas (pure plan) and the inhabited places this land is flattened under. */
  barriers: BarrierPlan
  places: PlacesPlan
  pools: WorldPool[]
  /** Our heightfield (metres); inside the plate it is a hidden floor under the authored ground. */
  sample(x: number, z: number): OuterSample
  height(x: number, z: number): number
  /** The authored plate height at the seam: flat ground, y = 0. */
  seamHeight(x: number, z: number): number
  /** x of the east coast at a given z. */
  shoreX(z: number): number
  /** The river's water surface height beyond the plate (the valley floor plus a film). */
  riverSurface(x: number, z: number): number
  /** Haze for a bare position (far detail instances). */
  hazeAt(x: number, z: number): number
}

/** Aerial perspective by distance from the land centre; zero for the first 50 m past the seam so the plate's green continues unchanged. */
function baseHaze(r: number, d: number): number {
  return (0.05 + 0.84 * smoothstep(0, 1250, r - 210)) * smoothstep(50, 140, d)
}

/** Half-width of the outer river's water, growing toward the delta. */
export function riverHalfWidth(x: number): number {
  return L.hydrology.riverWidth / 2 + 4 * clamp((x - 300) / 300, 0, 1)
}

export function createOuterWorld(seed: number): OuterWorld {
  const plateHalf = L.worldExtent
  const rings = ringSpecs(plateHalf)
  const barriers = barrierPlan(seed)
  const { gaps, gorge, volcano } = barriers
  const places = placesPlan(seed, barriers)
  const westGap = gaps.find((g) => g.id === 'west')!
  const gorgeDir = [Math.sin(gorge.yaw), Math.cos(gorge.yaw)] as const
  const gorgeNrm = [Math.cos(gorge.yaw), -Math.sin(gorge.yaw)] as const

  const shoreX = (z: number) => SHORE.x + SHORE.wobble * (2 * fbm(z * 0.0025 + 2.2, 0.7 + seed * 0.01, 2) - 1)

  const hazeAt = (x: number, z: number) => baseHaze(Math.hypot(x, z), chebyshev(x, z) - plateHalf)

  const rawSample = (x: number, z: number): OuterSample => {
    const cheb = chebyshev(x, z)
    if (cheb < plateHalf) return { height: -0.8, material: 'ground', canopy: 0, haze: 0, row: 0, peakFrac: 0 }
    const d = cheb - plateHalf
    const r = Math.hypot(x, z)
    const b = bearingOf(x, z)
    // Relief, haze and canopy ease in off the seam: the first 40–60 m beyond the plate are its
    // own flat green, so the overview (which sees 40 m past the north edge and 60 m past the
    // corners) renders pixel-identical to the shipped land, and the pixel pass inks no edge
    // along the plate boundary.
    const seamK = smoothstep(60, 170, d)
    const nearK = smoothstep(50, 140, d)
    const shore = shoreX(z)
    const seaK = smoothstep(shore - 60, shore + 10, x)
    // Ridges sink into a coastal plain before the sea; the delta plain is flat from its apex.
    const coastK = 1 - smoothstep(shore - 170, shore - 30, x)
    const eastSector = 1 - smoothstep(55, 95, Math.abs(((b - 90 + 540) % 360) - 180))
    const plainK = smoothstep(SHORE.deltaApexX - 80, SHORE.deltaApexX + 40, x) * eastSector

    // Gentle swells off the seam, then a rolling canopy.
    let swell =
      smoothstep(40, 130, d) * (2.5 + 4 * fbm(x * 0.015 + 1.3, z * 0.015 + 4.1, 3)) +
      smoothstep(80, 420, d) * (5 + 9 * fbm(x * 0.004 + 3, z * 0.004 + 7, 3))
    swell *= 1 - 0.8 * plainK

    // Ridge rows.
    const window = windowFactor(gaps, b)
    const westWindow = 1 - smoothstep(westGap.halfWidthDeg + 4, westGap.halfWidthDeg + 16, Math.abs(((b - westGap.bearingDeg + 540) % 360) - 180))
    let rowsH = 0
    let rowsSum = 0
    let row = 0
    let peakFrac = 0
    let rowHaze = 0
    for (const spec of ROWS) {
      const radius = spec.radius * (1 + 0.09 * (2 * arcNoise(b, 1.7 + spec.row * 0.6, seed * 0.13 + spec.row * 11, 2) - 1))
      const u = Math.abs(r - radius) / spec.width
      if (u >= 1) continue
      const a = (b * Math.PI) / 180
      const crest = Math.pow(ridged(Math.cos(a) * (2.3 + spec.row) + spec.row * 7.7 + seed * 0.21, Math.sin(a) * (2.3 + spec.row) + 3.1, 3), 1.3)
      const cover = smoothstep(0.22, 0.5, arcNoise(b, 1.3, seed * 0.7 + spec.row * 5, 2))
      const H = (spec.height[0] + (spec.height[1] - spec.height[0]) * crest) * (0.3 + 0.7 * cover)
      // Rows 1–2 open a saddle at every window; rows 3–4 open at the west so the volcano stands free.
      const open = spec.row <= 2 ? 1 - 0.82 * window : 1 - 0.92 * westWindow
      const profile = Math.pow(1 - u, 1.55) * (0.86 + 0.28 * fbm(x * 0.012 + spec.row * 3, z * 0.012 + spec.row, 3))
      const h = H * open * profile * coastK
      rowsSum += h
      if (h > rowsH) {
        rowsH = h
        row = spec.row
        peakFrac = Math.min(1, h / Math.max(1e-6, H))
        rowHaze = spec.haze
      }
    }
    rowsH = (rowsH + (rowsSum - rowsH) * 0.25) * seamK

    // The volcano: a cone in the west window with a dished crater.
    const dv = Math.hypot(x - volcano.x, z - volcano.z)
    let cone = 0
    if (dv < volcano.radius) {
      cone = volcano.height * Math.pow(1 - dv / volcano.radius, 1.25) * (0.92 + 0.16 * fbm(x * 0.02 + 9, z * 0.02 + 2, 2))
      if (dv < volcano.craterRadius) cone -= volcano.height * 0.3 * (1 - dv / volcano.craterRadius)
    }
    const relief = Math.max(rowsH, cone) + 0.25 * Math.min(rowsH, cone)
    let height = swell + relief

    // The river valley: floor descends to the sea, the valley fans into a delta.
    const dr = channelDistance(x, z)
    const down = clamp((x - plateHalf) / 420, 0, 1)
    const valleyW = 20 + 90 * down
    const valley = 1 - smoothstep(valleyW * 0.4, valleyW, dr)
    const floor = lerp(-1.4 * down, -1.6, seaK)
    height = lerp(height, floor, valley)
    const riverHalf = riverHalfWidth(x)
    let material: OuterMaterial = 'ground'
    if (dr < riverHalf + 2.5) {
      // The wet bed sits under the water ribbon; the dip fades in off the seam so the seam stays exact.
      height = floor - 0.35 * smoothstep(0, 20, d)
      material = 'wet'
    } else if (dr < riverHalf + 6) material = 'bank'

    // The sea.
    height = lerp(height, -1.6, seaK)
    if (seaK > 0.5 && height < -0.9) material = 'sea'

    // The gorge the rope bridge spans.
    const gx = x - gorge.x
    const gz = z - gorge.z
    const along = Math.abs(gx * gorgeDir[0] + gz * gorgeDir[1]) / gorge.halfLength
    const across = Math.abs(gx * gorgeNrm[0] + gz * gorgeNrm[1]) / gorge.halfWidth
    const pit = gorge.depth * (1 - smoothstep(0.55, 1, across)) * (1 - smoothstep(0.6, 1, along))
    height -= pit

    // Canopy closes with distance from the open woodland of the plate (patchy, not a line).
    const canopy = material === 'ground' ? smoothstep(0.35, 0.65, smoothstep(60, 260, d) + 0.35 * (fbm(x * 0.03 + 5, z * 0.03 + 1, 2) - 0.5)) * nearK : 0
    if (material === 'ground' && cone > volcano.height * 0.3) material = dv < volcano.craterRadius * 0.85 ? 'crater' : 'volcano'

    let haze = baseHaze(r, d)
    if (row) haze = Math.max(haze, lerp(haze, rowHaze * nearK, smoothstep(0.08, 0.5, peakFrac * seamK)))
    if (cone > 0) haze = Math.max(haze, 0.74 * smoothstep(0.1, 0.5, cone / volcano.height))
    return { height, material, canopy, haze, row, peakFrac }
  }

  // The inhabited places: flat pads under the settlements and ruins (at the raw height of each
  // centre), and still pools dug under the valley floor. The river bed itself is never raised.
  const padHeights: Array<Pad & { height: number }> = places.pads.map((pad) => ({ ...pad, height: rawSample(pad.x, pad.z).height }))
  const pools: WorldPool[] = places.pools.map((pool) => {
    const centre = rawSample(pool.x, pool.z)
    const onRiver = centre.material === 'wet'
    const floor = onRiver ? centre.height : centre.height - pool.depth
    return { ...pool, surface: onRiver ? riverSurface(pool.x, pool.z) : floor + pool.depth - 0.3 }
  })

  const sample = (x: number, z: number): OuterSample => {
    const raw = rawSample(x, z)
    if (chebyshev(x, z) < plateHalf + 60) return raw
    let height = raw.height
    let material = raw.material
    for (const pad of padHeights) {
      const d = Math.hypot(x - pad.x, z - pad.z)
      if (d >= pad.radius || material === 'wet') continue
      height = lerp(height, pad.height, 1 - smoothstep(pad.radius * 0.7, pad.radius, d))
    }
    for (const pool of pools) {
      const d = Math.hypot(x - pool.x, z - pool.z)
      if (d >= pool.radius) continue
      const bed = pool.surface - 0.08 - pool.depth * (1 - smoothstep(0.6, 1, d / pool.radius))
      if (bed < height) height = bed
      if (d < pool.radius * 0.92) material = 'wet'
    }
    if (height === raw.height && material === raw.material) return raw
    return { ...raw, height, material, canopy: material === 'wet' ? 0 : raw.canopy }
  }

  function riverSurface(x: number, z: number): number {
    const seaK = smoothstep(shoreX(z) - 60, shoreX(z) + 10, x)
    const down = clamp((x - plateHalf) / 420, 0, 1)
    return lerp(-1.4 * down, -1.6, seaK) + 0.08
  }

  return {
    seed,
    plateHalf,
    rings,
    gaps,
    gorge,
    volcano,
    barriers,
    places,
    pools,
    sample,
    height: (x, z) => sample(x, z).height,
    seamHeight: () => L.groundHeight,
    shoreX,
    riverSurface,
    hazeAt,
  }
}

/* ---------- fog ---------- */

/** Humid air: nearer than the ice shelf's 1.7 km. Night air is clearer but dark, so the fog must finish earlier. */
export const OUTER_FOG = {
  day: { near: 280, far: 1500 },
  night: { near: 220, far: 1150 },
} as const

/** The mist / haze colour every far face is pulled toward (the sky, so the horizon dissolves with no band). */
export function mistColour(night: boolean): string {
  return night ? '#102a25' : '#d9eee2'
}
