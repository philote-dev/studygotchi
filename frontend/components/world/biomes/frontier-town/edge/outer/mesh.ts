/**
 * Turns the pure outer desert into flat-shaded three.js geometry.
 *
 * Each LOD ring becomes four quadrant meshes (frustum culling drops what is behind the camera)
 * of non-indexed triangles: one face, one colour, chunky facets. Ring 1 meets the flat authored
 * plate on the plate's own rectangle at exactly y = 0 and the plate's sand colour, so the seam is
 * watertight and has no colour step; finer rings snap their outer boundary onto the coarser
 * lattice beside them. Colours bake the material, a little lightness noise that fades in away
 * from the seam, and the haze toward the sky (aerial perspective). Far faces lean their normals
 * toward up so the toon steps stop flashing at the horizon.
 */
import * as THREE from 'three'
import { FRONTIER_PALETTE as P } from '../../layout/biome-layout'
import { fbm, smoothstep } from './noise'
import { type GroundKind, GORGE, type OuterDesert, type OuterSample } from './desert'
import { PLATE, type RingSpec, plateDistance } from './plate'
import type { PropKind } from './scatter'

/* ---------- palette ---------- */

export interface OuterGrade {
  night: boolean
}

type Face =
  | 'sand'
  | 'sandAlt'
  | 'wash'
  | 'playa'
  | 'dune'
  | 'duneShade'
  | 'rock'
  | 'farRock'
  | 'strata'
  | 'cap'
  | 'farCap'
  | 'scree'
  | 'floor'
  | 'pool'

const DAY: Record<Face, string> = {
  sand: P.sand,
  /** Compacted patches and banks: a half step toward the authored shadow tint, not the full `#c2925a`. */
  sandAlt: '#cfa36c',
  wash: P.paleGravel,
  playa: '#efe6cf',
  dune: '#e0ba86',
  duneShade: '#c49a68',
  rock: P.redRock,
  farRock: P.farRock,
  strata: P.strata,
  cap: P.sand,
  farCap: '#b9834f',
  scree: '#c0895a',
  floor: '#8c5a3e',
  pool: P.water,
}

/** The authored night deviations: ground '#7f5f4d', near canyon '#6f3f38', far '#3a2f45', caps '#8f684e'. */
const NIGHT: Record<Face, string> = {
  sand: '#7f5f4d',
  sandAlt: '#6c4f40',
  wash: '#8d7a66',
  playa: '#8f857a',
  dune: '#86655a',
  duneShade: '#6a4d44',
  rock: '#6f3f38',
  farRock: '#3a2f45',
  strata: '#7d5a44',
  cap: '#8f684e',
  farCap: '#5a4652',
  scree: '#6a4a3e',
  floor: '#4b3530',
  pool: '#2f4a5c',
}

const FACES: Face[] = ['sand', 'sandAlt', 'wash', 'playa', 'dune', 'duneShade', 'rock', 'farRock', 'strata', 'cap', 'farCap', 'scree', 'floor', 'pool']
const FACE_CODE = Object.fromEntries(FACES.map((f, i) => [f, i])) as Record<Face, number>

export function skyColour(grade: OuterGrade): string {
  return grade.night ? P.skyNight : P.sky
}

/* ---------- ring mesh data ---------- */

export interface RingMeshData {
  ring: number
  quadrant: number
  triangles: number
  position: Float32Array
  normal: Float32Array
  /** Per face. */
  face: Uint8Array
  row: Uint8Array
  haze: Float32Array
  noise: Float32Array
}

interface FaceBuffer {
  position: number[]
  normal: number[]
  face: number[]
  row: number[]
  haze: number[]
  noise: number[]
}

interface Vertex {
  x: number
  z: number
  s: OuterSample
}

function newBuffer(): FaceBuffer {
  return { position: [], normal: [], face: [], row: [], haze: [], noise: [] }
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _n = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

const STRATA_BANDS: Array<[number, number]> = [
  [0.3, 0.36],
  [0.52, 0.58],
  [0.74, 0.8],
]

function inStrata(frac: number): boolean {
  for (const [a, b] of STRATA_BANDS) if (frac >= a && frac <= b) return true
  return false
}

/** Which flat colour a face gets, from its corner kinds, slope and height. */
export function faceOf(kind: GroundKind, ny: number, nz: number, mesaFrac: number, row: number, cy: number): Face {
  switch (kind) {
    case 'sand':
      return ny < 0.8 ? 'sandAlt' : 'sand'
    case 'sandAlt':
      return 'sandAlt'
    case 'wash':
      return 'wash'
    case 'playa':
      return 'playa'
    case 'dune':
      return ny < 0.86 && nz > 0.25 ? 'duneShade' : 'dune'
    case 'duneShade':
      return 'duneShade'
    case 'floor':
      return 'floor'
    case 'pool':
      return 'pool'
    case 'cap':
    case 'rock':
    case 'scree': {
      if (mesaFrac <= 0) {
        // Gorge walls and the escarpment step: strata by absolute depth.
        const frac = Math.min(1, Math.max(0, (cy + GORGE.depth) / GORGE.depth))
        if (ny < 0.72) return inStrata(frac) ? 'strata' : 'rock'
        return ny < 0.9 ? 'scree' : 'sand'
      }
      // Far rows take the darker cap: a sand cap hazes into the sky and the mesa reads as a spike.
      if (mesaFrac > 0.9 && ny > 0.86) return row >= 2 ? 'farCap' : 'cap'
      if (ny < 0.72) {
        if (inStrata(mesaFrac)) return 'strata'
        return row >= 2 ? 'farRock' : 'rock'
      }
      return mesaFrac > 0.9 ? (row >= 2 ? 'farCap' : 'cap') : 'scree'
    }
  }
}

function pushFace(buffers: FaceBuffer[], a: Vertex, b: Vertex, c: Vertex): void {
  _a.set(b.x - a.x, b.s.height - a.s.height, b.z - a.z)
  _b.set(c.x - a.x, c.s.height - a.s.height, c.z - a.z)
  _n.crossVectors(_a, _b)
  if (_n.lengthSq() < 1e-9) return
  _n.normalize()
  let v1 = b
  let v2 = c
  if (_n.y < 0) {
    _n.negate()
    v1 = c
    v2 = b
  }
  const cx = (a.x + b.x + c.x) / 3
  const cz = (a.z + b.z + c.z) / 3
  const cy = (a.s.height + b.s.height + c.s.height) / 3
  const quadrant = (cx >= 0 ? 1 : 0) + (cz >= 0 ? 2 : 0)
  const buf = buffers[quadrant]

  // The highest corner names the material (a cliff face that climbs onto a cap is cap-side rock).
  let top = a
  if (b.s.height > top.s.height) top = b
  if (c.s.height > top.s.height) top = c
  const mesaFrac = Math.max(a.s.mesaFrac, b.s.mesaFrac, c.s.mesaFrac)
  const row = Math.max(a.s.row, b.s.row, c.s.row)
  const face = faceOf(top.s.kind, _n.y, _n.z, mesaFrac, row, cy)
  const haze = (a.s.haze + b.s.haze + c.s.haze) / 3
  // Lightness noise that is zero at the seam so the plate's flat colour continues without a step.
  const edge = smoothstep(0, 90, plateDistance(cx, cz))
  const noise = 0.03 * edge * fbm(cx * 0.013 + 3.1, cz * 0.013 + 0.7, 2)

  // Far faces lose their runtime toon shading: normals lean toward up as the haze grows, and the
  // back rows (B, C, ghost) go further so their tall cliffs read as one hazed silhouette, not as
  // a fan of lit and shaded facets.
  // Gentle ground (slopes under ~25°) also leans toward up, so the rolling flats shade like the
  // plate instead of breaking into hard toon-step patches; cliffs and slip faces keep their normals.
  const gentle = smoothstep(0.84, 0.97, _n.y) * 0.8
  const flatten = Math.max(smoothstep(0.4, 0.92, haze), row >= 2 ? 0.6 : 0, gentle)
  _n.lerp(UP, flatten).normalize()

  for (const v of [a, v1, v2]) {
    buf.position.push(v.x, v.s.height, v.z)
    buf.normal.push(_n.x, _n.y, _n.z)
  }
  buf.face.push(FACE_CODE[face])
  buf.row.push(row)
  buf.haze.push(haze)
  buf.noise.push(noise)
}

function finish(ring: number, buffers: FaceBuffer[]): RingMeshData[] {
  return buffers
    .map((buf, quadrant) => ({
      ring,
      quadrant,
      triangles: buf.face.length,
      position: new Float32Array(buf.position),
      normal: new Float32Array(buf.normal),
      face: new Uint8Array(buf.face),
      row: new Uint8Array(buf.row),
      haze: new Float32Array(buf.haze),
      noise: new Float32Array(buf.noise),
    }))
    .filter((data) => data.triangles > 0)
}

/**
 * One ring → up to four quadrant meshes. Ring 1's hole is the plate rectangle; the others' is
 * the previous ring's square. `next` is the ring outside (its lattice is what the outer boundary
 * snaps to); null for the last ring.
 */
export function buildRing(world: OuterDesert, ring: RingSpec, next: RingSpec | null): RingMeshData[] {
  const { cell, inner, outer } = ring
  const n = Math.round((2 * outer) / cell) + 1
  const at = (i: number) => -outer + i * cell
  const holeMinX = ring.ring === 1 ? PLATE.minX : -inner
  const holeMaxX = ring.ring === 1 ? PLATE.maxX : inner
  const holeMinZ = ring.ring === 1 ? PLATE.minZ : -inner
  const holeMaxZ = ring.ring === 1 ? PLATE.maxZ : inner
  const strictlyInside = (x: number, z: number) => x > holeMinX + 1e-6 && x < holeMaxX - 1e-6 && z > holeMinZ + 1e-6 && z < holeMaxZ - 1e-6

  const samples: Array<OuterSample | null> = new Array(n * n).fill(null)
  const heights = new Float64Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = at(i)
      const z = at(j)
      if (strictlyInside(x, z)) continue
      const s = world.sample(x, z)
      const onSeam = ring.ring === 1 && !strictlyInside(x, z) && x >= holeMinX - 1e-6 && x <= holeMaxX + 1e-6 && z >= holeMinZ - 1e-6 && z <= holeMaxZ + 1e-6
      samples[j * n + i] = s
      heights[j * n + i] = onSeam ? world.seamHeight(x, z) : s.height
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

  const vertex = (i: number, j: number): Vertex => {
    const s = samples[j * n + i]!
    const height = heights[j * n + i]
    return { x: at(i), z: at(j), s: height === s.height ? s : { ...s, height } }
  }

  const buffers = [newBuffer(), newBuffer(), newBuffer(), newBuffer()]
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const x0 = at(i)
      const x1 = at(i + 1)
      const z0 = at(j)
      const z1 = at(j + 1)
      const inHole = x0 >= holeMinX - 1e-6 && x1 <= holeMaxX + 1e-6 && z0 >= holeMinZ - 1e-6 && z1 <= holeMaxZ + 1e-6
      if (inHole) continue
      const a = vertex(i, j)
      const b = vertex(i + 1, j)
      const c = vertex(i, j + 1)
      const d = vertex(i + 1, j + 1)
      if ((i + j) % 2 === 0) {
        pushFace(buffers, a, b, c)
        pushFace(buffers, b, d, c)
      } else {
        pushFace(buffers, a, b, d)
        pushFace(buffers, a, d, c)
      }
    }
  }
  return finish(ring.ring, buffers)
}

export function buildOuterMeshes(world: OuterDesert, rings: readonly RingSpec[]): RingMeshData[] {
  const out: RingMeshData[] = []
  rings.forEach((ring, index) => out.push(...buildRing(world, ring, rings[index + 1] ?? null)))
  return out
}

export function triangleCount(meshes: RingMeshData[]): number {
  return meshes.reduce((sum, m) => sum + m.triangles, 0)
}

/** Seam vertices of the ring-1 data: every position lying on the plate boundary. */
export function seamVertices(meshes: RingMeshData[]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (const m of meshes) {
    if (m.ring !== 1) continue
    for (let i = 0; i < m.position.length; i += 3) {
      const x = m.position[i]
      const z = m.position[i + 2]
      const onX = (Math.abs(x - PLATE.minX) < 1e-4 || Math.abs(x - PLATE.maxX) < 1e-4) && z >= PLATE.minZ - 1e-4 && z <= PLATE.maxZ + 1e-4
      const onZ = (Math.abs(z - PLATE.minZ) < 1e-4 || Math.abs(z - PLATE.maxZ) < 1e-4) && x >= PLATE.minX - 1e-4 && x <= PLATE.maxX + 1e-4
      if (onX || onZ) out.push([x, m.position[i + 1], z])
    }
  }
  return out
}

/* ---------- colours ---------- */

const _c = new THREE.Color()
const _sky = new THREE.Color()

/** Per-face colours → per-vertex Float32Array (3 verts × rgb), baked with noise and haze. */
export function colourRing(data: RingMeshData, grade: OuterGrade, target?: Float32Array): Float32Array {
  const colors = target ?? new Float32Array(data.triangles * 9)
  _sky.set(skyColour(grade))
  const table = grade.night ? NIGHT : DAY
  for (let f = 0; f < data.triangles; f++) {
    const face = FACES[data.face[f]]
    const haze = data.haze[f]
    _c.set(table[face])
    if (data.noise[f] !== 0) _c.offsetHSL(0, 0, data.noise[f])
    _c.lerp(_sky, haze)
    const o = f * 9
    for (let v = 0; v < 3; v++) {
      colors[o + v * 3] = _c.r
      colors[o + v * 3 + 1] = _c.g
      colors[o + v * 3 + 2] = _c.b
    }
  }
  return colors
}

export function ringGeometry(data: RingMeshData, grade: OuterGrade): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.position, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colourRing(data, grade), 3))
  geo.computeBoundingSphere()
  return geo
}

export function recolourGeometry(geo: THREE.BufferGeometry, data: RingMeshData, grade: OuterGrade): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute
  colourRing(data, grade, attr.array as Float32Array)
  attr.needsUpdate = true
}

/** The flat plate itself: the authored rectangle at y = 0 (the slab the land has always stood on). */
export function plateGeometry(): THREE.BufferGeometry {
  const w = PLATE.maxX - PLATE.minX
  const d = PLATE.maxZ - PLATE.minZ
  const geo = new THREE.PlaneGeometry(w, d, 1, 1)
  geo.rotateX(-Math.PI / 2)
  geo.translate((PLATE.minX + PLATE.maxX) / 2, 0, (PLATE.minZ + PLATE.maxZ) / 2)
  geo.computeBoundingSphere()
  return geo
}

/* ---------- instanced desert props ---------- */

const PROP_COLOURS: Record<PropKind, { day: [string, string]; night: [string, string] }> = {
  saguaro: { day: [P.cactus, '#45703f'], night: ['#2e4a3a', '#263f32'] },
  scrub: { day: ['#6e8245', '#78904d'], night: ['#45503a', '#4b5940'] },
  rock: { day: ['#90745d', '#7f6654'], night: ['#5a4b44', '#4d4039'] },
  hoodoo: { day: [P.redRock, P.strata], night: ['#6f3f38', '#7d5a44'] },
}

/** Reference haze baked into the prop geometry; instances multiply back toward their own haze. */
export function referenceHaze(grade: OuterGrade): number {
  return grade.night ? 0 : 0.5
}

function mergeParts(parts: Array<{ geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; colour: 0 | 1 }>): { geometry: THREE.BufferGeometry; which: Uint8Array } {
  const positions: number[] = []
  const which: number[] = []
  for (const part of parts) {
    const flat = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry
    const pos = flat.attributes.position
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(part.matrix)
      positions.push(v.x, v.y, v.z)
      which.push(part.colour)
    }
    if (flat !== part.geometry) flat.dispose()
    part.geometry.dispose()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return { geometry, which: new Uint8Array(which) }
}

const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s))

/** Unit prop geometries (metres); instances scale them. `which` says which of the two colours each vertex takes. */
export function propGeometry(kind: PropKind): { geometry: THREE.BufferGeometry; which: Uint8Array } {
  switch (kind) {
    case 'saguaro':
      // The authored Cactus: trunk 5 m, two arms, chunky six-sided.
      return mergeParts([
        { geometry: new THREE.CylinderGeometry(0.42, 0.48, 5, 6), matrix: M(0, 2.5, 0), colour: 0 },
        { geometry: new THREE.CylinderGeometry(0.3, 0.34, 2.2, 6), matrix: M(1.2, 3.2, 0), colour: 0 },
        { geometry: new THREE.BoxGeometry(1.25, 0.55, 0.55), matrix: M(0.62, 2.25, 0), colour: 1 },
        { geometry: new THREE.CylinderGeometry(0.27, 0.31, 1.7, 6), matrix: M(-1, 2.05, 0), colour: 0 },
        { geometry: new THREE.BoxGeometry(1, 0.5, 0.5), matrix: M(-0.5, 1.35, 0), colour: 1 },
      ])
    case 'scrub':
      return mergeParts([
        { geometry: new THREE.IcosahedronGeometry(0.75, 0), matrix: M(-0.4, 0.5, 0, 0.3, 0.2, 0), colour: 0 },
        { geometry: new THREE.IcosahedronGeometry(0.62, 0), matrix: M(0.55, 0.42, 0.3, 0, 0.9, 0.2), colour: 1 },
      ])
    case 'rock':
      return mergeParts([
        { geometry: new THREE.DodecahedronGeometry(1, 0), matrix: new THREE.Matrix4().makeScale(1.8, 1, 1.1).premultiply(M(0, 0.75, 0)), colour: 0 },
        { geometry: new THREE.DodecahedronGeometry(1, 0), matrix: new THREE.Matrix4().makeScale(1.0, 0.7, 0.8).premultiply(M(1.5, 0.45, 0.5)), colour: 1 },
      ])
    case 'hoodoo':
      // A tapered six-sided spire with a wider cap stone: unit height 1, unit base radius 1.
      return mergeParts([
        { geometry: new THREE.CylinderGeometry(0.45, 1, 0.82, 6), matrix: M(0, 0.41, 0), colour: 0 },
        { geometry: new THREE.CylinderGeometry(0.5, 0.72, 0.18, 6), matrix: M(0, 0.91, 0, 0, 0.4, 0), colour: 1 },
      ])
  }
}

/** Bake a prop's two colours (at the reference haze for the grade) into vertex colours. */
export function paintProp(geometry: THREE.BufferGeometry, which: Uint8Array, kind: PropKind, grade: OuterGrade): void {
  const palette = grade.night ? PROP_COLOURS[kind].night : PROP_COLOURS[kind].day
  const haze = referenceHaze(grade)
  _sky.set(skyColour(grade))
  const colors = new Float32Array(which.length * 3)
  for (let i = 0; i < which.length; i++) {
    _c.set(palette[which[i]]).lerp(_sky, haze)
    colors[i * 3] = _c.r
    colors[i * 3 + 1] = _c.g
    colors[i * 3 + 2] = _c.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

const _base = new THREE.Color()
const _ref = new THREE.Color()

/**
 * Per-instance tint that takes the baked reference-haze colour to the instance's own haze: a
 * per-channel ratio ≤ 1 (the day sky is brighter than every prop colour, the night sky darker, so
 * baking at 0.5 by day and 0 by night keeps the ratio inside [0, 1]).
 */
export function instanceTint(kind: PropKind, grade: OuterGrade, haze: number, target: THREE.Color): THREE.Color {
  const palette = grade.night ? PROP_COLOURS[kind].night : PROP_COLOURS[kind].day
  _sky.set(skyColour(grade))
  _base.set(palette[0])
  _ref.copy(_base).lerp(_sky, referenceHaze(grade))
  const wanted = _c.copy(_base).lerp(_sky, haze)
  target.setRGB(
    Math.min(1, wanted.r / Math.max(1e-4, _ref.r)),
    Math.min(1, wanted.g / Math.max(1e-4, _ref.g)),
    Math.min(1, wanted.b / Math.max(1e-4, _ref.b)),
  )
  return target
}
