import { describe, expect, it } from 'vitest'
import { MEADOW_KINGDOM, generateKingdom, greenCrownProfile, landmarkStage } from '../layout/biome-layout'
import { sampleTerrain } from '../layout/terrain'
import { buildColliderSet, penetrationDepth } from '../../collision/colliders'
import { meadowLandColliders } from './footprints'
import { WALKER_RADIUS_M, createWalkers, isLand, ringPoint, settleWalkers, stepWalkers, walkerDistricts, type WalkerBody } from './walkers'

const layout = generateKingdom(7)
const full = Object.fromEntries(MEADOW_KINGDOM.districts.map((d) => [d.id, 1]))
const set = buildColliderSet(meadowLandColliders(layout, 7, full, landmarkStage(1), greenCrownProfile(1)))
const DT = 1 / 60

function run(seconds: number, still: (w: WalkerBody) => boolean = () => false) {
  const districts = walkerDistricts(layout, full, 8)
  const walkers = createWalkers(layout, set, districts)
  const worst = { penetration: 0, wet: 0 }
  const steps = Math.round(seconds / DT)
  for (let s = 0; s < steps; s++) {
    for (const w of walkers) w.still = still(w)
    stepWalkers(layout, walkers, set, DT)
    for (const w of walkers) {
      worst.penetration = Math.max(worst.penetration, penetrationDepth(set, w.x, w.z, w.r))
      if (!isLand(layout, w.x, w.z)) worst.wet++
    }
  }
  return { walkers, worst }
}

describe('meadow walkers', () => {
  it('cycles the residents through every district with progress', () => {
    expect(walkerDistricts(layout, full, 8)).toEqual([
      'forest-hamlet',
      'river-village',
      'bridge-market',
      'farm-common',
      'castle-court',
      'forest-hamlet',
      'river-village',
      'bridge-market',
    ])
    expect(walkerDistricts(layout, { ...full, 'castle-court': 0 }, 3)).toEqual(['forest-hamlet', 'river-village', 'bridge-market'])
  })

  it('puts every ring point on dry land, clear of the anchor', () => {
    for (const district of layout.districts) {
      for (let a = 0; a < Math.PI * 2; a += 0.1) {
        const p = ringPoint(layout, district.id, a)
        expect(isLand(layout, p.x, p.z), `${district.id} ring at ${a.toFixed(1)}`).toBe(true)
      }
    }
  })

  it('starts every walker clear of the colliders and on land', () => {
    const walkers = createWalkers(layout, set, walkerDistricts(layout, full, 8))
    expect(walkers).toHaveLength(8)
    for (const w of walkers) {
      expect(penetrationDepth(set, w.x, w.z, w.r)).toBeLessThanOrEqual(1e-9)
      expect(isLand(layout, w.x, w.z)).toBe(true)
      expect(w.r).toBe(WALKER_RADIUS_M)
    }
  })

  it('walks 60 s at 60 Hz with zero penetration, dry feet, no two bodies overlapping, and real distance covered', () => {
    const { walkers, worst } = run(60)
    expect(worst.penetration).toBeLessThanOrEqual(1e-6)
    expect(worst.wet).toBe(0)
    for (let i = 0; i < walkers.length; i++) {
      for (let j = i + 1; j < walkers.length; j++) {
        expect(Math.hypot(walkers[i].x - walkers[j].x, walkers[i].z - walkers[j].z)).toBeGreaterThanOrEqual(2 * WALKER_RADIUS_M - 1e-6)
      }
    }
    for (const w of walkers) {
      expect(w.travelled, `${w.district} #${w.index} barely moved`).toBeGreaterThan(8)
      expect(Number.isFinite(w.heading)).toBe(true)
      // Residents walk on the heightfield, never under it.
      expect(sampleTerrain(layout, w.x, w.z).height).toBeGreaterThan(layout.waterHeight)
    }
  })

  it('holds sleepers still and keeps them clear while the others walk', () => {
    const { walkers, worst } = run(20, (w) => w.index % 3 === 0)
    expect(worst.penetration).toBeLessThanOrEqual(1e-6)
    for (const w of walkers) {
      if (w.index % 3 === 0) expect(w.travelled).toBe(0)
      else expect(w.travelled).toBeGreaterThan(3)
    }
  })

  it('settles dismantled residents without walking', () => {
    const walkers = createWalkers(layout, set, walkerDistricts(layout, full, 8))
    const before = walkers.map((w) => [w.x, w.z])
    settleWalkers(layout, walkers, set)
    for (let i = 0; i < walkers.length; i++) {
      expect(Math.hypot(walkers[i].x - before[i][0], walkers[i].z - before[i][1])).toBeLessThan(0.01)
      expect(penetrationDepth(set, walkers[i].x, walkers[i].z, walkers[i].r)).toBeLessThanOrEqual(1e-9)
    }
  })

  it('is deterministic', () => {
    const a = run(10).walkers.map((w) => [w.x, w.z, w.heading])
    const b = run(10).walkers.map((w) => [w.x, w.z, w.heading])
    expect(a).toEqual(b)
  })
})
