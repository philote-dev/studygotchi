import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { ICE_FREE_CAMERA_BOX } from '../../camera/stations'
import { ICE_TOWN_LAYOUT, mountainProfile } from '../../layout/biome-layout'
import { mountainPeaks, sampleTerrain } from '../../layout/terrain'
import { skyGradeFor } from '../../scene/sky-blend'
import { EDGE_POSES, edgePosePosition } from '../poses'
import {
  BASE_DEPTH,
  CAMERA_FAR,
  DOME_RADIUS,
  DOME_SEGMENTS,
  MIN_RING_RADIUS,
  NIGHT_HAZE,
  RINGS,
  WATER_RADIUS,
  ZENITH,
  apparentHeightDeg,
  buildRing,
  hazeAt,
  hazeLambda,
  hexToLinear,
  ringContrast,
  ringProfile,
  ringRadius,
  seaFogAt,
  triangleBudget,
} from './horizon'

const TAU = Math.PI * 2
const cameraBoxRadius = Math.hypot(ICE_FREE_CAMERA_BOX.max[0], ICE_FREE_CAMERA_BOX.max[2])

describe('painted horizon rings', () => {
  it('stacks four rings at strictly increasing radii outside the free camera box and inside the far plane', () => {
    expect(RINGS).toHaveLength(4)
    expect(MIN_RING_RADIUS).toBeGreaterThan(cameraBoxRadius)
    for (let i = 0; i < RINGS.length; i++) {
      expect(RINGS[i].radius, RINGS[i].id).toBeGreaterThan(MIN_RING_RADIUS)
      if (i > 0) expect(RINGS[i].radius).toBeGreaterThan(RINGS[i - 1].radius)
      // Visible from the far corner of the camera box without far-plane clipping.
      expect(RINGS[i].radius + cameraBoxRadius).toBeLessThan(CAMERA_FAR)
    }
    // The dome sits behind the last ring, under the water's rim, and never clips the far plane.
    expect(DOME_RADIUS).toBeGreaterThan(RINGS[RINGS.length - 1].radius)
    expect(DOME_RADIUS).toBeLessThan(WATER_RADIUS)
    expect(DOME_RADIUS + cameraBoxRadius).toBeLessThan(CAMERA_FAR)
  })

  it('wobbles each ring radius a little but never inside the camera box', () => {
    for (const [index, spec] of RINGS.entries()) {
      let min = Number.POSITIVE_INFINITY
      let max = 0
      for (let i = 0; i < spec.segments; i++) {
        const r = ringRadius(spec, index, (i / spec.segments) * TAU)
        min = Math.min(min, r)
        max = Math.max(max, r)
      }
      expect(min, spec.id).toBeGreaterThan(MIN_RING_RADIUS)
      expect(max - min, `${spec.id} wobble`).toBeGreaterThan(spec.radius * 0.01)
      expect(max - min, `${spec.id} wobble`).toBeLessThan(spec.radius * 0.05)
    }
  })

  it('loses contrast with distance (atmospheric perspective)', () => {
    for (let i = 0; i < RINGS.length; i++) {
      expect(ringContrast(i)).toBeGreaterThan(0)
      expect(ringContrast(i)).toBeLessThan(1)
      if (i > 0) expect(ringContrast(i)).toBeLessThan(ringContrast(i - 1))
    }
  })

  it('reaches each ring’s design haze at its own radius and clears near the camera', () => {
    for (const spec of RINGS) {
      const lambda = hazeLambda(spec.radius, spec.haze)
      expect(hazeAt(spec.radius, lambda)).toBeCloseTo(spec.haze, 6)
      expect(hazeAt(0, lambda)).toBe(0)
      expect(hazeAt(40, lambda)).toBeLessThan(0.1)
      expect(hazeAt(spec.radius * 3, lambda)).toBeGreaterThan(spec.haze)
    }
  })

  it('draws a deterministic silhouette from the seed, within the ring’s height and coverage', () => {
    for (const [index, spec] of RINGS.entries()) {
      const a = ringProfile(7, spec, index)
      const b = ringProfile(7, spec, index)
      const other = ringProfile(8, spec, index)
      expect(a).toHaveLength(spec.segments)
      expect(Array.from(a)).toEqual(Array.from(b))
      expect(Array.from(a)).not.toEqual(Array.from(other))
      let max = 0
      let land = 0
      for (const h of a) {
        expect(h).toBeGreaterThanOrEqual(0)
        max = Math.max(max, h)
        if (h > 0.5) land++
      }
      expect(max, `${spec.id} tallest`).toBeLessThanOrEqual(spec.maxHeight + 1e-6)
      expect(max, `${spec.id} tallest`).toBeGreaterThan(spec.maxHeight * 0.8)
      const coverage = land / spec.segments
      expect(coverage, `${spec.id} coverage`).toBeGreaterThan(spec.coverage - 0.15)
      expect(coverage, `${spec.id} coverage`).toBeLessThan(spec.coverage + 0.15)
    }
  })

  it('keeps every ring smaller on screen than the authored range from the overview pose', () => {
    const overview = EDGE_POSES.find((pose) => pose.id === 'overview')!
    const [cx, cy, cz] = edgePosePosition(overview)
    // The authored range as BiomeScene draws it at the lab's course fraction (band ≥ 2).
    const profile = mountainProfile(0.62)
    const peaks = mountainPeaks(ICE_TOWN_LAYOUT, profile)
    let rangeDeg = 0
    for (const peak of peaks) {
      const top = sampleTerrain(ICE_TOWN_LAYOUT, peak.x, peak.z, profile, peaks).height
      const horizontal = Math.hypot(peak.x - cx, peak.z - cz)
      rangeDeg = Math.max(rangeDeg, apparentHeightDeg(cy, horizontal, ICE_TOWN_LAYOUT.groundHeight, top))
    }
    expect(rangeDeg).toBeGreaterThan(3)
    const cameraOffset = Math.hypot(cx, cz)
    for (const [index, spec] of RINGS.entries()) {
      const heights = ringProfile(7, spec, index)
      const tallest = Math.max(...Array.from(heights))
      // Worst case: the ring's nearest point to the camera carrying its tallest peak.
      const nearest = spec.radius * 0.98 - cameraOffset
      const ringDeg = apparentHeightDeg(cy, nearest, 0, tallest)
      expect(ringDeg, `${spec.id} apparent height`).toBeLessThan(rangeDeg)
    }
  })

  it('merges each ring into one strip whose front faces point inward, within the triangle budget', () => {
    let triangles = 0
    for (const [index, spec] of RINGS.entries()) {
      const ring = buildRing(7, spec, index)
      const rows = ring.rows
      expect(ring.position.length).toBe(spec.segments * rows * 3)
      expect(ring.normal.length).toBe(ring.position.length)
      expect(ring.colorDay.length).toBe(ring.position.length)
      expect(ring.colorNight.length).toBe(ring.position.length)
      expect(ring.index.length).toBe(spec.segments * (rows - 1) * 6)
      triangles += ring.index.length / 3
      for (let i = 0; i < ring.position.length; i += 3) {
        const r = Math.hypot(ring.position[i], ring.position[i + 2])
        expect(r).toBeGreaterThan(MIN_RING_RADIUS)
        expect(ring.position[i + 1]).toBeGreaterThanOrEqual(-BASE_DEPTH)
        expect(ring.position[i + 1]).toBeLessThanOrEqual(spec.maxHeight)
      }
      for (const k of ring.index) expect(k).toBeLessThan(spec.segments * rows)
      // Every non-degenerate triangle's winding normal points toward the axis (the camera is inside).
      let checked = 0
      for (let t = 0; t < ring.index.length; t += 3) {
        const [a, b, c] = [ring.index[t], ring.index[t + 1], ring.index[t + 2]].map((k) => [ring.position[k * 3], ring.position[k * 3 + 1], ring.position[k * 3 + 2]])
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
        const len = Math.hypot(n[0], n[1], n[2])
        if (len < 1e-6) continue
        const radial = (n[0] * a[0] + n[2] * a[2]) / len
        expect(radial).toBeLessThan(0)
        checked++
      }
      expect(checked).toBeGreaterThan(spec.segments)
    }
    triangles += DOME_SEGMENTS[0] * DOME_SEGMENTS[1] * 2
    expect(triangleBudget()).toBe(triangles)
    expect(triangles).toBeLessThanOrEqual(40_000)
  })

  it('bakes vertex colours in linear space, like three.Color does for hex strings', () => {
    for (const hex of ['#dbe2ee', '#22284a', '#6b7f9a', '#000000', '#ffffff']) {
      const [r, g, b] = hexToLinear(hex)
      const c = new Color(hex)
      expect(r).toBeCloseTo(c.r, 5)
      expect(g).toBeCloseTo(c.g, 5)
      expect(b).toBeCloseTo(c.b, 5)
    }
  })

  it('subtends the right angle for a far silhouette', () => {
    // 100 m peak at 1000 m seen from 50 m up: top at atan(0.05), base at -atan(0.05).
    const deg = apparentHeightDeg(50, 1000, 0, 100)
    expect(deg).toBeCloseTo((2 * Math.atan(0.05) * 180) / Math.PI, 6)
    expect(apparentHeightDeg(50, 2000, 0, 100)).toBeLessThan(deg)
  })
})

describe('painted horizon sky', () => {
  const palette = { sky: '#dbe2ee', skyNight: '#22284a' }
  const storm = { sky: '#2f3f56', fogNear: 150, fogFar: 520, hemiSky: '#6a82a0', hemiGround: '#2a2436', hemiIntensity: 0.5, sunColor: '#aab', sunIntensity: 0.6 }

  it('finds the sea fully fogged before the first ring under every grade, so the feet meet the haze without a seam', () => {
    for (const grade of [skyGradeFor(false, null, palette), skyGradeFor(true, null, palette), skyGradeFor(false, storm, palette)]) {
      expect(grade.fogFar).toBeLessThanOrEqual(RINGS[0].radius)
      expect(seaFogAt(grade, RINGS[0].radius)).toBe(1)
      // ...and still clear where the free camera can drive right up to a ring (box corner → 50 m).
      expect(seaFogAt(grade, 50)).toBe(0)
    }
  })

  it('matches three’s linear fog: a smoothstep of depth between near and far', () => {
    const grade = skyGradeFor(false, null, palette)
    const mid = (grade.fogNear + grade.fogFar) / 2
    expect(seaFogAt(grade, mid)).toBeCloseTo(0.5, 6)
    expect(seaFogAt(grade, grade.fogNear)).toBe(0)
    expect(seaFogAt(grade, grade.fogNear + (grade.fogFar - grade.fogNear) * 0.25)).toBeCloseTo(0.15625, 6)
  })

  it('clears the night air a little but never fully, and keeps the zenith darker than the night haze', () => {
    expect(NIGHT_HAZE).toBeGreaterThan(0.5)
    expect(NIGHT_HAZE).toBeLessThan(1)
    const [r, g, b] = hexToLinear(ZENITH.night)
    const [hr, hg, hb] = hexToLinear(palette.skyNight)
    expect(r + g + b).toBeLessThan(hr + hg + hb)
    const [dr, dg, db] = hexToLinear(ZENITH.day)
    const [sr, sg, sb] = hexToLinear(palette.sky)
    expect(dr + dg + db).toBeLessThan(sr + sg + sb)
  })
})
