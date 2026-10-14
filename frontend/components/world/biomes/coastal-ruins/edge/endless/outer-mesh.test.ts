import { describe, expect, it } from 'vitest'
import { COASTAL_RUINS_LAYOUT as L } from '../../layout/biome-layout'
import { sampleTerrain } from '../../layout/terrain'
import {
  FLAT_NORMALS_BY,
  buildOuterMeshes,
  colourLattice,
  onLattice,
  outcropGeometry,
  pierGeometry,
  scrubGeometry,
  triangleCount,
} from './outer-mesh'
import { SEAM_WIDTH, aqueductStubs, authoredLattice, chebyshev, createOuterWorld, karstOutcrops, maquisScrub } from './outer-world'

const PLATE = L.worldExtent
const world = createOuterWorld(L, 7)
const meshes = buildOuterMeshes(world)

function faceNormalY(m: (typeof meshes)[number], t: number): number {
  const i = m.index
  const p = m.position
  const a = i[t * 3]
  const b = i[t * 3 + 1]
  const c = i[t * 3 + 2]
  const abx = p[b * 3] - p[a * 3]
  const aby = p[b * 3 + 1] - p[a * 3 + 1]
  const abz = p[b * 3 + 2] - p[a * 3 + 2]
  const acx = p[c * 3] - p[a * 3]
  const acy = p[c * 3 + 1] - p[a * 3 + 1]
  const acz = p[c * 3 + 2] - p[a * 3 + 2]
  // y component of ab × ac
  return abz * acx - abx * acz + 0 * (aby + acy)
}

describe('endless: outer meshes', () => {
  it('holds the budget: 4 lattice draw calls + 3 instanced, ≤ 70k triangles including the far detail', () => {
    const detail =
      (karstOutcrops(world).length * outcropGeometry().getAttribute('position').count) / 3 +
      (maquisScrub(world).length * scrubGeometry().getAttribute('position').count) / 3 +
      (aqueductStubs(world).length * pierGeometry().getAttribute('position').count) / 3
    expect(meshes).toHaveLength(4)
    expect(meshes.map((m) => m.ring)).toEqual([0, 1, 2, 3])
    expect(triangleCount(meshes) + detail).toBeLessThanOrEqual(70_000)
    expect(triangleCount(meshes)).toBeGreaterThan(20_000)
  })

  it('flattens every far normal to straight up so no ghost outline survives the fog', () => {
    for (const m of meshes) {
      for (let v = 0; v < m.vertices; v++) {
        if (Math.hypot(m.position[v * 3], m.position[v * 3 + 2]) < FLAT_NORMALS_BY) continue
        expect(m.normal[v * 3 + 1]).toBeCloseTo(1, 5)
      }
    }
  })

  it('keeps the last ring inside the horizon circle (no land beyond the haze wall)', () => {
    const far = meshes[3]
    const used = new Set<number>()
    for (let t = 0; t < far.index.length; t++) used.add(far.index[t])
    for (const v of used) expect(Math.hypot(far.position[v * 3], far.position[v * 3 + 2])).toBeLessThan(2500 - 20)
    expect(used.size).toBeGreaterThan(1500)
  })

  it('has finite positions, unit up-facing normals, consistent winding, and nothing inside the plate', () => {
    for (const m of meshes) {
      expect(m.position.length).toBe(m.vertices * 3)
      expect(m.normal.length).toBe(m.vertices * 3)
      expect(m.index.length).toBe(m.triangles * 3)
      for (let v = 0; v < m.vertices; v++) {
        const x = m.position[v * 3]
        const y = m.position[v * 3 + 1]
        const z = m.position[v * 3 + 2]
        expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true)
        expect(chebyshev(x, z)).toBeGreaterThanOrEqual(PLATE - 1e-3)
        const len = Math.hypot(m.normal[v * 3], m.normal[v * 3 + 1], m.normal[v * 3 + 2])
        expect(Math.abs(len - 1)).toBeLessThan(1e-3)
        expect(m.normal[v * 3 + 1]).toBeGreaterThan(0)
      }
      for (let t = 0; t < m.triangles; t++) expect(faceNormalY(m, t), `ring ${m.ring} triangle ${t} winds downward`).toBeGreaterThan(0)
    }
  })

  it('meets the authored plate on its float32 lattice with the authored heights (watertight seam)', () => {
    const strip = meshes[0]
    const lattice = new Set(authoredLattice(L))
    const seam = new Map<string, number>()
    for (let v = 0; v < strip.vertices; v++) {
      const x = strip.position[v * 3]
      const y = strip.position[v * 3 + 1]
      const z = strip.position[v * 3 + 2]
      if (Math.abs(chebyshev(x, z) - PLATE) > 1e-6) continue
      // Every seam vertex sits on the authored lattice along the edge.
      const along = Math.abs(Math.abs(x) - PLATE) < 1e-6 ? z : x
      expect(lattice.has(along), `${x},${z} is not an authored vertex`).toBe(true)
      seam.set(`${x},${z}`, y)
    }
    // All 4 × 280 edge vertices are present (corners shared) and match the authored terrain exactly.
    expect(seam.size).toBe(4 * 280)
    for (const [key, y] of seam) {
      const [x, z] = key.split(',').map(Number)
      expect(y, key).toBe(Math.fround(sampleTerrain(L, x, z).height))
    }
  })

  it('shares the strip / ring-1 boundary and leaves no T-junction gaps at the LOD boundaries', () => {
    const boundary = (ring: number, radius: number) => {
      const map = new Map<string, number>()
      const m = meshes.find((mesh) => mesh.ring === ring)!
      for (let v = 0; v < m.vertices; v++) {
        const x = m.position[v * 3]
        const z = m.position[v * 3 + 2]
        if (Math.abs(chebyshev(x, z) - radius) > 1e-6) continue
        map.set(`${x},${z}`, m.position[v * 3 + 1])
      }
      return map
    }
    // Strip outer edge ≡ ring-1 inner edge: identical vertex sets and heights.
    const stripOuter = boundary(0, PLATE + SEAM_WIDTH)
    const ringInner = boundary(1, PLATE + SEAM_WIDTH)
    expect(stripOuter.size).toBe(ringInner.size)
    for (const [key, y] of stripOuter) expect(ringInner.get(key), key).toBeCloseTo(y, 5)
    for (const [inner, outer, radius, cell] of [
      [1, 2, 700, 20],
      [2, 3, 1200, 80],
    ]) {
      const fine = boundary(inner, radius)
      const coarse = boundary(outer, radius)
      expect(coarse.size).toBeGreaterThan(50)
      for (const [key, y] of coarse) expect(fine.get(key), `shared vertex ${key}`).toBeCloseTo(y, 4)
      for (const [key, y] of fine) {
        if (coarse.has(key)) continue
        const [x, z] = key.split(',').map(Number)
        const alongX = Math.abs(Math.abs(z) - radius) < 1e-6
        const v = alongX ? x : z
        const v0 = Math.floor(v / cell) * cell
        const v1 = v0 + cell
        const k0 = alongX ? `${v0},${z}` : `${x},${v0}`
        const k1 = alongX ? `${v1},${z}` : `${x},${v1}`
        expect(coarse.get(k0), k0).toBeDefined()
        expect(coarse.get(k1), k1).toBeDefined()
        expect(y).toBeCloseTo(coarse.get(k0)! + (coarse.get(k1)! - coarse.get(k0)!) * ((v - v0) / cell), 4)
      }
    }
    // Ring lattices are regular: every vertex on its ring's cell grid.
    for (const m of meshes.slice(1)) {
      const cell = world.rings[m.ring - 1].cell
      for (let v = 0; v < m.vertices; v++) {
        expect(onLattice(m.position[v * 3], cell)).toBe(true)
        expect(onLattice(m.position[v * 3 + 2], cell)).toBe(true)
      }
    }
  })

  it('bakes colours in range, matching the plate palette at the seam and paling toward the sky far out', () => {
    for (const night of [false, true]) {
      for (const m of meshes) {
        const colors = colourLattice(m, { night })
        expect(colors.length).toBe(m.vertices * 3)
        for (let i = 0; i < colors.length; i++) expect(colors[i] >= 0 && colors[i] <= 1).toBe(true)
      }
    }
    const near = meshes[1]
    const far = meshes[3]
    const mean = (xs: ArrayLike<number>) => {
      let s = 0
      for (let i = 0; i < xs.length; i++) s += xs[i]
      return s / xs.length
    }
    expect(mean(far.haze)).toBeGreaterThan(mean(near.haze) + 0.25)
    // The strip's inner edge carries no haze at all: it is the plate's own colour.
    const strip = meshes[0]
    for (let v = 0; v < strip.vertices; v++) if (Math.abs(chebyshev(strip.position[v * 3], strip.position[v * 3 + 2]) - PLATE) < 1e-6) expect(strip.haze[v]).toBe(0)
  })
})
