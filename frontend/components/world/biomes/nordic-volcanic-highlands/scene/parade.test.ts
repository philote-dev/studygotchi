import { describe, expect, it } from 'vitest'
import { buildColliderSet, penetrationDepth } from '../../collision/colliders'
import { NORDIC_LAYOUT as L, generateDistricts } from '../layout/biome-layout'
import { landColliders } from '../layout/placements'
import { PARADE_RADIUS_M, WALKER_DISTRICTS, WALKER_RADIUS_M, createWalkers, isParadeLand, paradePoint, settleWalkers, stepWalkers } from './parade'

const SEED = 7
const full = Object.fromEntries(L.districts.map((d) => [d.id, 1]))
const districts = generateDistricts(L, SEED)
const set = buildColliderSet(landColliders(L, SEED, full))

describe('walkers', () => {
  it('starts every resident clear of the colliders and on land', () => {
    const walkers = createWalkers(districts, set)
    expect(walkers).toHaveLength(WALKER_DISTRICTS.length)
    for (const w of walkers) {
      expect(penetrationDepth(set, w.x, w.z, w.r), `walker ${w.index}`).toBeLessThan(1e-6)
      expect(isParadeLand(w.x, w.z), `walker ${w.index} on land`).toBe(true)
      const centre = districts.find((d) => d.id === w.district)!.center
      expect(Math.hypot(w.x - centre[0], w.z - centre[1])).toBeLessThan(PARADE_RADIUS_M[w.district] * 1.4 + 2)
    }
  })

  it('never penetrates a collider, never leaves the land, and keeps walking over 90 s of fixed steps', () => {
    const walkers = createWalkers(districts, set)
    const dt = 1 / 60
    let worst = 0
    let maxStep = 0
    const before = walkers.map((w) => [w.x, w.z] as const)
    for (let frame = 0; frame < 90 * 60; frame++) {
      const prev = walkers.map((w) => [w.x, w.z] as const)
      stepWalkers(districts, walkers, set, dt)
      for (let i = 0; i < walkers.length; i++) {
        const w = walkers[i]
        worst = Math.max(worst, penetrationDepth(set, w.x, w.z, w.r))
        expect(isParadeLand(w.x, w.z), `walker ${i} off land at frame ${frame}`).toBe(true)
        maxStep = Math.max(maxStep, Math.hypot(w.x - prev[i][0], w.z - prev[i][1]))
        for (let j = i + 1; j < walkers.length; j++) {
          const o = walkers[j]
          // Separation runs before the collider safety push, which may nudge a body back ≤ 12 cm.
          expect(Math.hypot(w.x - o.x, w.z - o.z), `walkers ${i} and ${j} overlap at frame ${frame}`).toBeGreaterThan(2 * WALKER_RADIUS_M - 0.12)
        }
      }
    }
    expect(worst).toBeLessThan(1e-6)
    // Nobody teleported (relocation steps are ≤ ring circumference) and everybody moved.
    expect(maxStep).toBeLessThan(30)
    walkers.forEach((w, i) => {
      expect(w.travelled, `walker ${i} travelled`).toBeGreaterThan(20)
      expect(Math.hypot(w.x - before[i][0], w.z - before[i][1]) + w.travelled).toBeGreaterThan(5)
    })
  })

  it('is deterministic: the same inputs give the same parade', () => {
    const a = createWalkers(districts, set)
    const b = createWalkers(districts, set)
    for (let frame = 0; frame < 600; frame++) {
      stepWalkers(districts, a, set, 1 / 60)
      stepWalkers(districts, b, set, 1 / 60)
    }
    expect(a.map((w) => [w.x, w.z, w.heading])).toEqual(b.map((w) => [w.x, w.z, w.heading]))
  })

  it('settles standing residents out of colliders and each other', () => {
    const walkers = createWalkers(districts, set)
    walkers[1].x = walkers[0].x
    walkers[1].z = walkers[0].z
    settleWalkers(walkers, set)
    expect(Math.hypot(walkers[0].x - walkers[1].x, walkers[0].z - walkers[1].z)).toBeGreaterThan(2 * WALKER_RADIUS_M - 0.01)
    for (const w of walkers) expect(penetrationDepth(set, w.x, w.z, w.r)).toBeLessThan(1e-6)
  })

  it('snaps ring points onto land where the ring crosses the fjord', () => {
    for (const kind of ['fjord-village', 'highland-hamlet', 'geothermal-farms', 'basalt-canyon'] as const) {
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const p = paradePoint(districts, kind, a)
        expect(isParadeLand(p.x, p.z), `${kind} at ${a.toFixed(1)}`).toBe(true)
      }
    }
  })
})
