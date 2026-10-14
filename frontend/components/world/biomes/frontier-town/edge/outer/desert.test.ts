import { describe, expect, it } from 'vitest'
import { FRONTIER_CAMERA_BOX, FRONTIER_CAMERA_LIMITS, FRONTIER_LOOK_BOX, cameraReach } from '../../camera/limits'
import { seededRng } from './noise'
import {
  LAND_CLEARANCE,
  OUTER_REACH,
  PLATE,
  PROP_CLEARANCE,
  RINGS,
  authoredFeatures,
  chebyshev,
  featureDistance,
  insideRect,
  landMask,
  propClear,
  rectDistance,
  ringAt,
} from './plate'
import { DESERT_FOG, DUNE_RIDGE, GORGE, createOuterDesert } from './desert'
import { vista, windows } from './vistas'

const desert = createOuterDesert(7)

describe('plate and rings', () => {
  it('keeps every authored feature on the plate with room to spare', () => {
    const { rects, segments } = authoredFeatures()
    for (const r of rects) {
      expect(r.minX, r.tag).toBeGreaterThanOrEqual(PLATE.minX + 18)
      expect(r.maxX, r.tag).toBeLessThanOrEqual(PLATE.maxX - 18)
      expect(r.minZ, r.tag).toBeGreaterThanOrEqual(PLATE.minZ - 0 + 18)
      expect(r.maxZ, r.tag).toBeLessThanOrEqual(PLATE.maxZ - 18)
    }
    for (const s of segments) for (const p of [s.a, s.b]) expect(insideRect(PLATE, p[0], p[1], -18), s.tag).toBe(true)
  })

  it('lattices line up: every ring boundary sits on both neighbouring cell grids', () => {
    for (const edge of [PLATE.minX, PLATE.maxX, PLATE.minZ, PLATE.maxZ]) expect(Math.abs(edge % 10)).toBe(0)
    for (let i = 0; i < RINGS.length; i++) {
      const ring = RINGS[i]
      expect(ring.outer % ring.cell).toBe(0)
      if (i > 0) {
        expect(ring.inner).toBe(RINGS[i - 1].outer)
        expect(ring.inner % ring.cell).toBe(0)
        expect(ring.cell % RINGS[i - 1].cell).toBe(0)
      }
    }
    expect(RINGS[RINGS.length - 1].outer).toBe(OUTER_REACH)
  })

  it('covers the whole camera box and everywhere the camera can actually get', () => {
    for (const x of [-460, -200, 0, 240, 460]) {
      for (const z of [-460, -200, 170, 460]) {
        const inside = insideRect(PLATE, x, z)
        expect(inside || ringAt(x, z) !== null, `${x},${z}`).toBe(true)
      }
    }
    expect(FRONTIER_CAMERA_BOX.max[0]).toBeGreaterThanOrEqual(460)
    const reach = cameraReach()
    expect(ringAt(reach.x, 0)?.ring).toBe(2)
    expect(ringAt(0, reach.z)?.ring).toBe(2)
    expect(ringAt(reach.x, reach.z)?.ring).toBe(2)
  })

  it('fogs the far frustum out before the last ring ends, from every reachable camera', () => {
    const reach = cameraReach()
    const farthest = Math.max(reach.x, reach.z)
    expect(farthest + DESERT_FOG.day.far).toBeLessThanOrEqual(OUTER_REACH)
    expect(farthest + DESERT_FOG.night.far).toBeLessThanOrEqual(OUTER_REACH)
    expect(DESERT_FOG.day.far).toBeGreaterThanOrEqual(1500)
    expect(DESERT_FOG.day.far).toBeLessThanOrEqual(1800)
  })

  it('free camera: full orbit, pitch 12–64°, look box is the plate', () => {
    expect(FRONTIER_CAMERA_LIMITS.yawDeg).toBe(180)
    expect(FRONTIER_CAMERA_LIMITS.pitchMinDeg).toBe(12)
    expect(FRONTIER_CAMERA_LIMITS.pitchMaxDeg).toBe(64)
    expect(FRONTIER_LOOK_BOX.min[0]).toBe(PLATE.minX)
    expect(FRONTIER_LOOK_BOX.max[0]).toBe(PLATE.maxX)
    expect(FRONTIER_LOOK_BOX.min[2]).toBe(PLATE.minZ)
    expect(FRONTIER_LOOK_BOX.max[2]).toBe(PLATE.maxZ)
  })
})

describe('land mask and in-plate exclusion', () => {
  it('is flat on the plate and within the clearance of every authored feature', () => {
    const rng = seededRng(3)
    for (let i = 0; i < 3000; i++) {
      const x = -400 + rng() * 800
      const z = -400 + rng() * 800
      const d = featureDistance(x, z)
      if (insideRect(PLATE, x, z) || d <= LAND_CLEARANCE) {
        expect(landMask(x, z)).toBe(0)
        expect(desert.sample(x, z).height).toBe(0)
        expect(desert.heightAt(x, z)).toBe(0)
      }
    }
  })

  it('has real relief once clear of the land', () => {
    let moved = 0
    const rng = seededRng(5)
    for (let i = 0; i < 2000; i++) {
      const x = -900 + rng() * 1800
      const z = -900 + rng() * 1800
      if (featureDistance(x, z) > 140 && !insideRect(PLATE, x, z) && Math.abs(desert.heightAt(x, z)) > 0.4) moved++
    }
    expect(moved).toBeGreaterThan(1200)
  })

  it('refuses props on the plate and within the prop clearance; allows them beyond', () => {
    expect(propClear(0, 0)).toBe(false)
    expect(propClear(PLATE.maxX + 10, 0)).toBe(false)
    expect(propClear(PLATE.maxX + PROP_CLEARANCE + 40, 0)).toBe(true)
    expect(rectDistance(PLATE, PLATE.maxX + 25, 0)).toBe(25)
  })

  it('never lets a landform footprint reach the plate', () => {
    for (const m of desert.landforms) {
      const d = rectDistance(PLATE, m.x, m.z)
      expect(d, `${m.kind} at ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBeGreaterThan(Math.max(m.rx, m.rz) * 1.2)
    }
  })
})

describe('seam', () => {
  it('matches the authored plate height (flat 0) all along the plate boundary', () => {
    for (let t = PLATE.minX; t <= PLATE.maxX; t += 2) {
      expect(desert.seamHeight(t, PLATE.minZ)).toBe(0)
      expect(desert.seamHeight(t, PLATE.maxZ)).toBe(0)
      expect(desert.sample(t, PLATE.minZ).height).toBe(0)
      expect(desert.sample(t, PLATE.maxZ).height).toBe(0)
      expect(Math.abs(desert.sample(t, PLATE.minZ - 1e-3).height)).toBeLessThan(1e-6)
      expect(Math.abs(desert.sample(t, PLATE.maxZ + 1e-3).height)).toBeLessThan(1e-6)
    }
    for (let t = PLATE.minZ; t <= PLATE.maxZ; t += 2) {
      expect(desert.sample(PLATE.minX, t).height).toBe(0)
      expect(desert.sample(PLATE.maxX, t).height).toBe(0)
      expect(Math.abs(desert.sample(PLATE.minX - 1e-3, t).height)).toBeLessThan(1e-6)
      expect(Math.abs(desert.sample(PLATE.maxX + 1e-3, t).height)).toBeLessThan(1e-6)
    }
  })

  it('is continuous: one 10 m cell out the ground is still within a few centimetres of flat', () => {
    for (let t = PLATE.minX; t <= PLATE.maxX; t += 10) {
      expect(Math.abs(desert.heightAt(t, PLATE.minZ - 10))).toBeLessThan(0.3)
      expect(Math.abs(desert.heightAt(t, PLATE.maxZ + 10))).toBeLessThan(0.3)
    }
  })
})

describe('determinism', () => {
  it('reproduces the same world from the same seed and a different one from another', () => {
    const a = createOuterDesert(7)
    const b = createOuterDesert(7)
    const c = createOuterDesert(8)
    const rng = seededRng(11)
    let differs = 0
    for (let i = 0; i < 300; i++) {
      const x = -1500 + rng() * 3000
      const z = -1500 + rng() * 3000
      const sa = a.sample(x, z)
      const sb = b.sample(x, z)
      expect(sa).toEqual(sb)
      if (sa.height !== c.sample(x, z).height) differs++
    }
    expect(differs).toBeGreaterThan(20)
    expect(a.landforms).toEqual(b.landforms)
  })
})

describe('the geography', () => {
  it('cuts the gorge down the east side and raises the far plateau', () => {
    const w = windows().find((g) => g.id === 'east')!
    const g = desert.gorge(w.z)
    expect(g.fade).toBeGreaterThan(0.95)
    const floor = desert.sample(g.x, w.z)
    expect(floor.height).toBeLessThan(-GORGE.depth * 0.9)
    expect(floor.kind).toBe('floor')
    expect(desert.heightAt(g.x - GORGE.wallHalf - 20, w.z)).toBeGreaterThan(-2)
    expect(desert.heightAt(g.x + 130, w.z)).toBeGreaterThan(GORGE.farRise * 0.8)
  })

  it('builds the dune ridge across the south with a low saddle at the window', () => {
    const w = windows().find((g) => g.id === 'south')!
    const saddle = desert.duneCrest(w.along)
    let flank = 0
    let tallest = { x: 0, amplitude: 0, z: 0 }
    for (let i = 0; i < 12; i++) {
      const x = w.along + w.halfWidth + 50 + i * 14
      const c = desert.duneCrest(x)
      flank += c.amplitude / 12
      if (c.amplitude > tallest.amplitude) tallest = { x, ...c }
    }
    expect(saddle.amplitude).toBeLessThan(flank * 0.35)
    expect(flank).toBeGreaterThan(DUNE_RIDGE.amplitude * 0.7)
    const crest = desert.sample(tallest.x, tallest.z)
    expect(crest.height).toBeGreaterThan(12)
    expect(['dune', 'duneShade']).toContain(crest.kind)
  })

  it('steps up onto the western bench and keeps the table, butte and portal rock where the vistas need them', () => {
    const e = desert.escarpment(-100)
    expect(desert.heightAt(e.x - 40, -100)).toBeGreaterThan(desert.heightAt(e.x + 30, -100) + 8)
    const table = vista('north')
    expect(desert.heightAt(table.x, table.z)).toBeGreaterThan(table.base * 0.95)
    expect(desert.heightAt(table.x, table.z)).toBeLessThan(table.base * 1.12)
    const mast = vista('west')
    expect(desert.heightAt(mast.x, mast.z)).toBeGreaterThan(mast.base * 0.9)
    const portal = desert.trestle.portal
    expect(desert.heightAt(portal.x, portal.z)).toBeGreaterThan(portal.height * 0.85)
  })

  it('keeps heights in a sane band everywhere', () => {
    const rng = seededRng(21)
    for (let i = 0; i < 1500; i++) {
      const x = -OUTER_REACH + rng() * 2 * OUTER_REACH
      const z = -OUTER_REACH + rng() * 2 * OUTER_REACH
      const h = desert.heightAt(x, z)
      expect(Number.isFinite(h)).toBe(true)
      expect(h).toBeGreaterThan(-GORGE.depth - 8)
      expect(h).toBeLessThan(400)
      expect(chebyshev(x, z)).toBeLessThanOrEqual(OUTER_REACH)
    }
  })

  it('samples fast enough to build the rings at mount', () => {
    const t0 = performance.now()
    const rng = seededRng(2)
    for (let i = 0; i < 20000; i++) desert.sample(-OUTER_REACH + rng() * 2 * OUTER_REACH, -OUTER_REACH + rng() * 2 * OUTER_REACH)
    const perSample = (performance.now() - t0) / 20000
    expect(perSample).toBeLessThan(0.06)
  })
})
