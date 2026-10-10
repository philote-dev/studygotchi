import { useRef } from 'react'
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

/** Whimsical Land palette: roster hexes plus the shared ink / cream / window details. */
const P = {
  candy: '#f7c8d8',
  cream: '#fff1c9',
  stripe: '#8fc9d8',
  ink: '#3a2f45',
  paper: '#fffaf3',
  bone: '#f4e9d2',
  window: '#ffe9a8',
} as const

/**
 * Family slots. The tower starts back-left and tips further left, so its whole
 * shaft stays clear of the bloom; the flower moves to front-centre-left and
 * faces the camera; the house steps out to the far right so its roof V and
 * ridge show past the checker hill, which sits front-centre-right.
 */
const PLACEMENTS: readonly BouquetPlacement[] = BOUQUET_PLACEMENTS.map((entry) => {
  if (entry.id === 'hero') return { ...entry, position: [-6, BASE_TOP, -4] }
  if (entry.id === 'front-left') return { ...entry, position: [-2.5, BASE_TOP, 6.5], crownRadius: 7 }
  if (entry.id === 'back-right') return { ...entry, position: [9.3, BASE_TOP, -4.2] }
  if (entry.id === 'front-right') return { ...entry, position: [3, BASE_TOP, 6.5] }
  return entry
})

const LOBES: readonly TerrainLobe[] = [
  { position: [0, BASE_TOP, 0], radius: 7.6, height: 3.2, stretch: [1.2, 1] },
  { position: [-5, BASE_TOP, -4.2], radius: 5.8, height: 4.2, stretch: [1.05, 0.9] },
  { position: [-2.5, BASE_TOP, 6], radius: 5, height: 3, stretch: [1, 1.05] },
  { position: [5.8, BASE_TOP, -2.8], radius: 5.8, height: 3.7, stretch: [1, 0.92] },
  { position: [8, BASE_TOP, -3.6], radius: 4.2, height: 3, stretch: [1, 0.95] },
  { position: [3.5, BASE_TOP, 5.5], radius: 5, height: 2.8, stretch: [1.1, 0.9] },
  { position: [-8, BASE_TOP, 1.5], radius: 4.2, height: 2.4, stretch: [1, 1.2] },
]

/** The roster's 12° lean, added on top of the slot's outward lean. Positive Z tips the stack to screen-left. */
const TOWER_LEAN = (12 * Math.PI) / 180
const TOWER_DISCS = 7
const DISC_HEIGHT = 1.8

/**
 * P1 · spiral tower. Seven oval candy/stripe discs twisting 0.38 rad per step up
 * a cream drum, finished with a stripe cone and a cream ball that turn slowly.
 * Authored 16 tall.
 */
function SpiralTower() {
  const place = placementFor('hero', PLACEMENTS)
  const crown = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (crown.current) crown.current.rotation.y = clock.elapsedTime * 0.35
  })
  const topY = 1 + TOWER_DISCS * DISC_HEIGHT
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group rotation={[0, 0, TOWER_LEAN]} scale={place.height / 16}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[3.1, 3.5, 1, 8]} />
          <Surf color={P.cream} />
        </mesh>
        {Array.from({ length: TOWER_DISCS }, (_, index) => {
          const radius = 2.8 - index * 0.17
          return (
            <mesh
              key={index}
              position={[Math.cos(index * 1.1) * 0.3, 1 + DISC_HEIGHT * (index + 0.5), Math.sin(index * 1.1) * 0.3]}
              rotation={[0, index * 0.38, 0]}
              scale={[1.2, 1, 0.85]}
              castShadow
            >
              <cylinderGeometry args={[radius, radius, DISC_HEIGHT, 8]} />
              <Surf color={index % 2 === 0 ? P.candy : P.stripe} />
            </mesh>
          )
        })}
        <group ref={crown} position={[0, topY, 0]}>
          <mesh position={[0, 1, 0]} scale={[1.25, 1, 0.9]} castShadow>
            <coneGeometry args={[2.3, 2, 8]} />
            <Surf color={P.stripe} />
          </mesh>
          <mesh position={[0, 2.25, 0]} castShadow>
            <sphereGeometry args={[0.6, 7, 5]} />
            <Surf color={P.paper} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

const PETALS = 7

/**
 * P2 · oversized flower. One cream stem, two stripe leaves, and a seven-petal
 * stripe bloom with a candy heart facing the camera. Authored 14 tall; the
 * bloom is 7.5 across, so 15 m at bouquet scale: wider than the house.
 */
function OversizedFlower() {
  const place = placementFor('front-left', PLACEMENTS)
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 14}>
        <mesh position={[0, 5.5, 0]} castShadow>
          <cylinderGeometry args={[0.55, 0.8, 11, 6]} />
          <Surf color={P.cream} />
        </mesh>
        <mesh position={[1.3, 3.6, 0.3]} rotation={[0, 0.3, -0.5]} scale={[1, 0.3, 2.2]} castShadow>
          <sphereGeometry args={[1, 7, 5]} />
          <Surf color={P.stripe} />
        </mesh>
        <mesh position={[-1.2, 5.8, -0.4]} rotation={[0, -0.6, 0.55]} scale={[0.9, 0.3, 1.9]} castShadow>
          <sphereGeometry args={[1, 7, 5]} />
          <Surf color={P.stripe} />
        </mesh>
        <group position={[0, 11, 0.4]} rotation={[0.62, 0, 0]}>
          {Array.from({ length: PETALS }, (_, index) => {
            const angle = (index / PETALS) * Math.PI * 2
            return (
              <mesh
                key={index}
                position={[Math.sin(angle) * 2, 0, Math.cos(angle) * 2]}
                rotation={[0, angle, 0]}
                scale={[1.2, 0.45, 1.75]}
                castShadow
              >
                <sphereGeometry args={[1, 7, 5]} />
                <Surf color={P.stripe} />
              </mesh>
            )
          })}
          <mesh position={[0, 0.25, 0]} scale={[1, 0.62, 1]} castShadow>
            <sphereGeometry args={[1.55, 7, 5]} />
            <Surf color={P.candy} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

const ROOF_PITCH = 0.7
const RIDGE_Y = 2
const PANEL_HALF = 2.2
const WALL_HALF = 3.3

/**
 * P3 · upside-down house. A candy box teetering on its cream roof ridge over a
 * pivot stone, floor slab in the sky, door up by the slab, chimney poking out
 * sideways from the underside. One warm window at night. Authored 13 tall.
 */
function UpsideDownHouse({ night }: { night: boolean }) {
  const place = placementFor('back-right', PLACEMENTS)
  const eaveY = RIDGE_Y + 0.4 + PANEL_HALF * 2 * Math.sin(ROOF_PITCH)
  const wallY = eaveY + WALL_HALF
  const slabY = eaveY + WALL_HALF * 2 + 0.35
  const nx = Math.sin(ROOF_PITCH)
  const ny = -Math.cos(ROOF_PITCH)
  const rootX = 0.7 * PANEL_HALF * 2 * Math.cos(ROOF_PITCH)
  const rootY = RIDGE_Y + 0.4 + 0.7 * PANEL_HALF * 2 * Math.sin(ROOF_PITCH)
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group rotation={[0, 0, 0.06]} scale={place.height / 13}>
        <mesh position={[0, 0.9, 0]} scale={[1.4, 0.9, 1.3]} castShadow>
          <dodecahedronGeometry args={[1.1, 0]} />
          <Surf color={P.bone} />
        </mesh>
        <mesh position={[0, RIDGE_Y + 0.2, 0]} castShadow>
          <boxGeometry args={[0.7, 0.8, 5.8]} />
          <Surf color={P.ink} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <mesh
            key={side}
            position={[side * PANEL_HALF * Math.cos(ROOF_PITCH), RIDGE_Y + 0.4 + PANEL_HALF * Math.sin(ROOF_PITCH), 0]}
            rotation={[0, 0, side * ROOF_PITCH]}
            castShadow
          >
            <boxGeometry args={[PANEL_HALF * 2, 0.6, 6]} />
            <Surf color={P.cream} />
          </mesh>
        ))}
        <mesh position={[0, wallY, 0]} castShadow>
          <boxGeometry args={[4.6, WALL_HALF * 2, 5]} />
          <Surf color={P.candy} />
        </mesh>
        <mesh position={[0, slabY, 0]} castShadow>
          <boxGeometry args={[5.6, 0.7, 5.8]} />
          <Surf color={P.bone} />
        </mesh>
        <mesh position={[0.9, wallY + 1.4, 2.57]}>
          <boxGeometry args={[1.3, 1.5, 0.14]} />
          <Glow color={P.window} on={night} intensity={1.5} />
        </mesh>
        <mesh position={[0.9, wallY - 1.2, 2.57]}>
          <boxGeometry args={[1.3, 1.5, 0.14]} />
          <Surf color={P.paper} />
        </mesh>
        <mesh position={[-1.1, wallY + WALL_HALF - 1.3, 2.57]}>
          <boxGeometry args={[1.3, 2.6, 0.14]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[rootX + nx * 1.3, rootY + ny * 1.3, -1]} rotation={[0, 0, ROOF_PITCH]} castShadow>
          <boxGeometry args={[0.9, 2.6, 0.9]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[rootX + nx * 2.7, rootY + ny * 2.7, -1]} rotation={[0, 0, ROOF_PITCH]} castShadow>
          <boxGeometry args={[1.25, 0.4, 1.25]} />
          <Surf color={P.bone} />
        </mesh>
      </group>
    </group>
  )
}

const TILES = 10
const TILE_STEP = (1.5 * Math.PI * 2) / TILES
const TILE_RISE = 0.9
const HILL_RADIUS = 3.4
const HILL_HEIGHT = 10.5

/**
 * P4 · checker-path spiral. Ten chunky stripe/cream paving slabs wind 1.5 turns
 * up a candy hill-cone to a blue summit stone; the slabs are the exaggeration,
 * each one a 1.6 m thick step. Authored 12.5 tall.
 */
function CheckerSpiral() {
  const place = placementFor('front-right', PLACEMENTS)
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 12.5}>
        <mesh position={[0, 1 + HILL_HEIGHT / 2, 0]} castShadow>
          <coneGeometry args={[HILL_RADIUS, HILL_HEIGHT, 8]} />
          <Surf color={P.candy} />
        </mesh>
        {Array.from({ length: TILES }, (_, index) => {
          const angle = Math.PI * 1.1 + index * TILE_STEP
          const y = 1.8 + index * TILE_RISE
          const radius = HILL_RADIUS * (1 - (y - 1) / HILL_HEIGHT) + 0.95
          return (
            <mesh key={index} position={[Math.sin(angle) * radius, y, Math.cos(angle) * radius]} rotation={[0, angle, 0.32]} castShadow>
              <boxGeometry args={[2.3, 0.8, 2.1]} />
              <Surf color={index % 2 === 0 ? P.stripe : P.cream} />
            </mesh>
          )
        })}
        <mesh position={[0, 1 + HILL_HEIGHT + 0.3, 0]} scale={[1, 0.7, 1]} castShadow>
          <sphereGeometry args={[1, 7, 5]} />
          <Surf color={P.stripe} />
        </mesh>
      </group>
    </group>
  )
}

function Props({ propCount, night }: BouquetPropsProps) {
  return (
    <group>
      <SpiralTower />
      <OversizedFlower />
      {propCount >= 3 && <UpsideDownHouse night={night} />}
      {propCount >= 4 && <CheckerSpiral />}
    </group>
  )
}

const SCALLOPS = 14

/** Scalloped frill: 14 flat half-discs around the plinth edge alternating candy pink and stripe blue. */
function Rim({ color }: { color: string }) {
  return (
    <group>
      {Array.from({ length: SCALLOPS }, (_, index) => {
        const angle = (index / SCALLOPS) * Math.PI * 2
        return (
          <mesh
            key={index}
            position={[Math.sin(angle) * (BASE_RADIUS + 0.15), BASE_TOP - 0.1, Math.cos(angle) * (BASE_RADIUS + 0.15)]}
            rotation={[0, angle, 0]}
            castShadow
          >
            <cylinderGeometry args={[3.4, 3.4, 0.6, 8]} />
            <Surf color={index % 2 === 0 ? P.candy : color} />
          </mesh>
        )
      })}
    </group>
  )
}

export const whimsicalLand: BiomeBouquet = {
  spec: {
    id: 'whimsical-land',
    name: 'Tipsy Candy Parade',
    silhouette:
      'A pink scalloped disc with one candy-striped disc tower tipping hard to the left, a blue bloom wider than a house at its foot, and a checker ribbon corkscrewing up on the right.',
    hero: 'spiral-tower',
    elements: [
      { id: 'spiral-tower', height: 32, slot: 'hero' },
      { id: 'oversized-flower', height: 28, slot: 'front-left' },
      { id: 'upside-down-house', height: 28, slot: 'back-right' },
      { id: 'checker-spiral', height: 24, slot: 'front-right' },
    ],
    rim: 'Scalloped frill: 14 flat half-discs around the plinth edge alternating candy pink and stripe blue (placeholder until references land).',
    exaggeration:
      'The spiral tower leans a full 12 degrees on top of the slot lean, so its top disc hangs clear of the plinth like a tipping ice-cream stack.',
    closestProtected:
      'Kirby W1 (green dough disc with flowers, a spotted mushroom and two spotted domes) and W9 (rainbow star with a flat yellow checker top). Ours has no mushroom, dome or flat checker: a leaning disc-stack tower, a flower bigger than a house, an upside-down house and a checker path that corkscrews into the air, on a round pink scalloped plinth.',
    placements: PLACEMENTS,
  },
  Props,
  Rim,
  terrain: { primary: '#f7c8d8', secondary: '#fff1c9', rocks: false, lobes: LOBES },
}
