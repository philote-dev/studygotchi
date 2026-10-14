/**
 * Direction A — Penguin Isle archipelago. A cluster of pale rounded ice plates at four heights in
 * deep teal water, joined by plank bridges and short stairs: the harbour plate low with piers and
 * stilt cabins, the town plate dense with cabins on winding lanes, the lake plate with the skating
 * ring, the pine plate in drifts, the glacier plate high with crystal spires, ice pinnacles and the
 * igloo camp, the research slab with the red station and the icebreaker in cracked ice, the
 * oversized lighthouse on its own rock at the harbour, a whale between plates, a balloon above.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { BlockoutSceneProps, Pose } from '../types'
import { Balloon, Helipad, ICE, Icebreaker, Lighthouse, Mast, SkatingRing, Whale, WorldMeshes, iceFacet } from './kit'
import { fbm, mulberry32, ridged, smoothstep } from './noise'
import { buildHeightfield } from './terrain'
import {
  backFade,
  bumpHeight,
  camp,
  crackGap,
  crystalCluster,
  deck,
  emptyWorld,
  floeField,
  laneCabins,
  laneDistance,
  penguinGroup,
  pier,
  pineDrift,
  pinnacleCluster,
  plateAt,
  plateInside,
  rimShards,
  scatterCabins,
  stairs,
  station,
  within,
  SEA_FLOOR,
  type Bump,
  type Lane,
  type Plate,
  type WorldData,
} from './world'

export const TOWN: Plate = { x: -8, z: 8, r: 46, y: 7 }
export const HARBOUR: Plate = { x: 6, z: 86, r: 32, y: 2.5 }
export const LAKE: Plate = { x: 72, z: 34, r: 28, y: 4.5 }
export const PINES: Plate = { x: -92, z: -22, r: 36, y: 10 }
export const GLACIER: Plate = { x: 16, z: -74, r: 42, y: 14 }
export const SLAB: Plate = { x: 106, z: 102, r: 30, y: 3, power: 4, wobble: 0.05 }
export const ROCK: Plate = { x: -56, z: 100, r: 11, y: 9, wobble: 0.2 }
const PINNACLE: Plate = { x: -70, z: -96, r: 16, y: 18 }
const OUTLIERS: Plate[] = [
  { x: -132, z: 60, r: 14, y: 4 },
  { x: 142, z: 24, r: 12, y: 3 },
  { x: -24, z: 148, r: 10, y: 2 },
  { x: 72, z: -40, r: 12, y: 6 },
  { x: -120, z: 110, r: 9, y: 2.5 },
]
export const PLATES: Plate[] = [TOWN, HARBOUR, LAKE, PINES, GLACIER, SLAB, ROCK, PINNACLE, ...OUTLIERS]
const LAKE_ICE_R = 16
const FROZEN = { x: 148, z: 96, r: 24 }
const MOUNTAINS: Bump[] = [
  { x: -60, z: -165, r: 90, h: 70 },
  { x: 30, z: -178, r: 100, h: 86 },
  { x: 120, z: -150, r: 80, h: 60 },
  { x: -140, z: -125, r: 60, h: 48 },
  { x: 150, z: -110, r: 60, h: 44 },
]
const LANES: Lane[] = [
  { points: [[-6, 50], [-14, 36], [-4, 22], [-12, 6], [-2, -10], [-10, -26], [0, -36]], width: 4 },
  { points: [[-50, 2], [-36, 10], [-22, 2], [-8, 8], [8, 14], [24, 6], [38, 10]], width: 4 },
  { points: [[-30, 30], [-16, 40], [4, 36], [20, 26], [28, 10]], width: 3.4 },
  { points: [[-30, -20], [-20, -30], [0, -24], [16, -30], [30, -18]], width: 3.4 },
  { points: [[-40, 18], [-44, -4], [-34, -14]], width: 3 },
  { points: [[4, 54], [6, 70], [2, 86], [8, 104]], width: 3.6 },
  { points: [[-100, -42], [-86, -24], [-96, -4], [-84, 8]], width: 3.4 },
]

export function archipelagoHeight(seed: number) {
  return (x: number, z: number): number => {
    let y = SEA_FLOOR
    const plate = plateAt(PLATES, x, z, seed)
    if (plate) {
      y = plate.y + (fbm(x * 0.08, z * 0.08, seed + 1) - 0.5) * 0.6
      if (plate === GLACIER) y += (ridged(x * 0.06, z * 0.06, seed + 2) - 0.5) * 2.4
      if (plate === LAKE && within(x, z, LAKE.x, LAKE.z, LAKE_ICE_R)) y = LAKE.y - 0.4
    }
    if (within(x, z, FROZEN.x, FROZEN.z, FROZEN.r) && !plate) y = crackGap(x, z, 13, seed + 5) < 1.6 ? -1.2 : 0.5
    if (z < -100) {
      const m = bumpHeight(MOUNTAINS, x, z)
      if (m > 1) y = Math.max(y, backFade(m + (ridged(x * 0.02, z * 0.02, seed + 4) - 0.5) * 4 * smoothstep(1, 16, m), z))
    }
    return y
  }
}

function archipelagoFacet(seed: number) {
  return iceFacet({
    mask: (cx, cz, cy, ny, h) => {
      if (ny < 0.8) return null
      if (within(cx, cz, LAKE.x, LAKE.z, LAKE_ICE_R) && cy > 2) return h < 0.5 ? ICE.lakeIce : ICE.lakeIceAlt
      if (within(cx, cz, FROZEN.x, FROZEN.z, FROZEN.r) && cy > -2 && cy < 2) return cy < 0 ? ICE.waterDeep : h < 0.5 ? ICE.lakeIce : ICE.paleIce
      if (cy > 1 && laneDistance(LANES, cx, cz).d < 0 && plateAt(PLATES, cx, cz, seed)) return ICE.paving
      if (plateInside(SLAB, cx, cz, seed) > 3 && cy > 2) return ICE.paving
      return null
    },
  })
}

export function buildArchipelago(seed: number): WorldData {
  const height = archipelagoHeight(seed)
  const field = buildHeightfield({ xMin: -165, xMax: 165, zMin: -195, zMax: 165, cell: 3, height, facet: archipelagoFacet(seed) })
  const world = emptyWorld(field, height)
  const rnd = mulberry32(seed * 7919 + 13)
  const onPlate = (p: Plate, margin: number) => (x: number, z: number) => plateInside(p, x, z, seed) > margin
  const offLane = (x: number, z: number) => laneDistance(LANES, x, z).d > 1.5

  // Town plate: winding lanes of cabins with infill, lamps, a few pines between the houses.
  const townOk = (x: number, z: number) => plateInside(TOWN, x, z, seed) > 4
  for (const lane of LANES.slice(0, 5)) laneCabins(world, lane, rnd, { spacing: 7, ok: townOk })
  scatterCabins(world, LANES, TOWN.x, TOWN.z, TOWN.r - 5, 700, rnd, townOk)
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * (TOWN.r - 6)
    const x = TOWN.x + Math.cos(a) * d
    const z = TOWN.z + Math.sin(a) * d
    if (!townOk(x, z) || !offLane(x, z) || world.cabins.some((c) => Math.hypot(c.x - x, c.z - z) < 4.5)) continue
    world.pines.push({ x, y: height(x, z) - 0.3, z, r: 1.6 + rnd(), h: 6 + rnd() * 3 })
  }
  penguinGroup(world, -34, 40, 6, 12, rnd)
  penguinGroup(world, 22, -8, 5, 9, rnd)
  penguinGroup(world, -46, -8, 5, 10, rnd)
  penguinGroup(world, 30, 30, 5, 8, rnd)
  rimShards(world, rnd, TOWN, seed, 18)

  // Harbour plate: stilt cabins on the sea rim, piers with boats, the quay lane, penguins.
  laneCabins(world, LANES[5], rnd, { spacing: 10, ok: onPlate(HARBOUR, 3), palette: [ICE.red, ICE.blue, ICE.cream, ICE.orange] })
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * 0.2 + (i / 14) * Math.PI * 0.75
    const x = HARBOUR.x + Math.sin(a) * (HARBOUR.r + 1.5)
    const z = HARBOUR.z + Math.cos(a) * (HARBOUR.r + 1.5)
    if (plateInside(HARBOUR, x, z, seed) > 2) continue
    world.cabins.push({ x, y: HARBOUR.y + 2.2, z, ry: a, w: 4.6, d: 5.2, h: 3.6, color: i % 3 === 0 ? ICE.blue : ICE.red, chimney: i % 2 === 0 })
    for (const [ox, oz] of [[-1.6, -1.9], [1.6, -1.9], [-1.6, 1.9], [1.6, 1.9]] as const) {
      world.posts.push({ x: x + ox * Math.cos(a) + oz * Math.sin(a), y: -1.5, z: z - ox * Math.sin(a) + oz * Math.cos(a), sx: 0.4, sy: HARBOUR.y + 3.7, sz: 0.4 })
    }
  }
  pier(world, rnd, HARBOUR.x - 14, HARBOUR.z + 30, -0.3, 1, 26, 1.9, 3)
  pier(world, rnd, HARBOUR.x + 6, HARBOUR.z + 31, 0.1, 1, 32, 1.9, 4)
  pier(world, rnd, HARBOUR.x + 24, HARBOUR.z + 24, 0.8, 0.7, 24, 1.9, 3)
  pier(world, rnd, HARBOUR.x + 31, HARBOUR.z - 6, 1, -0.2, 20, 1.9, 2)
  penguinGroup(world, HARBOUR.x - 18, HARBOUR.z + 10, 8, 22, rnd)
  penguinGroup(world, HARBOUR.x + 16, HARBOUR.z - 12, 6, 14, rnd)
  penguinGroup(world, HARBOUR.x - 4, HARBOUR.z + 22, 5, 12, rnd, true)
  penguinGroup(world, HARBOUR.x + 22, HARBOUR.z + 12, 5, 10, rnd)
  rimShards(world, rnd, HARBOUR, seed, 10)

  // Lake plate: the frozen lake with the skating ring (JSX), fishing huts, a penguin ring on the ice.
  for (let i = 0; i < 5; i++) {
    const a = 0.4 + i * 1.3
    const x = LAKE.x + Math.cos(a) * (LAKE_ICE_R + 4)
    const z = LAKE.z + Math.sin(a) * (LAKE_ICE_R + 4)
    if (plateInside(LAKE, x, z, seed) < 2) continue
    world.cabins.push({ x, y: height(x, z) - 0.3, z, ry: a + Math.PI, w: 3.2, d: 3.4, h: 2.6, color: i % 2 === 0 ? ICE.coral : ICE.cream })
    world.lamps.push({ x: x + Math.cos(a + 0.5) * 3, y: height(x, z), z: z + Math.sin(a + 0.5) * 3 })
  }
  penguinGroup(world, LAKE.x, LAKE.z, 7, 22, rnd, true)
  penguinGroup(world, LAKE.x + 2, LAKE.z - 1, 3, 6, rnd)
  penguinGroup(world, LAKE.x - 20, LAKE.z + 10, 4, 9, rnd)
  penguinGroup(world, LAKE.x + 18, LAKE.z - 14, 4, 8, rnd)
  rimShards(world, rnd, LAKE, seed, 8)

  // Pine plate: drifts of pines around a forest lane of cabins.
  laneCabins(world, LANES[6], rnd, { spacing: 10, ok: onPlate(PINES, 4), palette: [ICE.cream, ICE.blue, ICE.red, ICE.teal] })
  const pineOk = (x: number, z: number) => plateInside(PINES, x, z, seed) > 2 && offLane(x, z) && !world.cabins.some((c) => Math.hypot(c.x - x, c.z - z) < 4.5)
  pineDrift(world, PINES.x - 12, PINES.z - 10, 18, 70, rnd, pineOk)
  pineDrift(world, PINES.x + 12, PINES.z + 14, 16, 60, rnd, pineOk)
  pineDrift(world, PINES.x + 8, PINES.z - 20, 12, 40, rnd, pineOk)
  pineDrift(world, PINES.x - 18, PINES.z + 16, 10, 30, rnd, pineOk)
  pineDrift(world, PINES.x, PINES.z, 30, 60, rnd, pineOk)
  penguinGroup(world, PINES.x + 20, PINES.z - 4, 4, 6, rnd)
  // Foothill pines for scale along the mountain band, and a few on the harbour and lake rims.
  for (let i = 0; i < 120; i++) {
    const x = -150 + rnd() * 300
    const z = -130 + rnd() * 32
    const y = height(x, z)
    if (y > 3 && y < 40 && Math.abs(height(x + 3, z) - y) < 3) world.pines.push({ x, y: y - 0.3, z, r: 1.8 + rnd() * 1.2, h: 7 + rnd() * 5 })
  }
  pineDrift(world, HARBOUR.x - 20, HARBOUR.z - 16, 8, 12, rnd, (x, z) => plateInside(HARBOUR, x, z, seed) > 2 && laneDistance(LANES, x, z).d > 2)
  pineDrift(world, LAKE.x + 16, LAKE.z + 16, 7, 10, rnd, (x, z) => plateInside(LAKE, x, z, seed) > 2 && !within(x, z, LAKE.x, LAKE.z, LAKE_ICE_R + 2))

  // Glacier plate: crystal spires, ice pinnacles, the igloo camp, penguins, rim shards.
  crystalCluster(world, rnd, GLACIER.x + 22, GLACIER.z - 8, 9, 14, 1.3)
  crystalCluster(world, rnd, GLACIER.x - 20, GLACIER.z + 10, 7, 10, 1)
  crystalCluster(world, rnd, GLACIER.x + 4, GLACIER.z - 30, 6, 8, 1.1)
  pinnacleCluster(world, rnd, GLACIER.x - 6, GLACIER.z - 22, 12, 5, [14, 26])
  pinnacleCluster(world, rnd, GLACIER.x + 28, GLACIER.z + 8, 8, 3, [10, 18])
  pinnacleCluster(world, rnd, PINNACLE.x, PINNACLE.z, 9, 5, [20, 34])
  camp(world, rnd, GLACIER.x - 8, GLACIER.z + 14, 6, 3)
  penguinGroup(world, GLACIER.x + 10, GLACIER.z + 24, 6, 14, rnd)
  penguinGroup(world, GLACIER.x - 26, GLACIER.z - 4, 5, 10, rnd, true)
  rimShards(world, rnd, GLACIER, seed, 22)
  for (let i = 0; i < 10; i++) {
    const x = GLACIER.x - 30 + rnd() * 60
    const z = GLACIER.z - 36 + rnd() * 20
    if (plateInside(GLACIER, x, z, seed) > 3) world.pines.push({ x, y: height(x, z) - 0.3, z, r: 1.6 + rnd(), h: 5 + rnd() * 3 })
  }

  // Research slab: the red station on stilts, mast and helipad (JSX), icebreaker in cracked ice.
  station(world, rnd, SLAB.x - 4, SLAB.y, SLAB.z - 4, 0.2, 5)
  penguinGroup(world, SLAB.x - 18, SLAB.z + 18, 5, 8, rnd)
  for (let i = 0; i < 6; i++) world.seals.push({ x: FROZEN.x - 10 + rnd() * 20, y: 0.5, z: FROZEN.z - 14 + rnd() * 28, ry: rnd() * Math.PI * 2 })

  // Lighthouse rock and outliers.
  penguinGroup(world, ROCK.x - 3, ROCK.z + 2, 3, 5, rnd)
  for (const p of OUTLIERS) {
    penguinGroup(world, p.x, p.z, p.r * 0.6, 6 + Math.floor(rnd() * 8), rnd)
    rimShards(world, rnd, p, seed, 4)
  }

  // Bridges and stairs between plates.
  deck(world, HARBOUR.x - 27, HARBOUR.y, HARBOUR.z + 6, ROCK.x + 9, ROCK.y, ROCK.z - 3, 2.6, 6, -2.5)
  deck(world, LAKE.x + 14, LAKE.y, LAKE.z + 24, SLAB.x - 24, SLAB.y, SLAB.z - 26, 2.6, 7, -2.5)
  deck(world, TOWN.x + 44, TOWN.y, TOWN.z + 2, LAKE.x - 26, LAKE.y, LAKE.z - 22, 2.6, 6, -2.5)
  deck(world, TOWN.x - 44, TOWN.y, TOWN.z - 14, PINES.x + 34, PINES.y, PINES.z + 2, 2.6, 6, -2.5)
  stairs(world, 6, 50, TOWN.y, 6, 58, HARBOUR.y, 3.4)
  stairs(world, 0, -34, TOWN.y, 2, -42, GLACIER.y, 3.4)
  stairs(world, 16, -36, TOWN.y, 22, -44, GLACIER.y, 2.6)
  deck(world, GLACIER.x - 36, GLACIER.y, GLACIER.z - 22, PINNACLE.x + 14, PINNACLE.y, PINNACLE.z + 6, 2.2, 7, -2.5)
  deck(world, LAKE.x + 24, LAKE.y, LAKE.z - 18, OUTLIERS[3].x + 4, OUTLIERS[3].y, OUTLIERS[3].z + 10, 2.2, 7, -2.5)
  for (const [x, z] of [[6, 56], [1, -40], [-50, -6], [40, 8], [-28, 92], [88, 60]] as const) world.lamps.push({ x, y: height(x, z), z })

  // Floes in every water gap.
  floeField(world, rnd, -160, 160, -110, 160, 110, (x, z) => !within(x, z, FROZEN.x, FROZEN.z, FROZEN.r + 4))
  return world
}

/** The balloon drifts in a slow loop above the town; the scene's one `useFrame`. */
function DriftingBalloon({ night }: { night: boolean }) {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    const t = clock.elapsedTime * 0.05
    group.current.position.set(-26 + Math.cos(t) * 22, 30 + Math.sin(t * 2.3) * 2, 36 + Math.sin(t) * 18)
  })
  return (
    <group ref={group} position={[-4, 30, 36]}>
      <Balloon night={night} />
    </group>
  )
}

export function ArchipelagoScene({ night, seed }: BlockoutSceneProps) {
  const world = useMemo(() => buildArchipelago(seed), [seed])
  return (
    <group>
      <WorldMeshes world={world} night={night} />
      <Lighthouse x={ROCK.x} y={ROCK.y + 0.3} z={ROCK.z} s={3} night={night} />
      <SkatingRing x={LAKE.x} y={LAKE.y - 0.4} z={LAKE.z} r={7} />
      <Mast x={SLAB.x + 18} y={SLAB.y} z={SLAB.z - 14} h={24} night={night} />
      <Helipad x={SLAB.x - 12} y={SLAB.y} z={SLAB.z + 16} />
      <Icebreaker x={FROZEN.x - 2} z={FROZEN.z + 4} yaw={Math.PI * 0.92} night={night} />
      <Whale x={46} z={70} yaw={0.9} />
      <DriftingBalloon night={night} />
    </group>
  )
}

export const ARCHIPELAGO_POSES: readonly Pose[] = [
  { id: 'hero', position: [130, 72, 200], target: [-20, 8, -10], fov: 36 },
  { id: 'walk', position: [12, 4.3, 146], target: [-6, 12, -20], fov: 48 },
  { id: 'overview', position: [0, 185, 250], target: [0, 4, -10], fov: 36 },
  { id: 'reverse', position: [30, 70, -130], target: [-10, 2, 90], fov: 36 },
]
