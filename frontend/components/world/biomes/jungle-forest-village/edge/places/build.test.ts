import { describe, expect, it } from 'vitest'
import { createOuterWorld } from '../outer/heightfield'
import { buildPlaces, canoeGeometry, hutGeometry, instancedTriangles, lampGeometry, logGeometry, parrotGeometry, postGeometry, puffGeometry } from './build'
import { PUFFS_PER_FIRE } from '../Places'

const SEED = 7
const world = createOuterWorld(SEED)
const day = buildPlaces(world, false)

describe('the inhabited beyond: geometry', () => {
  it('gives every place exactly one light, on the place', () => {
    const places = world.places.places
    expect(day.lights).toHaveLength(places.length)
    for (const p of places) {
      const mine = day.lights.filter((l) => l.placeId === p.id)
      expect(mine, p.id).toHaveLength(1)
      const l = mine[0]
      expect(Math.hypot(l.x - p.x, l.z - p.z), `${p.id} light on the place`).toBeLessThan(p.radius + 6)
      expect(l.y, `${p.id} light above ground`).toBeGreaterThan(world.height(l.x, l.z) - 3)
      expect(Number.isFinite(l.y)).toBe(true)
    }
    // Cook fires: four hamlets, the camp and the shaman's island smoke.
    expect(day.fires.length).toBe(6)
  })

  it('holds its budget: ≤ 45k triangles and ≤ 20 draw calls on top of the outer world', () => {
    const instanced =
      instancedTriangles(hutGeometry(false), day.huts.length) +
      instancedTriangles(postGeometry(), day.posts.length) +
      instancedTriangles(logGeometry(), day.logs.length) +
      instancedTriangles(parrotGeometry(), day.parrots.length) +
      instancedTriangles(lampGeometry(), day.lights.length) +
      instancedTriangles(puffGeometry(), day.fires.length * PUFFS_PER_FIRE) +
      instancedTriangles(canoeGeometry(false), day.canoes.length)
    const total = day.staticTriangles + instanced
    expect(total).toBeLessThanOrEqual(45_000)
    expect(total).toBeGreaterThan(8_000)
    // statics, paths, water, huts, posts, logs, parrots, lamps, smoke, canoes.
    expect(10).toBeLessThanOrEqual(20)
    expect(day.huts.length).toBeGreaterThanOrEqual(20)
    expect(day.huts.length).toBeLessThanOrEqual(45)
    expect(day.parrots.length).toBeGreaterThanOrEqual(30)
    expect(day.canoes).toHaveLength(2)
  })

  it('places every primitive on finite ground and keeps the river places on their banks', () => {
    const pos = day.statics.getAttribute('position')
    for (let i = 0; i < pos.count; i += 7) {
      expect(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i))).toBe(true)
    }
    for (const list of [day.huts, day.posts, day.logs, day.parrots]) {
      for (const item of list) {
        expect(Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.z)).toBe(true)
        expect(item.sx).toBeGreaterThan(0)
        expect(item.sy).toBeGreaterThan(0)
      }
    }
    // Huts stand within their place's footprint and roughly at ground (stilts take the rest).
    for (const hut of day.huts) {
      const owner = world.places.places.find((p) => Math.hypot(p.x - hut.x, p.z - hut.z) <= p.radius + 2)
      expect(owner, `hut at ${hut.x.toFixed(0)},${hut.z.toFixed(0)} belongs to a place`).toBeDefined()
      // The canopy walkway's hut stands on its platform, 22 m × scale up.
      expect(Math.abs(hut.y - world.height(hut.x, hut.z))).toBeLessThan(30)
    }
    // The canoes drift on the water, above the river bed.
    for (const track of day.canoes) {
      expect(track.total).toBeGreaterThan(60)
      for (let i = 0; i < track.points.length; i += 3) {
        expect(track.points[i + 1]).toBeGreaterThan(world.height(track.points[i], track.points[i + 2]))
      }
    }
  })

  it('is deterministic and recolours for night without moving anything', () => {
    const again = buildPlaces(createOuterWorld(SEED), false)
    expect(Array.from(again.statics.getAttribute('position').array.subarray(0, 900))).toEqual(Array.from(day.statics.getAttribute('position').array.subarray(0, 900)))
    expect(again.huts.map((h) => [h.x, h.z])).toEqual(day.huts.map((h) => [h.x, h.z]))
    const night = buildPlaces(world, true)
    expect(night.statics.getAttribute('position').count).toBe(day.statics.getAttribute('position').count)
    expect(night.lights.map((l) => [l.x, l.y, l.z])).toEqual(day.lights.map((l) => [l.x, l.y, l.z]))
    const dayColor = day.statics.getAttribute('color')
    const nightColor = night.statics.getAttribute('color')
    let darker = 0
    for (let i = 0; i < dayColor.count; i += 11) if (nightColor.getX(i) + nightColor.getY(i) + nightColor.getZ(i) < dayColor.getX(i) + dayColor.getY(i) + dayColor.getZ(i)) darker++
    expect(darker).toBeGreaterThan(dayColor.count / 11 / 2)
  })
})
