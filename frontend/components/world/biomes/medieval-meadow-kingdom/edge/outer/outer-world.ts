/**
 * Endless meadow: the pure outer world beyond the authored plate. No three.js in here.
 *
 * Coordinates as in the layout: x east, z south, y up, metres. The authored plate is the flat
 * rectangle `plateRect(layout)` (top at y = 0). Everything here lives outside it in three LOD
 * rings whose lattices share the 60 m grid, and on the plate itself only as decoration (field
 * decals, hedgerows, copses) kept out of the authored world and out of the shipped overview frame.
 *
 * The world is one heightfield `sample(x, z)`: rolling folds that ramp in from zero at the seam,
 * the hedgerow patchwork of `fields.ts`, the river winding on to a lake and a source, the barrier
 * plan's ridge rows, crag, windmill hill and lake, and a baked aerial perspective (`haze`) plus
 * the gentle land-anchored bend of `../curvature/bend.ts`.
 */
import type { GeneratedKingdom, Point2 } from '../../layout/biome-layout'
import { type Rect, authoredRect, distToPolyline, inRect, plateRect, rectDistance, rectEuclid } from '../../layout/terrain'
import { type BarrierPlan, barrierPlan, lakeInside, lakeWoodsDensity, peakHeight, rowsHeight, wallDensity } from '../barriers/geography'
import { bendDropAt } from '../curvature/bend'
import { fbm, hash2, lerp, smoothstep } from '../noise'
import { inOverviewFrustum } from '../poses'
import { type FieldGrid, createFieldGrid, fieldCentre, fieldIndexAt, fieldPolygon, fieldTone } from './fields'
import { type RiverContinuation, riverBedAt, riverContinuation, riverDistance, riverWidthAt } from './river'

/* ---------- rings ---------- */

export interface RingSpec {
  ring: 1 | 2 | 3
  /** Chebyshev distance outside the plate rect, metres. */
  inner: number
  outer: number
  /** Lattice cell in metres: 10 / 20 / 60, all dividing the 60 m plate grid. */
  cell: number
}

/** Chebyshev reach of the last ring; the fog (1.6 km) and the bend have hidden everything before this. */
export const OUTER_REACH = 1500

export function ringSpecs(): RingSpec[] {
  return [
    { ring: 1, inner: 0, outer: 300, cell: 10 },
    { ring: 2, inner: 300, outer: 840, cell: 30 },
    { ring: 3, inner: 840, outer: OUTER_REACH, cell: 60 },
  ]
}

export function ringAt(plate: Rect, x: number, z: number, rings: RingSpec[]): RingSpec | null {
  const d = rectDistance(plate, x, z)
  for (const ring of rings) if (d >= ring.inner && d < ring.outer) return ring
  return null
}

/* ---------- samples ---------- */

export type OuterMaterial = 'meadow' | 'bank' | 'water' | 'hill' | 'rock' | 'forest' | 'crag'

export interface OuterSample {
  /** Final height, bend included. */
  height: number
  material: OuterMaterial
  /** Field tone 0–4 (0 = the plate's own meadow). */
  tone: number
  /** 0–1 toward the sky colour: the baked aerial perspective. */
  haze: number
  /** 0–1 density of standing trees here (walls, lake woods, hill-flank woods). */
  forest: number
  /** Metres the bend lowered this point. */
  drop: number
}

export interface OuterWorld {
  layout: GeneratedKingdom
  seed: number
  plate: Rect
  authored: Rect
  rings: RingSpec[]
  fields: FieldGrid
  plan: BarrierPlan
  river: RiverContinuation
  /** Dirt tracks: from the far mill up to the ridge saddle, and from the western forest gap to the windmill hill. */
  tracks: Point2[][]
  sample(x: number, z: number): OuterSample
  /** `sample` at a lattice point (x, z multiples of the ring cell), memoised: the ring build and every placement share it. */
  sampleLattice(x: number, z: number): OuterSample
  /**
   * Height of the rendered mesh at a point: the ring's lattice cell interpolated on the same
   * triangle split `outer-mesh.ts` uses, so a tree, hedge or landmark placed here sits on the
   * surface instead of floating on a summit the coarser lattice cut off. The plate is flat at 0.
   */
  meshHeight(x: number, z: number): number
  /** 0–1 density of standing woods here (walls, lake woods, hill flanks, far slopes), without the full sample. */
  forestAt(x: number, z: number): number
  /** Height before the bend; exactly 0 on the plate edge. */
  relief(x: number, z: number): number
  /** The authored world (with a margin) and the shipped overview's ground footprint: no decoration here. */
  forbidden(x: number, z: number): boolean
  /** Whether a field quad is coloured and hedged (every corner clear of the forbidden zone). */
  fieldIncluded(i: number, j: number): boolean
  /** Whether a tree, hedge or haystack may stand here. */
  decorate(x: number, z: number): boolean
  /** > 0 under water (lake or river channel beyond the plate), metres of depth. */
  waterDepth(x: number, z: number): number
  /** Distance to the river centreline. */
  riverDist(x: number, z: number): number
  /** Hedgerow patchwork visible here (fades out before the rows and the far rings). */
  patchwork(x: number, z: number): number
}

/** Margin kept around the authored world. */
export const AUTHORED_MARGIN = 10
/** Aspects the overview footprint is kept clear for (16:9 captures and an ultrawide). */
const OVERVIEW_ASPECTS = [16 / 9, 2.4]
/** Radius kept clear of trees and hedges around each vista landmark and the far mill. */
const LANDMARK_CLEARANCE = 60

export function createOuterWorld(layout: GeneratedKingdom, seed: number): OuterWorld {
  const plate = plateRect(layout)
  const authored = authoredRect(layout, AUTHORED_MARGIN)
  const rings = ringSpecs()
  const fields = createFieldGrid(seed)
  const plan = barrierPlan(layout, seed)
  const river = riverContinuation(layout)
  const lake = plan.lake

  const riverDist = (x: number, z: number) => riverDistance(layout, river, x, z).dist

  const waterDepth = (x: number, z: number): number => {
    if (inRect(plate, x, z)) return 0
    const inside = lakeInside(lake, x, z)
    if (inside > 0) return Math.min(1.6, inside * 0.25) + 0.2
    const hit = riverDistance(layout, river, x, z)
    if (hit.reach === 'authored') return 0
    const half = riverWidthAt(layout, river, hit, z, plate.minZ) / 2
    return hit.dist < half ? 0.3 : 0
  }

  const forbidden = (x: number, z: number): boolean => {
    if (inRect(authored, x, z)) return true
    for (const aspect of OVERVIEW_ASPECTS) {
      if (inOverviewFrustum(x, 0, z, aspect, 1.2) || inOverviewFrustum(x, 12, z, aspect, 1.2)) return true
    }
    return false
  }

  const fieldCache = new Map<string, boolean>()
  const fieldIncluded = (i: number, j: number): boolean => {
    const key = `${i},${j}`
    const cached = fieldCache.get(key)
    if (cached !== undefined) return cached
    const poly = fieldPolygon(fields, i, j)
    let ok = true
    for (const [px, pz] of poly) {
      if (forbidden(px, pz)) {
        ok = false
        break
      }
    }
    // The patchwork thins toward the kingdom: open common meadow around the villages gives way to
    // farmland over ~100 m, so the forbidden zone's edge never reads as a straight frontier.
    if (ok) {
      const [cx, cz] = fieldCentre(fields, i, j)
      const settled = smoothstep(30, 140, rectEuclid(authored, cx, cz))
      if (hash2(i * 1.9 + seed * 0.3, j * 3.7 - seed * 0.7) > settled) ok = false
    }
    fieldCache.set(key, ok)
    return ok
  }

  const nearLandmark = (x: number, z: number): boolean => {
    for (const v of plan.vistas) if (Math.hypot(v.x - x, v.z - z) < LANDMARK_CLEARANCE) return true
    return Math.hypot(river.mill.x - x, river.mill.z - z) < 22
  }

  // The north track climbs the river's east bank from the far mill into the saddle; the west track
  // leaves the forest gap for the windmill hill, starting where the overview can no longer see it.
  const saddle = plan.saddle
  const northTrack: Point2[] = [
    [river.mill.x, river.mill.z],
    [river.mill.x - 7, -300],
    [river.mill.x - 14, -340],
    [river.mill.x - 8, -372],
    [saddle.x + 19, saddle.z],
    [saddle.x + 12, saddle.z - 32],
  ]
  const westWall = plan.walls.find((w) => w.side === 'west')!
  const westGapZ = westWall.gapZ
  let westStartX = plate.minX + 10
  for (let x = -150; x > plate.minX; x -= 2) {
    if (!forbidden(x, westGapZ) && !forbidden(x, westGapZ + 6) && !forbidden(x, westGapZ - 6)) {
      westStartX = x
      break
    }
  }
  const mill = plan.millHill
  const westTrack: Point2[] = [
    [westStartX, westGapZ],
    [plate.minX - 4, westGapZ + 2],
    [-(westWall.inner + 40), westGapZ],
    [mill.x + mill.radius * 0.9, westGapZ + 6],
    [mill.x + mill.radius * 0.45, mill.z + 10],
  ]
  const tracks: Point2[][] = [northTrack, westTrack]
  const trackDist = (x: number, z: number) => Math.min(...tracks.map((track) => distToPolyline(track, x, z).dist))

  const decorate = (x: number, z: number): boolean => {
    if (forbidden(x, z)) return false
    if (waterDepth(x, z) > 0) return false
    if (riverDist(x, z) < 17) return false
    if (lakeInside(lake, x, z) > -8) return false
    if (nearLandmark(x, z)) return false
    if (trackDist(x, z) < 5) return false
    return true
  }

  /** Hedgerow patchwork: strong on and just past the plate, gone on the ridge rows and the far rings. */
  const patchwork = (x: number, z: number): number => {
    const out = rectEuclid(plate, x, z)
    return 1 - smoothstep(420, 900, out)
  }

  const relief = (x: number, z: number): number => {
    const out = rectEuclid(plate, x, z)
    if (out <= 0) return 0
    // Rolling folds, never below the plate top near the seam so no plate side ever shows.
    const amp = 1.4 * smoothstep(0, 90, out) + 5.5 * smoothstep(60, 420, out) + 13 * smoothstep(400, 1300, out)
    const fold = fbm(x * 0.0055 + 1.3, z * 0.0055 + 7.1, 3) + 0.5 + 0.35 * (fbm(x * 0.018 + 9.2, z * 0.018 + 3.4, 2) + 0.5)
    let height = amp * Math.max(0, fold)
    // Far low swells all round so the horizon undulates where there are no rows.
    height += 11 * smoothstep(500, 1400, out) * (fbm(x * 0.0025 + 3.3, z * 0.0025 + 5.5, 3) + 0.5)
    // The ridge rows, the crag in the saddle, the windmill hill and the city's rise.
    const rows = rowsHeight(plan.rows, x, z)
    height += rows.height
    height += peakHeight(plan.crag, x, z)
    height += peakHeight(plan.millHill, x, z)
    height += peakHeight(plan.cityRise, x, z)
    // The river valley: the bed is flat across the bank band and the folds ease down into it.
    const hit = riverDistance(layout, river, x, z)
    if (hit.reach !== 'authored') {
      const bed = riverBedAt(river, hit, z, plate, lake.level)
      const bank = layout.wetBandWidth / 2
      const valley = smoothstep(bank, bank + 26, hit.dist)
      height = lerp(bed, Math.max(bed, height), valley)
    }
    // The lake: a flat sheet at its level, the meadow easing down to it over a 24 m shore.
    const inside = lakeInside(lake, x, z)
    if (inside > -24) {
      const shore = smoothstep(-24, 0, inside)
      height = lerp(height, Math.min(height, lake.level), shore)
      if (inside >= 0) height = lake.level
    }
    return height
  }

  const forestAt = (x: number, z: number): number => {
    if (inRect(plate, x, z)) return 0
    let density = Math.max(wallDensity(plan.walls, x, z), lakeWoodsDensity(plan, x, z))
    // Woods on the lower flanks of the ridge rows and on far slopes.
    const rows = rowsHeight(plan.rows, x, z)
    if (rows.height > 2 && rows.peakFrac < 0.62) {
      density = Math.max(density, smoothstep(0.1, 0.3, fbm(x * 0.005 + 2.5, z * 0.005 + 8.8, 3) + 0.2) * smoothstep(2, 10, rows.height))
    }
    if (rectEuclid(plate, x, z) > 420) {
      const far = smoothstep(0.18, 0.3, fbm(x * 0.0035 + 6.1, z * 0.0035 + 1.9, 3) + 0.25) * 0.8
      if (far > density && relief(x, z) > 0.5) density = far
    }
    return density
  }

  const haze = (x: number, z: number): number => {
    const out = rectEuclid(plate, x, z)
    return 0.06 * smoothstep(0, 300, out) + 0.72 * smoothstep(240, 1400, out)
  }

  // Lattice samples are shared by the ring meshes and every placement (meshHeight): memoised by position.
  const latticeCache = new Map<number, OuterSample>()
  const LATTICE_OFFSET = 1 << 15
  const sampleLattice = (x: number, z: number): OuterSample => {
    const key = (Math.round(x) + LATTICE_OFFSET) * (1 << 16) + (Math.round(z) + LATTICE_OFFSET)
    let s = latticeCache.get(key)
    if (!s) {
      s = sample(x, z)
      latticeCache.set(key, s)
    }
    return s
  }

  const meshHeight = (x: number, z: number): number => {
    const d = rectDistance(plate, x, z)
    if (d <= 0) return 0
    const ring = ringAt(plate, x, z, rings) ?? rings[rings.length - 1]
    const cell = ring.cell
    const i0 = Math.floor(x / cell)
    const j0 = Math.floor(z / cell)
    const x0 = i0 * cell
    const z0 = j0 * cell
    const u = (x - x0) / cell
    const v = (z - z0) / cell
    const hA = sampleLattice(x0, z0).height
    const hB = sampleLattice(x0 + cell, z0).height
    const hC = sampleLattice(x0, z0 + cell).height
    const hD = sampleLattice(x0 + cell, z0 + cell).height
    // Same diagonal rule as buildRing: even cells split a–d (b, d, c / a, b, c), odd cells split b–c.
    if ((i0 + j0) % 2 === 0) {
      // Triangles (a, b, c) and (b, d, c): diagonal from b to c.
      return u + v <= 1 ? hA + (hB - hA) * u + (hC - hA) * v : hD + (hC - hD) * (1 - u) + (hB - hD) * (1 - v)
    }
    // Triangles (a, b, d) and (a, d, c): diagonal from a to d.
    return u >= v ? hA + (hB - hA) * u + (hD - hB) * v : hA + (hC - hA) * v + (hD - hC) * u
  }

  const sample = (x: number, z: number): OuterSample => {
    const drop = bendDropAt(plate, x, z)
    const base = relief(x, z)
    const height = base - drop
    const h = haze(x, z)
    const depth = waterDepth(x, z)
    if (depth > 0) return { height, material: 'water', tone: 0, haze: h, forest: 0, drop }
    const hit = riverDistance(layout, river, x, z)
    const inside = lakeInside(lake, x, z)
    if ((hit.reach !== 'authored' && hit.dist < layout.wetBandWidth / 2) || inside > -7) {
      return { height, material: 'bank', tone: 0, haze: h, forest: 0, drop }
    }
    const forest = forestAt(x, z)
    const rows = rowsHeight(plan.rows, x, z)
    const crag = peakHeight(plan.crag, x, z)
    let material: OuterMaterial = 'meadow'
    let tone = 0
    if (patchwork(x, z) > 0.02 && rows.height < 6 && crag < 1) {
      const [i, j] = fieldIndexAt(fields, x, z)
      if (fieldIncluded(i, j)) tone = fieldTone(fields, i, j)
    }
    if (forest > 0.55) material = 'forest'
    // The crag's upper half is dark rock so the pale castle on it reads; far-row caps are limestone shoulders.
    if (crag > plan.crag.height * 0.5) material = 'crag'
    else if (rows.cap && rows.peakFrac > 0.74) material = 'rock'
    else if (rows.height > 8 || crag > 2) material = 'hill'
    return { height, material, tone, haze: h, forest, drop }
  }

  return {
    layout,
    seed,
    plate,
    authored,
    rings,
    fields,
    plan,
    river,
    tracks,
    sample,
    sampleLattice,
    meshHeight,
    forestAt,
    relief,
    forbidden,
    fieldIncluded,
    decorate,
    waterDepth,
    riverDist,
    patchwork,
  }
}

/* ---------- sky ---------- */

/**
 * Aerial perspective: the authored land stays crisp (near follows the camera distance as the
 * shipped FogFollow does) and the outer rings dissolve into the sky by 1.6 km. Night fogs earlier:
 * the sky is dark but lit meadow is not, so the far ground would otherwise sit as a lighter
 * plateau above the dark horizon.
 *
 * The far distance eases in with the camera pitch: above 32° (the stations look down 34–40°) the
 * horizon is out of frame and the shipped fog is kept exactly, so the product overview is
 * unchanged; by 20° (the outward looks) the fog has stretched to the full reach. Tilting the
 * camera down thickens the air toward the horizon, which is how real aerial perspective behaves.
 */
export const ENDLESS_FOG = {
  day: { far: 1600 },
  night: { far: 1250 },
  /** Camera pitch (degrees above the ground plane) where the far fog is fully in / fully the shipped one. */
  pitchFull: 20,
  pitchOff: 32,
} as const

export function endlessFog(cameraDistance: number, night: boolean, pitchDeg = 0): { near: number; far: number } {
  const reach = night ? ENDLESS_FOG.night.far : ENDLESS_FOG.day.far
  const shipped = cameraDistance * 2.8
  const k = 1 - smoothstep(ENDLESS_FOG.pitchFull, ENDLESS_FOG.pitchOff, pitchDeg)
  return { near: cameraDistance * 1.4, far: lerp(shipped, Math.max(shipped, reach), k) }
}
