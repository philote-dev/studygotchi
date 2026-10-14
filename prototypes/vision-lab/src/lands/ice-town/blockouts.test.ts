import { describe, expect, it } from 'vitest'
import { archipelagoHeight, buildArchipelago, GLACIER, HARBOUR, LAKE as PLATE_LAKE, ROCK, SLAB, TOWN } from './archipelago'
import { buildCoast, coastHeight, coastZ, LAKE as COAST_LAKE, SLAB as COAST_SLAB } from './expedition-coast'
import { bayCentre, bayHalfWidth, buildFjord, fjordHeight, ISLET, LAKE as FJORD_LAKE, ROCK as FJORD_ROCK } from './fjord-village'
import { GEO, triangles } from './kit'
import { fbm, mulberry32, valueNoise } from './noise'
import { buildHeightfield } from './terrain'
import { crackGap, type WorldData } from './world'

const SEED = 7
const BUDGET = 80_000
/** Hero JSX pieces (lighthouse, arch, mast, icebreaker, church, tree, whale, balloon, sweep). */
const HERO_ALLOWANCE = 5_000

/** Triangles of everything WorldMeshes draws for a world (instance counts × unit geometry). */
export function worldTriangles(w: WorldData): number {
  const box = triangles(GEO.box)
  const cabin = box * 5 + triangles(GEO.roof)
  const chimneys = w.cabins.filter((c) => c.chimney).length
  return (
    w.field.triangles +
    w.cabins.length * cabin +
    chimneys * box +
    Math.ceil(chimneys / 2) * 3 * triangles(GEO.sphere) +
    w.pines.length * triangles(GEO.cone) * 2 +
    w.lamps.length * box * 2 +
    w.boats.length * box * 2 +
    w.penguins.length * box * 2 +
    (w.decks.length + w.steps.length + w.shards.length + w.modules.length + w.vehicles.length + w.fences.length + w.seals.length) * box +
    (w.posts.length + w.tanks.length) * triangles(GEO.cyl) +
    w.floes.length * triangles(GEO.hex) +
    (w.crystals.length + w.pinnacles.length) * triangles(GEO.spire) +
    w.igloos.length * triangles(GEO.dome) +
    w.tents.length * triangles(GEO.pyramid)
  )
}

describe('ice noise', () => {
  it('is deterministic per seed and bounded', () => {
    const a = mulberry32(3)
    const b = mulberry32(3)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 0.37, i * 0.11, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(valueNoise(1.3, 2.7, 1)).not.toBe(valueNoise(1.3, 2.7, 2))
    expect(fbm(4.2, 8.1, 9)).toBe(fbm(4.2, 8.1, 9))
  })
  it('cracks the sea ice into cells with narrow leads', () => {
    let leads = 0
    for (let i = 0; i < 400; i++) if (crackGap(i * 1.7, i * 0.9, 14, 3) < 1.5) leads++
    expect(leads).toBeGreaterThan(10)
    expect(leads).toBeLessThan(200)
  })
})

describe('faceted heightfield', () => {
  it('splits every cell in two and classifies risers as steep', () => {
    const field = buildHeightfield({
      xMin: 0,
      xMax: 6,
      zMin: 0,
      zMax: 6,
      cell: 3,
      height: (x) => (x > 4 ? 8 : 0),
      facet: (_cx, _cy, _cz, ny) => (ny < 0.5 ? 'cliff' : 'flat'),
    })
    expect(field.triangles).toBe(8)
    expect(field.groups.find((g) => g.color === 'cliff')?.positions.length).toBe(4 * 9)
    expect(field.groups.find((g) => g.color === 'flat')?.positions.length).toBe(4 * 9)
  })
})

describe('A · Penguin Isle Archipelago', () => {
  const h = archipelagoHeight(SEED)
  it('floats plates at four heights in deep water', () => {
    expect(Math.abs(h(TOWN.x, TOWN.z) - TOWN.y)).toBeLessThan(1)
    expect(Math.abs(h(HARBOUR.x, HARBOUR.z) - HARBOUR.y)).toBeLessThan(1)
    expect(Math.abs(h(GLACIER.x, GLACIER.z) - GLACIER.y)).toBeLessThan(2.5)
    expect(h(PLATE_LAKE.x, PLATE_LAKE.z)).toBeLessThan(PLATE_LAKE.y)
    expect(Math.abs(h(SLAB.x, SLAB.z) - SLAB.y)).toBeLessThan(1)
    expect(Math.abs(h(ROCK.x, ROCK.z) - ROCK.y)).toBeLessThan(1)
    expect(h(46, 70)).toBeLessThan(0)
    expect(h(0, -170)).toBeGreaterThan(50)
    expect(h(0, -194)).toBeLessThan(0)
  })
  it('stays under the triangle budget with a dense, living archipelago', () => {
    const w = buildArchipelago(SEED)
    expect(worldTriangles(w) + HERO_ALLOWANCE).toBeLessThan(BUDGET)
    expect(w.cabins.length).toBeGreaterThan(100)
    expect(w.pines.length).toBeGreaterThan(100)
    expect(w.penguins.length).toBeGreaterThan(100)
    expect(w.crystals.length).toBeGreaterThan(20)
    expect(w.pinnacles.length).toBeGreaterThan(8)
    expect(w.igloos.length).toBe(6)
    expect(w.modules.length).toBe(5)
    expect(w.decks.length).toBeGreaterThan(8)
    expect(w.steps.length).toBeGreaterThan(6)
  })
})

describe('B · Fjord Fishing Village', () => {
  const h = fjordHeight(SEED)
  it('opens a bay between rising shores, frozen at the glacier head', () => {
    expect(h(bayCentre(100), 100)).toBeLessThan(0)
    expect(Math.abs(h(bayCentre(-50), -50) - 1.4)).toBeLessThan(0.6)
    expect(h(bayCentre(60) - bayHalfWidth(60) - 20, 60)).toBeGreaterThan(1)
    expect(h(bayCentre(60) - bayHalfWidth(60) - 20, 60)).toBeLessThan(9)
    expect(h(bayCentre(-100), -100)).toBeGreaterThan(26)
    expect(h(FJORD_LAKE.x, FJORD_LAKE.z)).toBe(FJORD_LAKE.y)
    expect(Math.abs(h(ISLET.x, ISLET.z) - ISLET.y)).toBeLessThan(1)
    expect(Math.abs(h(FJORD_ROCK.x, FJORD_ROCK.z) - FJORD_ROCK.y)).toBeLessThan(1)
    expect(h(-10, -150)).toBeGreaterThan(60)
    expect(h(0, 180)).toBeLessThan(0)
  })
  it('stays under the triangle budget with the densest village', () => {
    const w = buildFjord(SEED)
    expect(worldTriangles(w) + HERO_ALLOWANCE).toBeLessThan(BUDGET)
    expect(w.cabins.length).toBeGreaterThan(140)
    expect(w.pines.length).toBeGreaterThan(250)
    expect(w.boats.length).toBeGreaterThan(20)
    expect(w.penguins.length).toBeGreaterThan(60)
    expect(w.modules.length).toBe(3)
  })
})

describe('C · Expedition Coast', () => {
  const h = coastHeight(SEED)
  it('freezes the sea off a long coast with leads, a slab and a glacier wall', () => {
    expect(h(0, coastZ(0, SEED) - 20)).toBeGreaterThan(3)
    expect(h(0, coastZ(0, SEED) - 20)).toBeLessThan(8)
    expect(h(41, 56)).toBeLessThan(0)
    expect(Math.abs(h(COAST_SLAB.x, COAST_SLAB.z) - COAST_SLAB.y)).toBeLessThan(1)
    expect(h(COAST_LAKE.x, COAST_LAKE.z)).toBe(COAST_LAKE.y)
    expect(h(-100, 10)).toBeGreaterThan(18)
    expect(h(0, 150)).toBeLessThan(0)
    expect(h(40, -150)).toBeGreaterThan(60)
    let frozen = 0
    for (let x = -50; x <= 20; x += 5) if (h(x, 50) > 0) frozen++
    expect(frozen).toBeGreaterThan(8)
  })
  it('stays under the triangle budget with the station as civic centre', () => {
    const w = buildCoast(SEED)
    expect(worldTriangles(w) + HERO_ALLOWANCE).toBeLessThan(BUDGET)
    expect(w.cabins.length).toBeGreaterThan(110)
    expect(w.pines.length).toBeGreaterThan(200)
    expect(w.modules.length).toBe(5)
    expect(w.seals.length).toBeGreaterThan(8)
    expect(w.floes.length).toBeGreaterThan(20)
  })
})
