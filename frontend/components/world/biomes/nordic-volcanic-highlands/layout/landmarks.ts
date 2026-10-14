/**
 * The inhabited land: fifteen hand-built landmarks and points of interest on the walkable slabs,
 * spread over every district and the ground between them. Pure data: where each stands, which
 * progress band brings it, its ground footprint (world XZ, the shared collider shapes), its one
 * light and the path node it joins. The scene builds the geometry in `scene/landmarks/build.ts`.
 *
 * Bands follow the brief for new places: 0 = there from 0 %, 1 = from 33 %, 2 = from 67 %.
 * Natural features stand from 0 % and gain their man-made part later (`upgradeBand`).
 */
import type { Collider } from '../../collision/colliders'
import { toWorld, type Frame } from './placements'

export type LandmarkKind =
  | 'longhouse'
  | 'stave-church'
  | 'bathhouse'
  | 'power-hut'
  | 'fish-racks'
  | 'boat-yard'
  | 'stone-circle'
  | 'troll-rock'
  | 'glacier-lagoon'
  | 'mill'
  | 'sheep-fold'
  | 'beacon'
  | 'sauna'
  | 'rune-stone'
  | 'lava-cave'

export type Band = 0 | 1 | 2

export interface LocalShape {
  kind: 'box' | 'circle'
  x: number
  z: number
  /** Box half-extents (local), or circle radius in `r`. */
  hx?: number
  hz?: number
  r?: number
  yaw?: number
  tag: string
}

export interface LandmarkSpec {
  id: LandmarkKind
  name: string
  /** One line for the panel and the report. */
  feature: string
  x: number
  z: number
  /** Yaw in radians (three.js rotation.y); the builder's local +z faces this way. */
  yaw: number
  band: Band
  /** Band that adds the man-made part of a natural feature (deck, wheel). */
  upgradeBand?: Band
  /** Ground footprint in the landmark's local frame. */
  footprint: LocalShape[]
  /** Clearance radius for the overlap test (metres from the centre). */
  radius: number
}

const T = (yawDeg: number) => (yawDeg * Math.PI) / 180

export const LANDMARKS: readonly LandmarkSpec[] = [
  {
    id: 'beacon',
    name: 'Harbour beacon',
    feature: 'a fire-brazier tower at the fjord mouth, no lighthouse',
    x: -38,
    z: 122,
    yaw: T(20),
    band: 0,
    footprint: [{ kind: 'circle', x: 0, z: 0, r: 3.2, tag: 'beacon' }],
    radius: 7,
  },
  {
    id: 'stone-circle',
    name: 'Standing stones',
    feature: 'nine stones round a flat altar, one stone twice the others',
    x: -150,
    z: 14,
    yaw: T(12),
    band: 0,
    footprint: Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2
      return { kind: 'circle' as const, x: Math.cos(a) * 7.5, z: Math.sin(a) * 7.5, r: 1.1, tag: 'stone' }
    }).concat([{ kind: 'circle', x: 0, z: 0, r: 2.2, tag: 'stone' }]),
    radius: 11,
  },
  {
    id: 'troll-rock',
    name: 'Troll rock',
    feature: 'a troll turned to stone, nose first, the size of a house',
    x: -146,
    z: -98,
    yaw: T(140),
    band: 0,
    footprint: [
      { kind: 'circle', x: 0, z: 0, r: 5.2, tag: 'rock' },
      { kind: 'circle', x: 4.5, z: 3, r: 2.4, tag: 'rock' },
    ],
    radius: 10,
  },
  {
    id: 'rune-stone',
    name: 'Rune stone',
    feature: 'a carved stone on a mound, its serpent band painted red',
    x: -96,
    z: -36,
    yaw: T(-30),
    band: 0,
    footprint: [{ kind: 'circle', x: 0, z: 0, r: 4.6, tag: 'mound' }],
    radius: 7,
  },
  {
    id: 'lava-cave',
    name: 'Lava-tube cave',
    feature: 'a collapsed tube with an ember glow deep inside',
    x: -130,
    z: 100,
    yaw: T(60),
    band: 0,
    footprint: [
      { kind: 'circle', x: 0, z: -2, r: 6.5, tag: 'rock' },
      { kind: 'circle', x: -6, z: 3, r: 3, tag: 'rock' },
    ],
    radius: 11,
  },
  {
    id: 'glacier-lagoon',
    name: 'Glacier lagoon',
    feature: 'a cold tarn with calved bergs under the north cliffs; a viewing deck comes later',
    x: -110,
    z: -112,
    yaw: T(0),
    band: 0,
    upgradeBand: 2,
    footprint: [
      { kind: 'circle', x: 0, z: 0, r: 15, tag: 'pool' },
      { kind: 'box', x: -17.5, z: 0, hx: 2, hz: 4, tag: 'deck' },
    ],
    radius: 20,
  },
  {
    id: 'mill',
    name: 'Waterfall mill',
    feature: 'a fall off the north cliff turning a wheel taller than its house',
    x: -58,
    z: -112,
    yaw: T(0),
    band: 0,
    upgradeBand: 1,
    footprint: [
      { kind: 'circle', x: 0, z: -6, r: 5, tag: 'pool' },
      { kind: 'box', x: 4, z: 2, hx: 3.2, hz: 2.4, tag: 'house' },
      { kind: 'box', x: -1.5, z: 1, hx: 0.8, hz: 3.4, tag: 'wheel' },
    ],
    radius: 11,
  },
  {
    id: 'longhouse',
    name: "Chieftain's longhouse",
    feature: 'a carved gable with crossed beams, smoke from the mead-hall fire',
    x: -76,
    z: -22,
    yaw: T(70),
    band: 1,
    footprint: [
      { kind: 'box', x: 0, z: 0, hx: 11, hz: 4.6, tag: 'hall' },
      { kind: 'box', x: -8, z: -8, hx: 2.6, hz: 2, tag: 'shed' },
    ],
    radius: 15,
  },
  {
    id: 'fish-racks',
    name: 'Fish-drying racks',
    feature: 'rows of A-frame racks hung with cod, one rack long as a hall',
    x: -100,
    z: -2,
    yaw: T(-20),
    band: 1,
    footprint: [
      { kind: 'box', x: 0, z: -4, hx: 9, hz: 0.9, tag: 'rack' },
      { kind: 'box', x: 0, z: 0, hx: 9, hz: 0.9, tag: 'rack' },
      { kind: 'box', x: 0, z: 4, hx: 6, hz: 0.9, tag: 'rack' },
    ],
    radius: 11,
  },
  {
    id: 'sauna',
    name: 'Sauna',
    feature: 'a turf hut on the inlet shore with a plank jetty and a cold-plunge ladder',
    x: 9,
    z: 78,
    yaw: T(-90),
    band: 1,
    footprint: [
      { kind: 'box', x: 0, z: 0, hx: 3, hz: 2.4, tag: 'hut' },
      { kind: 'box', x: 0, z: -5, hx: 0.9, hz: 2.6, tag: 'jetty' },
    ],
    radius: 7,
  },
  {
    id: 'sheep-fold',
    name: 'Sheep-fold hamlet',
    feature: 'three turf-roof houses round a stone fold full of sheep',
    x: 138,
    z: 62,
    yaw: T(-35),
    band: 1,
    footprint: [
      { kind: 'box', x: -9, z: -4, hx: 3.6, hz: 2.4, yaw: 0.2, tag: 'house' },
      { kind: 'box', x: 7, z: -7, hx: 3.2, hz: 2.3, yaw: -0.3, tag: 'house' },
      { kind: 'box', x: 9, z: 7, hx: 2.8, hz: 2.2, yaw: 0.4, tag: 'house' },
      { kind: 'circle', x: -4, z: 7, r: 6.2, tag: 'fold' },
    ],
    radius: 16,
  },
  {
    id: 'stave-church',
    name: 'Stave church',
    feature: 'tiered tarred roofs with dragon heads at every gable, a bell cote',
    x: -128,
    z: -10,
    yaw: T(100),
    band: 2,
    footprint: [
      { kind: 'box', x: 0, z: 0, hx: 6, hz: 4.2, tag: 'church' },
      { kind: 'box', x: 0, z: 6, hx: 2, hz: 1.6, tag: 'porch' },
    ],
    radius: 11,
  },
  {
    id: 'bathhouse',
    name: 'Hot-spring bathhouse',
    feature: 'three steaming pools stepped down a wooden deck, a cream bath hall',
    x: 88,
    z: 4,
    yaw: T(-110),
    band: 2,
    footprint: [
      { kind: 'box', x: 0, z: -6, hx: 5, hz: 3, tag: 'hall' },
      { kind: 'circle', x: -4, z: 3, r: 3.6, tag: 'pool' },
      { kind: 'circle', x: 4, z: 4, r: 3, tag: 'pool' },
      { kind: 'circle', x: 0, z: 10, r: 2.6, tag: 'pool' },
    ],
    radius: 14,
  },
  {
    id: 'power-hut',
    name: 'Geothermal power hut',
    feature: 'a pipe manifold feeding a turbine shed, with one cooling stack taller than the shed',
    x: 108,
    z: -62,
    yaw: T(150),
    band: 2,
    footprint: [
      { kind: 'box', x: 0, z: 0, hx: 4, hz: 3, tag: 'shed' },
      { kind: 'circle', x: 5.5, z: -1, r: 1.6, tag: 'stack' },
      { kind: 'box', x: -2, z: -7, hx: 4.5, hz: 0.8, tag: 'pipe' },
    ],
    radius: 11,
  },
  {
    id: 'boat-yard',
    name: 'Boat-building yard',
    feature: 'a half-built longship on stocks, ribs bare, a dragon prow already carved',
    x: -70,
    z: 86,
    yaw: T(-80),
    band: 2,
    footprint: [
      { kind: 'box', x: 0, z: 0, hx: 9, hz: 2.4, tag: 'longship' },
      { kind: 'box', x: -6, z: 7, hx: 3.2, hz: 2.2, tag: 'shed' },
      { kind: 'box', x: 7, z: -6, hx: 1.6, hz: 1.2, tag: 'bench' },
    ],
    radius: 13,
  },
]

export function bandForFraction(fraction: number): Band {
  return fraction >= 0.67 ? 2 : fraction >= 0.33 ? 1 : 0
}

export function landmarksForBand(band: Band): LandmarkSpec[] {
  return LANDMARKS.filter((l) => l.band <= band)
}

export function landmarkFrame(spec: LandmarkSpec): Frame {
  return { x: spec.x, z: spec.z, yaw: spec.yaw }
}

/** The landmark's footprint in world coordinates as shared colliders. */
export function landmarkColliders(spec: LandmarkSpec, band: Band): Array<Collider & { tag: string; id: string }> {
  const frame = landmarkFrame(spec)
  const out: Array<Collider & { tag: string; id: string }> = []
  spec.footprint.forEach((shape, i) => {
    // The upgrade part (deck, wheel) only exists once its band is reached.
    if ((shape.tag === 'deck' || shape.tag === 'wheel') && spec.upgradeBand !== undefined && band < spec.upgradeBand) return
    const [x, z] = toWorld(frame, shape.x, shape.z)
    const id = `${spec.id}:${shape.tag}-${i}`
    if (shape.kind === 'circle') out.push({ kind: 'circle', x, z, r: shape.r ?? 1, tag: shape.tag, id })
    else out.push({ kind: 'box', x, z, hx: shape.hx ?? 1, hz: shape.hz ?? 1, yaw: frame.yaw + (shape.yaw ?? 0), tag: shape.tag, id })
  })
  return out
}
