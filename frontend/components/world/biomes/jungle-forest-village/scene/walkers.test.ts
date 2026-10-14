import { describe, expect, it } from 'vitest'
import { buildColliderSet, penetrationDepth } from '../../collision/colliders'
import { JUNGLE_LAYOUT as L, seededDistricts } from '../layout/jungle-layout'
import { jungleLandColliders } from '../collision/footprints'
import { PARADE_RINGS, WALKER_RADIUS_M, createWalkers, isWalkable, paradePoint, stepWalkers } from './walkers'

const SEED = 7
const districts = seededDistricts(SEED)
const full = Object.fromEntries(L.districts.map((d) => [d.id, 1]))
const world = { districts }

describe('jungle walkers', () => {
  it('parades on dry ground round every district', () => {
    for (const district of L.districts) {
      for (let k = 0; k < 24; k++) {
        const p = paradePoint(world, district.id, (k / 24) * Math.PI * 2)
        expect(isWalkable(world, p.x, p.z), `${district.id} angle ${k}`).toBe(true)
      }
      expect(PARADE_RINGS[district.id].radius).toBeGreaterThanOrEqual(6)
    }
  })

  it('walks 60 s at 60 Hz with zero penetration, dry feet, no overlaps, and real distance covered', () => {
    const set = buildColliderSet(jungleLandColliders(districts, full, SEED))
    const walkers = createWalkers(world, set, 10)
    expect(walkers).toHaveLength(10)
    for (const w of walkers) {
      expect(penetrationDepth(set, w.x, w.z, w.r), `spawn ${w.index}`).toBeLessThanOrEqual(1e-9)
      expect(isWalkable(world, w.x, w.z), `spawn ${w.index}`).toBe(true)
    }
    const dt = 1 / 60
    let maxPenetration = 0
    let wetSteps = 0
    let worstOverlap = 0
    for (let step = 0; step < 60 * 60; step++) {
      stepWalkers(world, walkers, set, dt)
      for (let i = 0; i < walkers.length; i++) {
        const w = walkers[i]
        maxPenetration = Math.max(maxPenetration, penetrationDepth(set, w.x, w.z, w.r))
        if (!isWalkable(world, w.x, w.z)) wetSteps += 1
        for (let j = i + 1; j < walkers.length; j++) {
          const o = walkers[j]
          worstOverlap = Math.max(worstOverlap, w.r + o.r - Math.hypot(o.x - w.x, o.z - w.z))
        }
      }
    }
    // Colliders are hard (zero penetration); bodies are soft against each other (a brush, never inside).
    expect(maxPenetration).toBeLessThanOrEqual(1e-6)
    expect(wetSteps).toBe(0)
    expect(worstOverlap).toBeLessThan(0.25)
    for (const w of walkers) expect(w.travelled, `walker ${w.index} travelled`).toBeGreaterThan(20)
  })

  it('is deterministic', () => {
    const set = buildColliderSet(jungleLandColliders(districts, full, SEED))
    const a = createWalkers(world, set, 10)
    const b = createWalkers(world, set, 10)
    for (let step = 0; step < 600; step++) {
      stepWalkers(world, a, set, 1 / 60)
      stepWalkers(world, b, set, 1 / 60)
    }
    expect(a.map((w) => [w.x, w.z, w.heading])).toEqual(b.map((w) => [w.x, w.z, w.heading]))
    expect(WALKER_RADIUS_M).toBeCloseTo(0.9075, 3)
  })
})
