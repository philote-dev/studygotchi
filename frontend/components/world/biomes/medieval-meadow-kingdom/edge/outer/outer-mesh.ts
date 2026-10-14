/**
 * Endless meadow: turns the pure outer world into flat-shaded three.js geometry.
 *
 * Each LOD ring becomes four quadrant meshes (so frustum culling drops what is behind the camera)
 * of non-indexed triangles: one face, one colour. The lattice is global (x = i · cell, z = j · cell)
 * and the plate's edges sit on it, so ring 1 meets the flat plate exactly at y = 0; a finer ring's
 * outer boundary is snapped onto the coarser lattice beside it so the LOD step has no cracks.
 * Colours are baked per face from the sample's material / tone / haze and can be regraded in
 * place for night.
 */
import * as THREE from 'three'
import type { Point2 } from '../../layout/biome-layout'
import { type Rect, rectDistance } from '../../layout/terrain'
import { smoothstep } from '../noise'
import { clipPolygonToRect, fieldPolygon, fieldRange, fieldTone } from './fields'
import type { OuterMaterial, OuterSample, OuterWorld, RingSpec } from './outer-world'
import { OUTER_COLOURS, type OuterGrade, fieldToneColour, hillColour, skyColour, waterColour } from './palette'

const MATERIALS: OuterMaterial[] = ['meadow', 'bank', 'water', 'hill', 'rock', 'forest', 'crag']
const MATERIAL_CODE: Record<OuterMaterial, number> = { meadow: 0, bank: 1, water: 2, hill: 3, rock: 4, forest: 5, crag: 6 }
const UP = new THREE.Vector3(0, 1, 0)

export interface RingMeshData {
  ring: number
  quadrant: number
  triangles: number
  position: Float32Array
  normal: Float32Array
  /** Per face. */
  material: Uint8Array
  tone: Uint8Array
  steep: Uint8Array
  haze: Float32Array
  /** 0–1 field patchwork contrast (fades toward the rows and the far rings). */
  patch: Float32Array
  noise: Float32Array
}

interface FaceBuffer {
  position: number[]
  normal: number[]
  material: number[]
  tone: number[]
  steep: number[]
  haze: number[]
  patch: number[]
  noise: number[]
}

interface Vertex {
  x: number
  z: number
  s: OuterSample
  height: number
}

function newBuffer(): FaceBuffer {
  return { position: [], normal: [], material: [], tone: [], steep: [], haze: [], patch: [], noise: [] }
}

const scratchA = new THREE.Vector3()
const scratchB = new THREE.Vector3()
const scratchN = new THREE.Vector3()

function pushFace(buffers: FaceBuffer[], world: OuterWorld, quadrant: number, a: Vertex, b: Vertex, c: Vertex): void {
  scratchA.set(b.x - a.x, b.height - a.height, b.z - a.z)
  scratchB.set(c.x - a.x, c.height - a.height, c.z - a.z)
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
  const buf = buffers[quadrant]

  // Material and tone by majority of the corners (two agreeing corners win, else the first).
  const material = a.s.material === b.s.material || a.s.material === c.s.material ? a.s.material : b.s.material === c.s.material ? b.s.material : a.s.material
  const tone = a.s.tone === b.s.tone || a.s.tone === c.s.tone ? a.s.tone : b.s.tone === c.s.tone ? b.s.tone : a.s.tone
  const steep = scratchN.y < 0.88 ? 1 : 0
  const haze = (a.s.haze + b.s.haze + c.s.haze) / 3
  // Far faces lose their runtime toon shading: normals lean toward up as the haze grows, so the
  // horizon dissolves instead of flashing lit / shade facets against the sky.
  const flatten = smoothstep(0.3, 0.8, haze)
  scratchN.lerp(UP, flatten).normalize()
  const noise = 0.02 * ((Math.sin(cx * 0.37 + cz * 0.11) + Math.sin(cx * 0.05 - cz * 0.23)) * 0.5)

  for (const v of [a, v1, v2]) {
    buf.position.push(v.x, v.height, v.z)
    buf.normal.push(scratchN.x, scratchN.y, scratchN.z)
  }
  buf.material.push(MATERIAL_CODE[material])
  buf.tone.push(tone)
  buf.steep.push(steep)
  buf.haze.push(haze)
  buf.patch.push(world.patchwork(cx, cz))
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
      tone: new Uint8Array(buf.tone),
      steep: new Uint8Array(buf.steep),
      haze: new Float32Array(buf.haze),
      patch: new Float32Array(buf.patch),
      noise: new Float32Array(buf.noise),
    }))
    .filter((data) => data.triangles > 0)
}

/** Lattice index range (inclusive) covering the plate rect grown by `outer`. */
function latticeRange(plate: Rect, outer: number, cell: number) {
  return {
    i0: Math.floor((plate.minX - outer) / cell),
    i1: Math.ceil((plate.maxX + outer) / cell),
    j0: Math.floor((plate.minZ - outer) / cell),
    j1: Math.ceil((plate.maxZ + outer) / cell),
  }
}

/** Quadrant of a point: bit 0 east of x = 0, bit 1 south of the plate's centre line. */
export function quadrantOf(x: number, z: number, centreZ: number): number {
  return (x >= 0 ? 1 : 0) + (z >= centreZ ? 2 : 0)
}

/**
 * One ring → up to four quadrant meshes (or just `quadrant`, so the build can spread one ring over
 * several frames). `next` is the ring outside this one (its lattice is what the outer boundary
 * snaps to); null for the last ring.
 */
export function buildRing(world: OuterWorld, ring: RingSpec, next: RingSpec | null, quadrant: number | null = null): RingMeshData[] {
  const { cell, inner, outer } = ring
  const plate = world.plate
  const centreZ = (plate.minZ + plate.maxZ) / 2
  const range = latticeRange(plate, outer, cell)
  const nx = range.i1 - range.i0 + 1
  const nz = range.j1 - range.j0 + 1
  const at = (i: number, j: number) => [(range.i0 + i) * cell, (range.j0 + j) * cell] as const

  // Cell membership by the cell centre's Chebyshev distance to the plate (and quadrant); vertices are shared.
  const member = new Uint8Array((nx - 1) * (nz - 1))
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const [x, z] = at(i, j)
      const cx = x + cell / 2
      const cz = z + cell / 2
      const d = rectDistance(plate, cx, cz)
      const inRing = d >= inner && d < outer
      const inQuadrant = quadrant === null || quadrantOf(cx, cz, centreZ) === quadrant
      member[j * (nx - 1) + i] = inRing && inQuadrant ? 1 : 0
    }
  }
  const samples: Array<OuterSample | null> = new Array(nx * nz).fill(null)
  const heights = new Float64Array(nx * nz)
  const sampleAt = (i: number, j: number): OuterSample => {
    const k = j * nx + i
    let s = samples[k]
    if (!s) {
      const [x, z] = at(i, j)
      s = world.sampleLattice(x, z)
      samples[k] = s
      heights[k] = s.height
    }
    return s
  }
  // Touch every vertex of every member cell so the heights array is complete before snapping.
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (!member[j * (nx - 1) + i]) continue
      sampleAt(i, j)
      sampleAt(i + 1, j)
      sampleAt(i, j + 1)
      sampleAt(i + 1, j + 1)
    }
  }

  // Snap this ring's outer boundary onto the coarser lattice beside it so the LOD step has no cracks.
  if (next) {
    const ratio = Math.round(next.cell / cell)
    const onOuter = (i: number, j: number) => {
      const [x, z] = at(i, j)
      return Math.abs(rectDistance(plate, x, z) - outer) < 1e-6
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (!samples[j * nx + i] || !onOuter(i, j)) continue
        const [x, z] = at(i, j)
        const gi = Math.round(x / cell)
        const gj = Math.round(z / cell)
        const offX = ((gi % ratio) + ratio) % ratio
        const offZ = ((gj % ratio) + ratio) % ratio
        if (offX === 0 && offZ === 0) continue
        // Along which axis does the boundary run here? The off-lattice coordinate is the one to interpolate.
        const axisX = offX !== 0
        const off = axisX ? offX : offZ
        const i0 = axisX ? i - off : i
        const j0 = axisX ? j : j - off
        const i1 = axisX ? i0 + ratio : i
        const j1 = axisX ? j : j0 + ratio
        if (i0 < 0 || j0 < 0 || i1 >= nx || j1 >= nz) continue
        const h0 = sampleAt(i0, j0).height
        const h1 = sampleAt(i1, j1).height
        heights[j * nx + i] = h0 + (h1 - h0) * (off / ratio)
      }
    }
  }

  const vertex = (i: number, j: number): Vertex => {
    const s = sampleAt(i, j)
    const [x, z] = at(i, j)
    return { x, z, s, height: heights[j * nx + i] }
  }

  const buffers = [newBuffer(), newBuffer(), newBuffer(), newBuffer()]
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (!member[j * (nx - 1) + i]) continue
      const a = vertex(i, j)
      const b = vertex(i + 1, j)
      const c = vertex(i, j + 1)
      const d = vertex(i + 1, j + 1)
      const q = quadrantOf(a.x + cell / 2, a.z + cell / 2, centreZ)
      // Alternate the diagonal so the facets do not stripe (global lattice parity, as `meshHeight` assumes).
      if ((((range.i0 + i + range.j0 + j) % 2) + 2) % 2 === 0) {
        pushFace(buffers, world, q, a, b, c)
        pushFace(buffers, world, q, b, d, c)
      } else {
        pushFace(buffers, world, q, a, b, d)
        pushFace(buffers, world, q, a, d, c)
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

/** The per-frame build units: ring 1 by quadrant (the biggest), rings 2 and 3 whole. */
export function ringBuildUnits(world: OuterWorld): Array<{ label: string; build: () => RingMeshData[] }> {
  const units: Array<{ label: string; build: () => RingMeshData[] }> = []
  world.rings.forEach((ring, index) => {
    const next = world.rings[index + 1] ?? null
    if (ring.ring === 1) {
      for (let q = 0; q < 4; q++) units.push({ label: `ring1-q${q}`, build: () => buildRing(world, ring, next, q) })
    } else {
      units.push({ label: `ring${ring.ring}`, build: () => buildRing(world, ring, next) })
    }
  })
  return units
}

export function triangleCount(meshes: RingMeshData[]): number {
  return meshes.reduce((sum, m) => sum + m.triangles, 0)
}

/* ---------- colours ---------- */

const scratchC = new THREE.Color()
const scratchHaze = new THREE.Color()
const scratchTone0 = new THREE.Color()
const scratchHill = new THREE.Color()

/** Per-face colours → per-vertex Float32Array (3 verts × rgb), baked with haze and a little grain. */
export function colourRing(data: RingMeshData, grade: OuterGrade, target?: Float32Array): Float32Array {
  const colors = target ?? new Float32Array(data.triangles * 9)
  scratchHaze.set(skyColour(grade))
  scratchTone0.set(fieldToneColour(0, grade))
  scratchHill.set(hillColour(grade))
  const c = scratchC
  for (let f = 0; f < data.triangles; f++) {
    const material = MATERIALS[data.material[f]]
    const steep = data.steep[f] === 1
    const haze = data.haze[f]
    switch (material) {
      case 'water':
        c.set(waterColour(grade))
        break
      case 'bank':
        c.set(OUTER_COLOURS.bank)
        break
      case 'rock':
        c.set(steep ? OUTER_COLOURS.rockSide : OUTER_COLOURS.rockTop)
        break
      case 'crag':
        c.set(steep ? OUTER_COLOURS.cragSide : OUTER_COLOURS.cragTop)
        break
      case 'forest':
        c.set(OUTER_COLOURS.forest)
        break
      case 'hill':
        c.set(steep ? hillColour(grade) : fieldToneColour(0, grade))
        break
      default: {
        c.set(fieldToneColour(data.tone[f], grade))
        // The patchwork contrast fades with distance so the far rings read as one meadow.
        c.lerp(scratchTone0, 1 - data.patch[f])
        if (steep) c.lerp(scratchHill, 0.55)
      }
    }
    if (material !== 'water') c.offsetHSL(0, 0, data.noise[f])
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

/* ---------- the plate's field decals ---------- */

export interface DecalData {
  triangles: number
  position: Float32Array
  /** Per face tone (never 0: tone-0 fields are the plate itself). */
  tone: Uint8Array
}

/** Height of the decal layer above the plate: under the preserves (0.015) and the river bank (0.025). */
export const DECAL_LIFT = 0.012

/** Field quads on the flat plate, clipped to the plate rect, only where the field is included and not tone 0. */
export function buildPlateDecals(world: OuterWorld): DecalData {
  const plate = world.plate
  const range = fieldRange(world.fields, plate.minX, plate.maxX, plate.minZ, plate.maxZ)
  const position: number[] = []
  const tone: number[] = []
  for (let j = range.j0; j <= range.j1; j++) {
    for (let i = range.i0; i <= range.i1; i++) {
      if (!world.fieldIncluded(i, j)) continue
      const t = fieldTone(world.fields, i, j)
      if (t === 0) continue
      const clipped = clipPolygonToRect(fieldPolygon(world.fields, i, j), plate.minX, plate.maxX, plate.minZ, plate.maxZ)
      if (clipped.length < 3) continue
      // Fan triangulation (the clipped quad is convex), wound counter-clockwise seen from above.
      for (let k = 1; k + 1 < clipped.length; k++) {
        const a = clipped[0]
        const b = clipped[k]
        const c = clipped[k + 1]
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if (cross > 0) position.push(a[0], DECAL_LIFT, a[1], c[0], DECAL_LIFT, c[1], b[0], DECAL_LIFT, b[1])
        else position.push(a[0], DECAL_LIFT, a[1], b[0], DECAL_LIFT, b[1], c[0], DECAL_LIFT, c[1])
        tone.push(t)
      }
    }
  }
  return { triangles: tone.length, position: new Float32Array(position), tone: new Uint8Array(tone) }
}

export function colourDecals(data: DecalData, grade: OuterGrade, target?: Float32Array): Float32Array {
  const colors = target ?? new Float32Array(data.triangles * 9)
  for (let f = 0; f < data.triangles; f++) {
    scratchC.set(fieldToneColour(data.tone[f], grade))
    const o = f * 9
    for (let v = 0; v < 3; v++) {
      colors[o + v * 3] = scratchC.r
      colors[o + v * 3 + 1] = scratchC.g
      colors[o + v * 3 + 2] = scratchC.b
    }
  }
  return colors
}

export function decalGeometry(data: DecalData, grade: OuterGrade): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.position, 3))
  const normals = new Float32Array(data.triangles * 9)
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colourDecals(data, grade), 3))
  geo.computeBoundingSphere()
  return geo
}

export function recolourDecals(geo: THREE.BufferGeometry, data: DecalData, grade: OuterGrade): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute
  colourDecals(data, grade, attr.array as Float32Array)
  attr.needsUpdate = true
}

/* ---------- ribbons: the river winding on and the dirt tracks ---------- */

export interface RibbonSpec {
  points: Point2[]
  /** Width at each resampled vertex (constant or a function of z). */
  width: (x: number, z: number, t: number) => number
  /** Height above the sampled ground. */
  lift: number
  /** Resample pitch along the polyline, metres. */
  step: number
  /** Stop the ribbon at the first sample where this is true (after the second sample), e.g. the lake's bank rim. */
  until?: (x: number, z: number) => boolean
}

/** Resample a polyline by arc length, keeping the original vertices so corners stay where authored. */
export function resamplePolyline(points: Point2[], step: number): Array<{ p: Point2; t: number }> {
  const out: Array<{ p: Point2; t: number }> = []
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  let walked = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const [ax, az] = points[i - 1]
      const [bx, bz] = points[i]
      const length = Math.hypot(bx - ax, bz - az)
      const n = Math.max(1, Math.round(length / step))
      for (let k = 1; k < n; k++) {
        const u = k / n
        out.push({ p: [ax + (bx - ax) * u, az + (bz - az) * u], t: (walked + length * u) / total })
      }
      walked += length
    }
    out.push({ p: points[i], t: walked / total })
  }
  return out
}

/**
 * A ribbon draped on the outer heightfield: every edge vertex is sampled at its own x, z, so the
 * ribbon follows the ground (in the river's bank band the ground is the flat bed). The first
 * vertex pair uses the first segment's direction, which `river.ts` keeps collinear with the
 * authored ribbon's last segment so the two butt together exactly.
 */
export function buildRibbon(world: OuterWorld, spec: RibbonSpec, colour: string): THREE.BufferGeometry {
  let samples = resamplePolyline(spec.points, spec.step)
  if (spec.until) {
    const stop = samples.findIndex((s, i) => i >= 2 && spec.until!(s.p[0], s.p[1]))
    if (stop >= 0) samples = samples.slice(0, stop + 1)
  }
  const vertices: number[] = []
  const indices: number[] = []
  for (let i = 0; i < samples.length; i++) {
    const [x, z] = samples[i].p
    const previous = samples[Math.max(0, i - 1)].p
    const next = samples[Math.min(samples.length - 1, i + 1)].p
    const dx = next[0] - previous[0]
    const dz = next[1] - previous[1]
    const length = Math.hypot(dx, dz) || 1
    const half = spec.width(x, z, samples[i].t) * 0.5
    const nx = (-dz / length) * half
    const nz = (dx / length) * half
    const left = world.sample(x + nx, z + nz).height + spec.lift
    const right = world.sample(x - nx, z - nz).height + spec.lift
    vertices.push(x + nx, left, z + nz, x - nx, right, z - nz)
    if (i > 0) {
      const base = (i - 1) * 2
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const c = new THREE.Color(colour)
  const colors = new Float32Array((vertices.length / 3) * 3)
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r
    colors[i + 1] = c.g
    colors[i + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

export function recolourRibbon(geo: THREE.BufferGeometry, colour: string): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute
  const c = new THREE.Color(colour)
  const array = attr.array as Float32Array
  for (let i = 0; i < array.length; i += 3) {
    array[i] = c.r
    array[i + 1] = c.g
    array[i + 2] = c.b
  }
  attr.needsUpdate = true
}
