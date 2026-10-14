/**
 * The authored ice plate as a pure build (2026-10-14, the cloud dive's hold):
 * the heightfield sampled on three's PlaneGeometry lattice, its vertex
 * normals, and the vertex colours, as typed arrays that are a deterministic
 * function of (layout, growth band, night). `scene/Terrain.tsx` used to do
 * all of this inside `useMemo` at mount (~1.4 s in development: 116 k
 * `sampleTerrain` calls); now the same arithmetic runs here, in the land
 * build Worker during the planet approach (`lib/world/land-build.ts`), or
 * synchronously where there is no Worker (SSR, tests), and the mesh is
 * assembled from the buffers. No React, no scene graph; `three` only for
 * `Color` (the colour maths must stay the renderer's) and the typed-array
 * attribute layout is the one `PlaneGeometry` + `rotateX(-π/2)` +
 * `computeVertexNormals` produce, so the mesh is the same mesh.
 */
import { Color, Vector3 } from 'three'
import { ICE_TOWN_PALETTE as P, type BiomeLayout, type MountainProfile, mountainProfile, mountainProfileForBand } from './biome-layout'
import { backFade, backFadeOnset, fbm, harbourShoreMask, mountainPeaks, overviewEase, rangeArcZ, sampleTerrain, type GroundMaterial } from './terrain'

/** Lattice segments per side of the authored plate (`scene/Terrain.tsx` SEGMENTS). */
export const TERRAIN_SEGMENTS = 340

/** Material codes in the typed arrays, in `GroundMaterial` order. */
export const GROUND_MATERIALS: readonly GroundMaterial[] = [
  'sea',
  'snow',
  'ice',
  'lake',
  'openWater',
  'rock',
  'mountain',
  'river',
  'riverBank',
  'ground',
  'groundAlt',
  'lawn',
  'paving',
  'water',
  'bank',
  'shore',
  'plinth',
]
const MATERIAL_CODE = new Map<GroundMaterial, number>(GROUND_MATERIALS.map((m, i) => [m, i]))

/**
 * The sampled plate: what the mesh needs besides its colours. Every array is per vertex
 * (position: xyz). `height` and `peakFrac` keep the sample's doubles: the colour pass compares
 * them against thresholds (the seam light, the waterline, the snow line) exactly as the sample
 * produced them; the position attribute holds the Float32 the mesh had.
 */
export interface TerrainGrid {
  segments: number
  extent: number
  band: number
  /** Vertex count, `(segments + 1)²`. */
  count: number
  position: Float32Array
  normal: Float32Array
  index: Uint32Array
  height: Float64Array
  /** `GROUND_MATERIALS` code. */
  material: Uint8Array
  peakFrac: Float64Array
  mountainRow: Uint8Array
}

/** The sampled fields alone (heights, material, peak fraction, row): what `sessionStorage` keeps; the lattice and normals are rebuilt from them. */
export interface TerrainFields {
  segments: number
  extent: number
  band: number
  height: Float64Array
  material: Uint8Array
  peakFrac: Float64Array
  mountainRow: Uint8Array
}

/** A band of lattice rows of the fields (`rowFrom` inclusive, `rowTo` exclusive): the Worker pool samples the plate in slices. */
export interface TerrainRows extends Omit<TerrainFields, 'band'> {
  band: number
  rowFrom: number
  rowTo: number
}

/** The mountain profile the plate is built with at a course fraction (`BiomeScene`: never below the 62 % range). */
export function terrainProfileFor(progress: number): MountainProfile {
  return mountainProfile(Math.max(0.62, Math.min(1, Math.max(0, progress))))
}

/** The one key of a plate's buffers: (layout, extent, lattice, band). `lib/world/land-build.ts` keys its cache with it. */
export function terrainGridKey(layout: BiomeLayout, band: number, segments = TERRAIN_SEGMENTS): string {
  return `terrain:${layout.id}:${layout.worldExtent}:${segments}:b${band}`
}

/* ---------- lattice (three's PlaneGeometry, rotated onto XZ) ---------- */

/**
 * The vertex (x, z) of `PlaneGeometry(2·extent, 2·extent, n, n)` after `rotateX(-π/2)`, in
 * Float32 as the attribute stores them: x runs west → east with `ix`, z north → south with `iy`.
 */
export function latticePosition(extent: number, segments: number, ix: number, iy: number): [number, number] {
  const cell = (2 * extent) / segments
  return [Math.fround(ix * cell - extent), Math.fround(iy * cell - extent)]
}

function latticeIndex(segments: number): Uint32Array {
  const n1 = segments + 1
  const index = new Uint32Array(segments * segments * 6)
  let k = 0
  for (let iy = 0; iy < segments; iy++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = ix + n1 * iy
      const b = ix + n1 * (iy + 1)
      const c = ix + 1 + n1 * (iy + 1)
      const d = ix + 1 + n1 * iy
      index[k++] = a
      index[k++] = b
      index[k++] = d
      index[k++] = b
      index[k++] = c
      index[k++] = d
    }
  }
  return index
}

const pA = new Vector3()
const pB = new Vector3()
const pC = new Vector3()
const cb = new Vector3()
const ab = new Vector3()

/**
 * `BufferGeometry.computeVertexNormals` for an indexed lattice, step for step (Float32 accumulation
 * through the attribute, `normalize` as `multiplyScalar(1 / length)`), so the normals are the ones
 * the mesh would have computed for itself.
 */
export function latticeNormals(position: Float32Array, index: Uint32Array): Float32Array {
  const normal = new Float32Array(position.length)
  for (let i = 0; i < index.length; i += 3) {
    const vA = index[i]
    const vB = index[i + 1]
    const vC = index[i + 2]
    pA.set(position[vA * 3], position[vA * 3 + 1], position[vA * 3 + 2])
    pB.set(position[vB * 3], position[vB * 3 + 1], position[vB * 3 + 2])
    pC.set(position[vC * 3], position[vC * 3 + 1], position[vC * 3 + 2])
    cb.subVectors(pC, pB)
    ab.subVectors(pA, pB)
    cb.cross(ab)
    for (const v of [vA, vB, vC]) {
      const o = v * 3
      normal[o] = normal[o] + cb.x
      normal[o + 1] = normal[o + 1] + cb.y
      normal[o + 2] = normal[o + 2] + cb.z
    }
  }
  for (let o = 0; o < normal.length; o += 3) {
    const x = normal[o]
    const y = normal[o + 1]
    const z = normal[o + 2]
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1)
    normal[o] = x * inv
    normal[o + 1] = y * inv
    normal[o + 2] = z * inv
  }
  return normal
}

/* ---------- heightfield ---------- */

/** Sample lattice rows `rowFrom` .. `rowTo` (exclusive) of the plate: one `sampleTerrain` per vertex, the heavy step. */
export function sampleTerrainRows(layout: BiomeLayout, profile: MountainProfile, rowFrom: number, rowTo: number, segments = TERRAIN_SEGMENTS): TerrainRows {
  const extent = layout.worldExtent
  const n1 = segments + 1
  const count = (rowTo - rowFrom) * n1
  const height = new Float64Array(count)
  const material = new Uint8Array(count)
  const peakFrac = new Float64Array(count)
  const mountainRow = new Uint8Array(count)
  const peaks = mountainPeaks(layout, profile)
  let i = 0
  for (let iy = rowFrom; iy < rowTo; iy++) {
    for (let ix = 0; ix < n1; ix++, i++) {
      const [x, z] = latticePosition(extent, segments, ix, iy)
      const s = sampleTerrain(layout, x, z, profile, peaks)
      height[i] = s.height
      material[i] = MATERIAL_CODE.get(s.material) ?? 0
      peakFrac[i] = s.peakFrac
      mountainRow[i] = s.mountainRow
    }
  }
  return { segments, extent, band: profile.band, rowFrom, rowTo, height, material, peakFrac, mountainRow }
}

/** Row slices (any order, covering every row once) back into the whole fields. */
export function mergeTerrainRows(parts: readonly TerrainRows[]): TerrainFields {
  if (parts.length === 0) throw new Error('mergeTerrainRows: no rows')
  const { segments, extent, band } = parts[0]
  const n1 = segments + 1
  const count = n1 * n1
  const fields: TerrainFields = { segments, extent, band, height: new Float64Array(count), material: new Uint8Array(count), peakFrac: new Float64Array(count), mountainRow: new Uint8Array(count) }
  let covered = 0
  for (const p of parts) {
    const at = p.rowFrom * n1
    fields.height.set(p.height, at)
    fields.material.set(p.material, at)
    fields.peakFrac.set(p.peakFrac, at)
    fields.mountainRow.set(p.mountainRow, at)
    covered += p.rowTo - p.rowFrom
  }
  if (covered !== n1) throw new Error(`mergeTerrainRows: ${covered} of ${n1} rows`)
  return fields
}

/** Even row ranges for `jobs` workers over the `segments + 1` lattice rows. */
export function terrainRowRanges(jobs: number, segments = TERRAIN_SEGMENTS): Array<[number, number]> {
  const n1 = segments + 1
  const k = Math.max(1, Math.min(jobs, n1))
  const out: Array<[number, number]> = []
  for (let j = 0; j < k; j++) out.push([Math.floor((j * n1) / k), Math.floor(((j + 1) * n1) / k)])
  return out
}

/** Sample the whole plate on the lattice (one `sampleTerrain` per vertex). */
export function sampleTerrainFields(layout: BiomeLayout, profile: MountainProfile, segments = TERRAIN_SEGMENTS): TerrainFields {
  const rows = sampleTerrainRows(layout, profile, 0, segments + 1, segments)
  return { segments: rows.segments, extent: rows.extent, band: rows.band, height: rows.height, material: rows.material, peakFrac: rows.peakFrac, mountainRow: rows.mountainRow }
}

/** The lattice positions and normals around sampled fields. */
export function gridFromFields(fields: TerrainFields): TerrainGrid {
  const { segments, extent } = fields
  const n1 = segments + 1
  const count = n1 * n1
  const position = new Float32Array(count * 3)
  let i = 0
  for (let iy = 0; iy < n1; iy++) {
    for (let ix = 0; ix < n1; ix++, i++) {
      const [x, z] = latticePosition(extent, segments, ix, iy)
      position[i * 3] = x
      position[i * 3 + 1] = fields.height[i]
      position[i * 3 + 2] = z
    }
  }
  const index = latticeIndex(segments)
  return {
    segments,
    extent,
    band: fields.band,
    count,
    position,
    normal: latticeNormals(position, index),
    index,
    height: fields.height,
    material: fields.material,
    peakFrac: fields.peakFrac,
    mountainRow: fields.mountainRow,
  }
}

export function buildTerrainGrid(layout: BiomeLayout, profile: MountainProfile, segments = TERRAIN_SEGMENTS): TerrainGrid {
  return gridFromFields(sampleTerrainFields(layout, profile, segments))
}

/** The sampled fields of a grid (for storage). */
export function fieldsOf(grid: TerrainGrid): TerrainFields {
  return { segments: grid.segments, extent: grid.extent, band: grid.band, height: grid.height, material: grid.material, peakFrac: grid.peakFrac, mountainRow: grid.mountainRow }
}

/* ---------- bytes (sessionStorage) ---------- */

const FIELDS_MAGIC = 0x4c414e44 // 'LAND'
const FIELDS_VERSION = 2
const HEADER_BYTES = 8 * 4

/** The fields as one buffer: a 32-byte header (magic, version, segments, extent, band, count) then height f64, peakFrac f64, material u8, row u8. */
export function fieldsToBytes(fields: TerrainFields): ArrayBuffer {
  const count = fields.height.length
  const bytes = new ArrayBuffer(HEADER_BYTES + count * 8 * 2 + count * 2)
  const header = new Uint32Array(bytes, 0, 8)
  header[0] = FIELDS_MAGIC
  header[1] = FIELDS_VERSION
  header[2] = fields.segments
  header[3] = fields.extent
  header[4] = fields.band
  header[5] = count
  let at = HEADER_BYTES
  new Float64Array(bytes, at, count).set(fields.height)
  at += count * 8
  new Float64Array(bytes, at, count).set(fields.peakFrac)
  at += count * 8
  new Uint8Array(bytes, at, count).set(fields.material)
  at += count
  new Uint8Array(bytes, at, count).set(fields.mountainRow)
  return bytes
}

/** `fieldsToBytes` back; null for anything that is not a current fields buffer (another version, truncated). */
export function fieldsFromBytes(bytes: ArrayBuffer): TerrainFields | null {
  if (bytes.byteLength < HEADER_BYTES) return null
  const header = new Uint32Array(bytes, 0, 8)
  if (header[0] !== FIELDS_MAGIC || header[1] !== FIELDS_VERSION) return null
  const [, , segments, extent, band, count] = header
  if (count !== (segments + 1) * (segments + 1) || bytes.byteLength !== HEADER_BYTES + count * 18) return null
  let at = HEADER_BYTES
  const height = new Float64Array(bytes.slice(at, at + count * 8))
  at += count * 8
  const peakFrac = new Float64Array(bytes.slice(at, at + count * 8))
  at += count * 8
  const material = new Uint8Array(bytes.slice(at, at + count))
  at += count
  const mountainRow = new Uint8Array(bytes.slice(at, at + count))
  return { segments, extent, band, height, material, peakFrac, mountainRow }
}

/* ---------- colours (scene/Terrain.tsx, verbatim on the arrays) ---------- */

/** Generic-world materials never occur on the Ice terrain; the world terrain mesh colours them from its palette. */
const WORLD_UNUSED = { ground: P.snow, groundAlt: P.snowShadow, lawn: P.snow, paving: P.paleIce, water: P.openWater, bank: P.riverBank, shore: P.rock, plinth: P.paleIce } as const

/** Plan §6: fewer, paler ground colours. Snow, pale ice, lavender rock, dark water; the river is the one teal. */
const GROUND: Record<GroundMaterial, string> = {
  sea: '#2a5474',
  snow: P.snow,
  ice: P.paleIce,
  lake: '#cfe3f1',
  openWater: P.openWater,
  rock: P.rock,
  mountain: P.snow,
  river: P.river,
  riverBank: P.riverBank,
  ...WORLD_UNUSED,
}

/** Steep faces: ice-blue at the coasts, lavender rock on the mountains and the outcrop. */
const STEEP: Record<GroundMaterial, string> = {
  sea: '#2a5474',
  snow: P.cliffIce,
  ice: P.cliffIce,
  lake: P.cliffIce,
  openWater: P.openWater,
  rock: P.rockDeep,
  mountain: P.rock,
  river: P.river,
  riverBank: P.riverBank,
  ...WORLD_UNUSED,
}
/** The harbour beach: a sloped shore keeps its snow instead of turning into cliff ice. */
const BEACH = '#e3ebf0'
/** Damp snow at the harbour waterline; the beach lerps toward it as it nears the sea. */
const WET_SNOW = new Color('#b9c9d6')
/** Cool blue-lavender for the range faces (ice-arch-horizon ref); caps stay snow. */
const MOUNTAIN_FACE = '#a3adca'
/** Shelf seams near the mainland read as a lighter crack, not a shadow. */
const SEAM_LIGHT = '#f7fafc'
/**
 * Facet shading baked into the range's vertex colours: the pale snow palette blows out under the
 * key light and the toon ramp, so the lit / half / shade steps are written into the albedo where
 * the fog and tone mapping cannot flatten them. Back rows are hazed toward the sky per row.
 */
const FACET_STEPS: [number, number, number] = [1, 0.86, 0.7]
const ROW_HAZE = [0, 0, 0.22, 0.42]
const DAY_LIGHT = new Vector3(60, 90, 70).normalize()
const NIGHT_LIGHT = new Vector3(-40, 60, 30).normalize()
const scratchCliff = new Color()

function facetStep(nx: number, ny: number, nz: number, light: Vector3): number {
  const ndl = nx * light.x + ny * light.y + nz * light.z
  return ndl > 0.62 ? FACET_STEPS[0] : ndl > 0.3 ? FACET_STEPS[1] : FACET_STEPS[2]
}

/** Faces steeper than this (normal y below cos 36.9°) take the steep colour. */
export const STEEP_NY = 0.8
/** Metres from the north plate edge inside which no face is ever painted as a coast cliff. */
export const NORTH_FRINGE_BAND = 6

/**
 * Whether a snow or ice face takes the coast's cliff-ice colour. Never behind the range: the back
 * land eases into the outer world there (see `backFade`), and a blue fringe along the north plate
 * edge would read as the plate's cut from any camera that orbits behind the mountains.
 */
export function cliffFace(layout: BiomeLayout, x: number, z: number, ny: number, material: GroundMaterial): boolean {
  return cliffAmount(layout, x, z, ny, material) >= 0.5
}

/**
 * How much of the coast's cliff-ice colour a steep snow or ice face takes: all of it where the
 * overview sees, fading to none with `overviewEase` so the ramped coasts outside the frame read as
 * snow slopes, and none at all behind the range.
 */
export function cliffAmount(layout: BiomeLayout, x: number, z: number, ny: number, material: GroundMaterial): number {
  if (ny >= STEEP_NY) return 0
  if (material !== 'snow' && material !== 'ice') return 0
  if (backColourZone(layout, x, z)) return 0
  return 1 - overviewEase(layout, x, z)
}

/**
 * Metres behind the range's centre line past which steep snow is painted as mountain snow, not
 * coast cliff: a little ahead of the heightfield's own onset (`backFadeOnset`), because the
 * mountains' north feet begin there and the overview sees that band only through the peaks in
 * front of it (`back-of-range.test.ts` checks this with occlusion).
 */
export function backColourBehind(x: number): number {
  return backFadeOnset(x) - 12
}

/** Where the colour pass treats the land as the back of the range (a superset of `backFade > 0`). */
export function backColourZone(layout: BiomeLayout, x: number, z: number): boolean {
  if (z < -layout.worldExtent + NORTH_FRINGE_BAND) return true
  if (backFade(layout, x, z) > 0) return true
  // Only under the range itself: past its ends the arc curves forward into the open coasts.
  return Math.abs(x) <= 112 && rangeArcZ(layout, x) - z > backColourBehind(x)
}

/** Vertex colours of a grid for day or night: rgb per vertex. */
export function colourTerrainGrid(layout: BiomeLayout, profile: MountainProfile, grid: TerrainGrid, night: boolean): Float32Array {
  const { position: pos, normal: normals, count } = grid
  const colors = new Float32Array(count * 3)
  const c = new Color()
  const haze = new Color(night ? P.skyNight : P.sky)
  const light = night ? NIGHT_LIGHT : DAY_LIGHT
  for (let i = 0; i < count; i++) {
    const material = GROUND_MATERIALS[grid.material[i]]
    const height = grid.height[i]
    const x = pos[i * 3]
    const z = pos[i * 3 + 2]
    const ny = normals[i * 3 + 1]
    const steep = ny < STEEP_NY
    if (material === 'mountain') {
      const cap = grid.peakFrac[i] >= profile.snowLine
      c.set(cap ? P.snow : steep ? MOUNTAIN_FACE : P.snowShadow)
      const step = facetStep(normals[i * 3], ny, normals[i * 3 + 2], light)
      // Caps keep more of their white on the shade side; rock faces take the full step.
      c.multiplyScalar(cap ? 0.55 + 0.45 * step : step)
      c.lerp(haze, ROW_HAZE[grid.mountainRow[i]])
    } else if (material === 'ice' && !steep && height < layout.shelfHeight - 0.2) {
      c.set(SEAM_LIGHT)
    } else if (steep && material === 'snow' && height > layout.seaLevel && harbourShoreMask(layout, x, z) > 0.5) {
      c.set(BEACH)
    } else if (material === 'snow' || material === 'ice') {
      // Steep snow where the overview cannot see is a slope into the outer world, not a coast cliff.
      if (steep) c.set(P.snowShadow).lerp(scratchCliff.set(STEEP[material]), cliffAmount(layout, x, z, ny, material))
      else c.set(GROUND[material])
    } else {
      c.set(steep ? STEEP[material] : GROUND[material])
    }
    // Ground variation (grammar §g): a few percent of lightness, never hue.
    const l = material === 'sea' || material === 'openWater' ? 0 : 0.02 * fbm(x * 0.08, z * 0.08) + 0.01 * fbm(x * 0.5, z * 0.5)
    c.offsetHSL(0, 0, l)
    // Harbour beach: a wet blue-grey gradient from the waterline up the incline, so the slope
    // reads even on flat-lit snow (fishing-village ref: darker, damp shore under the stilts).
    if (material === 'snow' && !steep) {
      const shore = harbourShoreMask(layout, x, z)
      if (shore > 0) {
        const wet = (1 - Math.min(1, Math.max(0, (height - layout.seaLevel) / 3.6))) * shore
        c.lerp(WET_SNOW, wet * 0.55)
      }
    }
    if (night && material !== 'mountain') c.offsetHSL(0.03, 0.05, -0.16)
    else if (night) c.offsetHSL(0.03, 0.05, -0.1)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  return colors
}

/** A grid with both its day and its night colours: what the land keeps per growth band (the theme can flip at rest). */
export interface TerrainMesh {
  grid: TerrainGrid
  day: Float32Array
  night: Float32Array
}

/** Normals and both colour passes around sampled fields (the Worker's finishing step; also the synchronous path). */
export function finishTerrainMesh(layout: BiomeLayout, fields: TerrainFields): TerrainMesh {
  const profile = mountainProfileForBand(fields.band)
  const grid = gridFromFields(fields)
  return { grid, day: colourTerrainGrid(layout, profile, grid, false), night: colourTerrainGrid(layout, profile, grid, true) }
}

/** Transferable buffers of a mesh (for `postMessage`). */
export function terrainMeshTransferables(mesh: TerrainMesh): ArrayBuffer[] {
  const g = mesh.grid
  const buffers = [g.position.buffer, g.normal.buffer, g.index.buffer, g.height.buffer, g.material.buffer, g.peakFrac.buffer, g.mountainRow.buffer, mesh.day.buffer, mesh.night.buffer] as ArrayBuffer[]
  return [...new Set(buffers)]
}

export function terrainFieldsTransferables(fields: TerrainFields | TerrainRows): ArrayBuffer[] {
  return [...new Set([fields.height.buffer, fields.material.buffer, fields.peakFrac.buffer, fields.mountainRow.buffer] as ArrayBuffer[])]
}
