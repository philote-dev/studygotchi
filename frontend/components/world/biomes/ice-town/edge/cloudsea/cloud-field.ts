/**
 * Cloud sea (edge technique `cloudsea`): pure helpers, no three.js.
 *
 * The ice land becomes a high plateau above an inversion layer. Past every authored coast the
 * water stays open for `coastClear` metres, then a faceted deck of cloud lobes rises from under the
 * surface to a cloud horizon, with big far peaks and a sister plateau poking through it. Everything
 * here is deterministic from the layout and the seed so the lab's captures are repeatable.
 *
 * Coordinates as in the layout: x east, z south, y up, metres. Bearings are measured from +z
 * (south) toward +x, like the camera azimuths.
 */
import { type BiomeLayout, ICE_TOWN_PALETTE as P, mountainProfile, seeded } from '../../layout/biome-layout'
import { hash2 } from '../../layout/geometry'
import { fbm, mountainPeaks, sampleTerrain, smoothstep } from '../../layout/terrain'
import type { SkyGrade } from '../../scene/sky-blend'

export const CLOUD_SEA = {
  /** Open water inside this distance from every authored coast: the cloud crests stay under the surface. */
  coastClear: 60,
  /** Deck rings run from under the land out past the fog horizon as seen from any camera-box corner. */
  innerRadius: 40,
  outerRadius: 2600,
  sectors: 192,
  ringRatio: 1.06,
  /** Camera reach: the free look box (±150 m) dilated by the 380 m maximum orbit distance. */
  lookBoxHalf: 150,
  cameraRange: 380,
  /** The camera box floor; the deck stays `cameraClearance` under it inside the reach. */
  cameraFloor: 10,
  cameraClearance: 1.4,
  /** Instanced heads inside the reach keep their storm-lifted, swollen, heaving tops under this. */
  headCeiling: 9.7,
  /** Unit dodecahedron: highest vertex (0.85) and how deep a head sinks into the deck (fraction of sy). */
  headTop: 0.85,
  headSink: 0.15,
  headBobMax: 0.3,
  /** Heads begin where the first lobes break the surface. */
  headOffshore: 105,
  headCount: 420,
  /** The cloud front: a dense bank of puffs where the deck itself clears the water. */
  frontBand: [170, 330] as readonly [number, number],
  frontCount: 360,
  /** The cloud line wanders this far (±) around the coast-parallel offset, past the clearance band. */
  coastWander: 70,
  /** Outside the plate the deck climbs within ~100 m whatever the coast distance (no corner-sea holes). */
  plateExitGain: 3,
  /**
   * Beyond a plate cut (where the back land is sliced by the plate edge) the deck behaves as if this
   * far offshore, growing at `cutDepthGain` per metre so it stays under the camera floor in reach.
   */
  cutOffshore: 300,
  cutDepthGain: 0.65,
  cutFeather: 50,
  /** Storm: the whole deck lifts and the heads swell. */
  stormLift: 0.8,
  stormGrow: 1.18,
  /** Head heave amplitude multiplies by (1 + stormBob·storm). */
  stormBob: 1,
  fog: {
    day: { near: 280, far: 1900 },
    night: { near: 240, far: 1500 },
    storm: { near: 160, far: 760 },
  },
  sky: { day: '#d7e0ec', night: '#1e2346' },
  colours: {
    /** A touch of blue so the ramp's shade step on a puff reads blue-grey, not concrete. */
    cloudDay: '#f2f6fc',
    cloudNight: '#8a93b8',
    cloudStorm: '#78849f',
    /** Shaded cloud troughs, relative to the crest colour. */
    troughTint: '#7f98b8',
    peakFace: '#a3adca',
    peakCap: P.snow,
    plateauTop: P.snow,
    plateauSide: P.cliffIce,
    plateauRock: P.rock,
    wallCap: P.snow,
    wallFace: P.cliffIce,
    wallDeep: P.rockDeep,
    light: P.light,
  },
} as const

/* ---------- colours ---------- */

export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function mixRgb(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/* ---------- coast model ---------- */

export type PlateEdge = 'north' | 'south' | 'west' | 'east'

export interface CutRun {
  edge: PlateEdge
  /** Lateral coordinate along the edge (x for north / south, z for west / east). */
  from: number
  to: number
  step: number
  /** Terrain height at the plate edge for each lateral sample from `from` to `to`. */
  heights: number[]
}

export interface CoastModel {
  extent: number
  cell: number
  cols: number
  seaLevel: number
  /** 1 where the authored terrain is not sea (land, ice shelf, lake, river). */
  land: Uint8Array
  /** Centres of land cells that touch a sea cell inside the plate: the authored coast ring, [x, z, ...]. */
  coast: Float32Array
  /** Land runs along the plate boundary: the terrain is cut there, not coasted. */
  cuts: CutRun[]
}

function edgePoint(edge: PlateEdge, extent: number, t: number): [number, number] {
  const inset = extent - 0.01
  switch (edge) {
    case 'north':
      return [t, -inset]
    case 'south':
      return [t, inset]
    case 'west':
      return [-inset, t]
    case 'east':
      return [inset, t]
  }
}

export function buildCoastModel(layout: BiomeLayout, cell = 4): CoastModel {
  const extent = layout.worldExtent
  const cols = Math.round((2 * extent) / cell)
  const at = (i: number) => -extent + (i + 0.5) * cell
  const land = new Uint8Array(cols * cols)
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < cols; i++) {
      land[i + j * cols] = sampleTerrain(layout, at(i), at(j)).material !== 'sea' ? 1 : 0
    }
  }
  const coast: number[] = []
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < cols; i++) {
      if (!land[i + j * cols]) continue
      const sea =
        (i > 0 && !land[i - 1 + j * cols]) ||
        (i < cols - 1 && !land[i + 1 + j * cols]) ||
        (j > 0 && !land[i + (j - 1) * cols]) ||
        (j < cols - 1 && !land[i + (j + 1) * cols])
      if (sea) coast.push(at(i), at(j))
    }
  }

  // Plate cuts: sample each boundary with the tallest range so the wall never sits under the terrain.
  const profile = mountainProfile(1)
  const peaks = mountainPeaks(layout, profile)
  const step = 2
  const cuts: CutRun[] = []
  for (const edge of ['north', 'south', 'west', 'east'] as const) {
    let run: { from: number; heights: number[] } | null = null
    let gap = 0
    const close = () => {
      if (!run) return
      // Drop the trailing sea samples that were allowed as a gap.
      const heights = run.heights.slice(0, run.heights.length - gap)
      if (heights.length >= 3) cuts.push({ edge, from: run.from, to: run.from + (heights.length - 1) * step, step, heights })
      run = null
      gap = 0
    }
    for (let t = -extent; t <= extent + 1e-6; t += step) {
      const [x, z] = edgePoint(edge, extent, t)
      const s = sampleTerrain(layout, x, z, profile, peaks)
      const isLandHere = s.material !== 'sea'
      if (isLandHere) {
        if (!run) run = { from: t, heights: [] }
        run.heights.push(Math.max(layout.seaLevel, s.height))
        gap = 0
      } else if (run) {
        gap++
        run.heights.push(layout.seaLevel)
        if (gap > 1) close()
      }
    }
    close()
  }
  return { extent, cell, cols, seaLevel: layout.seaLevel, land, coast: Float32Array.from(coast), cuts }
}

export function isLand(model: CoastModel, x: number, z: number): boolean {
  const e = model.extent
  if (x <= -e || x >= e || z <= -e || z >= e) return false
  const i = Math.min(model.cols - 1, Math.floor((x + e) / model.cell))
  const j = Math.min(model.cols - 1, Math.floor((z + e) / model.cell))
  return model.land[i + j * model.cols] === 1
}

/** Distance to the nearest authored coast cell (metres). */
export function coastDistance(model: CoastModel, x: number, z: number): number {
  const coast = model.coast
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < coast.length; i += 2) {
    const dx = coast[i] - x
    const dz = coast[i + 1] - z
    const d2 = dx * dx + dz * dz
    if (d2 < best) best = d2
  }
  return Math.sqrt(best)
}

/** How much a point outside the plate sits in the shadow of a cut (0–1) and how far beyond the edge it is. */
export function cutShadow(model: CoastModel, x: number, z: number): { k: number; depth: number } {
  const e = model.extent
  let k = 0
  let depth = 0
  for (const run of model.cuts) {
    let lateral: number
    let beyond: number
    switch (run.edge) {
      case 'north':
        lateral = x
        beyond = -e - z
        break
      case 'south':
        lateral = x
        beyond = z - e
        break
      case 'west':
        lateral = z
        beyond = -e - x
        break
      case 'east':
        lateral = z
        beyond = x - e
        break
    }
    if (beyond <= 0) continue
    const outside = lateral < run.from ? run.from - lateral : lateral > run.to ? lateral - run.to : 0
    const rk = 1 - outside / CLOUD_SEA.cutFeather
    if (rk > k) {
      k = rk
      depth = beyond
    }
  }
  return { k: Math.max(0, Math.min(1, k)), depth }
}

/**
 * Distance offshore the cloud deck responds to: the true coast distance, except behind a plate cut
 * where the deck starts as if `cutOffshore` metres out, so the sliced back land meets cloud, not water.
 */
export function effectiveOffshore(model: CoastModel, x: number, z: number): number {
  let d = coastDistance(model, x, z)
  // Past the clearance band the cloud line wanders (a long swell plus a ragged 20 m edge) so it is
  // not a parallel offset of the coast.
  const wander = smoothstep(CLOUD_SEA.coastClear, CLOUD_SEA.coastClear + 70, d)
  d += wander * (CLOUD_SEA.coastWander * fbm(x * 0.012 + 3.1, z * 0.012 - 1.7) + 24 * fbm(x * 0.045 - 2.2, z * 0.045 + 4.4))
  // Outside the plate the sea floor and floes end; the deck must be up within ~100 m, along a
  // front that wanders rather than tracing the plate's straight boundary.
  const e = model.extent
  const beyond = Math.max(0, Math.abs(x) - e, Math.abs(z) - e)
  if (beyond > 0) {
    const front = beyond + 90 * fbm(x * 0.007 + 9.3, z * 0.007 - 4.1)
    d = Math.max(d, Math.min(CLOUD_SEA.cutOffshore, CLOUD_SEA.coastClear + CLOUD_SEA.plateExitGain * Math.max(0, front)))
  }
  const shadow = cutShadow(model, x, z)
  if (shadow.k <= 0) return d
  const shadowed = Math.max(d, CLOUD_SEA.cutOffshore + shadow.depth * CLOUD_SEA.cutDepthGain)
  return d + (shadowed - d) * shadow.k
}

/** Whether the lab camera can sit over this point: within `cameraRange` of the free look box. */
export function withinCameraReach(x: number, z: number): boolean {
  const dx = Math.max(0, Math.abs(x) - CLOUD_SEA.lookBoxHalf)
  const dz = Math.max(0, Math.abs(z) - CLOUD_SEA.lookBoxHalf)
  return Math.hypot(dx, dz) <= CLOUD_SEA.cameraRange
}

/* ---------- rise profile ---------- */

/** Lowest cloud surface (between the lobes) at an offshore distance. Under the water until ~250 m. */
export function cloudTrough(d: number): number {
  return -3 + 4 * smoothstep(60, 340, d) + smoothstep(340, 500, d) + 5 * smoothstep(560, 1300, d)
}

/**
 * Lobe height above the trough: flat while the deck is still under the water (the heads do the
 * emerging), chunky once it has cleared, chunkier toward the horizon.
 */
export function cloudAmplitude(d: number): number {
  return 0.6 + 5.9 * smoothstep(200, 520, d) + 7 * smoothstep(560, 1800, d)
}

/** Top of the tallest lobe at an offshore distance. */
export function cloudCrest(d: number): number {
  return cloudTrough(d) + cloudAmplitude(d)
}

/* ---------- lobes ---------- */

/**
 * Log-polar Worley domes: one feature point per cell of (angle, ln r), so the lobes scale with the
 * distance from the origin and the deck's ring resolution. 1 on a crest, 0 in the gaps between.
 */
function lobeOctave(x: number, z: number, r: number, cells: number, seed: number): number {
  const dTh = (Math.PI * 2) / cells
  const u = Math.atan2(z, x) / dTh
  const v = Math.log(r) / dTh
  const i0 = Math.floor(u)
  const j0 = Math.floor(v)
  let best = Number.POSITIVE_INFINITY
  let amp = 1
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = i0 + di
      const j = j0 + dj
      const wi = ((i % cells) + cells) % cells
      const h1 = hash2(wi * 7.31 + seed * 0.37, j * 3.17 + seed * 0.11)
      const h2 = hash2(wi * 2.93 - seed * 0.23, j * 9.71 + seed * 0.05)
      const angle = (i + 0.15 + 0.7 * h1) * dTh
      const radius = Math.exp((j + 0.15 + 0.7 * h2) * dTh)
      const fx = Math.cos(angle) * radius
      const fz = Math.sin(angle) * radius
      const dist = Math.hypot(x - fx, z - fz) / (r * dTh)
      if (dist < best) {
        best = dist
        amp = 0.55 + 0.45 * hash2(wi * 1.37 + seed * 0.19, j * 5.93 - seed * 0.07)
      }
    }
  }
  const dome = Math.max(0, 1 - (best / 0.82) ** 2)
  return Math.pow(dome, 1.1) * amp
}

/** Lobe crest factor 0–1 at a point: big domes with a finer crumble on top, riding a long swell. */
export function lobeField(x: number, z: number, seed: number): number {
  const r = Math.hypot(x, z)
  if (r < 1) return 0
  const domes = (lobeOctave(x, z, r, 64, seed) + 0.3 * lobeOctave(x, z, r, 150, seed + 17)) / 1.3
  const swell = 0.55 + 0.45 * lobeOctave(x, z, r, 22, seed + 5)
  return Math.min(1, domes * swell * 1.15)
}

export interface CloudSample {
  height: number
  /** 0 in a gap between lobes, 1 on a crest. */
  bump: number
  offshore: number
}

/** The cloud deck surface at a point. Under the land (and the open-water band) it hides below the sea floor. */
export function cloudTop(model: CoastModel, x: number, z: number, seed: number): CloudSample {
  const offshore = effectiveOffshore(model, x, z)
  const bump = lobeField(x, z, seed)
  let height = cloudTrough(offshore) + cloudAmplitude(offshore) * bump
  if (isLand(model, x, z)) height = Math.min(height, model.seaLevel - 1.6)
  return { height, bump, offshore }
}

/* ---------- mesh data ---------- */

export interface MeshData {
  positions: Float32Array
  indices: Uint32Array
  /** One rgb per triangle, in index order. */
  faceColors: Float32Array
  triangles: number
}

export interface DeckMesh extends MeshData {
  rings: number
  innerRing: number
  outerRing: number
}

function faceNormalY(p: Float32Array, a: number, b: number, c: number): number {
  const ax = p[a * 3]
  const ay = p[a * 3 + 1]
  const az = p[a * 3 + 2]
  const ux = p[b * 3] - ax
  const uy = p[b * 3 + 1] - ay
  const uz = p[b * 3 + 2] - az
  const vx = p[c * 3] - ax
  const vy = p[c * 3 + 1] - ay
  const vz = p[c * 3 + 2] - az
  return uz * vx - ux * vz
}

/** Day key light direction (scene/Terrain.tsx DAY_LIGHT), for the baked facet steps. */
const DAY_LIGHT = (() => {
  const len = Math.hypot(60, 90, 70)
  return [60 / len, 90 / len, 70 / len] as const
})()
const FACET_STEPS = [1.0, 0.86, 0.7] as const

/** Three-step facet light from the face normal (whatever its winding) against the day key light. */
function facetLight(p: Float32Array, a: number, b: number, c: number): number {
  const ax = p[a * 3]
  const ay = p[a * 3 + 1]
  const az = p[a * 3 + 2]
  const ux = p[b * 3] - ax
  const uy = p[b * 3 + 1] - ay
  const uz = p[b * 3 + 2] - az
  const vx = p[c * 3] - ax
  const vy = p[c * 3 + 1] - ay
  const vz = p[c * 3 + 2] - az
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz) || 1
  if (ny < 0) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  const ndl = (nx * DAY_LIGHT[0] + ny * DAY_LIGHT[1] + nz * DAY_LIGHT[2]) / len
  return ndl > 0.74 ? FACET_STEPS[0] : ndl > 0.6 ? FACET_STEPS[1] : FACET_STEPS[2]
}

/** Push a triangle wound so its normal points along `outward` (the side the camera sees). */
function pushFace(indices: number[], colours: number[], p: Float32Array, a: number, b: number, c: number, colour: Rgb, outward: (a: number, b: number, c: number) => number) {
  if (outward(a, b, c) < 0) indices.push(a, c, b)
  else indices.push(a, b, c)
  colours.push(colour[0], colour[1], colour[2])
}

/**
 * The cloud deck: a polar grid of `sectors` × log-spaced rings, every vertex on the cloud surface,
 * jittered so no seam is radial, coloured per facet from white crests to blue-grey gaps.
 */
export function buildDeck(layout: BiomeLayout, model: CoastModel, seed: number): DeckMesh {
  const { innerRadius, outerRadius, sectors, ringRatio } = CLOUD_SEA
  const rings = Math.ceil(Math.log(outerRadius / innerRadius) / Math.log(ringRatio)) + 1
  const positions = new Float32Array(rings * sectors * 3)
  const bumps = new Float32Array(rings * sectors)
  const dTheta = (Math.PI * 2) / sectors
  let innerRing = Number.POSITIVE_INFINITY
  let outerRing = 0
  for (let k = 0; k < rings; k++) {
    const base = Math.min(outerRadius, innerRadius * Math.pow(ringRatio, k))
    const band = base * (ringRatio - 1)
    const last = k === rings - 1
    for (let s = 0; s < sectors; s++) {
      const index = k * sectors + s
      const j1 = hash2(k * 3.7 + seed * 0.013, s * 1.9)
      const j2 = hash2(s * 7.1 - seed * 0.017, k * 2.3)
      const angle = (s + (j1 - 0.5) * 0.6) * dTheta
      // The outer ring never jitters inward so the fog horizon is covered from every camera.
      const r = last ? base + j2 * band * 0.3 : base + (j2 - 0.5) * band * 0.5
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const top = cloudTop(model, x, z, seed)
      positions[index * 3] = x
      positions[index * 3 + 1] = top.height
      positions[index * 3 + 2] = z
      bumps[index] = top.bump
      innerRing = Math.min(innerRing, r)
      outerRing = Math.max(outerRing, r)
    }
  }
  const indices: number[] = []
  const colours: number[] = []
  const white: Rgb = [1, 1, 1]
  const trough = hexToRgb(CLOUD_SEA.colours.troughTint)
  // Facet light baked into the albedo, as the range does: the pale deck blows out under the key
  // light and the ramp, so lit / half / shade steps live in the colour where fog cannot flatten them.
  const tint = (a: number, b: number, c: number): Rgb => {
    const bump = (bumps[a] + bumps[b] + bumps[c]) / 3
    const base = mixRgb(trough, white, smoothstep(0.15, 0.9, bump))
    const step = facetLight(positions, a, b, c)
    return [base[0] * step, base[1] * step, base[2] * step]
  }
  const up = (a: number, b: number, c: number) => faceNormalY(positions, a, b, c)
  for (let k = 0; k < rings - 1; k++) {
    for (let s = 0; s < sectors; s++) {
      const s1 = (s + 1) % sectors
      const a = k * sectors + s
      const b = k * sectors + s1
      const c = (k + 1) * sectors + s1
      const d = (k + 1) * sectors + s
      if (hash2(k * 1.3, s * 0.7 + seed * 0.01) < 0.5) {
        pushFace(indices, colours, positions, a, b, c, tint(a, b, c), up)
        pushFace(indices, colours, positions, a, c, d, tint(a, c, d), up)
      } else {
        pushFace(indices, colours, positions, a, b, d, tint(a, b, d), up)
        pushFace(indices, colours, positions, b, c, d, tint(b, c, d), up)
      }
    }
  }
  return {
    positions,
    indices: Uint32Array.from(indices),
    faceColors: Float32Array.from(colours),
    triangles: indices.length / 3,
    rings,
    innerRing,
    outerRing,
  }
}

/* ---------- heads ---------- */

export interface CloudHead {
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
  yaw: number
  phase: number
  rate: number
  /** Lateral sway along the storm wind, metres. */
  sway: number
  /** Vertical heave, metres. */
  bob: number
}

/**
 * Big faceted cloud heads riding the deck's crests: denser near the coast, larger farther out, and
 * capped inside the camera reach so the lowest lab camera never enters one.
 */
export function scatterHeads(model: CoastModel, seed: number, count = CLOUD_SEA.headCount, frontCount = CLOUD_SEA.frontCount): CloudHead[] {
  const rng = seeded(seed * 13 + 101)
  const out: CloudHead[] = []
  const lnNear = Math.log(130)
  const lnFar = Math.log(1500)
  const { headTop, headSink, headBobMax, headCeiling, stormLift, stormGrow, stormBob, frontBand } = CLOUD_SEA
  // In the storm the deck lifts, the head swells about its origin and heaves harder; the top must still clear the floor.
  const stormRise = headTop * stormGrow - headSink
  const stormExtra = stormLift + headBobMax * (1 + stormBob)
  const place = (x: number, z: number, size: number, spacingK: number): boolean => {
    if (isLand(model, x, z)) return false
    const top = cloudTop(model, x, z, seed)
    if (top.offshore < CLOUD_SEA.headOffshore) return false
    if (top.bump < 0.2) return false
    let sy = 0.5 * size
    if (withinCameraReach(x * 0.93, z * 0.93)) {
      sy = Math.min(sy, (headCeiling - stormExtra - top.height) / stormRise)
      if (sy < 0.1 * size) return false
    }
    const spacing = size * spacingK
    if (out.some((h) => Math.hypot(h.x - x, h.z - z) < spacing + h.sx * 0.8)) return false
    out.push({
      x,
      y: top.height - headSink * sy,
      z,
      sx: size * 0.5,
      sy,
      sz: size * 0.5 * (0.8 + 0.45 * rng()),
      yaw: rng() * Math.PI * 2,
      phase: rng() * Math.PI * 2,
      rate: 0.08 + 0.07 * rng(),
      sway: 2 + 3 * rng(),
      bob: 0.15 + (headBobMax - 0.15) * rng(),
    })
    return true
  }
  // The open field: uniform in ln r, so every distance band gets the same share of heads.
  let placed = 0
  for (let attempt = 0; attempt < count * 14 && placed < count; attempt++) {
    const r = Math.exp(lnNear + (lnFar - lnNear) * rng())
    const angle = rng() * Math.PI * 2
    const sizeJitter = 0.7 + 0.6 * rng()
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const offshore = effectiveOffshore(model, x, z)
    if (place(x, z, (8 + 0.03 * offshore) * sizeJitter, 0.42)) placed++
  }
  // The front: a tight bank of puffs along the line where the deck clears the water.
  placed = 0
  for (let attempt = 0; attempt < frontCount * 24 && placed < frontCount; attempt++) {
    const r = 160 + rng() * 420
    const angle = rng() * Math.PI * 2
    const sizeJitter = 0.8 + 0.5 * rng()
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const offshore = effectiveOffshore(model, x, z)
    if (offshore < frontBand[0] || offshore > frontBand[1]) continue
    if (place(x, z, 14 * sizeJitter, 0.3)) placed++
  }
  return out
}

/* ---------- the beyond: far peaks and the sister plateau ---------- */

export interface FarPeak {
  x: number
  z: number
  height: number
  radius: number
  shoulders: Array<{ dx: number; dz: number; height: number; radius: number }>
  observatory: boolean
}

/** Bearings from +z toward +x (north = 180°). Four look north-west where the low-horizon pose can find them. */
const FAR_PEAK_TABLE: Array<{ bearing: number; distance: number; height: number; observatory?: boolean }> = [
  { bearing: 200, distance: 1000, height: 110 },
  { bearing: 222, distance: 760, height: 82, observatory: true },
  { bearing: 236, distance: 1450, height: 150 },
  { bearing: 290, distance: 900, height: 95 },
  { bearing: 150, distance: 1300, height: 120 },
  { bearing: 95, distance: 1550, height: 100 },
  { bearing: 35, distance: 1250, height: 85 },
]

export function farPeaks(seed: number): FarPeak[] {
  const rng = seeded(seed * 5 + 3)
  return FAR_PEAK_TABLE.map((row) => {
    const bearing = ((row.bearing + (rng() - 0.5) * 12) * Math.PI) / 180
    const distance = Math.min(1600, Math.max(700, row.distance * (0.94 + rng() * 0.12)))
    const height = row.height * (0.9 + rng() * 0.2)
    const radius = height * (1.15 + rng() * 0.35)
    const n = 2 + (rng() < 0.5 ? 1 : 0)
    const shoulders: FarPeak['shoulders'] = []
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2 + rng() * 1.5
      const d = radius * (0.45 + rng() * 0.25)
      shoulders.push({ dx: Math.cos(a) * d, dz: Math.sin(a) * d, height: height * (0.4 + rng() * 0.22), radius: radius * (0.45 + rng() * 0.2) })
    }
    return { x: Math.sin(bearing) * distance, z: Math.cos(bearing) * distance, height, radius, shoulders, observatory: row.observatory ?? false }
  })
}

export interface SisterPlateau {
  x: number
  z: number
  top: number
  /** Top polygon, world x/z, with a height per vertex. */
  outline: Array<[number, number, number]>
  /** Base polygon at the cloud floor, world x/z. */
  base: Array<[number, number]>
  floor: number
  /** Window lights for the night, world x/y/z. */
  lights: Array<[number, number, number]>
}

/** A flat-topped mesa far off to the west: the place you cannot reach. */
export function sisterPlateau(seed: number): SisterPlateau {
  const rng = seeded(seed * 7 + 29)
  const bearing = ((262 + (rng() - 0.5) * 8) * Math.PI) / 180
  const distance = 1150 * (0.96 + rng() * 0.08)
  const x = Math.sin(bearing) * distance
  const z = Math.cos(bearing) * distance
  const top = 34
  const n = 10
  const outline: SisterPlateau['outline'] = []
  const base: SisterPlateau['base'] = []
  // Elongated along the tangent so it reads as a long shore from the land.
  const tx = Math.cos(bearing)
  const tz = -Math.sin(bearing)
  const nx = Math.sin(bearing)
  const nz = Math.cos(bearing)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const along = Math.cos(a) * (200 + (rng() - 0.5) * 50)
    const across = Math.sin(a) * (115 + (rng() - 0.5) * 36)
    const px = x + tx * along + nx * across
    const pz = z + tz * along + nz * across
    outline.push([px, top + (rng() - 0.5) * 6, pz])
    base.push([x + (tx * along + nx * across) * 1.28, z + (tz * along + nz * across) * 1.28])
  }
  const lights: SisterPlateau['lights'] = []
  for (let i = 0; i < 3; i++) lights.push([x + tx * (rng() - 0.5) * 160, top + 2, z + tz * (rng() - 0.5) * 160])
  return { x, z, top, outline, base, floor: -8, lights }
}

/** Faceted cone with a jagged rim: rings at the base (under the cloud), a flared mid-ring, the snow line and the apex. */
function pushCone(
  positions: number[],
  indices: number[],
  colours: number[],
  cx: number,
  cz: number,
  height: number,
  radius: number,
  rng: () => number,
  face: Rgb,
  cap: Rgb,
  floor: number,
) {
  const segments = 9
  const snowLine = 0.6
  const ringSpecs: Array<{ y: number; r: number }> = [
    { y: floor, r: radius },
    { y: height * 0.42, r: radius * 0.52 },
    { y: height * snowLine, r: radius * 0.32 },
  ]
  const rings: number[][] = []
  for (const spec of ringSpecs) {
    const ring: number[] = []
    for (let s = 0; s < segments; s++) {
      const a = ((s + (rng() - 0.5) * 0.3) / segments) * Math.PI * 2
      const r = spec.r * (0.86 + rng() * 0.28)
      ring.push(positions.length / 3)
      positions.push(cx + Math.cos(a) * r, spec.y + (rng() - 0.5) * height * 0.05, cz + Math.sin(a) * r)
    }
    rings.push(ring)
  }
  const apex = positions.length / 3
  positions.push(cx + (rng() - 0.5) * radius * 0.05, height, cz + (rng() - 0.5) * radius * 0.05)
  const p = Float32Array.from(positions)
  const outward = (a: number, b: number, c: number) => {
    // Normal should point away from the cone axis.
    const ax = p[a * 3]
    const az = p[a * 3 + 2]
    const ux = p[b * 3] - ax
    const uy = p[b * 3 + 1] - p[a * 3 + 1]
    const uz = p[b * 3 + 2] - az
    const vx = p[c * 3] - ax
    const vy = p[c * 3 + 1] - p[a * 3 + 1]
    const vz = p[c * 3 + 2] - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const mx = (p[a * 3] + p[b * 3] + p[c * 3]) / 3 - cx
    const mz = (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3 - cz
    return nx * mx + nz * mz + ny * 0.001
  }
  for (let level = 0; level < rings.length; level++) {
    const lower = rings[level]
    const colour = level === rings.length - 1 ? cap : face
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments
      if (level === rings.length - 1) {
        pushFace(indices, colours, p, lower[s], lower[s1], apex, colour, outward)
      } else {
        const upper = rings[level + 1]
        pushFace(indices, colours, p, lower[s], lower[s1], upper[s1], colour, outward)
        pushFace(indices, colours, p, lower[s], upper[s1], upper[s], colour, outward)
      }
    }
  }
}

/** Far peaks (with shoulders) and the sister plateau merged into one mesh. */
export function buildBeyondMesh(peaks: FarPeak[], plateau: SisterPlateau, seed: number): MeshData {
  const rng = seeded(seed * 11 + 7)
  const positions: number[] = []
  const indices: number[] = []
  const colours: number[] = []
  const face = hexToRgb(CLOUD_SEA.colours.peakFace)
  const cap = hexToRgb(CLOUD_SEA.colours.peakCap)
  for (const peak of peaks) {
    pushCone(positions, indices, colours, peak.x, peak.z, peak.height, peak.radius, rng, face, cap, -8)
    for (const sh of peak.shoulders) pushCone(positions, indices, colours, peak.x + sh.dx, peak.z + sh.dz, sh.height, sh.radius, rng, face, cap, -8)
  }
  // Plateau: a top fan and sloped sides, with two low hills on top.
  const topColour = hexToRgb(CLOUD_SEA.colours.plateauTop)
  const side = hexToRgb(CLOUD_SEA.colours.plateauSide)
  const rock = hexToRgb(CLOUD_SEA.colours.plateauRock)
  const n = plateau.outline.length
  const centre = positions.length / 3
  positions.push(plateau.x, plateau.top + 1.5, plateau.z)
  const topRing: number[] = []
  const baseRing: number[] = []
  for (let i = 0; i < n; i++) {
    topRing.push(positions.length / 3)
    positions.push(plateau.outline[i][0], plateau.outline[i][1], plateau.outline[i][2])
  }
  for (let i = 0; i < n; i++) {
    baseRing.push(positions.length / 3)
    positions.push(plateau.base[i][0], plateau.floor, plateau.base[i][1])
  }
  const p = Float32Array.from(positions)
  const up = (a: number, b: number, c: number) => faceNormalY(p, a, b, c)
  const away = (a: number, b: number, c: number) => {
    const ax = p[a * 3]
    const az = p[a * 3 + 2]
    const ux = p[b * 3] - ax
    const uy = p[b * 3 + 1] - p[a * 3 + 1]
    const uz = p[b * 3 + 2] - az
    const vx = p[c * 3] - ax
    const vy = p[c * 3 + 1] - p[a * 3 + 1]
    const vz = p[c * 3 + 2] - az
    const nx = uy * vz - uz * vy
    const nz = ux * vy - uy * vx
    const mx = (p[a * 3] + p[b * 3] + p[c * 3]) / 3 - plateau.x
    const mz = (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3 - plateau.z
    return nx * mx + nz * mz
  }
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n
    pushFace(indices, colours, p, centre, topRing[i], topRing[i1], topColour, up)
    pushFace(indices, colours, p, topRing[i], baseRing[i], baseRing[i1], i % 2 ? side : rock, away)
    pushFace(indices, colours, p, topRing[i], baseRing[i1], topRing[i1], i % 2 ? rock : side, away)
  }
  for (let h = 0; h < 2; h++) {
    const ox = (rng() - 0.5) * 120
    const oz = (rng() - 0.5) * 70
    pushCone(positions, indices, colours, plateau.x + ox, plateau.z + oz, plateau.top + 12 + rng() * 6, 40 + rng() * 15, rng, face, cap, plateau.top - 2)
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), faceColors: Float32Array.from(colours), triangles: indices.length / 3 }
}

/* ---------- cliff wall under the plate cut ---------- */

/**
 * Where the back land is sliced by the plate edge, a faceted ice cliff drops from the terrain edge
 * into the cloud so the sliced plate never shows from the north. Strictly outside the plate.
 */
export function buildCutWall(layout: BiomeLayout, model: CoastModel, seed: number): MeshData {
  const e = model.extent
  const positions: number[] = []
  const indices: number[] = []
  const colours: number[] = []
  const cap = hexToRgb(CLOUD_SEA.colours.wallCap)
  const face = hexToRgb(CLOUD_SEA.colours.wallFace)
  const deep = hexToRgb(CLOUD_SEA.colours.wallDeep)
  const foot = mixRgb(face, hexToRgb(CLOUD_SEA.colours.troughTint), 0.6)
  const floor = Math.min(-7, cloudTrough(CLOUD_SEA.cutOffshore) - 4)
  for (const run of model.cuts) {
    // Outward direction for this edge (unit) and the lateral axis.
    const outward: [number, number] = run.edge === 'north' ? [0, -1] : run.edge === 'south' ? [0, 1] : run.edge === 'west' ? [-1, 0] : [1, 0]
    const place = (t: number, out: number): [number, number] =>
      run.edge === 'north' || run.edge === 'south' ? [t, outward[1] * (e + out)] : [outward[0] * (e + out), t]
    const count = run.heights.length
    const rows: number[][] = [[], [], [], []]
    for (let i = 0; i < count; i++) {
      const t = run.from + i * run.step
      const h = run.heights[i]
      const bulge = 1.5 + 3 * Math.abs(hash2(t * 0.37 + seed * 0.01, run.edge.length) - 0.5) * 2
      const jitter = (hash2(t * 0.91, seed * 0.03) - 0.5) * 0.8
      const levels: Array<{ y: number; out: number; lateral: number }> = [
        { y: h + 0.3, out: 0, lateral: t },
        { y: h - 0.9, out: 0.6, lateral: t + jitter * 0.3 },
        { y: (h + floor) * 0.5, out: 1.2 + bulge, lateral: t + jitter },
        { y: floor, out: 1.8 + bulge * 1.3, lateral: t + jitter * 0.6 },
      ]
      levels.forEach((level, row) => {
        const [x, z] = place(level.lateral, level.out)
        rows[row].push(positions.length / 3)
        positions.push(x, level.y, z)
      })
    }
    const p = Float32Array.from(positions)
    const facing = (a: number, b: number, c: number) => {
      const ax = p[a * 3]
      const ay = p[a * 3 + 1]
      const az = p[a * 3 + 2]
      const ux = p[b * 3] - ax
      const uy = p[b * 3 + 1] - ay
      const uz = p[b * 3 + 2] - az
      const vx = p[c * 3] - ax
      const vy = p[c * 3 + 1] - ay
      const vz = p[c * 3 + 2] - az
      const nx = uy * vz - uz * vy
      const nz = ux * vy - uy * vx
      return nx * outward[0] + nz * outward[1]
    }
    const rowColour: Rgb[] = [cap, face, mixRgb(face, deep, 0.35), foot]
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < count - 1; i++) {
        const a = rows[row][i]
        const b = rows[row][i + 1]
        const c = rows[row + 1][i + 1]
        const d = rows[row + 1][i]
        // Plain coast ice like the authored cliffs; only a faint per-facet variation, no stripes.
        const colour = row === 0 ? mixRgb(cap, face, 0.5) : rowColour[row + 1]
        const shade = mixRgb(colour, deep, hash2(i * 0.53, row + seed * 0.02) * 0.1)
        pushFace(indices, colours, p, a, b, c, shade, facing)
        pushFace(indices, colours, p, a, c, d, shade, facing)
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), faceColors: Float32Array.from(colours), triangles: indices.length / 3 }
}

/* ---------- sky ---------- */

/** Fog out to the cloud horizon; the storm stays close and dark. */
export function cloudSeaSky(grade: SkyGrade, context: { night: boolean; storm: boolean }): SkyGrade {
  if (context.storm) return { ...grade, fogNear: CLOUD_SEA.fog.storm.near, fogFar: Math.max(grade.fogFar, CLOUD_SEA.fog.storm.far) }
  if (context.night) return { ...grade, sky: CLOUD_SEA.sky.night, fogNear: CLOUD_SEA.fog.night.near, fogFar: CLOUD_SEA.fog.night.far }
  return { ...grade, sky: CLOUD_SEA.sky.day, fogNear: CLOUD_SEA.fog.day.near, fogFar: CLOUD_SEA.fog.day.far }
}
