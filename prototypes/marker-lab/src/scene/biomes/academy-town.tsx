import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { Glow, Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, outwardRotation, placementFor, type TerrainLobe } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/**
 * Academy Town: "Ivy Quad Chime". A brick bell tower with a cupola as wide as
 * its shaft at the back, a pedimented library front-left, a flat-roofed dorm
 * and lecture hall back-right, and a round quad oak with a bench front-right,
 * all on a lawn with a pale paved axis.
 */
const P = {
  brick: '#a85a4a',
  lawn: '#9fcf7a',
  coping: '#d9d2c4',
  white: '#f4efe6',
  verdigris: '#6fa89a',
  oak: '#4f8a4a',
  timber: '#786557',
  pennant: '#2f4f8f',
  ink: '#3a2f45',
  light: '#ffe9a8',
} as const

/** One-mesh gable: a three-segment cylinder laid along Z with its ridge up. */
function Gable({
  x,
  baseY,
  z,
  width,
  depth,
  rise,
  color,
}: {
  x: number
  baseY: number
  z: number
  width: number
  depth: number
  rise: number
  color: string
}) {
  const radius = width / 2 / 0.866
  const stretch = rise / (1.5 * radius)
  return (
    <mesh position={[x, baseY + rise / 3, z]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, stretch]} castShadow>
      <cylinderGeometry args={[radius, radius, depth, 3]} />
      <Surf color={color} />
    </mesh>
  )
}

const TOWER_HEIGHT = 17.8
const OCTAGON = Math.PI / 8

/** P1: brick bell tower; the white cupola drum is wider than the shaft, under an oversized verdigris cap and a waving pennant. */
function BellTower() {
  const place = placementFor('hero')
  const flag = useRef<Group>(null)
  useFrame(({ clock }) => {
    const pennant = flag.current
    if (!pennant) return
    pennant.rotation.y = 0.2 + Math.sin(clock.elapsedTime * 2.6) * 0.3
  })
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / TOWER_HEIGHT}>
        <mesh position={[0, 1, 0]} castShadow>
          <boxGeometry args={[4.8, 2, 4.8]} />
          <Surf color={P.brick} />
        </mesh>
        <mesh position={[0, 6.8, 0]} castShadow>
          <boxGeometry args={[3.4, 9.6, 3.4]} />
          <Surf color={P.brick} />
        </mesh>
        <mesh position={[0, 8.4, 1.77]}>
          <boxGeometry args={[0.7, 2.6, 0.14]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, 4.6, 1.77]}>
          <boxGeometry args={[0.7, 1.8, 0.14]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, 11.9, 0]} castShadow>
          <boxGeometry args={[5, 0.6, 5]} />
          <Surf color={P.white} />
        </mesh>
        <mesh position={[0, 13.5, 0]} rotation={[0, OCTAGON, 0]} castShadow>
          <cylinderGeometry args={[2.7, 2.7, 2.6, 8]} />
          <Surf color={P.white} />
        </mesh>
        <mesh position={[0, 13.5, 2.58]}>
          <boxGeometry args={[1.1, 1.8, 0.2]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[2.58, 13.5, 0]} rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[1.1, 1.8, 0.2]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, 15, 0]} rotation={[0, OCTAGON, 0]} castShadow>
          <cylinderGeometry args={[3.05, 3.05, 0.45, 8]} />
          <Surf color={P.white} />
        </mesh>
        <mesh position={[0, 16.5, 0]} rotation={[0, OCTAGON, 0]} castShadow>
          <coneGeometry args={[3.5, 2.6, 8]} />
          <Surf color={P.verdigris} />
        </mesh>
        <mesh position={[0, 18.8, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 2.8, 5]} />
          <Surf color={P.ink} />
        </mesh>
        <group ref={flag} position={[0, 19.5, 0]}>
          <mesh position={[1.25, 0, 0]} rotation={[0, 0, -Math.PI / 2]} scale={[1, 1, 0.08]} castShadow>
            <coneGeometry args={[0.75, 2.5, 3]} />
            <Surf color={P.pennant} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

const LIBRARY_HEIGHT = 15.5
const COLUMNS = [-2.5, -0.85, 0.85, 2.5] as const

/** P2: four-column library whose pediment is deeper than the hall beneath it. */
function Library() {
  const place = placementFor('front-left')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / LIBRARY_HEIGHT}>
        <mesh position={[0, 0.4, 0.2]} castShadow>
          <boxGeometry args={[8.2, 0.8, 6.6]} />
          <Surf color={P.white} />
        </mesh>
        <mesh position={[0, 1.3, 0]} castShadow>
          <boxGeometry args={[7, 1, 5.6]} />
          <Surf color={P.brick} />
        </mesh>
        <mesh position={[0, 4.9, -0.3]} castShadow>
          <boxGeometry args={[6, 6.2, 4.4]} />
          <Surf color={P.brick} />
        </mesh>
        {COLUMNS.map((x) => (
          <mesh key={x} position={[x, 4.9, 2.3]} castShadow>
            <cylinderGeometry args={[0.42, 0.5, 6.2, 8]} />
            <Surf color={P.white} />
          </mesh>
        ))}
        <mesh position={[0, 8.45, 0.2]} castShadow>
          <boxGeometry args={[7.4, 0.9, 5.8]} />
          <Surf color={P.white} />
        </mesh>
        <Gable x={0} baseY={8.9} z={0.2} width={7.8} depth={6.2} rise={6.6} color={P.white} />
        <Gable x={0} baseY={9.3} z={0.4} width={6.7} depth={6.2} rise={5.7} color={P.brick} />
        <mesh position={[0, 3.1, 1.97]}>
          <boxGeometry args={[1.3, 2.6, 0.14]} />
          <Surf color={P.ink} />
        </mesh>
      </group>
    </group>
  )
}

const ROW_HEIGHT = 14
const DORM_COLUMNS = [-2.05, 0, 2.05] as const
const DORM_ROWS = [12, 9.6] as const

/** P3: flat-roofed brick dorm slab with six storey-tall windows in its top half, and a low lecture-hall wing in front. */
function CampusRow({ night }: { night: boolean }) {
  const place = placementFor('back-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / ROW_HEIGHT}>
        <group position={[0.8, 0, 0]}>
          <mesh position={[0, 6.7, 0]} castShadow>
            <boxGeometry args={[6.2, 13.4, 4.4]} />
            <Surf color={P.brick} />
          </mesh>
          <mesh position={[0, 7.6, 0]} castShadow>
            <boxGeometry args={[6.5, 0.35, 4.7]} />
            <Surf color={P.white} />
          </mesh>
          <mesh position={[0, 13.7, 0]} castShadow>
            <boxGeometry args={[6.7, 0.6, 4.9]} />
            <Surf color={P.white} />
          </mesh>
          {DORM_ROWS.map((y) =>
            DORM_COLUMNS.map((x) => (
              <mesh key={`${x}:${y}`} position={[x, y, 2.27]}>
                <boxGeometry args={[1.1, 2.1, 0.14]} />
                <Glow color={P.light} on={night} />
              </mesh>
            )),
          )}
        </group>
        <mesh position={[1.4, 2.75, 3.6]} castShadow>
          <boxGeometry args={[4.4, 5.5, 2.8]} />
          <Surf color={P.brick} />
        </mesh>
        <mesh position={[1.4, 5.75, 3.6]} castShadow>
          <boxGeometry args={[4.8, 0.5, 3.2]} />
          <Surf color={P.white} />
        </mesh>
        <mesh position={[1.4, 1.3, 5.07]}>
          <boxGeometry args={[1.2, 2.6, 0.14]} />
          <Surf color={P.ink} />
        </mesh>
      </group>
    </group>
  )
}

const OAK_HEIGHT = 12

/** P4: quad oak with a canopy wider than the trunk is tall, and a bench under it. */
function QuadOak() {
  const place = placementFor('front-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / OAK_HEIGHT}>
        <mesh position={[-0.6, 2.6, 0.4]} castShadow>
          <cylinderGeometry args={[0.65, 1.1, 5.2, 7]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[-0.8, 7.6, 0.6]} castShadow>
          <dodecahedronGeometry args={[3.6, 0]} />
          <Surf color={P.oak} />
        </mesh>
        <mesh position={[-3.6, 6.2, 1.2]} castShadow>
          <dodecahedronGeometry args={[2.4, 0]} />
          <Surf color={P.oak} />
        </mesh>
        <mesh position={[1.9, 6.4, -0.4]} castShadow>
          <dodecahedronGeometry args={[2.3, 0]} />
          <Surf color={P.oak} />
        </mesh>
        <mesh position={[-0.2, 5.6, 3]} castShadow>
          <dodecahedronGeometry args={[2.1, 0]} />
          <Surf color={P.oak} />
        </mesh>
        <group position={[3.4, 0, 2.6]}>
          <mesh position={[0, 1.05, 0]} castShadow>
            <boxGeometry args={[2.8, 0.28, 0.9]} />
            <Surf color={P.timber} />
          </mesh>
          <mesh position={[0, 1.65, -0.4]} castShadow>
            <boxGeometry args={[2.8, 0.9, 0.2]} />
            <Surf color={P.timber} />
          </mesh>
          {[-1.1, 1.1].map((x) => (
            <mesh key={x} position={[x, 0.45, 0]} castShadow>
              <boxGeometry args={[0.26, 0.9, 0.85]} />
              <Surf color={P.timber} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

function AcademyProps({ propCount, night }: BouquetPropsProps) {
  return (
    <group>
      <BellTower />
      <Library />
      {propCount >= 3 && <CampusRow night={night} />}
      {propCount >= 4 && <QuadOak />}
    </group>
  )
}

/** Stone coping course over the brick plinth edge with twelve tapered engaged buttresses. */
function AcademyRim({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, BASE_TOP - 0.3, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
        <cylinderGeometry args={[BASE_RADIUS + 0.45, BASE_RADIUS + 0.25, 0.55, 12]} />
        <Surf color={color} />
      </mesh>
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2 + Math.PI / 12
        return (
          <mesh
            key={index}
            position={[Math.sin(angle) * (BASE_RADIUS + 0.3), 0.93, Math.cos(angle) * (BASE_RADIUS + 0.3)]}
            rotation={[0, angle + Math.PI / 4, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.55, 0.85, 1.85, 4]} />
            <Surf color={P.brick} />
          </mesh>
        )
      })}
    </group>
  )
}

/** Lawn lobes with a pale paved axis (indices 0 and 3 take the secondary colour) running from the centre to the front edge. */
const LOBES: readonly TerrainLobe[] = [
  { position: [0.4, BASE_TOP, 2.6], radius: 3.6, height: 1.2, stretch: [1.2, 0.8] },
  { position: [0, BASE_TOP, -1], radius: 7.8, height: 3.2, stretch: [1.2, 1] },
  { position: [-6.2, BASE_TOP, 3], radius: 5.4, height: 2.2, stretch: [1, 1] },
  { position: [-0.4, BASE_TOP, 7.4], radius: 2.6, height: 1, stretch: [1.4, 0.7] },
  { position: [6, BASE_TOP, -3], radius: 5.8, height: 3.6, stretch: [1, 0.92] },
  { position: [5.6, BASE_TOP, 3.8], radius: 5.4, height: 3, stretch: [1.05, 0.9] },
  { position: [-5.5, BASE_TOP, -5], radius: 5, height: 3.4, stretch: [1, 0.95] },
]

export const academyTown: BiomeBouquet = {
  spec: {
    id: 'academy-town',
    name: 'Ivy Quad Chime',
    silhouette: 'A brick disc with a green lawn top; one slim brick tower carrying a white cupola as wide as its shaft under a verdigris cap, a steep white pediment to its left and a round green oak in front.',
    hero: 'bell-tower',
    elements: [
      { id: 'bell-tower', height: 32, slot: 'hero' },
      { id: 'library', height: 28, slot: 'front-left' },
      { id: 'campus-row', height: 28, slot: 'back-right' },
      { id: 'quad-oak', height: 24, slot: 'front-right' },
    ],
    rim: 'A pale stone coping course laid over the brick plinth edge, with twelve tapered brick buttresses engaged against the side at 30 degree steps.',
    exaggeration: 'The cupola is as big as the tower: a white drum wider than the brick shaft under an oversized verdigris cap, so the campus reads as one white-capped tower at 48 px.',
    closestProtected: 'Kirby W6 (a pale castle keep on a grass pedestal). Ours is a brick bell tower with a white cupola, a pedimented library, a flat-roofed dorm row and a quad oak with a bench; no battlements, no keep.',
  },
  Props: AcademyProps,
  Rim: AcademyRim,
  terrain: { primary: P.lawn, secondary: P.coping, lobes: LOBES, rocks: false },
}
