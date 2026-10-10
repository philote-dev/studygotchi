import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, outwardRotation, placementFor, type TerrainLobe } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/** Roster row hexes only (globe-markers.md §3) plus ink / cream details. */
const P = {
  glass: '#c7dfd6',
  tile: '#e3f2ec',
  cyan: '#3fd1c9',
  white: '#ffffff',
  canopy: '#8fc48a',
  ink: '#3a2f45',
  cream: '#f4e9d2',
} as const

/**
 * The family accent: cyan by day (the roster asks for visible cyan bands and
 * strip), emissive cyan at night. `Glow` would grey the strip out by day, so
 * this is `Surf` with the emissive gated on `night`.
 */
function CyanLight({ night }: { night: boolean }) {
  return <Surf color={P.cyan} emissive={night ? P.cyan : '#000000'} emissiveIntensity={night ? 1.6 : 0} />
}

/* ------------------------------------------------------------------------ */
/* P1 · civic spire: 80 % needle. A 6-unit base, a 12.8-unit white point, three cyan dashes. */

const NEEDLE_BASE_Y = 3.6
const NEEDLE_HEIGHT = 12.4
const NEEDLE_RADIUS = 2.4

function needleRadiusAt(y: number) {
  return NEEDLE_RADIUS * (1 - (y - NEEDLE_BASE_Y) / NEEDLE_HEIGHT)
}

function CivicSpire({ night }: { night: boolean }) {
  const place = placementFor('hero')
  const scale = place.height / 16
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <mesh position={[0, 0.45, 0]} castShadow>
          <cylinderGeometry args={[3.1, 3.4, 0.9, 6]} />
          <Surf color={P.tile} />
        </mesh>
        <mesh position={[0, 2.25, 0]} castShadow>
          <cylinderGeometry args={[2.0, 2.5, 2.7, 6]} />
          <Surf color={P.white} />
        </mesh>
        {[0, 1, 2].map((index) => {
          const angle = (index / 3) * Math.PI * 2 + 0.5
          return (
            <mesh
              key={index}
              position={[Math.sin(angle) * 2.5, 2.8, Math.cos(angle) * 2.5]}
              rotation={[0, angle, 0]}
              castShadow
            >
              <boxGeometry args={[0.4, 4.8, 1.7]} />
              <Surf color={P.glass} />
            </mesh>
          )
        })}
        <mesh position={[0, NEEDLE_BASE_Y + NEEDLE_HEIGHT / 2, 0]} castShadow>
          <coneGeometry args={[NEEDLE_RADIUS, NEEDLE_HEIGHT, 6]} />
          <Surf color={P.white} />
        </mesh>
        {[6.0, 8.9, 11.8].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <cylinderGeometry args={[needleRadiusAt(y + 0.5) + 0.22, needleRadiusAt(y - 0.5) + 0.22, 1.0, 6]} />
            <CyanLight night={night} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */
/* P2 · transit arch: a glass arch with a monorail loop bigger than the arch, one pod riding it. */

const LOOP_RADIUS = 4.7
const LOOP_CENTRE_Y = 9.1
const LOOP_TILT = 0.22
const POD_RADIUS = LOOP_RADIUS + 0.6

function TransitArch({ pod }: { pod: RefObject<THREE.Group | null> }) {
  const place = placementFor('front-left')
  const scale = place.height / 14
  const strutY = LOOP_CENTRE_Y - LOOP_RADIUS * Math.SQRT1_2
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[4.6, 4.9, 0.6, 8]} />
          <Surf color={P.tile} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * 2.7, 4.8, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.7, 8.4, 6]} />
            <Surf color={P.glass} />
          </mesh>
        ))}
        <mesh position={[0, 9.0, 0]} castShadow>
          <torusGeometry args={[2.7, 0.55, 8, 12, Math.PI]} />
          <Surf color={P.glass} />
        </mesh>
        <group position={[0, LOOP_CENTRE_Y, 1.0]} rotation={[-LOOP_TILT, 0, 0]}>
          <mesh castShadow>
            <torusGeometry args={[LOOP_RADIUS, 0.4, 8, 24]} />
            <Surf color={P.white} />
          </mesh>
          <group ref={pod} position={[POD_RADIUS, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <mesh castShadow>
              <boxGeometry args={[2.4, 1.1, 1.5]} />
              <Surf color={P.white} />
            </mesh>
            <mesh position={[0, 0.1, 0]}>
              <boxGeometry args={[2.5, 0.45, 1.6]} />
              <Surf color={P.glass} />
            </mesh>
          </group>
        </group>
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * LOOP_RADIUS * Math.SQRT1_2, (strutY + 0.6) / 2, 1.0 + Math.sin(LOOP_TILT) * LOOP_RADIUS * Math.SQRT1_2]} castShadow>
            <cylinderGeometry args={[0.24, 0.32, strutY - 0.6, 6]} />
            <Surf color={P.white} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */
/* P3 · garden dome: a glass rotunda whose canopy is too big for it and pokes out of the oculus. */

function GardenDome() {
  const place = placementFor('back-right')
  const scale = place.height / 14
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[4.9, 5.3, 1, 7]} />
          <Surf color={P.tile} />
        </mesh>
        <mesh position={[0, 3.6, 0]} castShadow>
          <cylinderGeometry args={[0.55, 0.75, 5.4, 6]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, 6.9, 0]} scale={[3.3, 2.6, 3.3]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.canopy} />
        </mesh>
        <mesh position={[-1.4, 9.3, 0.6]} scale={[2.3, 1.9, 2.3]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.canopy} />
        </mesh>
        <mesh position={[0.6, 12.0, -0.2]} scale={[1.9, 1.8, 1.9]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.canopy} />
        </mesh>
        <mesh position={[0, 3.8, 0]}>
          <cylinderGeometry args={[4.5, 4.7, 5.6, 7, 1, true]} />
          <Surf color={P.glass} transparent opacity={0.55} />
        </mesh>
        <mesh position={[0, 6.6, 0]}>
          <sphereGeometry args={[4.5, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <Surf color={P.glass} transparent opacity={0.55} />
        </mesh>
        <mesh position={[0, 10.75, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[1.75, 0.3, 6, 12]} />
          <Surf color={P.white} />
        </mesh>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */
/* P4 · hover lamps: two white stems, each crowned by cyan rings far wider than the lamp head. */

function HoverLamp({
  position,
  height,
  night,
  lean,
}: {
  position: [number, number, number]
  height: number
  night: boolean
  lean: number
}) {
  const stemHeight = height * 0.78
  const headY = stemHeight + height * 0.09
  return (
    <group position={position} rotation={[0, 0, lean]}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[height * 0.11, height * 0.13, 0.4, 6]} />
        <Surf color={P.tile} />
      </mesh>
      <mesh position={[0, stemHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[height * 0.025, height * 0.045, stemHeight, 6]} />
        <Surf color={P.white} />
      </mesh>
      <mesh position={[0, headY, 0]} castShadow>
        <sphereGeometry args={[height * 0.09, 6, 4]} />
        <Surf color={P.white} />
      </mesh>
      <mesh position={[0, headY - height * 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[height * 0.17, height * 0.02, 5, 14]} />
        <CyanLight night={night} />
      </mesh>
      <mesh position={[0, headY + height * 0.11, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[height * 0.11, height * 0.018, 5, 14]} />
        <CyanLight night={night} />
      </mesh>
    </group>
  )
}

function HoverLamps({ night }: { night: boolean }) {
  const place = placementFor('front-right')
  const scale = place.height / 12
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <HoverLamp position={[0.6, 0, 0]} height={12} night={night} lean={-0.05} />
        <HoverLamp position={[-3.6, 0, 1.6]} height={7.6} night={night} lean={0.1} />
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */

/** The 0.3 m cyan light strip at the plinth lip, emissive at night (Rim has no `night`, so it lives here). */
function LightStrip({ night }: { night: boolean }) {
  return (
    <mesh position={[0, BASE_TOP - 0.22, 0]} rotation={[0, Math.PI / 12, 0]}>
      <cylinderGeometry args={[BASE_RADIUS + 0.42, BASE_RADIUS + 0.42, 0.3, 12]} />
      <CyanLight night={night} />
    </mesh>
  )
}

function Props({ propCount, night }: BouquetPropsProps) {
  const pod = useRef<THREE.Group>(null)
  // One useFrame for the family: the pod circles the monorail loop.
  useFrame(({ clock }) => {
    if (!pod.current) return
    const angle = clock.elapsedTime * 0.5
    pod.current.position.set(Math.cos(angle) * POD_RADIUS, Math.sin(angle) * POD_RADIUS, 0)
    pod.current.rotation.z = angle + Math.PI / 2
  })
  return (
    <group>
      <LightStrip night={night} />
      <CivicSpire night={night} />
      <TransitArch pod={pod} />
      {propCount >= 3 && <GardenDome />}
      {propCount >= 4 && <HoverLamps night={night} />}
    </group>
  )
}

/** Flush glass edge: a smooth 12-facet mint glass lip, no overhang. The cyan strip is `LightStrip` in Props. */
function Rim(_props: { color: string }) {
  return (
    <mesh position={[0, BASE_TOP - 0.55, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
      <cylinderGeometry args={[BASE_RADIUS + 0.3, BASE_RADIUS + 0.15, 0.5, 12]} />
      <Surf color={P.glass} />
    </mesh>
  )
}

/** Flat tile terraces: low plates, no scatter rocks on a civic plaza. */
const TERRACES: readonly TerrainLobe[] = [
  { position: [0, BASE_TOP, 0], radius: 7.8, height: 1.6, stretch: [1.2, 1] },
  { position: [-1.4, BASE_TOP, -5.9], radius: 6.3, height: 2.2, stretch: [1.05, 0.9] },
  { position: [-6.3, BASE_TOP, 3], radius: 5.2, height: 1.5, stretch: [0.95, 1.1] },
  { position: [5.9, BASE_TOP, -2.9], radius: 5.7, height: 1.9, stretch: [1, 0.92] },
  { position: [5.4, BASE_TOP, 3.7], radius: 5.4, height: 1.6, stretch: [1.05, 0.9] },
  { position: [0.6, BASE_TOP, 5.2], radius: 4.6, height: 1.2, stretch: [1.25, 0.8] },
]

export const futureUtopia: BiomeBouquet = {
  spec: {
    id: 'future-utopia',
    name: 'Mint Needle Commons',
    silhouette: 'A white needle spire with three cyan bands over a pale mint disc ringed by a hairline cyan strip; a glass loop and a green dome sit at its feet.',
    hero: 'civic-spire',
    elements: [
      { id: 'civic-spire', height: 32, slot: 'hero' },
      { id: 'transit-arch', height: 28, slot: 'front-left' },
      { id: 'garden-dome', height: 28, slot: 'back-right' },
      { id: 'hover-lamp', height: 24, slot: 'front-right' },
    ],
    rim: 'Flush glass edge: a smooth mint glass lip with a 0.3 m cyan light strip that goes emissive at night.',
    exaggeration: 'The spire is 80 percent needle: a 26 m white point on a 6 m base, so thin the three cyan bands read as floating dashes.',
    closestProtected: 'Kirby pedestal grammar only (disc plus props); no Kirby world has a spire. Ours is a glass-rimmed mint disc with a plain three-band needle, a monorail loop and a garden dome.',
  },
  Props,
  Rim,
  terrain: { primary: P.glass, secondary: P.tile, lobes: TERRACES, rocks: false },
}
