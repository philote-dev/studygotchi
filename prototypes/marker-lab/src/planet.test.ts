import { describe, expect, it } from 'vitest'
import { MARKERS } from './markers'
import {
  PLANET_BELT_OUTER_RADIUS,
  PLANET_BOUQUET_HEIGHT_M,
  PLANET_CAMERA,
  PLANET_LAND_LIFT,
  PLANET_MARKER_SCALE,
  PLANET_ORBIT_PERIOD_S,
  PLANET_PAD_LIFT,
  PLANET_PAD_RADIUS,
  PLANET_RADIUS,
  PLANET_SEAT_RADIUS,
  autoRotateSpeedFor,
  planetCameraDistance,
  planetCameraPosition,
  planetElevation,
  planetPadGeometry,
  planetPadSag,
  planetPlacements,
  planetSurfaceAt,
  planetZoomLimits,
} from './planet'

type Vec3 = readonly [number, number, number]

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Evenly spread sample directions (Fibonacci sphere). */
function sampleDirections(count: number): Vec3[] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, index) => {
    const y = 1 - (2 * (index + 0.5)) / count
    const ring = Math.sqrt(1 - y * y)
    return [Math.cos(golden * index) * ring, y, Math.sin(golden * index) * ring] as const
  })
}

describe('planet marker belt', () => {
  it('seats every roster family on the sphere once', () => {
    const placements = planetPlacements()
    expect(placements.map((entry) => entry.id)).toEqual(MARKERS.map((marker) => marker.id))
    for (const placement of placements) {
      expect(Math.hypot(...placement.position)).toBeCloseTo(PLANET_SEAT_RADIUS, 5)
      expect(Math.hypot(...placement.direction)).toBeCloseTo(1, 9)
    }
  })

  it('seats the plinth bottom tangent to the sphere: on the pad, never floating or sunk', () => {
    const lift = PLANET_SEAT_RADIUS - PLANET_RADIUS
    expect(lift).toBeCloseTo(PLANET_PAD_LIFT, 9)
    expect(lift).toBeGreaterThan(0)
    // Pad is ≤ 0.5 m tall (globe-markers.md §2), so the seat is within that of the surface.
    expect(lift).toBeLessThanOrEqual(0.5 * PLANET_MARKER_SCALE)
    // And well under the plinth height, so nothing sinks past the plinth.
    expect(lift).toBeLessThan(2.4 * PLANET_MARKER_SCALE)
  })

  it('faces every marker front (+Z) toward the north pole, tangent to the surface', () => {
    for (const placement of planetPlacements()) {
      expect(Math.hypot(...placement.front)).toBeCloseTo(1, 9)
      expect(dot(placement.front, placement.direction)).toBeCloseTo(0, 9)
      expect(placement.front[1]).toBeGreaterThan(0)
    }
  })

  it('keeps bouquet bases from colliding on the belt', () => {
    const placements = planetPlacements()
    const footprint = 16 * PLANET_MARKER_SCALE * 2
    for (let left = 0; left < placements.length; left++) {
      for (let right = left + 1; right < placements.length; right++) {
        const gap = distance(placements[left].position, placements[right].position)
        expect(gap, `${placements[left].id} vs ${placements[right].id}`).toBeGreaterThan(footprint)
      }
    }
  })

  it('keeps neighbouring pads from overlapping', () => {
    const placements = planetPlacements()
    expect(PLANET_PAD_RADIUS).toBeCloseTo(18 * PLANET_MARKER_SCALE, 9)
    for (let left = 0; left < placements.length; left++) {
      for (let right = left + 1; right < placements.length; right++) {
        // Chord between seats is the shortest separation; pads are flat discs around each seat.
        const gap = distance(placements[left].position, placements[right].position)
        expect(gap, `${placements[left].id} vs ${placements[right].id}`).toBeGreaterThan(PLANET_PAD_RADIUS * 2)
      }
    }
  })

  it('keeps the bouquet readable against the planet diameter', () => {
    const visualHeight = PLANET_BOUQUET_HEIGHT_M * PLANET_MARKER_SCALE
    expect(PLANET_BOUQUET_HEIGHT_M).toBe(34)
    expect(visualHeight / (PLANET_RADIUS * 2)).toBeGreaterThan(0.1)
    expect(visualHeight / (PLANET_RADIUS * 2)).toBeLessThan(0.22)
  })
})

describe('planet pads', () => {
  it('buries the pad skirt below the sphere sag at the pad rim', () => {
    const sag = planetPadSag()
    expect(sag).toBeCloseTo(PLANET_RADIUS - Math.sqrt(PLANET_RADIUS ** 2 - PLANET_PAD_RADIUS ** 2), 9)
    const pad = planetPadGeometry()
    expect(pad.radius).toBe(PLANET_PAD_RADIUS)
    // Top of the pad is the seat (y = 0); bottom reaches below sea level minus the sag.
    expect(pad.centerY + pad.height / 2).toBeCloseTo(0, 9)
    expect(pad.centerY - pad.height / 2).toBeLessThan(-(PLANET_PAD_LIFT + sag))
  })

  it('flattens the terrain under every pad so no land pokes through the seat', () => {
    const placements = planetPlacements()
    const seats = placements.map((placement) => placement.direction)
    const rimAngle = Math.asin(PLANET_PAD_RADIUS / PLANET_RADIUS)
    for (const placement of placements) {
      const centre = planetSurfaceAt(placement.direction, seats)
      expect(centre.kind).toBe('shallows')
      expect(centre.radius).toBeLessThan(PLANET_SEAT_RADIUS)
      // Walk the pad rim toward the marker front and its opposite / sides.
      const [ux, uy, uz] = placement.direction
      const [fx, fy, fz] = placement.front
      const right: Vec3 = [uy * fz - uz * fy, uz * fx - ux * fz, ux * fy - uy * fx]
      for (const tangent of [placement.front, right, [-fx, -fy, -fz] as const, [-right[0], -right[1], -right[2]] as const]) {
        const rim: Vec3 = [
          ux * Math.cos(rimAngle) + tangent[0] * Math.sin(rimAngle),
          uy * Math.cos(rimAngle) + tangent[1] * Math.sin(rimAngle),
          uz * Math.cos(rimAngle) + tangent[2] * Math.sin(rimAngle),
        ]
        expect(planetSurfaceAt(rim, seats).radius, placement.id).toBeLessThan(PLANET_SEAT_RADIUS)
      }
    }
  })
})

describe('planet surface', () => {
  it('splits the globe into land and ocean with a plausible land share', () => {
    const samples = sampleDirections(4000)
    const land = samples.filter((direction) => planetSurfaceAt(direction, []).kind === 'land').length
    const share = land / samples.length
    expect(share).toBeGreaterThan(0.25)
    expect(share).toBeLessThan(0.5)
  })

  it('keeps relief between sea level and the land lift', () => {
    for (const direction of sampleDirections(500)) {
      const { radius } = planetSurfaceAt(direction)
      expect(radius).toBeGreaterThanOrEqual(PLANET_RADIUS)
      expect(radius).toBeLessThanOrEqual(PLANET_RADIUS + PLANET_LAND_LIFT)
    }
    expect(Number.isFinite(planetElevation([0, 1, 0]))).toBe(true)
  })
})

describe('planet camera', () => {
  it('computes the distance at which a sphere spans the requested share of the frame height', () => {
    const radius = 90
    const fov = 36
    const fit = 0.74
    const d = planetCameraDistance(radius, fov, fit)
    // Silhouette half-angle is asin(r / d); its projected half-height is tan of that.
    const projected = Math.tan(Math.asin(radius / d)) / Math.tan((fov * Math.PI) / 360)
    expect(projected).toBeCloseTo(fit, 9)
    // Monotone: tighter fit → further away; wider fov → closer.
    expect(planetCameraDistance(radius, fov, 0.5)).toBeGreaterThan(d)
    expect(planetCameraDistance(radius, 50, fit)).toBeLessThan(d)
    // And never inside the sphere.
    expect(planetCameraDistance(radius, fov, 10)).toBeGreaterThan(radius)
  })

  it('frames the whole planet at 70–78 % of the canvas height from ~22° above the equator', () => {
    expect(PLANET_CAMERA.fit).toBeGreaterThanOrEqual(0.7)
    expect(PLANET_CAMERA.fit).toBeLessThanOrEqual(0.78)
    expect(PLANET_CAMERA.pitchDeg).toBeGreaterThanOrEqual(18)
    expect(PLANET_CAMERA.pitchDeg).toBeLessThanOrEqual(26)
    const position = planetCameraPosition()
    const d = Math.hypot(...position)
    expect(d).toBeCloseTo(planetCameraDistance(PLANET_RADIUS, PLANET_CAMERA.fov, PLANET_CAMERA.fit), 9)
    expect((Math.asin(position[1] / d) * 180) / Math.PI).toBeCloseTo(PLANET_CAMERA.pitchDeg, 9)
    // Three-quarter: not sitting on an axis.
    expect(Math.abs(position[0])).toBeGreaterThan(PLANET_RADIUS * 0.5)
    expect(Math.abs(position[2])).toBeGreaterThan(PLANET_RADIUS * 0.5)
  })

  it('clamps zoom outside the bouquet belt and within 2× the default', () => {
    const zoom = planetZoomLimits()
    expect(zoom.min).toBeGreaterThan(PLANET_BELT_OUTER_RADIUS)
    expect(zoom.min).toBeLessThan(zoom.default)
    expect(zoom.max).toBeCloseTo(zoom.default * 2, 9)
    expect(PLANET_BELT_OUTER_RADIUS).toBeCloseTo(PLANET_SEAT_RADIUS + PLANET_BOUQUET_HEIGHT_M * PLANET_MARKER_SCALE, 9)
  })

  it('auto-orbits once per ~40 s', () => {
    expect(PLANET_ORBIT_PERIOD_S).toBe(40)
    // three-stdlib: 2π/60/60 · speed radians per frame at 60 fps.
    const perSecond = ((2 * Math.PI) / 60) * autoRotateSpeedFor(PLANET_ORBIT_PERIOD_S)
    expect((2 * Math.PI) / perSecond).toBeCloseTo(40, 9)
  })
})
