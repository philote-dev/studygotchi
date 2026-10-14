import { describe, expect, it } from 'vitest'
import { buildColliderSet, penetrationDepth } from '../../collision/colliders'
import { JUNGLE_LAYOUT as L, seededDistricts } from '../layout/jungle-layout'
import { PATHS, PATH_WIDTH, SHRINE_BOARDWALK, isJungleWater, isOnPlate, junglePlacements, ribbonSegments } from '../layout/placements'
import { countByTag, jungleLandColliders } from './footprints'

const SEED = 7
const districts = seededDistricts(SEED)
const full = Object.fromEntries(L.districts.map((d) => [d.id, 1]))
const empty = Object.fromEntries(L.districts.map((d) => [d.id, 0]))

describe('jungle collision footprints', () => {
  it('derives a collider for every hut, trunk, rock, totem and dock the full land places', () => {
    const colliders = jungleLandColliders(districts, full, SEED)
    const counts = countByTag(colliders)
    expect(colliders.length).toBe(junglePlacements(districts, full, SEED).length)
    // 1 stilt hall + 8 stilt homes + 8 ruin huts + 4 archives + 4 stalls + 4 sheds + the mill.
    expect(counts.hut).toBe(30)
    // Mother tree, 10 pods, 5 falls homes, the shelf tree, 20 district trees, 14 wild trees.
    expect(counts.trunk).toBe(51)
    expect(counts.rock).toBeGreaterThanOrEqual(20)
    // 20 lamps, 4 pillars, 2 roots, 15 ladders, the wheel and the shrine plinth.
    expect(counts.totem).toBeGreaterThanOrEqual(40)
    // 4 piers, 8 boardwalk segments, 2 canoes, the sluice bridge and 2 rope crossings.
    expect(counts.dock).toBe(17)
    expect(counts.fence).toBe(16)
    for (const collider of colliders) {
      expect(isOnPlate(collider.x, collider.z), collider.id).toBe(true)
      if (collider.kind === 'circle') expect(collider.r).toBeGreaterThan(0.1)
      else expect(Math.min(collider.hx, collider.hz)).toBeGreaterThan(0.1)
    }
  })

  it('grows with progress like the meshes: no huts, lamps or piers at 0 %, all of them at 100 %', () => {
    const zero = countByTag(jungleLandColliders(districts, empty, SEED))
    expect(zero.hut).toBe(2) // the stilt hall and the mill house are fixed anchors
    expect(zero.fence).toBe(0)
    expect(jungleLandColliders(districts, empty, SEED).filter((c) => c.tag === 'totem' && c.id?.includes(':lamp:')).length).toBe(0)
    expect(jungleLandColliders(districts, full, SEED).filter((c) => c.id?.includes(':lamp:')).length).toBe(20)
  })

  it('leaves the trails between the districts and the shrine boardwalk free for a walker', () => {
    const set = buildColliderSet(jungleLandColliders(districts, full, SEED))
    const probe = 0.9
    // Inside a district's build radius the trail is district ground (the ruin trail ends in the
    // gate's rubble by design); between districts the network must be clear and dry.
    const insideDistrict = (x: number, z: number) => districts.some((d) => Math.hypot(x - d.center[0], z - d.center[1]) < d.buildRadius + 10)
    const ribbons = [...PATHS.map((points) => ({ points, width: PATH_WIDTH })), { points: SHRINE_BOARDWALK, width: 3.1 }]
    let checked = 0
    for (const ribbon of ribbons) {
      const ends = [ribbon.points[0], ribbon.points[ribbon.points.length - 1]]
      for (const segment of ribbonSegments(ribbon.points, ribbon.width)) {
        const dx = Math.sin(segment.yaw)
        const dz = Math.cos(segment.yaw)
        for (let t = -segment.hz; t <= segment.hz; t += 1) {
          const x = segment.x + dx * t
          const z = segment.z + dz * t
          if (insideDistrict(x, z)) continue
          checked += 1
          expect(penetrationDepth(set, x, z, probe), `path point (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(0)
          // Trails end at a bridge head or a lagoon bank: the last 12 m may be wet.
          if (ends.every(([ex, ez]) => Math.hypot(x - ex, z - ez) > 12)) {
            expect(isJungleWater(x, z, districts), `wet path point (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(false)
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(60)
  })

  it('is deterministic per seed and moves with the seeded district centres', () => {
    const a = jungleLandColliders(districts, full, SEED)
    const b = jungleLandColliders(seededDistricts(SEED), full, SEED)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const other = jungleLandColliders(seededDistricts(99), full, 99)
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(a))
    expect(other.length).toBe(a.length)
  })

  it('knows the water: river, lagoon and sluice are wet, the clearings and paths are dry', () => {
    expect(isJungleWater(22, -100, districts)).toBe(true) // the river below the fall
    expect(isJungleWater(73, 27, districts)).toBe(true) // lagoon centre
    expect(isJungleWater(-2, 8, districts)).toBe(false) // Firefly clearing
    expect(isJungleWater(-91, -70, districts)).toBe(false) // Orchid glade
    expect(isJungleWater(27, 52, districts)).toBe(false) // Sunbreak
  })
})
