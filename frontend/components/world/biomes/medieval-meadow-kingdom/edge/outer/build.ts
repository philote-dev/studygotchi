/**
 * The outer world's build, cut into steps the scene runs across frames (nearest first): ring 1
 * by quadrant, the plate decals and the river / track ribbons, rings 2 and 3, the hedgerows,
 * the woods in z-bands, the copses, the lone trees, the haystacks. Each step is a few tens of
 * milliseconds at most (the budget test times them), so opening the land never hitches.
 */
import type * as THREE from 'three'
import { lakeInside } from '../barriers/geography'
import { OUTER_COLOURS, waterColour } from './palette'
import { type DecalData, type RingMeshData, buildPlateDecals, buildRibbon, ringBuildUnits } from './outer-mesh'
import type { OuterWorld } from './outer-world'
import { riverDistance, riverWidthAt } from './river'
import {
  type CanopyInstance,
  type CopseInstance,
  type HayInstance,
  type HedgeInstance,
  type TreeField,
  WOODS_REACH,
  copses,
  haystacks,
  hedgerows,
  loneTrees,
  woodsBand,
} from './scatter'

export interface RibbonSet {
  banks: THREE.BufferGeometry[]
  waters: THREE.BufferGeometry[]
  tracks: THREE.BufferGeometry[]
}

export interface OuterBuilt {
  rings: RingMeshData[]
  decals: DecalData | null
  ribbons: RibbonSet | null
  hedges: HedgeInstance[] | null
  woods: CanopyInstance[]
  copses: CopseInstance[] | null
  lone: Pick<TreeField, 'l0' | 'l1' | 'l2'> | null
  hay: HayInstance[] | null
}

export interface BuildStep {
  label: string
  run(): void
}

export interface OuterBuild {
  built: OuterBuilt
  steps: BuildStep[]
  /** Index of the next step to run. */
  next: number
}

/** Woods are scanned in z-bands this tall so no single band is a long step. */
const WOODS_BAND = 360

function trackLength(points: readonly [number, number][]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return total
}

export function buildRibbons(world: OuterWorld): RibbonSet {
  const layout = world.layout
  const lake = world.plan.lake
  const water = (x: number, z: number) => riverWidthAt(layout, world.river, riverDistance(layout, world.river, x, z), z, world.plate.minZ)
  const bankWidth = (x: number, z: number) => water(x, z) + (layout.wetBandWidth - layout.riverWidth)
  // The banks stop at the lake's own bank rim so the mouth is one shore, not a canal cut into the water;
  // the water runs a little way under the lake surface so the join is hidden.
  const bankUntil = (x: number, z: number) => lakeInside(lake, x, z) > -7
  const waterUntil = (x: number, z: number) => lakeInside(lake, x, z) > 6
  const reaches = [world.river.north, world.river.south]
  return {
    banks: reaches.map((points) => buildRibbon(world, { points, width: bankWidth, lift: 0.025, step: 8, until: bankUntil }, OUTER_COLOURS.bank)),
    waters: reaches.map((points) => buildRibbon(world, { points, width: water, lift: 0.045, step: 8, until: waterUntil }, waterColour({ night: false }))),
    // Tracks fade in over their first 60 m (a trail gathering into a lane) so neither starts from nothing.
    tracks: world.tracks.map((points) =>
      buildRibbon(world, { points, width: (_x, _z, t) => 0.8 + 2.6 * Math.min(1, (t * trackLength(points)) / 60), lift: 0.03, step: 8 }, OUTER_COLOURS.track),
    ),
  }
}

export function createOuterBuild(world: OuterWorld): OuterBuild {
  const built: OuterBuilt = { rings: [], decals: null, ribbons: null, hedges: null, woods: [], copses: null, lone: null, hay: null }
  const steps: BuildStep[] = []
  const units = ringBuildUnits(world)
  // Ring 1 (four quadrants) first: it meets the plate.
  for (const unit of units.filter((u) => u.label.startsWith('ring1'))) steps.push({ label: unit.label, run: () => built.rings.push(...unit.build()) })
  steps.push({ label: 'decals', run: () => (built.decals = buildPlateDecals(world)) })
  steps.push({ label: 'ribbons', run: () => (built.ribbons = buildRibbons(world)) })
  for (const unit of units.filter((u) => !u.label.startsWith('ring1'))) steps.push({ label: unit.label, run: () => built.rings.push(...unit.build()) })
  steps.push({ label: 'hedges', run: () => (built.hedges = hedgerows(world)) })
  const zMin = world.plate.minZ - WOODS_REACH
  const zMax = world.plate.maxZ + WOODS_REACH
  for (let z0 = zMin; z0 < zMax; z0 += WOODS_BAND) {
    const z1 = Math.min(zMax, z0 + WOODS_BAND)
    steps.push({ label: `woods ${z0}..${z1}`, run: () => built.woods.push(...woodsBand(world, z0, z1)) })
  }
  steps.push({ label: 'copses', run: () => (built.copses = copses(world)) })
  steps.push({ label: 'lone trees', run: () => (built.lone = loneTrees(world)) })
  steps.push({ label: 'haystacks', run: () => (built.hay = haystacks(world)) })
  return { built, steps, next: 0 }
}

/** Run every step at once (tests and tooling). Returns the per-step wall times, ms. */
export function runOuterBuild(build: OuterBuild): number[] {
  const times: number[] = []
  while (build.next < build.steps.length) {
    const t0 = performance.now()
    build.steps[build.next++].run()
    times.push(performance.now() - t0)
  }
  return times
}
