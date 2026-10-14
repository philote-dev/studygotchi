import type { Tree } from './kit'
import { jitteredGrid, mulberry, range, type HeightFn } from './lib'

/**
 * Two-height canopy scatter shared by the three directions: a dense sea of ground-hugging domes
 * (no trunks, so they merge into one green surface) with emergents on trunks breaking out of it,
 * and a ring of big, sparse crowns beyond the land that carries the forest to the fog.
 */
export interface ForestOptions {
  seed: number
  height: HeightFn
  /** Keep probability 0..1 for a candidate; 0 excludes. */
  accept: (x: number, z: number) => number
  innerHalf?: number
  spacing?: number
  emergentChance?: number
  farFrom?: number
  farSpacing?: number
  farAccept?: (x: number, z: number) => number
}

export function forest({
  seed,
  height,
  accept,
  innerHalf = 160,
  spacing = 8,
  emergentChance = 0.1,
  farFrom = 158,
  farSpacing = 34,
  farAccept,
}: ForestOptions): Tree[] {
  const rng = mulberry(seed * 7919 + 101)
  const trees: Tree[] = []
  for (const [x, z] of jitteredGrid(rng, innerHalf, spacing, accept)) {
    const emergent = rng() < emergentChance
    trees.push({
      x,
      z,
      y: height(x, z) - 0.4,
      crown: emergent ? range(rng, 18, 25) : range(rng, 3.2, 5.6),
      radius: emergent ? range(rng, 6.5, 9.5) : range(rng, 5.8, 8.8),
      squash: emergent ? range(rng, 0.55, 0.7) : range(rng, 0.52, 0.66),
      yaw: rng() * Math.PI,
      kind: emergent ? 2 : rng() < 0.5 ? 0 : 1,
    })
  }
  const far = mulberry(seed * 31 + 7)
  const outer = farAccept ?? accept
  for (const [x, z] of jitteredGrid(far, 300, farSpacing, (x, z) => (Math.max(Math.abs(x), Math.abs(z)) > farFrom ? outer(x, z) : 0))) {
    const emergent = far() < 0.4
    trees.push({
      x,
      z,
      y: height(x, z) - 0.6,
      crown: emergent ? range(far, 14, 22) : range(far, 4, 7),
      radius: range(far, 10, 15),
      squash: range(far, 0.55, 0.72),
      yaw: far() * Math.PI,
      kind: emergent ? 2 : 1,
    })
  }
  return trees
}
