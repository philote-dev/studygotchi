import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createOuterDesert } from './desert'
import { buildOuterMeshes, colourRing, instanceTint, paintProp, propGeometry, seamVertices, triangleCount } from './mesh'
import { PLATE, PROP_CLEARANCE, RINGS, featureDistance, insideRect } from './plate'
import { CORRIDOR_HALF, HOODOO_SPEC, SCATTER, corridorDistance, hoodooField, scatterProps } from './scatter'
import { outwardPose, poseCamera } from './vistas'

const desert = createOuterDesert(7)
const meshes = buildOuterMeshes(desert, RINGS)

describe('ring meshes', () => {
  it('builds three rings in at most four quadrant meshes each, inside a sane triangle budget', () => {
    const rings = new Set(meshes.map((m) => m.ring))
    expect([...rings].sort()).toEqual([1, 2, 3])
    for (const ring of [1, 2, 3]) expect(meshes.filter((m) => m.ring === ring).length).toBeLessThanOrEqual(4)
    const total = triangleCount(meshes)
    expect(total).toBeGreaterThan(20000)
    expect(total).toBeLessThan(70000)
  })

  it('meets the authored plate at exactly y = 0 along the whole boundary (seam test)', () => {
    const seam = seamVertices(meshes)
    expect(seam.length).toBeGreaterThan(300)
    for (const [x, y, z] of seam) {
      expect(y, `${x},${z}`).toBe(desert.seamHeight(x, z))
      expect(y).toBe(0)
    }
    // Every 10 m lattice point of the boundary is present.
    const keys = new Set(seam.map(([x, , z]) => `${Math.round(x)},${Math.round(z)}`))
    for (let x = PLATE.minX; x <= PLATE.maxX; x += 10) {
      expect(keys.has(`${x},${PLATE.minZ}`)).toBe(true)
      expect(keys.has(`${x},${PLATE.maxZ}`)).toBe(true)
    }
    for (let z = PLATE.minZ; z <= PLATE.maxZ; z += 10) {
      expect(keys.has(`${PLATE.minX},${z}`)).toBe(true)
      expect(keys.has(`${PLATE.maxX},${z}`)).toBe(true)
    }
  })

  it('puts no triangle inside the plate', () => {
    for (const m of meshes) {
      for (let i = 0; i < m.position.length; i += 9) {
        const cx = (m.position[i] + m.position[i + 3] + m.position[i + 6]) / 3
        const cz = (m.position[i + 2] + m.position[i + 5] + m.position[i + 8]) / 3
        expect(insideRect(PLATE, cx, cz, -1e-3)).toBe(false)
      }
    }
  })

  it('starts the ring-1 colour at the plate sand with no step, and hazes toward the sky far out', () => {
    const ring1 = meshes.filter((m) => m.ring === 1)
    const sand = new THREE.Color('#d9b07a')
    const sky = new THREE.Color('#e6c58f')
    let seamFaces = 0
    for (const m of ring1) {
      const colours = colourRing(m, { night: false })
      for (let f = 0; f < m.triangles; f++) {
        const o = f * 9
        const cx = (m.position[o] + m.position[o + 3] + m.position[o + 6]) / 3
        const cz = (m.position[o + 2] + m.position[o + 5] + m.position[o + 8]) / 3
        const onSeamCell = insideRect(PLATE, cx, cz, 6)
        if (onSeamCell) {
          seamFaces++
          expect(Math.abs(colours[o] - sand.r) + Math.abs(colours[o + 1] - sand.g) + Math.abs(colours[o + 2] - sand.b)).toBeLessThan(0.02)
        }
      }
    }
    expect(seamFaces).toBeGreaterThan(100)
    const ring3 = meshes.filter((m) => m.ring === 3)
    let far = 0
    let farDiff = 0
    for (const m of ring3) {
      const colours = colourRing(m, { night: false })
      for (let f = 0; f < m.triangles; f++) {
        if (m.haze[f] < 0.85) continue
        const o = f * 9
        far++
        farDiff += Math.abs(colours[o] - sky.r) + Math.abs(colours[o + 1] - sky.g) + Math.abs(colours[o + 2] - sky.b)
      }
    }
    expect(far).toBeGreaterThan(100)
    expect(farDiff / far).toBeLessThan(0.12)
  })

  it('snaps the outer boundary of each finer ring onto the coarser lattice (no cracks at LOD steps)', () => {
    const byRing = (ring: number) => meshes.filter((m) => m.ring === ring)
    for (let r = 0; r < RINGS.length - 1; r++) {
      const fine = RINGS[r]
      const coarse = RINGS[r + 1]
      const fineEdge = new Map<string, number>()
      for (const m of byRing(fine.ring)) {
        for (let i = 0; i < m.position.length; i += 3) {
          const x = m.position[i]
          const z = m.position[i + 2]
          if (Math.max(Math.abs(x), Math.abs(z)) === fine.outer) fineEdge.set(`${x},${z}`, m.position[i + 1])
        }
      }
      let checked = 0
      for (const m of byRing(coarse.ring)) {
        for (let i = 0; i < m.position.length; i += 3) {
          const x = m.position[i]
          const z = m.position[i + 2]
          if (Math.max(Math.abs(x), Math.abs(z)) !== coarse.inner) continue
          const y = fineEdge.get(`${x},${z}`)
          if (y === undefined) continue
          checked++
          expect(Math.abs(y - m.position[i + 1])).toBeLessThan(1e-4)
        }
      }
      expect(checked).toBeGreaterThan(50)
    }
  })
})

describe('scattered props', () => {
  const fields = SCATTER.map((spec) => ({ spec, items: scatterProps(desert, spec) }))

  it('places most of the budget, deterministically', () => {
    for (const { spec, items } of fields) {
      expect(items.length, spec.kind).toBeGreaterThan(spec.count * 0.6)
      expect(scatterProps(desert, spec)).toEqual(items)
    }
  })

  it('keeps every prop off the plate and clear of every authored feature (in-plate exclusion)', () => {
    for (const { spec, items } of fields) {
      for (const p of items) {
        expect(insideRect(PLATE, p.x, p.z), spec.kind).toBe(false)
        expect(featureDistance(p.x, p.z), spec.kind).toBeGreaterThanOrEqual(PROP_CLEARANCE)
        expect(Number.isFinite(p.y)).toBe(true)
      }
    }
  })

  it('respects the minimum spacing', () => {
    // Every pair is still checked (~half a million); the pairs are tallied in a plain loop and asserted once,
    // because an `expect` per pair took seconds and timed out under load.
    const tooClose: string[] = []
    let pairs = 0
    for (const { spec, items } of fields) {
      const limit = spec.minSpacing - 1e-9
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          pairs++
          const d = Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z)
          if (d < limit) tooClose.push(`${spec.kind} ${i} ${j} at ${d.toFixed(2)} m`)
        }
      }
    }
    expect(pairs).toBeGreaterThan(100_000)
    expect(tooClose).toEqual([])
  })

  it('keeps tall props out of the four vista corridors', () => {
    const saguaros = fields.find((f) => f.spec.kind === 'saguaro')!.items
    for (const v of desert.vistas) {
      const cam = poseCamera(outwardPose(v.id))
      for (const p of saguaros) expect(corridorDistance(cam, v, p.x, p.z)).toBeGreaterThanOrEqual(CORRIDOR_HALF)
    }
  })

  it('grows the hoodoo field along the western bench with the window cut out of it', () => {
    const hoodoos = hoodooField(desert)
    const west = desert.windows.find((w) => w.id === 'west')!
    expect(hoodoos.length).toBeGreaterThan(HOODOO_SPEC.count * 0.6)
    for (const h of hoodoos) {
      expect(Math.abs(h.z - west.along)).toBeGreaterThanOrEqual(west.halfWidth + 14)
      expect(h.x).toBeLessThan(desert.escarpment(h.z).x + 8)
      expect(h.height).toBeGreaterThanOrEqual(HOODOO_SPEC.height[0])
      expect(h.height).toBeLessThanOrEqual(HOODOO_SPEC.height[1])
    }
    const south = hoodoos.filter((h) => h.z > west.along).length
    const north = hoodoos.filter((h) => h.z < west.along).length
    expect(south).toBeGreaterThan(8)
    expect(north).toBeGreaterThan(8)
  })

  it('bakes prop colours and tints instances back toward their own haze within [0, 1]', () => {
    for (const kind of ['saguaro', 'scrub', 'rock', 'hoodoo'] as const) {
      const built = propGeometry(kind)
      paintProp(built.geometry, built.which, kind, { night: false })
      expect(built.geometry.getAttribute('color').count).toBe(built.geometry.getAttribute('position').count)
      for (const night of [false, true]) {
        for (const haze of [0, 0.2, 0.5, 0.8]) {
          const c = instanceTint(kind, { night }, haze, new THREE.Color())
          for (const ch of [c.r, c.g, c.b]) {
            expect(ch).toBeGreaterThanOrEqual(0)
            expect(ch).toBeLessThanOrEqual(1)
          }
        }
      }
      built.geometry.dispose()
    }
  })
})
