/**
 * Direction B — Fjord fishing village. The snowy-fishing-village density on a bay under soft
 * rounded mountains: winding lanes of red and blue cabins with white trim on gently rising shores,
 * the red church on its knoll, the plaza with the lit tree, long piers with boats, stilt cabins at
 * the waterline. A frozen river valley runs up from the bay through the pine town to the frozen
 * lake in the foothills (it glows at night, as in the winter-valley reference); the glacier wall
 * closes the head of the fjord with crystal spires and the camp above it; the ice arch stands at
 * the mouth with the oversized lighthouse on its rock beside it; the research islet sits in the bay.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surf } from '../../render/materials'
import type { BlockoutSceneProps, Pose } from '../types'
import { Church, ICE, IceArch, Lighthouse, LitTree, Mast, SkatingRing, Whale, WorldMeshes, iceFacet, sweepGeometry } from './kit'
import { fbm, lerp, mulberry32, polylineDistance, ridged, smoothstep, wobble } from './noise'
import { buildHeightfield } from './terrain'
import {
  backFade,
  bumpHeight,
  camp,
  crystalCluster,
  deck,
  emptyWorld,
  floeField,
  laneCabins,
  laneDistance,
  penguinGroup,
  pier,
  pineDrift,
  plateInside,
  scatterCabins,
  station,
  within,
  SEA_FLOOR,
  type Bump,
  type Lane,
  type Plate,
  type WorldData,
} from './world'

export const bayCentre = (z: number) => 10 * Math.sin(z / 90)
export const bayHalfWidth = (z: number) => 20 + 18 * smoothstep(-70, 150, z)
const HEAD_Z = -70
const FREEZE_Z = -16
export const LAKE = { x: 86, z: -50, r: 22, y: 9.6 }
export const RIVER: ReadonlyArray<readonly [number, number]> = [
  [84, -44],
  [78, -30],
  [70, -10],
  [64, 10],
  [58, 30],
  [52, 46],
  [46, 62],
]
export const ISLET: Plate = { x: 28, z: 112, r: 15, y: 3 }
export const ROCK: Plate = { x: -34, z: 156, r: 10, y: 8, wobble: 0.2 }
const ARCH = { x: -12, z: 168, yaw: 0.3, span: 30 }
const CHURCH = { x: 76, z: 40 }
const PLAZA = { x: 64, z: 80 }
const MOUNTAINS: Bump[] = [
  { x: -110, z: -150, r: 95, h: 78 },
  { x: -10, z: -172, r: 100, h: 90 },
  { x: 90, z: -150, r: 90, h: 72 },
  { x: -150, z: -60, r: 70, h: 50 },
  { x: 160, z: -50, r: 70, h: 46 },
  { x: -150, z: 50, r: 62, h: 36 },
  { x: 158, z: 70, r: 60, h: 34 },
  { x: 120, z: -90, r: 60, h: 40 },
]

/** Shore lanes follow the bay at a set distance inland, with a gentle wiggle. */
function shoreLane(side: 1 | -1, inland: number, zFrom: number, zTo: number, width: number, wiggle = 3): Lane {
  const points: Array<[number, number]> = []
  for (let z = zFrom; z >= zTo; z -= 16) {
    points.push([bayCentre(z) + side * (bayHalfWidth(z) + inland + wiggle * Math.sin(z / 19 + inland)), z])
  }
  return { points, width }
}
const LANES: Lane[] = [
  shoreLane(1, 7, 150, -6, 4),
  shoreLane(1, 24, 140, 4, 3.6, 4),
  shoreLane(1, 42, 126, 20, 3.2, 5),
  shoreLane(-1, 7, 134, 10, 3.8),
  shoreLane(-1, 24, 120, 20, 3.2, 4),
  { points: [[52, 120], [72, 118], [96, 116]], width: 3.2 },
  { points: [[50, 80], [64, 80], [86, 78], [104, 72]], width: 3.4 },
  { points: [[56, 40], [76, 52], [92, 40]], width: 3.2 },
  { points: [[-46, 90], [-66, 92], [-86, 86]], width: 3 },
  { points: [[-50, 50], [-70, 44], [-90, 34]], width: 3 },
  // Pine town: a lane up the river's east bank.
  { points: [[62, 28], [70, 12], [78, -8], [86, -26], [96, -40]], width: 3 },
]
const coastZ = (x: number, seed: number) => 148 + wobble(x + 20, seed + 23, 0.012) * 14

export function fjordHeight(seed: number) {
  return (x: number, z: number): number => {
    const d = Math.abs(x - bayCentre(z)) - bayHalfWidth(z)
    let y: number
    if (z > coastZ(x, seed) && d < 60) y = SEA_FLOOR
    else if (d < 0) y = z < FREEZE_Z + wobble(x, seed + 2, 0.05) * 8 ? 1.4 + (fbm(x * 0.1, z * 0.1, seed + 3) - 0.5) * 0.4 : SEA_FLOOR
    else y = 0.5 + 9.5 * smoothstep(0, 34, d) + 18 * smoothstep(70, 130, d) + (fbm(x * 0.04, z * 0.04, seed + 4) - 0.5) * 1.8
    // Church knoll, river valley, lake bowl.
    if (within(x, z, CHURCH.x, CHURCH.z, 12)) y += 2.4 * (1 - smoothstep(6, 12, Math.hypot(x - CHURCH.x, z - CHURCH.z)))
    const river = polylineDistance(RIVER, x, z)
    if (d > 0 && river < 10) y -= 2.4 * (1 - smoothstep(2.5, 10, river))
    const dL = Math.hypot(x - LAKE.x, z - LAKE.z)
    if (dL < LAKE.r) y = LAKE.y
    else if (dL < LAKE.r + 6) y = Math.max(y, lerp(LAKE.y + 0.6, y, smoothstep(LAKE.r, LAKE.r + 6, dL)))
    // Glacier wall at the head, plateau and crevasses behind it.
    const headEdge = HEAD_Z + wobble(x, seed + 5, 0.03) * 6
    if (z < headEdge + 2 && Math.abs(x - bayCentre(z)) < bayHalfWidth(z) + 34) {
      const g = 2 + 32 * smoothstep(headEdge, headEdge - 12, z) + (ridged(x * 0.035, z * 0.035, seed + 6) - 0.5) * 8 * smoothstep(headEdge - 4, headEdge - 24, z)
      y = Math.max(y, g)
    }
    // Rounded mountains behind and at the sides (ridged detail only where there is a mountain).
    const m = bumpHeight(MOUNTAINS, x, z)
    if (m > 1) y = Math.max(y, backFade(m + (ridged(x * 0.02, z * 0.02, seed + 7) - 0.5) * 4 * smoothstep(1, 16, m), z))
    // Islet and lighthouse rock.
    for (const p of [ISLET, ROCK]) if (plateInside(p, x, z, seed) > 0) y = Math.max(y, p.y + (fbm(x * 0.1, z * 0.1, seed + 8) - 0.5) * 0.4)
    return y
  }
}

function fjordFacet(seed: number) {
  return iceFacet({
    highLine: 36,
    mask: (cx, cz, cy, ny, h) => {
      if (ny < 0.8) return null
      const d = Math.abs(cx - bayCentre(cz)) - bayHalfWidth(cz)
      if (d < 0 && cy > 0.6 && cy < 3) return h < 0.5 ? ICE.lakeIce : ICE.lakeIceAlt
      if (within(cx, cz, LAKE.x, LAKE.z, LAKE.r)) return h < 0.5 ? ICE.lakeIce : ICE.lakeIceAlt
      if (d > 0 && polylineDistance(RIVER, cx, cz) < 3.2 && cy > 0.6) return h < 0.5 ? ICE.lakeIce : ICE.lakeIceAlt
      if (within(cx, cz, PLAZA.x, PLAZA.z, 13) && cy > 0.6) return ICE.paving
      if (cy > 0.6 && cy < 40 && laneDistance(LANES, cx, cz).d < 0) return ICE.paving
      if (plateInside(ISLET, cx, cz, seed) > 3 && cy > 2) return ICE.paving
      return null
    },
  })
}

export function buildFjord(seed: number): WorldData {
  const height = fjordHeight(seed)
  const field = buildHeightfield({ xMin: -165, xMax: 165, zMin: -195, zMax: 165, cell: 3, height, facet: fjordFacet(seed) })
  const world = emptyWorld(field, height)
  const rnd = mulberry32(seed * 104729 + 29)
  const landOk = (x: number, z: number) => {
    const y = height(x, z)
    return y > 1.2 && y < 30 && !within(x, z, CHURCH.x, CHURCH.z, 11) && !within(x, z, PLAZA.x, PLAZA.z, 13) && polylineDistance(RIVER, x, z) > 6 && !within(x, z, LAKE.x, LAKE.z, LAKE.r + 3)
  }
  const flat = (x: number, z: number) => Math.abs(height(x + 3, z) - height(x - 3, z)) < 2.2 && Math.abs(height(x, z + 3) - height(x, z - 3)) < 2.2
  const ok = (x: number, z: number) => landOk(x, z) && flat(x, z)

  // The village: lanes on both shores, infill on the east shore, pine town up the river.
  for (const lane of LANES) laneCabins(world, lane, rnd, { spacing: 6.6, ok })
  scatterCabins(world, LANES, 70, 78, 56, 1400, rnd, ok)
  scatterCabins(world, LANES, -66, 70, 38, 200, rnd, ok)
  scatterCabins(world, LANES, 84, -12, 26, 80, rnd, ok, [ICE.cream, ICE.blue, ICE.red, ICE.teal])

  // Stilt cabins at the waterline (east shore) and piers with boats.
  for (let z = 128; z > 24; z -= 13) {
    const x = bayCentre(z) + bayHalfWidth(z) - 1
    world.cabins.push({ x, y: 2.1, z, ry: -Math.PI / 2 + 0.2, w: 4.6, d: 5.2, h: 3.6, color: rnd() < 0.6 ? ICE.red : ICE.blue, chimney: z % 2 === 0 })
    for (const [ox, oz] of [[-1.6, -1.9], [1.6, -1.9], [-1.6, 1.9], [1.6, 1.9]] as const) world.posts.push({ x: x + ox, y: -1.5, z: z + oz, sx: 0.4, sy: 3.6, sz: 0.4 })
  }
  for (const z of [118, 92, 66]) pier(world, rnd, bayCentre(z) + bayHalfWidth(z) + 1, z, -1, -0.08, 30 + (z % 20), 1.9, 4)
  for (const z of [104, 70]) pier(world, rnd, bayCentre(z) - bayHalfWidth(z) - 1, z, 1, 0.1, 24, 1.9, 3)
  for (let i = 0; i < 10; i++) {
    const z = 20 + rnd() * 130
    world.boats.push({ x: bayCentre(z) + (rnd() - 0.5) * bayHalfWidth(z) * 1.3, z, ry: rnd() * Math.PI * 2, color: i % 3 === 0 ? ICE.red : i % 3 === 1 ? ICE.blue : ICE.cream })
  }

  // Pines: everywhere the village is not, in drifts, denser up the valley and on the west shore.
  const pineOk = (x: number, z: number) => landOk(x, z) && laneDistance(LANES, x, z).d > 2 && !world.cabins.some((c) => Math.hypot(c.x - x, c.z - z) < 4.6) && height(x, z) < 34
  for (const [cx, cz, r, n] of [
    [90, 10, 26, 70],
    [110, 40, 24, 50],
    [112, 90, 22, 40],
    [96, -30, 22, 44],
    [60, -40, 20, 36],
    [120, -20, 20, 36],
    [-80, 20, 26, 60],
    [-100, 60, 24, 50],
    [-96, 110, 22, 40],
    [-60, -20, 22, 40],
    [-110, -30, 24, 36],
    [40, -56, 18, 30],
  ] as const) {
    pineDrift(world, cx, cz, r, n, rnd, pineOk)
  }
  for (let i = 0; i < 40; i++) {
    const x = -140 + rnd() * 280
    const z = -60 + rnd() * 200
    if (pineOk(x, z) && Math.abs(x - bayCentre(z)) > bayHalfWidth(z) + 4) world.pines.push({ x, y: height(x, z) - 0.3, z, r: 1.6 + rnd(), h: 6 + rnd() * 4 })
  }

  // Lake: skating ring (JSX), huts, lamps, penguins on the ice.
  for (let i = 0; i < 4; i++) {
    const a = 0.6 + i * 1.5
    const x = LAKE.x + Math.cos(a) * (LAKE.r - 6)
    const z = LAKE.z + Math.sin(a) * (LAKE.r - 6)
    world.cabins.push({ x, y: LAKE.y - 0.3, z, ry: a + Math.PI, w: 3.2, d: 3.4, h: 2.6, color: i === 0 ? ICE.coral : ICE.cream })
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    world.lamps.push({ x: LAKE.x + Math.cos(a) * (LAKE.r + 2), y: height(LAKE.x + Math.cos(a) * (LAKE.r + 2), LAKE.z + Math.sin(a) * (LAKE.r + 2)), z: LAKE.z + Math.sin(a) * (LAKE.r + 2) })
  }
  penguinGroup(world, LAKE.x + 4, LAKE.z + 2, 6, 12, rnd, true)

  // Glacier head: crystal spires along the wall's top, the camp above, penguins on the fjord ice.
  crystalCluster(world, rnd, bayCentre(-90) - 16, -92, 8, 12, 1.4)
  crystalCluster(world, rnd, bayCentre(-90) + 18, -94, 7, 10, 1.2)
  camp(world, rnd, bayCentre(-104), -106, 5, 3)
  penguinGroup(world, bayCentre(-40), -40, 9, 18, rnd)
  penguinGroup(world, bayCentre(-56) + 6, -58, 5, 9, rnd, true)
  for (let i = 0; i < 8; i++) world.seals.push({ x: bayCentre(-30) + (rnd() - 0.5) * 30, y: 1.9, z: -24 - rnd() * 30, ry: rnd() * Math.PI * 2 })

  // Research islet: a small station, boardwalk to the east shore.
  station(world, rnd, ISLET.x - 2, ISLET.y, ISLET.z, 0.4, 3)
  deck(world, ISLET.x + 13, ISLET.y, ISLET.z, bayCentre(112) + bayHalfWidth(112) + 1, 1.9, 112, 2.6, 7, -2.5)
  penguinGroup(world, ISLET.x - 8, ISLET.z + 8, 4, 7, rnd)

  // Mouth: penguins on the lighthouse rock, floes in the bay head and off the mouth, seals.
  penguinGroup(world, ROCK.x + 2, ROCK.z - 3, 4, 6, rnd)
  floeField(world, rnd, -60, 70, FREEZE_Z, 40, 40, (x, z) => Math.abs(x - bayCentre(z)) < bayHalfWidth(z) - 2)
  floeField(world, rnd, -150, 150, 150, 165, 24)
  floeField(world, rnd, -50, 60, 90, 150, 22, (x, z) => Math.abs(x - bayCentre(z)) < bayHalfWidth(z) - 2 && !within(x, z, ISLET.x, ISLET.z, ISLET.r + 6))

  // Shore life and plaza lamps.
  penguinGroup(world, bayCentre(50) + bayHalfWidth(50) + 3, 50, 5, 10, rnd)
  penguinGroup(world, bayCentre(30) - bayHalfWidth(30) - 4, 30, 5, 9, rnd)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    world.lamps.push({ x: PLAZA.x + Math.cos(a) * 11, y: height(PLAZA.x + Math.cos(a) * 11, PLAZA.z + Math.sin(a) * 11), z: PLAZA.z + Math.sin(a) * 11 })
  }
  return world
}

/** Lighthouse sweep and bobbing floes: the scene's one `useFrame`. */
function NightSweep({ night }: { night: boolean }) {
  const sweep = useRef<THREE.Mesh>(null)
  const cone = useMemo(() => sweepGeometry(), [])
  useEffect(() => () => cone.dispose(), [cone])
  useFrame(({ clock }) => {
    if (sweep.current) sweep.current.rotation.y = clock.elapsedTime * 0.9
  })
  if (!night) return null
  return (
    <mesh ref={sweep} position={[ROCK.x, ROCK.y + 0.3 + 7.3 * 3, ROCK.z]} geometry={cone}>
      <Surf color={ICE.light} emissive={ICE.light} emissiveIntensity={0.9} transparent opacity={0.16} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function FjordScene({ night, seed }: BlockoutSceneProps) {
  const world = useMemo(() => buildFjord(seed), [seed])
  return (
    <group>
      <WorldMeshes world={world} night={night} />
      <Lighthouse x={ROCK.x} y={ROCK.y + 0.3} z={ROCK.z} s={3} night={night} />
      <NightSweep night={night} />
      <IceArch x={ARCH.x} y={-1} z={ARCH.z} yaw={ARCH.yaw} span={ARCH.span} tube={3.4} />
      <Church x={CHURCH.x} y={world.height(CHURCH.x, CHURCH.z) - 0.3} z={CHURCH.z} yaw={-0.6} night={night} />
      <LitTree x={PLAZA.x} y={world.height(PLAZA.x, PLAZA.z)} z={PLAZA.z} night={night} />
      <SkatingRing x={LAKE.x} y={LAKE.y} z={LAKE.z} r={7} />
      <Mast x={ISLET.x + 6} y={ISLET.y} z={ISLET.z - 6} h={18} night={night} />
      <Whale x={12} z={100} yaw={0.6} />
    </group>
  )
}

export const FJORD_POSES: readonly Pose[] = [
  { id: 'hero', position: [26, 52, 252], target: [10, 6, -4], fov: 36 },
  { id: 'walk', position: [66, 9, 110], target: [62, 11, 40], fov: 48 },
  { id: 'overview', position: [0, 185, 255], target: [0, 6, -10], fov: 36 },
  { id: 'reverse', position: [-10, 72, -120], target: [14, 0, 140], fov: 36 },
]
