import * as THREE from 'three'
import { MEADOW_PALETTE as P } from '../../layout/biome-layout'

/**
 * The outer world's flat colours: the authored land's own, so the seam has one voice. Night tones
 * for the greens follow the plate's own day → night ratio (#9fcf75 → #405b48) channel by channel,
 * so a tone-0 face beyond the seam is exactly the plate at night too.
 */
export interface OuterGrade {
  night: boolean
}

/** Field tones 0–4: the plate meadow, light meadow, deeper pasture, hay meadow, ripe wheat. */
export const FIELD_TONES_DAY = [P.meadow, P.meadowLight, '#8fc06c', '#cfd27a', '#dcc67c'] as const

const dayPlate = new THREE.Color(P.meadow)
const nightPlate = new THREE.Color(P.meadowNight)
const RATIO = [nightPlate.r / dayPlate.r, nightPlate.g / dayPlate.g, nightPlate.b / dayPlate.b] as const

const scratch = new THREE.Color()

/** A green at night: the plate's own channel ratios, so tone 0 lands exactly on the plate's night colour. */
export function nightGreen(dayHex: string): string {
  scratch.set(dayHex)
  scratch.setRGB(Math.min(1, scratch.r * RATIO[0]), Math.min(1, scratch.g * RATIO[1]), Math.min(1, scratch.b * RATIO[2]))
  return `#${scratch.getHexString()}`
}

export const FIELD_TONES_NIGHT = FIELD_TONES_DAY.map(nightGreen) as readonly string[]

export function fieldToneColour(tone: number, grade: OuterGrade): string {
  const list = grade.night ? FIELD_TONES_NIGHT : FIELD_TONES_DAY
  return list[Math.min(list.length - 1, Math.max(0, tone))]
}

export const OUTER_COLOURS = {
  bank: P.bank,
  waterDay: P.water,
  waterNight: P.waterNight,
  hillDay: P.meadowDark,
  /** The authored Green Crown's night hill colour. */
  hillNight: '#36503d',
  rockTop: P.limestone,
  rockSide: P.limestoneShade,
  /** The castle crag: dark warm rock under the pale castle. */
  cragTop: '#8a7c5e',
  cragSide: '#6f6349',
  forest: P.forest,
  forestLight: P.forestLight,
  trunk: P.timber,
  hedge: P.forest,
  hay: P.wheat,
  track: P.roadEdge,
  skyDay: P.sky,
  skyNight: P.skyNight,
} as const

export function skyColour(grade: OuterGrade): string {
  return grade.night ? OUTER_COLOURS.skyNight : OUTER_COLOURS.skyDay
}

export function waterColour(grade: OuterGrade): string {
  return grade.night ? OUTER_COLOURS.waterNight : OUTER_COLOURS.waterDay
}

export function hillColour(grade: OuterGrade): string {
  return grade.night ? OUTER_COLOURS.hillNight : OUTER_COLOURS.hillDay
}
