import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Glow, Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, BOUQUET_PLACEMENTS, outwardRotation, placementFor, type BouquetPlacement } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/**
 * Granite Gondola Crest. Roster row `alpine`: sharp grey twin peaks across the
 * back, a cable pylon front-left with one fat cable up to a peak-shoulder
 * station and an oversized orange gondola on it, a wide-roof chalet on a turf
 * knoll back-right, a fir pair front-right, on a split-granite ledge plinth.
 */
const P = {
  granite: '#8d9299',
  ledge: '#a9aeb5',
  turf: '#86b26e',
  snow: '#eef4f7',
  pylon: '#6d7f96',
  gondola: '#d9622b',
  roof: '#786557',
  cream: '#f4e9d2',
  fir: '#4f8a4a',
  ink: '#3a2f45',
  light: '#ffe9a8',
} as const

/**
 * Shared slots, except: the pylon is yawed so its cross-arm sits square to the
 * cable, and the firs step outward so they frame the chalet instead of hiding it.
 */
const PLACEMENTS: readonly BouquetPlacement[] = BOUQUET_PLACEMENTS.map((entry) => {
  if (entry.id === 'front-left') return { ...entry, position: [-8.8, BASE_TOP, 5.2], yaw: -0.52 }
  if (entry.id === 'front-right') return { ...entry, position: [8.6, BASE_TOP, 6.2], yaw: 0.1 }
  return entry
})

const HERO = placementFor('hero', PLACEMENTS)
const PYLON = placementFor('front-left', PLACEMENTS)
const PYLON_AUTHORED = 14
const PYLON_HEAD: readonly [number, number, number] = [0, 14.2, 0]
/** Top of the station block on the main spike's flank, in hero-local metres. */
const STATION: readonly [number, number, number] = [-1.3, 22.9, 1.1]

function toWorld(place: BouquetPlacement, local: readonly [number, number, number], scale: number): THREE.Vector3 {
  const rotation = outwardRotation(place)
  return new THREE.Vector3(local[0] * scale, local[1] * scale, local[2] * scale)
    .applyEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
    .add(new THREE.Vector3(place.position[0], place.position[1], place.position[2]))
}

const CABLE_START = toWorld(PYLON, PYLON_HEAD, PYLON.height / PYLON_AUTHORED)
const CABLE_END = toWorld(HERO, STATION, 1)
const CABLE_DIR = CABLE_END.clone().sub(CABLE_START)
const CABLE_LENGTH = CABLE_DIR.length()
CABLE_DIR.normalize()
const CABLE_MID = CABLE_START.clone().addScaledVector(CABLE_DIR, CABLE_LENGTH / 2)
const CABLE_QUAT = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), CABLE_DIR)
const CABLE_YAW = Math.atan2(-CABLE_DIR.z, CABLE_DIR.x)
const GONDOLA_HOME = CABLE_START.clone().addScaledVector(CABLE_DIR, CABLE_LENGTH * 0.45)

function Spike({
  position,
  rotation,
  height,
  radius,
  capHeight = 0,
  capRadius = 0,
  segments,
  color,
  squash,
}: {
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
  height: number
  radius: number
  capHeight?: number
  capRadius?: number
  segments: number
  color: string
  squash: number
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, height / 2, 0]} scale={[1, 1, squash]} castShadow>
        <coneGeometry args={[radius, height, segments]} />
        <Surf color={color} />
      </mesh>
      {capHeight > 0 && (
        <mesh position={[0, height - capHeight / 2, 0]} scale={[1, 1, squash]} castShadow>
          <coneGeometry args={[capRadius, capHeight, segments]} />
          <Surf color={P.snow} />
        </mesh>
      )}
    </group>
  )
}

/** Jagged grey twin peak: two fat sharp five-sided spikes with small caps, a tooth, a saddle, scree. */
function TwinPeak() {
  return (
    <group position={HERO.position} rotation={outwardRotation(HERO)}>
      <Spike position={[1.5, 0, 0]} rotation={[0, 0.3, 0]} height={32} radius={8} capHeight={6.6} capRadius={1.85} segments={5} color={P.granite} squash={0.85} />
      <Spike position={[-8.4, 0, -0.6]} rotation={[0.04, 0.5, 0.14]} height={27} radius={6.2} capHeight={6} capRadius={1.6} segments={5} color={P.granite} squash={0.85} />
      <Spike position={[9.2, 0, 1.6]} rotation={[0.06, -0.2, -0.24]} height={15} radius={2.6} capHeight={3.2} capRadius={0.7} segments={4} color={P.ledge} squash={0.85} />
      <Spike position={[-3.8, 0, 2.6]} rotation={[0, 0.5, 0]} height={13} radius={4.8} segments={4} color={P.ledge} squash={0.9} />
      <mesh position={[-4.2, 2.4, 6.4]} rotation={[0.2, 0.6, -0.1]} scale={[1.5, 0.95, 1.15]} castShadow>
        <dodecahedronGeometry args={[2.2, 0]} />
        <Surf color={P.granite} />
      </mesh>
      <mesh position={[5.4, 2.0, 7.0]} rotation={[-0.1, 1.3, 0.15]} scale={[1.15, 0.8, 1]} castShadow>
        <dodecahedronGeometry args={[2.0, 0]} />
        <Surf color={P.granite} />
      </mesh>
      <mesh position={[STATION[0], STATION[1] - 0.9, STATION[2]]} castShadow>
        <boxGeometry args={[2.4, 1.8, 2.4]} />
        <Surf color={P.ledge} />
      </mesh>
    </group>
  )
}

/** A-frame pylon with braces, a cross-arm, two sheaves and a cap; the cable leaves from the cap. */
function CablePylon() {
  return (
    <group position={PYLON.position} rotation={outwardRotation(PYLON)}>
      <group scale={PYLON.height / PYLON_AUTHORED}>
        <mesh position={[0, 0.7, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.8, 1.4, 2.4]} />
          <Surf color={P.ledge} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * 0.72, 7.5, 0]} rotation={[0, 0, side * 0.05]} scale={[1, 1, 1.5]} castShadow>
            <cylinderGeometry args={[0.24, 0.36, 12.4, 6]} />
            <Surf color={P.pylon} />
          </mesh>
        ))}
        <mesh position={[0, 4.6, 0]} castShadow>
          <boxGeometry args={[2.1, 0.3, 0.3]} />
          <Surf color={P.pylon} />
        </mesh>
        <mesh position={[0, 9.2, 0]} castShadow>
          <boxGeometry args={[1.6, 0.3, 0.3]} />
          <Surf color={P.pylon} />
        </mesh>
        <mesh position={[0, 13.5, 0]} castShadow>
          <boxGeometry args={[2.2, 0.6, 1.0]} />
          <Surf color={P.pylon} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * 1.0, 13.1, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.42, 0.42, 0.36, 8]} />
            <Surf color={P.ink} />
          </mesh>
        ))}
        <mesh position={[0, 14.0, 0]} castShadow>
          <boxGeometry args={[1.1, 0.5, 1.3]} />
          <Surf color={P.ledge} />
        </mesh>
      </group>
    </group>
  )
}

/** One fat cable from the pylon cap to the station, and the oversized gondola that creeps along it. */
function CableAndGondola() {
  const gondola = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!gondola.current) return
    const t = 0.45 + Math.sin(clock.elapsedTime * 0.22) * 0.17
    gondola.current.position.copy(CABLE_START).addScaledVector(CABLE_DIR, CABLE_LENGTH * t)
  })
  return (
    <group>
      <mesh position={CABLE_MID} quaternion={CABLE_QUAT} castShadow>
        <cylinderGeometry args={[0.5, 0.5, CABLE_LENGTH, 6]} />
        <Surf color={P.ink} />
      </mesh>
      <group ref={gondola} position={GONDOLA_HOME} rotation={[0, CABLE_YAW, 0]}>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[1.3, 1.0, 1.1]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, -1.6, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.3, 2.4, 6]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, -5.0, 0]} castShadow>
          <boxGeometry args={[5.6, 4.4, 3.4]} />
          <Surf color={P.gondola} />
        </mesh>
        <mesh position={[0, -4.3, 0]}>
          <boxGeometry args={[5.75, 1.4, 3.55]} />
          <Surf color={P.cream} />
        </mesh>
      </group>
    </group>
  )
}

const CHALET_HALF = 3.2
const CHALET_ROOF = 3.4
const ROOF_ANGLE = Math.atan2(CHALET_ROOF, CHALET_HALF)
const ROOF_SLOPE = Math.hypot(CHALET_HALF, CHALET_ROOF)
const EAVE = 1.0
const KNOLL_TOP = 7.6
const WALL_TOP = KNOLL_TOP + 2.2

/** Wide low-roofed chalet on a turf knoll: the roof is 60 % of the chalet's own height. */
function Chalet({ night }: { night: boolean }) {
  const place = placementFor('back-right', PLACEMENTS)
  const panelLength = ROOF_SLOPE + EAVE
  const prismRadius = (CHALET_HALF * 2) / Math.sqrt(3)
  const prismScale = CHALET_ROOF / (prismRadius * 1.5)
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 14}>
        <mesh position={[0, KNOLL_TOP - 4.0, 0]} rotation={[0, 0.4, 0]} scale={[3.7, 4.0, 3.4]} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 1]} />
          <Surf color={P.turf} />
        </mesh>
        <mesh position={[0, KNOLL_TOP + 0.55, 0]} castShadow receiveShadow>
          <boxGeometry args={[CHALET_HALF * 2 + 0.2, 1.1, 4.6]} />
          <Surf color={P.ledge} />
        </mesh>
        <mesh position={[0, KNOLL_TOP + 1.65, 0]} castShadow>
          <boxGeometry args={[CHALET_HALF * 2, 1.1, 4.4]} />
          <Surf color={P.cream} />
        </mesh>
        <group position={[0, WALL_TOP + prismRadius * 0.5 * prismScale, 0]} scale={[1, prismScale, 1]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[prismRadius, prismRadius, 4.2, 3]} />
            <Surf color={P.cream} />
          </mesh>
        </group>
        {([-1, 1] as const).map((side) => (
          <mesh
            key={side}
            position={[
              side * ((panelLength / 2 - 0.3) * Math.cos(ROOF_ANGLE) + 0.25 * Math.sin(ROOF_ANGLE)),
              WALL_TOP + CHALET_ROOF - (panelLength / 2 - 0.3) * Math.sin(ROOF_ANGLE) + 0.25 * Math.cos(ROOF_ANGLE),
              0,
            ]}
            rotation={[0, 0, -side * ROOF_ANGLE]}
            castShadow
          >
            <boxGeometry args={[panelLength, 0.5, 4.6 + EAVE * 2]} />
            <Surf color={P.roof} />
          </mesh>
        ))}
        <mesh position={[-1.7, WALL_TOP + CHALET_ROOF - 0.3, -0.8]} castShadow>
          <boxGeometry args={[0.9, 2.2, 0.9]} />
          <Surf color={P.ledge} />
        </mesh>
        <mesh position={[0, KNOLL_TOP + 1.1, 2.7]} castShadow>
          <boxGeometry args={[CHALET_HALF * 2 + 0.4, 0.26, 1.0]} />
          <Surf color={P.roof} />
        </mesh>
        <mesh position={[0, KNOLL_TOP + 1.55, 3.15]}>
          <boxGeometry args={[CHALET_HALF * 2 + 0.4, 0.5, 0.12]} />
          <Surf color={P.roof} />
        </mesh>
        {[-1.6, 1.6].map((x) => (
          <mesh key={x} position={[x, KNOLL_TOP + 1.72, 2.24]}>
            <boxGeometry args={[1.1, 0.62, 0.1]} />
            <Glow color={P.light} on={night} intensity={1.5} />
          </mesh>
        ))}
        <mesh position={[0, KNOLL_TOP + 0.5, 2.34]}>
          <boxGeometry args={[0.8, 1.0, 0.1]} />
          <Surf color={P.ink} />
        </mesh>
      </group>
    </group>
  )
}

const FIR_TIERS = [
  [0.2, 0.33],
  [0.15, 0.5],
  [0.11, 0.67],
  [0.07, 0.84],
] as const

/** A narrow four-tier spire with a fat bottom skirt. */
function Fir({ position, height, lean }: { position: readonly [number, number, number]; height: number; lean: number }) {
  return (
    <group position={position} rotation={[0, 0, lean]}>
      <mesh position={[0, height * 0.15, 0]} castShadow>
        <cylinderGeometry args={[height * 0.045, height * 0.065, height * 0.3, 6]} />
        <Surf color={P.roof} />
      </mesh>
      {FIR_TIERS.map(([radius, at]) => (
        <mesh key={at} position={[0, height * at, 0]} castShadow>
          <coneGeometry args={[height * radius, height * 0.34, 7]} />
          <Surf color={P.fir} />
        </mesh>
      ))}
    </group>
  )
}

function FirPair() {
  const place = placementFor('front-right', PLACEMENTS)
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 12}>
        <Fir position={[0, 0, 0]} height={12} lean={-0.06} />
        <Fir position={[2.9, 0, 1.6]} height={8.8} lean={-0.12} />
      </group>
    </group>
  )
}

function Props({ propCount, night }: BouquetPropsProps) {
  return (
    <group>
      <TwinPeak />
      <CablePylon />
      <CableAndGondola />
      {propCount >= 3 && <Chalet night={night} />}
      {propCount >= 4 && <FirPair />}
    </group>
  )
}

/** Split-granite ledge: 12 blocks on the facets, turf tufts in 6 notches, snow dusting in the other 6. */
function Rim({ color }: { color: string }) {
  return (
    <group>
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2
        const notch = angle + Math.PI / 12
        const snowy = index % 2 === 0
        return (
          <group key={index}>
            <mesh
              position={[Math.sin(angle) * (BASE_RADIUS + 0.15), BASE_TOP - 0.3 - (index % 3) * 0.08, Math.cos(angle) * (BASE_RADIUS + 0.15)]}
              rotation={[0, angle, 0]}
              castShadow
            >
              <boxGeometry args={[index % 4 === 0 ? 7.4 : 6.8, 0.9, 1.4]} />
              <Surf color={color} />
            </mesh>
            <mesh
              position={[Math.sin(notch) * (BASE_RADIUS + 0.1), BASE_TOP + (snowy ? 0.02 : 0.08), Math.cos(notch) * (BASE_RADIUS + 0.1)]}
              rotation={[0, notch, 0]}
              scale={snowy ? [1.05, 0.3, 0.8] : [0.85, 0.5, 0.7]}
              castShadow
            >
              <dodecahedronGeometry args={[0.9, 0]} />
              <Surf color={snowy ? P.snow : P.turf} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export const alpine: BiomeBouquet = {
  spec: {
    id: 'alpine',
    name: 'Granite Gondola Crest',
    silhouette:
      'Two jagged grey spikes with small white caps over a green disc, one thin diagonal cable from the left pylon up to the peak shoulder, an orange gondola dot hanging on it.',
    hero: 'twin-peak',
    elements: [
      { id: 'twin-peak', height: 32, slot: 'hero' },
      { id: 'cable-pylon', height: 28, slot: 'front-left' },
      { id: 'chalet', height: 28, slot: 'back-right' },
      { id: 'fir-pair', height: 24, slot: 'front-right' },
    ],
    rim: 'Split-granite ledge: 12 chunky grey blocks around the plinth edge, turf tufts #86b26e in the gaps, snow dusting #eef4f7 on 6 of the notches.',
    exaggeration: 'The gondola is bigger than the pylon head that carries it: an orange cabin the size of a chalet hanging from one cable.',
    closestProtected:
      'Kirby W3 (pines on soft dough) and Ice-town (soft white snow cone). Ours is two sharp grey granite spikes joined by a cable and gondola, a wide-roof chalet and a fir pair on a granite-ledge plinth.',
    placements: PLACEMENTS,
  },
  Props,
  Rim,
  terrain: { primary: P.turf, secondary: P.granite, rocks: true },
}
