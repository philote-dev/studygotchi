import { describe, expect, it } from 'vitest'
import { ICE_TOWN_LAYOUT, mountainProfile, seeded } from '../../layout/biome-layout'
import { landField, mountainPeaks, sampleTerrain } from '../../layout/terrain'
import { ICE_FREE_CAMERA_BOX } from '../../camera/stations'
import { STATIONS } from '../../camera/stations'
import { skyGradeFor } from '../../scene/sky-blend'
import { stormGrade } from '../../scene/storm-weather'
import { EDGE_POSES, edgePosePosition } from '../poses'
import {
  OUTER_REACH,
  buildCoastField,
  chebyshev,
  continuationZone,
  createOuterWorld,
  driftFloes,
  endlessFog,
  packHummocks,
  ringAt,
  ringSpecs,
  snowDunes,
  tabularBergs,
} from './outer-world'

const layout = ICE_TOWN_LAYOUT
const PLATE = layout.worldExtent
const SEED = 7

describe('endless: LOD rings', () => {
  const rings = ringSpecs(PLATE)

  it('starts at the plate edge, nests without gaps, and reaches past the far frustum', () => {
    expect(rings[0].inner).toBe(PLATE)
    for (let i = 1; i < rings.length; i++) expect(rings[i].inner).toBe(rings[i - 1].outer)
    expect(rings[rings.length - 1].outer).toBeGreaterThanOrEqual(2200)
    expect(rings[rings.length - 1].outer).toBe(OUTER_REACH)
  })

  it('uses cells of 5 / 10 / 20 / 80 m whose lattices line up at every shared boundary', () => {
    expect(rings.map((r) => r.cell)).toEqual([5, 10, 20, 80])
    // The near field a low camera stands in is refined to 5 m out to 300 m.
    expect(rings[0].outer).toBeGreaterThanOrEqual(PLATE + 120)
    for (const ring of rings) {
      expect(ring.inner % ring.cell, `${ring.ring} inner`).toBe(0)
      expect(ring.outer % ring.cell, `${ring.ring} outer`).toBe(0)
    }
    for (let i = 1; i < rings.length; i++) expect(rings[i].cell % rings[i - 1].cell).toBe(0)
  })

  it('covers the whole free camera box footprint outside the plate, and nothing inside it', () => {
    const rng = seeded(31)
    const [minX, , minZ] = ICE_FREE_CAMERA_BOX.min
    const [maxX, , maxZ] = ICE_FREE_CAMERA_BOX.max
    let outside = 0
    for (let i = 0; i < 2000; i++) {
      const x = minX + rng() * (maxX - minX)
      const z = minZ + rng() * (maxZ - minZ)
      const ring = ringAt(x, z, rings)
      if (chebyshev(x, z) < PLATE) {
        expect(ring).toBeNull()
      } else {
        outside++
        expect(ring, `${x},${z}`).not.toBeNull()
        expect(chebyshev(x, z)).toBeGreaterThanOrEqual(ring!.inner)
        expect(chebyshev(x, z)).toBeLessThan(ring!.outer)
      }
    }
    expect(outside).toBeGreaterThan(1000)
  })

  it('covers every direction out to 2200 m once past the plate', () => {
    let checked = 0
    for (let a = 0; a < 360; a += 7) {
      for (const d of [171, 245, 300, 499, 500, 900, 1119, 1120, 1800, 2200]) {
        const x = Math.cos((a * Math.PI) / 180) * d
        const z = Math.sin((a * Math.PI) / 180) * d
        if (chebyshev(x, z) < PLATE) continue
        checked++
        expect(ringAt(x, z, rings), `${a}° ${d} m`).not.toBeNull()
      }
    }
    expect(checked).toBeGreaterThan(400)
  })
})

describe('endless: coast distance', () => {
  const coast = buildCoastField(layout)

  it('is zero on the mainland and grows out to sea', () => {
    expect(coast.distance(0, 0)).toBe(0)
    expect(coast.distance(-24, -18)).toBe(0) // the frozen lake is land, not sea
    expect(coast.distance(0, 120)).toBeGreaterThan(20)
    expect(coast.distance(0, 160)).toBeGreaterThan(coast.distance(0, 120))
    expect(coast.distance(0, PLATE)).toBeGreaterThan(60)
  })

  it('treats the glacier shelf and the research island as coast', () => {
    expect(coast.distance(-90, 0)).toBe(0)
    expect(coast.distance(layout.miniIsland.center[0], layout.miniIsland.center[1])).toBe(0)
    // The plate's west edge is within ~70 m of the shelf's (noisy) outer edge.
    expect(coast.distance(-PLATE, 0)).toBeLessThan(75)
    expect(coast.distance(-PLATE, 0)).toBeGreaterThan(40)
  })

  it('is at least 60 m everywhere beyond its grid', () => {
    expect(coast.distance(400, 0)).toBeGreaterThanOrEqual(60)
    expect(coast.distance(-900, 700)).toBeGreaterThanOrEqual(60)
  })
})

describe('endless: outer world heightfield', () => {
  const world = createOuterWorld(layout, SEED)

  it('stays below the authored sea floor everywhere inside the plate', () => {
    const rng = seeded(1234)
    for (let i = 0; i < 500; i++) {
      const x = (rng() * 2 - 1) * (PLATE - 0.01)
      const z = (rng() * 2 - 1) * (PLATE - 0.01)
      expect(world.sample(x, z).height, `${x},${z}`).toBeLessThanOrEqual(world.seaFloor)
    }
    expect(world.seaFloor).toBeLessThan(layout.seaLevel)
  })

  it('puts no pack ice within 60 m of an authored coast', () => {
    let solid = 0
    for (let x = -500; x <= 500; x += 10) {
      for (let z = -500; z <= 500; z += 10) {
        if (chebyshev(x, z) < PLATE) continue
        const s = world.sample(x, z)
        if (s.height <= layout.seaLevel) continue
        // The authored land continued across the seam (and, behind the range, carried on as snowfield).
        if (landField(layout, x, z) > -32 || continuationZone(layout, x, z) > -2) continue
        solid++
        expect(world.coast.distance(x, z), `solid at ${x},${z}`).toBeGreaterThanOrEqual(60)
      }
    }
    expect(solid).toBeGreaterThan(2000)
  })

  it('keeps open water right outside every sea edge of the plate', () => {
    // South, east and west edges: a moat of water before the pack begins.
    for (const [x, z] of [
      [0, PLATE + 2],
      [60, PLATE + 2],
      [PLATE + 2, 0],
      [PLATE + 2, 80],
      [-PLATE - 2, 0],
      [-PLATE - 2, -60],
    ]) {
      expect(world.sample(x, z).height, `${x},${z}`).toBeLessThan(layout.seaLevel)
    }
  })

  it('does have pack ice and far snowfields', () => {
    let ice = 0
    let far = 0
    for (let x = -1500; x <= 1500; x += 50) {
      for (let z = -200; z <= 1500; z += 50) {
        if (chebyshev(x, z) < PLATE + 60) continue
        const s = world.sample(x, z)
        if (s.material === 'ice') ice++
        if (chebyshev(x, z) > 1200 && s.height > layout.seaLevel + 1) far++
      }
    }
    expect(ice).toBeGreaterThan(300)
    expect(far).toBeGreaterThan(200)
  })

  it('matches the authored plate edge exactly on the 1 m lattice', () => {
    const profile = mountainProfile(0.62)
    const peaks = mountainPeaks(layout, profile)
    for (let k = -PLATE; k <= PLATE; k += 7) {
      for (const [x, z] of [
        [k, -PLATE],
        [k, PLATE],
        [-PLATE, k],
        [PLATE, k],
      ]) {
        expect(world.seamHeight(x, z)).toBe(sampleTerrain(layout, x, z, profile, peaks).height)
      }
    }
  })

  it('continues the back land across the seam without a step', () => {
    let land = 0
    for (let x = -120; x <= 120; x += 3) {
      const seam = world.seamHeight(x, -PLATE)
      if (seam < layout.seaLevel) continue
      land++
      const beyond = world.sample(x, -PLATE - 10).height
      expect(Math.abs(beyond - seam), `x=${x}: seam ${seam} vs ${beyond}`).toBeLessThan(4)
    }
    expect(land).toBeGreaterThan(40)
  })

  it('tints farther ground more toward the sky', () => {
    const near = world.sample(0, 220).haze
    const mid = world.sample(0, 700).haze
    const far = world.sample(0, 1900).haze
    expect(near).toBeLessThan(mid)
    expect(mid).toBeLessThan(far)
    expect(far).toBeGreaterThan(0.7)
    expect(near).toBeLessThan(0.3)
  })

  it('is deterministic for a seed and differs across seeds', () => {
    const again = createOuterWorld(layout, SEED)
    const other = createOuterWorld(layout, SEED + 1)
    const rng = seeded(99)
    let differs = 0
    for (let i = 0; i < 60; i++) {
      const x = (rng() * 2 - 1) * 1500
      const z = (rng() * 2 - 1) * 1500
      expect(world.sample(x, z)).toEqual(again.sample(x, z))
      if (world.sample(x, z).height !== other.sample(x, z).height) differs++
    }
    expect(world.peaks).toEqual(again.peaks)
    expect(differs).toBeGreaterThan(10)
  })
})

describe('endless: mountain rows', () => {
  const world = createOuterWorld(layout, SEED)
  const rows = [4, 5, 6, 7].map((row) => world.peaks.filter((p) => p.row === row))
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)

  it('adds three rows plus a ghost row, all behind the plate with their feet on land', () => {
    for (const row of rows) expect(row.length).toBeGreaterThanOrEqual(7)
    for (const p of world.peaks) {
      expect(p.z).toBeLessThan(-PLATE - 20)
      // The southern foot of every near row stands on the northern mass, not in the water.
      if (p.row <= 6) expect(world.landField(p.x, p.z + p.radius * 0.9), `row ${p.row} at ${p.x.toFixed(0)}`).toBeGreaterThan(0)
    }
  })

  it('recedes: each row is farther, taller, and apparently smaller than the one before', () => {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]
      const next = rows[i]
      expect(mean(next.map((p) => p.z))).toBeLessThan(mean(prev.map((p) => p.z)))
      expect(mean(next.map((p) => p.height))).toBeGreaterThan(mean(prev.map((p) => p.height)))
      const apparent = (ps: typeof prev) => mean(ps.map((p) => p.height / Math.hypot(p.x, p.z)))
      expect(apparent(next)).toBeLessThan(apparent(prev))
    }
  })

  it('never enters the overview frame', () => {
    const pose = EDGE_POSES.find((p) => p.id === 'overview')!
    const [cx, cy, cz] = edgePosePosition(pose)
    const frameTop = ((pose.pitchDeg - STATIONS.overview.fov / 2) * Math.PI) / 180
    const groundReach = cy / Math.tan(frameTop)
    for (const p of world.peaks) {
      const horizontal = Math.hypot(p.x - cx, p.z - cz) - p.radius
      expect(horizontal, `row ${p.row} peak at ${p.x},${p.z}`).toBeGreaterThan(groundReach)
      expect(cz).toBeGreaterThan(p.z)
    }
  })

  it('layers from the north-out camera: each farther row shows above the nearer one, but all stay low', () => {
    const pose = EDGE_POSES.find((p) => p.id === 'north-out')!
    const [cx, cy, cz] = edgePosePosition(pose)
    const elevation = (x: number, y: number, z: number) => Math.atan2(y - cy, Math.hypot(x - cx, z - cz))
    const tops = rows.map((row) => mean(row.map((p) => elevation(p.x, p.height, p.z))))
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1])
    // Nothing of ours climbs more than 10° above the horizon: a range, not a wall.
    for (const p of world.peaks) expect(elevation(p.x, p.height, p.z)).toBeLessThan((10 * Math.PI) / 180)
  })
})

describe('endless: fog', () => {
  const palette = { sky: '#dbe2ee', skyNight: '#22284a' }

  it('pushes the day and night fog out for aerial perspective, leaving the land crisp', () => {
    for (const night of [false, true]) {
      const base = skyGradeFor(night, null, palette)
      const grade = endlessFog(base, { night, storm: false })
      // Only the far plane moves: the near plane is the product's own (220), so the town's haze is untouched.
      expect(grade.fogNear).toBe(base.fogNear)
      expect(base.fogNear).toBe(220)
      // Day dissolves at 1.5–1.8 km; night pulls in because lit snow does not tint toward a dark sky.
      expect(grade.fogFar).toBeGreaterThanOrEqual(night ? 1100 : 1500)
      expect(grade.fogFar).toBeLessThanOrEqual(1800)
      expect(grade.fogFar).toBeGreaterThan(base.fogFar)
      expect(grade.sky).toBe(base.sky)
      expect(grade.sunPosition).toEqual(base.sunPosition)
      expect(grade.hemiSky).toBe(base.hemiSky)
    }
  })

  it('leaves the storm weather exactly as the catastrophe tunes it', () => {
    const base = skyGradeFor(false, stormGrade(1), palette)
    expect(endlessFog(base, { night: false, storm: true })).toBe(base)
    expect(endlessFog(skyGradeFor(true, stormGrade(1), palette), { night: true, storm: true }).fogFar).toBe(skyGradeFor(true, stormGrade(1), palette).fogFar)
  })
})

describe('endless: far detail placements', () => {
  const world = createOuterWorld(layout, SEED)

  it('drifts floes only on open water outside the plate and off the authored coasts', () => {
    const floes = driftFloes(world)
    expect(floes.length).toBeGreaterThan(80)
    expect(floes.length).toBeLessThanOrEqual(260)
    for (const f of floes) {
      expect(chebyshev(f.x, f.z)).toBeGreaterThan(PLATE)
      expect(world.sample(f.x, f.z).height).toBeLessThan(layout.seaLevel)
      expect(world.coast.distance(f.x, f.z)).toBeGreaterThanOrEqual(60)
      expect(f.r).toBeGreaterThan(1)
    }
  })

  it('moors a few hero bergs far out, spaced apart', () => {
    const bergs = tabularBergs(world)
    expect(bergs.length).toBeGreaterThanOrEqual(8)
    expect(bergs.length).toBeLessThanOrEqual(20)
    expect(bergs.filter((b) => b.hero).length).toBeGreaterThanOrEqual(2)
    for (const b of bergs) {
      expect(Math.hypot(b.x, b.z)).toBeGreaterThan(300)
      expect(world.landField(b.x, b.z)).toBeLessThan(-30)
      for (const o of bergs) if (o !== b) expect(Math.hypot(o.x - b.x, o.z - b.z)).toBeGreaterThan(100)
    }
  })

  it('sets hummocks on the pack ice', () => {
    const hummocks = packHummocks(world)
    expect(hummocks.length).toBeGreaterThan(100)
    expect(hummocks.length).toBeLessThanOrEqual(460)
    for (const h of hummocks) {
      expect(chebyshev(h.x, h.z)).toBeGreaterThan(PLATE)
      expect(world.sample(h.x, h.z).material).toBe('ice')
    }
  })

  it('carves sastrugi into the near field only, on ice or snow, aligned with one wind', () => {
    const dunes = snowDunes(world)
    expect(dunes.length).toBeGreaterThan(300)
    for (const d of dunes) {
      expect(chebyshev(d.x, d.z)).toBeGreaterThan(PLATE)
      expect(Math.hypot(d.x, d.z)).toBeLessThan(PLATE + 320)
      const s = world.sample(d.x, d.z)
      expect(s.material === 'ice' || s.material === 'snow').toBe(true)
      expect(Math.abs(d.yaw - (150 * Math.PI) / 180)).toBeLessThanOrEqual(0.26)
    }
  })
})
