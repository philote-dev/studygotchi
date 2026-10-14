import { describe, expect, it } from 'vitest'
import { buildCitadelPlan } from './citadel'
import { buildLakePlan } from './lake'
import { buildMarketPlan } from './market'
import { TRIANGLE_BUDGET, type Plan } from './plan'

const BUILDERS: Array<[string, (seed: number) => Plan]> = [
  ['A citadel', buildCitadelPlan],
  ['B lake', buildLakePlan],
  ['C market', buildMarketPlan],
]

describe('medieval meadow kingdom blockouts', () => {
  describe.each(BUILDERS)('%s', (_name, build) => {
    const plan = build(7)

    it('stays under the triangle budget', () => {
      console.info(`${_name}: ${plan.budget.total} triangles (terrain ${plan.budget.terrain}, layers ${plan.budget.layers}, draped ${plan.budget.draped})`)
      expect(plan.budget.total, JSON.stringify(plan.budget)).toBeLessThanOrEqual(TRIANGLE_BUDGET)
    })

    it('is deterministic for a seed and varies with it', () => {
      const again = build(7)
      const other = build(99)
      expect(again.budget).toEqual(plan.budget)
      expect(again.layers.map((layer) => layer.items.length)).toEqual(plan.layers.map((layer) => layer.items.length))
      expect(other.layers.some((layer, index) => layer.items.length !== plan.layers[index].items.length || JSON.stringify(layer.items[0]) !== JSON.stringify(plan.layers[index].items[0]))).toBe(true)
    })

    it('keeps every instance inside the land and above the water table', () => {
      for (const layer of plan.layers) {
        for (const item of layer.items) {
          expect(Math.abs(item.p[0]), `${layer.id} x`).toBeLessThan(175)
          expect(Math.abs(item.p[2]), `${layer.id} z`).toBeLessThan(175)
          expect(item.p[1], `${layer.id} y`).toBeGreaterThan(-12)
          expect(Number.isFinite(item.p[1]), `${layer.id} finite`).toBe(true)
        }
      }
    })

    it('has real relief, water, roads and districts', () => {
      const hf = plan.ground.hf
      let lo = Number.POSITIVE_INFINITY
      let hi = Number.NEGATIVE_INFINITY
      for (const h of hf.heights) {
        lo = Math.min(lo, h)
        hi = Math.max(hi, h)
      }
      expect(hi - lo).toBeGreaterThan(30)
      expect(plan.water !== null || plan.draped.some((entry) => entry.id === 'lake')).toBe(true)
      expect(plan.draped.some((entry) => entry.id === 'roads' && entry.positions.length > 0)).toBe(true)
      expect(plan.draped.filter((entry) => entry.id.startsWith('field-')).length).toBeGreaterThanOrEqual(4)
      // the five course districts: market, mill (river village), windmill (farm common), hamlet (forest), castle court
      for (const key of ['market', 'mill', 'windmill', 'hamlet']) expect(plan.marks[key], key).toBeDefined()
      expect(plan.marks.keep ?? plan.marks.crownCastle, 'castle court').toBeDefined()
      expect(plan.layers.find((layer) => layer.id === 'houses-walls')!.items.length).toBeGreaterThan(60)
      expect(plan.layers.find((layer) => layer.id === 'forest-trunks')!.items.length).toBeGreaterThan(150)
    })
  })
})
