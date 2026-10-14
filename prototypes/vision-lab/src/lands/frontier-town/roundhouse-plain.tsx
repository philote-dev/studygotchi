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
  type Building,
  type ColorItem,
} from './kit'
import { PAL, blobDistance, fbm, heightfield, lerp, makePath, range, ribbon, rng, segment, smoothstep, terrace, vnoise, yawToward, type Item, type Path, type Vec3 } from './lib'

/**
 * Direction C, "Roundhouse Plain": a rail-boom civilisation spread across the flats. Double
 * track, a roundhouse fanned around its turntable, three water towers, a coal tipple and a grain
 * elevator make the skyline; Main Street runs south from the depot plaza through a grid of
 * false fronts to the mission; the ranch grid fills the south-west, saguaro dunes the east, and
 * a pueblo steps up the mesa that closes the north.
 */

const RAIL_Z = -34
const TURNTABLE: readonly [number, number] = [86, -62]

const TERRAIN_COLORS = [PAL.sand, PAL.sandDeep, PAL.gravel, PAL.rock, PAL.strata, PAL.rockDark, PAL.ledge, PAL.pasture] as const

function buildWorld(seed: number) {
  const r = rng(seed * 2971 + 17)
  const s = seed % 83

  const arroyo = makePath([
    [-190, 0, 160],
    [-100, 0, 150],
    [-20, 0, 142],
    [60, 0, 128],
    [120, 0, 92],
    [165, 0, 34],
    [195, 0, -20],
  ])
  const spur = makePath([
    [-56, 0.6, -40],
    [-96, 0.6, -58],
    [-118, 0.6, -78],
  ])
  const waterhole: readonly [number, number] = [-80, 126]
  const duneMask = (x: number, z: number) => smoothstep(56, 96, x) * smoothstep(-24, 24, z)
  const ridge = (x: number, z: number) => 1 - Math.abs(vnoise(x * 0.035 + z * 0.012, z * 0.05, s + 9) - 0.5) * 2

  const height = (x: number, z: number): number => {
    let y = 2.2 * (fbm(x * 0.009 + 5, z * 0.009, s + 5) - 0.35)
    const dm = duneMask(x, z)
    if (dm > 0) {
      const rg = ridge(x, z)
      y += dm * 3.2 * rg * rg
    }
    const m1 = blobDistance(x, z, -40, -172, 72, 36, 0.05, 0.07, s + 11)
    y = Math.max(y, terrace(lerp(y, 34, smoothstep(26, -2, m1)), 7, 0.82))
    const m2 = blobDistance(x, z, 124, -156, 46, 28, -0.2, 0.07, s + 13)
    y = Math.max(y, terrace(lerp(y, 22, smoothstep(20, -2, m2)), 7, 0.82))
    const hill = blobDistance(x, z, -128, -106, 30, 22, 0.4, 0.1, s + 15)
    y = Math.max(y, terrace(lerp(y, 9, smoothstep(18, -2, hill)), 4.5, 0.6))
    const rise = blobDistance(x, z, 128, 100, 13, 11, 0.3, 0.1, s + 17)
    y = Math.max(y, terrace(lerp(y, 12, smoothstep(12, -2, rise)), 5, 0.8))
    const pad = smoothstep(-80, -66, x) * smoothstep(80, 66, x) * smoothstep(-36, -24, z) * smoothstep(108, 98, z)
    y = lerp(y, 0.5, pad)
    const railBand = Math.max(0, Math.abs(z - RAIL_Z - 3) - 9)
    y = lerp(y, 0.6, smoothstep(8, 0, railBand))
    const yard = Math.hypot(x - TURNTABLE[0], z - TURNTABLE[1])
    y = lerp(y, 0.6, smoothstep(54, 46, yard))
    const wd = arroyo.nearest(x, z)
    if (wd.d < 12 && y < 3) y -= 2.2 * smoothstep(12, 4, wd.d)
    const hole = Math.hypot((x - waterhole[0]) / 12, (z - waterhole[1]) / 8.5)
    if (hole < 1.6) y = Math.min(y, -1.8 * smoothstep(1.6, 0.7, hole))
    const sp = spur.nearest(x, z)
    if (sp.d < 7) y = lerp(y, 0.6, smoothstep(7, 3, sp.d))
    return y
  }

  const paint = (x: number, z: number, y: number, ny: number): number => {
    if (ny < 0.5) return 3 + ((Math.floor(y / 7) % 3) + 3) % 3
    if (ny < 0.8) return 1
    if (y > 29 || (y > 19 && y < 23)) return 0
    if (y > 4) return 6
    if (arroyo.nearest(x, z).d < 7 && y < 1) return 2
    if (Math.hypot(x - waterhole[0], z - waterhole[1]) < 30) return 7
    if (duneMask(x, z) > 0.3 && ridge(x, z) > 0.78) return 1
    return vnoise(x * 0.06, z * 0.06, s + 21) > 0.66 ? 1 : 0
  }
  const flat = () => 0.5

  // Main Street and three cross streets: a true grid south of the tracks.
  const mainPath = makePath([
    [0, 0.5, -10],
    [0, 0.5, 98],
  ])
  const crossZ = [20, 50, 80]
  const crossPaths: Path[] = crossZ.flatMap((z) => [
    makePath([
      [-64, 0.5, z],
      [-11, 0.5, z],
    ]),
    makePath([
      [11, 0.5, z],
      [64, 0.5, z],
    ]),
  ])
  const streetOpts = {
    side: 0 as const,
    setback: 6.5,
    gap: [1.5, 4] as const,
    width: [7, 11] as const,
    depth: [8, 12] as const,
    height: [5.5, 9] as const,
    colors: [PAL.teal, PAL.sage, PAL.timber, PAL.cream, PAL.sage, PAL.timber],
    roofColors: [PAL.timberDark, PAL.timber],
    roof: 'false' as const,
    heightAt: flat,
  }
  const buildings: Building[] = []
  const blocks: Array<[number, number]> = [
    [0.02, 0.26],
    [0.31, 0.54],
    [0.59, 0.82],
    [0.87, 0.99],
  ]
  for (const [from, to] of blocks) buildings.push(...street(r, mainPath, { ...streetOpts, from, to }))
  for (const path of crossPaths) {
    buildings.push(
      ...street(r, path, {
        ...streetOpts,
        setback: 5,
        gap: [2, 6],
        width: [6, 9],
        depth: [6, 9],
        height: [3.6, 6],
        roof: 'mixed',
        porch: false,
        from: 0.04,
        to: 0.96,
      }),
    )
  }
  buildings.push(building(16, 2, 0.5, -Math.PI / 2, 16, 14, 12, PAL.teal, 'false', PAL.timberDark, true))
  buildings.push(building(-14, 32, 0.5, Math.PI / 2, 13, 12, 10, PAL.oxblood, 'false', PAL.oxblood, true))
  const town = townItems(buildings)

  // Rail yard: double track, depot, grain elevator, three water towers, tipple, roundhouse.
  const main = makePath([
    [-195, 0.6, RAIL_Z],
    [195, 0.6, RAIL_Z],
  ])
  const second = makePath([
    [-195, 0.6, RAIL_Z - 6],
    [195, 0.6, RAIL_Z - 6],
  ])
  const station = depot(0, 0.5, -20, Math.PI, 30)
  const yardBoxes: ColorItem[] = [
    { p: [-64, 13.5, -52], s: [10, 26, 9], yaw: 0, color: PAL.cream },
    { p: [-64, 29.5, -52], s: [6, 6, 6], yaw: 0, color: PAL.cream },
    { p: [-52, 4, -52], s: [12, 8, 9], yaw: 0, color: PAL.timber },
    { p: [-64, 33.4, -52], s: [7, 1.8, 7], yaw: 0, color: PAL.oxblood },
    { p: [-34, 2.6, -48], s: [14, 5.2, 10], yaw: 0, color: PAL.timber },
    { p: [122, 9.6, -50], s: [8, 6, 6], yaw: 0, color: PAL.timberDark },
    { p: [96, 1.8, -44], s: [1.6, 2.6, 10], yaw: 0, color: PAL.iron },
    { p: [-48, 2.1, RAIL_Z - 6], s: [2.7, 3, 9.2], yaw: Math.PI / 2, color: PAL.timber },
    { p: [-59, 2.1, RAIL_Z - 6], s: [2.7, 3, 9.2], yaw: Math.PI / 2, color: PAL.teal },
    { p: [-70, 2.1, RAIL_Z - 6], s: [2.7, 3, 9.2], yaw: Math.PI / 2, color: PAL.oxblood },
  ]
  const yardTimber: Item[] = [
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([lx, lz]) => segment([122 + lx * 4, 0.6, -50 + lz * 3.4], [122 + lx * 3.2, 7, -50 + lz * 2.6], 0.4)),
    segment([122, 7.6, -46], [112, 2.8, RAIL_Z - 2], 1.2, 0.7),
  ]
  const towers = [40, 54, 68].map((x) => waterTower(x, 0.6, -52, 10))
  const towerTimber = towers.flatMap((t) => t.timber)
  const towerTanks = towers.flatMap((t) => t.tank)
  const towerRoofs = towers.flatMap((t) => t.roof)
  const stalls: Building[] = []
  const radial: Item[] = []
  for (let i = 0; i < 9; i++) {
    const theta = Math.PI + (Math.PI * (i + 0.5)) / 9
    const cx = TURNTABLE[0] + Math.cos(theta) * 30
    const cz = TURNTABLE[1] + Math.sin(theta) * 30
    stalls.push(building(cx, cz, 0.6, yawToward(-Math.cos(theta), -Math.sin(theta)), 7.6, 24, 7.5, PAL.oxblood, 'gable', PAL.timberDark))
    radial.push({ p: [TURNTABLE[0] + Math.cos(theta) * 13, 0.72, TURNTABLE[1] + Math.sin(theta) * 13], s: [1.6, 0.14, 9], yaw: yawToward(Math.cos(theta), Math.sin(theta)) })
  }
  radial.push({ p: [TURNTABLE[0], 0.9, TURNTABLE[1]], s: [2.4, 0.5, 18], yaw: 0.6 })
  const roundhouse = townItems(stalls)
  const lead: Path = makePath([
    [TURNTABLE[0] + 6, 0.6, RAIL_Z],
    [TURNTABLE[0] + 2, 0.6, RAIL_Z - 12],
    [TURNTABLE[0], 0.6, TURNTABLE[1] + 10],
  ])

  // Mission on its plaza west of Main Street; the plaza is the civic heart of the grid.
  const missionAt: Vec3 = [-30, 0.5, 66]

  // Ranch grid in the south-west: fields, corrals, two wind pumps, house and barn.
  const fields: ColorItem[] = []
  const fieldColors = [PAL.hay, PAL.pasture, PAL.sandDeep, PAL.sage, PAL.hay, PAL.pasture]
  for (let i = 0; i < 6; i++) {
    const x = -152 + (i % 3) * 30
    const z = 54 + Math.floor(i / 3) * 34
    fields.push({ p: [x, height(x, z) + 0.25, z], s: [26, 0.5, 28], yaw: 0.04, color: fieldColors[i] })
  }
  const ranchBuildings: Building[] = [
    building(-100, 128, height(-100, 128), 2.4, 12, 9, 4.5, PAL.cream, 'gable', PAL.oxblood, true),
    building(-118, 136, height(-118, 136), 2.6, 14, 10, 7, PAL.oxblood, 'gable', PAL.timberDark),
    building(-96, 148, height(-96, 148), 2.2, 7, 6, 3.5, PAL.timber, 'gable', PAL.timberDark),
  ]
  const ranchTown = townItems(ranchBuildings)
  const fenceRuns = [
    fence([[-166, 0, 38], [-74, 0, 38], [-74, 0, 104], [-166, 0, 104], [-166, 0, 38]], height, 3.5),
    fence([[-150, 0, 122], [-130, 0, 122], [-130, 0, 140], [-150, 0, 140], [-150, 0, 122]], height),
    fence([[-66, 0, 100], [-46, 0, 100], [-46, 0, 118], [-66, 0, 118], [-66, 0, 100]], height),
  ]
  const fencePosts = fenceRuns.flatMap((f) => f.posts)
  const fenceRails = fenceRuns.flatMap((f) => f.rails)
  const pumps = [windpump(-112, height(-112, 58), 58, 9, 0.6), windpump(-140, height(-140, 112), 112, 9, 2.4)]
  const pumpTimber = pumps.flatMap((p) => p.timber)
  const cattle: ColorItem[] = []
  for (let i = 0; i < 20; i++) {
    const inCorral = i < 10
    const x = inCorral ? range(r, -148, -132) : range(r, -64, -48)
    const z = inCorral ? range(r, 124, 138) : range(r, 102, 116)
    cattle.push({ p: [x, height(x, z) + 0.7, z], s: [1.7, 1.1, 0.7], yaw: r() * Math.PI, color: r() < 0.6 ? PAL.cattle : PAL.cattlePale })
  }

  // Mine at the foot of the north-west hill, served by the spur.
  const mine = headframe(-120, height(-120, -84), -84, Math.PI, 12)
  const mineBoxes: ColorItem[] = [
    ...mine.shed,
    { p: [-104, height(-104, -70) + 1, -70], s: [16, 2.2, 10], yaw: 0.4, color: PAL.sandDeep },
    { p: [-134, height(-134, -72) + 1.6, -72], s: [5, 3.2, 4], yaw: 0.2, color: PAL.copper },
    { p: [-108, height(-108, -92) + 1.9, -92], s: [6, 3.8, 5], yaw: 0.1, color: PAL.iron },
  ]

  // Dig on the arroyo bank.
  const dig: ColorItem[] = []
  for (let i = 0; i < 6; i++) {
    const x = 18 + (i % 3) * 11
    const z = 118 + Math.floor(i / 3) * 9
    const y = height(x, z)
    dig.push({ p: [x, y + 0.5, z], s: [8, 1, 0.8], yaw: 0.15, color: PAL.adobeDark })
    dig.push({ p: [x, y + 0.5, z], s: [0.8, 1, 7], yaw: 0.15, color: PAL.adobeDark })
    dig.push({ p: [x + 5, y + 0.05, z - 5], s: [9, 0.1, 2.2], yaw: 0.15, color: PAL.timberDark })
  }
  const tents: Item[] = [0, 1, 2].map((i): Item => ({ p: [54 + i * 8, height(54 + i * 8, 112 + (i % 2) * 6) + 1.6, 112 + (i % 2) * 6], s: [6, 3.4, 6], yaw: 0.4 + i * 0.5 }))

  // Pueblo on the south face of the big mesa; the landmark of the north horizon.
  const puebloAt = { x: -40, z: -146 }
  const pueb = pueblo(r, puebloAt.x, height(puebloAt.x, puebloAt.z), puebloAt.z, 0, 3, 44)

  // Reserve: saguaro dunes east, lookout rise in their midst.
  const spots: Vec3[] = []
  const scrubSpots: ColorItem[] = []
  const rocks: ColorItem[] = []
  let guard = 0
  while (spots.length < 36 && guard++ < 700) {
    const x = range(r, 72, 178)
    const z = range(r, -24, 176)
    if (Math.hypot(x - 128, z - 100) < 20 || arroyo.nearest(x, z).d < 9) continue
    if (spots.some((p) => Math.hypot(p[0] - x, p[2] - z) < 9)) continue
    spots.push([x, height(x, z) - 0.2, z])
  }
  for (let i = 0; i < 80; i++) {
    const x = range(r, -180, 180)
    const z = range(r, -120, 180)
    if (Math.abs(x) < 80 && z > -40 && z < 110) continue
    if (x < -60 && z > 30) continue
    const y = height(x, z)
    if (y > 4) continue
    scrubSpots.push({ p: [x, y + 0.4, z], s: [range(r, 1.2, 2.4), range(r, 0.8, 1.4), range(r, 1.2, 2.4)], yaw: r() * 3, color: r() < 0.7 ? PAL.scrub : PAL.sage })
  }
  for (let i = 0; i < 40; i++) {
    const x = range(r, -180, 180)
    const z = range(r, -140, 180)
    if (Math.abs(x) < 80 && z > -46 && z < 110) continue
    if (Math.hypot(x - TURNTABLE[0], z - TURNTABLE[1]) < 50) continue
    const y = height(x, z)
    if (y > 5) continue
    const size = range(r, 1.4, 4.2)
    rocks.push({ p: [x, y + size * 0.25, z], s: [size, size * 0.7, size * range(r, 0.7, 1.3)], yaw: r() * 3, color: r() < 0.5 ? PAL.gravel : PAL.strata })
  }
  const lookoutY = height(128, 100)
  const lookout: Item[] = [
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([lx, lz]) => segment([128 + lx * 2.6, lookoutY, 100 + lz * 2.6], [128 + lx * 1.2, lookoutY + 11, 100 + lz * 1.2], 0.36)),
    { p: [128, lookoutY + 11, 100], s: [5, 0.5, 5], yaw: 0 },
    { p: [128, lookoutY + 13.6, 100], s: [5.6, 0.4, 5.6], yaw: 0 },
  ]

  const lampSpots: Vec3[] = []
  for (let i = 0; i < 9; i++) for (const side of [-1, 1]) lampSpots.push([side * 5.4, 0.5, -6 + i * 12.5])
  for (const z of crossZ) for (const x of [-40, 40]) lampSpots.push([x, 0.5, z + 4.6])
  lampSpots.push([-18, 0.5, -28], [18, 0.5, -28], [-24, 0.5, 52], [-24, 0.5, 80], [TURNTABLE[0] + 20, 0.6, TURNTABLE[1] + 24])
  const lamp = lamps(lampSpots)
  const poles = telegraph(main, height, 12, 26)
  const carts = wagons([
    { p: [-7, 0.5, 36], yaw: 0.2, covered: false },
    { p: [6, 0.5, 92], yaw: 1.3, covered: true },
    { p: [-96, height(-96, 118), 118], yaw: 2.2, covered: true },
    { p: [28, 0.5, -26], yaw: Math.PI / 2, covered: false },
  ])
  const horizon = farButtes(-1, [
    [-300, -330, 54, 46],
    [240, -350, 46, 40],
    [-360, -160, 40, 36],
    [360, -180, 34, 32],
    [-340, 140, 30, 26],
    [350, 120, 26, 22],
  ])

  return {
    height,
    paint,
    arroyo,
    spur,
    mainPath,
    crossPaths,
    town,
    main,
    second,
    lead,
    station,
    yardBoxes,
    yardTimber,
    towerTimber,
    towerTanks,
    towerRoofs,
    roundhouse,
    radial,
    missionAt,
    fields,
    ranchTown,
    fencePosts,
    fenceRails,
    pumps,
    pumpTimber,
    cattle,
    mine,
    mineBoxes,
    dig,
    tents,
    pueb,
    reserve: saguaros(r, spots),
    scrubSpots,
    rocks,
    lookout,
    lookoutY,
    lamp,
    poles,
    carts,
    horizon,
    waterhole,
  }
}

export function RoundhousePlainScene({ night, seed }: BlockoutSceneProps) {
  const world = useMemo(() => buildWorld(seed), [seed])
  const terrain = useGeo(() => heightfield({ size: 370, segments: 132, height: world.height, paint: world.paint, materialCount: TERRAIN_COLORS.length }), [world])
  const mainGeo = useGeo(() => ribbon(world.mainPath.points, 9, 0.12), [world])
  const walkLeft = useGeo(() => ribbon(world.mainPath.points.map(([x, y, z]): Vec3 => [x - 5.6, y, z]), 2.4, 0.3), [world])
  const walkRight = useGeo(() => ribbon(world.mainPath.points.map(([x, y, z]): Vec3 => [x + 5.6, y, z]), 2.4, 0.3), [world])
  const crossGeos = useGeo(() => {
    const geos = world.crossPaths.map((path) => ribbon(path.points, 6, 0.1))
    const merged = new THREE.BufferGeometry()
    const pos: number[] = []
    for (const g of geos) {
      const arr = g.index ? g.toNonIndexed().attributes.position.array : g.attributes.position.array
      for (let i = 0; i < arr.length; i++) pos.push(arr[i])
      g.dispose()
    }
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    merged.computeVertexNormals()
    return merged
  }, [world])
  const washGeo = useGeo(() => ribbon(world.arroyo.points, 6, -1.4, world.height), [world])
  const plaza = useGeo(() => ribbon([[-46, 0.5, 66], [-10, 0.5, 66]], 30, 0.08), [world])
  const train = useRef<THREE.Group>(null)
  const wheels = useRef<THREE.Object3D[]>([])

  useFrame((state, delta) => {
    const tt = (state.clock.elapsedTime * 0.014 + 0.62) % 1
    const { p, dir } = world.main.at(tt)
    if (train.current) {
      train.current.position.set(p[0], p[1] + 0.3, p[2])
      train.current.rotation.y = Math.atan2(dir[0], dir[1])
    }
    for (const wheel of wheels.current) wheel.rotation.z += delta * 0.8
  })

  return (
    <group>
      <Readout label="roundhouse-plain" />
      <Ground y={-0.2} color={PAL.sand} hole={370} />
      <Terrain geometry={terrain} colors={TERRAIN_COLORS} />
      <Colored geometry={CYL6} items={world.horizon} shadow={false} />

      <Strip geometry={mainGeo} color={PAL.roadDark} />
      <Strip geometry={walkLeft} color={PAL.plank} />
      <Strip geometry={walkRight} color={PAL.plank} />
      <Strip geometry={crossGeos} color={PAL.road} />
      <Strip geometry={plaza} color={PAL.gravel} />
      <Strip geometry={washGeo} color={PAL.gravel} />
      <mesh position={[world.waterhole[0], -1.1, world.waterhole[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[11, 14]} />
        <Surf color={PAL.water} transparent opacity={0.9} />
      </mesh>
      <mesh position={[TURNTABLE[0], 0.4, TURNTABLE[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9.5, 18]} />
        <Surf color={PAL.timberDark} />
      </mesh>

      <RailLine path={world.main} heightAt={world.height} />
      <RailLine path={world.second} heightAt={world.height} />
      <RailLine path={world.spur} heightAt={world.height} />
      <RailLine path={world.lead} heightAt={world.height} />
      <Train groupRef={train} night={night} cars={6} />
      <Inst geometry={BOX} items={world.poles}>
        <Surf color={PAL.timberDark} />
      </Inst>

      <Town items={world.town} night={night} />
      <Mission x={world.missionAt[0]} y={world.missionAt[1]} z={world.missionAt[2]} yaw={Math.PI / 2} night={night} towerH={26} />

      <Colored geometry={BOX} items={world.station.walls} />
      <Colored geometry={BOX} items={world.station.roofs} />
      <Inst geometry={BOX} items={world.station.timber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Inst geometry={BOX} items={world.station.windows} shadow={false}>
        <Glow color={PAL.lamp} on={night} />
      </Inst>
      <Colored geometry={BOX} items={world.yardBoxes} />
      <Inst geometry={BOX} items={world.yardTimber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Inst geometry={BOX} items={world.towerTimber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Inst geometry={CYL8} items={world.towerTanks}>
        <Surf color={PAL.timber} />
      </Inst>
      <Inst geometry={CONE8} items={world.towerRoofs}>
        <Surf color={PAL.oxblood} />
      </Inst>
      <Town items={world.roundhouse} night={night} />
      <Inst geometry={BOX} items={world.radial} shadow={false}>
        <Surf color={PAL.iron} />
      </Inst>

      <Colored geometry={BOX} items={world.fields} shadow={false} />
      <Town items={world.ranchTown} night={night} />
      <Inst geometry={BOX} items={world.fencePosts}>
        <Surf color={PAL.timber} />
      </Inst>
      <Inst geometry={BOX} items={world.fenceRails} shadow={false}>
        <Surf color={PAL.plank} />
      </Inst>
      <Inst geometry={BOX} items={world.pumpTimber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Wheel at={world.pumps[0].head} yaw={0.6} radius={2.2} refs={wheels} />
      <Wheel at={world.pumps[1].head} yaw={2.4} radius={2.2} refs={wheels} />
      <Colored geometry={BOX} items={world.cattle} />

      <Inst geometry={BOX} items={world.mine.timber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Colored geometry={BOX} items={world.mineBoxes} />
      <Inst geometry={BOX} items={world.mine.adit}>
        <Surf color="#241a18" />
      </Inst>

      <Colored geometry={BOX} items={world.dig} />
      <Inst geometry={PYRAMID} items={world.tents}>
        <Surf color={PAL.canvas} />
      </Inst>

      <Colored geometry={BOX} items={world.pueb.blocks} />
      <Inst geometry={BOX} items={world.pueb.ladders}>
        <Surf color={PAL.plank} />
      </Inst>

      <Inst geometry={CYL6} items={world.reserve}>
        <Surf color={PAL.cactus} />
      </Inst>
      <Colored geometry={SCRUB} items={world.scrubSpots} shadow={false} />
      <Colored geometry={ROCK} items={world.rocks} />
      <Inst geometry={BOX} items={world.lookout}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <mesh geometry={BULB} position={[128, world.lookoutY + 12.4, 100]}>
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
