import { lerp, Noise, polylineDistance, smoothstep, stepped, type HeightFn, type V2 } from './lib'
import { P } from './palette'
import type { TerrainSpec } from './terrain'

/**
 * The jungle land shared by the three directions: flat ground (the sheet's y = 0 ± 0.6), a north
 * escarpment that carries the 18 m fall and the rear canopy wall on its plateau, a river carved
 * through, a lagoon, no-build clearings, and far hills that take the forest to the fog.
 */
export interface Ellipse {
  x: number
  z: number
  rx: number
  rz: number
}

export interface LandSpec {
  noise: Noise
  /** Foot of the escarpment as a function of x; the cliff rises north of it to the plateau 12 m (or 22 m with a shelf) further. */
  lip: (x: number) => number
  plateau: number
  /** One 9 m shelf halfway up the cliff (the Falls Terraces). */
  shelf: boolean
  rivers: readonly (readonly V2[])[]
  riverDepth: number
  lagoons: readonly (Ellipse & { depth: number })[]
  clearings: readonly Ellipse[]
  /** Rock knobs that rise out of the ground (landmark headlands). [x, z, radius, height] */
  knobs?: readonly (readonly number[])[]
  /** Extra ground terms (pool steps, banks). */
  extra?: (x: number, z: number) => number
}

export const WATER = -0.8

export function ellipseDistance(x: number, z: number, e: Ellipse): number {
  return Math.hypot((x - e.x) / e.rx, (z - e.z) / e.rz)
}

export function riverDistance(x: number, z: number, rivers: readonly (readonly V2[])[]): number {
  let best = Infinity
  for (const river of rivers) best = Math.min(best, polylineDistance(x, z, river).d)
  return best
}

export function makeHeight(spec: LandSpec): HeightFn {
  const { noise } = spec
  return (x, z) => {
    let h = 0.3 + 0.7 * noise.fbm(x / 40, z / 40)
    if (spec.extra) h += spec.extra(x, z)
    const lipZ = spec.lip(x)
    const t = (lipZ - z) / (spec.shelf ? 22 : 12)
    if (t > 0) {
      const rise = spec.shelf ? stepped(Math.min(1, t), 2, 0.35) : smoothstep(0, 1, Math.min(1, t))
      h += spec.plateau * rise
      if (t > 1) h += 3 * smoothstep(lipZ - 30, lipZ - 180, z) + 1.4 * noise.fbm(x / 30 + 4, z / 30)
    }
    for (const knob of spec.knobs ?? []) h += knob[3] * smoothstep(knob[2], knob[2] * 0.35, Math.hypot(x - knob[0], z - knob[1]))
    for (const c of spec.clearings) h = lerp(h, 0.35, smoothstep(1.1, 0.75, ellipseDistance(x, z, c)) * (t < 0 ? 1 : 0))
    for (const l of spec.lagoons) h = lerp(h, -l.depth, smoothstep(1.15, 0.82, ellipseDistance(x, z, l)))
    h -= spec.riverDepth * smoothstep(7, 3, riverDistance(x, z, spec.rivers))
    const far = smoothstep(195, 300, Math.hypot(x, z))
    h += far * (22 + 10 * noise.fbm(x / 90 + 1, z / 90 + 5))
    return h
  }
}

export const LAND_MATERIALS = [P.ground, P.groundAlt, P.slope, P.rock, P.mud, P.stone, P.rockDark] as const

export function makeTerrain(spec: LandSpec, height: HeightFn, stone?: (x: number, z: number) => boolean): TerrainSpec {
  const { noise } = spec
  return {
    height,
    materials: LAND_MATERIALS,
    innerHalf: 150,
    innerStep: 3.3,
    outerCells: 16,
    outerHalf: 300,
    classify: (x, z, y, ny) => {
      if (stone?.(x, z)) return 5
      if (ny < 0.5) return 6
      if (ny < 0.74) return 3
      if (y < -0.2) return 4
      if (ny < 0.9) return 2
      if (spec.clearings.some((c) => ellipseDistance(x, z, c) < 0.9)) return 1
      return noise.at(x / 23 + 9, z / 23) > 0.3 ? 1 : 0
    },
  }
}

/** 0 where no tree can stand (water, clearings, river banks); 1 elsewhere. */
export function openGround(spec: LandSpec, height: HeightFn, x: number, z: number): number {
  if (height(x, z) < 0.2) return 0
  if (riverDistance(x, z, spec.rivers) < 7) return 0
  for (const l of spec.lagoons) if (ellipseDistance(x, z, l) < 1.3) return 0
  for (const c of spec.clearings) if (ellipseDistance(x, z, c) < 1.05) return 0
  return 1
}

/** A noise-warped cliff foot with an optional spur: the plateau protrudes `reach` metres south between x0 and x1 (a promontory for the landmark). */
export function makeLip(noise: Noise, base: number, spur?: { x0: number; x1: number; reach: number }): (x: number) => number {
  return (x) => {
    let z = base + 6 * noise.fbm(x / 50, 0.3)
    if (spur) z += spur.reach * smoothstep(spur.x0 - 8, spur.x0, x) * smoothstep(spur.x1 + 8, spur.x1, x)
    return z
  }
}

/** Demote emergents to low domes inside a radius so decks and water stay visible. */
export function openSky<T extends { x: number; z: number; kind: 0 | 1 | 2; crown: number; radius: number }>(trees: T[], cx: number, cz: number, radius: number): T[] {
  for (const tree of trees) {
    if (tree.kind === 2 && Math.hypot(tree.x - cx, tree.z - cz) < radius) {
      tree.kind = 1
      tree.crown = 4.5
      tree.radius = 7
    }
  }
  return trees
}
