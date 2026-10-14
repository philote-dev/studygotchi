import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Glow, Surf } from '../../render/materials'
import type { BlockoutSceneProps } from '../types'
import {
  BOX,
  BULB,
  CONE8,
  CYL6,
  CYL8,
  Colored,
  Ground,
  Inst,
  Mission,
  PYRAMID,
  RailLine,
  Readout,
  ROCK,
  SCRUB,
  Strip,
  Terrain,
  Town,
  Train,
  Wheel,
  building,
  depot,
  farButtes,
  fence,
  headframe,
  lamps,
  pueblo,
  saguaros,
  street,
  telegraph,
  townItems,
  useGeo,
  wagons,
  waterTower,
  windpump,
  type ColorItem,
} from './kit'
import { PAL, blobDistance, fbm, heightfield, lerp, makePath, range, ribbon, rng, segment, smoothstep, terrace, vnoise, yawToward, type Item, type Vec3 } from './lib'

/**
 * Direction A, "Mesa Crown": the town rides a stratified mesa 50 m above the canyon floor.
 * Datum: the mesa-top main street is y = 10 so street-level cameras stay under the harness
 * limit; the canyon floor is y = -40. Switchbacks climb the south-west talus apron, an aerial
 * lift climbs the sheer south-east prow from the railhead, and the mission bell tower crowns
 * the north-west point.
 */

const FLOOR = -40
const TOP = 10
const BENCH = -16
const RAIL_X = 92
const MESA = { cx: -10, cz: -20, a: 66, b: 44, yaw: 0.611 }
/** Long axis (toward the north-west prow) and short axis (toward the north-east flank). */
const U: readonly [number, number] = [-Math.cos(MESA.yaw), -Math.sin(MESA.yaw)]
const V: readonly [number, number] = [Math.sin(MESA.yaw), -Math.cos(MESA.yaw)]
const APRON_AZ = Math.atan2(-V[1], -V[0])

const TERRAIN_COLORS = [PAL.sand, PAL.sandDeep, PAL.gravel, PAL.rock, PAL.strata, PAL.rockDark, PAL.ledge, PAL.pasture] as const

/** Plan point `t` metres along the mesa spine, `side` metres toward the north-east flank. */
function along(t: number, side = 0): readonly [number, number] {
  return [MESA.cx + U[0] * t + V[0] * side, MESA.cz + U[1] * t + V[1] * side]
}
const at = ([x, z]: readonly [number, number], y: number): Vec3 => [x, y, z]

function buildWorld(seed: number) {
  const r = rng(seed * 7919 + 11)
  const wobble = seed % 97

  const apronWeight = (x: number, z: number) => {
    const phi = Math.atan2(z - MESA.cz, x - MESA.cx)
    return smoothstep(Math.cos(0.95), 1, Math.cos(phi - APRON_AZ))
  }
  const wallWidth = (x: number, z: number) => lerp(18, 60, apronWeight(x, z))
  const mesaDist = (x: number, z: number) => blobDistance(x, z, MESA.cx, MESA.cz, MESA.a, MESA.b, MESA.yaw, 0.06, wobble)

  // Switchback road: five legs across the talus apron, canyon floor to rim.
  const roadPts: Vec3[] = []
  const legs = 5
  for (let i = 0; i < legs; i++) {
    for (let k = 0; k <= 12; k++) {
      const s = k / 12
      const phi = APRON_AZ + 0.4 * (2 * s - 1) * (i % 2 ? -1 : 1)
      const frac = (i + s) / legs
      const px = MESA.cx + Math.cos(phi) * 100
      const pz = MESA.cz + Math.sin(phi) * 100
      const radius = 100 - mesaDist(px, pz)
      const d = wallWidth(px, pz) * (1 - frac) - 4 * frac
      roadPts.push([MESA.cx + Math.cos(phi) * (radius + d), lerp(FLOOR + 2, TOP, smoothstep(0, 1, frac)), MESA.cz + Math.sin(phi) * (radius + d)])
    }
  }
  const road = makePath(roadPts)
  const foot = roadPts[0]
  const wash = makePath([
    [-120, FLOOR, 175],
    [-70, FLOOR, 128],
    [-20, FLOOR, 100],
    [35, FLOOR, 80],
    [78, FLOOR, 52],
    [118, FLOOR, 8],
    [150, FLOOR, -45],
    [175, FLOOR, -110],
  ])
  const benchRamp = makePath([
    [-104, BENCH, 112],
    [-80, lerp(BENCH, FLOOR, 0.5), 126],
    [-52, FLOOR + 0.5, 140],
  ])
  const floorRoad = makePath([
    [foot[0], FLOOR, foot[2]],
    [-10, FLOOR, 92],
    [40, FLOOR, 70],
    [72, FLOOR, 52],
  ])
  const waterhole: readonly [number, number] = [-128, 86]

  const height = (x: number, z: number): number => {
    let y = FLOOR + 2 * fbm(x * 0.013 + 3, z * 0.013, wobble + 5)
    const benchEdge = -84 + 12 * (vnoise(z * 0.018, 0.5, wobble + 3) - 0.5) * 2
    const benchT = smoothstep(benchEdge + 14, benchEdge - 14, x)
    y = Math.max(y, terrace(FLOOR + (BENCH - FLOOR) * benchT, 8, 0.75))
    const northT = smoothstep(-108, -165, z) * smoothstep(70, 10, x)
    y = Math.max(y, terrace(FLOOR + 24 * northT, 8, 0.7))
    const butte = blobDistance(x, z, -112, -128, 40, 28, 0.35, 0.08, wobble + 9)
    y = Math.max(y, terrace(lerp(y, 38, smoothstep(22, -2, butte)), 8, 0.8))
    const butte2 = blobDistance(x, z, 62, -150, 30, 22, -0.4, 0.08, wobble + 13)
    y = Math.max(y, terrace(lerp(y, 4, smoothstep(16, -2, butte2)), 8, 0.8))
    const rise = blobDistance(x, z, 136, 86, 12, 10, 0.2, 0.1, wobble + 17)
    y = Math.max(y, terrace(lerp(y, -22, smoothstep(10, -2, rise)), 6, 0.8))
    const d = mesaDist(x, z)
    const w = wallWidth(x, z)
    const wall = FLOOR + (TOP - FLOOR) * smoothstep(w, 0, d)
    const toe = FLOOR + 5 * smoothstep(w + 16, w - 4, d)
    y = Math.max(y, toe, d < -2 ? TOP + 0.5 * (fbm(x * 0.05, z * 0.05, wobble + 1) - 0.5) : terrace(wall, 8, 0.78))
    const wd = wash.nearest(x, z)
    if (wd.d < 14 && y < FLOOR + 6) y -= 2.4 * smoothstep(14, 4, wd.d)
    const hole = Math.hypot((x - waterhole[0]) / 12, (z - waterhole[1]) / 8.5)
    if (hole < 1.6) y = Math.min(y, BENCH - 1.6 * smoothstep(1.6, 0.7, hole))
    const railD = Math.abs(x - RAIL_X)
    if (railD < 9) y = lerp(y, FLOOR + 0.6, smoothstep(9, 4, railD))
    const rd = road.nearest(x, z)
    if (rd.d < 9) y = lerp(y, rd.y, smoothstep(9, 3.4, rd.d))
    const br = benchRamp.nearest(x, z)
    if (br.d < 10) y = lerp(y, br.y, smoothstep(10, 4, br.d))
    return y
  }

  const paint = (x: number, z: number, y: number, ny: number): number => {
    if (ny < 0.5) return 3 + ((Math.floor((y - FLOOR) / 8) % 3) + 3) % 3
    if (ny < 0.8) return 1
    if (y > TOP - 1.5) return 0
    if (wash.nearest(x, z).d < 8 && y < FLOOR + 3) return 2
    if (Math.hypot(x - waterhole[0], z - waterhole[1]) < 34 && y > BENCH - 3) return 7
    if (y > FLOOR + 3.5 && y < BENCH - 2) return 6
    if (y > BENCH + 3 && y < TOP - 1.5) return 6
    return vnoise(x * 0.06, z * 0.06, wobble + 21) > 0.64 ? 1 : 0
  }

  // Main street along the mesa spine: plaza and lift at the south-east end, mission at the prow.
  const streetPath = makePath([at(along(-50), TOP), at(along(30), TOP)])
  const buildings = street(r, streetPath, {
    side: 0,
    setback: 6.5,
    gap: [1.5, 4],
    width: [7, 11],
    depth: [8, 12],
    height: [5.5, 9],
    colors: [PAL.teal, PAL.sage, PAL.timber, PAL.cream, PAL.sage, PAL.timber],
    roofColors: [PAL.timberDark, PAL.timber],
    roof: 'false',
    from: 0.14,
    to: 0.97,
    heightAt: () => TOP,
  })
  const saloonAt = along(-28, 12.5)
  buildings.push(building(saloonAt[0], saloonAt[1], TOP, yawToward(-V[0], -V[1]), 13, 12, 10, PAL.oxblood, 'false', PAL.oxblood, true))
  const town = townItems(buildings)

  const pa = along(10, 33)
  const pb = along(-16, -31)
  const puebloA = pueblo(r, pa[0], TOP, pa[1], yawToward(-V[0], -V[1]) + Math.PI, 3, 34)
  const puebloB = pueblo(r, pb[0], TOP, pb[1], yawToward(V[0], V[1]) + Math.PI, 2, 26)
  const puebloBlocks = [...puebloA.blocks, ...puebloB.blocks]
  const puebloLadders = [...puebloA.ladders, ...puebloB.ladders]

  const towerAt = along(-48, 13)
  const tower = waterTower(towerAt[0], TOP, towerAt[1], 11)

  // Aerial lift: lower station by the railhead, upper station on the prow.
  const liftLow: Vec3 = [74, height(74, 38) + 0.2, 38]
  const liftTop: Vec3 = [40, TOP, 15]
  const cableA: Vec3 = [liftLow[0], liftLow[1] + 9, liftLow[2]]
  const cableB: Vec3 = [liftTop[0], liftTop[1] + 7, liftTop[2]]
  const liftTimber: Item[] = [
    segment([liftLow[0] - 3, liftLow[1], liftLow[2] - 3], [liftLow[0], liftLow[1] + 9.5, liftLow[2]], 0.5),
    segment([liftLow[0] + 3, liftLow[1], liftLow[2] - 3], [liftLow[0], liftLow[1] + 9.5, liftLow[2]], 0.5),
    segment([liftLow[0], liftLow[1], liftLow[2] + 3.5], [liftLow[0], liftLow[1] + 9.5, liftLow[2]], 0.5),
    { p: [liftTop[0], liftTop[1] + 3.5, liftTop[2]], s: [7, 7, 7], yaw: 0.4 },
    { p: [liftTop[0], liftTop[1] + 7.6, liftTop[2]], s: [8.5, 1.2, 8.5], yaw: 0.4 },
  ]
  const cables: Item[] = [-1.3, 1.3].map((o) => segment([cableA[0] + o, cableA[1], cableA[2] - o], [cableB[0] + o, cableB[1], cableB[2] - o], 0.18))

  // Railhead: depot, freight shed, signal tower, water crane; main line and the mine spur.
  const station = depot(80, height(80, 62), 62, Math.PI / 2, 24)
  const freight: ColorItem[] = [
    { p: [76, height(76, 90) + 2.4, 90], s: [12, 4.8, 9], yaw: 0, color: PAL.timber },
    { p: [84, height(84, 100) + 3.4, 100], s: [3, 6.8, 3], yaw: 0, color: PAL.timberDark },
    { p: [84, height(84, 100) + 7.4, 100], s: [3.6, 1.2, 3.6], yaw: 0, color: PAL.mustard },
    { p: [RAIL_X + 7, FLOOR + 3.2, 46], s: [1.4, 5.2, 1.4], yaw: 0, color: PAL.timberDark },
    { p: [RAIL_X + 7, FLOOR + 5.8, 46], s: [2.4, 1, 2.4], yaw: 0, color: PAL.iron },
  ]
  const rail = makePath([
    [RAIL_X, FLOOR + 0.6, -185],
    [RAIL_X, FLOOR + 0.6, 185],
  ])
  const spur = makePath([
    [RAIL_X - 2, FLOOR + 0.6, -60],
    [60, FLOOR + 0.6, -72],
    [36, height(36, -78) + 0.3, -78],
  ])

  // Mine against the north-east flank.
  const mine = headframe(32, height(32, -80), -80, yawToward(-V[0], -V[1]) + Math.PI, 12)
  const mineBoxes: ColorItem[] = [
    ...mine.shed,
    { p: [46, height(46, -92) + 1, -92], s: [16, 2.2, 10], yaw: 0.4, color: PAL.sandDeep },
    { p: [44, height(44, -66) + 1.6, -66], s: [5, 3.2, 4], yaw: 0.2, color: PAL.copper },
  ]

  // Ranch on the west bench.
  const ranchBuildings = [
    building(-112, 54, height(-112, 54), 0.4, 12, 9, 4.5, PAL.cream, 'gable', PAL.oxblood, true),
    building(-134, 58, height(-134, 58), 0.4, 14, 10, 7, PAL.oxblood, 'gable', PAL.timberDark),
    building(-150, 76, height(-150, 76), 0.2, 7, 6, 3.5, PAL.timber, 'gable', PAL.timberDark),
  ]
  const ranchTown = townItems(ranchBuildings)
  const corrals = [
    fence([[-150, 0, 98], [-128, 0, 98], [-128, 0, 116], [-150, 0, 116], [-150, 0, 98]], height),
    fence([[-124, 0, 102], [-104, 0, 102], [-104, 0, 118], [-124, 0, 118], [-124, 0, 102]], height),
    fence([[-156, 0, 40], [-156, 0, 70], [-134, 0, 78]], height),
  ]
  const corralPosts = corrals.flatMap((c) => c.posts)
  const corralRails = corrals.flatMap((c) => c.rails)
  const pump = windpump(-104, height(-104, 78), 78, 9, 0.8)
  const cattle: ColorItem[] = []
  for (let i = 0; i < 16; i++) {
    const x = range(r, -148, -106)
    const z = range(r, 100, 115)
    cattle.push({ p: [x, height(x, z) + 0.7, z], s: [1.7, 1.1, 0.7], yaw: r() * Math.PI, color: r() < 0.6 ? PAL.cattle : PAL.cattlePale })
  }

  // Archaeology dig on the canyon floor, in the wash bend.
  const dig: ColorItem[] = []
  for (let i = 0; i < 6; i++) {
    const x = -44 + (i % 3) * 11
    const z = 104 + Math.floor(i / 3) * 10
    const y = height(x, z)
    dig.push({ p: [x, y + 0.5, z], s: [8, 1, 0.8], yaw: 0.2, color: PAL.adobeDark })
    dig.push({ p: [x, y + 0.5, z], s: [0.8, 1, 7], yaw: 0.2, color: PAL.adobeDark })
    dig.push({ p: [x + 5, y + 0.05, z - 5], s: [9, 0.1, 2.2], yaw: 0.2, color: PAL.timberDark })
  }
  const tents: Item[] = [0, 1, 2].map((i): Item => ({ p: [-8 + i * 9, height(-8 + i * 9, 124) + 1.6, 124 + (i % 2) * 5], s: [6, 3.4, 6], yaw: 0.6 + i * 0.4 }))

  // Reserve east of the rail; lookout rise at its heart.
  const reserveSpots: Vec3[] = []
  const scrubSpots: ColorItem[] = []
  const rocks: ColorItem[] = []
  let guard = 0
  while (reserveSpots.length < 34 && guard++ < 600) {
    const x = range(r, 104, 172)
    const z = range(r, -150, 165)
    if (Math.hypot(x - 136, z - 86) < 20 || wash.nearest(x, z).d < 9) continue
    if (reserveSpots.some((s) => Math.hypot(s[0] - x, s[2] - z) < 9)) continue
    reserveSpots.push([x, height(x, z) - 0.2, z])
  }
  for (let i = 0; i < 70; i++) {
    const x = range(r, 100, 176)
    const z = range(r, -170, 170)
    const y = height(x, z)
    if (y > FLOOR + 6) continue
    scrubSpots.push({ p: [x, y + 0.4, z], s: [range(r, 1.2, 2.4), range(r, 0.8, 1.4), range(r, 1.2, 2.4)], yaw: r() * 3, color: r() < 0.7 ? PAL.scrub : PAL.sage })
  }
  for (let i = 0; i < 40; i++) {
    const x = range(r, -170, 176)
    const z = range(r, -175, 175)
    const y = height(x, z)
    if ((y > FLOOR + 7 && Math.abs(y - BENCH) > 3) || mesaDist(x, z) < wallWidth(x, z) + 6) continue
    const s = range(r, 1.4, 4.2)
    rocks.push({ p: [x, y + s * 0.25, z], s: [s, s * 0.7, s * range(r, 0.7, 1.3)], yaw: r() * 3, color: r() < 0.5 ? PAL.gravel : PAL.strata })
  }
  const lookoutY = height(136, 86)
  const lookout: Item[] = [
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([lx, lz]) => segment([136 + lx * 2.6, lookoutY, 86 + lz * 2.6], [136 + lx * 1.2, lookoutY + 11, 86 + lz * 1.2], 0.36)),
    { p: [136, lookoutY + 11, 86], s: [5, 0.5, 5], yaw: 0 },
    { p: [136, lookoutY + 13.6, 86], s: [5.6, 0.4, 5.6], yaw: 0 },
  ]

  const lampSpots: Vec3[] = []
  for (let i = 0; i < 7; i++) for (const side of [-1, 1]) lampSpots.push(at(along(-44 + i * 12, side * 5.4), TOP))
  lampSpots.push([liftLow[0] + 6, liftLow[1], liftLow[2] + 4], [84, height(84, 72), 72], [26, height(26, -88), -88])
  const lamp = lamps(lampSpots)
  const poles = telegraph(rail, height, -8, 26)
  const mid = floorRoad.at(0.5).p
  const cartA = along(-12, -7)
  const carts = wagons([
    { p: [mid[0], height(mid[0], mid[2] + 5), mid[2] + 5], yaw: 1.2, covered: true },
    { p: at(cartA, TOP), yaw: 0.9, covered: false },
    { p: [-116, height(-116, 66), 66], yaw: 2.2, covered: true },
  ])

  const horizon = farButtes(FLOOR, [
    [-260, -300, 46, 70],
    [-360, -120, 38, 54],
    [200, -340, 42, 60],
    [340, -200, 30, 44],
    [-330, 160, 28, 40],
    [-120, -330, 40, 62],
  ])

  return {
    height,
    paint,
    roadPts,
    wash,
    floorRoad,
    benchRamp,
    streetPath,
    town,
    puebloBlocks,
    puebloLadders,
    tower,
    liftTimber,
    cables,
    cableA,
    cableB,
    station,
    freight,
    rail,
    spur,
    mine,
    mineBoxes,
    ranchTown,
    corralPosts,
    corralRails,
    pump,
    cattle,
    dig,
    tents,
    reserve: saguaros(r, reserveSpots),
    scrubSpots,
    rocks,
    lookout,
    lookoutY,
    lamp,
    poles,
    carts,
    horizon,
    waterhole,
    missionAt: along(46),
  }
}

export function MesaCrownScene({ night, seed }: BlockoutSceneProps) {
  const world = useMemo(() => buildWorld(seed), [seed])
  const terrain = useGeo(() => heightfield({ size: 370, segments: 132, height: world.height, paint: world.paint, materialCount: TERRAIN_COLORS.length }), [world])
  const switchbacks = useGeo(() => ribbon(world.roadPts, 5, 0.3), [world])
  const floorRoad = useGeo(() => ribbon(world.floorRoad.points, 5, 0.25, world.height), [world])
  const benchRamp = useGeo(() => ribbon(world.benchRamp.points, 5, 0.25, world.height), [world])
  const streetGeo = useGeo(() => ribbon(world.streetPath.points, 9, 0.12), [world])
  const walkLeft = useGeo(() => ribbon(world.streetPath.points.map(([x, y, z]): Vec3 => [x + V[0] * 5.6, y, z + V[1] * 5.6]), 2.4, 0.3), [world])
  const walkRight = useGeo(() => ribbon(world.streetPath.points.map(([x, y, z]): Vec3 => [x - V[0] * 5.6, y, z - V[1] * 5.6]), 2.4, 0.3), [world])
  const washGeo = useGeo(() => ribbon(world.wash.points, 6, -1.4, world.height), [world])
  const cabinA = useRef<THREE.Group>(null)
  const cabinB = useRef<THREE.Group>(null)
  const train = useRef<THREE.Group>(null)
  const wheels = useRef<THREE.Object3D[]>([])

  useFrame((state, delta) => {
    const t = (state.clock.elapsedTime * 0.045) % 1
    const u = 0.5 - 0.5 * Math.cos(t * Math.PI * 2)
    const ride = (k: number, o: number): Vec3 => [
      lerp(world.cableA[0], world.cableB[0], k) + o,
      lerp(world.cableA[1], world.cableB[1], k) - 2.4,
      lerp(world.cableA[2], world.cableB[2], k) - o,
    ]
    const pa = ride(u, -1.3)
    const pb = ride(1 - u, 1.3)
    cabinA.current?.position.set(pa[0], pa[1], pa[2])
    cabinB.current?.position.set(pb[0], pb[1], pb[2])
    const tt = (state.clock.elapsedTime * 0.02 + 0.3) % 1
    const { p, dir } = world.rail.at(tt)
    if (train.current) {
      train.current.position.set(p[0], p[1] + 0.2, p[2])
      train.current.rotation.y = Math.atan2(dir[0], dir[1])
    }
    for (const wheel of wheels.current) wheel.rotation.z += delta * 0.9
  })

  return (
    <group>
      <Readout label="mesa-crown" />
      <Ground y={FLOOR - 0.8} color={PAL.sand} />
      <Terrain geometry={terrain} colors={TERRAIN_COLORS} />
      <Colored geometry={CYL6} items={world.horizon} shadow={false} />

      <Strip geometry={switchbacks} color={PAL.road} />
      <Strip geometry={floorRoad} color={PAL.road} />
      <Strip geometry={benchRamp} color={PAL.road} />
      <Strip geometry={streetGeo} color={PAL.roadDark} />
      <Strip geometry={walkLeft} color={PAL.plank} />
      <Strip geometry={walkRight} color={PAL.plank} />
      <Strip geometry={washGeo} color={PAL.gravel} />
      <mesh position={[world.waterhole[0], BENCH - 0.9, world.waterhole[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[11, 14]} />
        <Surf color={PAL.water} transparent opacity={0.9} />
      </mesh>

      <RailLine path={world.rail} heightAt={world.height} />
      <RailLine path={world.spur} heightAt={world.height} />
      <Train groupRef={train} night={night} cars={4} />
      <Inst geometry={BOX} items={world.poles}>
        <Surf color={PAL.timberDark} />
      </Inst>

      <Town items={world.town} night={night} />
      <Mission x={world.missionAt[0]} y={TOP} z={world.missionAt[1]} yaw={yawToward(-U[0], -U[1])} night={night} towerH={24} />
      <Colored geometry={BOX} items={world.puebloBlocks} />
      <Inst geometry={BOX} items={world.puebloLadders}>
        <Surf color={PAL.plank} />
      </Inst>
      <Inst geometry={BOX} items={world.tower.timber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Inst geometry={CYL8} items={world.tower.tank}>
        <Surf color={PAL.timber} />
      </Inst>
      <Inst geometry={CONE8} items={world.tower.roof}>
        <Surf color={PAL.oxblood} />
      </Inst>

      <Inst geometry={BOX} items={world.liftTimber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Inst geometry={BOX} items={world.cables} shadow={false}>
        <Surf color={PAL.iron} />
      </Inst>
      {[cabinA, cabinB].map((ref, i) => (
        <group key={i} ref={ref}>
          <mesh geometry={BOX} position={[0, 1.2, 0]} scale={[0.3, 2.4, 0.3]}>
            <Surf color={PAL.iron} />
          </mesh>
          <mesh geometry={BOX} position={[0, -1.4, 0]} scale={[3, 2.8, 2.4]} castShadow>
            <Surf color={i ? PAL.oxblood : PAL.teal} />
          </mesh>
          <mesh geometry={BOX} position={[0, -1.1, 0]} scale={[3.2, 1, 2.6]}>
            <Glow color={PAL.lamp} on={night} />
          </mesh>
        </group>
      ))}

      <Colored geometry={BOX} items={world.station.walls} />
      <Colored geometry={BOX} items={world.station.roofs} />
      <Inst geometry={BOX} items={world.station.timber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Inst geometry={BOX} items={world.station.windows} shadow={false}>
        <Glow color={PAL.lamp} on={night} />
      </Inst>
      <Colored geometry={BOX} items={world.freight} />

      <Inst geometry={BOX} items={world.mine.timber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Colored geometry={BOX} items={world.mineBoxes} />
      <Inst geometry={BOX} items={world.mine.adit}>
        <Surf color="#241a18" />
      </Inst>

      <Town items={world.ranchTown} night={night} />
      <Inst geometry={BOX} items={world.corralPosts}>
        <Surf color={PAL.timber} />
      </Inst>
      <Inst geometry={BOX} items={world.corralRails} shadow={false}>
        <Surf color={PAL.plank} />
      </Inst>
      <Inst geometry={BOX} items={world.pump.timber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Wheel at={world.pump.head} yaw={0.8} radius={2.2} refs={wheels} />
      <Colored geometry={BOX} items={world.cattle} />

      <Colored geometry={BOX} items={world.dig} />
      <Inst geometry={PYRAMID} items={world.tents}>
        <Surf color={PAL.canvas} />
      </Inst>

      <Inst geometry={CYL6} items={world.reserve}>
        <Surf color={PAL.cactus} />
      </Inst>
      <Colored geometry={SCRUB} items={world.scrubSpots} shadow={false} />
      <Colored geometry={ROCK} items={world.rocks} />
      <Inst geometry={BOX} items={world.lookout}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <mesh geometry={BULB} position={[136, world.lookoutY + 12.4, 86]}>
        <Glow color={PAL.lamp} on={night} />
      </mesh>

      <Inst geometry={BOX} items={world.lamp.posts}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Inst geometry={BOX} items={world.lamp.heads} shadow={false}>
        <Glow color={PAL.lamp} on={night} />
      </Inst>
      <Inst geometry={BOX} items={world.carts.timber}>
        <Surf color={PAL.timber} />
      </Inst>
      <Inst geometry={BOX} items={world.carts.canvas}>
        <Surf color={PAL.canvas} />
      </Inst>
      <Inst geometry={CYL8} items={world.carts.wheels} shadow={false}>
        <Surf color={PAL.timberDark} />
      </Inst>
    </group>
  )
}
