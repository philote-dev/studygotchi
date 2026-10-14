import { describe, expect, it } from 'vitest'
import { JUNGLE_LAYOUT as L } from '../../layout/jungle-layout'
import { barrierPlan, channelDistance } from '../barriers/geography'
import { chebyshev } from '../noise'
import { OUTER_FOG, OUTER_REACH, ROWS, createOuterWorld, ringSpecs } from './heightfield'
import { buildRiver } from './river'
import { buildOuterMeshes, colourRing, triangleCount } from './rings'
import { canopyDomes, domeCounts, meanHazeAtRadius, meanHeightAtRadius, mistCurtains, palms, ridgeFalls } from './scatter'

const PLATE = L.worldExtent
const SEED = 7
const world = createOuterWorld(SEED)
const plan = barrierPlan(SEED)
const meshes = buildOuterMeshes(world)
const domes = canopyDomes(world, plan)
const palmList = palms(world)

describe('endless jungle: rings', () => {
  it('covers the plate edge to the fog reach with aligned lattices', () => {
    const rings = ringSpecs(PLATE)
    expect(rings[0].inner).toBe(PLATE)
    expect(rings[rings.length - 1].outer).toBe(OUTER_REACH)
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i]
      expect(ring.inner % ring.cell).toBe(0)
      expect(ring.outer % ring.cell).toBe(0)
      if (i > 0) {
        expect(ring.inner).toBe(rings[i - 1].outer)
        expect(ring.cell % rings[i - 1].cell).toBe(0)
      }
    }
    expect(OUTER_FOG.day.far).toBeGreaterThanOrEqual(1400)
    expect(OUTER_FOG.day.far).toBeLessThanOrEqual(1600)
    expect(OUTER_FOG.night.far).toBeLessThan(OUTER_FOG.day.far)
    expect(OUTER_REACH).toBeGreaterThan(OUTER_FOG.day.far)
  })

  it('puts nothing inside the plate and keeps every instance off the authored land', () => {
    for (const m of meshes) {
      for (let i = 0; i < m.position.length; i += 3) {
        expect(chebyshev(m.position[i], m.position[i + 2])).toBeGreaterThanOrEqual(PLATE - 1e-6)
        expect(Number.isFinite(m.position[i + 1])).toBe(true)
        expect(m.normal[i + 1]).toBeGreaterThan(0)
      }
    }
    for (const d of domes) expect(chebyshev(d.x, d.z) - d.radius * 0.5).toBeGreaterThan(PLATE)
    for (const p of palmList) expect(chebyshev(p.x, p.z)).toBeGreaterThan(PLATE)
    for (const m of plan.wall) expect(chebyshev(m.x, m.z) - Math.max(m.rx, m.rz)).toBeGreaterThan(PLATE)
  })

  it('meets the flat plate exactly along the seam', () => {
    const seam = new Map<string, number>()
    for (const m of meshes.filter((mesh) => mesh.ring === 1)) {
      for (let i = 0; i < m.position.length; i += 3) {
        const x = m.position[i]
        const z = m.position[i + 2]
        if (Math.abs(chebyshev(x, z) - PLATE) > 1e-6) continue
        seam.set(`${x},${z}`, m.position[i + 1])
      }
    }
    // 38 lattice points per side (one corner each).
    expect(seam.size).toBe(4 * (PLATE * 2) / 10)
    for (const [key, y] of seam) expect(Math.abs(y - L.groundHeight), key).toBe(0)
    // The first 40 m past the seam are the plate's own flat green (what the overview sees beyond
    // the north edge): no relief, no haze, no canopy, no bank.
    for (let t = -PLATE; t <= PLATE; t += 10) {
      for (const off of [1, 20, 40]) {
        for (const [x, z] of [
          [t, -PLATE - off],
          [t, PLATE + off],
          [-PLATE - off, t],
          [PLATE + off, t],
        ]) {
          const s = world.sample(x, z)
          // The river leaves through the east edge; its valley floor starts its slow descent there.
          if (channelDistance(x, z) < 32) continue
          expect(Math.abs(s.height), `${x},${z}`).toBeLessThan(0.05)
          expect(s.haze, `${x},${z}`).toBe(0)
          expect(s.canopy, `${x},${z}`).toBe(0)
        }
      }
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
      [1, 2, 500, 20],
      [2, 3, 1120, 80],
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
        const y0 = coarse.get(k0)
        const y1 = coarse.get(k1)
        expect(y0, k0).toBeDefined()
        expect(y1, k1).toBeDefined()
        expect(y).toBeCloseTo(y0! + (y1! - y0!) * ((v - v0) / cell), 4)
      }
    }
  })

  it('recedes: each ridge row is farther, taller and hazier than the one before', () => {
    for (let k = 1; k < ROWS.length; k++) {
      expect(ROWS[k].radius).toBeGreaterThan(ROWS[k - 1].radius + ROWS[k - 1].width)
      expect(ROWS[k].height[0]).toBeGreaterThan(ROWS[k - 1].height[1] * 0.6)
      expect(ROWS[k].haze).toBeGreaterThan(ROWS[k - 1].haze)
      expect(meanHeightAtRadius(world, ROWS[k].radius)).toBeGreaterThan(meanHeightAtRadius(world, ROWS[k - 1].radius))
      expect(meanHazeAtRadius(world, ROWS[k].radius)).toBeGreaterThan(meanHazeAtRadius(world, ROWS[k - 1].radius))
    }
    const near = meshes.find((m) => m.ring === 1)!
    const far = meshes.find((m) => m.ring === 3)!
    const mean = (xs: ArrayLike<number>) => {
      let s = 0
      for (let i = 0; i < xs.length; i++) s += xs[i]
      return s / xs.length
    }
    expect(mean(far.haze)).toBeGreaterThan(mean(near.haze) + 0.4)
    const curtains = mistCurtains(world)
    expect(curtains).toHaveLength(3)
    for (let k = 1; k < curtains.length; k++) {
      expect(curtains[k].radius).toBeGreaterThan(curtains[k - 1].radius)
      expect(curtains[k].y1 - curtains[k].y0).toBeGreaterThan(curtains[k - 1].y1 - curtains[k - 1].y0)
    }
  })

  it('bakes colours in range for day and night', () => {
    for (const night of [false, true]) {
      for (const m of meshes) {
        const colors = colourRing(m, { night })
        expect(colors.length).toBe(m.triangles * 9)
        for (let i = 0; i < colors.length; i += 97) expect(colors[i] >= 0 && colors[i] <= 1).toBe(true)
      }
    }
  })

  it('is deterministic per seed and different across seeds', () => {
    const again = buildOuterMeshes(createOuterWorld(SEED))
    expect(again.length).toBe(meshes.length)
    for (let i = 0; i < meshes.length; i++) {
      expect(again[i].triangles).toBe(meshes[i].triangles)
      expect(Array.from(again[i].position.subarray(0, 600))).toEqual(Array.from(meshes[i].position.subarray(0, 600)))
    }
    const other = buildOuterMeshes(createOuterWorld(99))
    const differs = other.some((m, i) => m.triangles !== meshes[i]?.triangles || m.position.some((v, k) => Math.abs(v - meshes[i].position[k]) > 1e-6))
    expect(differs).toBe(true)
    expect(JSON.stringify(canopyDomes(world, plan))).toBe(JSON.stringify(domes))
  })

  it('holds the budget: ≤ 40 draw calls and ≤ 150k triangles including the far detail', () => {
    const counts = domeCounts(domes)
    expect(counts.near).toBeGreaterThan(500)
    expect(counts.near).toBeLessThanOrEqual(1700)
    expect(counts.far).toBeGreaterThan(200)
    expect(counts.far).toBeLessThanOrEqual(1100)
    const detail = counts.near * (36 + 14) + counts.far * 20 + palmList.length * 26 + ridgeFalls(world).length * 2
    // Rings (12) + domes, trunks, far domes, palms, falls (5) + river (4) + mist (3) + wall (1) + vistas (≤ 10).
    const drawCalls = meshes.length + 5 + 4 + 3 + 1 + 10
    expect(drawCalls).toBeLessThanOrEqual(40)
    expect(triangleCount(meshes)).toBeGreaterThan(20_000)
    expect(triangleCount(meshes) + detail).toBeLessThanOrEqual(150_000)
  })

  it('thins the canopy with distance and keeps the far tier coarser', () => {
    const near = domes.filter((d) => d.tier === 1)
    const far = domes.filter((d) => d.tier === 2)
    const density = (list: typeof domes, inner: number, outer: number) => list.length / ((2 * outer) ** 2 - (2 * inner) ** 2)
    expect(density(near, PLATE, 500)).toBeGreaterThan(density(far, 500, 1120) * 2)
    const meanRadius = (list: typeof domes) => list.reduce((s, d) => s + d.radius, 0) / list.length
    expect(meanRadius(far)).toBeGreaterThan(meanRadius(near) * 2)
    for (const d of far) expect(d.radius).toBeGreaterThanOrEqual(1.5 * 20 * 0.5)
  })
})

describe('endless jungle: the river', () => {
  it('continues the outflow across the seam at the authored height and descends to the sea', () => {
    const river = buildRiver(world)
    const p = river.main.water.position
    // Centreline samples: the midpoint of each left / right vertex pair.
    const xs: number[] = []
    const zs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < p.length; i += 6) {
      xs.push((p[i] + p[i + 3]) / 2)
      ys.push(p[i + 1])
      zs.push((p[i + 2] + p[i + 5]) / 2)
    }
    // Inside the plate the water sits at the authored 0.08; at the seam too.
    for (let i = 0; i < xs.length; i++) if (xs[i] <= PLATE) expect(ys[i]).toBeCloseTo(0.08, 6)
    expect(Math.abs(world.riverSurface(PLATE + 0.01, 57) - 0.08)).toBeLessThan(0.01)
    // Beyond, it never climbs.
    for (let i = 1; i < ys.length; i++) if (xs[i] > PLATE) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1] + 1e-6)
    expect(ys[ys.length - 1]).toBeLessThan(-1)
    // The bed under the water is below the surface the whole way beyond the plate.
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] <= PLATE + 20) continue
      expect(world.height(xs[i], zs[i]), `bed at ${xs[i].toFixed(0)},${zs[i].toFixed(0)}`).toBeLessThan(ys[i])
    }
    expect(river.delta).toHaveLength(2)
  })

  it('opens into a sea east of the delta and nowhere near the plate', () => {
    for (let z = -400; z <= 400; z += 50) expect(world.shoreX(z)).toBeGreaterThan(560)
    const sea = world.sample(900, 100)
    expect(sea.material).toBe('sea')
    expect(sea.height).toBeLessThan(-1)
    expect(world.sample(-900, 100).material).not.toBe('sea')
  })
})
