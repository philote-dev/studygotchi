import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { generateKingdom } from '../../layout/biome-layout'
import { inRect, rectDistance, rectEuclid } from '../../layout/terrain'
import { buildOuterMeshes, buildPlateDecals, buildRibbon, colourRing, decalGeometry, recolourGeometry, ringGeometry, triangleCount } from './outer-mesh'
import { createOuterWorld } from './outer-world'
import { FIELD_TONES_DAY, FIELD_TONES_NIGHT, fieldToneColour, nightGreen } from './palette'
import { HEDGE_REACH, TREE_L0_REACH, TREE_L1_REACH, TREE_REACH, haystacks, hedgerows, trees } from './scatter'
import { MEADOW_PALETTE as P } from '../../layout/biome-layout'

const layout = generateKingdom(7)
const world = createOuterWorld(layout, 7)
const plate = world.plate
const meshes = buildOuterMeshes(world)

describe('endless meadow: ring meshes', () => {
  it('builds three rings as quadrant meshes inside a 60k-triangle budget', () => {
    expect(new Set(meshes.map((m) => m.ring))).toEqual(new Set([1, 2, 3]))
    expect(meshes.length).toBeLessThanOrEqual(12)
    const total = triangleCount(meshes)
    expect(total).toBeGreaterThan(20_000)
    expect(total).toBeLessThanOrEqual(60_000)
  })

  it('has finite positions, unit normals that never point down, and one colour per face', () => {
    for (const m of meshes) {
      expect(m.position.length).toBe(m.triangles * 9)
      expect(m.normal.length).toBe(m.triangles * 9)
      for (let i = 0; i < m.position.length; i += 3) {
        expect(Number.isFinite(m.position[i]) && Number.isFinite(m.position[i + 1]) && Number.isFinite(m.position[i + 2])).toBe(true)
        const len = Math.hypot(m.normal[i], m.normal[i + 1], m.normal[i + 2])
        expect(len).toBeGreaterThan(0.99)
        expect(len).toBeLessThan(1.01)
        expect(m.normal[i + 1]).toBeGreaterThan(0)
      }
      const geo = ringGeometry(m, { night: false })
      expect(geo.getAttribute('color').count).toBe(m.triangles * 3)
      geo.dispose()
    }
  })

  it('puts every vertex outside the plate and every seam vertex exactly on y = 0', () => {
    let seam = 0
    for (const m of meshes) {
      for (let i = 0; i < m.position.length; i += 3) {
        const x = m.position[i]
        const y = m.position[i + 1]
        const z = m.position[i + 2]
        expect(rectDistance(plate, x, z)).toBeGreaterThanOrEqual(-1e-6)
        if (Math.abs(rectDistance(plate, x, z)) < 1e-6) {
          expect(y, `seam vertex ${x},${z}`).toBe(0)
          seam++
        }
      }
    }
    // 2 × (60 + 54) cells of 10 m, two seam vertices each face … at least the perimeter's 228 lattice points.
    expect(seam).toBeGreaterThan(400)
  })

  it('is watertight across the LOD steps: the finer ring\u2019s boundary heights lie on the coarser ring\u2019s edges', () => {
    const byRing = (ring: number) => meshes.filter((m) => m.ring === ring)
    const boundary = (ring: number, distance: number) => {
      const map = new Map<string, number>()
      for (const m of byRing(ring)) {
        for (let i = 0; i < m.position.length; i += 3) {
          const x = m.position[i]
          const z = m.position[i + 2]
          if (Math.abs(rectDistance(plate, x, z) - distance) < 1e-6) map.set(`${x},${z}`, m.position[i + 1])
        }
      }
      return map
    }
    for (const [inner, outer, distance, cell] of [
      [1, 2, 300, 30],
      [2, 3, 840, 60],
    ] as const) {
      const fine = boundary(inner, distance)
      const coarse = boundary(outer, distance)
      expect(fine.size).toBeGreaterThan(coarse.size)
      expect(coarse.size).toBeGreaterThan(40)
      // Shared lattice points agree exactly.
      let shared = 0
      for (const [key, h] of coarse) {
        if (fine.has(key)) {
          expect(fine.get(key), `LOD ${inner}/${outer} at ${key}`).toBeCloseTo(h, 6)
          shared++
        }
      }
      expect(shared).toBe(coarse.size)
      // In-between fine vertices sit on the straight edge between their coarse neighbours.
      let between = 0
      for (const [key, h] of fine) {
        if (coarse.has(key)) continue
        const [x, z] = key.split(',').map(Number)
        const alongX = Math.abs(Math.abs(z - (plate.minZ + plate.maxZ) / 2) - ((plate.maxZ - plate.minZ) / 2 + distance)) < 1e-6
        const axis = alongX ? x : z
        const lo = Math.floor(axis / cell) * cell
        const hi = lo + cell
        const a = coarse.get(alongX ? `${lo},${z}` : `${x},${lo}`)
        const b = coarse.get(alongX ? `${hi},${z}` : `${x},${hi}`)
        if (a === undefined || b === undefined) continue
        const t = (axis - lo) / cell
        // Float32 storage: 1e-4 m is far below anything a camera could see as a crack.
        expect(h, `LOD ${inner}/${outer} between at ${key}`).toBeCloseTo(a + (b - a) * t, 4)
        between++
      }
      expect(between).toBeGreaterThan(40)
    }
  })

  it('recolours in place for night with the plate\u2019s own night green on tone-0 faces, and hazes far faces toward the sky', () => {
    const near = meshes.find((m) => m.ring === 1)!
    const geo = ringGeometry(near, { night: false })
    const day = Array.from((geo.getAttribute('color').array as Float32Array).slice(0, 9))
    recolourGeometry(geo, near, { night: true })
    const night = Array.from((geo.getAttribute('color').array as Float32Array).slice(0, 9))
    expect(night).not.toEqual(day)
    expect(nightGreen(P.meadow)).toBe(P.meadowNight)
    expect(fieldToneColour(0, { night: true })).toBe(P.meadowNight)
    expect(FIELD_TONES_NIGHT).toHaveLength(FIELD_TONES_DAY.length)
    geo.dispose()
    const far = meshes.find((m) => m.ring === 3)!
    const colours = colourRing(far, { night: false })
    // Far faces are mostly haze: closer to the sky colour than the meadow (vertex colours are linear, like three's Color).
    const sky = new THREE.Color(P.sky).toArray()
    const meadow = new THREE.Color(P.meadow).toArray()
    let skyward = 0
    for (let f = 0; f < far.triangles; f += 50) {
      const r = colours[f * 9]
      const g = colours[f * 9 + 1]
      const b = colours[f * 9 + 2]
      const dSky = Math.hypot(r - sky[0], g - sky[1], b - sky[2])
      const dMeadow = Math.hypot(r - meadow[0], g - meadow[1], b - meadow[2])
      if (dSky < dMeadow) skyward++
    }
    expect(skyward).toBeGreaterThan(far.triangles / 50 / 2)
  })
})

describe('endless meadow: decals, ribbons and instances', () => {
  it('lays field decals on the plate only, never tone 0, never in the forbidden zone', () => {
    const decals = buildPlateDecals(world)
    expect(decals.triangles).toBeGreaterThan(40)
    for (let f = 0; f < decals.triangles; f++) {
      expect(decals.tone[f]).toBeGreaterThan(0)
      for (let v = 0; v < 3; v++) {
        const x = decals.position[f * 9 + v * 3]
        const z = decals.position[f * 9 + v * 3 + 2]
        expect(inRect(plate, x, z)).toBe(true)
        expect(decals.position[f * 9 + v * 3 + 1]).toBeGreaterThan(0)
        expect(decals.position[f * 9 + v * 3 + 1]).toBeLessThan(0.015)
      }
    }
    const geo = decalGeometry(decals, { night: false })
    expect(geo.getAttribute('color').count).toBe(decals.triangles * 3)
    geo.dispose()
  })

  it('drapes the river ribbon on the heightfield from the authored end to the lake, level with the plate ribbon at the seam', () => {
    const geo = buildRibbon(world, { points: world.river.south, width: () => layout.riverWidth, lift: 0.045, step: 8 }, P.water)
    const pos = geo.getAttribute('position')
    expect(pos.count).toBeGreaterThan(20)
    // First vertex pair: on the plate at the authored ribbon's height.
    expect(pos.getY(0)).toBeCloseTo(0.045, 6)
    expect(pos.getY(1)).toBeCloseTo(0.045, 6)
    let below = 0
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) below++
    expect(below).toBeGreaterThan(4)
    geo.dispose()
  })

  it('places hedgerows, trees, woods, copses and haystacks only where the world allows, by LOD band, thinning with distance', () => {
    const hedges = hedgerows(world)
    const field = trees(world)
    const hay = haystacks(world)
    expect(hedges.length).toBeGreaterThan(400)
    expect(hedges.length).toBeLessThan(3000)
    expect(field.l0.length).toBeGreaterThan(100)
    expect(field.l1.length).toBeGreaterThan(100)
    expect(field.l2.length).toBeGreaterThan(100)
    expect(field.woods.length).toBeGreaterThan(300)
    expect(field.copses.length).toBeGreaterThan(10)
    expect(hay.length).toBeGreaterThan(20)
    expect(hay.length).toBeLessThan(600)
    for (const h of hedges) {
      expect(world.forbidden(h.x, h.z)).toBe(false)
      expect(rectEuclid(plate, h.x, h.z)).toBeLessThanOrEqual(HEDGE_REACH + 1)
      expect(h.length).toBeGreaterThan(2)
      expect(h.length).toBeLessThan(14)
    }
    for (const t of field.l0) {
      expect(world.decorate(t.x, t.z), `tree at ${t.x},${t.z}`).toBe(true)
      expect(rectEuclid(plate, t.x, t.z)).toBeLessThanOrEqual(TREE_L0_REACH)
      expect(Math.abs(t.y - world.meshHeight(t.x, t.z))).toBeLessThan(0.2)
    }
    for (const t of field.l1) {
      expect(world.decorate(t.x, t.z)).toBe(true)
      expect(rectEuclid(plate, t.x, t.z)).toBeGreaterThan(TREE_L0_REACH)
      expect(rectEuclid(plate, t.x, t.z)).toBeLessThanOrEqual(TREE_L1_REACH)
    }
    for (const t of field.l2) {
      expect(world.decorate(t.x, t.z)).toBe(true)
      expect(rectEuclid(plate, t.x, t.z)).toBeGreaterThan(TREE_L1_REACH)
      expect(rectEuclid(plate, t.x, t.z)).toBeLessThanOrEqual(TREE_REACH)
    }
    for (const c of field.woods) {
      expect(world.decorate(c.x, c.z)).toBe(true)
      expect(world.forestAt(c.x, c.z)).toBeGreaterThan(0.1)
      if (c.trunk) expect(rectEuclid(plate, c.x, c.z)).toBeLessThanOrEqual(TREE_L1_REACH)
    }
    for (const c of field.copses) {
      expect(world.decorate(c.x, c.z)).toBe(true)
      expect(c.scale).toBeGreaterThan(0.6)
      expect(c.scale).toBeLessThan(1.6)
    }
    for (const h of hay) expect(world.decorate(h.x, h.z)).toBe(true)
    // Thinning: lone-tree density per area falls with distance from the plate.
    const density = (from: number, to: number) => {
      const count = [...field.l0, ...field.l1, ...field.l2].filter((t) => {
        const d = rectEuclid(plate, t.x, t.z)
        return d >= from && d < to
      }).length
      const area = (plate.maxX - plate.minX + 2 * to) * (plate.maxZ - plate.minZ + 2 * to) - (plate.maxX - plate.minX + 2 * from) * (plate.maxZ - plate.minZ + 2 * from)
      return count / area
    }
    expect(density(0, 150)).toBeGreaterThan(density(300, 600) * 1.5)
  })

  it('is deterministic', () => {
    const twin = createOuterWorld(layout, 7)
    expect(hedgerows(twin)).toEqual(hedgerows(world))
    expect(trees(twin).l0.length).toBe(trees(world).l0.length)
    expect(trees(twin).woods.length).toBe(trees(world).woods.length)
    expect(triangleCount(buildOuterMeshes(twin))).toBe(triangleCount(meshes))
  })

  it('reports the rendered height: meshHeight equals the ring vertices at lattice points and interpolates their triangles between', () => {
    // Every lattice vertex of every ring (sampled) is reproduced exactly.
    let checked = 0
    for (const m of meshes) {
      for (let i = 0; i < m.position.length; i += 27 * 7) {
        const x = m.position[i]
        const y = m.position[i + 1]
        const z = m.position[i + 2]
        if (Math.abs(rectDistance(plate, x, z) - 300) < 1e-6 || Math.abs(rectDistance(plate, x, z) - 840) < 1e-6) continue // LOD-snapped
        expect(world.meshHeight(x, z), `vertex ${x},${z}`).toBeCloseTo(y, 3)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(200)
    // The castle stands on the crag's rendered summit, not on an analytic peak the 20 m lattice cut off.
    const crag = world.plan.crag
    const analytic = world.sample(crag.x, crag.z).height
    const rendered = world.meshHeight(crag.x, crag.z)
    expect(analytic - rendered).toBeLessThan(2.5)
    expect(rendered).toBeGreaterThan(crag.height * 0.85)
    expect(world.meshHeight(0, 0)).toBe(0)
  })
})
