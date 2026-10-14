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
  ribbonAlong,
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
import { PAL, blobDistance, fbm, heightfield, lerp, makePath, range, ribbon, rng, samplePath, segment, smoothstep, terrace, vnoise, yawToward, type Item, type Vec3 } from './lib'

/**
 * Direction B, "Trestle Gorge": a river has cut a 36 m gorge through the plain. Main Street
 * runs along the west rim with its saloons cantilevered over the drop, adobe terraces step down
 * to a mill at the water, and a timber trestle carries the railway across to the depot on the
 * east rim. The ranch creek falls into the gorge; the mine chute drops from the east rim.
 */

const DEPTH = 36
const RIVER_Y = -DEPTH
const RAIL_Z = -84
const STREET_X = -54

const TERRAIN_COLORS = [PAL.sand, PAL.sandDeep, PAL.gravel, PAL.rock, PAL.strata, PAL.rockDark, PAL.ledge, PAL.pasture] as const

function buildWorld(seed: number) {
  const r = rng(seed * 4177 + 31)
  const s = seed % 89

  const river = makePath([
    [28, RIVER_Y, -195],
    [18, RIVER_Y, -130],
    [8, RIVER_Y, -70],
    [6, RIVER_Y, -10],
    [8, RIVER_Y, 40],
    [16, RIVER_Y, 100],
    [10, RIVER_Y, 195],
  ])
  const trib = makePath([
    [-122, 0, 104],
    [-92, 0, 94],
    [-62, 0, 86],
    [-40, 0, 82],
    [-27, 0, 80],
  ])
  const stair = makePath([
    [-42, 0.6, 2],
    [-33, -12, 20],
    [-25, -12, 14],
    [-16, -24, 30],
    [-10, -24, 26],
    [-4, RIVER_Y + 0.4, 38],
  ])
  const waterhole: readonly [number, number] = [-128, 102]
  const townSector = (z: number) => smoothstep(-42, -26, z) * smoothstep(58, 44, z)

  const height = (x: number, z: number): number => {
    let y = 1.8 * (fbm(x * 0.012 + 7, z * 0.012, s + 5) - 0.3)
    const n = river.nearest(x, z)
    const rise = blobDistance(x, z, 88, 64, 13, 11, 0.3, 0.1, s + 17)
    y = Math.max(y, terrace(lerp(y, 10, smoothstep(12, -2, rise)), 5, 0.8))
    const m1 = blobDistance(x, z, -78, -168, 58, 30, 0.1, 0.08, s + 11)
    y = Math.max(y, terrace(lerp(y, 30, smoothstep(24, -2, m1)), 7, 0.82))
    const m2 = blobDistance(x, z, 118, -162, 44, 26, -0.15, 0.08, s + 13)
    y = Math.max(y, terrace(lerp(y, 22, smoothstep(20, -2, m2)), 7, 0.82))
    const townPad = smoothstep(-60, -50, z) * smoothstep(76, 66, z) * smoothstep(-90, -76, x) * smoothstep(-30, -40, x)
    y = lerp(y, 0.6, townPad)
    // the gorge: wider and stepped in the town sector of the west wall
    const west = x < n.px
    const tMask = west ? townSector(z) : 0
    const rimHalf = lerp(34, 46, tMask) + 3 * (vnoise(z * 0.03, x * 0.03, s + 2) - 0.5) * 2
    if (n.d < rimHalf + 2) {
      const wall = y - DEPTH * smoothstep(rimHalf, 9, n.d)
      y = Math.min(y, terrace(wall, lerp(6, 12, tMask), 0.85))
    }
    if (n.d < 11) y = Math.min(y, RIVER_Y - 1.6 * smoothstep(11, 5, n.d))
    // dig alcove bench on the east wall
    if (!west) {
      const alcove = smoothstep(86, 94, z) * smoothstep(114, 106, z) * smoothstep(34, 28, n.d) * smoothstep(10, 15, n.d)
      y = lerp(y, Math.max(y, -16), alcove)
    }
    // ranch creek slot, waterhole, rail bed, stairs
    const tr = trib.nearest(x, z)
    if (tr.d < 10) y -= lerp(1.5, 13, tr.t * tr.t) * smoothstep(10, 3.5, tr.d)
    const hole = Math.hypot((x - waterhole[0]) / 12, (z - waterhole[1]) / 8.5)
    if (hole < 1.6) y = Math.min(y, -1.8 * smoothstep(1.6, 0.7, hole))
    const railD = Math.abs(z - RAIL_Z)
    if (railD < 9 && y > -4) y = lerp(y, 0.9, smoothstep(9, 4, railD))
    const sd = stair.nearest(x, z)
    if (sd.d < 6) y = lerp(y, sd.y, smoothstep(6, 2.2, sd.d))
    return y
  }

  const paint = (x: number, z: number, y: number, ny: number): number => {
    if (ny < 0.5) return 3 + ((Math.floor((y + 48) / 6) % 3) + 3) % 3
    if (ny < 0.8) return 1
    if (y < RIVER_Y + 1.5) return 2
    if (y < -2.5) return 6
    if (Math.hypot(x - waterhole[0], z - waterhole[1]) < 36) return 7
    if (trib.nearest(x, z).d < 4) return 2
    return vnoise(x * 0.06, z * 0.06, s + 21) > 0.64 ? 1 : 0
  }
  const railHeight = (x: number, z: number) => Math.max(height(x, z), 0.9)

  // Main Street along the rim; the east row hangs over the gorge on stilts.
  // The street bends east at its north end so the walk camera ends on the bridgehead.
  const mainPath = makePath([
    [STREET_X + 24, 0.6, -74],
    [STREET_X + 14, 0.6, -58],
    [STREET_X + 3, 0.6, -40],
    [STREET_X, 0.6, -26],
    [STREET_X, 0.6, 64],
  ])
  const buildings = street(r, mainPath, {
    side: 0,
    setback: 6.5,
    gap: [1.5, 4],
    width: [7, 11],
    depth: [8, 12],
    height: [5.5, 9],
    colors: [PAL.teal, PAL.sage, PAL.timber, PAL.cream, PAL.sage, PAL.timber],
    roofColors: [PAL.timberDark, PAL.timber],
    roof: 'false',
    from: 0.06,
    to: 0.96,
    heightAt: () => 0.6,
  })
  buildings.push(building(STREET_X + 12.5, 8, 0.6, yawToward(-1, 0), 13, 12, 10, PAL.oxblood, 'false', PAL.oxblood, true))
  const backPath = makePath([
    [STREET_X - 22, 0.6, -30],
    [STREET_X - 22, 0.6, 54],
  ])
  const backRow = street(r, backPath, {
    side: 1,
    setback: 4,
    gap: [3, 7],
    width: [6, 9],
    depth: [6, 9],
    height: [3.5, 5],
    colors: [PAL.cream, PAL.timber, PAL.sage],
    roofColors: [PAL.timberDark, PAL.oxblood, PAL.timber],
    roof: 'gable',
    heightAt: () => 0.6,
  })
  const town = townItems([...buildings, ...backRow])
  const stilts: Item[] = []
  for (const b of buildings) {
    if (b.x < STREET_X) continue
    for (const lx of [-b.w / 2 + 0.5, b.w / 2 - 0.5]) {
      const c = Math.cos(b.yaw)
      const sn = Math.sin(b.yaw)
      const lz = -b.d / 2 + 0.5
      const px = b.x + lx * c + lz * sn
      const pz = b.z - lx * sn + lz * c
      const ground = height(px, pz)
      if (ground < b.y - 0.5) stilts.push(segment([px, ground, pz], [px, b.y, pz], 0.4))
    }
  }

  // Terrace houses on the stepped west wall and the stair down to the mill.
  const terraceHouses: ColorItem[] = []
  for (const level of [-12, -24]) {
    for (let z = -22; z <= 44; z += 7) {
      for (let x = -44; x < 0; x += 1) {
        if (Math.abs(height(x, z) - level) < 0.7 && Math.abs(height(x + 4.5, z) - level) < 0.7) {
          if (stair.nearest(x + 2.5, z).d < 4) break
          const w = range(r, 4.2, 5.6)
          terraceHouses.push({ p: [x + 2.6, level + 1.8, z], s: [w, 3.6, range(r, 4.2, 5.4)], yaw: range(r, -0.08, 0.08), color: r() < 0.65 ? PAL.adobe : PAL.adobeDark })
          break
        }
      }
    }
  }
  const steps: Item[] = samplePath(stair, 1.6).map(({ p, dir }): Item => ({ p: [p[0], p[1] + 0.2, p[2]], s: [2.8, 0.45, 1.5], yaw: yawToward(dir[0], dir[1]) }))
  const mill: ColorItem[] = [
    { p: [-9, RIVER_Y + 3.4, 32], s: [9, 6.8, 7], yaw: 0.1, color: PAL.timber },
    { p: [-9, RIVER_Y + 7.4, 32], s: [9.6, 1.4, 7.6], yaw: 0.1, color: PAL.timberDark },
    { p: [-4, RIVER_Y + 0.4, 46], s: [8, 0.6, 5], yaw: 0, color: PAL.plank },
    { p: [4, RIVER_Y + 0.9, 56], s: [3, 1.2, 7], yaw: 0.2, color: PAL.timber },
    { p: [9, RIVER_Y + 0.9, 70], s: [3, 1.2, 7], yaw: -0.3, color: PAL.oxblood },
  ]

  // Trestle: bents every 7 m across the gap, sills and X braces down to the stepped walls.
  const riverAtBridge = river.nearest(0, RAIL_Z).px
  const westRim = riverAtBridge - 36
  const eastRim = riverAtBridge + 36
  const bents: Item[] = []
  const bentXs: number[] = []
  for (let x = westRim - 2; x <= eastRim + 2; x += 7.2) bentXs.push(x)
  const deckY = 0.6
  for (const bx of bentXs) {
    for (const sz of [-2.2, 2.2]) {
      const footZ = RAIL_Z + sz * 1.9
      for (const dx of [-1.4, 1.4]) {
        const ground = height(bx + dx * 1.6, footZ)
        if (ground > deckY - 1) continue
        bents.push(segment([bx + dx * 1.6, ground - 0.5, footZ], [bx + dx * 0.6, deckY, RAIL_Z + sz], 0.5))
      }
    }
    for (let level = deckY - 7; level > height(bx, RAIL_Z) + 1; level -= 7) {
      bents.push({ p: [bx, level, RAIL_Z], s: [1.2, 0.5, 8.4], yaw: 0 })
      bents.push({ p: [bx, level, RAIL_Z], s: [6.4, 0.5, 1], yaw: 0 })
    }
  }
  for (let i = 0; i < bentXs.length - 1; i++) {
    const a = bentXs[i]
    const b = bentXs[i + 1]
    const floor = Math.max(height(a, RAIL_Z), height(b, RAIL_Z))
    for (let level = deckY - 7; level - 7 > floor; level -= 7) {
      for (const sz of [-3.1, 3.1]) {
        bents.push(segment([a, level, RAIL_Z + sz], [b, level - 7, RAIL_Z + sz], 0.28))
        bents.push(segment([a, level - 7, RAIL_Z + sz], [b, level, RAIL_Z + sz], 0.28))
      }
    }
  }
  const rail = makePath([
    [-195, 0.9, RAIL_Z],
    [195, 0.9, RAIL_Z],
  ])
  const deckPts: Vec3[] = [
    [westRim - 8, deckY + 0.2, RAIL_Z],
    [eastRim + 8, deckY + 0.2, RAIL_Z],
  ]
  const station = depot(74, height(74, -70), -70, Math.PI, 26)
  const stationExtras: ColorItem[] = [
    { p: [104, height(104, -70) + 3.6, -70], s: [3, 7.2, 3], yaw: 0, color: PAL.timberDark },
    { p: [104, height(104, -70) + 7.8, -70], s: [3.6, 1.2, 3.6], yaw: 0, color: PAL.mustard },
    { p: [52, height(52, -70) + 2.4, -70], s: [12, 4.8, 9], yaw: 0, color: PAL.timber },
  ]
  const tower = waterTower(116, height(116, -72), -72, 9)

  // Mine on the east rim: headframe, chute down the wall to a stamp mill at the river.
  const mine = headframe(46, height(46, 8), 8, -Math.PI / 2, 12)
  const chute: Item[] = [segment([40, height(40, 8) + 1.5, 8], [16, RIVER_Y + 4, 13], 1.6, 0.9), segment([18, RIVER_Y + 1, 14], [8, RIVER_Y + 0.6, 16], 1.4, 0.6)]
  const mineBoxes: ColorItem[] = [
    ...mine.shed,
    { p: [14, RIVER_Y + 2.4, 20], s: [7, 4.8, 6], yaw: 0.2, color: PAL.timber },
    { p: [58, height(58, 20) + 1, 20], s: [14, 2, 9], yaw: 0.5, color: PAL.sandDeep },
    { p: [50, height(50, -4) + 1.4, -4], s: [4, 2.8, 3.4], yaw: 0.1, color: PAL.copper },
  ]

  // Dig: ruin walls on the alcove bench, canvas camp on the rim above.
  const dig: ColorItem[] = []
  for (let i = 0; i < 5; i++) {
    const x = 26 + (i % 3) * 5
    const z = 92 + Math.floor(i / 3) * 7 + (i % 2) * 2
    const y = height(x, z)
    if (y > -8) continue
    dig.push({ p: [x, y + 0.9, z], s: [4.5, 1.8, 0.7], yaw: 0.1, color: PAL.adobeDark })
    dig.push({ p: [x, y + 0.9, z], s: [0.7, 1.8, 4], yaw: 0.1, color: PAL.adobeDark })
  }
  const tents: Item[] = [0, 1, 2].map((i): Item => ({ p: [50 + i * 8, height(50 + i * 8, 104 + (i % 2) * 6) + 1.6, 104 + (i % 2) * 6], s: [6, 3.4, 6], yaw: 0.4 + i * 0.5 }))

  // Ranch on the west plain around the waterhole that feeds the creek.
  const ranchBuildings: Building[] = [
    building(-112, 120, height(-112, 120), 2.6, 12, 9, 4.5, PAL.cream, 'gable', PAL.oxblood, true),
    building(-134, 128, height(-134, 128), 2.8, 14, 10, 7, PAL.oxblood, 'gable', PAL.timberDark),
    building(-96, 134, height(-96, 134), 2.4, 7, 6, 3.5, PAL.timber, 'gable', PAL.timberDark),
  ]
  const ranchTown = townItems(ranchBuildings)
  const corrals = [
    fence([[-156, 0, 78], [-136, 0, 78], [-136, 0, 94], [-156, 0, 94], [-156, 0, 78]], height),
    fence([[-104, 0, 72], [-84, 0, 70], [-82, 0, 56], [-102, 0, 56], [-104, 0, 72]], height),
    fence([[-160, 0, 120], [-160, 0, 150], [-130, 0, 156]], height),
  ]
  const corralPosts = corrals.flatMap((c) => c.posts)
  const corralRails = corrals.flatMap((c) => c.rails)
  const pump = windpump(-116, height(-116, 92), 92, 9, 2.2)
  const cattle: ColorItem[] = []
  for (let i = 0; i < 16; i++) {
    const x = range(r, -154, -138)
    const z = range(r, 80, 92)
    cattle.push({ p: [x, height(x, z) + 0.7, z], s: [1.7, 1.1, 0.7], yaw: r() * Math.PI, color: r() < 0.6 ? PAL.cattle : PAL.cattlePale })
  }

  // Reserve on the east plain; lookout rise watching the gorge.
  const spots: Vec3[] = []
  const scrubSpots: ColorItem[] = []
  const rocks: ColorItem[] = []
  let guard = 0
  while (spots.length < 32 && guard++ < 600) {
    const x = range(r, 68, 176)
    const z = range(r, -50, 175)
    if (Math.hypot(x - 88, z - 64) < 20 || river.nearest(x, z).d < 42) continue
    if (spots.some((p) => Math.hypot(p[0] - x, p[2] - z) < 9)) continue
    spots.push([x, height(x, z) - 0.2, z])
  }
  for (let i = 0; i < 70; i++) {
    const x = range(r, 60, 180)
    const z = range(r, -175, 175)
    if (river.nearest(x, z).d < 40 || Math.abs(z - RAIL_Z) < 8) continue
    const y = height(x, z)
    scrubSpots.push({ p: [x, y + 0.4, z], s: [range(r, 1.2, 2.4), range(r, 0.8, 1.4), range(r, 1.2, 2.4)], yaw: r() * 3, color: r() < 0.7 ? PAL.scrub : PAL.sage })
  }
  for (let i = 0; i < 40; i++) {
    const x = range(r, -175, 180)
    const z = range(r, -175, 180)
    const n = river.nearest(x, z)
    if (n.d < 44 && n.d > 12) continue
    if (Math.abs(z - RAIL_Z) < 8 || Math.abs(x - STREET_X) < 30) continue
    const y = height(x, z)
    const size = range(r, 1.4, 4.2)
    rocks.push({ p: [x, y + size * 0.25, z], s: [size, size * 0.7, size * range(r, 0.7, 1.3)], yaw: r() * 3, color: r() < 0.5 ? PAL.gravel : PAL.strata })
  }
  const lookoutY = height(88, 64)
  const lookout: Item[] = [
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([lx, lz]) => segment([88 + lx * 2.6, lookoutY, 64 + lz * 2.6], [88 + lx * 1.2, lookoutY + 11, 64 + lz * 1.2], 0.36)),
    { p: [88, lookoutY + 11, 64], s: [5, 0.5, 5], yaw: 0 },
    { p: [88, lookoutY + 13.6, 64], s: [5.6, 0.4, 5.6], yaw: 0 },
  ]

  const lampSpots: Vec3[] = []
  for (let i = 0; i < 8; i++) for (const side of [-1, 1]) lampSpots.push([STREET_X + side * 5.4, 0.6, -40 + i * 14])
  lampSpots.push([westRim - 6, 0.9, RAIL_Z + 5], [eastRim + 6, 0.9, RAIL_Z + 5], [68, height(68, -58), -58], [-14, RIVER_Y, 36], [40, height(40, 14), 14])
  const lamp = lamps(lampSpots)
  const poles = telegraph(rail, railHeight, 7, 26).filter((item) => height(item.p[0], item.p[2]) > -2)
  const carts = wagons([
    { p: [STREET_X - 2, 0.6, 70], yaw: 0.3, covered: true },
    { p: [STREET_X + 1, 0.6, -36], yaw: 1.4, covered: false },
    { p: [-120, height(-120, 112), 112], yaw: 2.2, covered: true },
  ])
  const horizon = farButtes(-1, [
    [-80, -330, 50, 46],
    [120, -340, 40, 36],
    [-300, -240, 36, 40],
    [320, -220, 32, 34],
    [-340, 120, 30, 28],
    [340, 80, 26, 24],
  ])

  const fallPts: Vec3[] = [
    [-28, height(-28, 80) + 0.2, 80],
    [-22, -20, 81],
    [-15, -28, 82],
    [-8, RIVER_Y + 0.6, 84],
  ]

  return {
    height,
    paint,
    railHeight,
    river,
    trib,
    fallPts,
    mainPath,
    backPath,
    town,
    stilts,
    terraceHouses,
    steps,
    mill,
    bents,
    rail,
    deckPts,
    station,
    stationExtras,
    tower,
    mine,
    chute,
    mineBoxes,
    dig,
    tents,
    ranchTown,
    corralPosts,
    corralRails,
    pump,
    cattle,
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

export function TrestleGorgeScene({ night, seed }: BlockoutSceneProps) {
  const world = useMemo(() => buildWorld(seed), [seed])
  const terrain = useGeo(() => heightfield({ size: 370, segments: 136, height: world.height, paint: world.paint, materialCount: TERRAIN_COLORS.length }), [world])
  const water = useGeo(() => ribbon(world.river.points.map(([x, , z]): Vec3 => [x, RIVER_Y - 0.6, z]), 15, 0), [world])
  const creek = useGeo(() => ribbon(world.trib.points, 3, 0.35, world.height), [world])
  const fall = useGeo(() => ribbon(world.fallPts, 3.4, 0.4), [world])
  const mainGeo = useGeo(() => ribbonAlong(world.mainPath, 9, 0.12, world.height), [world])
  const walkLeft = useGeo(() => ribbonAlong(world.mainPath, 2.4, 0.3, () => 0.6, -5.6), [world])
  const walkRight = useGeo(() => ribbonAlong(world.mainPath, 2.4, 0.3, () => 0.6, 5.6), [world])
  const backGeo = useGeo(() => ribbon(world.backPath.points, 5, 0.12), [world])
  const deck = useGeo(() => ribbon(world.deckPts, 5.6, 0), [world])
  const train = useRef<THREE.Group>(null)
  const wheels = useRef<THREE.Object3D[]>([])

  useFrame((state, delta) => {
    const tt = (state.clock.elapsedTime * 0.016 + 0.42) % 1
    const { p, dir } = world.rail.at(tt)
    if (train.current) {
      train.current.position.set(p[0], p[1] + 0.3, p[2])
      train.current.rotation.y = Math.atan2(dir[0], dir[1])
    }
    for (const wheel of wheels.current) wheel.rotation.z += delta * 0.7
  })

  return (
    <group>
      <Readout label="trestle-gorge" />
      <Ground y={-0.2} color={PAL.sand} hole={370} />
      <Terrain geometry={terrain} colors={TERRAIN_COLORS} />
      <Colored geometry={CYL6} items={world.horizon} shadow={false} />

      <Strip geometry={water} color={PAL.waterDeep} transparent opacity={0.92} />
      <Strip geometry={creek} color={PAL.water} />
      <Strip geometry={fall} color="#cfe6ee" />
      <mesh position={[world.waterhole[0], -1.1, world.waterhole[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[11, 14]} />
        <Surf color={PAL.water} transparent opacity={0.9} />
      </mesh>

      <Strip geometry={mainGeo} color={PAL.roadDark} />
      <Strip geometry={walkLeft} color={PAL.plank} />
      <Strip geometry={walkRight} color={PAL.plank} />
      <Strip geometry={backGeo} color={PAL.road} />
      <Strip geometry={deck} color={PAL.plank} shadow />
      <RailLine path={world.rail} heightAt={world.railHeight} />
      <Inst geometry={BOX} items={world.bents}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Train groupRef={train} night={night} cars={5} />
      <Inst geometry={BOX} items={world.poles}>
        <Surf color={PAL.timberDark} />
      </Inst>

      <Town items={world.town} night={night} />
      <Inst geometry={BOX} items={world.stilts}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Colored geometry={BOX} items={world.terraceHouses} />
      <Inst geometry={BOX} items={world.steps}>
        <Surf color={PAL.plank} />
      </Inst>
      <Colored geometry={BOX} items={world.mill} />
      <Wheel at={[-3.6, RIVER_Y + 2.6, 32]} yaw={Math.PI / 2} radius={3.2} refs={wheels} />

      <Colored geometry={BOX} items={world.station.walls} />
      <Colored geometry={BOX} items={world.station.roofs} />
      <Inst geometry={BOX} items={world.station.timber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Inst geometry={BOX} items={world.station.windows} shadow={false}>
        <Glow color={PAL.lamp} on={night} />
      </Inst>
      <Colored geometry={BOX} items={world.stationExtras} />
      <Inst geometry={BOX} items={world.tower.timber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Inst geometry={CYL8} items={world.tower.tank}>
        <Surf color={PAL.timber} />
      </Inst>
      <Inst geometry={CONE8} items={world.tower.roof}>
        <Surf color={PAL.oxblood} />
      </Inst>

      <Inst geometry={BOX} items={world.mine.timber}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Colored geometry={BOX} items={world.mineBoxes} />
      <Inst geometry={BOX} items={world.chute}>
        <Surf color={PAL.timber} />
      </Inst>
      <Inst geometry={BOX} items={world.mine.adit}>
        <Surf color="#241a18" />
      </Inst>

      <Colored geometry={BOX} items={world.dig} />
      <Inst geometry={PYRAMID} items={world.tents}>
        <Surf color={PAL.canvas} />
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
      <Wheel at={world.pump.head} yaw={2.2} radius={2.2} refs={wheels} />
      <Colored geometry={BOX} items={world.cattle} />

      <Inst geometry={CYL6} items={world.reserve}>
        <Surf color={PAL.cactus} />
      </Inst>
      <Colored geometry={SCRUB} items={world.scrubSpots} shadow={false} />
      <Colored geometry={ROCK} items={world.rocks} />
      <Inst geometry={BOX} items={world.lookout}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <mesh geometry={BULB} position={[88, world.lookoutY + 12.4, 64]}>
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
