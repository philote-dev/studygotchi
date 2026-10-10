import { describe, expect, it } from 'vitest'
import { MIN_LIP_SIDE_DELTA_E, deltaE2000, hexToLab } from './color'
import { MARKERS } from './markers'

describe('marker roster', () => {
  it('contains the 17 specified marker families exactly once', () => {
    expect(MARKERS).toHaveLength(17)
    expect(new Set(MARKERS.map((marker) => marker.id)).size).toBe(17)
  })

  it('gives every family two to four signature props', () => {
    for (const marker of MARKERS) {
      expect(marker.props.length, marker.id).toBeGreaterThanOrEqual(2)
      expect(marker.props.length, marker.id).toBeLessThanOrEqual(4)
    }
  })

  it('gives every bouquet exaggerated landscape proportions', () => {
    for (const marker of MARKERS) {
      expect(marker.props.map((prop) => prop?.height), marker.id).toEqual([32, 28, 28, 24])
    }
  })
})

describe('marker colour acceptance', () => {
  it('matches published CIEDE2000 reference pairs', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4)
    expect(deltaE2000([50, 3.1571, -77.2803], [50, 0, -82.7485])).toBeCloseTo(2.8615, 4)
    expect(deltaE2000([50, 2.8361, -74.02], [50, 0, -82.7485])).toBeCloseTo(3.4412, 4)
  })

  it('requires six-digit hex colours', () => {
    expect(() => hexToLab('#fff')).toThrow(TypeError)
    expect(() => hexToLab('not-a-colour')).toThrow(TypeError)
  })

  it('gives every family a lip that reads against its own side at 48 px', () => {
    // 2026-10-10 acceptance review: jungle (lip = side), egyptian-desert and alpine were re-tinted,
    // future-utopia's side deepened to #5fa894 so the cyan strip clears the threshold.
    const failures = MARKERS.flatMap((marker) => {
      const contrast = deltaE2000(hexToLab(marker.pedestal.lip), hexToLab(marker.pedestal.side))
      return contrast < MIN_LIP_SIDE_DELTA_E ? [{ id: marker.id, contrast: Number(contrast.toFixed(2)) }] : []
    })
    expect(failures).toEqual([])
  })

  it('keeps the three 48 px colour-collision families off their neighbours', () => {
    const by = Object.fromEntries(MARKERS.map((marker) => [marker.id, marker.pedestal]))
    const sideTop = (a: string, b: string) => [
      deltaE2000(hexToLab(by[a].side), hexToLab(by[b].side)),
      deltaE2000(hexToLab(by[a].top), hexToLab(by[b].top)),
    ]
    // Before the re-tint these pairs sat at 8.0/5.4, 12.5/8.6 and 17.5/6.5.
    expect(Math.max(...sideTop('fractal-recursion', 'harbor-town'))).toBeGreaterThan(14)
    expect(Math.max(...sideTop('future-utopia', 'ink-world'))).toBeGreaterThan(20)
    expect(Math.max(...sideTop('future-utopia', 'ice-town'))).toBeGreaterThan(20)
  })

  it('does not pair a near-matching top colour with the same tallest-prop category', () => {
    for (let left = 0; left < MARKERS.length; left++) {
      for (let right = left + 1; right < MARKERS.length; right++) {
        const a = MARKERS[left]
        const b = MARKERS[right]
        const topDistance = deltaE2000(hexToLab(a.pedestal.top), hexToLab(b.pedestal.top))
        const sameCategory = a.props[0].category === b.props[0].category
        expect(topDistance < 12 && sameCategory, `${a.id} vs ${b.id}`).toBe(false)
      }
    }
  })
})
