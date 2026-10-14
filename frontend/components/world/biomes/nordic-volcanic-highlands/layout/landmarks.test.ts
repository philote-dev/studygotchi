import { describe, expect, it } from 'vitest'
import { type Collider, buildColliderSet, penetrationDepth, shapePenetration } from '../../collision/colliders'
import { NORDIC_LAYOUT as L } from './biome-layout'
import { LOOK_BOX } from '../camera/stations'
import { LANDMARKS, bandForFraction, landmarkColliders, landmarksForBand } from './landmarks'
import { landColliders } from './placements'
import { isLandAt } from './terrain'

const SEED = 7
const full = Object.fromEntries(L.districts.map((d) => [d.id, 1]))
const authored = landColliders(L, SEED, full)
const authoredSet = buildColliderSet(authored)

/** Points on a shape's outline plus its centre. */
export function shapeSamples(c: Collider, n = 16): Array<[number, number]> {
  const out: Array<[number, number]> = [[c.x, c.z]]
  if (c.kind === 'circle') {
    for (let i = 0; i < n; i++) out.push([c.x + Math.cos((i / n) * Math.PI * 2) * c.r, c.z + Math.sin((i / n) * Math.PI * 2) * c.r])
    return out
  }
  const cs = Math.cos(c.yaw)
  const sn = Math.sin(c.yaw)
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 4
    const side = Math.floor(t)
    const f = t - side
    const [lx, lz] = side === 0 ? [-c.hx + 2 * c.hx * f, -c.hz] : side === 1 ? [c.hx, -c.hz + 2 * c.hz * f] : side === 2 ? [c.hx - 2 * c.hx * f, c.hz] : [-c.hx, c.hz - 2 * c.hz * f]
    out.push([c.x + lx * cs + lz * sn, c.z - lx * sn + lz * cs])
  }
  return out
}

/** Two ground shapes overlap when a point of one lies inside the other. */
export function shapesOverlap(a: Collider, b: Collider): boolean {
  for (const [x, z] of shapeSamples(a)) if (shapePenetration(b, x, z, 0.01)) return true
  for (const [x, z] of shapeSamples(b)) if (shapePenetration(a, x, z, 0.01)) return true
  return false
}

describe('landmarks: the inhabited land', () => {
  const colliders = LANDMARKS.flatMap((spec) => landmarkColliders(spec, 2))

  it('places 12–16 landmarks with unique ids, every one inside the look box on walkable land', () => {
    expect(LANDMARKS.length).toBeGreaterThanOrEqual(12)
    expect(LANDMARKS.length).toBeLessThanOrEqual(16)
    expect(new Set(LANDMARKS.map((l) => l.id)).size).toBe(LANDMARKS.length)
    for (const spec of LANDMARKS) {
      expect(Math.abs(spec.x), spec.id).toBeLessThanOrEqual(LOOK_BOX.max[0])
      expect(Math.abs(spec.z), spec.id).toBeLessThanOrEqual(LOOK_BOX.max[2])
      expect(isLandAt(spec.x, spec.z), `${spec.id} centre off land`).toBe(true)
      for (const shape of landmarkColliders(spec, 2)) {
        // Jetties and the longship's slipway may reach over the water; everything else stands on the slab.
        if (shape.tag === 'jetty') continue
        for (const [x, z] of shapeSamples(shape, 8)) expect(isLandAt(x, z), `${shape.id} at ${x.toFixed(1)},${z.toFixed(1)} off land`).toBe(true)
      }
    }
  })

  it('never overlaps an authored structure, another landmark, or the authored routes', () => {
    for (const shape of colliders) {
      for (const other of authored) {
        if (other.tag === 'relief') continue // low turf bumps are walkable ground to the eye; checked by clearance below
        expect(shapesOverlap(shape, other), `${shape.id} overlaps ${other.id}`).toBe(false)
      }
    }
    for (let i = 0; i < LANDMARKS.length; i++) {
      for (let j = i + 1; j < LANDMARKS.length; j++) {
        const a = LANDMARKS[i]
        const b = LANDMARKS[j]
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} vs ${b.id}`).toBeGreaterThan(a.radius + b.radius)
      }
    }
    // Clearance from the relief bumps and from every authored collider centre.
    for (const spec of LANDMARKS) {
      for (const other of authored) {
        const reach = other.kind === 'circle' ? other.r : Math.hypot(other.hx, other.hz)
        expect(Math.hypot(spec.x - other.x, spec.z - other.z), `${spec.id} too close to ${other.id}`).toBeGreaterThan(spec.radius * 0.6 + reach * 0.6)
      }
    }
    const routeSet = buildColliderSet(colliders)
    for (const [r, route] of L.routes.entries()) {
      for (let i = 0; i < route.length - 1; i++) {
        const [ax, az] = route[i]
        const [bx, bz] = route[i + 1]
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2)
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n
          const z = az + ((bz - az) * k) / n
          expect(penetrationDepth(routeSet, x, z, r === 0 ? 2.6 : 1.2), `route ${r} at ${x.toFixed(0)},${z.toFixed(0)}`).toBe(0)
        }
      }
    }
    expect(penetrationDepth(authoredSet, 0, 0, 0.1)).toBe(0)
  })

  it('arrives across the three bands, monotonic, with a share in each', () => {
    expect(bandForFraction(0)).toBe(0)
    expect(bandForFraction(0.32)).toBe(0)
    expect(bandForFraction(0.33)).toBe(1)
    expect(bandForFraction(0.67)).toBe(2)
    const counts = [0, 1, 2].map((b) => landmarksForBand(b as 0 | 1 | 2).length)
    expect(counts[0]).toBeGreaterThanOrEqual(4)
    expect(counts[1]).toBeGreaterThan(counts[0])
    expect(counts[2]).toBeGreaterThan(counts[1])
    expect(counts[2]).toBe(LANDMARKS.length)
    // Colliders grow with the band too (upgrade parts included).
    const colliderCounts = [0, 1, 2].map((b) => landmarksForBand(b as 0 | 1 | 2).flatMap((s) => landmarkColliders(s, b as 0 | 1 | 2)).length)
    expect(colliderCounts[1]).toBeGreaterThan(colliderCounts[0])
    expect(colliderCounts[2]).toBeGreaterThan(colliderCounts[1])
    // Every district has a landmark within 70 m of its centre, and the moor between them has some too.
    for (const d of L.districts) {
      if (d.id === 'archipelago') continue
      expect(LANDMARKS.some((l) => Math.hypot(l.x - d.center[0], l.z - d.center[1]) < 70), d.id).toBe(true)
    }
  })

  it('is deterministic data with one exaggerated feature named per place', () => {
    for (const spec of LANDMARKS) {
      expect(spec.feature.length).toBeGreaterThan(20)
      expect(spec.footprint.length).toBeGreaterThanOrEqual(1)
      expect(landmarkColliders(spec, 2)).toEqual(landmarkColliders(spec, 2))
    }
  })
})
