"use client";

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { Glow, Surf } from '../materials'
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

/**
 * Whimsical Land palette. Raspberry is the family's one dark anchor (tower
 * plates, house roof, ribbon checks); stripe `#5fa8c8` is the single saturated
 * accent and lives on the flower and the rim scallops only.
 */
const P = {
  candy: '#f7c8d8',
  rose: '#e8a9c0',
  cream: '#fff1c9',
  raspberry: '#d6567f',
  stripe: '#5fa8c8',
  ink: '#3a2f45',
  paper: '#fffaf3',
  bone: '#f4e9d2',
  window: '#ffe9a8',
} as const

/**
 * Family slots. The tower starts back-left and tips further left so its whole
 * shaft stays clear of the bloom and its top plate ends past the rim; the
 * flower sits front-centre-left facing the camera; the house steps out to the
 * far right so its roof V and ridge show past the checker hill front-centre.
 */
const PLACEMENTS: readonly BouquetPlacement[] = BOUQUET_PLACEMENTS.map((entry) => {
  if (entry.id === 'hero') return { ...entry, position: [-6, BASE_TOP, -4] }
  if (entry.id === 'front-left') return { ...entry, position: [-2.5, BASE_TOP, 6.5], crownRadius: 7 }
  if (entry.id === 'back-right') return { ...entry, position: [11.5, BASE_TOP, -3.5] }
  if (entry.id === 'front-right') return { ...entry, position: [4.5, BASE_TOP, 7] }
  return entry
})

const LOBES: readonly TerrainLobe[] = [
  { position: [0, BASE_TOP, 0], radius: 7.6, height: 3.2, stretch: [1.2, 1] },
  { position: [-5, BASE_TOP, -4.2], radius: 5.8, height: 4.2, stretch: [1.05, 0.9] },
  { position: [-2.5, BASE_TOP, 6], radius: 5, height: 3, stretch: [1, 1.05] },
  { position: [5.8, BASE_TOP, -2.8], radius: 5.8, height: 3.7, stretch: [1, 0.92] },
  { position: [10.3, BASE_TOP, -3], radius: 2.2, height: 2.4, stretch: [1, 1] },
  { position: [4.5, BASE_TOP, 6.5], radius: 4, height: 2.6, stretch: [1.1, 0.9] },
  { position: [-8, BASE_TOP, 1.5], radius: 4.2, height: 2.4, stretch: [1, 1.2] },
]

/** The roster's 12° lean, added on top of the slot's outward lean. Positive Z tips the stack to screen-left. */
const TOWER_LEAN = (12 * Math.PI) / 180
const PLATES = 6
const PLATE_HEIGHT = 1.3
const PEG_HEIGHT = 1.4
const TOWER_BASE = 0.8
const TOWER_HEIGHT = TOWER_BASE + PLATES * PLATE_HEIGHT + (PLATES - 1) * PEG_HEIGHT

/**
 * P1 · spiral tower. Six raspberry plates of steadily shrinking radius on
 * narrow cream pegs, each plate an oval twisted a little further round than
 * the one below; no cap, the top plate just turns slowly. Authored 15.6 tall;
 * with the 12° + slot lean the top plate ends ~1 m past the rim.
 */
function SpiralTower() {
  const place = placementFor('hero', PLACEMENTS)
  const top = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (top.current) top.current.rotation.y = (PLATES - 1) * 0.45 + clock.elapsedTime * 0.3
  })
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group rotation={[0, 0, TOWER_LEAN]} scale={place.height / TOWER_HEIGHT}>
        <mesh position={[0, TOWER_BASE / 2, 0]} castShadow>
          <cylinderGeometry args={[3.6, 4, TOWER_BASE, 8]} />
          <Surf color={P.cream} />
        </mesh>
        {Array.from({ length: PLATES }, (_, index) => {
          const radius = 3.3 - index * 0.42
          const plateY = TOWER_BASE + index * (PLATE_HEIGHT + PEG_HEIGHT) + PLATE_HEIGHT / 2
          const drift = 0.25
          return (
            <group key={index}>
              <mesh
                ref={index === PLATES - 1 ? top : undefined}
                position={[Math.cos(index * 1.3) * drift, plateY, Math.sin(index * 1.3) * drift]}
                rotation={[0, index * 0.45, 0]}
                scale={[1.15, 1, 0.87]}
                castShadow
              >
                <cylinderGeometry args={[radius, radius, PLATE_HEIGHT, 8]} />
                <Surf color={P.raspberry} />
              </mesh>
              {index < PLATES - 1 && (
                <mesh position={[Math.cos((index + 0.5) * 1.3) * drift * 0.5, plateY + PLATE_HEIGHT / 2 + PEG_HEIGHT / 2, Math.sin((index + 0.5) * 1.3) * drift * 0.5]} castShadow>
                  <cylinderGeometry args={[radius * 0.42, radius * 0.46, PEG_HEIGHT, 8]} />
                  <Surf color={P.cream} />
                </mesh>
              )}
            </group>
          )
        })}
      </group>
    </group>
  )
}

const PETALS = 6

/**
 * P2 · oversized flower. One cream stem, two stripe leaves, and a six-petal
 * stripe bloom with a candy heart facing the camera. Authored 14 tall; the
 * bloom is 7.5 across, so 15 m at bouquet scale: wider than the house. The
 * family's accent object.
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
                scale={[1.3, 0.45, 1.75]}
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

const RIDGE_Y = 1
const RIDGE_BEAM = 0.5
const PANEL_HALF = 2.5
/** 45° roof: the eaves sit this far above and to either side of the ridge. */
const EAVE_RISE = PANEL_HALF * 2 * Math.SQRT1_2
const WALL_HEIGHT = 6.4
const HOUSE_HEIGHT = 12

/**
 * P3 · upside-down house. The ink ridge beam runs left-right on the terrain,
 * two raspberry 45° roof panels open upward from it (the front slope faces the
 * camera), a candy gable diamond fills the V, the candy walls sit on the
 * eaves and the bone floor slab is the top. The door is an inverted arch
 * hanging from the slab; the chimney hangs straight down from the front panel
 * to the ground. One warm window at night. Authored 12 tall.
 */
function UpsideDownHouse({ night }: { night: boolean }) {
  const place = placementFor('back-right', PLACEMENTS)
  const ridgeTop = RIDGE_Y + RIDGE_BEAM
  const eaveY = ridgeTop + EAVE_RISE
  const wallY = eaveY + WALL_HEIGHT / 2
  const slabY = eaveY + WALL_HEIGHT + 0.3
  const face = 3.27
  const chimneyZ = 2.3
  const chimneyTop = ridgeTop + chimneyZ
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group rotation={[0, 0, 0.05]} scale={place.height / HOUSE_HEIGHT}>
        <mesh position={[0, RIDGE_Y + RIDGE_BEAM / 2, 0]} castShadow>
          <boxGeometry args={[6.6, RIDGE_BEAM, 0.8]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, ridgeTop + EAVE_RISE, 0]} rotation={[Math.PI / 4, 0, 0]} castShadow>
          <boxGeometry args={[5.2, EAVE_RISE * Math.SQRT2, EAVE_RISE * Math.SQRT2]} />
          <Surf color={P.candy} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <mesh
            key={side}
            position={[0, ridgeTop + PANEL_HALF * Math.SQRT1_2 - 0.18, side * (PANEL_HALF * Math.SQRT1_2 + 0.18)]}
            rotation={[-side * (Math.PI / 4), 0, 0]}
            castShadow
          >
            <boxGeometry args={[6.6, 0.5, PANEL_HALF * 2]} />
            <Surf color={P.raspberry} />
          </mesh>
        ))}
        <mesh position={[0, wallY, 0]} castShadow>
          <boxGeometry args={[5.2, WALL_HEIGHT, 6.4]} />
          <Surf color={P.candy} />
        </mesh>
        <mesh position={[0, slabY, 0]} castShadow>
          <boxGeometry args={[6.2, 0.6, 7.2]} />
          <Surf color={P.bone} />
        </mesh>
        <mesh position={[-1.2, slabY - 0.3 - 1.05, face]}>
          <boxGeometry args={[1.5, 2.1, 0.14]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[-1.2, slabY - 0.3 - 2.1, face]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.75, 0.75, 0.14, 6]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[1.4, slabY - 0.3 - 2.2, face]}>
          <boxGeometry args={[1.4, 1.5, 0.14]} />
          <Glow color={P.window} on={night} intensity={1.5} />
        </mesh>
        <mesh position={[0.3, eaveY + 1.5, face]}>
          <boxGeometry args={[1.4, 1.5, 0.14]} />
          <Surf color={P.paper} />
        </mesh>
        <mesh position={[1.7, chimneyTop - 0.9, chimneyZ]} castShadow>
          <boxGeometry args={[0.9, 2.2, 0.9]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[1.7, chimneyTop - 2, chimneyZ]} castShadow>
          <boxGeometry args={[1.25, 0.35, 1.25]} />
          <Surf color={P.bone} />
        </mesh>
      </group>
    </group>
  )
}

const SEGMENTS = 12
const SEGMENT_STEP = (1.5 * Math.PI * 2) / SEGMENTS
const SEGMENT_RISE = 0.85
const HILL_RADIUS = 2.7
const HILL_HEIGHT = 10.5
const RIBBON_HEIGHT = 12.5

/**
 * P4 · checker-path spiral. One continuous ribbon of twelve overlapping
 * raspberry / cream checks, 0.9 m thick at bouquet scale, winding 1.5 turns up
 * a candy hill-cone to a raspberry landing on the summit. Authored 12.5 tall.
 */
function CheckerSpiral() {
  const place = placementFor('front-right', PLACEMENTS)
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / RIBBON_HEIGHT}>
        <mesh position={[0, 1 + HILL_HEIGHT / 2, 0]} castShadow>
          <coneGeometry args={[HILL_RADIUS, HILL_HEIGHT, 8]} />
          <Surf color={P.candy} />
        </mesh>
        {Array.from({ length: SEGMENTS }, (_, index) => {
          const angle = Math.PI * 1.1 + (index + 0.5) * SEGMENT_STEP
          const y = 1.6 + (index + 0.5) * SEGMENT_RISE
          const radius = HILL_RADIUS * (1 - (y - 1) / HILL_HEIGHT) + 0.55
          const chord = 2 * radius * Math.sin(SEGMENT_STEP / 2)
          const pitch = Math.atan2(SEGMENT_RISE, chord)
          return (
            <mesh
              key={index}
              position={[Math.sin(angle) * radius * Math.cos(SEGMENT_STEP / 2), y, Math.cos(angle) * radius * Math.cos(SEGMENT_STEP / 2)]}
              rotation={[0, angle, pitch]}
              castShadow
            >
              <boxGeometry args={[chord * 1.35, 0.45, 1.7]} />
              <Surf color={index % 2 === 0 ? P.raspberry : P.cream} />
            </mesh>
          )
        })}
        <mesh position={[0, 1 + HILL_HEIGHT + 0.1, 0]} castShadow>
          <cylinderGeometry args={[1.1, 0.7, 0.5, 8]} />
          <Surf color={P.raspberry} />
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
const SCALLOP_RADIUS = 2.6

/**
 * Fourteen flat half-disc scallops in the plinth plane, alternating candy pink
 * and the stripe-blue lip. Each is a 0.3 m plate flush with the plinth top that
 * reaches 2.4 m out past the edge, so the pink plinth band below stays visible.
 */
function Rim({ color }: { color: string }) {
  return (
    <group>
      {Array.from({ length: SCALLOPS }, (_, index) => {
        const angle = (index / SCALLOPS) * Math.PI * 2
        return (
          <mesh
            key={index}
            position={[Math.sin(angle) * (BASE_RADIUS - 0.2), BASE_TOP + 0.1, Math.cos(angle) * (BASE_RADIUS - 0.2)]}
            rotation={[0, angle, 0]}
            castShadow
          >
            <cylinderGeometry args={[SCALLOP_RADIUS, SCALLOP_RADIUS, 0.3, 5, 1, false, -Math.PI / 2, Math.PI]} />
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
      'A pink scalloped disc with one raspberry plate-stack tower tipping hard to the left past the rim, a blue bloom at its foot, a candy house hanging upside-down on the right and a checker ribbon winding up a candy hill in front.',
    hero: 'spiral-tower',
    elements: [
      { id: 'spiral-tower', height: 32, slot: 'hero' },
      { id: 'oversized-flower', height: 28, slot: 'front-left' },
      { id: 'upside-down-house', height: 28, slot: 'back-right' },
      { id: 'checker-spiral', height: 24, slot: 'front-right' },
    ],
    rim: 'Fourteen flat half-disc scallops in the plinth plane, alternating candy pink and the stripe-blue lip, leaving the rose plinth band visible beneath them.',
    exaggeration:
      'The tower leans 12 degrees on top of the slot lean: six raspberry plates shrinking as they rise on cream pegs, no cap, the top plate hanging clear past the rim.',
    closestProtected:
      'Kirby W1 (green dough disc with flowers, a spotted mushroom and two spotted domes) and W9 (rainbow star with a flat yellow checker top). Ours has no mushroom, spotted dome or flat checker top: a leaning plate-stack tower, a flower bigger than a house, an upside-down house and a checker ribbon climbing a hill, on a round pink scalloped plinth.',
    placements: PLACEMENTS,
  },
  Props,
  Rim,
  terrain: { primary: '#f7c8d8', secondary: '#e8a9c0', rocks: false, lobes: LOBES },
}
