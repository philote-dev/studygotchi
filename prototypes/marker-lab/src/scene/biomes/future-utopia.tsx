import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { Glow, Surf } from '../../render/materials'
import {
  BASE_RADIUS,
  BASE_TOP,
  BOUQUET_PLACEMENTS,
  outwardRotation,
  placementFor,
  type BouquetPlacement,
  type TerrainLobe,
} from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/** Roster row hexes (globe-markers.md §3, re-tinted pedestal in markers.ts) plus ink / cream details. */
const P = {
  /** Day glass: mid-mint so the translucent forms keep a silhouette against the pale cell. */
  glass: '#8fcdb8',
  /** Night glass: the translucent dome must not read as a pale glow, so its albedo drops to ~half. */
  glassNight: '#5a736c',
  tile: '#c9eedd',
  side: '#5fa894',
  /** The family's dark anchor: the spire drum, one step below the pedestal side. */
  deep: '#3f8f80',
  cyan: '#3fd1c9',
  white: '#ffffff',
  canopy: '#8fc48a',
  ink: '#3a2f45',
  cream: '#f4e9d2',
} as const

/**
 * Shared slots, except the transit arch moves further out front-left so the spire's dark
 * drum (the family's 48 px anchor) is not hidden behind the arch and its oval.
 */
const PLACEMENTS: readonly BouquetPlacement[] = BOUQUET_PLACEMENTS.map((entry) =>
  entry.id === 'front-left' ? { ...entry, position: [-10.4, BASE_TOP, 2.6] } : entry,
)

/* ------------------------------------------------------------------------ */
/* P1 · civic spire: a 9 m deep-mint base and a 23 m white needle with three cyan bands (cyan by day, lit at night). */

const BASE_HEIGHT_U = 4.5
const NEEDLE_HEIGHT = 11.5
const NEEDLE_RADIUS = 2.3

function needleRadiusAt(y: number) {
  return NEEDLE_RADIUS * (1 - (y - BASE_HEIGHT_U) / NEEDLE_HEIGHT)
}

function CivicSpire({ night }: { night: boolean }) {
  const place = placementFor('hero', PLACEMENTS)
  const scale = place.height / 16
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[4.0, 4.3, 1, 6]} />
          <Surf color={P.side} />
        </mesh>
        <mesh position={[0, 2.75, 0]} castShadow>
          <cylinderGeometry args={[2.7, 3.5, 3.5, 6]} />
          <Surf color={P.deep} />
        </mesh>
        {[0, 1, 2].map((index) => {
          const angle = (index / 3) * Math.PI * 2 + 0.5
          return (
            <group key={index} rotation={[0, angle, 0]}>
              <mesh position={[0, 3.2, 3.0]} castShadow>
                <boxGeometry args={[0.45, 5.4, 1.9]} />
                <Surf color={P.glass} />
              </mesh>
              <mesh position={[0, 6.15, 3.0]} castShadow>
                <boxGeometry args={[0.55, 0.5, 2.0]} />
                <Surf color={P.ink} />
              </mesh>
            </group>
          )
        })}
        <mesh position={[0, BASE_HEIGHT_U + NEEDLE_HEIGHT / 2, 0]} castShadow>
          <coneGeometry args={[NEEDLE_RADIUS, NEEDLE_HEIGHT, 6]} />
          <Surf color={P.white} />
        </mesh>
        <mesh position={[0, BASE_HEIGHT_U + 0.4, 0]} castShadow>
          <cylinderGeometry args={[NEEDLE_RADIUS + 0.3, NEEDLE_RADIUS + 0.6, 1.0, 6]} />
          <Surf color={P.ink} />
        </mesh>
        {[6.6, 9.4, 12.2].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <cylinderGeometry args={[needleRadiusAt(y + 0.3) + 0.22, needleRadiusAt(y - 0.3) + 0.22, 0.6, 6]} />
            <Glow color={P.cyan} offColor={P.cyan} on={night} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */
/* P2 · transit arch: a glass arch with a flat horizontal oval monorail around it, one pod riding the oval. */

const OVAL_RADIUS = 4.4
const OVAL_STRETCH: readonly [number, number] = [1.35, 0.8]
const OVAL_Y = 5.6

function TransitArch({ pod }: { pod: RefObject<THREE.Group | null> }) {
  const place = placementFor('front-left', PLACEMENTS)
  // Reviewed at 0.6 of the slot: the oval sits below the spire's mid-height, never a standing ring.
  const scale = (place.height * 0.6) / 14
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <cylinderGeometry args={[5.2, 5.6, 0.8, 8]} />
          <Surf color={P.side} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * 3.2, 5.2, 0]} castShadow>
            <cylinderGeometry args={[0.85, 1.1, 9.6, 6]} />
            <Surf color={P.side} />
          </mesh>
        ))}
        <mesh position={[0, 10.0, 0]} castShadow>
          <torusGeometry args={[3.2, 0.75, 8, 12, Math.PI]} />
          <Surf color={P.glass} />
        </mesh>
        <mesh position={[0, 13.3, 0]} castShadow>
          <boxGeometry args={[2.2, 1.0, 2.2]} />
          <Surf color={P.white} />
        </mesh>
        <group position={[0, OVAL_Y, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[OVAL_STRETCH[0], OVAL_STRETCH[1], 1]}>
          <mesh castShadow>
            <torusGeometry args={[OVAL_RADIUS, 0.42, 6, 24]} />
            <Surf color={P.white} />
          </mesh>
        </group>
        <group ref={pod} position={[OVAL_RADIUS * OVAL_STRETCH[0], OVAL_Y + 0.75, 0]}>
          <mesh castShadow>
            <boxGeometry args={[2.6, 1.3, 1.6]} />
            <Surf color={P.white} />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <boxGeometry args={[2.7, 0.5, 1.7]} />
            <Surf color={P.ink} />
          </mesh>
        </group>
        {[0.9, 2.3, 3.9, 5.2].map((angle) => (
          <mesh
            key={angle}
            position={[Math.cos(angle) * OVAL_RADIUS * OVAL_STRETCH[0], OVAL_Y / 2 + 0.3, Math.sin(angle) * OVAL_RADIUS * OVAL_STRETCH[1]]}
            castShadow
          >
            <cylinderGeometry args={[0.24, 0.32, OVAL_Y - 0.6, 6]} />
            <Surf color={P.white} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */
/* P3 · garden dome: a glass rotunda over one 12 m solid green canopy that pokes out of the oculus. */

function GardenDome({ night }: { night: boolean }) {
  const place = placementFor('back-right', PLACEMENTS)
  const scale = place.height / 13
  const glass = night ? P.glassNight : P.glass
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[5.1, 5.5, 1, 7]} />
          <Surf color={P.side} />
        </mesh>
        <mesh position={[0, 3.2, 0]} castShadow>
          <cylinderGeometry args={[0.6, 0.85, 4.6, 6]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, 8.8, 0]} scale={[3.0, 3.6, 3.0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.canopy} />
        </mesh>
        <mesh position={[0, 3.6, 0]}>
          <cylinderGeometry args={[4.6, 4.8, 5.2, 7, 1, true]} />
          <Surf color={glass} transparent opacity={0.55} />
        </mesh>
        <mesh position={[0, 6.2, 0]}>
          <sphereGeometry args={[4.6, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <Surf color={glass} transparent opacity={0.55} />
        </mesh>
        <mesh position={[0, 10.3, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[1.95, 0.32, 6, 12]} />
          <Surf color={P.white} />
        </mesh>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */
/* P4 · hover lamps: two white stems, each crowned by cyan rings wider than the lamp head. */

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
        <torusGeometry args={[height * 0.15, height * 0.018, 4, 10]} />
        <Glow color={P.cyan} offColor={P.cyan} on={night} />
      </mesh>
      <mesh position={[0, headY + height * 0.11, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[height * 0.095, height * 0.016, 4, 10]} />
        <Glow color={P.cyan} offColor={P.cyan} on={night} />
      </mesh>
    </group>
  )
}

function HoverLamps({ night }: { night: boolean }) {
  const place = placementFor('front-right', PLACEMENTS)
  const scale = place.height / 12
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <HoverLamp position={[2.6, 0, 0.4]} height={12} night={night} lean={-0.06} />
        <HoverLamp position={[0.6, 0, 2.8]} height={7.6} night={night} lean={0.1} />
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */

const STRIP_Y = BASE_TOP - 0.2
const STRIP_HEIGHT = 0.3

/**
 * The roster-sanctioned rim emissive: at night a lit copy of the lip strip sits a hair outside
 * the Rim's own strip. By day it is not rendered, so the Rim's lip colour is what shows.
 */
function LightStrip({ night }: { night: boolean }) {
  if (!night) return null
  return (
    <mesh position={[0, STRIP_Y, 0]} rotation={[0, Math.PI / 12, 0]}>
      <cylinderGeometry args={[BASE_RADIUS + 0.46, BASE_RADIUS + 0.46, STRIP_HEIGHT, 12]} />
      <Glow color={P.cyan} on />
    </mesh>
  )
}

function Props({ propCount, night }: BouquetPropsProps) {
  const pod = useRef<THREE.Group>(null)
  // One useFrame for the family: the pod circles the flat oval monorail.
  useFrame(({ clock }) => {
    if (!pod.current) return
    const angle = clock.elapsedTime * 0.45
    pod.current.position.x = Math.cos(angle) * OVAL_RADIUS * OVAL_STRETCH[0]
    pod.current.position.z = Math.sin(angle) * OVAL_RADIUS * OVAL_STRETCH[1]
    pod.current.rotation.y = -Math.atan2(Math.cos(angle) * OVAL_STRETCH[1], -Math.sin(angle) * OVAL_STRETCH[0])
  })
  return (
    <group>
      <LightStrip night={night} />
      <CivicSpire night={night} />
      <TransitArch pod={pod} />
      {propCount >= 3 && <GardenDome night={night} />}
      {propCount >= 4 && <HoverLamps night={night} />}
    </group>
  )
}

/** Flush glass edge: a smooth 12-facet glass lip with the 0.3 m lip-colour strip (cyan) flush along its top. */
function Rim({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, BASE_TOP - 0.7, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
        <cylinderGeometry args={[BASE_RADIUS + 0.4, BASE_RADIUS + 0.2, 0.7, 12]} />
        <Surf color={P.glass} />
      </mesh>
      <mesh position={[0, STRIP_Y, 0]} rotation={[0, Math.PI / 12, 0]}>
        <cylinderGeometry args={[BASE_RADIUS + 0.4, BASE_RADIUS + 0.4, STRIP_HEIGHT, 12]} />
        <Surf color={color} />
      </mesh>
    </group>
  )
}

/**
 * Flat tile terraces: low plates, no scatter rocks on a civic plaza. BouquetBase tints every
 * third plate (indexes 0 and 3) in the side colour, so the spire's back plate and the front
 * plate are listed there: two mid-mint shelves that anchor the pale disc.
 */
const TERRACES: readonly TerrainLobe[] = [
  { position: [-1.4, BASE_TOP, -5.9], radius: 6.6, height: 2.6, stretch: [1.1, 0.9] },
  { position: [0, BASE_TOP, 0], radius: 7.8, height: 1.6, stretch: [1.2, 1] },
  { position: [-6.3, BASE_TOP, 3], radius: 5.2, height: 1.5, stretch: [0.95, 1.1] },
  { position: [0.6, BASE_TOP, 5.2], radius: 4.8, height: 1.4, stretch: [1.25, 0.8] },
  { position: [5.9, BASE_TOP, -2.9], radius: 5.7, height: 1.9, stretch: [1, 0.92] },
  { position: [5.4, BASE_TOP, 3.7], radius: 5.4, height: 1.6, stretch: [1.05, 0.9] },
]

export const futureUtopia: BiomeBouquet = {
  spec: {
    id: 'future-utopia',
    name: 'Mint Needle Commons',
    silhouette: 'A white needle spire with three cyan dashes rising from a mint disc with a cyan rim line; a low glass arch, a flat monorail oval and a green dome sit at its feet.',
    hero: 'civic-spire',
    elements: [
      { id: 'civic-spire', height: 32, slot: 'hero' },
      { id: 'transit-arch', height: 28, slot: 'front-left' },
      { id: 'garden-dome', height: 28, slot: 'back-right' },
      { id: 'hover-lamp', height: 24, slot: 'front-right' },
    ],
    rim: 'Flush glass edge: a smooth mint glass lip with a 0.3 m cyan light strip along its top, emissive at night.',
    exaggeration: 'The spire is 72 percent needle: a 23 m white point on a 9 m base, so the three cyan bands read as floating dashes.',
    closestProtected: 'Kirby pedestal grammar only (disc plus props); no Kirby world has a spire. Ours is a glass-rimmed mint disc with a plain three-band needle, a flat monorail oval and a garden dome.',
    placements: PLACEMENTS,
  },
  Props,
  Rim,
  terrain: { primary: P.tile, secondary: P.side, lobes: TERRACES, rocks: false },
}
