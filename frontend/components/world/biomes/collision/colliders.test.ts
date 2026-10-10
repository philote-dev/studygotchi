import { describe, expect, it } from 'vitest'
import {
  type Collider,
  buildColliderSet,
  penetrationDepth,
  queryCandidates,
  resolveCircle,
  separateCircles,
  shapePenetration,
  steerAround,
  sweepCircle,
} from './colliders'

/** mulberry32, so the random fixtures are the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('resolveCircle', () => {
  it('pushes a circle out of a circle collider along the centre-to-centre normal', () => {
    const set = buildColliderSet([{ kind: 'circle', x: 0, z: 0, r: 2 }], 4)
    // Centre 1 m from the collider centre, body radius 1: must end 3 m out along (1, 0).
    const out = resolveCircle(set, 1, 0, 1)
    expect(out.hit).toBe(true)
    expect(out.x).toBeCloseTo(3, 9)
    expect(out.z).toBeCloseTo(0, 9)
    expect(out.nx).toBeCloseTo(1, 9)
    expect(out.nz).toBeCloseTo(0, 9)
    expect(penetrationDepth(set, out.x, out.z, 1)).toBeLessThanOrEqual(1e-9)
  })

  it('is a no-op away from every collider', () => {
    const set = buildColliderSet([{ kind: 'circle', x: 0, z: 0, r: 2 }], 4)
    const out = resolveCircle(set, 10, 10, 1)
    expect(out.hit).toBe(false)
    expect(out.x).toBe(10)
    expect(out.z).toBe(10)
  })

  it('pushes out of an axis-aligned box along the nearest face normal', () => {
    const set = buildColliderSet([{ kind: 'box', x: 0, z: 0, hx: 2, hz: 1, yaw: 0 }], 4)
    const out = resolveCircle(set, 0, 1.5, 1)
    expect(out.hit).toBe(true)
    expect(out.x).toBeCloseTo(0, 9)
    expect(out.z).toBeCloseTo(2, 9)
    expect(out.nz).toBeCloseTo(1, 9)
  })

  it('pushes out of a rotated box along the rotated face normal', () => {
    // yaw = π/2 turns the 2 m half-extent onto world z, so a point east of the box meets the
    // narrow face (hz = 1) and is pushed along +x to x = 1 + r.
    const set = buildColliderSet([{ kind: 'box', x: 0, z: 0, hx: 2, hz: 1, yaw: Math.PI / 2 }], 4)
    const out = resolveCircle(set, 1.5, 0, 1)
    expect(out.hit).toBe(true)
    expect(out.x).toBeCloseTo(2, 9)
    expect(out.z).toBeCloseTo(0, 9)
    expect(out.nx).toBeCloseTo(1, 9)
    expect(out.nz).toBeCloseTo(0, 9)
    // The long side now lies along z: a point north of the box is 2 + r away after the push.
    const north = resolveCircle(set, 0, 2.5, 1)
    expect(north.z).toBeCloseTo(3, 9)
  })

  it('pushes out of a box corner along the corner-to-centre direction', () => {
    const set = buildColliderSet([{ kind: 'box', x: 0, z: 0, hx: 1, hz: 1, yaw: 0 }], 4)
    const out = resolveCircle(set, 1.5, 1.5, 1)
    expect(out.hit).toBe(true)
    const k = Math.SQRT1_2
    expect(out.x).toBeCloseTo(1 + k, 9)
    expect(out.z).toBeCloseTo(1 + k, 9)
    expect(out.nx).toBeCloseTo(k, 9)
    expect(out.nz).toBeCloseTo(k, 9)
  })

  it('pushes a centre that is inside a box out through the nearest face', () => {
    const set = buildColliderSet([{ kind: 'box', x: 0, z: 0, hx: 2, hz: 1, yaw: 0 }], 4)
    const out = resolveCircle(set, 0.2, 0.1, 0.5)
    expect(out.hit).toBe(true)
    expect(out.x).toBeCloseTo(0.2, 9)
    expect(out.z).toBeCloseTo(1.5, 9)
  })

  it('resolves against several colliders at once', () => {
    const set = buildColliderSet(
      [
        { kind: 'circle', x: 0, z: 0, r: 1 },
        { kind: 'circle', x: 3, z: 0, r: 1 },
      ],
      4,
    )
    const out = resolveCircle(set, 1.5, 0.2, 1, 6)
    expect(penetrationDepth(set, out.x, out.z, 1)).toBeLessThan(1e-6)
    expect(out.z).toBeGreaterThan(0.2)
  })
})

describe('sweepCircle', () => {
  it('slides along a wall instead of stopping dead and never ends inside', () => {
    // Wall face at z = 3; body radius 1 so the centre can reach z = 2 at most.
    const set = buildColliderSet([{ kind: 'box', x: 0, z: 4, hx: 50, hz: 1, yaw: 0 }], 4)
    const out = sweepCircle(set, 0, 0, 10, 10, 1)
    expect(out.hit).toBe(true)
    expect(out.x).toBeCloseTo(10, 6)
    expect(out.z).toBeCloseTo(2, 6)
    expect(penetrationDepth(set, out.x, out.z, 1)).toBeLessThanOrEqual(1e-9)
  })

  it('substeps a long move so a thin wall is never tunnelled through', () => {
    const set = buildColliderSet([{ kind: 'box', x: 0, z: 5, hx: 20, hz: 0.05, yaw: 0 }], 4)
    const out = sweepCircle(set, 0, 0, 0, 20, 0.5)
    expect(out.hit).toBe(true)
    expect(out.z).toBeCloseTo(4.45, 6)
    expect(out.z).toBeLessThan(5)
    expect(penetrationDepth(set, out.x, out.z, 0.5)).toBeLessThanOrEqual(1e-9)
  })

  it('moves freely when nothing is in the way', () => {
    const set = buildColliderSet([{ kind: 'circle', x: 50, z: 50, r: 1 }], 4)
    const out = sweepCircle(set, 0, 0, 3, 4, 0.9)
    expect(out.hit).toBe(false)
    expect(out.x).toBeCloseTo(3, 9)
    expect(out.z).toBeCloseTo(4, 9)
  })
})

describe('steerAround', () => {
  it('turns toward the open side when an obstacle sits ahead and keeps that side', () => {
    // Heading 0 is +x. The rock is just to the −z side of the ray, so +z is the open side.
    const set = buildColliderSet([{ kind: 'circle', x: 3, z: -0.6, r: 1 }], 4)
    const first = steerAround(set, 0, 0, 0, 0.9, 2.2, 0)
    expect(first.blocked).toBe(true)
    expect(first.side).toBe(1)
    expect(first.heading).toBeGreaterThan(0.1)
    // The mirrored rock steers the other way.
    const mirror = buildColliderSet([{ kind: 'circle', x: 3, z: 0.6, r: 1 }], 4)
    const second = steerAround(mirror, 0, 0, 0, 0.9, 2.2, 0)
    expect(second.side).toBe(-1)
    expect(second.heading).toBeLessThan(-0.1)
  })

  it('is hysteretic: a side already chosen is kept while still blocked, even on a symmetric obstacle', () => {
    const set = buildColliderSet([{ kind: 'circle', x: 2.5, z: 0, r: 1 }], 4)
    const keepMinus = steerAround(set, 0, 0, 0, 0.9, 2.2, -1)
    expect(keepMinus.blocked).toBe(true)
    expect(keepMinus.side).toBe(-1)
    expect(keepMinus.heading).toBeLessThan(0)
    const keepPlus = steerAround(set, 0, 0, 0, 0.9, 2.2, 1)
    expect(keepPlus.side).toBe(1)
    expect(keepPlus.heading).toBeGreaterThan(0)
  })

  it('returns the heading untouched and clears the side when the way is open', () => {
    const set = buildColliderSet([{ kind: 'circle', x: 30, z: 0, r: 1 }], 4)
    const out = steerAround(set, 0, 0, 0.3, 0.9, 2.2, 1)
    expect(out.blocked).toBe(false)
    expect(out.side).toBe(0)
    expect(out.heading).toBe(0.3)
  })
})

describe('spatial hash', () => {
  it('finds exactly what brute force finds on 500 random colliders / 2000 queries', () => {
    const rng = seeded(1234)
    const items: Collider[] = []
    for (let i = 0; i < 500; i++) {
      const x = (rng() - 0.5) * 200
      const z = (rng() - 0.5) * 200
      if (rng() < 0.5) items.push({ kind: 'circle', x, z, r: 0.3 + rng() * 2.7, id: `c${i}` })
      else items.push({ kind: 'box', x, z, hx: 0.3 + rng() * 3.7, hz: 0.3 + rng() * 3.7, yaw: rng() * Math.PI * 2, id: `b${i}` })
    }
    const hashed = buildColliderSet(items, 3)
    const coarse = buildColliderSet(items, 1e6)
    for (let q = 0; q < 2000; q++) {
      const x = (rng() - 0.5) * 220
      const z = (rng() - 0.5) * 220
      const r = 0.5 + rng() * 0.7
      const brute: number[] = []
      let bruteDepth = 0
      items.forEach((item, i) => {
        const hit = shapePenetration(item, x, z, r)
        if (hit) {
          brute.push(i)
          bruteDepth = Math.max(bruteDepth, hit.depth)
        }
      })
      const candidates = queryCandidates(hashed, x, z, r)
      for (const i of brute) expect(candidates).toContain(i)
      expect(penetrationDepth(hashed, x, z, r)).toBeCloseTo(bruteDepth, 12)
      const a = resolveCircle(hashed, x, z, r)
      const b = resolveCircle(coarse, x, z, r)
      expect(a.x).toBeCloseTo(b.x, 12)
      expect(a.z).toBeCloseTo(b.z, 12)
      expect(a.hit).toBe(b.hit)
    }
  })
})

describe('separateCircles', () => {
  it('ends with no two agents overlapping', () => {
    const rng = seeded(99)
    const agents = Array.from({ length: 40 }, () => ({ x: rng() * 6, z: rng() * 6 }))
    const r = 0.9
    separateCircles(agents, r)
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const d = Math.hypot(agents[i].x - agents[j].x, agents[i].z - agents[j].z)
        expect(d).toBeGreaterThanOrEqual(2 * r - 1e-6)
      }
    }
  })

  it('is deterministic and leaves separated agents alone', () => {
    const agents = [
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    ]
    separateCircles(agents, 0.9)
    expect(agents).toEqual([
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    ])
    const stacked = [
      { x: 0, z: 0 },
      { x: 0, z: 0 },
    ]
    separateCircles(stacked, 0.5)
    expect(Math.hypot(stacked[0].x - stacked[1].x, stacked[0].z - stacked[1].z)).toBeGreaterThanOrEqual(1 - 1e-6)
  })
})
