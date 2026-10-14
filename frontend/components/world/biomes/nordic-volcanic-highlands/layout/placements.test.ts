import { describe, expect, it } from 'vitest'
import { buildColliderSet, penetrationDepth } from '../../collision/colliders'
import { NORDIC_LAYOUT as L, generateDistricts, populationFor } from './biome-layout'
import { HAMLET_HOMES, VILLAGE_HOMES, districtFrame, hamletHomes, landColliders, toWorld, villageHomes } from './placements'
import { GROUND_Y, INLET, LEFT_SLAB, PLATE_RECT, RIGHT_SLAB, inPlateRect, isLandAt, paintedWaterDistance, pointInPolygon, seamHeightAt, signedDistance, slabDistance } from './terrain'

const SEED = 7
const full = Object.fromEntries(L.districts.map((d) => [d.id, 1]))
const empty = Object.fromEntries(L.districts.map((d) => [d.id, 0]))

describe('terrain: the authored ground as data', () => {
  it('knows the two slabs, the fjord between them and the painted water on top', () => {
    expect(pointInPolygon(LEFT_SLAB, -100, 0)).toBe(true)
    expect(pointInPolygon(RIGHT_SLAB, 100, 0)).toBe(true)
    // The fjord S-curve is water; the basin and inlet are water painted on the right slab.
    for (const [x, z] of L.fjord) expect(slabDistance(x, z), `fjord ${x},${z}`).toBeLessThan(0)
    expect(isLandAt(67, 70)).toBe(false)
    expect(paintedWaterDistance(10, 52)).toBeGreaterThan(0)
    expect(pointInPolygon(INLET, 10, 52)).toBe(true)
    for (const district of generateDistricts(L, SEED)) {
      if (district.id === 'archipelago') continue
      expect(isLandAt(district.center[0], district.center[1], 0.6), district.id).toBe(true)
    }
    expect(isLandAt(0, 0)).toBe(false)
    // The bevel: land starts 1.4 m inside the outline.
    expect(isLandAt(-250 + 0.5, 0)).toBe(false)
    expect(isLandAt(-250 + 2, 0)).toBe(true)
    expect(signedDistance(LEFT_SLAB, -240, 0)).toBeCloseTo(10, 6)
  })

  it('reports the plate rectangle and the seam heights the outer world must meet', () => {
    expect(PLATE_RECT).toEqual({ minX: -250, maxX: 250, minZ: -200, maxZ: 520 })
    expect(inPlateRect(249, 519)).toBe(true)
    expect(inPlateRect(251, 0)).toBe(false)
    expect(seamHeightAt(-100, -198.5)).toBe(GROUND_Y + 0.08)
    expect(seamHeightAt(19, -198.5)).toBeLessThan(-1)
  })
})

describe('placements: colliders from the placement data', () => {
  const colliders = landColliders(L, SEED, full)
  const set = buildColliderSet(colliders)

  it('covers every hall, hut, rock, column, dock, pool, plot, wall and post the scene draws at 100 %', () => {
    const byTag = (tag: string) => colliders.filter((c) => c.tag === tag).length
    expect(byTag('house')).toBe(11 + 10 + 2 + 3 + 2)
    expect(byTag('hall')).toBe(2 + 2)
    expect(byTag('column')).toBe(10)
    expect(byTag('dock')).toBe(3)
    expect(byTag('pool')).toBe(3)
    expect(byTag('plot')).toBe(4)
    expect(byTag('wall')).toBe(4)
    expect(byTag('fence')).toBe(2)
    expect(byTag('sheep')).toBe(6)
    expect(byTag('rock')).toBeGreaterThanOrEqual(10 + 2 + 3 + 3 + 2)
    expect(byTag('relief')).toBe(7)
    expect(byTag('post')).toBeGreaterThanOrEqual(2 + 3 + 1)
    expect(colliders.length).toBeGreaterThanOrEqual(100)
    expect(new Set(colliders.map((c) => c.id)).size).toBe(colliders.length)
  })

  it('grows with the population band and never loses a fixed piece', () => {
    const none = landColliders(L, SEED, empty)
    const half = landColliders(L, SEED, Object.fromEntries(L.districts.map((d) => [d.id, 0.5])))
    expect(none.length).toBeLessThan(half.length)
    expect(half.length).toBeLessThan(colliders.length)
    const fixedIds = new Set(none.map((c) => c.id))
    for (const id of fixedIds) expect(colliders.some((c) => c.id === id), id).toBe(true)
    for (const district of L.districts) expect(populationFor(district, 0).structures).toBe(0)
  })

  it('places every collider inside the plate; the land ones stand on the slabs except the two authored hamlet crofts that overhang the fjord', () => {
    let land = 0
    let offSlab: string[] = []
    for (const c of colliders) {
      expect(inPlateRect(c.x, c.z), c.id).toBe(true)
      if (c.tag === 'dock' || c.id.startsWith('archipelago') || c.tag === 'platform') continue
      land++
      if (slabDistance(c.x, c.z) <= 0) offSlab.push(c.id)
    }
    expect(land).toBeGreaterThan(80)
    // At seed 7 the jittered hamlet puts two crofts and two rocks over the fjord edge (authored).
    expect(offSlab.length, offSlab.join(', ')).toBeLessThanOrEqual(4)
    for (const id of offSlab) expect(id.startsWith('highland-hamlet:')).toBe(true)
  })

  it('keeps the highland track clear between the district yards it threads: no collider on the road core out on the moor', () => {
    const [track] = L.routes
    // The track is authored to run through every district yard (it starts in the mine, passes the
    // hamlet's hall by half a metre and a dry-stone wall straddles it). Those are the yards' own
    // business; out on the moor between them the road must be free of every collider.
    // A yard reaches ~14 m past the footprint radius (the mine's huts and the hamlet's walls stand at local radius 24–26).
    const yards = generateDistricts(L, SEED).map((d) => ({ x: d.center[0], z: d.center[1], r: d.footprintRadius + 14 }))
    yards.push({ x: L.landmark.center[0], z: L.landmark.center[1], r: 26 })
    let checked = 0
    for (let i = 0; i < track.length - 1; i++) {
      const [ax, az] = track[i]
      const [bx, bz] = track[i + 1]
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2)
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n
        const z = az + ((bz - az) * k) / n
        if (yards.some((y) => Math.hypot(x - y.x, z - y.z) < y.r)) continue
        checked++
        expect(penetrationDepth(set, x, z, 1.9), `track at ${x.toFixed(0)},${z.toFixed(0)}`).toBe(0)
      }
    }
    // ≈ 96 m of open moor road at 2 m samples.
    expect(checked).toBeGreaterThan(40)
  })

  it('matches the scene’s world transform: houses sit at centre + R(yaw)·local', () => {
    const district = generateDistricts(L, SEED).find((d) => d.id === 'highland-hamlet')!
    const frame = districtFrame(district)
    const home = hamletHomes(SEED, 10)[2]
    const [wx, wz] = toWorld(frame, home.p[0], home.p[2])
    const collider = colliders.find((c) => c.id === 'highland-hamlet:home-2')!
    expect(collider.x).toBeCloseTo(wx, 9)
    expect(collider.z).toBeCloseTo(wz, 9)
    if (collider.kind === 'box') {
      expect(collider.yaw).toBeCloseTo(frame.yaw + home.yaw, 9)
      expect(collider.hx).toBeCloseTo((5 * home.w + 0.5) / 2, 9)
    }
    // Jitter is deterministic and bounded.
    expect(villageHomes(SEED, 11)).toEqual(villageHomes(SEED, 11))
    villageHomes(SEED, 11).forEach((h, i) => {
      expect(Math.abs(h.p[0] - VILLAGE_HOMES[i].p[0])).toBeLessThanOrEqual(0.6)
      expect(Math.abs(h.yaw - VILLAGE_HOMES[i].yaw)).toBeLessThanOrEqual(0.06)
    })
    expect(hamletHomes(SEED, 3)).toHaveLength(3)
    expect(HAMLET_HOMES).toHaveLength(10)
  })
})
