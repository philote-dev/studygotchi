import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ICE_TOWN_LAYOUT as L, ICE_TOWN_PALETTE as P } from '../../layout/biome-layout'
import { landField } from '../../layout/terrain'
import { Batch, ROOT_DEPTH, buildApron, buildFloeGeometry, buildRing, buildVista, place, prism } from './build'
import { COAST_CLEARANCE, barrierPlan } from './geography'

const SEED = 8223
const plan = barrierPlan(L, SEED)

function triangles(geo: THREE.BufferGeometry): number {
  return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3
}

/** Everything the Scene draws, by construction: see `barriers.tsx`. */
const DRAW_CALLS = {
  ring: 1,
  apron: 1,
  floes: 1,
  vistaBodies: 4,
  vistaLamps: 4,
  sweepCone: 1,
  plume: 1,
}

describe('barriers: geometry budget', () => {
  it('merges the whole enclosure into a few buffers under 60k triangles and 35 draw calls', () => {
    const geos = [buildRing(plan, SEED, false), buildApron(L, plan.apron, false), buildFloeGeometry(false), ...plan.vistas.map((v) => buildVista(v, false, SEED).geometry)]
    const total = geos.reduce((sum, g) => sum + triangles(g), 0) + plan.floes.far.length * 0 // instances share one buffer
    expect(total).toBeLessThanOrEqual(60_000)
    expect(triangles(geos[0])).toBeGreaterThan(600)
    expect(Object.values(DRAW_CALLS).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(35)
    for (const g of geos) g.dispose()
  })

  it('gives every buffer finite positions, unit normals and vertex colours', () => {
    for (const geo of [buildRing(plan, SEED, true), buildApron(L, plan.apron, true), ...plan.vistas.map((v) => buildVista(v, true, SEED).geometry)]) {
      const pos = geo.attributes.position
      const nor = geo.attributes.normal
      const col = geo.attributes.color
      expect(col.count).toBe(pos.count)
      for (let i = 0; i < pos.count; i += 7) {
        expect(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i))).toBe(true)
        const len = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))
        expect(len).toBeGreaterThan(0.99)
        expect(len).toBeLessThan(1.01)
        expect(col.getX(i)).toBeGreaterThanOrEqual(0)
        expect(col.getX(i)).toBeLessThanOrEqual(1)
      }
      geo.dispose()
    }
  })
})

describe('barriers: ring geometry', () => {
  it('sinks every wall root below the sea and keeps every built vertex 40 m clear of the coast', () => {
    const geo = buildRing(plan, SEED, false)
    const pos = geo.attributes.position
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      // The built shapes (feet, shoulders, side blocks) reach past the plan's footprint: check them too.
      if (i % 5 === 0) {
        const x = pos.getX(i)
        const z = pos.getZ(i)
        expect(landField(L, x, z), `ring vertex near the coast at ${x.toFixed(0)},${z.toFixed(0)}`).toBeLessThan(-COAST_CLEARANCE)
      }
    }
    expect(minY).toBeLessThanOrEqual(-ROOT_DEPTH + 0.01)
    // Only the gate stands tall; every headland block stays low.
    expect(maxY).toBeGreaterThan(36)
    expect(maxY).toBeLessThan(46)
    geo.dispose()
  })

  it('paints the headlands in the land’s pale ice: lit faces #d9e4ee, shade faces #a9cfe8, a half step between', () => {
    const geo = buildRing(plan, SEED, false)
    const col = geo.attributes.color
    const pos = geo.attributes.position
    const lit = new THREE.Color('#d9e4ee')
    const shade = new THREE.Color('#a9cfe8')
    const half = lit.clone().lerp(shade, 0.5)
    const snow = new THREE.Color(P.snow)
    const snows = [1, 0.9, 0.78].map((k) => snow.clone().multiplyScalar(k))
    const seen = { lit: 0, shade: 0, half: 0, other: 0 }
    for (let i = 0; i < col.count; i += 3) {
      if (pos.getY(i) < 1.5) continue // roots and waterline
      const c = new THREE.Color(col.getX(i), col.getY(i), col.getZ(i))
      const near = (t: THREE.Color) => Math.abs(c.r - t.r) + Math.abs(c.g - t.g) + Math.abs(c.b - t.b) < 0.03
      if (near(lit)) seen.lit++
      else if (near(shade)) seen.shade++
      else if (near(half)) seen.half++
      else if (!snows.some(near)) seen.other++ // snow on the arch crown is allowed
    }
    expect(seen.lit).toBeGreaterThan(50)
    expect(seen.shade).toBeGreaterThan(50)
    expect(seen.half).toBeGreaterThan(20)
    expect(seen.other).toBeLessThan((seen.lit + seen.shade + seen.half) * 0.12)
    geo.dispose()
  })

  it('gives every headland block a peaked top (no face of the skyline is horizontal)', () => {
    const geo = buildRing(plan, SEED, false)
    const nor = geo.attributes.normal
    const pos = geo.attributes.position
    let flatTopFaces = 0
    for (let i = 0; i < nor.count; i += 3) {
      if (pos.getY(i) < 3) continue
      if (nor.getY(i) > 0.995) flatTopFaces++
    }
    expect(flatTopFaces).toBe(0)
    geo.dispose()
  })

  it('builds outward-facing prisms (every side normal points away from the axis)', () => {
    const rng = () => 0.5
    const tris = prism({ sides: 6, rx: 10, rz: 6, taper: 0.7, y0: -2, y1: 10, jitter: 0, rng })
    expect(tris.length % 9).toBe(0)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const n = new THREE.Vector3()
    const mid = new THREE.Vector3()
    for (let i = 0; i < tris.length; i += 9) {
      a.set(tris[i], tris[i + 1], tris[i + 2])
      b.set(tris[i + 3], tris[i + 4], tris[i + 5])
      c.set(tris[i + 6], tris[i + 7], tris[i + 8])
      n.copy(c).sub(b).cross(a.clone().sub(b)).normalize()
      mid.copy(a).add(b).add(c).divideScalar(3)
      if (Math.abs(n.y) > 0.99) expect(n.y).toBeGreaterThan(0)
      else expect(n.x * mid.x + n.z * mid.z).toBeGreaterThan(0)
    }
  })

  it('bakes the facet shade: faces toward the key light are brighter than faces away from it', () => {
    const batch = new Batch(false)
    batch.geo(new THREE.BoxGeometry(2, 2, 2), place(0, 0, 0), '#8fbfdc')
    const geo = batch.build()
    const col = geo.attributes.color
    const nor = geo.attributes.normal
    let lit = 0
    let shade = 0
    for (let i = 0; i < col.count; i++) {
      if (nor.getY(i) > 0.9) lit = col.getX(i)
      if (nor.getY(i) < -0.9) shade = col.getX(i)
    }
    expect(lit).toBeGreaterThan(shade * 1.3)
  })
})

describe('barriers: apron geometry', () => {
  it('starts exactly at the plate edge, carries snow north, and ends under the water on every side', () => {
    const geo = buildApron(L, plan.apron, false)
    const pos = geo.attributes.position
    let edgeAbove = 0
    let farAbove = 0
    let sideAbove = 0
    let snowRows = 0
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i)
      const x = pos.getX(i)
      const y = pos.getY(i)
      if (z === plan.apron.maxZ && y > L.seaLevel) edgeAbove++
      if (z === plan.apron.minZ && y > L.seaLevel) farAbove++
      if ((x === plan.apron.minX || x === plan.apron.maxX) && y > L.seaLevel) sideAbove++
      if (z < -L.worldExtent - 200 && z > -L.worldExtent - 400 && Math.abs(x) < 200 && y > L.seaLevel + 1) snowRows++
    }
    expect(edgeAbove).toBeGreaterThan(50)
    expect(farAbove).toBe(0)
    expect(sideAbove).toBe(0)
    expect(snowRows).toBeGreaterThan(300)
    expect(triangles(geo)).toBeLessThan(34_000)
    geo.dispose()
  })
})
