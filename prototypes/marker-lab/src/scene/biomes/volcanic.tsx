import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, outwardRotation, placementFor, type BouquetPlacement, type BouquetSlot } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/** Family slots: columns pushed left of the cone's flank, ember rock pushed right so its puff clears the forge door. */
const PLACEMENTS: readonly BouquetPlacement[] = [
  { id: 'hero', position: [-0.5, BASE_TOP, -7.5], height: 32, yaw: 0.08, outwardLean: 0.16, crownRadius: 9 },
  { id: 'front-left', position: [-9.5, BASE_TOP, 2.5], height: 28, yaw: 0.08, outwardLean: 0.14, crownRadius: 4.5 },
  { id: 'back-right', position: [9, BASE_TOP, -3], height: 28, yaw: -0.18, outwardLean: 0.18, crownRadius: 9 },
  { id: 'front-right', position: [12.5, BASE_TOP, 3.5], height: 24, yaw: 0.16, outwardLean: 0.2, crownRadius: 10 },
] as const

/**
 * Volcanic: "Cinder Forge Burst".
 * One crater cone with a tyre-thick lava rim, a five-column basalt cluster, a
 * forge house with a chimney taller than itself, and an ember rock under an
 * oversized smoke puff. Lava #ff7a3a is the single saturated accent: orange by
 * day, emissive at night, and only where the roster says (crater, forge door,
 * ember rock, the six rim cracks).
 */
const P = {
  basalt: '#3a2f45',
  rock: '#c9a08f',
  crust: '#8a4a3f',
  lava: '#ff7a3a',
  smoke: '#fffaf3',
} as const

const HEX = Math.PI / 6
const place = (slot: BouquetSlot) => placementFor(slot, PLACEMENTS)

/** Lava stays orange by day (unlike a window) and only emits at night. */
function Lava({ night, intensity = 1.6 }: { night: boolean; intensity?: number }) {
  return <Surf color={P.lava} emissive={P.lava} emissiveIntensity={night ? intensity : 0} />
}

/** P1 — crater cone. Authored 15.8 m; the crater rim is a lava torus as thick as a tyre. */
function CraterCone({ night }: { night: boolean }) {
  const slot = place('hero')
  return (
    <group position={slot.position} rotation={outwardRotation(slot)}>
      <group scale={slot.height / 15.8}>
        {/* truncated cone body, flat face toward the camera */}
        <mesh position={[0, 7.3, 0]} rotation={[0, Math.PI / 7, 0]} scale={[1, 1, 0.78]} castShadow>
          <cylinderGeometry args={[3, 6.4, 14.6, 7]} />
          <Surf color={P.crust} />
        </mesh>
        {/* dark basalt shoulders at the foot */}
        <mesh position={[-4.4, 1.9, 1.4]} scale={[3.2, 2.4, 2.6]} rotation={[0.1, 0.5, 0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.basalt} />
        </mesh>
        <mesh position={[4, 1.5, 2]} scale={[2.6, 2, 2.2]} rotation={[0, -0.4, 0.1]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.basalt} />
        </mesh>
        {/* basalt neck protruding from the upper slope */}
        <mesh position={[-2.4, 10.2, 2]} scale={[1.6, 1.2, 1.2]} rotation={[0.3, 0.6, -0.2]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.basalt} />
        </mesh>
        {/* THE crater rim: a tyre-thick lava torus, and the pool inside it */}
        <mesh position={[0, 14.7, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[3, 0.95, 8, 24]} />
          <Lava night={night} />
        </mesh>
        <mesh position={[0, 14.4, 0]}>
          <cylinderGeometry args={[2.5, 2.5, 0.6, 8]} />
          <Lava night={night} intensity={2} />
        </mesh>
        {/* one lava tongue down the front face */}
        <mesh position={[0.8, 10, 3.05]} rotation={[1.3, 0.05, 0.1]}>
          <boxGeometry args={[0.9, 0.3, 5.4]} />
          <Lava night={night} />
        </mesh>
        {/* parasitic cinder cone */}
        <mesh position={[5.6, 1.9, -0.6]} rotation={[0, 0.4, 0]} castShadow>
          <coneGeometry args={[2.3, 3.8, 6]} />
          <Surf color={P.crust} />
        </mesh>
      </group>
    </group>
  )
}

const COLUMNS: readonly (readonly [number, number, number, number, number])[] = [
  // [x, z, height, radius, tilt]
  [0, 0, 14, 1.25, 0],
  [-2.2, 0.5, 10.8, 1.2, 0.04],
  [2.1, 0.8, 8.2, 1.2, -0.05],
  [-1, 2.5, 6, 1.15, 0.06],
  [1.3, -2.1, 11.6, 1.2, 0.03],
  [3.3, -1, 3.2, 1.05, 0],
]

/** P2 — basalt column cluster. Authored 14 m; the tallest hexagonal prism is one unbroken 28 m column. */
function BasaltColumns() {
  const slot = place('front-left')
  return (
    <group position={slot.position} rotation={outwardRotation(slot)}>
      <group scale={slot.height / 14}>
        {COLUMNS.map(([x, z, height, radius, tilt], index) => (
          <mesh key={index} position={[x, height / 2, z]} rotation={[tilt, HEX * 0.5 + index * 0.2, tilt * 0.6]} castShadow>
            <cylinderGeometry args={[radius, radius, height, 6]} />
            <Surf color={P.basalt} />
          </mesh>
        ))}
        {/* one fallen column at the foot */}
        <mesh position={[-4, 0.95, 2.4]} rotation={[0, 0.5, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.9, 0.9, 4.6, 6]} />
          <Surf color={P.basalt} />
        </mesh>
      </group>
    </group>
  )
}

/** P3 — forge house. Authored 11.6 m; the chimney is taller than the house it serves. */
function ForgeHouse({ night }: { night: boolean }) {
  const slot = place('back-right')
  return (
    <group position={slot.position} rotation={outwardRotation(slot)}>
      <group scale={slot.height / 11.6}>
        <mesh position={[0, 2.3, 0]} castShadow>
          <boxGeometry args={[5.2, 4.6, 4.4]} />
          <Surf color={P.rock} />
        </mesh>
        {/* ink roof panels */}
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * 1.45, 5.65, 0]} rotation={[0, 0, -side * 0.62]} castShadow>
            <boxGeometry args={[3.4, 0.45, 5.3]} />
            <Surf color={P.basalt} />
          </mesh>
        ))}
        {/* THE chimney, taller than the house */}
        <mesh position={[1.5, 7.6, -0.9]} castShadow>
          <boxGeometry args={[1.5, 7, 1.5]} />
          <Surf color={P.basalt} />
        </mesh>
        <mesh position={[1.5, 11.35, -0.9]} castShadow>
          <boxGeometry args={[2.1, 0.5, 2.1]} />
          <Surf color={P.basalt} />
        </mesh>
        {/* open door glow + lintel */}
        <mesh position={[-1.1, 1.45, 2.22]}>
          <boxGeometry args={[2, 2.9, 0.16]} />
          <Lava night={night} intensity={2} />
        </mesh>
        <mesh position={[-1.1, 3.1, 2.3]} castShadow>
          <boxGeometry args={[2.6, 0.4, 0.45]} />
          <Surf color={P.basalt} />
        </mesh>
        {/* lean-to workshop */}
        <mesh position={[-3.5, 1.3, 0.2]} castShadow>
          <boxGeometry args={[2.2, 2.6, 3.4]} />
          <Surf color={P.rock} />
        </mesh>
        <mesh position={[-3.6, 2.9, 0.2]} rotation={[0, 0, 0.3]} castShadow>
          <boxGeometry args={[2.8, 0.35, 3.8]} />
          <Surf color={P.basalt} />
        </mesh>
        {/* basalt step stone */}
        <mesh position={[-1.1, 0.15, 3.1]} castShadow>
          <cylinderGeometry args={[1.2, 1.4, 0.3, 6]} />
          <Surf color={P.basalt} />
        </mesh>
      </group>
    </group>
  )
}

const PUFF: readonly (readonly [number, number, number, number])[] = [
  // [x, y, z, radius]
  [0, 5.2, 0, 1.2],
  [0, 8.2, 0, 2.7],
  [-2, 7.2, 0.5, 1.9],
  [1.9, 7.5, -0.3, 1.8],
  [0.6, 10.2, 0.3, 1.7],
]

/** P4 — ember rock + smoke puff. Authored 12.2 m; the puff is bigger than the rock. */
function EmberRock({ night, puff }: { night: boolean; puff: RefObject<THREE.Group | null> }) {
  const slot = place('front-right')
  return (
    <group position={slot.position} rotation={outwardRotation(slot)}>
      <group scale={slot.height / 12.2}>
        <mesh position={[0, 2, 0]} scale={[2.5, 2.1, 2.3]} rotation={[0.2, 0.5, 0.1]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.crust} />
        </mesh>
        {/* lava seeping out under the rock */}
        <mesh position={[0.5, 0.25, 0.5]}>
          <cylinderGeometry args={[2, 2.3, 0.5, 7]} />
          <Lava night={night} />
        </mesh>
        {/* three ember cracks on the faces */}
        <mesh position={[1, 2.3, 1.9]} rotation={[0.3, 0.4, 0.5]}>
          <boxGeometry args={[0.3, 2.9, 0.3]} />
          <Lava night={night} />
        </mesh>
        <mesh position={[-1.4, 1.8, 1.7]} rotation={[0.2, -0.3, -0.6]}>
          <boxGeometry args={[0.3, 2.4, 0.3]} />
          <Lava night={night} />
        </mesh>
        <mesh position={[0.2, 3.5, 1.5]} rotation={[0.45, 0.2, 0.15]}>
          <boxGeometry args={[2.4, 0.3, 0.3]} />
          <Lava night={night} />
        </mesh>
        {/* THE smoke puff */}
        <group ref={puff}>
          {PUFF.map(([x, y, z, radius], index) => (
            <mesh key={index} position={[x, y, z]} castShadow>
              <sphereGeometry args={[radius, 7, 5]} />
              <Surf color={P.smoke} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

/** Six ember cracks crossing the basalt crust, between the rim blocks. Part of the rim treatment. */
function RimCracks({ night }: { night: boolean }) {
  return (
    <group>
      {Array.from({ length: 6 }, (_, index) => {
        const angle = (index / 6) * Math.PI * 2 + Math.PI / 12
        const length = index % 2 === 0 ? 2.6 : 2
        return (
          <mesh key={index} position={[Math.sin(angle) * 15.3, BASE_TOP + 0.22, Math.cos(angle) * 15.3]} rotation={[0, angle, 0]}>
            <boxGeometry args={[0.42, 0.2, length]} />
            <Lava night={night} />
          </mesh>
        )
      })}
    </group>
  )
}

function Props({ propCount, night }: BouquetPropsProps) {
  const puff = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (puff.current) puff.current.position.y = Math.sin(clock.elapsedTime * 1.3) * 0.35
  })
  return (
    <group>
      <CraterCone night={night} />
      <BasaltColumns />
      {propCount >= 3 && <ForgeHouse night={night} />}
      {propCount >= 4 && <EmberRock night={night} puff={puff} />}
      <RimCracks night={night} />
    </group>
  )
}

/** Chunky basalt crust: 12 irregular blocks around the plinth edge. */
function Rim({ color }: { color: string }) {
  return (
    <group>
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2 + Math.sin(index * 1.7) * 0.07
        const width = 2.3 + (index % 3) * 0.45
        const height = 0.7 + (index % 2) * 0.3
        return (
          <mesh
            key={index}
            position={[Math.sin(angle) * (BASE_RADIUS + 0.15), BASE_TOP - 0.3 + height * 0.3, Math.cos(angle) * (BASE_RADIUS + 0.15)]}
            rotation={[index % 2 ? 0.06 : -0.05, angle, index % 3 ? 0.08 : -0.06]}
            castShadow
          >
            <boxGeometry args={[width, height, 1.3]} />
            <Surf color={index % 3 === 0 ? P.basalt : color} />
          </mesh>
        )
      })}
    </group>
  )
}

export const volcanic: BiomeBouquet = {
  spec: {
    id: 'volcanic',
    name: 'Cinder Forge Burst',
    silhouette: 'A dark truncated cone wearing a thick orange rim, ink organ-pipe columns at its left foot and a white smoke puff front-right, over a tan disc on an ink side.',
    hero: 'crater-cone',
    elements: [
      { id: 'crater-cone', height: 32, slot: 'hero' },
      { id: 'basalt-columns', height: 28, slot: 'front-left' },
      { id: 'forge-house', height: 28, slot: 'back-right' },
      { id: 'ember-rock', height: 24, slot: 'front-right' },
    ],
    rim: 'Chunky basalt crust: 12 irregular dark blocks around the plinth edge, cut by 6 radial ember cracks that are orange by day and emissive at night.',
    exaggeration: 'A crater rim as thick as a tyre: a lava torus a fifth of the cone height, orange by day and glowing at night.',
    closestProtected: 'Kirby W8 (a single volcano on a dark disc). Ours adds a five-column basalt cluster, a forge house with a chimney taller than itself and an ember rock under an oversized smoke puff, on a crusted plinth with ember cracks.',
    placements: PLACEMENTS,
  },
  Props,
  Rim,
  terrain: { primary: '#c9a08f', secondary: '#8a4a3f', rocks: true },
}
