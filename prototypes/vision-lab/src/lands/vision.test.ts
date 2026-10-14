import { describe, expect, it } from 'vitest'
import { DIRECTION_IDS, LANDS, LAND_IDS, POSE_IDS } from './index'

const SOURCES = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/**
 * Harness for the vision swarm: each land turns its rows green by replacing the three stub
 * directions in `lands/<id>.tsx` with real blockouts and writing the review strings.
 */
describe('vision lab', () => {
  it('registers every land once in the menu order', () => {
    expect(LANDS.map((land) => land.id)).toEqual(LAND_IDS)
  })

  describe.each(LANDS.map((land) => [land.id, land] as const))('%s', (id, land) => {
    it('has three directions a / b / c with distinct names', () => {
      expect(land.directions.map((entry) => entry.id)).toEqual(DIRECTION_IDS)
      const names = land.directions.map((entry) => entry.name)
      expect(names.every((name) => name.length >= 4), JSON.stringify(names)).toBe(true)
      expect(new Set(names).size).toBe(3)
    })

    it('writes the review notes for every direction', () => {
      for (const entry of land.directions) {
        expect(entry.lineage.length, `${entry.id} lineage`).toBeGreaterThanOrEqual(16)
        expect(entry.pitch.length, `${entry.id} pitch`).toBeGreaterThanOrEqual(120)
        expect(entry.strengths.length, `${entry.id} strengths`).toBeGreaterThanOrEqual(3)
        expect(entry.risks.length, `${entry.id} risks`).toBeGreaterThanOrEqual(2)
      }
    })

    it('defines every cinematic pose for every direction', () => {
      for (const entry of land.directions) {
        expect(entry.poses.map((pose) => pose.id).sort()).toEqual([...POSE_IDS].sort())
        for (const pose of entry.poses) {
          const distance = Math.hypot(pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2])
          expect(distance, `${entry.id} ${pose.id} distance`).toBeGreaterThan(10)
          expect(distance, `${entry.id} ${pose.id} distance`).toBeLessThan(900)
          expect(pose.position[1], `${entry.id} ${pose.id} above ground`).toBeGreaterThan(1)
        }
        const walk = entry.poses.find((pose) => pose.id === 'walk')!
        expect(walk.position[1], 'walk pose is at character height').toBeLessThan(14)
      }
    })

    it('is a built blockout, not the shared stub', () => {
      const source = SOURCES[`./${id}.tsx`]
      expect(source, `source for ${id}`).toBeTypeOf('string')
      expect(source, 'replace the VISION_STUB marker with real blockouts').not.toMatch(/VISION_STUB/)
      expect(source, 'land must not import the shared stub').not.toMatch(/from '\.\/stub'/)
    })
  })
})
