import { describe, expect, it } from 'vitest'
import { buildColliderSet, penetrationDepth } from '../../collision/colliders'
import { COASTAL_RUINS_LAYOUT as L } from '../layout/biome-layout'
import { coastalLandColliders } from '../collision/footprints'
import { WALKER_RADIUS_M, activeDistricts, createWalkers, isWalkLand, settleWalkers, stepWalkers, walkPoint } from './walkers'

const SEED = 7
const full = Object.fromEntries(L.districts.map((d) => [d.id, 1]))
const set = buildColliderSet(coastalLandColliders(L, SEED, full), 4)
const districts = activeDistricts(L, full)

describe('coastal walkers', () => {
  it('deals the cast round the active districts and starts everyone on land, clear of every collider', () => {
    expect(districts).toHaveLength(5)
    expect(activeDistricts(L, Object.fromEntries(L.districts.map((d) => [d.id, 0])))).toHaveLength(0)
    const walkers = createWalkers(L, SEED, set, districts, 18)
    expect(walkers).toHaveLength(18)
    for (const w of walkers) {
      expect(isWalkLand(L, w.x, w.z), `walker ${w.index} starts in the water`).toBe(true)
      expect(penetrationDepth(set, w.x, w.z, w.r), `walker ${w.index} starts inside a collider`).toBeLessThan(1e-6)
    }
    for (let i = 0; i < walkers.length; i++) for (let j = i + 1; j < walkers.length; j++) expect(Math.hypot(walkers[i].x - walkers[j].x, walkers[i].z - walkers[j].z)).toBeGreaterThanOrEqual(2 * WALKER_RADIUS_M - 1e-6)
  })

  it('snaps the drowned-forum and quay rings onto the shore', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const forum = walkPoint(L, SEED, 'drowned-forum', a)
      expect(isWalkLand(L, forum.x, forum.z), `forum ring at ${a.toFixed(1)}`).toBe(true)
      const quay = walkPoint(L, SEED, 'working-quay', a)
      expect(isWalkLand(L, quay.x, quay.z), `quay ring at ${a.toFixed(1)}`).toBe(true)
    }
  })

  it('walks 1500 frames with zero penetration, never in the sea, apart from each other, and gets somewhere', () => {
    const walkers = createWalkers(L, SEED, set, districts, 14)
    let worst = 0
    for (let frame = 0; frame < 1500; frame++) {
      stepWalkers(L, SEED, walkers, set, 1 / 60)
      for (const w of walkers) {
        const depth = penetrationDepth(set, w.x, w.z, w.r)
        if (depth > worst) worst = depth
        expect(depth, `walker ${w.index} inside a collider at frame ${frame}`).toBeLessThan(1e-6)
        expect(isWalkLand(L, w.x, w.z), `walker ${w.index} in the sea at frame ${frame}`).toBe(true)
        expect(Number.isFinite(w.x) && Number.isFinite(w.z)).toBe(true)
      }
      // Bodies squeezing past each other along the shore may overlap by a few centimetres for a frame.
      for (let i = 0; i < walkers.length; i++) for (let j = i + 1; j < walkers.length; j++) expect(Math.hypot(walkers[i].x - walkers[j].x, walkers[i].z - walkers[j].z)).toBeGreaterThanOrEqual(2 * WALKER_RADIUS_M - 0.3)
    }
    expect(worst).toBeLessThan(1e-6)
    for (const w of walkers) expect(w.travelled, `walker ${w.index} never moved`).toBeGreaterThan(20)
  })

  it('is deterministic', () => {
    const a = createWalkers(L, SEED, set, districts, 8)
    const b = createWalkers(L, SEED, set, districts, 8)
    for (let frame = 0; frame < 300; frame++) {
      stepWalkers(L, SEED, a, set, 1 / 60)
      stepWalkers(L, SEED, b, set, 1 / 60)
    }
    expect(a).toEqual(b)
  })

  it('holds still bodies in place and keeps them clear when settling', () => {
    const walkers = createWalkers(L, SEED, set, districts, 6)
    walkers[0].still = true
    const [x0, z0] = [walkers[0].x, walkers[0].z]
    for (let frame = 0; frame < 120; frame++) stepWalkers(L, SEED, walkers, set, 1 / 60)
    expect(Math.hypot(walkers[0].x - x0, walkers[0].z - z0)).toBeLessThan(0.5)
    settleWalkers(L, walkers, set)
    for (const w of walkers) expect(penetrationDepth(set, w.x, w.z, w.r)).toBeLessThan(1e-6)
  })
})
