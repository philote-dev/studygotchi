/**
 * Direction C — Expedition coast. The arctic research slab as the civic centre: a squarish ice
 * slab just off a long snow coast, red modules on stilts along a walkway, the mast, the helipad,
 * the icebreaker frozen into a lead beside it. The sea in front is frozen and cracked into dark
 * leads with floes, seals and a whale surfacing in the open channel; a village of cabins runs
 * along the shore on two lanes, the frozen lake sits inland, pine drifts climb the ridge, the
 * glacier spills onto the coast in the west with the ice arch in front of it and a glowing crystal
 * cave bitten into its wall, the lighthouse stands on the east point, rounded mountains behind.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Glow, Surf } from '../../render/materials'
import type { BlockoutSceneProps, Pose } from '../types'
import { GEO, Helipad, ICE, IceArch, Icebreaker, Lighthouse, Mast, SkatingRing, Whale, WorldMeshes, iceFacet } from './kit'
import { fbm, lerp, mulberry32, polylineDistance, ridged, segmentProject, smoothstep, wobble } from './noise'
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

export const SLAB: Plate = { x: 6, z: 56, r: 30, y: 5, power: 4, wobble: 0.04 }
export const ROCK: Plate = { x: 140, z: 34, r: 10, y: 8, wobble: 0.2 }
export const LAKE = { x: 76, z: -40, r: 22, y: 5.2 }
const TONGUE = { ax: -128, az: -140, bx: -98, bz: 24, w: 46 }
const CAVE = { x: -86, z: 26, r: 7 }
const ARCH = { x: -62, z: 54, yaw: 0.25, span: 30 }
export const LEAD: ReadonlyArray<readonly [number, number]> = [
  [44, 28],
  [41, 56],
  [46, 90],
  [60, 130],
  [70, 170],
]
const LEAD_WIDTH = 14
const MOUNTAINS: Bump[] = [
  { x: -60, z: -165, r: 95, h: 84 },
  { x: 40, z: -175, r: 100, h: 92 },
  { x: 130, z: -150, r: 80, h: 64 },
  { x: -150, z: -130, r: 70, h: 56 },
  { x: 165, z: -110, r: 60, h: 46 },
]
export const coastZ = (x: number, seed: number) => 24 + wobble(x + 30, seed + 31, 0.012) * 10 - 30 * smoothstep(130, 165, x)
const frozenZ = (x: number, seed: number) => 80 + wobble(x - 50, seed + 33, 0.01) * 16
/** Lanes follow the (seeded) coastline at fixed distances inland, with cross lanes between them. */
function coastLanes(seed: number): Lane[] {
  const along = (inland: number, xFrom: number, xTo: number, width: number, wiggle: number): Lane => {
    const points: Array<[number, number]> = []
    for (let x = xFrom; x <= xTo; x += 16) points.push([x, coastZ(x, seed) - inland + wiggle * Math.sin(x / 23 + inland)])
    return { points, width }
  }
  const coast = along(14, -62, 126, 4, 2)
  const back = along(32, -56, 118, 3.4, 3)
  const cross = [-46, 6, 66, 108].map((x): Lane => ({ points: [[x, coastZ(x, seed) - 14], [x + 3, coastZ(x, seed) - 32]], width: 3 }))
  const ridge: Lane = { points: [[-10, -30], [20, -34], [50, -32], [80, -60], [110, -62]], width: 3 }
  return [coast, back, ...cross, ridge]
}

export function coastHeight(seed: number) {
  return (x: number, z: number): number => {
    const coast = coastZ(x, seed)
    let y: number
    if (z > coast) {
      // Sea: frozen and cracked near the shore, open water with a lead through it.
      const frozen = z < frozenZ(x, seed)
      const lead = polylineDistance(LEAD, x, z)
      if (frozen && lead > LEAD_WIDTH / 2) y = crackGap(x, z, 12, seed + 5) < 2.4 ? -1.2 : 0.6 + (fbm(x * 0.1, z * 0.1, seed + 1) - 0.5) * 0.3
      else y = SEA_FLOOR
    } else {
      const inland = coast - z
      y = 0.8 + 4.7 * smoothstep(0, 18, inland) + (fbm(x * 0.04, z * 0.04, seed + 2) - 0.5) * 1.2
      y += 20 * smoothstep(-45, -92, z)
    }
    const dL = Math.hypot(x - LAKE.x, z - LAKE.z)
    if (dL < LAKE.r) y = LAKE.y
    else if (dL < LAKE.r + 5) y = Math.max(y, lerp(LAKE.y + 0.6, y, smoothstep(LAKE.r, LAKE.r + 5, dL)))
    // Rounded mountains.
    if (z < -100) {
      const m = bumpHeight(MOUNTAINS, x, z)
      if (m > 1) y = Math.max(y, backFade(m + (ridged(x * 0.02, z * 0.02, seed + 3) - 0.5) * 4 * smoothstep(1, 16, m), z))
    }
    // Glacier tongue from the mountains to the coast, a 24 m wall at the water, a cave bitten in.
    const { t, d } = segmentProject(TONGUE.ax, TONGUE.az, TONGUE.bx, TONGUE.bz, x, z)
    const w = TONGUE.w * (1 - 0.2 * t)
    if (d < w && z < 30) {
      const crown = (24 + 30 * (1 - t)) * (1 - 0.45 * smoothstep(w * 0.55, w, d)) + (ridged(x * 0.05, z * 0.05, seed + 4) - 0.5) * 5
      y = Math.max(y, crown)
      if (within(x, z, CAVE.x, CAVE.z, CAVE.r)) y = 3
    }
    for (const p of [SLAB, ROCK]) if (plateInside(p, x, z, seed) > 0) y = Math.max(y, p.y + (fbm(x * 0.1, z * 0.1, seed + 6) - 0.5) * 0.3)
    return y
  }
}

function coastFacet(seed: number, lanes: readonly Lane[]) {
  return iceFacet({
    highLine: 30,
    mask: (cx, cz, cy, ny, h) => {
      if (ny < 0.8) return null
      if (within(cx, cz, LAKE.x, LAKE.z, LAKE.r)) return h < 0.5 ? ICE.lakeIce : ICE.lakeIceAlt
      if (cz > coastZ(cx, seed) && cy > -2 && cy < 2 && !plateInside(SLAB, cx, cz, seed)) return cy < 0 ? ICE.waterDeep : h < 0.5 ? ICE.paleIce : ICE.lakeIceAlt
      if (plateInside(SLAB, cx, cz, seed) > 3 && cy > 3) return ICE.paving
      if (cy > 0.6 && cy < 20 && laneDistance(lanes, cx, cz).d < 0) return ICE.paving
      return null
    },
  })
}

export function buildCoast(seed: number): WorldData {
  const height = coastHeight(seed)
  const LANES = coastLanes(seed)
  const field = buildHeightfield({ xMin: -165, xMax: 165, zMin: -195, zMax: 165, cell: 3, height, facet: coastFacet(seed, LANES) })
  const world = emptyWorld(field, height)
  const rnd = mulberry32(seed * 65537 + 41)
  const landOk = (x: number, z: number) => {
    const y = height(x, z)
    return y > 1.5 && y < 26 && !within(x, z, LAKE.x, LAKE.z, LAKE.r + 3) && z < coastZ(x, seed) - 3 && segmentProject(TONGUE.ax, TONGUE.az, TONGUE.bx, TONGUE.bz, x, z).d > TONGUE.w + 4
  }
  const flat = (x: number, z: number) => Math.abs(height(x + 3, z) - height(x - 3, z)) < 2.2 && Math.abs(height(x, z + 3) - height(x, z - 3)) < 2.2
  const ok = (x: number, z: number) => landOk(x, z) && flat(x, z)

  // The shore village: coast lane, back lane, cross lanes, infill; the pine-town lane on the ridge foot.
  for (const lane of LANES) laneCabins(world, lane, rnd, { spacing: 7.4, ok })
  scatterCabins(world, LANES, 30, -6, 100, 900, rnd, (x, z) => ok(x, z) && z > -24)
  scatterCabins(world, LANES, 40, -46, 80, 120, rnd, ok, [ICE.cream, ICE.blue, ICE.red, ICE.teal])

  // Piers out over the sea ice, boats pulled up in the leads near shore.
  pier(world, rnd, -36, coastZ(-36, seed) - 0.5, 0.1, 1, 22, 1.6, 0)
  pier(world, rnd, 84, coastZ(84, seed) - 0.5, -0.1, 1, 26, 1.6, 0)
  pier(world, rnd, 118, coastZ(118, seed) - 0.5, 0.3, 1, 18, 1.6, 0)
  for (let i = 0; i < 8; i++) {
    const t = rnd()
    const seg = Math.min(LEAD.length - 2, Math.floor(t * (LEAD.length - 1)))
    const f = t * (LEAD.length - 1) - seg
    const x = lerp(LEAD[seg][0], LEAD[seg + 1][0], f) + (rnd() - 0.5) * 4
    const z = lerp(LEAD[seg][1], LEAD[seg + 1][1], f)
    if (z > 70) world.boats.push({ x, z, ry: rnd() * Math.PI * 2, color: i % 2 === 0 ? ICE.red : ICE.blue })
  }

  // Research slab: station, bridges to the shore, lamps, penguins on the ice around it.
  station(world, rnd, SLAB.x - 4, SLAB.y, SLAB.z + 2, 0.08, 5)
  deck(world, SLAB.x - 14, SLAB.y, SLAB.z - 28, SLAB.x - 14, 2.4, coastZ(SLAB.x - 14, seed) - 2, 2.6, 7, -1)
  deck(world, SLAB.x + 18, SLAB.y, SLAB.z - 28, SLAB.x + 18, 2.4, coastZ(SLAB.x + 18, seed) - 2, 2.6, 7, -1)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    world.lamps.push({ x: SLAB.x + Math.cos(a) * 26, y: SLAB.y, z: SLAB.z + Math.sin(a) * 26 })
  }
  penguinGroup(world, SLAB.x - 36, SLAB.z + 10, 7, 14, rnd)
  penguinGroup(world, SLAB.x + 10, SLAB.z + 40, 6, 12, rnd, true)
  for (let i = 0; i < 12; i++) {
    const x = -60 + rnd() * 140
    const z = coastZ(x, seed) + 6 + rnd() * 60
    if (height(x, z) > 0 && polylineDistance(LEAD, x, z) > 8) world.seals.push({ x, y: 0.6, z, ry: rnd() * Math.PI * 2 })
  }

  // Lake: skating ring (JSX), huts, lamps, a penguin ring.
  for (let i = 0; i < 4; i++) {
    const a = 0.3 + i * 1.5
    world.cabins.push({ x: LAKE.x + Math.cos(a) * (LAKE.r - 5), y: LAKE.y - 0.3, z: LAKE.z + Math.sin(a) * (LAKE.r - 5), ry: a + Math.PI, w: 3.2, d: 3.4, h: 2.6, color: i === 1 ? ICE.coral : ICE.cream })
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const x = LAKE.x + Math.cos(a) * (LAKE.r + 2)
    const z = LAKE.z + Math.sin(a) * (LAKE.r + 2)
    world.lamps.push({ x, y: height(x, z), z })
  }
  penguinGroup(world, LAKE.x - 4, LAKE.z + 2, 6, 12, rnd, true)

  // Pines: drifts up the ridge, between the lanes, and along the glacier flank.
  const pineOk = (x: number, z: number) => landOk(x, z) && laneDistance(LANES, x, z).d > 2 && !world.cabins.some((c) => Math.hypot(c.x - x, c.z - z) < 4.6)
  for (const [cx, cz, r, n] of [
    [-30, -60, 24, 50],
    [10, -70, 26, 60],
    [50, -78, 26, 60],
    [100, -84, 24, 50],
    [136, -50, 22, 40],
    [130, -14, 18, 30],
    [-50, -34, 16, 26],
    [20, -22, 14, 18],
    [92, -20, 14, 18],
  ] as const) {
    pineDrift(world, cx, cz, r, n, rnd, pineOk)
  }
  for (let i = 0; i < 30; i++) {
    const x = -60 + rnd() * 190
    const z = -30 + rnd() * 50
    if (pineOk(x, z)) world.pines.push({ x, y: height(x, z) - 0.3, z, r: 1.6 + rnd(), h: 6 + rnd() * 4 })
  }

  // Glacier: crystal spires along the flank and in the cave, the camp at its foot.
  crystalCluster(world, rnd, TONGUE.bx + 30, -24, 9, 12, 1.3)
  crystalCluster(world, rnd, TONGUE.bx + 24, 4, 6, 8, 1)
  camp(world, rnd, -56, -28, 4, 3)
  penguinGroup(world, -70, 40, 6, 10, rnd)

  // Lighthouse rock on the east point, bridge from the shore.
  deck(world, 126, height(126, coastZ(126, seed) - 3) - 0.1, coastZ(126, seed) - 3, ROCK.x - 8, ROCK.y, ROCK.z - 2, 2.4, 7, -2)
  penguinGroup(world, ROCK.x - 4, ROCK.z + 3, 3, 5, rnd)

  // Open water beyond the ice: floes; a few shards on the ice edge.
  floeField(world, rnd, -160, 160, 60, 165, 90, (x, z) => z > frozenZ(x, seed) - 4 || polylineDistance(LEAD, x, z) < LEAD_WIDTH / 2 - 1)
  return world
}

/** The whale surfaces and sinks in the lead on a slow loop; the scene's one `useFrame`. */
function SurfacingWhale() {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    const t = clock.elapsedTime * 0.25
    group.current.position.y = -1.6 + Math.max(0, Math.sin(t)) * 1.8
  })
  return (
    <group ref={group}>
      <Whale x={52} z={108} yaw={Math.PI * 0.08} />
    </group>
  )
}

function CrystalCave({ night }: { night: boolean }) {
  return (
    <group position={[CAVE.x, 3, CAVE.z]}>
      {[
        [0, 0, 1.4, 5],
        [2.2, -1.6, 1, 3.6],
        [-2, 1.2, 1.1, 4.2],
        [1, 2.4, 0.8, 2.8],
      ].map(([ox, oz, s, h], i) => (
        <mesh key={i} position={[ox, 0, oz]} scale={[s, h, s]} rotation={[0.1 * i, i, -0.1 * i]}>
          <primitive object={GEO.spire} attach="geometry" />
          <Glow color={ICE.crystal} on={night} intensity={1.4} offColor={ICE.crystalDeep} />
        </mesh>
      ))}
      <mesh position={[0, 4, -2]}>
        <boxGeometry args={[10, 8, 0.6]} />
        <Surf color={ICE.plateSideDeep} />
      </mesh>
    </group>
  )
}

export function CoastScene({ night, seed }: BlockoutSceneProps) {
  const world = useMemo(() => buildCoast(seed), [seed])
  return (
    <group>
      <WorldMeshes world={world} night={night} />
      <Mast x={SLAB.x + 20} y={SLAB.y} z={SLAB.z + 18} h={26} night={night} />
      <Helipad x={SLAB.x - 16} y={SLAB.y} z={SLAB.z + 18} />
      <Icebreaker x={42} z={62} yaw={Math.PI * 1.02} night={night} />
      <Lighthouse x={ROCK.x} y={ROCK.y + 0.3} z={ROCK.z} s={3} night={night} />
      <IceArch x={ARCH.x} y={0.4} z={ARCH.z} yaw={ARCH.yaw} span={ARCH.span} tube={3.4} />
      <CrystalCave night={night} />
      <SkatingRing x={LAKE.x} y={LAKE.y - 0.3} z={LAKE.z} r={7} />
      <SurfacingWhale />
    </group>
  )
}

export const COAST_POSES: readonly Pose[] = [
  { id: 'hero', position: [170, 50, 200], target: [-20, 8, -20], fov: 36 },
  { id: 'walk', position: [-16, 9.8, 58], target: [40, 6, 64], fov: 48 },
  { id: 'overview', position: [0, 185, 250], target: [0, 4, -20], fov: 36 },
  { id: 'reverse', position: [20, 60, -120], target: [10, 0, 90], fov: 36 },
]
