import { hashInt, polar, type ClassifyInfo } from './lib'
import type { Placement } from './parts'

/** Biome sheet palette (docs/design/world/biomes/nordic-volcanic-highlands.md) plus the blockout extras. */
export const PALETTE = {
  turf: '#68765b',
  moss: '#7a8a5c',
  basalt: '#2e3440',
  basaltTop: '#4b4a52',
  ash: '#4d4650',
  sand: '#34333a',
  snow: '#d4d8d5',
  ice: '#c9e2ee',
  iceWall: '#8fb8cf',
  sinter: '#cfc5ae',
  crust: '#2d2529',
  /** Day colour of a cooled flow's core; the same surface glows `lavaGlow` at night. */
  lava: '#7a3328',
  lavaGlow: '#e05a32',
  skylineNear: '#3a4049',
  skylineFar: '#55616a',
  water: '#315b70',
  lagoon: '#4a8a9c',
  road: '#8a7f6d',
  plank: '#6b5745',
  red: '#a64b3c',
  ochre: '#d08a3c',
  cream: '#e8dfc9',
  darkTimber: '#4a3a33',
  turfRoof: '#556b46',
  stone: '#5a5962',
  window: '#ffe9a8',
  fire: '#ffb347',
  geothermal: '#7cc8be',
} as const

/** Terrain bucket colours; keys are what `classify` returns. */
export const TERRAIN_COLORS: Record<string, string> = {
  turf: PALETTE.turf,
  moss: PALETTE.moss,
  basalt: PALETTE.basalt,
  basaltTop: PALETTE.basaltTop,
  ash: PALETTE.ash,
  sand: PALETTE.sand,
  snow: PALETTE.snow,
  ice: PALETTE.ice,
  iceWall: PALETTE.iceWall,
  sinter: PALETTE.sinter,
  crust: PALETTE.crust,
  lava: PALETTE.lava,
}

export interface ClassifyOptions {
  snowLine: number
  ashLine: number
  shoreLine?: number
  steep?: number
}

/**
 * Shared triangle classifier: explicit tags win (lava, crust, ice, sinter, sand), then slope
 * paints steep faces basalt, then altitude paints snow and ash, then shoreline paints sand.
 */
export function makeClassifier({ snowLine, ashLine, shoreLine = 1.4, steep = 0.72 }: ClassifyOptions) {
  return ({ tag, ny, y }: ClassifyInfo): string | null => {
    if (tag === 'lava') return 'lava'
    if (tag === 'crust') return ny < 0.6 ? 'basalt' : 'crust'
    if (tag === 'ice') return ny < 0.78 ? 'iceWall' : 'ice'
    if (tag === 'sinter') return 'sinter'
    if (tag === 'sand') return ny < steep ? 'basalt' : 'sand'
    if (tag === 'rock') return ny < 0.9 ? 'basalt' : 'basaltTop'
    if (tag === 'moss') return ny < steep ? 'basalt' : 'moss'
    if (ny < steep) return 'basalt'
    if (y > snowLine) return 'snow'
    if (y > ashLine) return 'ash'
    if (y < shoreLine) return 'sand'
    return 'turf'
  }
}

export const HOUSE_COLORS = [PALETTE.red, PALETTE.cream, PALETTE.darkTimber, PALETTE.ochre, PALETTE.cream, PALETTE.red, PALETTE.darkTimber] as const

/**
 * Broad shoulders beyond the heightfield on the north half of the horizon: the biome sheet's
 * charcoal near row and cooler rear row. They hide the slab edge from the cinematic poses and
 * take the fog, so the land has depth without a visible rim.
 */
export function makeSkyline(seed: number, from = 186, to = 354, step = 16, radius = 250): { near: Placement[]; far: Placement[] } {
  const near: Placement[] = []
  const far: Placement[] = []
  let i = 0
  for (let bearing = from; bearing <= to; bearing += step, i++) {
    const jitter = hashInt(i, 1, seed) - 0.5
    const [fx, fz] = polar(0, 0, radius + 36 + hashInt(i, 2, seed) * 40, bearing + jitter * 8)
    far.push({ x: fx, y: -12, z: fz, yaw: hashInt(i, 3, seed), sx: 96 + hashInt(i, 4, seed) * 60, sy: 40 + hashInt(i, 5, seed) * 48, sz: 96 + hashInt(i, 6, seed) * 60 })
    if (i % 2 === 0) {
      const [nx, nz] = polar(0, 0, radius - 10 + hashInt(i, 7, seed) * 24, bearing + 6 + jitter * 6)
      near.push({ x: nx, y: -12, z: nz, yaw: hashInt(i, 8, seed), sx: 64 + hashInt(i, 9, seed) * 40, sy: 22 + hashInt(i, 10, seed) * 24, sz: 64 + hashInt(i, 11, seed) * 40 })
    }
  }
  return { near, far }
}
