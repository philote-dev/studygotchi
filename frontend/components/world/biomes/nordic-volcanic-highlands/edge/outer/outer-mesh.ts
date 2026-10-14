/**
 * Endless continuation: turns the pure outer world into flat-shaded three.js geometry.
 *
 * Each LOD ring becomes four quadrant meshes of non-indexed triangles (one face, one colour,
 * chunky facets; frustum culling drops what is behind the camera). Ring 1 meets the authored
 * slabs on a seam inset 1.5 m inside their rectangle, sliced into 1 m slivers and lifted 8 cm
 * above the slab top, so the slab's bevel and side walls are buried and no edge shows. Finer
 * rings snap their outer boundary onto the coarser lattice beside them. Cells that are entirely
 * sea under the authored water plane are dropped: the plane is that water.
 */
import * as THREE from 'three'
import { NORDIC_PALETTE as P } from '../../layout/biome-layout'
import { fbm, smoothstep } from '../../layout/noise'
import { PLATE_RECT, SEAM_INSET, WATER_PLANE_HALF } from '../../layout/terrain'
import { type OuterMaterial, type OuterSample, type OuterWorld, type RingSpec, insideRingInner } from './outer-world'

/* ---------- palette (the authored ground's own colours at the seam, so it has one voice) ---------- */

export const OUTER_COLOURS = {
  day: {
    moss: P.ground,
    mossSteep: '#55634b',
    sand: '#3f4145',
    sandSteep: '#33353a',
    lava: '#3a3a41',
    lavaSteep: '#2a2a31',
    mountain: '#4e5a63',
    mountainSteep: '#3a444d',
    snow: '#dfe6e6',
    ice: '#d3e0e3',
    iceSteep: '#8fb4c4',
    tuya: '#4f5a4b',
    tuyaSteep: '#3b4049',
    wet: P.wet,
    sea: P.water,
    sky: P.sky,
  },
  night: {
    moss: P.groundNight,
    mossSteep: '#2b3840',
    sand: '#23262c',
    sandSteep: '#1b1e24',
    lava: '#1d1d22',
    lavaSteep: '#141418',
    mountain: '#273642',
    mountainSteep: '#1d2933',
    snow: '#8a99a6',
    ice: '#7f93a0',
    iceSteep: '#4f6778',
    tuya: '#2d3837',
    tuyaSteep: '#222a31',
    wet: '#22323a',
    sea: P.waterNight,
    sky: P.skyNight,
  },
} as const

export interface OuterGrade {
  night: boolean
  storm: boolean
}

const DAY_LIGHT = new THREE.Vector3(65, 105, 70).normalize()
const NIGHT_LIGHT = new THREE.Vector3(-70, 80, 30).normalize()
const FACET_STEPS: [number, number, number] = [1, 0.86, 0.72]
const UP = new THREE.Vector3(0, 1, 0)

const MATERIALS: OuterMaterial[] = ['sea', 'wet', 'moss', 'sand', 'lava', 'mountain', 'snow', 'ice', 'tuya']
const MATERIAL_CODE = Object.fromEntries(MATERIALS.map((m, i) => [m, i])) as Record<OuterMaterial, number>

function facetStep(nx: number, ny: number, nz: number, light: THREE.Vector3): number {
  const ndl = nx * light.x + ny * light.y + nz * light.z
  return ndl > 0.62 ? FACET_STEPS[0] : ndl > 0.3 ? FACET_STEPS[1] : FACET_STEPS[2]
}

/* ---------- ring mesh data ---------- */

export interface RingMeshData {
  ring: number
  quadrant: number
  triangles: number
  position: Float32Array
  normal: Float32Array
  /** Per face. */
  material: Uint8Array
  steep: Uint8Array
  stepDay: Float32Array
  stepNight: Float32Array
  haze: Float32Array
  noise: Float32Array
  /** Per face: metres from the plate rectangle (the seam colour fade). */
  seamDistance: Float32Array
}

interface FaceBuffer {
  position: number[]
  normal: number[]
  material: number[]
  steep: number[]
  stepDay: number[]
  stepNight: number[]
  haze: number[]
  noise: number[]
  seamDistance: number[]
}

interface Vertex {
  x: number
  z: number
  s: OuterSample
}

function newBuffer(): FaceBuffer {
  return { position: [], normal: [], material: [], steep: [], stepDay: [], stepNight: [], haze: [], noise: [], seamDistance: [] }
}

const scratchA = new THREE.Vector3()
const scratchB = new THREE.Vector3()
const scratchN = new THREE.Vector3()

function rectDistance(x: number, z: number): number {
  const dx = Math.max(PLATE_RECT.minX - x, 0, x - PLATE_RECT.maxX)
  const dz = Math.max(PLATE_RECT.minZ - z, 0, z - PLATE_RECT.maxZ)
  return Math.hypot(dx, dz)
}

function pushFace(buffers: FaceBuffer[], seaLevel: number, a: Vertex, b: Vertex, c: Vertex): void {
  scratchA.set(b.x - a.x, b.s.height - a.s.height, b.z - a.z)
  scratchB.set(c.x - a.x, c.s.height - a.s.height, c.z - a.z)
  scratchN.crossVectors(scratchA, scratchB)
  if (scratchN.lengthSq() < 1e-9) return
  scratchN.normalize()
  let v1 = b
  let v2 = c
  if (scratchN.y < 0) {
    scratchN.negate()
    v1 = c
    v2 = b
  }
  const cx = (a.x + b.x + c.x) / 3
  const cz = (a.z + b.z + c.z) / 3
  const cy = (a.s.height + b.s.height + c.s.height) / 3
  const quadrant = (cx >= 0 ? 1 : 0) + (cz >= 0 ? 2 : 0)
  const buf = buffers[quadrant]

  // Material: the highest corner's (a shore face climbing onto land is land, not sea bed);
  // only faces whose centroid is under the water are sea.
  let highest = a
  if (b.s.height > highest.s.height) highest = b
  if (c.s.height > highest.s.height) highest = c
  const material: OuterMaterial = cy < seaLevel + 0.02 ? 'sea' : highest.s.material === 'sea' ? 'wet' : highest.s.material
  const haze = (a.s.haze + b.s.haze + c.s.haze) / 3
  const steep = scratchN.y < 0.8 ? 1 : 0
  const stepDay = facetStep(scratchN.x, scratchN.y, scratchN.z, DAY_LIGHT)
  const stepNight = facetStep(scratchN.x, scratchN.y, scratchN.z, NIGHT_LIGHT)
  const noise = 0.03 * fbm(cx * 0.01 + 3.1, cz * 0.01 + 0.7, 2) + 0.012 * fbm(cx * 0.08, cz * 0.08, 1)
  const seam = rectDistance(cx, cz)

  // Far faces lose their runtime toon shading: normals lean toward up as the haze grows, so the
  // horizon dissolves instead of flashing lit / shade facets against the sky.
  const flatten = smoothstep(0.35, 0.9, haze)
  scratchN.lerp(UP, flatten).normalize()

  for (const v of [a, v1, v2]) {
    buf.position.push(v.x, v.s.height, v.z)
    buf.normal.push(scratchN.x, scratchN.y, scratchN.z)
  }
  buf.material.push(MATERIAL_CODE[material])
  buf.steep.push(steep)
  buf.stepDay.push(stepDay)
  buf.stepNight.push(stepNight)
  buf.haze.push(haze)
  buf.noise.push(noise)
  buf.seamDistance.push(seam)
}

function finish(ring: number, buffers: FaceBuffer[]): RingMeshData[] {
  return buffers
    .map((buf, quadrant) => ({
      ring,
      quadrant,
      triangles: buf.material.length,
      position: new Float32Array(buf.position),
      normal: new Float32Array(buf.normal),
      material: new Uint8Array(buf.material),
      steep: new Uint8Array(buf.steep),
      stepDay: new Float32Array(buf.stepDay),
      stepNight: new Float32Array(buf.stepNight),
      haze: new Float32Array(buf.haze),
      noise: new Float32Array(buf.noise),
      seamDistance: new Float32Array(buf.seamDistance),
    }))
    .filter((data) => data.triangles > 0)
}

/** How many 1 m slivers the innermost ring-1 cells put along the authored seam. */
const SEAM_SUBDIVISIONS = 10

/** Lattice coordinate, pulled onto the seam line when it sits on the plate rectangle's edge. */
function seamX(x: number): number {
  return x === PLATE_RECT.minX ? x + SEAM_INSET : x === PLATE_RECT.maxX ? x - SEAM_INSET : x
}
function seamZ(z: number): number {
  return z === PLATE_RECT.minZ ? z + SEAM_INSET : z === PLATE_RECT.maxZ ? z - SEAM_INSET : z
}

/** Whether a lattice cell (corners given) lies wholly under the authored water plane as sea. */
function hiddenSea(corners: Vertex[], seaLevel: number): boolean {
  for (const v of corners) {
    if (v.s.material !== 'sea' || v.s.height > seaLevel - 0.3) return false
    if (Math.abs(v.x) >= WATER_PLANE_HALF || Math.abs(v.z) >= WATER_PLANE_HALF) return false
  }
  return true
}

/**
 * One ring → up to four quadrant meshes. `next` is the ring outside this one (its lattice is what
 * the outer boundary snaps to); null for the last ring.
 */
export function buildRing(world: OuterWorld, ring: RingSpec, next: RingSpec | null, seaLevel: number): RingMeshData[] {
  const { cell, outer } = ring
  const n = Math.round((2 * outer) / cell) + 1
  const at = (i: number) => -outer + i * cell
  const isSeam = ring.ring === 1

  // Lattice samples for every vertex on or outside the inner boundary.
  const samples: Array<OuterSample | null> = new Array(n * n).fill(null)
  const heights = new Float64Array(n * n)
  const xs = new Float64Array(n)
  const zs = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = isSeam ? seamX(at(i)) : at(i)
    zs[i] = isSeam ? seamZ(at(i)) : at(i)
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const lx = at(i)
      const lz = at(j)
      // Keep lattice points strictly inside the inner boundary unsampled; boundary points stay.
      if (ring.ring === 1) {
        if (lx > PLATE_RECT.minX && lx < PLATE_RECT.maxX && lz > PLATE_RECT.minZ && lz < PLATE_RECT.maxZ) continue
      } else if (insideRingInner(ring, lx, lz)) continue
      const x = xs[i]
      const z = zs[j]
      const onSeam = isSeam && (lx === PLATE_RECT.minX || lx === PLATE_RECT.maxX || lz === PLATE_RECT.minZ || lz === PLATE_RECT.maxZ) && lx >= PLATE_RECT.minX && lx <= PLATE_RECT.maxX && lz >= PLATE_RECT.minZ && lz <= PLATE_RECT.maxZ
      const s = onSeam ? seamSample(world, x, z) : world.sample(x, z)
      samples[j * n + i] = s
      heights[j * n + i] = s.height
    }
  }

  // Snap the outer boundary onto the coarser lattice beside it so the LOD step has no cracks.
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
    return { x: xs[i], z: zs[j], s: height === s.height ? s : { ...s, height } }
  }

  const inRect = (lx: number, lz: number) => lx >= PLATE_RECT.minX && lx <= PLATE_RECT.maxX && lz >= PLATE_RECT.minZ && lz <= PLATE_RECT.maxZ

  const buffers = [newBuffer(), newBuffer(), newBuffer(), newBuffer()]
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const x0 = at(i)
      const x1 = at(i + 1)
      const z0 = at(j)
      const z1 = at(j + 1)
      // Skip cells inside the inner boundary (all four corners on or inside it).
      const inside = ring.ring === 1 ? inRect(x0, z0) && inRect(x1, z1) : Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1)) <= ring.inner + 1e-6
      if (inside) continue
      const a = vertex(i, j)
      const b = vertex(i + 1, j)
      const c = vertex(i, j + 1)
      const d = vertex(i + 1, j + 1)
      if (hiddenSea([a, b, c, d], seaLevel)) continue

      if (isSeam) {
        // Cells touching the plate along a whole side: slice that side into 1 m slivers so the seam
        // follows the slab outline where the fjord leaves it.
        const side =
          z1 === PLATE_RECT.minZ && x0 >= PLATE_RECT.minX && x1 <= PLATE_RECT.maxX
            ? 'north' // the cell's far edge (c–d) is the seam
            : z0 === PLATE_RECT.maxZ && x0 >= PLATE_RECT.minX && x1 <= PLATE_RECT.maxX
              ? 'south' // the cell's near edge (a–b) is the seam
              : x1 === PLATE_RECT.minX && z0 >= PLATE_RECT.minZ && z1 <= PLATE_RECT.maxZ
                ? 'west' // b–d
                : x0 === PLATE_RECT.maxX && z0 >= PLATE_RECT.minZ && z1 <= PLATE_RECT.maxZ
                  ? 'east' // a–c
                  : null
        if (side) {
          let p0: Vertex
          let p1: Vertex
          let q0: Vertex
          let q1: Vertex
          if (side === 'north') {
            p0 = c
            p1 = d
            q0 = a
            q1 = b
          } else if (side === 'south') {
            p0 = a
            p1 = b
            q0 = c
            q1 = d
          } else if (side === 'west') {
            p0 = b
            p1 = d
            q0 = a
            q1 = c
          } else {
            p0 = a
            p1 = c
            q0 = b
            q1 = d
          }
          const seam: Vertex[] = [p0]
          for (let k = 1; k < SEAM_SUBDIVISIONS; k++) {
            const t = k / SEAM_SUBDIVISIONS
            const sx = p0.x + (p1.x - p0.x) * t
            const sz = p0.z + (p1.z - p0.z) * t
            seam.push({ x: sx, z: sz, s: seamSample(world, sx, sz) })
          }
          seam.push(p1)
          const half = SEAM_SUBDIVISIONS / 2
          for (let k = 0; k < SEAM_SUBDIVISIONS; k++) pushFace(buffers, seaLevel, seam[k], seam[k + 1], k < half ? q0 : q1)
          pushFace(buffers, seaLevel, seam[half], q1, q0)
          continue
        }
      }

      // Alternate the diagonal so the facets do not stripe.
      if ((i + j) % 2 === 0) {
        pushFace(buffers, seaLevel, a, b, c)
        pushFace(buffers, seaLevel, b, d, c)
      } else {
        pushFace(buffers, seaLevel, a, b, d)
        pushFace(buffers, seaLevel, a, d, c)
      }
    }
  }
  return finish(ring.ring, buffers)
}

/** A seam vertex: the world's own material, the slab's own height. */
function seamSample(world: OuterWorld, x: number, z: number): OuterSample {
  const s = world.sample(x, z)
  const height = world.seamHeight(x, z)
  return { ...s, height, material: height > 0 ? 'moss' : 'sea', haze: 0 }
}

export function buildOuterMeshes(world: OuterWorld, seaLevel: number): RingMeshData[] {
  const out: RingMeshData[] = []
  world.rings.forEach((ring, index) => out.push(...buildRing(world, ring, world.rings[index + 1] ?? null, seaLevel)))
  return out
}

export function triangleCount(meshes: RingMeshData[]): number {
  return meshes.reduce((sum, m) => sum + m.triangles, 0)
}

/* ---------- colours ---------- */

const scratchC = new THREE.Color()
const scratchHaze = new THREE.Color()

/** Per-face colours → per-vertex Float32Array (3 verts × rgb), baked with facets, noise and haze. */
export function colourRing(data: RingMeshData, grade: OuterGrade, target?: Float32Array): Float32Array {
  const colors = target ?? new Float32Array(data.triangles * 9)
  const palette = grade.night ? OUTER_COLOURS.night : OUTER_COLOURS.day
  scratchHaze.set(palette.sky)
  const c = scratchC
  for (let f = 0; f < data.triangles; f++) {
    const material = MATERIALS[data.material[f]]
    const steep = data.steep[f] === 1
    const haze = data.haze[f]
    // The seam faces are the slab's own colour; variation fades in over the first 50 m.
    const seamFade = smoothstep(8, 50, data.seamDistance[f])
    switch (material) {
      case 'sea':
        c.set(palette.sea)
        break
      case 'wet':
        c.set(palette.wet)
        break
      case 'moss':
        // The slab's own side walls are the ground colour too: seam faces stay that colour even when steep.
        c.set(steep && data.seamDistance[f] > 8 ? palette.mossSteep : palette.moss)
        break
      case 'sand':
        c.set(steep ? palette.sandSteep : palette.sand)
        break
      case 'lava':
        c.set(steep ? palette.lavaSteep : palette.lava)
        break
      case 'snow':
        c.set(palette.snow)
        break
      case 'ice':
        c.set(steep ? palette.iceSteep : palette.ice)
        break
      case 'tuya':
        c.set(steep ? palette.tuyaSteep : palette.tuya)
        break
      default: {
        c.set(steep ? palette.mountainSteep : palette.mountain)
        break
      }
    }
    if (material === 'mountain' || material === 'tuya' || material === 'snow') {
      // The authored range bakes nothing; ours fades its facet steps with the haze so far rows go flat.
      const step = grade.night ? data.stepNight[f] : data.stepDay[f]
      const faded = 1 - (1 - step) * (1 - haze)
      c.multiplyScalar(material === 'snow' ? 0.6 + 0.4 * faded : faded)
    }
    if (material !== 'sea') c.offsetHSL(0, 0, data.noise[f] * seamFade)
    if (material !== 'sea') c.lerp(scratchHaze, haze * seamFade)
    else c.lerp(scratchHaze, haze * 0.9)
    const o = f * 9
    for (let v = 0; v < 3; v++) {
      colors[o + v * 3] = c.r
      colors[o + v * 3 + 1] = c.g
      colors[o + v * 3 + 2] = c.b
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

/* ---------- far detail geometry (instances) ---------- */

export function paintByNormal(geo: THREE.BufferGeometry, top: string, side: string, haze: number, hazeTo: string): void {
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute
  const colors = new Float32Array(normal.count * 3)
  const c = scratchC
  scratchHaze.set(hazeTo)
  for (let i = 0; i < normal.count; i++) {
    c.set(normal.getY(i) > 0.5 ? top : side)
    c.lerp(scratchHaze, haze)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Moss hummock: a squat dodecahedron, its base on the moor. */
export function hummockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(1, 0).toNonIndexed()
  geo.translate(0, 0.35, 0)
  geo.computeVertexNormals()
  return geo
}

/** Ember crack: a thin slab lying on the crust (unit length along x). */
export function crackGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1, 0.35, 0.5).toNonIndexed()
  geo.translate(0, 0.17, 0)
  geo.computeVertexNormals()
  return geo
}

/** Valley mist lobe: a flattened dodecahedron (opaque, toon-lit like the ambient clouds). */
export function lobeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(1, 0).toNonIndexed()
  geo.computeVertexNormals()
  return geo
}

/** Calved berg in the fjord arm: an irregular six-sided slab from just under the water. */
export function bergGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.85, 1, 1, 6).toNonIndexed()
  geo.translate(0, 0.3, 0)
  geo.computeVertexNormals()
  return geo
}
