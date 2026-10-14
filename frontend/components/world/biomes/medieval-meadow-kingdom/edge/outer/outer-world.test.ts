import { describe, expect, it } from 'vitest'
import { generateKingdom } from '../../layout/biome-layout'
import { authoredRect, inRect, plateRect, rectDistance, sampleTerrain } from '../../layout/terrain'
import { lakeInside } from '../barriers/geography'
import { BEND, bendDropAt } from '../curvature/bend'
import { EDGE_POSES, edgePosePosition, inOverviewFrustum } from '../poses'
import { buildRibbons } from './build'
import { fieldIndexAt } from './fields'
import { buildPlateDecals } from './outer-mesh'
import { OUTER_REACH, createOuterWorld, endlessFog, ringAt, ringSpecs } from './outer-world'
import { riverContinuation, riverDistance, riverWidthAt } from './river'

const layout = generateKingdom(7)
const world = createOuterWorld(layout, 7)
const plate = world.plate

describe('endless meadow: rings', () => {
  it('covers every point from the plate edge to the outer reach exactly once, on lattices that share the 60 m grid', () => {
    const rings = ringSpecs()
    expect(rings[0].inner).toBe(0)
    expect(rings[rings.length - 1].outer).toBe(OUTER_REACH)
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i].inner).toBe(rings[i - 1].outer)
      expect(rings[i].cell % rings[i - 1].cell).toBe(0)
      expect(rings[i - 1].outer % rings[i].cell).toBe(0)
    }
    for (const edge of [plate.minX, plate.maxX, plate.minZ, plate.maxZ]) expect(Math.abs(edge % 60)).toBe(0)
    let covered = 0
    for (let d = 0.5; d < OUTER_REACH; d += 37) {
      const hits = rings.filter((ring) => d >= ring.inner && d < ring.outer)
      expect(hits).toHaveLength(1)
      covered++
    }
    expect(covered).toBeGreaterThan(30)
    expect(ringAt(plate, plate.maxX + 5, 0, rings)?.ring).toBe(1)
    expect(ringAt(plate, plate.maxX + 500, 0, rings)?.ring).toBe(2)
    expect(ringAt(plate, 0, plate.minZ - 1000, rings)?.ring).toBe(3)
    expect(ringAt(plate, 0, 0, rings)).toBeNull()
  })

  it('is the plate Terrain.tsx draws: 600 × 540 m, flat at y = 0, around the 278 × 260 m authored world', () => {
    expect(plate).toEqual({ minX: -300, maxX: 300, minZ: -300, maxZ: 240 })
    const authored = authoredRect(layout)
    expect(authored).toEqual({ minX: -139, maxX: 139, minZ: -130, maxZ: 130 })
    expect(rectDistance(plate, 0, 0)).toBeLessThan(0)
  })
})

describe('endless meadow: the seam', () => {
  it('meets the flat plate at exactly y = 0 all the way round, and never dips below it for the first 60 m', () => {
    for (let t = 0; t <= 1; t += 1 / 97) {
      const points = [
        [plate.minX + (plate.maxX - plate.minX) * t, plate.minZ],
        [plate.minX + (plate.maxX - plate.minX) * t, plate.maxZ],
        [plate.minX, plate.minZ + (plate.maxZ - plate.minZ) * t],
        [plate.maxX, plate.minZ + (plate.maxZ - plate.minZ) * t],
      ] as const
      for (const [x, z] of points) {
        expect(world.sample(x, z).height, `seam at ${x},${z}`).toBe(0)
        expect(world.relief(x, z)).toBe(0)
      }
    }
    // The plate's dark skirt reaches 2 m out and 0.59 m down: the ground must stay above it there.
    for (let d = 0.5; d <= 6; d += 0.5) {
      for (let t = 0; t <= 1; t += 0.02) {
        const x = plate.minX + (plate.maxX - plate.minX) * t
        const z = plate.minZ + (plate.maxZ - plate.minZ) * t
        for (const [px, pz] of [
          [x, plate.minZ - d],
          [x, plate.maxZ + d],
          [plate.minX - d, z],
          [plate.maxX + d, z],
        ] as const) {
          expect(world.sample(px, pz).height, `skirt at ${px},${pz}`).toBeGreaterThan(-0.4)
        }
      }
    }
  })

  it('continues the plate colour: the river bank where the river crosses the seam, meadow or bank at the corners', () => {
    const crossing = world.river.north.find((p) => p[1] <= plate.minZ - 2)!
    expect(world.sample(crossing[0] + 12, crossing[1]).material).toBe('bank')
    expect(world.sample(crossing[0], crossing[1]).material).toBe('water')
    const corner = world.sample(plate.maxX + 2, plate.maxZ + 2)
    expect(['meadow', 'bank']).toContain(corner.material)
  })
})

describe('endless meadow: the river winding on', () => {
  const cont = riverContinuation(layout)

  it('starts at the authored ends, runs straight for the first segment, and reaches the lake and a source', () => {
    expect(cont.north[0]).toEqual(layout.river[0])
    expect(cont.south[0]).toEqual(layout.river[layout.river.length - 1])
    const [p0, p1] = [cont.north[0], cont.north[1]]
    const [q0, q1] = [layout.river[1], layout.river[0]]
    const a = Math.atan2(p1[0] - p0[0], p1[1] - p0[1])
    const b = Math.atan2(q1[0] - q0[0], q1[1] - q0[1])
    expect(Math.abs(a - b)).toBeLessThan(1e-9)
    const mouth = cont.south[cont.south.length - 1]
    expect(lakeInside(world.plan.lake, mouth[0], mouth[1])).toBeGreaterThan(0)
    const source = cont.north[cont.north.length - 1]
    expect(source[1]).toBeLessThan(plate.minZ - 100)
    expect(world.sample(source[0], source[1]).height).toBeGreaterThan(3)
  })

  it('lies in a flat bed that is level with the plate at the seam and climbs toward the source', () => {
    const atSeam = cont.north.find((p) => p[1] < plate.minZ)!
    const hit = riverDistance(layout, cont, atSeam[0], atSeam[1])
    expect(hit.reach).toBe('north')
    expect(world.sample(atSeam[0] + 5, atSeam[1]).height).toBeCloseTo(world.sample(atSeam[0] - 5, atSeam[1]).height, 1)
    expect(world.waterDepth(atSeam[0], atSeam[1])).toBeGreaterThan(0)
    const south = cont.south.find((p) => p[1] > plate.maxZ + 40)!
    expect(south[1]).toBeGreaterThan(plate.maxZ)
    expect(world.sample(south[0], south[1]).height).toBeLessThan(0)
    expect(world.sample(south[0], south[1]).height).toBeGreaterThan(world.plan.lake.level - 0.01 - bendDropAt(plate, south[0], south[1]))
  })

  it('is one continuous meander: no bend sharper than 22° between consecutive samples, and the plate width (18 / 28 m) held across the seam', () => {
    for (const reach of [cont.north, cont.south]) {
      expect(reach.length).toBeGreaterThan(12)
      for (let i = 2; i < reach.length - 1; i++) {
        const a = Math.atan2(reach[i][0] - reach[i - 1][0], reach[i][1] - reach[i - 1][1])
        const b = Math.atan2(reach[i + 1][0] - reach[i][0], reach[i + 1][1] - reach[i][1])
        const turn = Math.abs(((((b - a) * 180) / Math.PI + 540) % 360) - 180)
        expect(turn, `bend of ${turn.toFixed(0)}° at sample ${i}`).toBeLessThan(22)
      }
    }
    // Constant width through the seam: the plate's 18 m of water inside 28 m of bank, 40 m either side of the edge.
    for (const dz of [-40, -20, 0, 20, 40]) {
      const zN = plate.minZ + dz
      const zS = plate.maxZ + dz
      const hitN = riverDistance(layout, cont, cont.north.find((p) => Math.abs(p[1] - zN) < 12)![0], zN)
      const hitS = riverDistance(layout, cont, cont.south.find((p) => Math.abs(p[1] - zS) < 12)![0], zS)
      expect(riverWidthAt(layout, cont, hitN, zN, plate.minZ)).toBeCloseTo(layout.riverWidth, 0)
      expect(riverWidthAt(layout, cont, hitS, zS, plate.minZ)).toBe(layout.riverWidth)
    }
  })

  it('ends its banks at the lake\u2019s own bank rim, so the mouth is one shore and not a canal cut into the water', () => {
    const ribbons = buildRibbons(world)
    const southBank = ribbons.banks[1]
    const pos = southBank.getAttribute('position')
    let maxInside = -Infinity
    for (let i = 0; i < pos.count; i++) maxInside = Math.max(maxInside, lakeInside(world.plan.lake, pos.getX(i), pos.getZ(i)))
    // The last bank vertices stop at the rim (inside ≈ −7 along the centreline; the 14 m half-band reaches a little further).
    expect(maxInside).toBeLessThan(6)
    expect(maxInside).toBeGreaterThan(-20)
    // The water ribbon does run under the lake surface for the join.
    const southWater = ribbons.waters[1]
    const wp = southWater.getAttribute('position')
    let waterInside = -Infinity
    for (let i = 0; i < wp.count; i++) waterInside = Math.max(waterInside, lakeInside(world.plan.lake, wp.getX(i), wp.getZ(i)))
    expect(waterInside).toBeGreaterThan(0)
    for (const geo of [...ribbons.banks, ...ribbons.waters, ...ribbons.tracks]) geo.dispose()
  })

  it('puts the far mill on the north bank, clear of the water, hidden from the overview', () => {
    const { mill } = cont
    expect(world.riverDist(mill.x, mill.z)).toBeGreaterThan(layout.wetBandWidth / 2)
    expect(world.riverDist(mill.x, mill.z)).toBeLessThan(24)
    expect(world.waterDepth(mill.x, mill.z)).toBe(0)
    expect(inRect(plate, mill.x, mill.z)).toBe(true)
    expect(inOverviewFrustum(mill.x, 0, mill.z, 16 / 9)).toBe(false)
    expect(inOverviewFrustum(mill.x, 10, mill.z, 16 / 9)).toBe(false)
  })
})

describe('endless meadow: the land mask', () => {
  it('forbids the authored world with a margin and the whole shipped overview footprint', () => {
    for (const district of layout.districts) expect(world.forbidden(district.centre[0], district.centre[1])).toBe(true)
    expect(world.forbidden(layout.landmark.position[0], layout.landmark.position[1])).toBe(true)
    for (const preserve of layout.preserves) expect(world.forbidden(preserve.center[0], preserve.center[1])).toBe(true)
    // The overview frame top cuts the ground around z ≈ −170 straight ahead: that strip is still forbidden.
    expect(world.forbidden(0, -160)).toBe(true)
    expect(world.forbidden(0, plate.minZ + 10)).toBe(false)
    expect(world.forbidden(plate.maxX - 10, plate.maxZ - 10)).toBe(false)
    // The authored sampler still answers inside the forbidden zone (the outer world never shadows it).
    expect(sampleTerrain(layout, -82, -64).material).toBe('meadow-light')
  })

  it('never decorates inside the authored world or where the overview looks', () => {
    for (let z = -200; z <= 200; z += 10) {
      for (let x = -200; x <= 200; x += 10) {
        if (inRect(authoredRect(layout, 10), x, z) || inOverviewFrustum(x, 0, z, 16 / 9, 1.2)) {
          expect(world.decorate(x, z), `${x},${z}`).toBe(false)
        }
      }
    }
    // Far out on the plate it does decorate.
    let allowed = 0
    for (let z = plate.minZ; z <= plate.maxZ; z += 20) {
      for (let x = plate.minX; x <= plate.maxX; x += 20) if (world.decorate(x, z)) allowed++
    }
    expect(allowed).toBeGreaterThan(150)
  })

  it('keeps the field patchwork continuous across the seam: the same field has the same tone on both sides', () => {
    let checked = 0
    for (let x = plate.minX; x <= plate.maxX; x += 15) {
      for (const z of [plate.minZ, plate.maxZ]) {
        const zIn = z + (z === plate.minZ ? 1 : -1)
        const zOut = z + (z === plate.minZ ? -1 : 1)
        const sameField = fieldIndexAt(world.fields, x, zIn).join() === fieldIndexAt(world.fields, x, zOut).join()
        const inside = world.sample(x, zIn)
        const outside = world.sample(x, zOut)
        if (sameField && inside.material === 'meadow' && outside.material === 'meadow') {
          expect(outside.tone, `tone at ${x},${z}`).toBe(inside.tone)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(40)
    // And the plate decals use the very same inclusion: a field with a forbidden corner is tone 0 beyond the seam too.
    const decals = buildPlateDecals(world)
    expect(decals.triangles).toBeGreaterThan(40)
    for (let f = 0; f < decals.triangles; f++) {
      const o = f * 9
      const cx = (decals.position[o] + decals.position[o + 3] + decals.position[o + 6]) / 3
      const cz = (decals.position[o + 2] + decals.position[o + 5] + decals.position[o + 8]) / 3
      expect(world.forbidden(cx, cz), `decal centroid ${cx},${cz} in the forbidden zone`).toBe(false)
      expect(inRect(plate, cx, cz)).toBe(true)
    }
  })
})

describe('endless meadow: the hills and the bend', () => {
  it('rises in rows toward the north horizon, each row farther and taller than the last', () => {
    const rows = world.plan.rows
    expect(rows.map((r) => r.id)).toEqual(['A', 'B', 'C', 'D'])
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]
      const row = rows[i]
      expect(row.z0).toBeLessThan(prev.z0)
      const prevMax = Math.max(...prev.peaks.map((p) => p.height))
      const rowMin = Math.min(...row.peaks.map((p) => p.height))
      expect(rowMin).toBeGreaterThan(prevMax * 0.9)
    }
    // Sampled heights along the north axis climb row by row.
    const ridge = world.relief(-200, -430)
    const far = Math.max(...[-900, -850, -800].map((z) => world.relief(0, z)))
    expect(far).toBeGreaterThan(ridge)
  })

  it('stays out of the product overview frustum (16:9 and ultrawide) so the shipped overview never sees a hill', () => {
    const overview = EDGE_POSES.find((p) => p.id === 'overview')!
    const cam = edgePosePosition(overview)
    expect(cam[2]).toBeGreaterThan(100)
    let tallest = 0
    for (let z = plate.minZ; z > plate.minZ - OUTER_REACH; z -= 25) {
      for (let x = -900; x <= 900; x += 50) {
        const h = world.relief(x, z)
        tallest = Math.max(tallest, h)
        for (const aspect of [16 / 9, 2.4]) {
          expect(inOverviewFrustum(x, h, z, aspect), `hill top at ${x},${z} (h ${h.toFixed(1)}) in the ${aspect.toFixed(2)} overview`).toBe(false)
        }
      }
    }
    expect(tallest).toBeGreaterThan(120)
  })

  it('bends gently: zero at the seam, a few metres at the ring boundaries, so the far fields curl under the sky', () => {
    expect(bendDropAt(plate, plate.maxX, 0)).toBe(0)
    expect(bendDropAt(plate, plate.maxX + 300, 0)).toBeCloseTo(BEND.k * 300 * 300, 6)
    expect(bendDropAt(plate, plate.maxX + 300, 0)).toBeLessThan(4)
    expect(bendDropAt(plate, 0, plate.minZ - 1500)).toBeGreaterThan(50)
    const s = world.sample(plate.maxX + 300, 0)
    expect(s.height).toBeCloseTo(world.relief(plate.maxX + 300, 0) - s.drop, 6)
  })

  it('hazes toward the sky with distance', () => {
    expect(world.sample(plate.maxX + 5, 0).haze).toBeLessThan(0.02)
    expect(world.sample(plate.maxX + 1400, 0).haze).toBeGreaterThan(0.6)
  })
})

describe('endless meadow: determinism and fog', () => {
  it('rebuilds the identical world from the same seed and a different one from another', () => {
    const twin = createOuterWorld(layout, 7)
    const other = createOuterWorld(layout, 8)
    let differs = 0
    for (let z = plate.minZ - 500; z <= plate.maxZ + 500; z += 95) {
      for (let x = plate.minX - 500; x <= plate.maxX + 500; x += 95) {
        const a = world.sample(x, z)
        expect(twin.sample(x, z)).toEqual(a)
        if (other.sample(x, z).tone !== a.tone) differs++
      }
    }
    expect(differs).toBeGreaterThan(5)
  })

  it('pushes the fog to 1.6 km by day and 1.25 km by night on horizon looks, and keeps the shipped fog exactly at the station pitches', () => {
    expect(endlessFog(177, false, 16)).toEqual({ near: 177 * 1.4, far: 1600 })
    expect(endlessFog(177, true, 12)).toEqual({ near: 177 * 1.4, far: 1250 })
    expect(endlessFog(380, false, 12).far).toBe(1600)
    // The product overview (pitch 38°) and every station (34–40°) see the shipped 1.4 d / 2.8 d fog: pixel-identical land.
    expect(endlessFog(177, false, 38)).toEqual({ near: 177 * 1.4, far: 177 * 2.8 })
    expect(endlessFog(177, true, 34)).toEqual({ near: 177 * 1.4, far: 177 * 2.8 })
    // In between it eases.
    const mid = endlessFog(177, false, 26).far
    expect(mid).toBeGreaterThan(177 * 2.8)
    expect(mid).toBeLessThan(1600)
  })
})
