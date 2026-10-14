/**
 * Placement data for everything the frontier scene stands on the ground, in each district's
 * local frame (metres; the district group adds its jittered centre and yaw). The scene maps
 * over these tables; the collider footprints (../collision/footprints.ts) are derived from the
 * same rows, so a mesh and its collider cannot drift apart. Numbers are the ones FrontierScene
 * has always used.
 */
import { seeded } from './biome-layout'

export type FrontKind = 'store' | 'saloon' | 'sheriff' | 'hotel'

export interface Slot {
  x: number
  z: number
  yaw: number
  color: 'oxblood' | 'teal' | 'sage' | 'timber'
  variant: FrontKind
}

export interface Pt {
  x: number
  z: number
}

export interface WagonAt extends Pt {
  yaw: number
}

export interface FenceAt extends Pt {
  length: number
  yaw: number
}

export interface AnimalAt extends Pt {
  color: string
  horned?: boolean
}

export interface BoxAt extends Pt {
  w: number
  d: number
  h: number
  /** Centre height (defaults to h / 2). */
  y?: number
  color: 'timber' | 'sage' | 'mustard' | 'teal' | 'copper' | 'canvas' | 'redRock' | 'strata' | 'ink'
}

/* ---------- main town ---------- */

export const TOWN = {
  waterTower: { x: -39, z: 0 },
  /** Boardwalk spine (walkable): x from −40 to 42, 10 m wide, and the two boardwalk decks. */
  road: { x: 1, z: 0, w: 82, d: 10 },
  slots: [
    { x: -24, yaw: 0, z: -13, color: 'oxblood', variant: 'saloon' },
    { x: -13, yaw: 0, z: -13, color: 'teal', variant: 'store' },
    { x: -2, yaw: 0, z: -13, color: 'sage', variant: 'hotel' },
    { x: 10, yaw: 0, z: -13, color: 'timber', variant: 'store' },
    { x: 22, yaw: 0, z: -13, color: 'teal', variant: 'store' },
    { x: 34, yaw: 0, z: -13, color: 'sage', variant: 'store' },
    { x: -24, yaw: Math.PI, z: 13, color: 'sage', variant: 'sheriff' },
    { x: -13, yaw: Math.PI, z: 13, color: 'timber', variant: 'store' },
    { x: -2, yaw: Math.PI, z: 13, color: 'teal', variant: 'store' },
    { x: 10, yaw: Math.PI, z: 13, color: 'sage', variant: 'store' },
    { x: 22, yaw: Math.PI, z: 13, color: 'timber', variant: 'store' },
    { x: 34, yaw: Math.PI, z: 13, color: 'teal', variant: 'store' },
  ] as Slot[],
  /** Street clutter by the population count that reveals it. */
  wagons: [
    { minCount: 6, x: 5, z: 2, yaw: 0.2 },
    { minCount: 10, x: 27, z: -2, yaw: -0.18 },
  ],
  troughs: [
    { minCount: 6, x: -18, z: 4 },
    { minCount: 10, x: 20, z: 4 },
  ],
  civicHall: { x: -37, z: -21, scale: 0.88 },
  sheds: [-28, -17, -6, 7, 20, 32].map((x, i) => ({ x, z: i % 2 ? 23 : -23, sage: i % 3 === 0 })),
  hitches: [-30, -14, 2, 18, 34].map((x) => ({ x, z: 5.8 })),
  lamps: [-34, -10, 14, 38].map((x) => ({ x, z: -6 })),
  horses: [
    { x: -27, z: 4, color: '#6a4632' },
    { x: 30, z: 4, color: '#b78a64' },
  ] as AnimalAt[],
  tumbleweeds: [
    { x: 39, z: 1, y: 1.2, scale: 1.1 },
    { x: -7, z: -2, y: 0.9, scale: 0.8 },
  ],
  posts: [-31, -8, 15, 34].map((x) => ({ x, z: 7 })),
} as const

/** FalseFront body size at scale 1 for a variant (Props in FrontierScene: `w` × 5.4 deep). */
export function frontWidth(variant: FrontKind): number {
  return variant === 'hotel' ? 9 : variant === 'sheriff' ? 6.4 : 7.6
}

/* ---------- railway station ---------- */

export const RAILWAY = {
  platform: { x: 31, z: 0, w: 9, d: 42 },
  depot: { x: 17, z: -3, w: 24, d: 14 },
  freightShed: { x: -3, z: 10, w: 18, d: 12 },
  depotCrates: [-8, -3, 2].map((x) => ({ x, z: -14, w: 4.2, d: 3.2 })),
  canopyPosts: [-17, -11, -5, 1, 7, 13, 19].map((z) => ({ x: 30, z })),
  waterCrane: { x: 31, z: -14 },
  signalMast: { x: 30, z: 15 },
  /** Eight crates, two rows of four, from the first band. */
  crateStack: { minCount: 1, x: 20.3, z: 12, w: 8.6, d: 5 },
  wagon: { minCount: 2, x: 2, z: -12, yaw: Math.PI / 2 },
  shed: { minCount: 3, x: -14, z: -10, w: 12, d: 9 },
  caboose: { minCount: 5, x: 28, z: 25, w: 5.2, d: 9 },
} as const

/* ---------- broad ranch ---------- */

export const RANCH = {
  windPump: { x: 30, z: -18 },
  corrals: [
    { minCount: 0, x: -23, z: 9, radius: 9 },
    { minCount: 2, x: 0, z: 13, radius: 8 },
    { minCount: 3, x: 23, z: 8, radius: 7 },
  ],
  house: { minCount: 1, x: -25, z: -19, scale: 1.15 },
  barn: { minCount: 2, x: 3, z: -21, w: 16, d: 12 },
  fences: [
    { minCount: 2, x: -3, z: -2, length: 68, yaw: 0 },
    { minCount: 2, x: -3, z: 28, length: 68, yaw: 0 },
    { minCount: 3, x: -36, z: 13, length: 30, yaw: Math.PI / 2 },
    { minCount: 3, x: 30, z: 13, length: 30, yaw: Math.PI / 2 },
    { minCount: 4, x: -21, z: 20, length: 20, yaw: 0.25 },
    { minCount: 4, x: 15, z: 24, length: 24, yaw: -0.18 },
  ],
  cattle: [-29, -23, -16, -8, 0].map((x, i) => ({ minCount: 2, x, z: 3 + (i % 2) * 10, color: i % 2 ? '#d8c3a5' : '#8a6045', horned: true })),
  horses: [8, 15, 22, 28].map((x, i) => ({ minCount: 3, x, z: 3 + (i % 3) * 6, color: i % 2 ? '#9a765c' : '#6d4c39', horned: false })),
  wagon: { minCount: 4, x: 29, z: -4, yaw: -0.7 },
  trough: { minCount: 4, x: -8, z: 1 },
  hay: [-18, -14, 14, 18].map((x) => ({ minCount: 4, x, z: -8 })),
  shed: { minCount: 4, x: -31, z: -9, w: 7, d: 5 },
} as const

/* ---------- mine works ---------- */

export const MINE = {
  rock: { x: -31, z: -10, w: 18, d: 20, h: 14 },
  adit: { x: -21.8, z: -2 },
  headframe: { x: -8, z: -5, baseW: 9.5, baseD: 7.5 },
  spur: { x: -8, z: 13, w: 2.8, d: 32 },
  boiler: { minCount: 2, x: 13, z: -8, radius: 3.3 },
  shed: { minCount: 2, x: 27, z: -6, w: 13, d: 10 },
  carts: [-8, -3.5, 1].map((x, i) => ({ minCount: 4, x, z: 11 + i * 6, w: 4.2, d: 3.2 })),
  tailings: [14, 22, 30].map((x, i) => ({ minCount: 4, x, z: 14 + i * 3, radius: 4.8, lift: 1.4 + i * 0.3, h: 2.8 + i * 0.6 })),
  tents: [-30, -20, -10, 0].map((x) => ({ minCount: 6, x, z: 27 })),
  assay: { minCount: 8, x: 30, z: 16, w: 10, d: 8 },
} as const

/* ---------- archaeology dig ---------- */

export const DIG = {
  foundations: [
    { minCount: 0, x: -15, z: -7, w: 18, d: 11, buried: false },
    { minCount: 4, x: 14, z: -7, w: 18, d: 13, buried: false },
    { minCount: 8, x: 0, z: 1, w: 24, d: 16, buried: true },
  ],
  trenches: [
    { x: -23, z: 9, w: 13, d: 5 },
    { x: -4, z: 10, w: 15, d: 6 },
    { x: 17, z: 8, w: 12, d: 5 },
  ],
  tents: [
    { minCount: 2, x: -29, z: -22 },
    { minCount: 2, x: 0, z: -20 },
  ],
  table: { minCount: 4, x: 8, z: 22, w: 10, d: 4 },
  crates: [-22, -14, 20, 28].map((x) => ({ minCount: 4, x, z: 22, w: 3, d: 2.2 })),
  scaffold: { minCount: 6, x: 22, z: 3, legs: [-5, 5], legsZ: [-3, 3] },
  spoil: [15, 21, 27].map((x, i) => ({ minCount: 8, x, z: 15, radius: 3.2, lift: 1 + i * 0.25, h: 2 + i * 0.5 })),
  sortingTable: { minCount: 8, x: -9, z: 20, w: 4.8, d: 3.4 },
  barrels: [-18, -12, -6, 0, 6].map((x, i) => ({ minCount: 8, x, z: 18 + (i % 2) * 2, radius: 0.45 + i * 0.04 })),
  wagon: { minCount: 8, x: 27, z: -16, yaw: -0.5 },
} as const

/* ---------- outskirts reserve ---------- */

export interface ReserveItem {
  index: number
  x: number
  z: number
  s: number
  kind: number
}

/** The 72 seeded habitat items (same generator and order as the scene has always used). */
export function reserveItems(seed: number): ReserveItem[] {
  const rng = seeded(seed * 73)
  return Array.from({ length: 72 }, (_, index) => ({ index, x: -34 + rng() * 68, z: -112 + rng() * 224, s: 0.55 + rng() * 1.05, kind: index % 9 }))
}

/** Which population count reveals a seeded item of this kind. */
export function reserveItemMinCount(kind: number): number | null {
  if (kind === 0) return 2
  if (kind === 1 || kind === 2) return 1
  if (kind === 3 || kind === 4) return 2
  if (kind === 5 || kind === 6) return 3
  if (kind === 7 || kind === 8) return 4
  return null
}

export const RESERVE = {
  cacti: [-22, 4, 25, -5].map((x, i) => ({ x, z: -78 + i * 52, scale: [1.25, 0.92, 1.1, 0.78][i] })),
  tank: { x: 17, z: 20, radius: 5.6 },
  telegraph: [-92, -58, -24, 10, 44, 78].map((z) => ({ x: -28, z })),
  wildlife: [
    { x: -4, z: -60, color: '#a87048' },
    { x: 13, z: -22, color: '#d19b5f' },
    { x: -10, z: 37, color: '#a87048' },
    { x: 18, z: 83, color: '#d19b5f' },
    { x: -2, z: 9, color: '#c18a54' },
  ] as AnimalAt[],
  burrows: [
    { x: -14, z: 56 },
    { x: 11, z: 78 },
    { x: 24, z: -48 },
    { x: -6, z: -92 },
  ],
  /** Band 4: the twin-stack formation, the layered stack and the four wash slabs with plants. */
  formation: { x: 23, z: -84 },
  stack: { x: -18, z: 68 },
  washes: [-72, -12, 48, 96].map((z, i) => ({ x: -19 + (i % 2) * 31, z })),
} as const

/* ---------- fixed world pieces ---------- */

export const LANDMARK_RISE = { x: 118, z: 65, radius: 10, height: 3 }
export const TELEGRAPH_LINE = Array.from({ length: 9 }, (_, i) => ({ x: 72 + i * 6.8, z: -112 + i * 28 }))
