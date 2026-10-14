/**
 * Endless jungle: turns the pure heightfield into flat-shaded three.js geometry.
 *
 * Each LOD ring becomes four quadrant meshes (so frustum culling drops what is behind the
 * camera) of non-indexed triangles: one face, one colour, chunky facets. Ring 1 meets the flat
 * authored plate at y = 0 along the Chebyshev square |x|,|z| = 190, so the seam is watertight;
 * finer rings snap their outer boundary onto the coarser lattice beside them (no T-junction
 * cracks). Colours are baked per face: material, canopy closure, a three-step facet shade, a
 * little lightness noise, and the haze toward the mist colour that does the aerial perspective.
 */
import * as THREE from 'three'
import { JUNGLE_PALETTE as P } from '../../layout/jungle-layout'
import { chebyshev, fbm, smoothstep } from '../noise'
import { mistColour, type OuterMaterial, type OuterSample, type OuterWorld, type RingSpec } from './heightfield'

/* ---------- palette ---------- */

const DAY = {
  ground: P.ground,
  groundAlt: P.groundAlt,
  canopy: P.canopy,
  canopyFar: P.canopyDark,
  cliff: P.cliff,
  rock: '#617c55',
  bank: '#609b58',
  wet: P.wet,
  sea: '#5fb0b8',
  volcano: '#5a5650',
  crater: '#3b3733',
} as const

const NIGHT = {
  ground: '#294a38',
  groundAlt: '#31563e',
  canopy: P.canopyNight,
  canopyFar: '#12271f',
  cliff: '#2f4a35',
  rock: '#36443a',
  bank: '#2c5340',
  wet: '#1b4d50',
  sea: '#1b4f55',
  volcano: '#2e2c2a',
  crater: '#1f1d1c',
} as const

const DAY_LIGHT = new THREE.Vector3(65, 105, 62).normalize()
const NIGHT_LIGHT = new THREE.Vector3(-55, 74, 30).normalize()
const FACET_STEPS: [number, number, number] = [1, 0.88, 0.74]
const UP = new THREE.Vector3(0, 1, 0)

const MATERIALS: OuterMaterial[] = ['ground', 'canopy', 'bank', 'wet', 'sea', 'volcano', 'crater']
const MATERIAL_CODE: Record<OuterMaterial, number> = Object.fromEntries(MATERIALS.map((m, i) => [m, i])) as Record<OuterMaterial, number>

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
  /** 0 flat, 1 cliff (ny < 0.8), 2 rock (ny < 0.6). */
  steep: Uint8Array
  canopy: Float32Array
  stepDay: Float32Array
  stepNight: Float32Array
  haze: Float32Array
  noise: Float32Array
}

interface FaceBuffer {
  position: number[]
  normal: number[]
  material: number[]
  steep: number[]
  canopy: number[]
  stepDay: number[]
  stepNight: number[]
  haze: number[]
  noise: number[]
}

interface Vertex {
  x: number
  z: number
  s: OuterSample
}

function newBuffer(): FaceBuffer {
  return { position: [], normal: [], material: [], steep: [], canopy: [], stepDay: [], stepNight: [], haze: [], noise: [] }
}

const scratchA = new THREE.Vector3()
const scratchB = new THREE.Vector3()
const scratchN = new THREE.Vector3()

function pushFace(buffers: FaceBuffer[], a: Vertex, b: Vertex, c: Vertex): void {
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
  const quadrant = (cx >= 0 ? 1 : 0) + (cz >= 0 ? 2 : 0)
  const buf = buffers[quadrant]

  // Material: the lowest corner's for water (a bank face that dips to the river is wet), else the highest corner's.
  let highest = a
  let lowest = a
  for (const v of [b, c]) {
    if (v.s.height > highest.s.height) highest = v
    if (v.s.height < lowest.s.height) lowest = v
  }
  const material: OuterMaterial = lowest.s.material === 'sea' || lowest.s.material === 'wet' ? lowest.s.material : highest.s.material
  const canopy = (a.s.canopy + b.s.canopy + c.s.canopy) / 3
  const haze = (a.s.haze + b.s.haze + c.s.haze) / 3
  const steep = scratchN.y < 0.6 ? 2 : scratchN.y < 0.8 ? 1 : 0
  // The facet bake and the lightness noise fade in off the seam so the first faces match the
  // plate's flat colour exactly (the toon lighting is the same material on both sides).
  const offSeam = smoothstep(40, 120, chebyshev(cx, cz) - 190)
  const stepDay = 1 - (1 - facetStep(scratchN.x, scratchN.y, scratchN.z, DAY_LIGHT)) * offSeam
  const stepNight = 1 - (1 - facetStep(scratchN.x, scratchN.y, scratchN.z, NIGHT_LIGHT)) * offSeam
  const noise = 0.03 * (fbm(cx * 0.01 + 3.1, cz * 0.01 + 0.7, 2) - 0.5) * offSeam

  // Far faces lose their runtime toon shading: normals lean toward up as the haze grows, so the
  // horizon dissolves instead of flashing lit / shade facets against the sky.
  const flatten = smoothstep(0.25, 0.7, haze)
  scratchN.lerp(UP, flatten).normalize()

  for (const v of [a, v1, v2]) {
    buf.position.push(v.x, v.s.height, v.z)
    buf.normal.push(scratchN.x, scratchN.y, scratchN.z)
  }
  buf.material.push(MATERIAL_CODE[material])
  buf.steep.push(steep)
  buf.canopy.push(canopy)
  buf.stepDay.push(stepDay)
  buf.stepNight.push(stepNight)
  buf.haze.push(haze)
  buf.noise.push(noise)
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
      canopy: new Float32Array(buf.canopy),
      stepDay: new Float32Array(buf.stepDay),
      stepNight: new Float32Array(buf.stepNight),
      haze: new Float32Array(buf.haze),
      noise: new Float32Array(buf.noise),
    }))
    .filter((data) => data.triangles > 0)
}

/**
 * One ring → up to four quadrant meshes. `next` is the ring outside this one (its lattice is what
 * the outer boundary snaps to); null for the last ring.
 */
export function buildRing(world: OuterWorld, ring: RingSpec, next: RingSpec | null): RingMeshData[] {
  const { cell, inner, outer } = ring
  const n = Math.round((2 * outer) / cell) + 1
  const at = (i: number) => -outer + i * cell
  const innerIndex = Math.round((outer - inner) / cell)
  const outerIndex = n - 1 - innerIndex
  const isSeam = ring.ring === 1

  const samples: Array<OuterSample | null> = new Array(n * n).fill(null)
  const heights = new Float64Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = at(i)
      const z = at(j)
      if (chebyshev(x, z) < inner - 1e-6) continue
      const s = world.sample(x, z)
      const onSeam = isSeam && Math.abs(chebyshev(x, z) - inner) < 1e-6
      samples[j * n + i] = s
      heights[j * n + i] = onSeam ? world.seamHeight(x, z) : s.height
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
    return { x: at(i), z: at(j), s: height === s.height ? s : { ...s, height } }
  }

  const buffers = [newBuffer(), newBuffer(), newBuffer(), newBuffer()]
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const insidePlate = i >= innerIndex && i + 1 <= outerIndex && j >= innerIndex && j + 1 <= outerIndex
      if (insidePlate) continue
      const a = vertex(i, j)
      const b = vertex(i + 1, j)
      const c = vertex(i, j + 1)
      const d = vertex(i + 1, j + 1)
      // Alternate the diagonal so the facets do not stripe.
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

export function buildOuterMeshes(world: OuterWorld): RingMeshData[] {
  const out: RingMeshData[] = []
  world.rings.forEach((ring, index) => out.push(...buildRing(world, ring, world.rings[index + 1] ?? null)))
  return out
}

export function triangleCount(meshes: RingMeshData[]): number {
  return meshes.reduce((sum, m) => sum + m.triangles, 0)
}

/* ---------- colours ---------- */

export interface OuterGrade {
  night: boolean
}

const scratchC = new THREE.Color()
const scratchD = new THREE.Color()
const scratchHaze = new THREE.Color()

/** Per-face colours → per-vertex Float32Array (3 verts × rgb), baked with facets, noise and haze. */
export function colourRing(data: RingMeshData, grade: OuterGrade, target?: Float32Array): Float32Array {
  const colors = target ?? new Float32Array(data.triangles * 9)
  const pal = grade.night ? NIGHT : DAY
  scratchHaze.set(mistColour(grade.night))
  const c = scratchC
  for (let f = 0; f < data.triangles; f++) {
    const material = MATERIALS[data.material[f]]
    const steep = data.steep[f]
    const haze = data.haze[f]
    const canopy = data.canopy[f]
    let lit = true
    switch (material) {
      case 'sea':
        c.set(pal.sea)
        lit = false
        break
      case 'wet':
        c.set(pal.wet)
        lit = false
        break
      case 'bank':
        c.set(pal.bank)
        break
      case 'volcano':
        c.set(steep ? pal.volcano : pal.rock)
        break
      case 'crater':
        c.set(pal.crater)
        break
      default: {
        // Open floor → closed canopy with distance; the far canopy takes the second-row palette.
        c.set(pal.ground).lerp(scratchD.set(pal.canopy), canopy)
        c.lerp(scratchD.set(pal.canopyFar), smoothstep(0.3, 0.75, haze) * canopy)
        if (steep === 2) c.set(pal.rock)
        else if (steep === 1) c.lerp(scratchD.set(pal.cliff), 0.7)
        break
      }
    }
    if (lit) {
      const step = grade.night ? data.stepNight[f] : data.stepDay[f]
      // The facet bake fades with the haze so far rows go flat.
      c.multiplyScalar(1 - (1 - step) * (1 - haze))
      c.offsetHSL(0, 0, data.noise[f])
    }
    c.lerp(scratchHaze, haze)
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
