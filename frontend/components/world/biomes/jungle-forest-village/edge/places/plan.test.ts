import { describe, expect, it } from 'vitest'
import { JUNGLE_LAYOUT as L } from '../../layout/jungle-layout'
import { JUNGLE_CAMERA_BOX, JUNGLE_LOOK_BOX } from '../../camera/stations'
import { barrierPlan, channelDistance, riverDistance } from '../barriers/geography'
import { chebyshev } from '../noise'
import { OUTER_FOG, createOuterWorld } from '../outer/heightfield'
import { BANDS, bandStats, inGorge, isGraphConnected, placeLight, placesPlan } from './plan'

const SEED = 7
const barriers = barrierPlan(SEED)
const plan = placesPlan(SEED, barriers)
const world = createOuterWorld(SEED)

describe('the inhabited beyond: places', () => {
  it('lays out 10–16 places, all unreachable (outside the look box) and all inside the fog', () => {
    expect(plan.places.length).toBeGreaterThanOrEqual(10)
    expect(plan.places.length).toBeLessThanOrEqual(16)
    // From any camera in the camera box the farthest place is still this side of the day fog's far plane.
    const reach = Math.hypot(JUNGLE_CAMERA_BOX.max[0], JUNGLE_CAMERA_BOX.max[2])
    for (const p of plan.places) {
      expect(p.distance, p.id).toBeGreaterThanOrEqual(BANDS.near[0])
      expect(p.distance, p.id).toBeLessThanOrEqual(BANDS.far[1])
      const outsideLook = Math.abs(p.x) - p.radius > JUNGLE_LOOK_BOX.max[0] || Math.abs(p.z) - p.radius > Math.max(JUNGLE_LOOK_BOX.max[2], -JUNGLE_LOOK_BOX.min[2])
      expect(outsideLook, `${p.id} outside the look box`).toBe(true)
      expect(p.distance + reach, `${p.id} inside the fog`).toBeLessThan(OUTER_FOG.day.far)
      // Beyond the authored plate by a clear margin.
      expect(chebyshev(p.x, p.z) - p.radius, `${p.id} off the plate`).toBeGreaterThan(L.worldExtent + 40)
    }
  })

  it('thins toward the horizon and grows: density falls band by band, scale rises', () => {
    const stats = bandStats(plan.places)
    expect(stats.near.count).toBeGreaterThanOrEqual(3)
    expect(stats.mid.count).toBeGreaterThanOrEqual(3)
    expect(stats.far.count).toBeGreaterThanOrEqual(3)
    expect(stats.near.density).toBeGreaterThan(stats.mid.density)
    expect(stats.mid.density).toBeGreaterThan(stats.far.density)
    const scale = (band: 'near' | 'mid' | 'far') => plan.places.find((p) => p.band === band)!.scale
    expect(scale('near')).toBeLessThan(scale('mid'))
    expect(scale('mid')).toBeLessThan(scale('far'))
    // Every theme of the brief is present: 3–4 hamlets plus the nine set pieces.
    const kinds = plan.places.map((p) => p.kind)
    expect(kinds.filter((k) => k === 'hamlet').length).toBeGreaterThanOrEqual(3)
    expect(kinds.filter((k) => k === 'hamlet').length).toBeLessThanOrEqual(4)
    for (const kind of ['shaman', 'logging', 'weirs', 'ziggurat', 'quarry', 'terraces', 'walkway', 'poolshrine', 'parrot']) expect(kinds).toContain(kind)
  })

  it('overlaps nothing: other places, the wall, the vistas, the gorge, the volcano', () => {
    const list = plan.places
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(a.radius + b.radius + 10)
      }
    }
    for (const p of list) {
      for (const m of barriers.wall) {
        expect(Math.hypot(p.x - m.x, p.z - m.z), `${p.id} vs wall ${m.kind}`).toBeGreaterThan(p.radius + Math.max(m.rx, m.rz) + 4)
      }
      for (const v of barriers.vistas) {
        const keep = v.kind === 'volcano' ? barriers.volcano.radius : v.kind === 'temple' ? 34 : 16
        expect(Math.hypot(p.x - v.x, p.z - v.z), `${p.id} vs vista ${v.kind}`).toBeGreaterThan(p.radius + keep)
      }
      expect(inGorge(plan.gorge, p.x, p.z, p.radius + 6), `${p.id} vs the gorge`).toBe(false)
    }
    // River places sit on a bank (near the water, not in it); the others keep clear of the channels.
    for (const p of list) {
      const d = channelDistance(p.x, p.z)
      if (p.riverside) {
        expect(d, `${p.id} on a bank`).toBeLessThan(p.radius + 12)
        expect(d, `${p.id} not in the river`).toBeGreaterThan(p.kind === 'shaman' ? -1 : 9)
      } else expect(d, `${p.id} clear of the river`).toBeGreaterThan(p.radius)
    }
  })

  it('ties everything into one connected graph through the river, the paths, the bridge and the gates', () => {
    expect(isGraphConnected(plan)).toBe(true)
    const nodeIds = new Set(plan.nodes.map((n) => n.id))
    for (const e of plan.edges) {
      expect(nodeIds.has(e.a), e.a).toBe(true)
      expect(nodeIds.has(e.b), e.b).toBe(true)
    }
    for (const p of plan.places) expect(plan.edges.some((e) => e.a === p.id || e.b === p.id), `${p.id} has an edge`).toBe(true)
    expect(plan.edges.filter((e) => e.kind === 'river').length).toBeGreaterThanOrEqual(8)
    expect(plan.edges.filter((e) => e.kind === 'bridge').length).toBe(1)
    expect(plan.paths.length).toBe(plan.edges.filter((e) => e.kind === 'path').length)
  })

  it('keeps the dirt paths off the plate, out of the river, the gorge and the wall', () => {
    for (const path of plan.paths) {
      expect(path.points.length).toBeGreaterThan(2)
      for (const [x, z] of path.points) {
        expect(chebyshev(x, z), `${path.id} off the plate`).toBeGreaterThan(L.worldExtent + 30)
        expect(inGorge(plan.gorge, x, z, 4), `${path.id} crosses the gorge at ${x.toFixed(0)},${z.toFixed(0)}`).toBe(false)
        expect(riverDistance(x, z), `${path.id} in the river`).toBeGreaterThan(8)
        for (const m of barriers.wall) {
          expect(Math.hypot(x - m.x, z - m.z), `${path.id} through wall ${m.kind} at ${x.toFixed(0)},${z.toFixed(0)}`).toBeGreaterThan(Math.min(m.rx, m.rz) * 0.6)
        }
      }
      // The ground under a path is land (not the sea), and the ribbon's heights are finite.
      for (const [x, z] of path.points) {
        const s = world.sample(x, z)
        expect(s.material, `${path.id} on land`).not.toBe('sea')
        expect(Number.isFinite(s.height)).toBe(true)
      }
    }
    // The canoes drift on the water.
    for (const track of plan.canoeTracks) {
      expect(track.length).toBeGreaterThanOrEqual(3)
      for (const [x, z] of track) expect(channelDistance(x, z)).toBeLessThan(0.01)
    }
  })

  it('gives every place exactly one warm light, dimmer with distance', () => {
    const lights = plan.places.map((p) => ({ id: p.id, light: placeLight(p), distance: p.distance }))
    expect(lights).toHaveLength(plan.places.length)
    for (const { light } of lights) {
      expect(light.intensity).toBeGreaterThan(0.8)
      expect(light.intensity).toBeLessThanOrEqual(2.2)
      expect(light.radius).toBeGreaterThan(0.5)
    }
    const sorted = [...lights].sort((a, b) => a.distance - b.distance)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].light.intensity).toBeLessThanOrEqual(sorted[i - 1].light.intensity + 1e-9)
  })

  it('flattens the land under the places that need it and digs the two pools', () => {
    expect(plan.pads.length).toBeGreaterThanOrEqual(8)
    expect(plan.pools).toHaveLength(2)
    for (const pad of plan.pads) {
      const centre = world.height(pad.x, pad.z)
      for (const a of [0, 1.5, 3, 4.5]) {
        const x = pad.x + Math.cos(a) * pad.radius * 0.6
        const z = pad.z + Math.sin(a) * pad.radius * 0.6
        const s = world.sample(x, z)
        if (s.material === 'wet' || s.material === 'bank') continue // the river bed is never raised
        expect(Math.abs(s.height - centre), `pad at ${pad.x.toFixed(0)},${pad.z.toFixed(0)}`).toBeLessThan(0.6)
      }
    }
    for (const pool of plan.pools) {
      expect(world.sample(pool.x, pool.z).material).toBe('wet')
      // Dug: the bed sits under the mean of the ground round the rim (the shrine's pool is on a slope).
      let rim = 0
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        rim += world.height(pool.x + Math.cos(a) * (pool.radius + 8), pool.z + Math.sin(a) * (pool.radius + 8)) / 8
      }
      expect(world.height(pool.x, pool.z)).toBeLessThan(rim - 0.4)
    }
  })

  it('is deterministic per seed and only jitters with another', () => {
    expect(JSON.stringify(placesPlan(SEED, barriers))).toBe(JSON.stringify(plan))
    const other = placesPlan(99, barrierPlan(99))
    expect(other.places.length).toBe(plan.places.length)
    expect(other.places.map((p) => p.id)).toEqual(plan.places.map((p) => p.id))
    expect(other.places.some((p, i) => Math.abs(p.x - plan.places[i].x) > 1e-6)).toBe(true)
    for (let i = 0; i < other.places.length; i++) expect(Math.hypot(other.places[i].x - plan.places[i].x, other.places[i].z - plan.places[i].z)).toBeLessThan(4)
  })
})
