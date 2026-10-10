import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { Glow, Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, outwardRotation, placementFor, type BouquetPlacement, type BouquetSlot } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/** Family slots: windpump pushed left so its vane clears the red stem; saloon and saguaros spread right. */
const PLACEMENTS: readonly BouquetPlacement[] = [
  { id: 'hero', position: [0.5, BASE_TOP, -6.5], height: 32, yaw: 0.08, outwardLean: 0.16, crownRadius: 9 },
  { id: 'front-left', position: [-8.5, BASE_TOP, 3], height: 28, yaw: 0.08, outwardLean: 0.14, crownRadius: 4.5 },
  { id: 'back-right', position: [7, BASE_TOP, -3.5], height: 28, yaw: -0.18, outwardLean: 0.18, crownRadius: 9 },
  { id: 'front-right', position: [11, BASE_TOP, 4.5], height: 24, yaw: 0.16, outwardLean: 0.2, crownRadius: 10 },
] as const

const place = (slot: BouquetSlot) => placementFor(slot, PLACEMENTS)

/**
 * Wild West: "Red Rock Roundup".
 * One capped butte, one lattice windpump, one false-front saloon, one saguaro
 * pair. Roster hexes only; the saguaro green is the single saturated accent.
 */
const P = {
  rock: '#a0522d',
  flats: '#d9b07a',
  strata: '#c2925a',
  timber: '#8b5a3c',
  saguaro: '#4f8a4a',
  window: '#ffe9a8',
} as const

const HEX = Math.PI / 6

/** P1 — flat-top mesa butte. Authored 16 m tall; the cap is ~70 % of the mass. */
function MesaButte() {
  const slot = place('hero')
  return (
    <group position={slot.position} rotation={outwardRotation(slot)}>
      <group scale={slot.height / 16.3}>
        {/* talus skirt */}
        <mesh position={[0.4, 1, 0.6]} scale={[5.2, 1.4, 4.4]} rotation={[0, 0.4, 0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.rock} />
        </mesh>
        {/* red-rock stem */}
        <mesh position={[0, 5.6, 0]} rotation={[0, HEX * 0.5, 0]} castShadow>
          <cylinderGeometry args={[3.3, 4.1, 9.4, 6]} />
          <Surf color={P.rock} />
        </mesh>
        {/* one strata band on the stem */}
        <mesh position={[0, 4.2, 0]} rotation={[0, HEX * 0.5, 0]} castShadow>
          <cylinderGeometry args={[3.75, 3.85, 0.6, 6]} />
          <Surf color={P.strata} />
        </mesh>
        {/* undercut strata layer flaring out under the cap */}
        <mesh position={[0, 10.75, 0]} rotation={[0, HEX * 0.5, 0]} scale={[1.2, 1, 0.84]} castShadow>
          <cylinderGeometry args={[5.5, 4.2, 1.2, 6]} />
          <Surf color={P.flats} />
        </mesh>
        {/* THE cap: a huge ochre slab */}
        <mesh position={[0, 13, 0]} rotation={[0, HEX * 0.5, 0]} scale={[1.28, 1, 0.86]} castShadow>
          <cylinderGeometry args={[5.7, 5.7, 3.4, 6]} />
          <Surf color={P.flats} />
        </mesh>
        {/* upper plateau step */}
        <mesh position={[-1.6, 15.1, -0.3]} rotation={[0, HEX * 0.5, 0]} scale={[1.3, 1, 0.9]} castShadow>
          <cylinderGeometry args={[3.3, 3.8, 0.9, 6]} />
          <Surf color={P.flats} />
        </mesh>
        {/* small red-rock boulder perched on the cap edge */}
        <mesh position={[4, 15.05, 0.8]} scale={[0.65, 0.55, 0.55]} rotation={[0.2, 0.7, -0.15]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.rock} />
        </mesh>
        {/* hoodoo at the foot */}
        <mesh position={[6.4, 2.3, 2.4]} rotation={[0, 0.3, 0.06]} castShadow>
          <cylinderGeometry args={[0.8, 1.25, 4.6, 6]} />
          <Surf color={P.rock} />
        </mesh>
        <mesh position={[6.55, 4.9, 2.4]} rotation={[0, 0.3, 0.06]} castShadow>
          <cylinderGeometry args={[1.5, 1.25, 0.7, 6]} />
          <Surf color={P.flats} />
        </mesh>
      </group>
    </group>
  )
}

const LEG_TILT = Math.atan(1 / 11)
const LEGS: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

/** P2 — lattice windpump. Authored 16 m to the vane top; the vane is wider than the saloon. */
function Windpump({ vane }: { vane: RefObject<THREE.Group | null> }) {
  const slot = place('front-left')
  return (
    <group position={slot.position} rotation={outwardRotation(slot)}>
      <group scale={slot.height / 16.2}>
        {LEGS.map(([sx, sz]) => (
          <mesh key={`${sx}${sz}`} position={[sx * 1.25, 5.5, sz * 1.25]} rotation={[-sz * LEG_TILT, 0, sx * LEG_TILT]} castShadow>
            <boxGeometry args={[0.42, 11.2, 0.42]} />
            <Surf color={P.timber} />
          </mesh>
        ))}
        {/* cross-brace band */}
        <mesh position={[0, 4.6, 0]} castShadow>
          <boxGeometry args={[2.8, 0.24, 2.8]} />
          <Surf color={P.timber} />
        </mesh>
        {/* platform + gearbox */}
        <mesh position={[0, 11.2, 0]} castShadow>
          <boxGeometry args={[2.3, 0.4, 2.3]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[0, 12, 0.2]} castShadow>
          <boxGeometry args={[0.9, 0.9, 1.7]} />
          <Surf color={P.timber} />
        </mesh>
        {/* tail rod + fin */}
        <mesh position={[0, 12, -1.3]} castShadow>
          <boxGeometry args={[0.2, 0.2, 2.6]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[0, 12.1, -2.5]} castShadow>
          <boxGeometry args={[0.14, 1.7, 1.5]} />
          <Surf color={P.timber} />
        </mesh>
        {/* THE vane: four crossing bars = eight blades */}
        <group ref={vane} position={[0, 12, 1.25]}>
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} rotation={[0, 0, (k * Math.PI) / 4]} castShadow>
              <boxGeometry args={[8.4, 1.05, 0.14]} />
              <Surf color={P.timber} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

/** P3 — false-front saloon. Authored 10.2 m; the false front is twice the body height. */
function Saloon({ night, sign }: { night: boolean; sign: RefObject<THREE.Group | null> }) {
  const slot = place('back-right')
  return (
    <group position={slot.position} rotation={outwardRotation(slot)}>
      <group scale={slot.height / 10.2}>
        {/* body + low slab roof hidden behind the front */}
        <mesh position={[0, 2.3, -0.7]} castShadow>
          <boxGeometry args={[4.2, 4.6, 4.6]} />
          <Surf color={P.strata} />
        </mesh>
        <mesh position={[0, 4.75, -0.9]} rotation={[0.14, 0, 0]} castShadow>
          <boxGeometry args={[4.5, 0.5, 5]} />
          <Surf color={P.timber} />
        </mesh>
        {/* THE false front */}
        <mesh position={[0, 4.1, 1.75]} castShadow>
          <boxGeometry args={[4.6, 8.2, 0.35]} />
          <Surf color={P.strata} />
        </mesh>
        <mesh position={[0, 8.35, 1.75]} castShadow>
          <boxGeometry args={[5, 0.55, 0.65]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[0, 9.2, 1.75]} castShadow>
          <boxGeometry args={[2.5, 1.4, 0.35]} />
          <Surf color={P.strata} />
        </mesh>
        <mesh position={[0, 10, 1.75]} castShadow>
          <boxGeometry args={[2.9, 0.4, 0.6]} />
          <Surf color={P.timber} />
        </mesh>
        {/* porch awning + posts */}
        <mesh position={[0, 4, 2.95]} rotation={[0.22, 0, 0]} castShadow>
          <boxGeometry args={[5.2, 0.25, 2.4]} />
          <Surf color={P.timber} />
        </mesh>
        {[-2.2, 2.2].map((x) => (
          <mesh key={x} position={[x, 1.85, 3.95]} castShadow>
            <cylinderGeometry args={[0.16, 0.18, 3.7, 6]} />
            <Surf color={P.timber} />
          </mesh>
        ))}
        {/* blank swinging sign plank (no text) */}
        <group ref={sign} position={[0, 3.6, 3.95]}>
          <mesh position={[0, -0.55, 0]} castShadow>
            <boxGeometry args={[2.4, 0.8, 0.12]} />
            <Surf color={P.strata} />
          </mesh>
        </group>
        {/* upper windows + batwing door */}
        {[-1.15, 1.15].map((x) => (
          <mesh key={x} position={[x, 5.8, 1.95]}>
            <boxGeometry args={[1.1, 1.4, 0.12]} />
            <Glow color={P.window} on={night} />
          </mesh>
        ))}
        <mesh position={[0, 1.15, 1.95]}>
          <boxGeometry args={[1.25, 2.1, 0.12]} />
          <Surf color={P.timber} />
        </mesh>
      </group>
    </group>
  )
}

function Saguaro({
  position,
  height,
  arms,
}: {
  position: [number, number, number]
  height: number
  arms: readonly (readonly [number, number, number])[] // [azimuth (rad, 0 = +x), shoulderY, armHeight]
}) {
  const r = height * 0.078
  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r * 1.15, height, 8]} />
        <Surf color={P.saguaro} />
      </mesh>
      <mesh position={[0, height, 0]} castShadow>
        <sphereGeometry args={[r, 7, 5]} />
        <Surf color={P.saguaro} />
      </mesh>
      {arms.map(([azimuth, shoulderY, armHeight], index) => {
        const ar = r * 0.85
        const reach = r * 2.6
        return (
          <group key={index} rotation={[0, azimuth, 0]}>
            <mesh position={[reach * 0.5, shoulderY, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[ar, ar, reach, 8]} />
              <Surf color={P.saguaro} />
            </mesh>
            <mesh position={[reach, shoulderY + armHeight / 2 - ar, 0]} castShadow>
              <cylinderGeometry args={[ar, ar, armHeight, 8]} />
              <Surf color={P.saguaro} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/** P4 — saguaro pair. Authored 12 m; arms as fat as the trunk. The family's accent object. */
function SaguaroPair() {
  const slot = place('front-right')
  return (
    <group position={slot.position} rotation={outwardRotation(slot)}>
      <group scale={slot.height / 12.2}>
        <Saguaro
          position={[0, 0, 0]}
          height={11.3}
          arms={[
            [Math.PI, 5.2, 4.8],
            [0, 6.8, 4.2],
            [-2.4, 8, 2.9],
          ]}
        />
        <Saguaro position={[2.3, 0, 1.3]} height={7} arms={[[0, 3.4, 3.2]]} />
      </group>
    </group>
  )
}

function Props({ propCount, night }: BouquetPropsProps) {
  const vane = useRef<THREE.Group>(null)
  const sign = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (vane.current) vane.current.rotation.z = t * 1.3
    if (sign.current) sign.current.rotation.x = Math.sin(t * 2.1) * 0.16
  })
  return (
    <group>
      <MesaButte />
      <Windpump vane={vane} />
      {propCount >= 3 && <Saloon night={night} sign={sign} />}
      {propCount >= 4 && <SaguaroPair />}
    </group>
  )
}

/** Three stacked sandstone strata bands, each undercut 0.3 m below the one above. */
function Rim({ color }: { color: string }) {
  const bands: readonly (readonly [string, number, number, number])[] = [
    // [colour, radius, height, centre y]
    [P.flats, BASE_RADIUS + 0.9, 0.34, BASE_TOP - 0.12],
    [color, BASE_RADIUS + 0.55, 0.42, BASE_TOP - 0.5],
    [P.rock, BASE_RADIUS + 0.2, 0.48, BASE_TOP - 0.95],
  ]
  return (
    <group>
      {bands.map(([tint, radius, height, y], index) => (
        <mesh key={index} position={[0, y, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
          <cylinderGeometry args={[radius, radius - 0.08, height, 12]} />
          <Surf color={tint} />
        </mesh>
      ))}
    </group>
  )
}

export const wildwest: BiomeBouquet = {
  spec: {
    id: 'wildwest',
    name: 'Red Rock Roundup',
    silhouette: 'A broad flat ochre cap on a stubby red-rock stem reads as one slab over an ochre disc, with a spindly vane to its left and a green saguaro front-right.',
    hero: 'mesa-butte',
    elements: [
      { id: 'mesa-butte', height: 32, slot: 'hero' },
      { id: 'windpump', height: 28, slot: 'front-left' },
      { id: 'saloon', height: 28, slot: 'back-right' },
      { id: 'saguaro-pair', height: 24, slot: 'front-right' },
    ],
    rim: 'Three stacked sandstone strata bands at the plinth edge: flats over strata over red rock, each band stepped 0.3 m back under the one above.',
    exaggeration: 'The mesa is 70 % cap: an ochre slab three stems wide balanced on a short red-rock stem, with one boulder perched on its edge.',
    closestProtected: 'Kirby W2 (a lone pyramid on a sand disc). Ours has no pyramid: a capped flat-top butte, a lattice windpump with an oversized 8-blade vane, a false-front saloon and a saguaro pair on a strata-banded red-rock plinth.',
    placements: PLACEMENTS,
  },
  Props,
  Rim,
  terrain: { primary: '#c2925a', secondary: '#a0522d', rocks: true },
}
