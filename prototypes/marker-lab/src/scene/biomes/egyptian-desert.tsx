import { Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, BOUQUET_PLACEMENTS, outwardRotation, placementFor, type BouquetPlacement } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/**
 * Sunbaked Oasis Crown. Roster row `egyptian-desert`: a four-step pyramid
 * across the back, an obelisk needle front-left, a palm pair over a teal pool
 * back-right, a battered pylon gate front-right, on a strata-banded sand plinth.
 */
const P = {
  sand: '#efd9a2',
  strata: '#d2a95e',
  ripple: '#e2b98a',
  pylon: '#b87a50',
  palm: '#4f8a4a',
  trunk: '#8b5a3c',
  pool: '#4fb0b8',
  ink: '#3a2f45',
} as const

const QUARTER = Math.PI / 4

/**
 * Shared slots, except: the pyramid sits a step further back so its wide foot
 * clears the front, and the gate stands front-centre like a temple approach,
 * leaving the pool visible to its right.
 */
const PLACEMENTS: readonly BouquetPlacement[] = BOUQUET_PLACEMENTS.map((entry) => {
  if (entry.id === 'hero') return { ...entry, position: [-1, BASE_TOP, -7.5] }
  if (entry.id === 'front-right') return { ...entry, position: [1.5, BASE_TOP, 6.6], yaw: 0.12, outwardLean: 0.14 }
  return entry
})

/** The four fat tiers, authored at 16 units tall (scaled ×2): half-width and riser height. */
const TIERS = [
  [5.6, 2.8],
  [4.15, 3.6],
  [2.85, 3.6],
  [1.7, 3.6],
] as const
const CAP_HEIGHT = 2.4
/** Foot height of each tier, and the foot of the cap. */
const TIER_FEET = TIERS.reduce<number[]>((feet, [, riser]) => [...feet, feet[feet.length - 1] + riser], [0])

function SteppedPyramid() {
  const place = placementFor('hero', PLACEMENTS)
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 16} rotation={[0, 0.25, 0]}>
        {TIERS.map(([half, riser], index) => {
          const base = TIER_FEET[index]
          return (
            <group key={half}>
              <mesh position={[0, base + riser / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[half * 2, riser, half * 2]} />
                <Surf color={P.sand} />
              </mesh>
              <mesh position={[0, base + riser * 0.26, 0]} castShadow>
                <boxGeometry args={[half * 2 + 0.24, riser * 0.52, half * 2 + 0.24]} />
                <Surf color={P.strata} />
              </mesh>
            </group>
          )
        })}
        <mesh position={[0, TIER_FEET[TIERS.length] + CAP_HEIGHT / 2, 0]} rotation={[0, QUARTER, 0]} castShadow>
          <coneGeometry args={[TIERS[3][0] * Math.SQRT2, CAP_HEIGHT, 4]} />
          <Surf color={P.sand} />
        </mesh>
        <mesh position={[0, 1.0, TIERS[0][0] + 0.08]}>
          <boxGeometry args={[1.0, 1.7, 0.3]} />
          <Surf color={P.ink} />
        </mesh>
      </group>
    </group>
  )
}

/** Obelisk whose pyramidion is a third of its height, with an abstract notch band. */
function Obelisk() {
  const place = placementFor('front-left', PLACEMENTS)
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 14}>
        <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.8, 0.9, 2.8]} />
          <Surf color={P.strata} />
        </mesh>
        <mesh position={[0, 1.25, 0]} castShadow>
          <boxGeometry args={[2.1, 0.7, 2.1]} />
          <Surf color={P.sand} />
        </mesh>
        <mesh position={[0, 5.5, 0]} rotation={[0, QUARTER, 0]} castShadow>
          <cylinderGeometry args={[0.82, 1.3, 7.8, 4]} />
          <Surf color={P.ripple} />
        </mesh>
        <mesh position={[0, 5.9, 0]} rotation={[0, QUARTER, 0]} castShadow>
          <cylinderGeometry args={[1.1, 1.17, 1.1, 4]} />
          <Surf color={P.strata} />
        </mesh>
        {[-0.42, -0.14, 0.14, 0.42].map((x) => (
          <mesh key={x} position={[x, 5.9, 0.84]}>
            <boxGeometry args={[0.16, 0.34, 0.08]} />
            <Surf color={P.ink} />
          </mesh>
        ))}
        <mesh position={[0, 11.7, 0]} rotation={[0, QUARTER, 0]} castShadow>
          <coneGeometry args={[0.86, 4.6, 4]} />
          <Surf color={P.strata} />
        </mesh>
      </group>
    </group>
  )
}

const FROND_ANGLES = [0, 1.26, 2.51, 3.77, 5.03] as const

/** A bent two-segment trunk with five drooping fronds as wide as the pool. */
function Palm({
  position,
  height,
  bend,
  bendYaw,
}: {
  position: readonly [number, number, number]
  height: number
  bend: number
  bendYaw: number
}) {
  const lower = height * 0.55
  const upper = height * 0.4
  const upperBend = bend * 2.4
  const kneeX = -Math.sin(bend) * lower
  const kneeY = Math.cos(bend) * lower
  const crownX = kneeX - Math.sin(upperBend) * upper
  const crownY = kneeY + Math.cos(upperBend) * upper
  const frond = height * 0.3
  return (
    <group position={position} rotation={[0, bendYaw, 0]}>
      <mesh position={[kneeX / 2, kneeY / 2, 0]} rotation={[0, 0, bend]} castShadow>
        <cylinderGeometry args={[height * 0.036, height * 0.05, lower, 6]} />
        <Surf color={P.trunk} />
      </mesh>
      <mesh position={[(kneeX + crownX) / 2, (kneeY + crownY) / 2, 0]} rotation={[0, 0, upperBend]} castShadow>
        <cylinderGeometry args={[height * 0.03, height * 0.038, upper, 6]} />
        <Surf color={P.trunk} />
      </mesh>
      <group position={[crownX, crownY, 0]}>
        <mesh position={[0, 0.6, 0]} rotation={[0, QUARTER, 0]} castShadow>
          <coneGeometry args={[0.6, 1.6, 4]} />
          <Surf color={P.palm} />
        </mesh>
        {FROND_ANGLES.map((angle, index) => {
          const droop = 0.5 + (index % 2) * 0.22
          return (
            <group key={angle} rotation={[0, angle, 0]}>
              <mesh
                position={[(frond / 2) * Math.cos(droop), -(frond / 2) * Math.sin(droop), 0]}
                rotation={[0, 0, -(Math.PI / 2 + droop)]}
                scale={[0.32, 1, 1]}
                castShadow
              >
                <coneGeometry args={[frond * 0.22, frond, 4]} />
                <Surf color={P.palm} />
              </mesh>
            </group>
          )
        })}
      </group>
    </group>
  )
}

/** The pool stays level (it is water); only the palms take the outward lean. */
const POOL: readonly [number, number] = [2.4, -0.6]
const BASIN_TOP = 2.9

/** The pool sits level on a raised sand cistern (it is water); only the palms take the outward lean. */
function Oasis() {
  const place = placementFor('back-right', PLACEMENTS)
  const scale = place.height / 14
  return (
    <group position={place.position}>
      <group scale={scale} rotation={[0, place.yaw, 0]}>
        <mesh position={[POOL[0], BASIN_TOP / 2 + 0.15, POOL[1]]} castShadow receiveShadow>
          <cylinderGeometry args={[2.6, 3.2, BASIN_TOP - 0.3, 10]} />
          <Surf color={P.ripple} />
        </mesh>
        <mesh position={[POOL[0], BASIN_TOP + 0.08, POOL[1]]} receiveShadow>
          <cylinderGeometry args={[2.2, 2.2, 0.24, 10]} />
          <Surf color={P.pool} />
        </mesh>
      </group>
      <group rotation={outwardRotation(place)}>
        <group scale={scale}>
          <Palm position={[0.4, 2.0, -1.4]} height={13} bend={0.13} bendYaw={-2.69} />
          <Palm position={[4.3, 2.0, 0.6]} height={9.5} bend={0.16} bendYaw={2.09} />
        </group>
      </group>
    </group>
  )
}

/** Two battered towers (base nearly twice the top), flared cornices, a lintel and a dark passage. */
function PylonGate() {
  const place = placementFor('front-right', PLACEMENTS)
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 12}>
        {([-1, 1] as const).map((side) => (
          <group key={side} position={[side * 2.1, 0, 0]}>
            <group scale={[1, 1, 0.6]}>
              <mesh position={[0, 4.8, 0]} rotation={[0, QUARTER, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[0.8 * Math.SQRT2, 1.5 * Math.SQRT2, 9.6, 4]} />
                <Surf color={P.pylon} />
              </mesh>
            </group>
            <mesh position={[0, 10.0, 0]} castShadow>
              <boxGeometry args={[2.5, 0.8, 1.6]} />
              <Surf color={P.sand} />
            </mesh>
            <mesh position={[side * 0.5, 6.4, 1.1]} castShadow>
              <cylinderGeometry args={[0.1, 0.13, 11.6, 6]} />
              <Surf color={P.trunk} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 8.2, 0]} castShadow>
          <boxGeometry args={[3.0, 1.2, 1.4]} />
          <Surf color={P.sand} />
        </mesh>
        <mesh position={[0, 2.6, -0.3]}>
          <boxGeometry args={[1.2, 5.2, 0.3]} />
          <Surf color={P.ink} />
        </mesh>
      </group>
    </group>
  )
}

function Props({ propCount }: BouquetPropsProps) {
  return (
    <group>
      <SteppedPyramid />
      <Obelisk />
      {propCount >= 3 && <Oasis />}
      {propCount >= 4 && <PylonGate />}
    </group>
  )
}

/** Three wind-ripple strata bands stepping down and out from the plinth lip. */
const RIPPLES = [
  { y: BASE_TOP - 0.3, radius: BASE_RADIUS + 0.5, height: 0.42, offset: [0.1, 0.06] },
  { y: BASE_TOP - 0.9, radius: BASE_RADIUS + 0.8, height: 0.4, offset: [-0.08, 0.12] },
  { y: BASE_TOP - 1.5, radius: BASE_RADIUS + 1.1, height: 0.38, offset: [0.05, -0.12] },
] as const

function Rim({ color }: { color: string }) {
  const colors = [color, P.strata, P.sand] as const
  return (
    <group>
      {RIPPLES.map((band, index) => (
        <mesh key={index} position={[band.offset[0], band.y, band.offset[1]]} rotation={[0, Math.PI / 12, 0]} castShadow>
          <cylinderGeometry args={[band.radius, band.radius + 0.08, band.height, 12]} />
          <Surf color={colors[index]} />
        </mesh>
      ))}
    </group>
  )
}

export const egyptianDesert: BiomeBouquet = {
  spec: {
    id: 'egyptian-desert',
    name: 'Sunbaked Oasis Crown',
    silhouette:
      'A fat four-step pyramid filling the back of a pale sand disc, a slim obelisk needle to its left, a teal pool dot under two palm fans at the right.',
    hero: 'stepped-pyramid',
    elements: [
      { id: 'stepped-pyramid', height: 32, slot: 'hero' },
      { id: 'obelisk', height: 28, slot: 'front-left' },
      { id: 'oasis', height: 28, slot: 'back-right' },
      { id: 'pylon-gate', height: 24, slot: 'front-right' },
    ],
    rim: 'Three wind-ripple strata bands: thin rings in strata #d2a95e, ripple #e2b98a and sand #efd9a2 at slightly offset radii, stepping down the plinth edge.',
    exaggeration: 'The pyramid has only four fat steps, each riser a quarter of its height: a staircase for giants, not a smooth slope.',
    closestProtected:
      'Kirby W2 (one smooth pyramid on soft sand dough). Ours is a four-step pyramid plus an obelisk, a palm oasis with a teal pool and a pylon gate, on a strata-banded cliff plinth.',
    placements: PLACEMENTS,
  },
  Props,
  Rim,
  terrain: { primary: P.sand, secondary: P.ripple, rocks: true },
}
