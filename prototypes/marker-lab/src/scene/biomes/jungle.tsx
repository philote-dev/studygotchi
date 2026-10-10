import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { Glow, Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, type TerrainLobe, outwardRotation, placementFor } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/** Jungle palette: the roster row plus ink and white-water for details. */
const P = {
  deep: '#4f8a4a',
  canopy: '#6fae6a',
  water: '#5fc9c9',
  trunk: '#8b5a3c',
  stone: '#c7b8a0',
  accent: '#f2b84f',
  ink: '#3a2f45',
  white: '#fffaf3',
} as const

/** Vines dangling from the canopy edge: [x, top y, z, length]. */
const CANOPY_VINES: readonly (readonly [number, number, number, number])[] = [
  [-9.5, 23.5, 3, 8],
  [9.2, 23.5, 3.8, 9.5],
  [-3.8, 22.5, 7.5, 6],
]

/** P1: canopy tree over a waterfall cliff, authored at 32 m. A deep-green canopy dome half as tall as it is wide, one white water stripe down the cliff. */
function WaterfallTree() {
  const place = placementFor('hero')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 32}>
        <group rotation={[0, 0.08, 0]}>
          <mesh position={[0.5, 2.5, 1.5]} castShadow receiveShadow>
            <boxGeometry args={[11, 5, 10]} />
            <Surf color={P.deep} />
          </mesh>
          <mesh position={[0, 8, 0]} castShadow>
            <boxGeometry args={[9, 16, 6.5]} />
            <Surf color={P.deep} />
          </mesh>
          <mesh position={[-5.4, 8, 1]} scale={[2.6, 4.5, 2.8]} rotation={[0.1, 0.5, 0.1]} castShadow>
            <dodecahedronGeometry args={[1, 0]} />
            <Surf color={P.deep} />
          </mesh>
          <mesh position={[-1.2, 10.6, 3.4]}>
            <boxGeometry args={[3.4, 11.8, 0.3]} />
            <Surf color={P.water} />
          </mesh>
          <mesh position={[-1.2, 10.7, 3.58]}>
            <boxGeometry args={[1.7, 12, 0.2]} />
            <Surf color={P.white} />
          </mesh>
          <mesh position={[-0.8, 5.15, 4.2]} rotation={[0, 0.3, 0]}>
            <cylinderGeometry args={[2.8, 2.8, 0.4, 8]} />
            <Surf color={P.water} />
          </mesh>
          <mesh position={[-1.0, 5.2, 3.8]} rotation={[0, 0.1, 0]}>
            <cylinderGeometry args={[1.5, 1.5, 0.44, 7]} />
            <Surf color={P.white} />
          </mesh>
        </group>
        <mesh position={[0, 19, -0.5]} castShadow>
          <cylinderGeometry args={[1.4, 2.0, 6, 8]} />
          <Surf color={P.trunk} />
        </mesh>
        <mesh position={[0.5, 25.8, -0.5]} scale={[12.5, 6.2, 11.5]} rotation={[0, 0.2, 0]} castShadow>
          <dodecahedronGeometry args={[1, 1]} />
          <Surf color={P.deep} />
        </mesh>
        <mesh position={[-5.5, 28.5, 3.5]} scale={[6.5, 4, 6]} rotation={[0, -0.4, 0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.deep} />
        </mesh>
        {CANOPY_VINES.map(([x, top, z, length], index) => (
          <mesh key={index} position={[x, top - length / 2, z]} rotation={[0.05, 0, index % 2 ? 0.06 : -0.06]} castShadow>
            <cylinderGeometry args={[0.14, 0.2, length, 5]} />
            <Surf color={P.deep} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/** Palm fronds around the crown: [yaw, droop (negative = arching up), length]. */
const FRONDS: readonly (readonly [number, number, number])[] = [
  [0.2, 0.75, 6.0],
  [1.1, 0.5, 5.6],
  [2.0, 0.15, 5.2],
  [2.9, 0.65, 6.0],
  [3.8, 0.9, 5.8],
  [4.7, 0.1, 5.4],
  [5.5, 0.55, 5.8],
]

/** The palm reaches 24 m rather than its 28 m slot so it stays secondary to the waterfall tree (Kirby W4 drift). */
const PALM_HEIGHT = 24

/** P2: palm, authored at 14 m. A curved trunk under a drooping frond crown nearly as wide as the trunk is tall. */
function Palm() {
  const place = placementFor('front-left')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={PALM_HEIGHT / 14}>
        <mesh position={[0, 2.4, 0]} rotation={[0, 0, 0.12]} castShadow>
          <cylinderGeometry args={[0.52, 0.66, 5, 7]} />
          <Surf color={P.trunk} />
        </mesh>
        <mesh position={[-1.1, 6.9, 0]} rotation={[0, 0, 0.26]} castShadow>
          <cylinderGeometry args={[0.46, 0.54, 5, 7]} />
          <Surf color={P.trunk} />
        </mesh>
        <mesh position={[-2.8, 11.1, 0]} rotation={[0, 0, 0.4]} castShadow>
          <cylinderGeometry args={[0.4, 0.48, 5, 7]} />
          <Surf color={P.trunk} />
        </mesh>
        <group position={[-3.8, 13.4, 0]}>
          {FRONDS.map(([yaw, droop, length], index) => (
            <group key={index} rotation={[0, yaw, 0]}>
              <mesh
                position={[0, (-Math.sin(droop) * length) / 2, (Math.cos(droop) * length) / 2]}
                rotation={[Math.PI / 2 + droop, 0, 0]}
                scale={[1.2, 1, 0.3]}
                castShadow
              >
                <coneGeometry args={[1.0, length, 4]} />
                <Surf color={P.canopy} />
              </mesh>
            </group>
          ))}
          <mesh position={[0.5, -0.5, 0.6]} castShadow>
            <dodecahedronGeometry args={[0.6, 0]} />
            <Surf color={P.trunk} />
          </mesh>
          <mesh position={[-0.6, -0.4, -0.4]} castShadow>
            <dodecahedronGeometry args={[0.5, 0]} />
            <Surf color={P.trunk} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/** P3: ruin block stack, authored at 14 m. Four blocks zig-zag so the top one cantilevers 40 % past the one below. */
function RuinStack() {
  const place = placementFor('back-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 14}>
        <mesh position={[0.6, 1.7, 0]} rotation={[0, 0.05, 0]} castShadow>
          <boxGeometry args={[4.8, 3.4, 4.4]} />
          <Surf color={P.stone} />
        </mesh>
        <mesh position={[1.6, 5.05, -0.3]} rotation={[0, -0.14, 0]} castShadow>
          <boxGeometry args={[4.2, 3.3, 4.0]} />
          <Surf color={P.stone} />
        </mesh>
        <mesh position={[0.4, 8.4, 0.3]} rotation={[0, 0.2, 0]} castShadow>
          <boxGeometry args={[3.8, 3.4, 3.6]} />
          <Surf color={P.stone} />
        </mesh>
        <mesh position={[2.2, 11.9, -0.2]} rotation={[0.05, -0.1, 0.12]} castShadow>
          <boxGeometry args={[3.2, 3.6, 3.0]} />
          <Surf color={P.stone} />
        </mesh>
        <mesh position={[2.1, 13.95, -0.2]} scale={[2.2, 0.9, 2.0]} rotation={[0, 0.4, 0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.canopy} />
        </mesh>
        <mesh position={[-0.2, 1.35, 2.22]} rotation={[0, 0.05, 0]}>
          <boxGeometry args={[1.5, 2.3, 0.2]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[1.6, 5.1, 1.72]} rotation={[0, -0.14, 0]}>
          <boxGeometry args={[3.2, 0.32, 0.2]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[3.6, 9.5, 0.6]} rotation={[0.1, 0, -0.18]} castShadow>
          <cylinderGeometry args={[0.14, 0.18, 9, 5]} />
          <Surf color={P.deep} />
        </mesh>
        <mesh position={[-1.4, 6.2, 1.1]} rotation={[0.15, 0, 0.14]} castShadow>
          <cylinderGeometry args={[0.12, 0.16, 6, 5]} />
          <Surf color={P.deep} />
        </mesh>
        <mesh position={[4.4, 0.8, 2.0]} rotation={[0, 0.5, 0.25]} castShadow>
          <boxGeometry args={[2.2, 1.6, 1.8]} />
          <Surf color={P.stone} />
        </mesh>
      </group>
    </group>
  )
}

/** The flame is the family's only emissive; scaled ×1.3 on review. */
const FLAME_SCALE = 1.3

/** P4: tiki torch, authored at 12 m. The flame is bigger than the torch head that holds it. */
function TikiTorch({ night }: { night: boolean }) {
  const place = placementFor('front-right')
  const flame = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (!flame.current) return
    const t = clock.elapsedTime
    const stretch = 1 + Math.sin(t * 9) * 0.07 + Math.sin(t * 13.7) * 0.05
    const girth = FLAME_SCALE * (1.6 - 0.6 * stretch)
    flame.current.scale.set(girth, FLAME_SCALE * stretch, girth)
    flame.current.rotation.z = Math.sin(t * 6.1) * 0.06
  })
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 12}>
        <mesh position={[0, 3.2, 0]} castShadow>
          <cylinderGeometry args={[0.36, 0.48, 6.4, 7]} />
          <Surf color={P.trunk} />
        </mesh>
        <mesh position={[0, 2.2, 0]} castShadow>
          <cylinderGeometry args={[0.56, 0.56, 0.5, 7]} />
          <Surf color={P.deep} />
        </mesh>
        <mesh position={[0, 5.4, 0]} castShadow>
          <cylinderGeometry args={[0.52, 0.52, 0.5, 7]} />
          <Surf color={P.deep} />
        </mesh>
        <mesh position={[0, 7.0, 0]} rotation={[Math.PI, 0, 0]} castShadow>
          <coneGeometry args={[1.55, 2.0, 7]} />
          <Surf color={P.ink} />
        </mesh>
        <group ref={flame} position={[0, 7.7, 0]} scale={FLAME_SCALE}>
          <mesh position={[0, 1.7, 0]}>
            <coneGeometry args={[1.7, 3.4, 7]} />
            <Glow color={P.accent} on={night} offColor={P.accent} />
          </mesh>
          <mesh position={[0.3, 2.9, 0.2]} rotation={[0, 0, -0.2]}>
            <coneGeometry args={[0.85, 2.0, 6]} />
            <Glow color={P.accent} on={night} offColor={P.accent} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

function Props({ propCount, night }: BouquetPropsProps) {
  return (
    <group>
      <WaterfallTree />
      <Palm />
      {propCount >= 3 && <RuinStack />}
      {propCount >= 4 && <TikiTorch night={night} />}
    </group>
  )
}

const VINE_COUNT = 16
const vineAngle = (index: number) => (index / VINE_COUNT) * Math.PI * 2 + 0.12
const vineLength = (index: number) => 1.15 + 0.4 * Math.abs(Math.sin(index * 2.3))

/** Rim vines that end in a static fruit dot in the lip colour. The pedestal never emits. */
const FRUIT_VINES: readonly number[] = [14, 0, 2, 4, 12, 6]

/** Hanging vine fringe: a vine-green band, 16 vines dropping ~1.2 m below the edge, leaf tufts on every third, fruit dots in the lip colour. */
function Rim({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, BASE_TOP - 0.25, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
        <cylinderGeometry args={[BASE_RADIUS + 0.3, BASE_RADIUS + 0.15, 0.45, 12]} />
        <Surf color={P.deep} />
      </mesh>
      {Array.from({ length: VINE_COUNT }, (_, index) => {
        const angle = vineAngle(index)
        const length = vineLength(index)
        const radius = BASE_RADIUS + 0.35
        return (
          <group key={index} position={[Math.sin(angle) * radius, BASE_TOP - 0.45, Math.cos(angle) * radius]} rotation={[0, angle, 0]}>
            <mesh position={[0, -length / 2, 0]} rotation={[-0.08, 0, index % 2 ? 0.08 : -0.08]} castShadow>
              <cylinderGeometry args={[0.1, 0.15, length, 5]} />
              <Surf color={P.deep} />
            </mesh>
            {index % 3 === 0 && (
              <mesh position={[0, -length - 0.05, 0.12]} scale={[0.6, 0.32, 0.6]} castShadow>
                <dodecahedronGeometry args={[1, 0]} />
                <Surf color={P.canopy} />
              </mesh>
            )}
          </group>
        )
      })}
      {FRUIT_VINES.map((index) => {
        const angle = vineAngle(index)
        const radius = BASE_RADIUS + 0.7
        return (
          <mesh key={index} position={[Math.sin(angle) * radius, BASE_TOP - 0.45 - vineLength(index) - 0.4, Math.cos(angle) * radius]} castShadow>
            <dodecahedronGeometry args={[0.85, 0]} />
            <Surf color={color} />
          </mesh>
        )
      })}
    </group>
  )
}

/** A tall cliff lobe under the waterfall tree; indices 0 and 3 render in the secondary (deep green). */
const JUNGLE_LOBES: readonly TerrainLobe[] = [
  { position: [-1.5, BASE_TOP, -6], radius: 6.4, height: 4.8, stretch: [1.05, 0.9] },
  { position: [0, BASE_TOP, 0.5], radius: 7.4, height: 3.2, stretch: [1.2, 1] },
  { position: [-6.2, BASE_TOP, 3], radius: 5.2, height: 3, stretch: [0.9, 1.1] },
  { position: [-8.5, BASE_TOP, -3.5], radius: 3.4, height: 2.4, stretch: [1, 1] },
  { position: [6, BASE_TOP, -2.8], radius: 5.8, height: 3.9, stretch: [1, 0.92] },
  { position: [5.3, BASE_TOP, 3.8], radius: 5.4, height: 3, stretch: [1.05, 0.9] },
  { position: [0.8, BASE_TOP, 5.4], radius: 4.6, height: 2.2, stretch: [1.25, 0.8] },
]

export const jungle: BiomeBouquet = {
  spec: {
    id: 'jungle',
    name: 'Waterfall Canopy Ruins',
    silhouette: 'A deep-green canopy dome over a cliff with one white-cyan water stripe falling down its face, a light-green palm leaning left and a pale ruin stack at the back.',
    hero: 'waterfall-tree',
    elements: [
      { id: 'waterfall-tree', height: 32, slot: 'hero' },
      { id: 'palm', height: 28, slot: 'front-left' },
      { id: 'ruin-stack', height: 28, slot: 'back-right' },
      { id: 'tiki-torch', height: 24, slot: 'front-right' },
    ],
    rim: 'Hanging vine fringe: thin green vines dropping 1.2 m below the lip all the way around, with static fruit-gold dots at the plinth edge (nothing on the pedestal emits).',
    exaggeration: 'The canopy dome is 25 m across and half as tall as it is wide, and one white waterfall stripe runs the full height of the cliff so it reads at 48 px.',
    closestProtected: 'Kirby W4 (palm island on soft dough). Ours leads with a waterfall canopy tree over a cliff and a four-block ruin stack; the palm is held to 24 m so it stays secondary, and a tiki torch and vine fringe replace the open sand.',
  },
  Props,
  Rim,
  terrain: { primary: P.canopy, secondary: P.deep, rocks: true, lobes: JUNGLE_LOBES },
}
