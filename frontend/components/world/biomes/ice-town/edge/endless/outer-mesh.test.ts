import { describe, expect, it } from 'vitest'
import { ICE_TOWN_LAYOUT, mountainProfile } from '../../layout/biome-layout'
import { mountainPeaks, sampleTerrain } from '../../layout/terrain'
import { LATTICE_JITTER, bergGeometry, buildOuterMeshes, buildOuterWorldSteps, colourRing, duneGeometry, floeGeometry, hummockGeometry, triangleCount } from './outer-mesh'
import { chebyshev, createOuterWorld, driftFloes, packHummocks, snowDunes, tabularBergs } from './outer-world'

const layout = ICE_TOWN_LAYOUT
const PLATE = layout.worldExtent
const world = createOuterWorld(layout, 7)
const meshes = buildOuterMeshes(world)
const INNER = world.rings[0].ring

describe('endless: outer meshes', () => {
  it('holds the budget: ≤ 25 draw calls and ≤ 75k triangles including the near-field detail', () => {
    const floes = driftFloes(world)
    const bergs = tabularBergs(world)
    const hummocks = packHummocks(world)
    const dunes = snowDunes(world)
    const per = (g: ReturnType<typeof floeGeometry>) => g.getAttribute('position').count / 3
    const detail = floes.length * per(floeGeometry()) + bergs.length * per(bergGeometry()) + hummocks.length * per(hummockGeometry()) + dunes.length * per(duneGeometry())
    const drawCalls = meshes.length + 4
    expect(drawCalls).toBeLessThanOrEqual(25)
    expect(triangleCount(meshes) + detail).toBeLessThanOrEqual(75_000)
    expect(triangleCount(meshes)).toBeGreaterThan(40_000)
    expect(dunes.length).toBeGreaterThan(300)
  })

  it('builds as resumable steps: ring 0 with the plate seam first, rings 1–3, then the detail, equal to the one-shot build', () => {
    const steps = [...buildOuterWorldSteps(world)]
    expect(steps.map((s) => (s.kind === 'ring' ? `ring${s.ring}` : s.kind))).toEqual(['ring0', 'ring1', 'ring2', 'ring3', 'detail', 'drift'])
    const first = steps[0]
    if (first.kind !== 'ring') throw new Error('first step is not a ring')
    // The first step alone carries the whole plate seam: every authored edge metre has a vertex.
    const seam = new Set<string>()
    for (const m of first.meshes) for (let i = 0; i < m.position.length; i += 3) if (Math.abs(chebyshev(m.position[i], m.position[i + 2]) - PLATE) < 1e-6) seam.add(`${m.position[i]},${m.position[i + 2]}`)
    expect(seam.size).toBe(8 * PLATE)
    const ringTris = steps.filter((s) => s.kind === 'ring').map((s) => (s.kind === 'ring' ? triangleCount(s.meshes) : 0))
    expect(ringTris.reduce((a, b) => a + b, 0)).toBe(triangleCount(meshes))
    const detail = steps[4]
    const drift = steps[5]
    if (detail.kind !== 'detail' || drift.kind !== 'drift') throw new Error('detail steps out of order')
    expect(detail.hummocks.length).toBe(packHummocks(world).length)
    expect(drift.floes.length).toBe(driftFloes(world).length)
    // A generator can be resumed step by step (one per frame) without redoing earlier work.
    const gen = buildOuterWorldSteps(world)
    expect(gen.next().value).toMatchObject({ kind: 'ring', ring: 0 })
    expect(gen.next().value).toMatchObject({ kind: 'ring', ring: 1 })
  })

  it('jitters interior lattice vertices by up to a third of a cell but keeps every ring-boundary vertex on the lattice', () => {
    for (const ring of world.rings) {
      let interiorOff = 0
      let interior = 0
      for (const m of meshes.filter((mesh) => mesh.ring === ring.ring)) {
        for (let i = 0; i < m.position.length; i += 3) {
          const x = m.position[i]
          const z = m.position[i + 2]
          const cheb = chebyshev(x, z)
          const onBoundary = Math.abs(cheb - ring.inner) < 1e-6 || Math.abs(cheb - ring.outer) < 1e-6
          const offX = Math.abs(x / ring.cell - Math.round(x / ring.cell)) * ring.cell
          const offZ = Math.abs(z / ring.cell - Math.round(z / ring.cell)) * ring.cell
          if (onBoundary) {
            // Boundary vertices (and the 1 m seam slivers on the inner ring) sit on the lattice or the seam line.
            expect(Math.abs(cheb - ring.inner) < 1e-6 || (offX < 1e-6 && offZ < 1e-6), `${x},${z} on ring ${ring.ring}`).toBe(true)
          } else {
            interior++
            expect(offX).toBeLessThanOrEqual(LATTICE_JITTER * ring.cell + 1e-6)
            expect(offZ).toBeLessThanOrEqual(LATTICE_JITTER * ring.cell + 1e-6)
            if (offX > 0.05 * ring.cell || offZ > 0.05 * ring.cell) interiorOff++
          }
        }
      }
      expect(interiorOff / interior, `ring ${ring.ring} interior vertices jittered`).toBeGreaterThan(0.8)
    }
  })

  it('has finite positions, unit normals and nothing inside the plate above the sea floor', () => {
    let nonFinite = 0
    let abovePlateFloor = 0
    let badNormal = 0
    let downNormal = 0
    for (const m of meshes) {
      expect(m.position.length).toBe(m.triangles * 9)
      expect(m.normal.length).toBe(m.triangles * 9)
      for (let i = 0; i < m.position.length; i += 3) {
        const x = m.position[i]
        const y = m.position[i + 1]
        const z = m.position[i + 2]
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nonFinite++
        if (chebyshev(x, z) < PLATE - 1e-6 && y > world.seaFloor) abovePlateFloor++
        const len = Math.hypot(m.normal[i], m.normal[i + 1], m.normal[i + 2])
        if (Math.abs(len - 1) >= 1e-3) badNormal++
        if (!(m.normal[i + 1] > 0)) downNormal++
      }
    }
    expect({ nonFinite, abovePlateFloor, badNormal, downNormal }).toEqual({ nonFinite: 0, abovePlateFloor: 0, badNormal: 0, downNormal: 0 })
  })

  it('meets the authored plate on its 1 m lattice with the authored heights', () => {
    const profile = mountainProfile(0.62)
    const peaks = mountainPeaks(layout, profile)
    const seam = new Map<string, number>()
    for (const m of meshes.filter((mesh) => mesh.ring === INNER)) {
      for (let i = 0; i < m.position.length; i += 3) {
        const x = m.position[i]
        const z = m.position[i + 2]
        if (Math.abs(chebyshev(x, z) - PLATE) > 1e-6) continue
        // Every seam vertex sits on an integer metre, like the authored PlaneGeometry.
        expect(Math.abs(x - Math.round(x)) + Math.abs(z - Math.round(z))).toBeLessThan(1e-4)
        seam.set(`${Math.round(x)},${Math.round(z)}`, m.position[i + 1])
      }
    }
    // All 4 × 340 edge metres are present and match the authored terrain exactly.
    expect(seam.size).toBe(4 * 2 * PLATE)
    for (const [key, y] of seam) {
      const [x, z] = key.split(',').map(Number)
      expect(y, key).toBeCloseTo(sampleTerrain(layout, x, z, profile, peaks).height, 4)
    }
  })

  it('leaves no T-junction gaps at the LOD boundaries', () => {
    const boundary = (ring: number, radius: number) => {
      const map = new Map<string, number>()
      for (const m of meshes.filter((mesh) => mesh.ring === ring)) {
        for (let i = 0; i < m.position.length; i += 3) {
          const x = m.position[i]
          const z = m.position[i + 2]
          if (Math.abs(chebyshev(x, z) - radius) > 1e-6) continue
          map.set(`${x},${z}`, m.position[i + 1])
        }
      }
      return map
    }
    for (const [inner, outer, radius, cell] of [
      [0, 1, 300, 10],
      [1, 2, 500, 20],
      [2, 3, 1120, 80],
    ]) {
      const fine = boundary(inner, radius)
      const coarse = boundary(outer, radius)
      expect(coarse.size).toBeGreaterThan(50)
      for (const [key, y] of coarse) expect(fine.get(key), `shared vertex ${key}`).toBeCloseTo(y, 4)
      // Fine-only vertices lie on the coarse edge between their aligned neighbours.
      for (const [key, y] of fine) {
        if (coarse.has(key)) continue
        const [x, z] = key.split(',').map(Number)
        const alongX = Math.abs(Math.abs(z) - radius) < 1e-6
        const v = alongX ? x : z
        const v0 = Math.floor(v / cell) * cell
        const v1 = v0 + cell
        const k0 = alongX ? `${v0},${z}` : `${x},${v0}`
        const k1 = alongX ? `${v1},${z}` : `${x},${v1}`
        const y0 = coarse.get(k0)
        const y1 = coarse.get(k1)
        expect(y0, k0).toBeDefined()
        expect(y1, k1).toBeDefined()
        expect(y).toBeCloseTo(y0! + (y1! - y0!) * ((v - v0) / cell), 4)
      }
    }
  })

  it('bakes colours in range and pulls far faces toward the sky', () => {
    for (const grade of [
      { night: false, storm: false },
      { night: true, storm: false },
      { night: false, storm: true },
    ]) {
      const far = meshes.find((m) => m.ring === 3)!
      const colors = colourRing(far, grade)
      expect(colors.length).toBe(far.triangles * 9)
      for (let i = 0; i < colors.length; i++) expect(colors[i] >= 0 && colors[i] <= 1).toBe(true)
    }
    const near = meshes.find((m) => m.ring === INNER)!
    const far = meshes.find((m) => m.ring === 3)!
    const mean = (xs: ArrayLike<number>) => {
      let s = 0
      for (let i = 0; i < xs.length; i++) s += xs[i]
      return s / xs.length
    }
    expect(mean(far.haze)).toBeGreaterThan(mean(near.haze) + 0.3)
  })
})
