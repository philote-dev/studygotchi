import { describe, expect, it } from 'vitest'
import { layoutA } from './layout-a'
import { layoutB } from './layout-b'
import { layoutC } from './layout-c'

const BUDGET = 80_000

const DIRECTIONS = [
  ['a', layoutA],
  ['b', layoutB],
  ['c', layoutC],
] as const

describe('coastal-ruins blockouts', () => {
  describe.each(DIRECTIONS)('direction %s', (_id, build) => {
    it.each([1, 7, 99])('stays under the triangle budget for seed %i', (seed) => {
      const layout = build(seed)
      expect(layout.triangles).toBeLessThanOrEqual(BUDGET)
      expect(layout.field.triangles).toBeGreaterThan(10_000)
    })

    it('is deterministic for a seed', () => {
      const first = build(7)
      const second = build(7)
      expect(first.triangles).toBe(second.triangles)
      expect(first.batches.map((batch) => batch.items.length)).toEqual(second.batches.map((batch) => batch.items.length))
      expect(first.batches[0].items[0]).toEqual(second.batches[0].items[0])
    })

    it('renders terrain relief, water bands, houses, lights and a beacon', () => {
      const layout = build(7)
      const keys = Object.keys(layout.field.parts)
      for (const key of ['cap', 'cliff', 'sand', 'shelf', 'deep', 'foam']) expect(keys, key).toContain(key)
      const houses = layout.batches.find((batch) => batch.geo === 'box' && batch.color === 'white' && !batch.glow)
      expect(houses?.items.length ?? 0).toBeGreaterThan(100)
      const windows = layout.batches.find((batch) => batch.glow)
      expect(windows?.items.length ?? 0).toBeGreaterThan(100)
      expect(layout.lamp).not.toBeNull()
      expect(layout.windmills.length > 0 || layout.skiff !== null).toBe(true)
    })
  })
})
