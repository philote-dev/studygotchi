/**
 * Endless shelf: turns the pure outer world into flat-shaded three.js geometry.
 *
 * Each LOD ring becomes four quadrant meshes (so frustum culling drops what is behind the camera)
 * of non-indexed triangles: one face, one colour, chunky facets. Ring 1 meets the authored plate
 * on the same 1 m lattice the authored PlaneGeometry uses, with the authored heights, so the seam
 * is watertight. Finer rings snap their outer boundary onto the coarser lattice beside them.
 */
import * as THREE from 'three'
import { ICE_TOWN_PALETTE as P, mountainProfile } from '../../layout/biome-layout'
import { hash2 } from '../../layout/geometry'
import { fbm, smoothstep } from '../../layout/terrain'
import {
  type BergInstance,
  type DuneInstance,
  type FloeInstance,
  type HummockInstance,
  type OuterMaterial,
  type OuterSample,
  type OuterWorld,
  type RingSpec,
  chebyshev,
  driftFloes,
  outerWorldKey,
  packHummocks,
  snowDunes,
  tabularBergs,
} from './outer-world'
import type { BiomeLayout } from '../../layout/biome-layout'

/* ---------- palette (the authored Terrain's choices, so the seam has one voice) ---------- */

const SEA = '#2a5474'
const MOUNTAIN_FACE = '#a3adca'
const STORM_SKY = '#2f3f56'
const DAY_LIGHT = new THREE.Vector3(60, 90, 70).normalize()
const NIGHT_LIGHT = new THREE.Vector3(-40, 60, 30).normalize()
const FACET_STEPS: [number, number, number] = [1, 0.86, 0.7]
const SNOW_LINE = mountainProfile(0.62).snowLine
const UP = new THREE.Vector3(0, 1, 0)

const MATERIAL_CODE: Record<OuterMaterial, number> = { sea: 0, ice: 1, snow: 2, rock: 3, mountain: 4 }
const MATERIALS: OuterMaterial[] = ['sea', 'ice', 'snow', 'rock', 'mountain']

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
  cap: Uint8Array
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
  cap: number[]
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
  return { position: [], normal: [], material: [], steep: [], cap: [], stepDay: [], stepNight: [], haze: [], noise: [] }
}

const scratchA = new THREE.Vector3()
const scratchB = new THREE.Vector3()
const scratchN = new THREE.Vector3()
const scratchV = new THREE.Vector3()

/** Metres past the plate within which mountain faces take smooth normals (the authored skirts reach ~25 m). */
const SMOOTH_SKIRT_REACH = 60
/** Interior lattice vertices move by up to this fraction of a cell (two jittered neighbours can never cross). */
export const LATTICE_JITTER = 0.33

/** Surface normal of the heightfield at (x, z) from central differences (1 m), into `target`. */
function analyticNormal(world: OuterWorld, x: number, z: number, target: THREE.Vector3): THREE.Vector3 {
  const h = (px: number, pz: number) => (chebyshev(px, pz) < world.plateHalf ? world.seamHeight(px, pz) : world.sample(px, pz).height)
  const dx = (h(x + 1, z) - h(x - 1, z)) / 2
  const dz = (h(x, z + 1) - h(x, z - 1)) / 2
  return target.set(-dx, 1, -dz).normalize()
}

function pushFace(buffers: FaceBuffer[], world: OuterWorld, a: Vertex, b: Vertex, c: Vertex): void {
  scratchA.set(b.x - a.x, b.s.height - a.s.height, b.z - a.z)
  scratchB.set(c.x - a.x, c.s.height - a.s.height, c.z - a.z)
  scratchN.crossVectors(scratchA, scratchB)
  if (scratchN.lengthSq() < 1e-9) return
  scratchN.normalize()
  let v0 = a
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

  // Material: the highest corner's (a shore face that climbs onto land is land, not sea bed);
  // faces whose centroid is under water are sea, as are far leads (all three corners sea), whose
  // floor sits just above the water so they are painted with our hazed sea colour instead of
  // showing the unhazed water disc as dark streaks at the horizon.
  let highest = a
  if (b.s.height > highest.s.height) highest = b
  if (c.s.height > highest.s.height) highest = c
  const allSea = a.s.material === 'sea' && b.s.material === 'sea' && c.s.material === 'sea'
  const material: OuterMaterial = allSea || cy < world.seaLevel ? 'sea' : highest.s.material === 'sea' ? 'ice' : highest.s.material
  const peakFrac = Math.max(a.s.peakFrac, b.s.peakFrac, c.s.peakFrac)
  const haze = (a.s.haze + b.s.haze + c.s.haze) / 3
  const steep = scratchN.y < 0.8 ? 1 : 0
  const cap = material === 'mountain' && peakFrac >= SNOW_LINE ? 1 : 0
  const stepDay = facetStep(scratchN.x, scratchN.y, scratchN.z, DAY_LIGHT)
  const stepNight = facetStep(scratchN.x, scratchN.y, scratchN.z, NIGHT_LIGHT)
  // Lightness per facet: a slow drift plus a per-face jitter so neighbouring flat facets differ
  // (the toon ramp lights every near-flat face the same, so this is what reads as facets on the
  // pack). Both fade with the haze: the far rings should go flat.
  const noise =
    (0.02 * fbm(cx * 0.01 + 3.1, cz * 0.01 + 0.7, 2) + 0.022 * fbm(cx * 0.07 + 8.8, cz * 0.07 + 2.2, 2) + 0.014 * (hash2(cx * 0.37 + 1.3, cz * 0.53 + 4.1) - 0.5)) *
    (1 - haze)

  // Far faces lose their runtime toon shading: normals lean toward up as the haze grows, so the
  // horizon dissolves instead of flashing lit / shade facets against the sky.
  const flatten = smoothstep(0.35, 0.9, haze)
  scratchN.lerp(UP, flatten).normalize()

  // The authored back rows' skirts carried past the seam are smooth-shaded like the plate (the
  // plate's 1 m lattice has vertex normals; our 5 m facets would turn each skirt into a pyramid).
  const smooth = material === 'mountain' && chebyshev(cx, cz) < world.plateHalf + SMOOTH_SKIRT_REACH
  for (const v of [v0, v1, v2]) {
    buf.position.push(v.x, v.s.height, v.z)
    if (smooth) {
      analyticNormal(world, v.x, v.z, scratchV)
      buf.normal.push(scratchV.x, scratchV.y, scratchV.z)
    } else {
      buf.normal.push(scratchN.x, scratchN.y, scratchN.z)
    }
  }
  buf.material.push(MATERIAL_CODE[material])
  // North of the plate steep snow is the back of the range, never a coast cliff (the plate's rule).
  buf.steep.push(steep === 1 && material === 'snow' && cz < -world.plateHalf + 6 ? 0 : steep)
  buf.cap.push(cap)
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
      cap: new Uint8Array(buf.cap),
      stepDay: new Float32Array(buf.stepDay),
      stepNight: new Float32Array(buf.stepNight),
      haze: new Float32Array(buf.haze),
      noise: new Float32Array(buf.noise),
    }))
    .filter((data) => data.triangles > 0)
}

/**
 * One ring → up to four quadrant meshes. `next` is the ring outside this one (its lattice is what
 * the outer boundary snaps to); null for the last ring. The innermost ring slices the cells along
 * the authored seam into 1 m slivers so its seam vertices coincide with the authored lattice.
 */
export function buildRing(world: OuterWorld, ring: RingSpec, next: RingSpec | null): RingMeshData[] {
  const { cell, inner, outer } = ring
  const n = Math.round((2 * outer) / cell) + 1
  const at = (i: number) => -outer + i * cell
  const innerIndex = Math.round((outer - inner) / cell)
  const outerIndex = n - 1 - innerIndex
  const isSeam = Math.abs(inner - world.plateHalf) < 1e-6
  const SEAM_SUBDIVISIONS = Math.max(2, Math.round(cell))

  // Lattice samples for every vertex on or outside the inner boundary. Interior vertices are
  // jittered by up to a third of a cell (seeded per ring) so the tiles' edges stop lining up
  // into straight axis-aligned leads; vertices on the ring's inner and outer boundaries stay on
  // the lattice because the neighbouring rings share them.
  const samples: Array<OuterSample | null> = new Array(n * n).fill(null)
  const heights = new Float64Array(n * n)
  const xs = new Float64Array(n * n)
  const zs = new Float64Array(n * n)
  const jitter = LATTICE_JITTER * cell
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let x = at(i)
      let z = at(j)
      const cheb = chebyshev(x, z)
      if (cheb < inner - 1e-6) continue
      const boundary = Math.abs(cheb - inner) < 1e-6 || Math.abs(cheb - outer) < 1e-6
      if (!boundary) {
        x += (hash2(i + ring.ring * 977 + 0.5, j + 0.5) - 0.5) * 2 * jitter
        z += (hash2(j + ring.ring * 613 + 0.5, i + 0.5) - 0.5) * 2 * jitter
      }
      const s = world.sample(x, z)
      const onSeam = isSeam && Math.abs(cheb - inner) < 1e-6
      const height = onSeam ? world.seamHeight(x, z) : s.height
      samples[j * n + i] = s
      heights[j * n + i] = height
      xs[j * n + i] = x
      zs[j * n + i] = z
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
    snap((k) => k * n) // x = -outer
    snap((k) => k * n + (n - 1)) // x = +outer
    snap((k) => k) // z = -outer
    snap((k) => (n - 1) * n + k) // z = +outer
  }

  const vertex = (i: number, j: number): Vertex => {
    const s = samples[j * n + i]!
    const height = heights[j * n + i]
    return { x: xs[j * n + i], z: zs[j * n + i], s: height === s.height ? s : { ...s, height } }
  }
  const seamVertex = (x: number, z: number): Vertex => {
    const s = world.sample(x, z)
    return { x, z, s: { ...s, height: world.seamHeight(x, z) } }
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

      if (isSeam) {
        // Cells touching the plate edge along a whole side: slice that side into 1 m slivers so the
        // seam vertices coincide with the authored 1 m lattice.
        const side =
          j + 1 === innerIndex && i >= innerIndex && i < outerIndex
            ? 'south' // our z = -inner edge is the cell's far edge (c–d)
            : j === outerIndex && i >= innerIndex && i < outerIndex
              ? 'north' // our z = +inner edge is the cell's near edge (a–b)
              : i + 1 === innerIndex && j >= innerIndex && j < outerIndex
                ? 'east' // x = -inner edge is b–d
                : i === outerIndex && j >= innerIndex && j < outerIndex
                  ? 'west' // x = +inner edge is a–c
                  : null
        if (side) {
          // Seam edge p0→p1 (on the plate) and the opposite edge q0→q1 (one cell out).
          let p0: Vertex
          let p1: Vertex
          let q0: Vertex
          let q1: Vertex
          if (side === 'south') {
            p0 = c
            p1 = d
            q0 = a
            q1 = b
          } else if (side === 'north') {
            p0 = a
            p1 = b
            q0 = c
            q1 = d
          } else if (side === 'east') {
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
            seam.push(seamVertex(p0.x + (p1.x - p0.x) * t, p0.z + (p1.z - p0.z) * t))
          }
          seam.push(p1)
          const half = Math.floor(SEAM_SUBDIVISIONS / 2)
          for (let k = 0; k < SEAM_SUBDIVISIONS; k++) pushFace(buffers, world, seam[k], seam[k + 1], k < half ? q0 : q1)
          pushFace(buffers, world, seam[half], q1, q0)
          continue
        }
      }

      // Alternate the diagonal so the facets do not stripe.
      if ((i + j) % 2 === 0) {
        pushFace(buffers, world, a, b, c)
        pushFace(buffers, world, b, d, c)
      } else {
        pushFace(buffers, world, a, b, d)
        pushFace(buffers, world, a, d, c)
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

export type BuildStep =
  | { kind: 'ring'; ring: number; meshes: RingMeshData[] }
  | { kind: 'detail'; hummocks: HummockInstance[]; dunes: DuneInstance[] }
  | { kind: 'drift'; floes: FloeInstance[]; bergs: BergInstance[] }

/**
 * The whole outer world as resumable steps, nearest first: ring 0 (which carries the plate seam)
 * so the first frame already joins the land, then rings 1–3, then the instanced detail. The
 * scene takes the first step synchronously on mount and one more per frame after that, so the
 * ~240 ms build never lands on a single frame.
 */
export function* buildOuterWorldSteps(world: OuterWorld): Generator<BuildStep, void, void> {
  for (let i = 0; i < world.rings.length; i++) {
    const ring = world.rings[i]
    yield { kind: 'ring', ring: ring.ring, meshes: buildRing(world, ring, world.rings[i + 1] ?? null) }
  }
  yield { kind: 'detail', hummocks: packHummocks(world), dunes: snowDunes(world) }
  yield { kind: 'drift', floes: driftFloes(world), bergs: tabularBergs(world) }
}

/** Every step at once (the Worker's job; the scene installs them with `primeOuterSteps`). */
export function buildOuterWorldAll(world: OuterWorld): BuildStep[] {
  return [...buildOuterWorldSteps(world)]
}

/** The typed-array buffers of ring meshes among `steps` (for `postMessage` transfer). */
export function outerStepsTransferables(steps: readonly BuildStep[]): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>()
  for (const step of steps) {
    if (step.kind !== 'ring') continue
    for (const m of step.meshes) for (const a of [m.position, m.normal, m.material, m.steep, m.cap, m.stepDay, m.stepNight, m.haze, m.noise]) out.add(a.buffer as ArrayBuffer)
  }
  return [...out]
}

const primedSteps = new WeakMap<BiomeLayout, Map<string, BuildStep[]>>()

/** Install steps built elsewhere (the land build Worker) for the world with this key (`outerWorldKey`). */
export function primeOuterSteps(layout: BiomeLayout, key: string, steps: BuildStep[]): void {
  let per = primedSteps.get(layout)
  if (!per) {
    per = new Map()
    primedSteps.set(layout, per)
  }
  per.set(key, steps)
}

/** The primed steps for `world`, if a build landed for it; the scene applies them all in one go instead of one per frame. */
export function primedOuterSteps(world: OuterWorld): BuildStep[] | null {
  return primedSteps.get(world.layout)?.get(outerWorldKey(world.seed, world.options)) ?? null
}

export function triangleCount(meshes: RingMeshData[]): number {
  return meshes.reduce((sum, m) => sum + m.triangles, 0)
}

/* ---------- colours ---------- */

export interface OuterGrade {
  night: boolean
  storm: boolean
}

export function hazeColour(grade: OuterGrade): string {
  return grade.storm ? STORM_SKY : grade.night ? P.skyNight : P.sky
}

const scratchC = new THREE.Color()
const scratchHaze = new THREE.Color()

/** Per-face colours → per-vertex Float32Array (3 verts × rgb), baked with facets, noise and haze. */
export function colourRing(data: RingMeshData, grade: OuterGrade, target?: Float32Array): Float32Array {
  const colors = target ?? new Float32Array(data.triangles * 9)
  scratchHaze.set(hazeColour(grade))
  const c = scratchC
  for (let f = 0; f < data.triangles; f++) {
    const material = MATERIALS[data.material[f]]
    const steep = data.steep[f] === 1
    const cap = data.cap[f] === 1
    const haze = data.haze[f]
    switch (material) {
      case 'sea':
        c.set(SEA)
        break
      case 'ice':
        c.set(steep ? P.cliffIce : P.paleIce)
        break
      case 'snow':
        c.set(steep ? P.cliffIce : P.snow)
        break
      case 'rock':
        c.set(steep ? P.rockDeep : P.rock)
        break
      case 'mountain': {
        c.set(cap ? P.snow : steep ? MOUNTAIN_FACE : P.snowShadow)
        // The authored range bakes its facet steps; ours fade with the haze so far rows go flat.
        const step = grade.night ? data.stepNight[f] : data.stepDay[f]
        const faded = 1 - (1 - step) * (1 - haze)
        c.multiplyScalar(cap ? 0.55 + 0.45 * faded : faded)
        break
      }
    }
    if (material !== 'sea') c.offsetHSL(0, 0, data.noise[f])
    if (grade.night && material !== 'sea') c.offsetHSL(0.03, 0.05, material === 'mountain' ? -0.1 : -0.16)
    if (material !== 'sea') c.lerp(scratchHaze, haze)
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

/* ---------- far detail geometry ---------- */

function paintByNormal(geo: THREE.BufferGeometry, top: string, side: string, haze: number, hazeTo: string, night: boolean): void {
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute
  const colors = new Float32Array(normal.count * 3)
  const c = scratchC
  scratchHaze.set(hazeTo)
  for (let i = 0; i < normal.count; i++) {
    c.set(normal.getY(i) > 0.5 ? top : side)
    if (night) c.offsetHSL(0.03, 0.05, -0.14)
    c.lerp(scratchHaze, haze)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Drift floe: a hexagonal slab, snow on top, ice-blue sides; its centre sits at the waterline. */
export function floeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(1, 1.08, 0.6, 6).toNonIndexed()
  geo.computeVertexNormals()
  return geo
}

/** Pressure-ridge hummock: a five-sided cone with its base on the ice. */
export function hummockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(1, 1, 5).toNonIndexed()
  geo.translate(0, 0.5, 0)
  geo.computeVertexNormals()
  return geo
}

/** Tabular berg: an irregular seven-sided prism from just under the waterline (y = -0.25) to y = 1. */
export function bergGeometry(): THREE.BufferGeometry {
  const sides = 7
  const radii = [1, 0.78, 1.04, 0.86, 0.96, 0.72, 0.9]
  const ring: Array<[number, number]> = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + 0.3
    ring.push([Math.cos(a) * radii[i], Math.sin(a) * radii[i]])
  }
  const positions: number[] = []
  const push = (x: number, y: number, z: number) => positions.push(x, y, z)
  const bottom = -0.25
  for (let i = 0; i < sides; i++) {
    const [x0, z0] = ring[i]
    const [x1, z1] = ring[(i + 1) % sides]
    // Side quad, outward facing.
    push(x0, bottom, z0)
    push(x0, 1, z0)
    push(x1, 1, z1)
    push(x0, bottom, z0)
    push(x1, 1, z1)
    push(x1, bottom, z1)
    // Top fan, upward facing.
    push(0, 1, 0)
    push(x1, 1, z1)
    push(x0, 1, z0)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

/**
 * Sastrugi: a long low wedge (unit length along z, unit width across, unit height), a sharp
 * windward ridge line so the toon ramp shades its two flanks differently.
 */
export function duneGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const push = (...v: number[]) => positions.push(...v)
  // Ridge offset to one side (windward flank steeper), tapered ends.
  const r = -0.18
  const a = [-0.5, 0, -0.5]
  const b = [0.5, 0, -0.5]
  const c = [0.5, 0, 0.5]
  const d = [-0.5, 0, 0.5]
  const r0 = [r, 1, -0.32]
  const r1 = [r, 1, 0.32]
  const tri = (p: number[], q: number[], s: number[]) => push(p[0], p[1], p[2], q[0], q[1], q[2], s[0], s[1], s[2])
  // Left flank (x < r) and right flank (x > r), each two triangles, plus the two end caps.
  tri(a, r0, d)
  tri(d, r0, r1)
  tri(b, c, r0)
  tri(r0, c, r1)
  tri(a, b, r0)
  tri(d, r1, c)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  // Fix any face that ended up pointing down.
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  for (let f = 0; f < pos.count / 3; f++) {
    if (normal.getY(f * 3) >= 0) continue
    const i = f * 3 + 1
    const j = f * 3 + 2
    const tmp = [pos.getX(i), pos.getY(i), pos.getZ(i)]
    pos.setXYZ(i, pos.getX(j), pos.getY(j), pos.getZ(j))
    pos.setXYZ(j, tmp[0], tmp[1], tmp[2])
  }
  geo.computeVertexNormals()
  return geo
}

export function paintDune(geo: THREE.BufferGeometry, grade: OuterGrade): void {
  paintByNormal(geo, P.snow, P.snowShadow, 0.1, hazeColour(grade), grade.night)
}

export function paintFloe(geo: THREE.BufferGeometry, grade: OuterGrade): void {
  paintByNormal(geo, P.snow, P.cliffIce, 0.12, hazeColour(grade), grade.night)
}

export function paintHummock(geo: THREE.BufferGeometry, grade: OuterGrade): void {
  paintByNormal(geo, P.snow, P.paleIce, 0.28, hazeColour(grade), grade.night)
}

export function paintBerg(geo: THREE.BufferGeometry, grade: OuterGrade): void {
  paintByNormal(geo, P.snow, P.paleIce, 0.3, hazeColour(grade), grade.night)
}
