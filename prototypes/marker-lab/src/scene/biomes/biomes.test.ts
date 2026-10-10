import { describe, expect, it } from 'vitest'
import { MARKERS } from '../../markers'
import { BASE_RADIUS, BOUQUET_PLACEMENTS, SLOT_ORDER, TERRAIN_RADIUS, projectedCrownRadius } from '../bouquetGeometry'
import { BIOME_BOUQUETS } from './index'

const SOURCES = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const ROSTER_HEIGHTS = [32, 28, 28, 24] as const

/**
 * Harness for the bouquet swarm. Each family turns its own rows green by
 * replacing the stub in `scene/biomes/<id>.tsx` with a hand-built composition
 * and filling in the review strings. Nothing here passes by construction: the
 * expected values come from the roster (`markers.ts`) and the spec.
 */
describe('biome bouquet registry', () => {
  it('registers every roster family exactly once', () => {
    expect(Object.keys(BIOME_BOUQUETS).sort()).toEqual(MARKERS.map((marker) => marker.id).sort())
  })

  it('gives every family a unique composition name', () => {
    const names = MARKERS.map((marker) => BIOME_BOUQUETS[marker.id].spec.name)
    expect(names.every((name) => name.length >= 4), `names: ${JSON.stringify(names)}`).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })

  describe.each(MARKERS.map((marker) => [marker.id, marker] as const))('%s', (id, marker) => {
    const bouquet = BIOME_BOUQUETS[id]

    it('declares the roster props as its elements in P1 → P4 order', () => {
      expect(bouquet.spec.id).toBe(id)
      expect(bouquet.spec.elements.map((element) => element.id)).toEqual(marker.props.map((prop) => prop?.id))
      expect(bouquet.spec.elements.map((element) => element.height)).toEqual(ROSTER_HEIGHTS.slice(0, marker.props.length))
      expect(bouquet.spec.elements.map((element) => element.slot)).toEqual(SLOT_ORDER.slice(0, marker.props.length))
      expect(bouquet.spec.hero).toBe(marker.props[0].id)
    })

    it('writes its review notes for the board', () => {
      for (const key of ['silhouette', 'rim', 'exaggeration', 'closestProtected'] as const) {
        expect(bouquet.spec[key].length, key).toBeGreaterThanOrEqual(12)
      }
    })

    it('keeps every crown beyond the plinth while anchoring bases inside the terrain', () => {
      const placements = bouquet.spec.placements ?? BOUQUET_PLACEMENTS
      for (const slot of SLOT_ORDER.slice(0, marker.props.length)) {
        const placement = placements.find((entry) => entry.id === slot)
        expect(placement, `${slot} placement`).toBeDefined()
        if (!placement) continue
        expect(Math.hypot(placement.position[0], placement.position[2]), `${slot} base`).toBeLessThan(TERRAIN_RADIUS)
        expect(projectedCrownRadius(placement), `${slot} crown`).toBeGreaterThan(BASE_RADIUS)
        expect(placement.outwardLean, `${slot} lean`).toBeGreaterThanOrEqual(0.14)
        expect(placement.outwardLean, `${slot} lean`).toBeLessThanOrEqual(0.22)
      }
    })

    it('renders a hand-built composition rather than the category stand-ins', () => {
      const source = SOURCES[`./${id}.tsx`]
      expect(source, `source for ${id}`).toBeTypeOf('string')
      expect(source, 'biome file must not import GenericProps').not.toMatch(/GenericProps/)
      expect(source, 'biome file must not render WorldProps').not.toMatch(/WorldProps/)
      expect(bouquet.Rim, 'family rim treatment').toBeDefined()
    })
  })
})
