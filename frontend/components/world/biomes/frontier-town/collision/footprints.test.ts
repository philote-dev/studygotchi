import { describe, expect, it } from 'vitest'
import { buildColliderSet, penetrationDepth, shapePenetration } from '../../collision/colliders'
import { FRONTIER_LAYOUT, generateLayout } from '../layout/biome-layout'
import { TOWN } from '../layout/placements'
import { createWalkers, stepWalkers, wanderTarget, WALKER_RADIUS } from '../scene/walkers'
import { frontierColliders, roadCentrelines, townColliders, worldFromLocal } from './footprints'

const generated = generateLayout(7)
const full = Object.fromEntries(FRONTIER_LAYOUT.districts.map((d) => [d.id, 1]))
const empty = Object.fromEntries(FRONTIER_LAYOUT.districts.map((d) => [d.id, 0]))

describe('collider derivation', () => {
  it('registers every building, mesa, cactus, fence, cart and well from the placement data', () => {
    const all = frontierColliders(generated, full)
    const byTag = new Map<string, number>()
    for (const c of all) byTag.set(c.tag ?? '?', (byTag.get(c.tag ?? '?') ?? 0) + 1)
    expect(all.length).toBeGreaterThan(250)
    expect(byTag.get('building')).toBeGreaterThanOrEqual(25)
    expect(byTag.get('fence')).toBeGreaterThanOrEqual(48 + 6)
    expect(byTag.get('plant')).toBeGreaterThanOrEqual(40)
    expect(byTag.get('anchor')).toBeGreaterThanOrEqual(6)
    expect(byTag.get('landform')).toBeGreaterThanOrEqual(6)
    expect(byTag.get('animal')).toBeGreaterThanOrEqual(14)
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length)
    for (const c of all) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.z)).toBe(true)
      if (c.kind === 'circle') expect(c.r).toBeGreaterThan(0)
      else expect(c.hx > 0 && c.hz > 0).toBe(true)
    }
  })

  it('is band-gated like the meshes: fewer colliders at 0 % than at 100 %', () => {
    const none = frontierColliders(generated, empty)
    const all = frontierColliders(generated, full)
    expect(none.length).toBeGreaterThan(40)
    expect(none.length).toBeLessThan(all.length * 0.6)
  })

  it('places the town fronts where the scene draws them (district centre + yaw)', () => {
    const town = generated.districts.find((d) => d.id === 'main-town')!
    const fronts = townColliders(town, 12).filter((c) => c.id?.startsWith('town:front:') && c.kind === 'box' && !c.id.includes('#'))
    const bodies = townColliders(town, 12).filter((c) => c.kind === 'box' && c.id?.match(/^town:front:\d+#0$/))
    expect(fronts.length + bodies.length).toBe(12)
    const first = bodies[0]
    const [x, z] = worldFromLocal(town.center[0], town.center[1], town.yaw, TOWN.slots[0].x, TOWN.slots[0].z)
    expect(first.x).toBeCloseTo(x, 6)
    expect(first.z).toBeCloseTo(z, 6)
  })

  it('leaves every road centreline clear', () => {
    const all = frontierColliders(generated, full)
    for (const road of roadCentrelines(generated)) {
      const dx = road.b[0] - road.a[0]
      const dz = road.b[1] - road.a[1]
      const len = Math.hypot(dx, dz)
      const steps = Math.ceil(len / 0.25)
      for (let i = 0; i <= steps; i++) {
        const x = road.a[0] + (dx * i) / steps
        const z = road.a[1] + (dz * i) / steps
        for (const c of all) {
          const hit = shapePenetration(c, x, z, 0.01)
          expect(hit, `${c.id} crosses ${road.id} at ${x.toFixed(1)},${z.toFixed(1)}`).toBeNull()
        }
      }
    }
  })

  it('is deterministic for a seed and differs across seeds', () => {
    expect(frontierColliders(generateLayout(7), full)).toEqual(frontierColliders(generateLayout(7), full))
    const a = frontierColliders(generateLayout(7), full)
    const b = frontierColliders(generateLayout(8), full)
    expect(a.some((c, i) => b[i] === undefined || c.x !== b[i].x || c.z !== b[i].z)).toBe(true)
  })
})

describe('walkers', () => {
  it('chase the figure-of-eight the scene has always drawn', () => {
    const home: [number, number] = [-40, 4]
    const p = wanderTarget(home, 0, 0)
    expect(p).toEqual({ x: -40, z: 4 + Math.sin(0.4) * 6 })
    const q = wanderTarget(home, 1.7, 10)
    const t = 10 * 0.35 + 1.7
    expect(q.x).toBeCloseTo(-40 + Math.sin(t) * 8)
    expect(q.z).toBeCloseTo(4 + Math.sin(2 * t + 0.4) * 6)
  })

  it('walk for 60 s at 60 Hz with zero penetration, moving, and staying near home', () => {
    const set = buildColliderSet(frontierColliders(generated, full), 4)
    const walkers = createWalkers(generated, set, 10)
    expect(walkers.length).toBe(10)
    for (const w of walkers) expect(penetrationDepth(set, w.x, w.z, w.r)).toBeLessThan(1e-6)
    const dt = 1 / 60
    let worst = 0
    for (let frame = 1; frame <= 3600; frame++) {
      stepWalkers(walkers, set, frame * dt, dt)
      for (const w of walkers) {
        const depth = penetrationDepth(set, w.x, w.z, w.r)
        if (depth > worst) worst = depth
        expect(depth, `walker ${w.index} at frame ${frame}`).toBeLessThan(1e-6)
        expect(Math.hypot(w.x - w.home[0], w.z - w.home[1]), `walker ${w.index} wandered off`).toBeLessThan(60)
      }
    }
    expect(worst).toBeLessThan(1e-6)
    for (const w of walkers) expect(w.travelled, `walker ${w.index} never moved`).toBeGreaterThan(20)
    // Bodies stay apart too.
    for (let i = 0; i < walkers.length; i++) for (let j = i + 1; j < walkers.length; j++) expect(Math.hypot(walkers[i].x - walkers[j].x, walkers[i].z - walkers[j].z)).toBeGreaterThan(WALKER_RADIUS * 2 - 1e-3)
  })

  it('is deterministic', () => {
    const set = buildColliderSet(frontierColliders(generated, full), 4)
    const a = createWalkers(generated, set, 10)
    const b = createWalkers(generated, set, 10)
    for (let frame = 1; frame <= 600; frame++) {
      stepWalkers(a, set, frame / 60, 1 / 60)
      stepWalkers(b, set, frame / 60, 1 / 60)
    }
    expect(a).toEqual(b)
  })
})
