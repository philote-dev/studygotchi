"use client";

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { Glow, Surf } from '../materials'
import { BASE_RADIUS, BASE_TOP, type TerrainLobe, outwardRotation, placementFor } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/** Swamp palette: the roster row plus pedestal hexes, ink and cream for details. */
const P = {
  peat: '#4f5a3f',
  mud: '#6f7f5a',
  reed: '#a3a05f',
  duckweed: '#8fa860',
  cypress: '#5a6e50',
  moss: '#a3b080',
  timber: '#786557',
  paper: '#f2c14e',
  lily: '#b58aa8',
  ink: '#3a2f45',
  cream: '#f4e9d2',
  window: '#ffe9a8',
} as const

/** Moss curtains hanging off the crown tiers: [angle, radius, length, top radius, hang-from y]. Angle 0 faces the camera. */
const MOSS_CURTAINS: readonly (readonly [number, number, number, number, number])[] = [
  [0.1, 3.4, 12, 2.0, 26.2],
  [0.65, 7.2, 9.5, 1.8, 26.0],
  [1.5, 6.6, 8, 1.5, 26.0],
  [2.6, 6.0, 7, 1.4, 26.0],
  [3.6, 6.6, 8.5, 1.5, 26.0],
  [4.7, 7.0, 9, 1.7, 26.0],
  [5.6, 5.6, 11, 1.9, 26.2],
  [0.9, 4.6, 7.5, 1.4, 28.8],
  [5.0, 4.2, 8, 1.5, 28.8],
]

/** Three stacked crown tiers, widths 0.8 / 0.6 / 0.4 of the old 22 m disc: [x, y, z, half width, half depth, yaw]. */
const CROWN_TIERS: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 26.4, 0, 8.8, 7.7, 0.3],
  [0.6, 28.6, -0.4, 6.6, 5.8, -0.2],
  [-0.3, 30.6, 0.3, 4.4, 3.9, 0.5],
]

/** P1: bald cypress, authored at 32 m. Dark buttressed trunk, three stacked crown tiers, moss curtains longer than the trunk is wide. */
function BaldCypress() {
  const place = placementFor('hero')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 32}>
        <mesh position={[0, 2.8, 0]} castShadow>
          <coneGeometry args={[5.0, 5.6, 7]} />
          <Surf color={P.peat} />
        </mesh>
        <mesh position={[0, 14, 0]} castShadow>
          <cylinderGeometry args={[1.6, 2.7, 24, 8]} />
          <Surf color={P.peat} />
        </mesh>
        <mesh position={[4.0, 1.0, 2.6]} rotation={[0.1, 0, -0.2]} castShadow>
          <coneGeometry args={[0.9, 2.8, 5]} />
          <Surf color={P.peat} />
        </mesh>
        <mesh position={[-3.8, 0.8, 3.1]} rotation={[0.15, 0, 0.25]} castShadow>
          <coneGeometry args={[0.8, 2.4, 5]} />
          <Surf color={P.peat} />
        </mesh>
        <mesh position={[-4.0, 24.2, 0.6]} rotation={[0, 0, 1.15]} castShadow>
          <cylinderGeometry args={[0.45, 0.8, 8.2, 6]} />
          <Surf color={P.peat} />
        </mesh>
        <mesh position={[3.9, 25.4, -0.9]} rotation={[0.2, 0, -1.05]} castShadow>
          <cylinderGeometry args={[0.4, 0.75, 7.8, 6]} />
          <Surf color={P.peat} />
        </mesh>
        <mesh position={[0, 28.5, 0]} castShadow>
          <cylinderGeometry args={[0.6, 1.0, 5, 6]} />
          <Surf color={P.peat} />
        </mesh>
        {CROWN_TIERS.map(([x, y, z, halfWidth, halfDepth, yaw], index) => (
          <mesh key={index} position={[x, y, z]} scale={[halfWidth, 1.5 - index * 0.1, halfDepth]} rotation={[0, yaw, 0]} castShadow>
            <dodecahedronGeometry args={[1, 0]} />
            <Surf color={P.cypress} />
          </mesh>
        ))}
        {MOSS_CURTAINS.map(([angle, radius, length, top, hangFrom], index) => (
          <group key={index} rotation={[0, angle, 0]}>
            <mesh
              position={[0, hangFrom - length / 2, radius]}
              rotation={[Math.PI - 0.06, 0, index % 2 ? 0.05 : -0.05]}
              scale={[1.5, 1, 0.6]}
              castShadow
            >
              <coneGeometry args={[top, length, 5]} />
              <Surf color={P.moss} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

const STILTS: readonly (readonly [number, number])[] = [
  [-1.7, -1.4],
  [1.7, -1.4],
  [-1.7, 1.4],
  [1.7, 1.4],
]

/** P2: stilt hut on a boardwalk, authored at 14 m. The stilts are taller than the hut they carry. */
function StiltHut({ night }: { night: boolean }) {
  const place = placementFor('front-left')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 14}>
        {STILTS.map(([x, z], index) => (
          <mesh key={index} position={[x, 3.8, z]} castShadow>
            <cylinderGeometry args={[0.2, 0.26, 7.6, 6]} />
            <Surf color={P.timber} />
          </mesh>
        ))}
        <mesh position={[0, 7.8, 0]} castShadow>
          <boxGeometry args={[5.6, 0.4, 4.8]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[0, 9.5, 0]} castShadow>
          <boxGeometry args={[3.8, 3, 3.2]} />
          <Surf color={P.cream} />
        </mesh>
        <mesh position={[0, 12.6, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[3.7, 3.2, 4]} />
          <Surf color={P.reed} />
        </mesh>
        <mesh position={[0.75, 9.7, 1.67]}>
          <boxGeometry args={[0.95, 0.95, 0.12]} />
          <Glow color={P.window} on={night} intensity={1.4} />
        </mesh>
        <mesh position={[-0.85, 8.9, 1.67]}>
          <boxGeometry args={[0.9, 1.7, 0.12]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[4.0, 7.7, 0.4]} castShadow>
          <boxGeometry args={[2.6, 0.3, 1.4]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[5.0, 3.8, 0.4]} castShadow>
          <cylinderGeometry args={[0.17, 0.22, 7.6, 6]} />
          <Surf color={P.timber} />
        </mesh>
      </group>
    </group>
  )
}

/** P3: lantern post, authored at 14 m. The paper lantern is far bigger than the post head it hangs from. */
function LanternPost({ night }: { night: boolean }) {
  const place = placementFor('back-right')
  const hang = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (!hang.current) return
    const t = clock.elapsedTime
    hang.current.rotation.z = Math.sin(t * 1.1) * 0.07
    hang.current.rotation.x = Math.sin(t * 0.8 + 1) * 0.04
  })
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 14}>
        <mesh position={[0, 6.5, 0]} castShadow>
          <cylinderGeometry args={[0.32, 0.46, 13, 7]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[0, 13.5, 0]} castShadow>
          <coneGeometry args={[0.7, 1, 6]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[1.5, 12.4, 0]} castShadow>
          <boxGeometry args={[3.4, 0.42, 0.42]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[1.0, 11.3, 0]} rotation={[0, 0, 0.8]} castShadow>
          <boxGeometry args={[2.6, 0.26, 0.26]} />
          <Surf color={P.timber} />
        </mesh>
        <group ref={hang} position={[2.9, 12.2, 0]}>
          <mesh position={[0, -0.6, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 1.2, 5]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, -1.35, 0]} castShadow>
            <cylinderGeometry args={[0.75, 0.75, 0.3, 7]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, -4.5, 0]} scale={[1, 1.15, 1]} castShadow>
            <sphereGeometry args={[2.6, 7, 5]} />
            <Glow color={P.paper} on={night} offColor={P.paper} />
          </mesh>
          <mesh position={[0, -4.5, 0]}>
            <cylinderGeometry args={[2.95, 2.95, 0.24, 7]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, -7.65, 0]} castShadow>
            <cylinderGeometry args={[0.6, 0.6, 0.3, 7]} />
            <Surf color={P.ink} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/** Reed stems: [x, z, height, tilt x, tilt z]. */
const REEDS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 12, 0.02, -0.06],
  [1.5, -0.8, 10.4, -0.05, 0.14],
  [-1.4, 0.5, 9.2, 0.04, -0.18],
  [0.7, 1.6, 8.2, 0.16, 0.08],
]

/** P4: reed and lily clump, authored at 12 m. Cattail reeds over two muted lily blooms on duckweed pads. */
function ReedsLily() {
  const place = placementFor('front-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 12}>
        {REEDS.map(([x, z, height, tiltX, tiltZ], index) => (
          <group key={index} position={[x, 0, z]} rotation={[tiltX, 0, tiltZ]}>
            <mesh position={[0, height / 2, 0]} castShadow>
              <cylinderGeometry args={[0.13, 0.22, height, 6]} />
              <Surf color={P.reed} />
            </mesh>
            <mesh position={[0, height - 1.7, 0]} castShadow>
              <cylinderGeometry args={[0.42, 0.42, 1.8, 6]} />
              <Surf color={P.ink} />
            </mesh>
          </group>
        ))}
        <mesh position={[-1.8, 0.9, 1.0]} rotation={[0, 0.4, 0]} castShadow>
          <cylinderGeometry args={[2.3, 2.3, 0.3, 7]} />
          <Surf color={P.duckweed} />
        </mesh>
        <mesh position={[1.6, 0.9, 1.6]} rotation={[0, -0.6, 0]} castShadow>
          <cylinderGeometry args={[1.7, 1.7, 0.3, 7]} />
          <Surf color={P.duckweed} />
        </mesh>
        <mesh position={[-1.8, 1.55, 1.0]} scale={[1.0, 0.75, 1.0]} rotation={[0, 0.3, 0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.lily} />
        </mesh>
        <mesh position={[-1.8, 2.25, 1.0]} castShadow>
          <sphereGeometry args={[0.3, 7, 5]} />
          <Surf color={P.cream} />
        </mesh>
        <mesh position={[1.6, 1.3, 1.6]} scale={[0.58, 0.45, 0.58]} rotation={[0, 0.9, 0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.lily} />
        </mesh>
      </group>
    </group>
  )
}

/** Duckweed rafts on the open water: [x, z, radius, yaw]. */
const WATER_DUCKWEED: readonly (readonly [number, number, number, number])[] = [
  [-2.6, 4.6, 1.2, 0.3],
  [1.4, 1.2, 0.9, 1.4],
]

/** The dark water lobe between the hummocks, always present. */
function SwampWater() {
  return (
    <group>
      <mesh position={[-0.6, BASE_TOP + 0.14, 3.2]} scale={[1.2, 1, 0.95]} rotation={[0, 0.2, 0]} receiveShadow>
        <cylinderGeometry args={[6.2, 6.2, 0.24, 12]} />
        <Surf color={P.peat} />
      </mesh>
      {WATER_DUCKWEED.map(([x, z, radius, yaw], index) => (
        <mesh key={index} position={[x, BASE_TOP + 0.32, z]} scale={[1.3, 1, 0.85]} rotation={[0, yaw, 0]}>
          <cylinderGeometry args={[radius, radius, 0.12, 7]} />
          <Surf color={P.duckweed} />
        </mesh>
      ))}
    </group>
  )
}

function Props({ propCount, night }: BouquetPropsProps) {
  return (
    <group>
      <SwampWater />
      <BaldCypress />
      <StiltHut night={night} />
      {propCount >= 3 && <LanternPost night={night} />}
      {propCount >= 4 && <ReedsLily />}
    </group>
  )
}

/** Duckweed patches on the plinth cap: [angle, radius from centre, patch radius]. */
const RIM_DUCKWEED: readonly (readonly [number, number, number])[] = [
  [0.5, 14.4, 1.2],
  [1.8, 14.7, 0.9],
  [3.9, 14.2, 1.4],
  [5.2, 14.6, 1.0],
]

/** Reed-tuft edge: thin reed fans and dark root knuckles around the lip, duckweed patches on top. */
function Rim({ color }: { color: string }) {
  return (
    <group>
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2 + 0.2
        const radius = BASE_RADIUS + 0.15
        const height = index % 3 === 0 ? 2.8 : 2.2
        return (
          <group key={index} position={[Math.sin(angle) * radius, BASE_TOP - 0.3, Math.cos(angle) * radius]} rotation={[0, angle, 0]}>
            <mesh position={[0, height / 2 - 0.5, 0]} rotation={[0.18, 0, 0]} scale={[1.5, 1, 0.55]} castShadow>
              <coneGeometry args={[0.45, height, 5]} />
              <Surf color={color} />
            </mesh>
          </group>
        )
      })}
      {Array.from({ length: 6 }, (_, index) => {
        const angle = (index / 6) * Math.PI * 2 + 0.2 + Math.PI / 12
        const radius = BASE_RADIUS + 0.3
        return (
          <mesh
            key={index}
            position={[Math.sin(angle) * radius, BASE_TOP - 0.25, Math.cos(angle) * radius]}
            rotation={[0.3, angle, 0.2]}
            scale={[1.0, 0.6, 0.8]}
            castShadow
          >
            <dodecahedronGeometry args={[1, 0]} />
            <Surf color={P.peat} />
          </mesh>
        )
      })}
      {RIM_DUCKWEED.map(([angle, radius, size], index) => (
        <mesh
          key={index}
          position={[Math.sin(angle) * radius, BASE_TOP + 0.14, Math.cos(angle) * radius]}
          scale={[1.3, 1, 0.9]}
          rotation={[0, angle, 0]}
        >
          <cylinderGeometry args={[size, size, 0.12, 7]} />
          <Surf color={P.duckweed} />
        </mesh>
      ))}
    </group>
  )
}

/** Hummocks around a dark water lobe; indices 0 and 3 render in the secondary (peat) colour. */
const SWAMP_LOBES: readonly TerrainLobe[] = [
  { position: [-9, BASE_TOP, -1], radius: 3.6, height: 2.2, stretch: [1, 1] },
  { position: [-1.5, BASE_TOP, -6], radius: 6, height: 4.2, stretch: [1.1, 0.9] },
  { position: [-7, BASE_TOP, 3], radius: 4.8, height: 3, stretch: [0.9, 1.1] },
  { position: [3.5, BASE_TOP, -7.5], radius: 3.8, height: 2.4, stretch: [1, 1] },
  { position: [6.2, BASE_TOP, -3], radius: 5.6, height: 3.4, stretch: [1, 0.9] },
  { position: [6.2, BASE_TOP, 4.4], radius: 4.8, height: 2.8, stretch: [1.05, 0.9] },
  { position: [-1.5, BASE_TOP, 8], radius: 3.4, height: 1.8, stretch: [1.25, 0.8] },
]

export const swamp: BiomeBouquet = {
  spec: {
    id: 'swamp',
    name: 'Mossy Lantern Bayou',
    silhouette: 'A tall dark cypress trunk with pale moss curtains drooping off three stacked crown tiers, over an olive disc with one yellow lantern dot at the right.',
    hero: 'bald-cypress',
    elements: [
      { id: 'bald-cypress', height: 32, slot: 'hero' },
      { id: 'stilt-hut', height: 28, slot: 'front-left' },
      { id: 'lantern-post', height: 28, slot: 'back-right' },
      { id: 'reeds-lily', height: 24, slot: 'front-right' },
    ],
    rim: 'Reed-tuft edge: thin reed cones and dark root knuckles around the peat lip, with duckweed patches floating on top of the mud.',
    exaggeration: 'Moss curtains on the cypress hang longer than the trunk is wide, and the paper lantern is bigger than the post head that carries it.',
    closestProtected: 'Kirby W6 (dark wetland with bare trees). Ours leads with a moss-draped cypress and a stilt hut on a boardwalk, adds a paper lantern and pink lilies, and sits on a peat cliff plinth rather than soft dough.',
  },
  Props,
  Rim,
  terrain: { primary: P.mud, secondary: P.peat, rocks: false, lobes: SWAMP_LOBES },
}
