import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { Glow, Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, outwardRotation, placementFor } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/**
 * Celestial Garden · "Orbit Bloom Nocturne"
 *
 * An indigo moss plinth studded with twelve gold stars, carrying a planet-scale
 * armillary ring, one giant star-flower, a six-post gazebo roofed only by light
 * lines, and a moon pond lifted on a stone font. At night the bloom and the
 * gazebo's light lines are the only emitters.
 */
const P = {
  soil: '#4b4f8a',
  moss: '#6b70b8',
  pale: '#dfe3ff',
  cream: '#fffaf3',
  gold: '#f8d24a',
  stem: '#8fc9d8',
  water: '#9fd3e0',
  ink: '#3a2f45',
} as const

/** The accent bloom stays gold by day and emits the same gold at night. */
function Bloom({ night }: { night: boolean }) {
  return <Surf color={P.gold} emissive={night ? P.gold : '#000000'} emissiveIntensity={night ? 1.6 : 0} />
}

// ---------------------------------------------------------------------------
// P1 · armillary orbit ring on a post (hero, 32 m)
// A short pale post holds a hub; around it a hoop wider than the plinth, a
// second tilted hoop that slowly precesses, and a small meridian ring.
// ---------------------------------------------------------------------------

const ARMILLARY_AUTHORED_HEIGHT = 14
const HUB_Y = 8.6
const ORBIT_RADIUS = 7.3
const ORBIT_TUBE = 1.0

function Armillary() {
  const place = placementFor('hero')
  const precess = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (precess.current) precess.current.rotation.y = clock.elapsedTime * 0.28
  })

  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / ARMILLARY_AUTHORED_HEIGHT}>
        <mesh position={[0, 0.35, 0]} scale={[2.3, 0.7, 2.3]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.pale} />
        </mesh>
        <mesh position={[0, 3.9, 0]} castShadow>
          <cylinderGeometry args={[0.5, 0.78, 7.8, 8]} />
          <Surf color={P.pale} />
        </mesh>
        <mesh position={[0, 7.95, 0]} castShadow>
          <cylinderGeometry args={[1.15, 0.7, 0.8, 8]} />
          <Surf color={P.pale} />
        </mesh>
        <mesh position={[0, HUB_Y, 0]} castShadow>
          <sphereGeometry args={[1.15, 7, 5]} />
          <Surf color={P.cream} />
        </mesh>
        {/* the orbit: high at the back, dipping toward the viewer so its front arc crosses the indigo terrain */}
        <group position={[0, HUB_Y, 0]} rotation={[0, 0, -0.3]}>
          <group rotation={[-Math.PI / 2 + 0.3, 0, 0]}>
            <mesh castShadow>
              <torusGeometry args={[ORBIT_RADIUS, ORBIT_TUBE, 8, 24]} />
              <Surf color={P.pale} />
            </mesh>
            {/* ink orbit line hugging the outer edge so the hoop reads against a pale sky */}
            <mesh>
              <torusGeometry args={[ORBIT_RADIUS + ORBIT_TUBE * 0.98, 0.4, 6, 24]} />
              <Surf color={P.ink} />
            </mesh>
            {/* a small soil-dark planet riding the orbit */}
            <mesh position={[ORBIT_RADIUS * 0.72, ORBIT_RADIUS * 0.69, 0]} castShadow>
              <dodecahedronGeometry args={[1.35, 0]} />
              <Surf color={P.soil} />
            </mesh>
          </group>
        </group>
        {/* the precessing inner hoop */}
        <group ref={precess} position={[0, HUB_Y, 0]}>
          <group rotation={[0, 0, 0.85]}>
            <mesh rotation={[-0.5, 0, 0]} castShadow>
              <torusGeometry args={[3.6, 0.45, 8, 24]} />
              <Surf color={P.pale} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// P2 · giant star-flower (front-left, 28 m)
// A bent mint stem with two leaves, topped by a five-point gold bloom whose
// span is nine times the stem's width. Bloom glows at night.
// ---------------------------------------------------------------------------

const FLOWER_AUTHORED_HEIGHT = 16
const PETAL_COUNT = 5

function StarFlower({ night }: { night: boolean }) {
  const place = placementFor('front-left')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / FLOWER_AUTHORED_HEIGHT}>
        <mesh position={[0, 3.5, 0]} castShadow>
          <cylinderGeometry args={[0.52, 0.72, 7.2, 7]} />
          <Surf color={P.stem} />
        </mesh>
        <mesh position={[-0.6, 9.3, 0.3]} rotation={[0.08, 0, 0.22]} castShadow>
          <cylinderGeometry args={[0.42, 0.54, 5.0, 7]} />
          <Surf color={P.stem} />
        </mesh>
        <mesh position={[1.7, 3.4, 0.5]} rotation={[0, 0.3, 0.5]} scale={[2.7, 0.5, 1.25]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.stem} />
        </mesh>
        <mesh position={[-1.9, 5.8, -0.3]} rotation={[0, -0.4, -0.6]} scale={[2.3, 0.45, 1.05]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.stem} />
        </mesh>
        <group position={[-1.3, 12.0, 0.7]} rotation={[0.55, 0, 0.25]}>
          <mesh castShadow>
            <sphereGeometry args={[1.6, 7, 5]} />
            <Bloom night={night} />
          </mesh>
          {Array.from({ length: PETAL_COUNT }, (_, index) => {
            const angle = (index / PETAL_COUNT) * Math.PI * 2 + Math.PI / 2
            return (
              <mesh key={index} position={[Math.cos(angle) * 2.7, Math.sin(angle) * 2.7, 0]} rotation={[0, 0, angle - Math.PI / 2]} castShadow>
                <coneGeometry args={[1.4, 4.4, 4]} />
                <Bloom night={night} />
              </mesh>
            )
          })}
        </group>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// P3 · constellation gazebo (back-right, 28 m)
// Six pale posts on a hexagonal floor; the roof is nothing but light lines: a
// hexagon of beams and three ribs meeting at an apex star.
// ---------------------------------------------------------------------------

const GAZEBO_AUTHORED_HEIGHT = 13.8
const GAZEBO_RADIUS = 4.0
const POST_TOP = 9.6
const APEX_Y = 12.6
const RIB_LENGTH = Math.hypot(GAZEBO_RADIUS, APEX_Y - POST_TOP)
const RIB_TILT = Math.atan2(GAZEBO_RADIUS, APEX_Y - POST_TOP)

function ConstellationGazebo({ night }: { night: boolean }) {
  const place = placementFor('back-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / GAZEBO_AUTHORED_HEIGHT}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[4.9, 5.3, 0.6, 6]} />
          <Surf color={P.pale} />
        </mesh>
        {Array.from({ length: 6 }, (_, index) => {
          const angle = (index / 6) * Math.PI * 2
          return (
            <mesh key={index} position={[Math.cos(angle) * GAZEBO_RADIUS, POST_TOP / 2 + 0.3, Math.sin(angle) * GAZEBO_RADIUS]} castShadow>
              <cylinderGeometry args={[0.42, 0.52, POST_TOP - 0.6, 6]} />
              <Surf color={P.pale} />
            </mesh>
          )
        })}
        <mesh position={[0, POST_TOP, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[GAZEBO_RADIUS, 0.3, 4, 6]} />
          <Glow color={P.pale} on={night} />
        </mesh>
        {[0, 2, 4].map((index) => {
          const angle = (index / 6) * Math.PI * 2
          return (
            <group key={index} rotation={[0, -angle, 0]}>
              <mesh position={[GAZEBO_RADIUS / 2, (POST_TOP + APEX_Y) / 2, 0]} rotation={[0, 0, RIB_TILT]}>
                <cylinderGeometry args={[0.24, 0.24, RIB_LENGTH, 5]} />
                <Glow color={P.pale} on={night} />
              </mesh>
            </group>
          )
        })}
        <mesh position={[0, APEX_Y + 0.4, 0]} castShadow>
          <dodecahedronGeometry args={[1.05, 0]} />
          <Glow color={P.pale} on={night} />
        </mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// P4 · moon-pond basin (front-right, 24 m)
// The pond is lifted on a stone font so it reaches its slot height: a slim
// pale stem under a bowl five times its width, filled with still water, with a
// cream crescent standing in it.
// ---------------------------------------------------------------------------

const POND_AUTHORED_HEIGHT = 18.5

function MoonPond() {
  const place = placementFor('front-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / POND_AUTHORED_HEIGHT}>
        <mesh position={[0, 0.4, 0]} scale={[2.5, 0.8, 2.5]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.pale} />
        </mesh>
        <mesh position={[0, 5.7, 0]} castShadow>
          <cylinderGeometry args={[0.9, 1.5, 10.6, 8]} />
          <Surf color={P.pale} />
        </mesh>
        <mesh position={[0, 12.3, 0]} castShadow>
          <cylinderGeometry args={[4.9, 1.7, 2.6, 8]} />
          <Surf color={P.pale} />
        </mesh>
        <mesh position={[0, 14.0, 0]} castShadow>
          <cylinderGeometry args={[5.6, 5.0, 0.9, 8]} />
          <Surf color={P.pale} />
        </mesh>
        <mesh position={[0, 14.32, 0]}>
          <cylinderGeometry args={[5.05, 5.05, 0.3, 8]} />
          <Surf color={P.water} />
        </mesh>
        <mesh position={[0.4, 15.5, 0.3]} rotation={[0, 0, 0.9]} castShadow>
          <torusGeometry args={[2.4, 0.6, 6, 16, 3.6]} />
          <Surf color={P.cream} />
        </mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Rim · pale lip ring with 12 gold star studs, one per plinth facet.
// ---------------------------------------------------------------------------

function StarRim({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, BASE_TOP - 0.25, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
        <cylinderGeometry args={[BASE_RADIUS + 0.35, BASE_RADIUS + 0.2, 0.5, 12]} />
        <Surf color={color} />
      </mesh>
      {Array.from({ length: 12 }, (_, index) => (
        <group key={index} rotation={[0, (index / 12) * Math.PI * 2, 0]}>
          <mesh position={[0, BASE_TOP - 0.2, BASE_RADIUS + 0.55]} rotation={[Math.PI / 2, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[0.8, 1.3, 4]} />
            <Surf color={P.gold} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------

function CelestialProps({ propCount, night }: BouquetPropsProps) {
  return (
    <group>
      <Armillary />
      <StarFlower night={night} />
      {propCount >= 3 && <ConstellationGazebo night={night} />}
      {propCount >= 4 && <MoonPond />}
    </group>
  )
}

export const celestialGarden: BiomeBouquet = {
  spec: {
    id: 'celestial-garden',
    name: 'Orbit Bloom Nocturne',
    silhouette: 'A pale tilted ring wider than the indigo disc under it, with one gold star-flower bloom hanging at its front-left edge.',
    hero: 'armillary',
    elements: [
      { id: 'armillary', height: 32, slot: 'hero' },
      { id: 'star-flower', height: 28, slot: 'front-left' },
      { id: 'constellation-gazebo', height: 28, slot: 'back-right' },
      { id: 'moon-pond', height: 24, slot: 'front-right' },
    ],
    rim: 'Pale moss lip ring carrying 12 gold four-point star studs, one every 30 degrees, each stud a flattened octahedron sitting proud of the edge.',
    exaggeration: 'The armillary ring is wider than the plinth it stands on: a 32 m tilted hoop pair on a short post, so the whole marker reads as a ring first and a garden second.',
    closestProtected: 'Kirby W3 (pines on a soft dough disc) is the only shared shape class (a tree-like bloom). Ours puts a planet-scale armillary, a six-post gazebo and a moon pond on a star-studded indigo plinth; no pines, no dough.',
  },
  Props: CelestialProps,
  Rim: StarRim,
  terrain: { primary: P.moss, secondary: P.soil, rocks: true },
}
