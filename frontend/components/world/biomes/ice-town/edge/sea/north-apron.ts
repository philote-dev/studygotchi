import * as THREE from 'three'
import { ICE_TOWN_PALETTE as P, type BiomeLayout } from '../../layout/biome-layout'
import { fbm, sampleTerrain, smoothstep, type GroundMaterial } from '../../layout/terrain'

/**
 * North apron: the terrain plate cuts the back land (and the glacier shelf) in a straight line at
 * z = -worldExtent. The sea technique continues the authored heightfield past that line with the
 * same `sampleTerrain`, then ends it in a wobbling ice cliff 10–55 m further north so the land
 * meets the sea the way every other coast does. Row 0 shares the plate's edge vertices; when the
 * live terrain mesh is available its measured edge heights (which include the mountain tails the
 * profile-less sample lacks) replace the sampled ones and the correction fades out inland.
 */

/** Row offsets north of the plate edge, metres: dense at the shared edge, sparse toward the coast. */
export const APRON_ROWS: readonly number[] = [0, 1, 2, 3.5, 5.5, 8, 11, 15, 20, 26, 33, 41, 50, 60, 72]
/** The measured-edge correction fades out over this depth. */
export const APRON_EDGE_BLEND = 20
/** The back coast: a cliff `base ± wobble` metres north of the plate edge, `width` metres wide. */
export const APRON_CLIFF = { base: 34, wobble: 20, width: 3 } as const

const GROUND: Partial<Record<GroundMaterial, string>> = {
  sea: '#2a5474',
  snow: P.snow,
  ice: P.paleIce,
  rock: P.rock,
  mountain: P.snow,
  river: P.river,
  riverBank: P.riverBank,
  lake: '#cfe3f1',
  openWater: P.openWater,
}
const STEEP: Partial<Record<GroundMaterial, string>> = {
  sea: '#2a5474',
  snow: P.cliffIce,
  ice: P.cliffIce,
  rock: P.rockDeep,
  mountain: P.rock,
  river: P.river,
  riverBank: P.riverBank,
  lake: P.cliffIce,
  openWater: P.openWater,
}
const SEAM_LIGHT = '#f7fafc'

/** Depth north of the plate edge where the apron's coast cliff drops into the sea. */
export function apronCoastDepth(x: number): number {
  return APRON_CLIFF.base + fbm(x * 0.021 + 3.7, 2.9) * 2 * APRON_CLIFF.wobble + fbm(x * 0.09, 6.1) * 6
}

/** Heights along the plate edge (z = -extent) from the authored heightfield without the mountain profile. */
export function apronEdgeHeights(layout: BiomeLayout): Float32Array {
  const extent = layout.worldExtent
  const out = new Float32Array(extent * 2 + 1)
  for (let i = 0; i < out.length; i++) out[i] = sampleTerrain(layout, -extent + i, -extent).height
  return out
}

interface ApronSamples {
  heights: Float32Array
  materials: GroundMaterial[]
  edge: Float32Array
  seaFloor: number
}

const samplesCache = new WeakMap<BiomeLayout, ApronSamples>()

/** The authored heightfield over the apron grid, sampled once per layout (the expensive part). */
function apronSamples(layout: BiomeLayout): ApronSamples {
  const cached = samplesCache.get(layout)
  if (cached) return cached
  const extent = layout.worldExtent
  const columns = extent * 2 + 1
  const rows = APRON_ROWS.length
  const heights = new Float32Array(columns * rows)
  const materials: GroundMaterial[] = new Array(columns * rows)
  for (let row = 0; row < rows; row++) {
    const z = -extent - APRON_ROWS[row]
    for (let col = 0; col < columns; col++) {
      const sample = sampleTerrain(layout, -extent + col, z)
      heights[row * columns + col] = sample.height
      materials[row * columns + col] = sample.material
    }
  }
  const out = { heights, materials, edge: apronEdgeHeights(layout), seaFloor: sampleTerrain(layout, extent * 3, 0).height }
  samplesCache.set(layout, out)
  return out
}

export function buildApron(layout: BiomeLayout, night: boolean, measuredEdge: ArrayLike<number> | null): THREE.BufferGeometry {
  const extent = layout.worldExtent
  const columns = extent * 2 + 1
  const rows = APRON_ROWS.length
  const samples = apronSamples(layout)
  const seaFloor = samples.seaFloor
  const sampledEdge = samples.edge
  const positions = new Float32Array(columns * rows * 3)
  const materials: GroundMaterial[] = new Array(columns * rows)

  for (let row = 0; row < rows; row++) {
    const depth = APRON_ROWS[row]
    const z = -extent - depth
    const blend = 1 - smoothstep(0, APRON_EDGE_BLEND, depth)
    for (let col = 0; col < columns; col++) {
      const x = -extent + col
      const sample = { height: samples.heights[row * columns + col], material: samples.materials[row * columns + col] }
      const correction = measuredEdge ? (measuredEdge[col] - sampledEdge[col]) * blend : 0
      let height = sample.height + correction
      let material = sample.material
      if (row === 0 && measuredEdge) height = measuredEdge[col]
      const cut = apronCoastDepth(x)
      const keep = 1 - smoothstep(cut - APRON_CLIFF.width, cut, depth)
      height = seaFloor + (height - seaFloor) * keep
      if (keep < 1 && height < layout.seaLevel + 0.05) material = 'sea'
      const i = row * columns + col
      positions[i * 3] = x
      positions[i * 3 + 1] = height
      positions[i * 3 + 2] = z
      materials[i] = material
    }
  }

  const indices: number[] = []
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < columns - 1; col++) {
      const a = row * columns + col
      const b = a + 1
      const c = a + columns
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const normals = geometry.attributes.normal as THREE.BufferAttribute
  const colors = new Float32Array(columns * rows * 3)
  const c = new THREE.Color()
  for (let i = 0; i < columns * rows; i++) {
    const x = positions[i * 3]
    const height = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    const material = materials[i]
    const steep = normals.getY(i) < 0.8
    if (material === 'ice' && !steep && height < layout.shelfHeight - 0.2) c.set(SEAM_LIGHT)
    // The back coast is an ice cliff like every authored coast: the foothill rock knuckles that reach
    // it stay lavender on top but their faces take the cliff ice, not rock stripes.
    else if (steep && material === 'rock') c.set(P.cliffIce)
    else c.set((steep ? STEEP[material] : GROUND[material]) ?? P.snow)
    const l = material === 'sea' || material === 'openWater' ? 0 : 0.02 * fbm(x * 0.08, z * 0.08) + 0.01 * fbm(x * 0.5, z * 0.5)
    c.offsetHSL(0, 0, l)
    if (night) c.offsetHSL(0.03, 0.05, -0.16)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

/** The authored terrain mesh's north edge heights (x ascending), keyed by its geometry so a rebuild is noticed. */
export function readTerrainEdge(scene: THREE.Object3D, extent: number): { key: string; heights: Float32Array } | null {
  let found: THREE.Mesh | null = null
  scene.traverse((object) => {
    if (found) return
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const geometry = mesh.geometry as THREE.PlaneGeometry
    if (geometry.type !== 'PlaneGeometry') return
    const parameters = geometry.parameters
    if (parameters.width !== extent * 2 || parameters.widthSegments !== extent * 2) return
    found = mesh
  })
  if (!found) return null
  const geometry = (found as THREE.Mesh).geometry
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const columns = extent * 2 + 1
  const heights = new Float32Array(columns)
  let hits = 0
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getZ(i) + extent) > 1e-3) continue
    const col = Math.round(pos.getX(i) + extent)
    if (col < 0 || col >= columns) continue
    heights[col] = pos.getY(i)
    hits++
  }
  if (hits < columns) return null
  return { key: geometry.uuid, heights }
}
