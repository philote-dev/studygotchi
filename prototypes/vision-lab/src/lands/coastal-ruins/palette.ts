/**
 * Salt-white coast palette: whitewash plus one cobalt accent, warm limestone cross-sections,
 * cream caps, a turquoise-to-ink sea. Night shifts terrain and water only; buildings keep their
 * hue and are re-lit by the lab's moon, with windows and the beacon carrying the light.
 */
export type ColorKey =
  | 'cap'
  | 'cliff'
  | 'scrub'
  | 'sand'
  | 'shelf'
  | 'deep'
  | 'foam'
  | 'plaza'
  | 'floor'
  | 'white'
  | 'blue'
  | 'stone'
  | 'ruin'
  | 'ruinDark'
  | 'lane'
  | 'stair'
  | 'cypress'
  | 'olive'
  | 'vine'
  | 'dark'
  | 'timber'
  | 'window'

export interface Palette extends Record<ColorKey, string> {
  water: string
  waterOpacity: number
  windowOff: string
}

const BUILT = {
  white: '#f7f3ea',
  blue: '#5279a5',
  stone: '#d6cbaa',
  ruin: '#9d9078',
  ruinDark: '#6f675a',
  lane: '#cdbd95',
  stair: '#d9c9a4',
  cypress: '#3d5a44',
  olive: '#8d9b73',
  vine: '#c64b92',
  dark: '#1b262e',
  timber: '#8a6a4c',
  window: '#ffe9a8',
  windowOff: '#b4ada3',
} as const

const DAY: Palette = {
  ...BUILT,
  cap: '#e8dfc6',
  cliff: '#b98762',
  scrub: '#aab087',
  sand: '#d3d4a8',
  shelf: '#3f9fa6',
  deep: '#255f78',
  foam: '#f7f2e4',
  plaza: '#f1e9d4',
  floor: '#a79b7f',
  water: '#3fb8c6',
  waterOpacity: 0.58,
}

const NIGHT: Palette = {
  ...BUILT,
  cap: '#8b8d93',
  cliff: '#6f554a',
  scrub: '#5f6a60',
  sand: '#717f7e',
  shelf: '#2a6a72',
  deep: '#122f44',
  foam: '#a2a8ab',
  plaza: '#95969c',
  floor: '#5e5b55',
  water: '#1f5f73',
  waterOpacity: 0.64,
}

export function palette(night: boolean): Palette {
  return night ? NIGHT : DAY
}
