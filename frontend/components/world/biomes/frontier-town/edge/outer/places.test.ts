import { describe, expect, it } from 'vitest'
import { CUTTING, DESERT_FOG, GORGE, createOuterDesert } from './desert'
import { PLATE, insideRect, plateDistance } from './plate'
import {
  PLACE_BAND,
  PLACE_CLEARANCE,
  YARD_OFFSET,
  cartLanes,
  cattle,
  fenceRails,
  graves,
  laneGraphConnected,
  laneSegments,
  lightFalloff,
  milestones,
  placeLights,
  planLanes,
  planPlaces,
  smokeSources,
  trees,
} from './places'
import { outwardPose, poseCamera } from './vistas'
import { corridorDistance } from './scatter'

const desert = createOuterDesert(7)
const places = desert.places
const { lanes } = planLanes(places, desert.windows)

describe('mid-field places', () => {
  it('plans 10–16 themed places, every kind the brief asks for', () => {
    expect(places.length).toBeGreaterThanOrEqual(10)
    expect(places.length).toBeLessThanOrEqual(16)
    const kinds = new Map<string, number>()
    for (const p of places) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1)
    expect(kinds.get('ranch')).toBeGreaterThanOrEqual(3)
    expect(kinds.get('cemetery')).toBe(2)
    for (const kind of ['ghost-town', 'mine', 'rail-yard', 'pueblo', 'ferry', 'chapel', 'crossroads', 'cattle-drive']) expect(kinds.get(kind), kind).toBe(1)
    expect(new Set(places.map((p) => p.id)).size).toBe(places.length)
  })

  it('stands outside the look box and inside the fog, 220–650 m out', () => {
    for (const p of places) {
      expect(insideRect(PLATE, p.x, p.z), p.id).toBe(false)
      expect(plateDistance(p.x, p.z), p.id).toBeGreaterThanOrEqual(PLACE_CLEARANCE)
      expect(p.distance, p.id).toBeGreaterThanOrEqual(PLACE_BAND.min)
      expect(p.distance, p.id).toBeLessThanOrEqual(PLACE_BAND.max)
      expect(p.distance + p.r, p.id).toBeLessThan(DESERT_FOG.night.far)
    }
  })

  it('thins out and grows toward the horizon (counts and scale per band)', () => {
    const near = places.filter((p) => p.band === 'near')
    const far = places.filter((p) => p.band === 'far')
    expect(near.length).toBeGreaterThanOrEqual(7)
    expect(far.length).toBeGreaterThanOrEqual(3)
    expect(far.length).toBeLessThan(near.length)
    const mean = (list: typeof places) => list.reduce((s, p) => s + p.scale, 0) / list.length
    expect(mean(far)).toBeGreaterThan(mean(near) + 0.15)
  })

  it('does not overlap another place, a wall, a vista, the trestle or the authored land', () => {
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        const a = places[i]
        const b = places[j]
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(a.r + b.r + 10)
      }
    }
    for (const p of places) {
      for (const m of desert.landforms) {
        if (m.placeId === p.id) continue
        const reach = Math.max(m.rx, m.rz) * 1.1
        expect(Math.hypot(m.x - p.x, m.z - p.z), `${p.id} vs ${m.kind} at ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBeGreaterThanOrEqual(p.r + reach)
      }
      for (const v of desert.vistas) expect(Math.hypot(v.x - p.x, v.z - p.z), `${p.id} vs vista ${v.id}`).toBeGreaterThanOrEqual(p.r + 40)
      const t = desert.trestle
      const mid = [(t.near[0] + t.far[0]) / 2, (t.near[1] + t.far[1]) / 2]
      if (p.kind !== 'rail-yard') expect(Math.hypot(mid[0] - p.x, mid[1] - p.z), `${p.id} vs trestle`).toBeGreaterThanOrEqual(p.r + t.length / 2 + 20)
      // Never inside the gorge while it is open.
      const g = desert.gorge(p.z)
      if (g.fade > 0.3) expect(Math.abs(p.x - g.x), `${p.id} in the gorge`).toBeGreaterThanOrEqual(GORGE.wallHalf + p.r)
    }
  })

  it('keeps tall places out of the four vista corridors', () => {
    for (const p of places) {
      if (p.kind === 'ferry' || p.kind === 'cattle-drive') continue
      for (const v of desert.vistas) {
        const cam = poseCamera(outwardPose(v.id))
        expect(corridorDistance(cam, v, p.x, p.z), `${p.id} in the ${v.id} corridor`).toBeGreaterThanOrEqual(p.r)
      }
    }
  })

  it('sits on a flat pad at its own ground height', () => {
    for (const p of places) {
      if (p.kind === 'ferry') continue // its pad holds the pool
      const centre = desert.heightAt(p.x, p.z)
      const pad = (p.padR ?? p.r) * 0.5
      for (const [dx, dz] of [
        [pad, 0],
        [-pad, 0],
        [0, pad],
        [0, -pad],
      ]) expect(Math.abs(desert.heightAt(p.x + dx, p.z + dz) - centre), `${p.id} pad`).toBeLessThan(0.05)
    }
    const pueblo = places.find((p) => p.kind === 'pueblo')!
    expect(desert.heightAt(pueblo.x, pueblo.z)).toBeGreaterThan(14)
    const yard = places.find((p) => p.kind === 'rail-yard')!
    expect(desert.heightAt(yard.x, yard.z)).toBeGreaterThan(GORGE.farRise * 0.6)
    expect(YARD_OFFSET).toBeGreaterThan(CUTTING.length + 30)
  })

  it('puts the ferry on a pool in the wash', () => {
    const ferry = places.find((p) => p.kind === 'ferry')!
    expect(desert.sample(ferry.x, ferry.z).kind).toBe('pool')
    expect(desert.sample(ferry.x + 40, ferry.z).kind).not.toBe('pool')
  })
})

describe('lanes', () => {
  it('join every place into one connected graph', () => {
    expect(laneGraphConnected(places, lanes)).toBe(true)
    expect(lanes.length).toBeGreaterThanOrEqual(12)
    expect(lanes.filter((l) => l.stage).length).toBeGreaterThanOrEqual(2)
  })

  it('stay off the plate and out of the open gorge', () => {
    for (const lane of lanes) {
      for (const seg of laneSegments(lane, 8)) {
        expect(insideRect(PLATE, seg.x, seg.z, -1), `${lane.id} on the plate`).toBe(false)
        const g = desert.gorge(seg.z)
        if (g.fade > 0.3) expect(Math.abs(seg.x - g.x), `${lane.id} crosses the gorge at ${seg.x.toFixed(0)},${seg.z.toFixed(0)}`).toBeGreaterThan(GORGE.wallHalf + 4)
      }
    }
  })

  it('carry milestones on the stage road and two cart routes', () => {
    const stones = milestones(lanes)
    expect(stones.length).toBeGreaterThanOrEqual(6)
    for (const s of stones) expect(insideRect(PLATE, s.x, s.z)).toBe(false)
    expect(cartLanes(lanes).length).toBe(2)
  })
})

describe('lights and dressing', () => {
  it('shows exactly one light per place, dimmer with distance', () => {
    const lights = placeLights(places)
    expect(lights.length).toBe(places.length)
    expect(new Set(lights.map((l) => l.placeId)).size).toBe(places.length)
    const sorted = [...places].sort((a, b) => a.distance - b.distance)
    for (let i = 1; i < sorted.length; i++) expect(lightFalloff(sorted[i].distance)).toBeLessThanOrEqual(lightFalloff(sorted[i - 1].distance) + 1e-9)
    expect(lightFalloff(280)).toBe(1)
    expect(lightFalloff(650)).toBeLessThanOrEqual(0.5)
    expect(lightFalloff(650)).toBeGreaterThan(0.3)
  })

  it('dresses the places with instanced fences, cattle, trees, graves and smoke', () => {
    expect(fenceRails(places).length).toBeGreaterThan(80)
    expect(cattle(places, 7).length).toBeGreaterThan(30)
    expect(trees(places, 7).length).toBeGreaterThan(10)
    expect(graves(places, 7).length).toBeGreaterThan(16)
    const smoke = smokeSources(places)
    expect(smoke.length).toBeGreaterThanOrEqual(5)
    expect(smoke.filter((s) => s.dust).length).toBe(1)
  })

  it('is deterministic per seed and moves with another', () => {
    expect(planPlaces(7, desert.windows, desert.trestle)).toEqual(places)
    expect(createOuterDesert(7).places).toEqual(places)
    const other = planPlaces(8, desert.windows, desert.trestle)
    expect(other.some((p, i) => p.x !== places[i].x || p.z !== places[i].z)).toBe(true)
    expect(graves(places, 7)).toEqual(graves(places, 7))
  })
})
