import { describe, expect, it } from 'vitest'
import { ICE_TOWN_LAYOUT } from '../layout/biome-layout'
import { SHELF_LAND_LIMIT, barrierPlan, shelfSeat } from './barriers/geography'
import { combined } from './combined'
import { endless } from './endless'
import { createOuterWorld } from './endless/outer-world'
import { skyGradeFor } from '../scene/sky-blend'

const layout = ICE_TOWN_LAYOUT
const SEED = 7

describe('combined: shelf and vistas', () => {
  const world = createOuterWorld(layout, SEED)
  const plan = barrierPlan(layout, SEED, { shelf: world })

  it('uses the endless sky for day, night and storm', () => {
    expect(combined.sky).toBe(endless.sky)
    for (const [night, storm] of [
      [false, false],
      [true, false],
      [false, true],
    ]) {
      const grade = skyGradeFor(night, storm ? { sky: '#2f3f56', fogNear: 150, fogFar: 520, hemiSky: '#6a82a0', hemiGround: '#2a2436', hemiIntensity: 0.3, sunColor: '#c4d4e8', sunIntensity: 0.8 } : null, {
        sky: '#dbe2ee',
        skyNight: '#22284a',
      })
      expect(combined.sky!(grade, { night, storm })).toEqual(endless.sky!(grade, { night, storm }))
    }
  })

  it('shares one outer world between the two scenes', () => {
    expect(createOuterWorld(layout, SEED)).toBe(world)
    expect(createOuterWorld(layout, SEED, {})).toBe(world)
    expect(createOuterWorld(layout, SEED + 1)).not.toBe(world)
  })

  it('stands every barrier wall in the shelf: seated on the highest ice under it, roots to the lowest, never on our land', () => {
    expect(plan.shelf).toBe(true)
    // The walls our northern mass already replaces are dropped; the open sides keep theirs.
    expect(plan.ring.length).toBeGreaterThanOrEqual(14)
    for (const m of plan.ring) {
      const seat = shelfSeat(world, m.x, m.z, Math.max(m.rx, m.rz))
      expect(m.seatY, `${m.kind} at ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBeGreaterThanOrEqual(layout.seaLevel)
      expect(m.seatY! + 1e-6).toBeGreaterThanOrEqual(seat.maxH)
      expect(m.seatY! - m.rootDepth!).toBeLessThanOrEqual(seat.minH)
      expect(seat.onLand && seat.maxH > layout.seaLevel + SHELF_LAND_LIMIT, `${m.kind} buried in the shelf's land`).toBe(false)
    }
  })

  it('seats the vistas on the shelf: three on flat pack, the observatory on the first outer row', () => {
    for (const v of plan.vistas) {
      const under = world.sample(v.x, v.z)
      if (v.id === 'north') {
        expect(v.onShelf).toBe(true)
        expect(['mountain', 'snow', 'rock']).toContain(under.material)
        expect(v.seatY).toBeGreaterThanOrEqual(12)
        expect(Math.abs(v.seatY! - under.height)).toBeLessThan(0.01)
      } else {
        expect(v.seatY).toBeLessThanOrEqual(layout.seaLevel + 4)
        expect(v.seatY).toBeGreaterThanOrEqual(layout.seaLevel - 1e-6)
        expect(under.height).toBeLessThanOrEqual(v.seatY! + 1e-6)
      }
    }
  })
})
