/**
 * Endless continuation: turns the pure outer world into three.js geometry.
 *
 * Four indexed lattice meshes with smooth normals and per-vertex colours, like the authored
 * Terrain mesh: a seam strip whose inner edge is the authored plate edge on its own float32
 * lattice with the authored heights (watertight), then the three LOD rings, each snapping its
 * outer boundary onto the coarser lattice beside it so the LOD steps have no cracks. Normals come
 * from the heightfield itself (fixed pitch) so shared vertices shade the same on both sides of a
 * boundary. Colours bake the land's own palette plus a distance haze toward the sky.
 */
import * as THREE from 'three'
import { COASTAL_PALETTE as P } from '../../layout/biome-layout'
import { fbm, sampleTerrain, smoothstep } from '../../layout/terrain'
import { AUTHORED_SEGMENTS, SEAM_WIDTH, authoredLattice, chebyshev, type OuterMaterial, type OuterWorld, type RingSpec } from './outer-world'

/* ---------- palette (the authored Terrain's choices, so the seam has one voice) ---------- */

const DAY: Record<OuterMaterial, string> = {
  sea: '#246f89',
  shallows: P.shallows,
  limestone: P.ground,
  terrace: '#ded2b1',
  terrace2: '#c9b78e',
  scrub: '#a3a67e',
  riverbed: '#d6ccae',
  rock: '#c4a483',
}
const NIGHT: Record<OuterMaterial, string> = {
  sea: P.waterNight,
  shallows: P.shallowsNight,
  limestone: '#676e72',
  terrace: '#60686a',
  terrace2: '#565d5f',
  scrub: '#4f5a53',
  riverbed: '#5f6567',
  rock: '#5e514b',
}

const MATERIAL_CODE: Record<OuterMaterial, number> = { sea: 0, shallows: 1, limestone: 2, terrace: 3, scrub: 4, riverbed: 5, terrace2: 6, rock: 7 }
const MATERIALS: OuterMaterial[] = ['sea', 'shallows', 'limestone', 'terrace', 'scrub', 'riverbed', 'terrace2', 'rock']

/** Finite-difference pitch for the heightfield normals (the same at every vertex, on every ring). */
const NORMAL_PITCH = 8
const UP = new THREE.Vector3(0, 1, 0)

export interface OuterGrade {
  night: boolean
}

/* ---------- lattice mesh data ---------- */

export interface LatticeMeshData {
  /** 0 is the seam strip. */
  ring: 0 | 1 | 2 | 3
  vertices: number
  triangles: number
  position: Float32Array
  normal: Float32Array
  index: Uint32Array
  /** Per vertex. */
  material: Uint8Array
  haze: Float32Array
}

interface Builder {
  position: number[]
  normal: number[]
  material: number[]
  haze: number[]
  index: number[]
}

function builder(): Builder {
  return { position: [], normal: [], material: [], haze: [], index: [] }
}

const scratchN = new THREE.Vector3()

/**
 * Beyond this distance from the land centre every normal is straight up (see `normalAt`). From the
 * far edge of the camera box (460 m) 600 m out is already a 1 km view depth, where the fog has
 * taken 40 % of the colour.
 */
export const FLAT_NORMALS_FROM = 600
export const FLAT_NORMALS_BY = 1100

/**
 * Heightfield normal from central differences (neighbour heights `pitch` metres away), flattened
 * toward up with the haze and, past 600 m, with distance alone: the pixel pass draws its outlines
 * from the normal buffer, which the fog never touches, so a far shore or ridge whose colour has
 * dissolved would otherwise leave a ghost line in the haze.
 */
function pushNormal(hxm: number, hxp: number, hzm: number, hzp: number, pitch: number, x: number, z: number, haze: number, out: number[]): void {
  const dx = (hxp - hxm) / (2 * pitch)
  const dz = (hzp - hzm) / (2 * pitch)
  scratchN.set(-dx, 1, -dz).normalize()
  const flatten = Math.max(smoothstep(0.3, 0.7, haze), smoothstep(FLAT_NORMALS_FROM, FLAT_NORMALS_BY, Math.hypot(x, z)))
  if (flatten > 0) scratchN.lerp(UP, flatten).normalize()
  out.push(scratchN.x, scratchN.y, scratchN.z)
}

/** Normal by sampling the four neighbours of (x, z) with `height` (used where no lattice neighbour exists). */
function normalAt(height: (x: number, z: number) => number, x: number, z: number, pitch: number, haze: number, out: number[]): void {
  pushNormal(height(x - pitch, z), height(x + pitch, z), height(x, z - pitch), height(x, z + pitch), pitch, x, z, haze, out)
}

function pushVertex(b: Builder, x: number, y: number, z: number, material: OuterMaterial, haze: number): number {
  b.position.push(x, y, z)
  b.material.push(MATERIAL_CODE[material])
  b.haze.push(haze)
  return b.position.length / 3 - 1
}

function finish(ring: 0 | 1 | 2 | 3, b: Builder): LatticeMeshData {
  return {
    ring,
    vertices: b.position.length / 3,
    triangles: b.index.length / 3,
    position: new Float32Array(b.position),
    normal: new Float32Array(b.normal),
    index: new Uint32Array(b.index),
    material: new Uint8Array(b.material),
    haze: new Float32Array(b.haze),
  }
}

/* ---------- the seam strip ---------- */

/**
 * Four trapezoids between the plate edge (inner, authored lattice, authored heights) and the first
 * ring's inner boundary (outer, 10 m lattice, our heights), zipped by arc-length parameter. The
 * corners' diagonals are shared by the two neighbouring sides.
 */
export function buildSeamStrip(world: OuterWorld): LatticeMeshData {
  const layout = world.layout
  const e = world.plateHalf
  const o = e + SEAM_WIDTH
  const lattice = authoredLattice(layout)
  const cell = world.rings[0].cell
  const outerCount = Math.round((2 * o) / cell)
  const b = builder()
  const authoredHeight = (x: number, z: number) => sampleTerrain(layout, x, z).height
  const worldHeight = (x: number, z: number) => world.sample(x, z).height

  // Each side: `inner(k)` and `outer(k)` give the world point for the k-th vertex along the side.
  const sides: Array<{ inner: (k: number) => [number, number]; outer: (k: number) => [number, number] }> = [
    { inner: (k) => [lattice[k], -e], outer: (k) => [-o + k * cell, -o] }, // north
    { inner: (k) => [lattice[k], e], outer: (k) => [-o + k * cell, o] }, // south
    { inner: (k) => [-e, lattice[k]], outer: (k) => [-o, -o + k * cell] }, // west
    { inner: (k) => [e, lattice[k]], outer: (k) => [o, -o + k * cell] }, // east
  ]
  for (const [sideIndex, side] of sides.entries()) {
    const innerIdx: number[] = []
    for (let k = 0; k <= AUTHORED_SEGMENTS; k++) {
      const [x, z] = side.inner(k)
      const s = sampleTerrain(layout, x, z)
      const material: OuterMaterial = s.material === 'sea' ? 'sea' : s.material === 'shallows' || s.material === 'ruin-bed' ? 'shallows' : s.material === 'terrace' ? 'terrace' : 'limestone'
      innerIdx.push(pushVertex(b, x, s.height, z, material, 0))
      normalAt(authoredHeight, x, z, NORMAL_PITCH, 0, b.normal)
    }
    const outerIdx: number[] = []
    for (let k = 0; k <= outerCount; k++) {
      const [x, z] = side.outer(k)
      const s = world.sample(x, z)
      outerIdx.push(pushVertex(b, x, s.height, z, s.material, s.haze))
      // Same neighbours (one ring-1 cell away) as ring 1 uses for this very vertex: identical normals.
      normalAt(worldHeight, x, z, cell, s.haze, b.normal)
    }
    // Zipper: advance whichever polyline's next vertex has the smaller parameter.
    let i = 0
    let j = 0
    const ui = (k: number) => k / AUTHORED_SEGMENTS
    const uj = (k: number) => k / outerCount
    // Winding: up-facing. On the south and west sides the parameter runs the other way round.
    const flip = sideIndex === 1 || sideIndex === 2
    const tri = (a: number, c: number, d: number) => (flip ? b.index.push(a, d, c) : b.index.push(a, c, d))
    while (i < AUTHORED_SEGMENTS || j < outerCount) {
      const nextInner = i < AUTHORED_SEGMENTS ? ui(i + 1) : Number.POSITIVE_INFINITY
      const nextOuter = j < outerCount ? uj(j + 1) : Number.POSITIVE_INFINITY
      if (nextInner <= nextOuter) {
        tri(innerIdx[i], innerIdx[i + 1], outerIdx[j])
        i++
      } else {
        tri(innerIdx[i], outerIdx[j + 1], outerIdx[j])
        j++
      }
    }
  }
  return finish(0, b)
}

/* ---------- the rings ---------- */

/**
 * One ring as an indexed lattice. `next` is the ring outside this one (its lattice is what the outer
 * boundary snaps to); null for the last ring.
 */
export function buildRing(world: OuterWorld, ring: RingSpec, next: RingSpec | null): LatticeMeshData {
  const { cell, inner, outer } = ring
  const n = Math.round((2 * outer) / cell) + 1
  const at = (i: number) => -outer + i * cell
  const innerIndex = Math.round((outer - inner) / cell)
  const outerIndex = n - 1 - innerIndex
  const worldHeight = (x: number, z: number) => world.sample(x, z).height

  const heights = new Float64Array(n * n)
  const keep = new Uint8Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const inHole = i > innerIndex && i < outerIndex && j > innerIndex && j < outerIndex
      if (inHole) continue
      keep[j * n + i] = 1
      heights[j * n + i] = world.sample(at(i), at(j)).height
    }
  }
  if (next) {
    const ratio = Math.round(next.cell / cell)
    const snap = (index: (k: number) => number) => {
      for (let k = 0; k < n; k++) {
        if (k % ratio === 0) continue
        const k0 = Math.floor(k / ratio) * ratio
        const k1 = Math.min(n - 1, k0 + ratio)
        const t = (k - k0) / (k1 - k0)
        heights[index(k)] = heights[index(k0)] + (heights[index(k1)] - heights[index(k0)]) * t
      }
    }
    snap((k) => k * n)
    snap((k) => k * n + (n - 1))
    snap((k) => k)
    snap((k) => (n - 1) * n + k)
  }

  const b = builder()
  const vertexIndex = new Int32Array(n * n).fill(-1)
  // Normals from the lattice's own neighbours (one cell away); where a neighbour is missing (the
  // ring's inner or outer edge) it is sampled, so the shared boundary vertices of two rings and of
  // the seam strip get the same answer from both sides.
  const neighbour = (i: number, j: number) => (i >= 0 && j >= 0 && i < n && j < n && keep[j * n + i] ? heights[j * n + i] : worldHeight(at(i), at(j)))
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!keep[j * n + i]) continue
      const x = at(i)
      const z = at(j)
      const s = world.sample(x, z)
      vertexIndex[j * n + i] = pushVertex(b, x, heights[j * n + i], z, s.material, s.haze)
      pushNormal(neighbour(i - 1, j), neighbour(i + 1, j), neighbour(i, j - 1), neighbour(i, j + 1), cell, x, z, s.haze, b.normal)
    }
  }
  // The last ring is a square lattice, but the horizon (water disc, haze wall) is a circle of a
  // slightly larger radius: trim the square's corners so no land ever stands beyond the horizon.
  const clip = next ? Number.POSITIVE_INFINITY : outer
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = vertexIndex[j * n + i]
      const c = vertexIndex[j * n + i + 1]
      const d = vertexIndex[(j + 1) * n + i]
      const e = vertexIndex[(j + 1) * n + i + 1]
      if (a < 0 || c < 0 || d < 0 || e < 0) continue
      const insidePlate = i >= innerIndex && i + 1 <= outerIndex && j >= innerIndex && j + 1 <= outerIndex
      if (insidePlate) continue
      if (Math.hypot(at(i) + cell / 2, at(j) + cell / 2) > clip) continue
      // Up-facing winding (z grows with j, x with i): (a, d, c) and (c, d, e). Alternate the diagonal.
      if ((i + j) % 2 === 0) b.index.push(a, d, c, c, d, e)
      else b.index.push(a, d, e, a, e, c)
    }
  }
  return finish(ring.ring, b)
}

export function buildOuterMeshes(world: OuterWorld): LatticeMeshData[] {
  const out: LatticeMeshData[] = [buildSeamStrip(world)]
  world.rings.forEach((ring, index) => out.push(buildRing(world, ring, world.rings[index + 1] ?? null)))
  return out
}

export function triangleCount(meshes: LatticeMeshData[]): number {
  return meshes.reduce((sum, m) => sum + m.triangles, 0)
}

/* ---------- colours ---------- */

export function hazeColour(grade: OuterGrade): string {
  return grade.night ? P.skyNight : P.sky
}

const scratchC = new THREE.Color()
const scratchHaze = new THREE.Color()

/** Per-vertex colours baked with the authored texture noise, steepness, night and haze. */
export function colourLattice(data: LatticeMeshData, grade: OuterGrade, target?: Float32Array): Float32Array {
  const colors = target ?? new Float32Array(data.vertices * 3)
  const palette = grade.night ? NIGHT : DAY
  const cliff = grade.night ? P.cliffNight : P.cliff
  scratchHaze.set(hazeColour(grade))
  const c = scratchC
  for (let v = 0; v < data.vertices; v++) {
    const material = MATERIALS[data.material[v]]
    const x = data.position[v * 3]
    const y = data.position[v * 3 + 1]
    const z = data.position[v * 3 + 2]
    const ny = data.normal[v * 3 + 1]
    const haze = data.haze[v]
    c.set(palette[material])
    if (material === 'limestone' || material === 'terrace' || material === 'terrace2') {
      if (ny < 0.75) c.set(cliff)
      else {
        // The authored Terrain's texture, so the strip's inner edge is the same colour as the plate.
        const broad = fbm(x * 0.025, z * 0.025)
        const grain = fbm(x * 0.11, z * 0.11)
        c.offsetHSL(broad * 0.015, broad * 0.025, broad * 0.12 + grain * 0.035)
      }
    } else if (material === 'scrub' || material === 'riverbed' || material === 'rock') {
      if (ny < 0.7) c.set(cliff)
      else c.offsetHSL(0, 0, fbm(x * 0.05 + 2, z * 0.05) * 0.08)
    }
    // Relief under a three-step toon ramp is nearly invisible on pale ground: let height carry it
    // (higher country a touch darker and greener, like thinning soil), nothing at the seam.
    if (material !== 'sea' && material !== 'shallows') c.offsetHSL(0.01 * smoothstep(12, 90, y), 0, -0.07 * smoothstep(12, 90, y))
    if (material !== 'sea' && material !== 'shallows' && haze > 0) c.lerp(scratchHaze, haze)
    colors[v * 3] = c.r
    colors[v * 3 + 1] = c.g
    colors[v * 3 + 2] = c.b
  }
  return colors
}

export function latticeGeometry(data: LatticeMeshData, grade: OuterGrade): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.position, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colourLattice(data, grade), 3))
  geo.setIndex(new THREE.BufferAttribute(data.index, 1))
  geo.computeBoundingSphere()
  return geo
}

export function recolourGeometry(geo: THREE.BufferGeometry, data: LatticeMeshData, grade: OuterGrade): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute
  colourLattice(data, grade, attr.array as Float32Array)
  attr.needsUpdate = true
}

/* ---------- far detail geometry (unit shapes, instanced) ---------- */

function paintByNormal(geo: THREE.BufferGeometry, top: string, side: string, upThreshold: number, grade: OuterGrade, haze: number, nightDim = -0.3): void {
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute
  const colors = new Float32Array(normal.count * 3)
  const c = scratchC
  scratchHaze.set(hazeColour(grade))
  for (let i = 0; i < normal.count; i++) {
    c.set(normal.getY(i) > upThreshold ? top : side)
    if (grade.night) c.offsetHSL(0.02, -0.05, nightDim)
    c.lerp(scratchHaze, haze)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Karst outcrop: a faceted dodecahedron with its base a little under the ground. */
export function outcropGeometry(): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(1, 0).toNonIndexed()
  geo.translate(0, 0.55, 0)
  geo.computeVertexNormals()
  return geo
}

/** Maquis bush: a squat icosahedron (20 faces: the cheapest blob that still reads as a bush). */
export function scrubGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 0).toNonIndexed()
  geo.translate(0, 0.6, 0)
  geo.computeVertexNormals()
  return geo
}

/** Aqueduct pier: a pillar from the ground to y = 1 (instances scale the height) with a springer slab on top. */
export function pierGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const pushBox = (w: number, y0: number, y1: number, d: number, taper: number) => {
    const box = new THREE.BoxGeometry(w, y1 - y0, d).toNonIndexed()
    const pos = box.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + (y0 + y1) / 2
      const k = y > (y0 + y1) / 2 ? taper : 1
      positions.push(pos.getX(i) * k, y, pos.getZ(i) * k)
    }
    box.dispose()
  }
  pushBox(2.6, 0, 0.86, 2.2, 0.82)
  pushBox(3.6, 0.86, 1.0, 2.6, 1)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

export function paintOutcrop(geo: THREE.BufferGeometry, grade: OuterGrade): void {
  paintByNormal(geo, P.roadEdge, P.ruin, 0.35, grade, 0.08)
}

export function paintScrub(geo: THREE.BufferGeometry, grade: OuterGrade): void {
  // Night keeps the bushes a shade above the ground so the plain is not a field of black dots.
  paintByNormal(geo, P.olive, '#5c6a4e', 0.4, grade, 0.08, -0.12)
}

export function paintPier(geo: THREE.BufferGeometry, grade: OuterGrade): void {
  paintByNormal(geo, P.ruin, P.ruinDark, 0.5, grade, 0.14)
}

/** Shared check used by the tests: every outer vertex sits on an integer multiple of its ring cell. */
export function onLattice(value: number, cell: number): boolean {
  return Math.abs(value / cell - Math.round(value / cell)) < 1e-6
}

export { chebyshev }
