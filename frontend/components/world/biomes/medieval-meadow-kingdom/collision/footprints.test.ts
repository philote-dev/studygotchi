import { describe, expect, it } from 'vitest'
import { MEADOW_KINGDOM, generateKingdom, greenCrownProfile, landmarkStage } from '../layout/biome-layout'
import { ambientPlacements, animalPlacements, buildingSlots, sampleTerrain, treePlacements } from '../layout/terrain'
import { buildColliderSet, penetrationDepth, shapePenetration } from "../../collision/colliders"
import { buildingColliders, bridgeColliders, landmarkColliders, meadowLandColliders, treeColliders } from './footprints'

const layout = generateKingdom(7)
const full = Object.fromEntries(MEADOW_KINGDOM.districts.map((d) => [d.id, 1]))
const none = Object.fromEntries(MEADOW_KINGDOM.districts.map((d) => [d.id, 0]))
const SEED = 7
const colliders = meadowLandColliders(layout, SEED, full, landmarkStage(1), greenCrownProfile(1))
const set = buildColliderSet(colliders)

describe('meadow colliders: coverage', () => {
  it('covers every visible house, shed and stall, every tree, the anchors, growth props, bridge rails, animals and the castle', () => {
    const slots = layout.districts.reduce((sum, d) => sum + Math.min(d.population[4], buildingSlots(layout, d).length), 0)
    expect(buildingColliders(layout, full)).toHaveLength(slots)
    expect(slots).toBeGreaterThanOrEqual(20)
    expect(treeColliders(treePlacements(layout, SEED))).toHaveLength(treePlacements(layout, SEED).length)
    const tags = new Set(colliders.map((c) => c.tag))
    expect(tags).toEqual(new Set(['building', 'anchor', 'detail', 'bridge-rail', 'landmark', 'tree', 'scatter', 'crown', 'animal']))
    expect(colliders.filter((c) => c.tag === 'bridge-rail')).toHaveLength(layout.bridges.length * 2)
    expect(colliders.filter((c) => c.tag === 'animal')).toHaveLength(animalPlacements(layout, SEED).length)
    expect(colliders.filter((c) => c.tag === 'scatter')).toHaveLength(ambientPlacements(layout, SEED).filter((p) => p.kind === 'hay' || p.kind === 'rocks').length)
    expect(colliders.length).toBeGreaterThan(150)
    expect(new Set(colliders.map((c) => c.id)).size).toBe(colliders.length)
  })

  it('gates buildings and growth props by progress and the castle by stage', () => {
    expect(buildingColliders(layout, none)).toHaveLength(0)
    const empty = meadowLandColliders(layout, SEED, none, landmarkStage(0), greenCrownProfile(0))
    expect(empty.filter((c) => c.tag === 'detail')).toHaveLength(0)
    expect(empty.length).toBeLessThan(colliders.length)
    const [x, z] = layout.landmark.position
    expect(landmarkColliders(x, z, 'stake')).toHaveLength(2)
    expect(landmarkColliders(x, z, 's1').length).toBeGreaterThan(landmarkColliders(x, z, 'stake').length)
    expect(landmarkColliders(x, z, 's3').length).toBeGreaterThan(landmarkColliders(x, z, 's1').length)
    // Everything of the castle sits inside the plinth circle.
    for (const c of landmarkColliders(x, z, 's3')) expect(Math.hypot(c.x - x, c.z - z)).toBeLessThan(17.5)
  })

  it('puts every collider on the authored plate and the buildings on dry land', () => {
    for (const c of colliders) {
      expect(Math.abs(c.x)).toBeLessThan(300)
      expect(c.z).toBeGreaterThan(-300)
      expect(c.z).toBeLessThan(240)
      if (c.tag === 'building') expect(sampleTerrain(layout, c.x, c.z).material).not.toBe('water')
    }
  })

  it('leaves the roads clear of everything but the authored pieces that straddle a lane (0.4 m probe)', () => {
    // The layout itself parks these across lane centrelines (two river-village houses and the landing,
    // a market stall and a canopy, the farm's L-barn and windmill, one sheep, and the market bridge's
    // rail where the lane crosses it at a slant); the road ribbon runs under them. Nothing else may:
    // no woodland tree, rock, haystack, crown hill or castle piece stands on a lane.
    const AUTHORED_ACROSS_LANES = [
      'building:river-village:1',
      'building:river-village:5',
      'detail:river-village:landing',
      'building:bridge-market:3',
      'detail:bridge-market:market-stalls#3',
      'detail:farm-common:l-barn#0',
      'anchor:farm-common:windmill',
      'animal:sheep:2',
      'bridge:B2#0',
    ]
    const [lx, lz] = layout.landmark.position
    let probes = 0
    const hits = new Set<string>()
    for (const road of layout.roads) {
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1]
        const [bx, bz] = road.points[i]
        const length = Math.hypot(bx - ax, bz - az)
        for (let d = 0; d <= length; d += 2) {
          const x = ax + ((bx - ax) * d) / length
          const z = az + ((bz - az) * d) / length
          // The castle lane ends on the headland plinth by design.
          if (Math.hypot(x - lx, z - lz) < 18) continue
          probes++
          for (const c of colliders) if (shapePenetration(c, x, z, 0.4)) hits.add(c.id ?? c.tag ?? '?')
        }
      }
    }
    expect(probes).toBeGreaterThan(150)
    expect([...hits].sort()).toEqual([...AUTHORED_ACROSS_LANES].sort())
    for (const id of hits) expect(colliders.find((c) => c.id === id)?.tag).toMatch(/^(building|detail|anchor|animal|bridge-rail)$/)
    // Trees, rocks, hay, crown hills, the castle: none on a lane.
    const natural = buildColliderSet(colliders.filter((c) => ['tree', 'scatter', 'crown', 'landmark'].includes(c.tag ?? '')))
    for (const road of layout.roads) {
      for (const [x, z] of road.points) {
        if (Math.hypot(x - lx, z - lz) < 18) continue
        expect(penetrationDepth(natural, x, z, 0.4), `${road.id} node ${x},${z}`).toBe(0)
      }
    }
  })

  it('matches the bridge rails to the authored bridges', () => {
    const rails = bridgeColliders(layout)
    for (const bridge of layout.bridges) {
      const pair = rails.filter((r) => r.id === `bridge:${bridge.id}#0` || r.id === `bridge:${bridge.id}#1`)
      expect(pair).toHaveLength(2)
      for (const rail of pair) {
        expect(rail.kind).toBe('box')
        if (rail.kind === 'box') expect(rail.hx * 2).toBeCloseTo(bridge.size[0] * 0.92, 5)
        expect(Math.hypot(rail.x - bridge.center[0], rail.z - bridge.center[1])).toBeCloseTo(bridge.size[1] / 2, 5)
      }
    }
  })
})
