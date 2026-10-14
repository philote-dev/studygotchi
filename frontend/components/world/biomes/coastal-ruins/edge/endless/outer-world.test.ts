import { describe, expect, it } from 'vitest'
import { COASTAL_RUINS_LAYOUT as L, seeded } from '../../layout/biome-layout'
import { landField, sampleTerrain } from '../../layout/terrain'
import { COASTAL_CAMERA_BOX, cameraReach } from '../../camera/stations'
import { EDGE_POSES, edgePosePosition, viewBearingDeg } from '../poses'
import {
  OUTER_REACH,
  PLAIN_SCATTER_Z,
  SCATTER_REACH,
  SEAM_WIDTH,
  aqueductStubs,
  authoredLattice,
  chebyshev,
  continuationShore,
  createOuterWorld,
  karstOutcrops,
  maquisScrub,
  outerFog,
  outerLandField,
  ringAt,
  ringSpecs,
} from './outer-world'

const PLATE = L.worldExtent
const SEED = 7
const world = createOuterWorld(L, SEED)

describe('endless: LOD rings', () => {
  const rings = ringSpecs(PLATE)

  it('start one seam strip past the plate, nest without gaps, and reach past the far frustum', () => {
    expect(rings[0].inner).toBe(PLATE + SEAM_WIDTH)
    for (let i = 1; i < rings.length; i++) expect(rings[i].inner).toBe(rings[i - 1].outer)
    expect(rings[rings.length - 1].outer).toBe(OUTER_REACH)
    expect(OUTER_REACH).toBeGreaterThanOrEqual(2200)
  })

  it('use cells whose lattices line up at every shared boundary', () => {
    expect(rings.map((r) => r.cell)).toEqual([10, 20, 80])
    for (const ring of rings) {
      expect(ring.inner % ring.cell, `${ring.ring} inner`).toBe(0)
      expect(ring.outer % ring.cell, `${ring.ring} outer`).toBe(0)
    }
    for (let i = 1; i < rings.length; i++) expect(rings[i].cell % rings[i - 1].cell).toBe(0)
    // The seam strip is one ring-1 cell deep so the strip's outer edge is the ring's own lattice.
    expect(SEAM_WIDTH % rings[0].cell).toBe(0)
  })

  it('cover every direction out to the reach once past the strip, and nothing inside the plate', () => {
    const rng = seeded(31)
    const [minX, , minZ] = COASTAL_CAMERA_BOX.min
    const [maxX, , maxZ] = COASTAL_CAMERA_BOX.max
    let outside = 0
    for (let i = 0; i < 2000; i++) {
      const x = minX + rng() * (maxX - minX) * 3
      const z = minZ + rng() * (maxZ - minZ) * 3
      const ring = ringAt(x, z, rings)
      const d = chebyshev(x, z)
      if (d < PLATE + SEAM_WIDTH) expect(ring).toBeNull()
      else if (d < OUTER_REACH) {
        outside++
        expect(ring, `${x},${z}`).not.toBeNull()
      }
    }
    expect(outside).toBeGreaterThan(800)
    for (let a = 0; a < 360; a += 5) {
      for (const d of [421, 600, 699, 700, 1000, 1199, 1200, 2000, 2399]) {
        const x = Math.cos((a * Math.PI) / 180) * d
        const z = Math.sin((a * Math.PI) / 180) * d
        if (chebyshev(x, z) < PLATE + SEAM_WIDTH) continue
        expect(ringAt(x, z, rings), `${a}° ${d} m`).not.toBeNull()
      }
    }
  })
})

describe('endless: land mask', () => {
  it('agrees with the authored coast everywhere on the plate', () => {
    const rng = seeded(5)
    for (let i = 0; i < 400; i++) {
      const x = (rng() * 2 - 1) * PLATE
      const z = (rng() * 2 - 1) * PLATE
      expect(outerLandField(L, x, z)).toBe(landField(L, x, z))
    }
  })

  it('continues the north as land, the south as open sea, and bends the side coasts into capes', () => {
    for (let x = -2000; x <= 2000; x += 100) expect(outerLandField(L, x, -500), `north at x=${x}`).toBeGreaterThan(0)
    for (let x = -140; x <= 140; x += 20) expect(outerLandField(L, x, 900), `south at x=${x}`).toBeLessThan(-100)
    // West coast: z = 37 at the plate edge, then the cape swings south beyond it.
    expect(continuationShore(-400)).toBeCloseTo(37, 6)
    expect(continuationShore(-820)).toBeGreaterThan(37 + 100)
    expect(continuationShore(400)).toBeCloseTo(-73, 6)
    expect(continuationShore(820)).toBeGreaterThan(-73 + 100)
    // The far west and east seas are enclosed by those capes but the south stays open to the horizon.
    expect(outerLandField(L, -900, 120)).toBeGreaterThan(0)
    expect(outerLandField(L, 900, 60)).toBeGreaterThan(0)
    expect(outerLandField(L, 0, 2300)).toBeLessThan(0)
    expect(outerLandField(L, -600, 2300)).toBeLessThan(0)
  })

  it('is continuous across the plate edge: same sign everywhere, same value near the coast', () => {
    for (let z = -380; z <= 380; z += 10) {
      for (const side of [-1, 1]) {
        const inside = outerLandField(L, side * (PLATE - 0.01), z)
        const beyond = outerLandField(L, side * (PLATE + 0.01), z)
        expect(Math.sign(inside), `edge x=${side * PLATE} z=${z}`).toBe(Math.sign(beyond))
        // Within the shallows band the magnitude drives the profile, so it must carry across too.
        if (Math.min(Math.abs(inside), Math.abs(beyond)) < L.shallowsWidth) expect(Math.abs(inside - beyond), `edge x=${side * PLATE} z=${z}`).toBeLessThan(2)
      }
    }
  })
})

describe('endless: heightfield', () => {
  it('matches the authored plate edge exactly on its own lattice (float32 coordinates)', () => {
    const lattice = authoredLattice(L)
    expect(lattice.length).toBe(281)
    expect(lattice[0]).toBe(-PLATE)
    expect(lattice[lattice.length - 1]).toBe(PLATE)
    for (const k of lattice) {
      for (const [x, z] of [
        [k, -PLATE],
        [k, PLATE],
        [-PLATE, k],
        [PLATE, k],
      ]) {
        expect(world.seamHeight(x, z)).toBe(sampleTerrain(L, x, z).height)
      }
    }
  })

  it('continues the land across the seam without a step and keeps the sea floor at the authored depth', () => {
    let land = 0
    let sea = 0
    for (let x = -PLATE; x <= PLATE; x += 10) {
      const seam = world.seamHeight(x, -PLATE)
      const beyond = world.sample(x, -PLATE - 30).height
      expect(Math.abs(beyond - seam), `north x=${x}: seam ${seam} vs ${beyond}`).toBeLessThan(2.5)
      land++
    }
    for (let x = -140; x <= 140; x += 20) {
      const s = world.sample(x, PLATE + 30)
      expect(s.material).toBe('sea')
      expect(s.height).toBeCloseTo(sampleTerrain(L, x, PLATE - 1).height, 3)
      sea++
    }
    expect(land).toBeGreaterThan(50)
    expect(sea).toBeGreaterThan(10)
  })

  it('puts nothing of its own above the sea floor inside the plate', () => {
    const rng = seeded(1234)
    for (let i = 0; i < 400; i++) {
      const x = (rng() * 2 - 1) * (PLATE - 0.01)
      const z = (rng() * 2 - 1) * (PLATE - 0.01)
      expect(world.sample(x, z).height).toBeLessThanOrEqual(L.seaLevel - 1.6)
    }
  })

  it('rises into limestone country: hills, terraces, scrub and a dry river north of the plate', () => {
    const materials = new Set<string>()
    let maxHeight = 0
    let terraceCells = 0
    for (let x = -1400; x <= 1400; x += 40) {
      for (let z = -2300; z <= -430; z += 40) {
        const s = world.sample(x, z)
        materials.add(s.material)
        if (s.height > maxHeight) maxHeight = s.height
        if (s.material === 'terrace') terraceCells++
      }
    }
    expect(materials).toContain('limestone')
    expect(materials).toContain('scrub')
    expect(materials).toContain('terrace')
    expect(materials).toContain('riverbed')
    expect(maxHeight).toBeGreaterThan(60)
    expect(maxHeight).toBeLessThan(220)
    expect(terraceCells).toBeGreaterThan(40)
    // The dry river: a line of riverbed running north from behind the escarpment.
    let bed = 0
    for (let z = -520; z >= -1500; z -= 20) {
      const x = world.riverX(z)
      if (world.sample(x, z).material === 'riverbed') bed++
      expect(world.sample(x, z).height).toBeLessThan(world.sample(x + 60, z).height + 1)
    }
    expect(bed).toBeGreaterThan(30)
  })

  it('keeps a saddle on the north-out view ray so the far acropolis window stays open', () => {
    const pose = EDGE_POSES.find((p) => p.id === 'north-out')!
    const [cx, cy, cz] = edgePosePosition(pose)
    const view = (viewBearingDeg(pose) * Math.PI) / 180
    const site = world.acropolisSite
    expect(site.z).toBeLessThan(-PLATE)
    const fromCamera = Math.hypot(site.x - cx, site.z - cz)
    expect(fromCamera).toBeGreaterThan(400)
    expect(fromCamera).toBeLessThan(520)
    // The line of sight from the camera to the acropolis plinth clears the terrain between.
    for (let d = 60; d < fromCamera - 10; d += 10) {
      const x = cx + Math.sin(view) * d
      const z = cz + Math.cos(view) * d
      const ground = chebyshev(x, z) < PLATE ? sampleTerrain(L, x, z).height : world.sample(x, z).height
      const sight = cy + ((site.top - cy) * d) / fromCamera
      expect(ground, `terrain at ${d} m blocks the acropolis`).toBeLessThan(sight - 2)
    }
    // Hills on both sides of the window frame it.
    const left = world.sample(site.x - 150, site.z - 60).height
    const right = world.sample(site.x + 150, site.z - 60).height
    expect(Math.max(left, right)).toBeGreaterThan(world.sample(site.x, site.z - 60).height)
  })

  it('tints farther ground toward the sky and keeps near ground clear', () => {
    const near = world.sample(0, -450).haze
    const mid = world.sample(0, -1000).haze
    const far = world.sample(0, -2300).haze
    expect(near).toBeLessThan(0.15)
    expect(near).toBeLessThan(mid)
    expect(mid).toBeLessThan(far)
    expect(far).toBeGreaterThan(0.55)
  })

  it('is deterministic for a seed and differs across seeds', () => {
    const again = createOuterWorld(L, SEED)
    const other = createOuterWorld(L, SEED + 1)
    const rng = seeded(99)
    let differs = 0
    for (let i = 0; i < 80; i++) {
      const x = (rng() * 2 - 1) * 1800
      const z = -450 - rng() * 1500
      expect(world.sample(x, z)).toEqual(again.sample(x, z))
      if (world.sample(x, z).height !== other.sample(x, z).height) differs++
    }
    expect(differs).toBeGreaterThan(20)
  })
})

describe('endless: fog', () => {
  it('pushes the fog out for aerial perspective, leaving the plate crisp from every pose', () => {
    const day = outerFog(false)
    const night = outerFog(true)
    // Nothing the overview sees (≤ 650 m view depth) may fog in either mode: near stays where the shipped fog starts.
    expect(day.near).toBeGreaterThanOrEqual(650)
    expect(day.near).toBeLessThanOrEqual(L.fog.near * 0.56 / L.renderScale + 1)
    expect(day.far).toBeGreaterThanOrEqual(1500)
    expect(day.far).toBeLessThanOrEqual(1700)
    expect(night.far).toBeGreaterThanOrEqual(1100)
    expect(night.far).toBeLessThan(day.far)
    // The far frustum from anywhere in the camera box is fogged out before the rings end.
    expect(cameraReach() + day.far).toBeLessThanOrEqual(OUTER_REACH + 120)
  })
})

describe('endless: far detail placements', () => {
  it('scatters karst outcrops on the continuation and the plain behind the escarpment, never where the overview looks', () => {
    const rocks = karstOutcrops(world)
    expect(rocks.length).toBeGreaterThan(120)
    expect(rocks.length).toBeLessThanOrEqual(320)
    const overview = EDGE_POSES.find((p) => p.id === 'overview')!
    const [cx, cy, cz] = edgePosePosition(overview)
    const frameTop = ((overview.pitchDeg - 27 / 2) * Math.PI) / 180
    let onPlain = 0
    for (const r of rocks) {
      const cheb = chebyshev(r.x, r.z)
      if (cheb <= PLATE) {
        onPlain++
        expect(r.z).toBeLessThan(PLAIN_SCATTER_Z)
        // Below the overview's frame-top ray even when 12 m tall.
        const down = Math.atan2(cy - (r.y + 12), Math.hypot(r.x - cx, r.z - cz))
        expect(down).toBeLessThan(frameTop)
        expect(sampleTerrain(L, r.x, r.z).material).toBe('limestone')
      } else {
        expect(world.sample(r.x, r.z).material).not.toBe('riverbed')
      }
      expect(cheb).toBeLessThanOrEqual(SCATTER_REACH)
      expect(world.landField(r.x, r.z)).toBeGreaterThan(8)
      expect(Math.hypot(r.x - world.acropolisSite.x, r.z - world.acropolisSite.z)).toBeGreaterThan(90)
      expect(r.sx).toBeGreaterThan(1.5)
      expect(Math.abs(r.y - world.groundAt(r.x, r.z))).toBeLessThan(1)
    }
    expect(onPlain).toBeGreaterThan(10)
    const near = rocks.filter((r) => chebyshev(r.x, r.z) < 500)
    const far = rocks.filter((r) => chebyshev(r.x, r.z) > 650)
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
    expect(mean(far.map((r) => r.sx))).toBeGreaterThan(mean(near.map((r) => r.sx)))
  })

  it('plants maquis scrub only on scrub ground, within the scatter reach', () => {
    const scrub = maquisScrub(world)
    expect(scrub.length).toBeGreaterThan(150)
    expect(scrub.length).toBeLessThanOrEqual(480)
    for (const s of scrub) {
      const cheb = chebyshev(s.x, s.z)
      expect(cheb).toBeLessThanOrEqual(SCATTER_REACH)
      if (cheb <= PLATE) {
        expect(s.z).toBeLessThan(PLAIN_SCATTER_Z)
        expect(world.scrubAt(s.x, s.z)).toBe(true)
      } else expect(world.sample(s.x, s.z).material).toBe('scrub')
    }
  })

  it('lines a broken aqueduct across the northern plain with gaps between the stubs', () => {
    const piers = aqueductStubs(world)
    expect(piers.length).toBeGreaterThanOrEqual(10)
    expect(piers.length).toBeLessThanOrEqual(30)
    for (const p of piers) {
      expect(p.z).toBeLessThan(-PLATE - 20)
      expect(world.landField(p.x, p.z)).toBeGreaterThan(0)
    }
    // At least one gap wider than two pier spacings: a ruin, not a viaduct.
    let maxGap = 0
    for (let i = 1; i < piers.length; i++) maxGap = Math.max(maxGap, Math.hypot(piers[i].x - piers[i - 1].x, piers[i].z - piers[i - 1].z))
    expect(maxGap).toBeGreaterThan(30)
  })
})
