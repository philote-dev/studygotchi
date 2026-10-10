import { MARKERS, type MarkerId } from './markers'

/**
 * Planet mode: every roster bouquet seated on one toybox globe.
 *
 * Units are planet units; one bouquet metre is PLANET_MARKER_SCALE planet
 * units, so a 34 m bouquet (plinth + hero) reads 10–22 % of the planet
 * diameter (see planet.test.ts).
 */
export const PLANET_RADIUS = 90
export const PLANET_MARKER_SCALE = 0.7
export const PLANET_BELT_LAT = 0.28

/** Tallest bouquet incl. plinth, metres (BASE_HEIGHT 2.4 + 32 m hero). */
export const PLANET_BOUQUET_HEIGHT_M = 34

/** Pad: radius 18 m flattened cap under each marker (globe-markers.md §2), h ≤ 0.5 m. */
export const PLANET_PAD_RADIUS_M = 18
export const PLANET_PAD_HEIGHT_M = 0.4
export const PLANET_PAD_RADIUS = PLANET_PAD_RADIUS_M * PLANET_MARKER_SCALE
/** Pad top (= plinth bottom) sits this far above the sea-level sphere. */
export const PLANET_PAD_LIFT = PLANET_PAD_HEIGHT_M * PLANET_MARKER_SCALE
/** Radius at which the plinth bottom is tangent to the pad top. */
export const PLANET_SEAT_RADIUS = PLANET_RADIUS + PLANET_PAD_LIFT
/** Shallows ring + flattened terrain footprint around every pad. */
export const PLANET_PAD_FOOTPRINT = PLANET_PAD_RADIUS * 1.35
/** Outer shell of the bouquet belt: nothing (incl. the camera) should sit inside it. */
export const PLANET_BELT_OUTER_RADIUS = PLANET_SEAT_RADIUS + PLANET_BOUQUET_HEIGHT_M * PLANET_MARKER_SCALE

/** Low-poly relief: land stands this far above sea level (flattened under pads). */
export const PLANET_LAND_LIFT = 1.5
export const PLANET_LAND_THRESHOLD = 0.3
/** IcosahedronGeometry detail: 20·(detail+1)² facets. */
export const PLANET_DETAIL = 6

export const PLANET_CAMERA = {
  fov: 36,
  /** Planet diameter as a fraction of the canvas height in the default pose. */
  fit: 0.74,
  pitchDeg: 22,
  yawDeg: 34,
  /** Closest zoom: the belt shell would overfill the frame by this factor. */
  closeFit: 1.35,
} as const

export const PLANET_ORBIT_PERIOD_S = 40

export interface PlanetPlacement {
  id: MarkerId
  /** Unit radial = the marker's local +Y. */
  direction: readonly [number, number, number]
  /** Unit tangent toward the north pole = the marker's local +Z (its front). */
  front: readonly [number, number, number]
  /** Seat point: plinth bottom / pad top, at PLANET_SEAT_RADIUS. */
  position: readonly [number, number, number]
}

export function planetPlacements(): readonly PlanetPlacement[] {
  const count = MARKERS.length
  return MARKERS.map((marker, index) => {
    const latitude = index % 2 === 0 ? PLANET_BELT_LAT : -PLANET_BELT_LAT
    const azimuth = (index / count) * Math.PI * 2
    const cosLat = Math.cos(latitude)
    const sinLat = Math.sin(latitude)
    const direction = [Math.cos(azimuth) * cosLat, sinLat, Math.sin(azimuth) * cosLat] as const
    // d/dlat of the radial: tangent pointing toward +lat (north).
    const front = [-Math.cos(azimuth) * sinLat, cosLat, -Math.sin(azimuth) * sinLat] as const
    return {
      id: marker.id,
      direction,
      front,
      position: [
        direction[0] * PLANET_SEAT_RADIUS,
        direction[1] * PLANET_SEAT_RADIUS,
        direction[2] * PLANET_SEAT_RADIUS,
      ],
    }
  })
}

/** How far the sphere falls away below a flat pad of `padRadius` at its rim. */
export function planetPadSag(radius: number = PLANET_RADIUS, padRadius: number = PLANET_PAD_RADIUS): number {
  return radius - Math.sqrt(radius * radius - padRadius * padRadius)
}

/**
 * Pad disc in seat-local units (y up = radial, y = 0 at the seat): a short
 * cylinder whose top is the seat and whose bottom is buried below sea level,
 * so the flat plinth never floats over the curving sphere.
 */
export function planetPadGeometry(): { radius: number; height: number; centerY: number } {
  const height = PLANET_PAD_LIFT + planetPadSag() + 1
  return { radius: PLANET_PAD_RADIUS, height, centerY: -height / 2 }
}

/**
 * Camera distance from the planet centre at which a sphere of `radius`
 * spans `fit` × the viewport height (vertical `fovDeg`). Uses the true
 * silhouette (tangent cone), not radius / distance.
 */
export function planetCameraDistance(radius: number, fovDeg: number, fit: number): number {
  const halfFov = (fovDeg * Math.PI) / 360
  const k = 1 / (fit * Math.tan(halfFov))
  return radius * Math.sqrt(1 + k * k)
}

/** Default pose: three-quarter view from `pitchDeg` above the equator. */
export function planetCameraPosition(
  radius: number = PLANET_RADIUS,
  fovDeg: number = PLANET_CAMERA.fov,
  fit: number = PLANET_CAMERA.fit,
  pitchDeg: number = PLANET_CAMERA.pitchDeg,
  yawDeg: number = PLANET_CAMERA.yawDeg,
): readonly [number, number, number] {
  const distance = planetCameraDistance(radius, fovDeg, fit)
  const pitch = (pitchDeg * Math.PI) / 180
  const yaw = (yawDeg * Math.PI) / 180
  return [distance * Math.cos(pitch) * Math.sin(yaw), distance * Math.sin(pitch), distance * Math.cos(pitch) * Math.cos(yaw)]
}

/** OrbitControls zoom clamp: never inside the belt, never beyond 2× the default. */
export function planetZoomLimits(
  radius: number = PLANET_RADIUS,
  fovDeg: number = PLANET_CAMERA.fov,
  fit: number = PLANET_CAMERA.fit,
): { min: number; default: number; max: number } {
  const base = planetCameraDistance(radius, fovDeg, fit)
  const beltOuter = radius + PLANET_PAD_LIFT + PLANET_BOUQUET_HEIGHT_M * PLANET_MARKER_SCALE
  return { min: planetCameraDistance(beltOuter, fovDeg, PLANET_CAMERA.closeFit), default: base, max: base * 2 }
}

/** three-stdlib OrbitControls: autoRotateSpeed 2 ≈ one revolution per 30 s at 60 fps. */
export function autoRotateSpeedFor(periodSeconds: number): number {
  return 60 / periodSeconds
}

export type PlanetSurface = 'ocean' | 'shallows' | 'land'

export interface PlanetPalette {
  sky: string
  ocean: string
  shallows: string
  land: string
  /**
   * Albedo multiplier for the globe's standard material: the lab's lights are
   * tuned for the toon bouquets and would wash the big sphere toward white.
   */
  exposure: number
}

export function planetPalette(night: boolean): PlanetPalette {
  return night
    ? { sky: '#17152c', ocean: '#24344f', shallows: '#2d4260', land: '#2f4a33', exposure: 1.3 }
    : { sky: '#e8e2f2', ocean: '#9fd3e0', shallows: '#bfe4ea', land: '#8fc48a', exposure: 0.58 }
}

/** Deterministic ±`amount` brightness jitter per facet so the low-poly surface reads as facets even when flat-lit. */
export function facetJitter(direction: Vec3, amount = 0.06): number {
  const seed = Math.sin(direction[0] * 127.1 + direction[1] * 311.7 + direction[2] * 74.7) * 43758.5453
  return 1 + (seed - Math.floor(seed) - 0.5) * 2 * amount
}

type Vec3 = readonly [number, number, number]

function unit(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/** Continent seeds: unit centre + angular radius (rad). Deterministic, no RNG. */
const CONTINENTS: readonly { centre: Vec3; radius: number }[] = [
  { centre: unit(0.9, 0.35, 0.2), radius: 0.8 },
  { centre: unit(-0.5, 0.55, 0.7), radius: 0.65 },
  { centre: unit(-0.8, -0.3, -0.5), radius: 0.86 },
  { centre: unit(0.2, -0.75, 0.6), radius: 0.57 },
  { centre: unit(0.3, 0.1, -0.95), radius: 0.52 },
  { centre: unit(0.1, 0.95, -0.2), radius: 0.47 },
  { centre: unit(-0.2, -0.95, -0.1), radius: 0.52 },
  { centre: unit(0.75, -0.2, -0.6), radius: 0.39 },
]

/** Smooth 0..~1.3 landmass field over the unit sphere; > PLANET_LAND_THRESHOLD is land. */
export function planetElevation(direction: Vec3): number {
  const [x, y, z] = direction
  let value = 0
  for (const { centre, radius } of CONTINENTS) {
    const dot = Math.min(1, Math.max(-1, x * centre[0] + y * centre[1] + z * centre[2]))
    const t = Math.acos(dot) / radius
    if (t < 1) value += (1 - t * t) ** 2
  }
  value += 0.16 * Math.sin(x * 5.1 + y * 2.3) * Math.cos(z * 4.7 - x * 1.9)
  value += 0.12 * Math.sin((y - z) * 6.3 + 1.1) * Math.sin((x + z) * 3.7 - 0.4)
  return value
}

export function planetSurfaceAt(
  direction: Vec3,
  seats: readonly Vec3[] = planetPlacements().map((placement) => placement.direction),
): { kind: PlanetSurface; radius: number } {
  const footprintCos = Math.cos(Math.asin(PLANET_PAD_FOOTPRINT / PLANET_RADIUS))
  for (const seat of seats) {
    if (direction[0] * seat[0] + direction[1] * seat[1] + direction[2] * seat[2] >= footprintCos) {
      return { kind: 'shallows', radius: PLANET_RADIUS }
    }
  }
  return planetElevation(direction) > PLANET_LAND_THRESHOLD
    ? { kind: 'land', radius: PLANET_RADIUS + PLANET_LAND_LIFT }
    : { kind: 'ocean', radius: PLANET_RADIUS }
}
