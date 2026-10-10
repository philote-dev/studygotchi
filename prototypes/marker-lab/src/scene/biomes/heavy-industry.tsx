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

/** Roster row hexes only (globe-markers.md §3) plus ink / cream details. */
const P = {
  slab: '#9f9a96',
  concrete: '#b9b4b0',
  steel: '#6b5f7a',
  orange: '#e8a13a',
  pipe: '#4f8fb0',
  smoke: '#fffaf3',
  cream: '#f4e9d2',
  ink: '#3a2f45',
  window: '#ffe9a8',
} as const

/**
 * Shared slots, except the press moves right so it no longer stands in front
 * of the gantry's legs: the T must read uncovered at 48 px.
 */
const PLACEMENTS: readonly BouquetPlacement[] = BOUQUET_PLACEMENTS.map((entry) =>
  entry.id === 'back-right' ? { ...entry, position: [8.8, BASE_TOP, -3.4], yaw: -0.22 } : entry,
)

/* ------------------------------------------------------------------------ */
/* P1 · gantry crane: the T. Beam longer than the plinth is wide, one orange cab. */

type GroupRef = RefObject<THREE.Group | null>

function GantryCrane({ night, trolley }: { night: boolean; trolley: GroupRef }) {
  const place = placementFor('hero')
  const scale = place.height / 16
  const legs = [-1, 1] as const
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        {legs.map((side) => (
          <group key={side}>
            <mesh position={[side * 3.9, 0.55, 0]} castShadow>
              <boxGeometry args={[2.6, 1.1, 2.6]} />
              <Surf color={P.slab} />
            </mesh>
            <mesh position={[side * 2.75, 7.1, 0]} rotation={[0, 0, side * 0.19]} castShadow>
              <boxGeometry args={[1.5, 12.6, 1.5]} />
              <Surf color={P.steel} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 5.6, 0]} castShadow>
          <boxGeometry args={[5.8, 0.8, 0.8]} />
          <Surf color={P.steel} />
        </mesh>
        <mesh position={[0, 14.2, 0]} castShadow>
          <boxGeometry args={[20, 2, 2]} />
          <Surf color={P.steel} />
        </mesh>
        <mesh position={[0, 15.6, 0]} castShadow>
          <boxGeometry args={[7, 0.8, 1.2]} />
          <Surf color={P.steel} />
        </mesh>
        <group ref={trolley} position={[3.2, 0, 0]}>
          <mesh position={[0, 12.8, 0]} castShadow>
            <boxGeometry args={[1.9, 0.8, 2.4]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, 9.9, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 5.2, 6]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, 6.85, 0]} castShadow>
            <boxGeometry args={[1.1, 0.95, 0.9]} />
            <Surf color={P.ink} />
          </mesh>
        </group>
        <mesh position={[-7.4, 11.6, 1.3]} castShadow>
          <boxGeometry args={[3.8, 3.2, 3.2]} />
          <Surf color={P.orange} />
        </mesh>
        <mesh position={[-7.4, 11.85, 2.95]}>
          <boxGeometry args={[2.8, 1.5, 0.12]} />
          <Glow color={P.window} on={night} />
        </mesh>
        <mesh position={[-7.4, 10.0, 1.3]} castShadow>
          <boxGeometry args={[4.1, 0.4, 3.5]} />
          <Surf color={P.ink} />
        </mesh>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */
/* P2 · chimney-stack pair: two cream shafts on a boiler block, one fat puff. */

function ChimneyPair() {
  const place = placementFor('front-left')
  const scale = place.height / 14
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <mesh position={[0, 1.3, 0]} castShadow>
          <boxGeometry args={[5.6, 2.6, 4]} />
          <Surf color={P.slab} />
        </mesh>
        <mesh position={[0, 2.9, 0]} castShadow>
          <boxGeometry args={[6, 0.6, 4.4]} />
          <Surf color={P.steel} />
        </mesh>
        <mesh position={[-1.3, 7.8, 0.2]} castShadow>
          <cylinderGeometry args={[0.95, 1.35, 9.8, 8]} />
          <Surf color={P.cream} />
        </mesh>
        <mesh position={[-1.3, 13.35, 0.2]} castShadow>
          <cylinderGeometry args={[1.2, 1.0, 1.3, 8]} />
          <Surf color={P.steel} />
        </mesh>
        <mesh position={[-1.3, 5.4, 0.2]} castShadow>
          <cylinderGeometry args={[1.26, 1.3, 0.7, 8]} />
          <Surf color={P.steel} />
        </mesh>
        <mesh position={[1.7, 6.5, -0.6]} castShadow>
          <cylinderGeometry args={[0.85, 1.2, 7.2, 8]} />
          <Surf color={P.cream} />
        </mesh>
        <mesh position={[1.7, 10.6, -0.6]} castShadow>
          <cylinderGeometry args={[1.08, 0.9, 1.1, 8]} />
          <Surf color={P.steel} />
        </mesh>
        <mesh position={[-1.2, 15.0, 0.3]} scale={[1.9, 1.45, 1.7]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.smoke} />
        </mesh>
        <mesh position={[-3.0, 16.1, -0.3]} scale={[1.15, 0.95, 1.05]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.smoke} />
        </mesh>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */
/* P3 · piston press: anvil block, two steel columns, a ram that thumps at 0.5 Hz. */

function PistonPress({ ram }: { ram: GroupRef }) {
  const place = placementFor('back-right', PLACEMENTS)
  const scale = place.height / 14
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <mesh position={[0, 1.9, 0]} castShadow>
          <boxGeometry args={[5.6, 3.8, 4.6]} />
          <Surf color={P.slab} />
        </mesh>
        <mesh position={[0, 3.95, 0]} castShadow>
          <boxGeometry args={[4, 0.5, 3.2]} />
          <Surf color={P.ink} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * 1.95, 7.9, 0]} castShadow>
            <boxGeometry args={[0.9, 8.4, 0.9]} />
            <Surf color={P.concrete} />
          </mesh>
        ))}
        <mesh position={[0, 12.1, 0]} castShadow>
          <boxGeometry args={[5, 1.6, 2.6]} />
          <Surf color={P.steel} />
        </mesh>
        <mesh position={[0, 13.5, 0]} castShadow>
          <cylinderGeometry args={[1.3, 1.5, 1.6, 8]} />
          <Surf color={P.slab} />
        </mesh>
        <group ref={ram}>
          <mesh position={[0, 9.7, 0]} castShadow>
            <cylinderGeometry args={[0.85, 0.85, 3.4, 8]} />
            <Surf color={P.concrete} />
          </mesh>
          <mesh position={[0, 7.3, 0]} castShadow>
            <boxGeometry args={[3.2, 1.6, 2.5]} />
            <Surf color={P.steel} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */
/* P4 · pipe elbow run: three fat knuckles, the top run spouts past the edge. */

function PipeRun() {
  const place = placementFor('front-right')
  const scale = place.height / 12
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={scale}>
        <mesh position={[-2.2, 2.4, 0]} castShadow>
          <cylinderGeometry args={[0.8, 0.8, 4.8, 8]} />
          <Surf color={P.pipe} />
        </mesh>
        <mesh position={[-2.2, 4.8, 0]} castShadow>
          <sphereGeometry args={[1.15, 7, 5]} />
          <Surf color={P.pipe} />
        </mesh>
        <mesh position={[0, 4.8, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.8, 0.8, 4.4, 8]} />
          <Surf color={P.pipe} />
        </mesh>
        <mesh position={[2.2, 4.8, 0]} castShadow>
          <sphereGeometry args={[1.15, 7, 5]} />
          <Surf color={P.pipe} />
        </mesh>
        <mesh position={[2.2, 8.1, 0]} castShadow>
          <cylinderGeometry args={[0.8, 0.8, 6.6, 8]} />
          <Surf color={P.pipe} />
        </mesh>
        <mesh position={[2.2, 11.4, 0]} castShadow>
          <sphereGeometry args={[1.15, 7, 5]} />
          <Surf color={P.pipe} />
        </mesh>
        <mesh position={[4.3, 11.4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.8, 0.8, 4.2, 8]} />
          <Surf color={P.pipe} />
        </mesh>
        <mesh position={[6.5, 11.4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[1.1, 1.1, 0.5, 8]} />
          <Surf color={P.steel} />
        </mesh>
        <mesh position={[6.78, 11.4, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.6, 0.6, 0.1, 8]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[5.2, 5.3, 0]} castShadow>
          <boxGeometry args={[0.7, 10.6, 0.7]} />
          <Surf color={P.concrete} />
        </mesh>
        <mesh position={[2.2, 7.4, 0.95]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[1.05, 0.18, 6, 12]} />
          <Surf color={P.steel} />
        </mesh>
        <mesh position={[2.2, 7.4, 0.5]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 1.1, 6]} />
          <Surf color={P.steel} />
        </mesh>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------------ */

function Props({ propCount, night }: BouquetPropsProps) {
  const trolley = useRef<THREE.Group>(null)
  const ram = useRef<THREE.Group>(null)
  // One useFrame for the family: the trolley slides along the beam, the ram thumps at 0.5 Hz.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (trolley.current) trolley.current.position.x = Math.sin(t * 0.45) * 3.9
    if (ram.current) {
      const s = Math.sin(t * Math.PI)
      ram.current.position.y = -(s > 0 ? s * s : 0) * 2.2
    }
  })
  return (
    <group>
      <GantryCrane night={night} trolley={trolley} />
      <ChimneyPair />
      {propCount >= 3 && <PistonPress ram={ram} />}
      {propCount >= 4 && <PipeRun />}
    </group>
  )
}

/** Riveted steel edge band: thin plum ring, 12 rivet studs, 12 orange chevrons (one per 30°). */
function Rim({ color }: { color: string }) {
  const radius = BASE_RADIUS + 0.15
  const y = BASE_TOP - 0.3
  return (
    <group>
      <mesh position={[0, y, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
        <cylinderGeometry args={[radius + 0.22, radius + 0.1, 0.62, 12]} />
        <Surf color={color} />
      </mesh>
      {Array.from({ length: 12 }, (_, index) => {
        const chevron = ((index + 0.5) / 12) * Math.PI * 2
        const rivet = (index / 12) * Math.PI * 2
        return (
          <group key={index}>
            <mesh
              position={[Math.sin(rivet) * (radius + 0.34), y, Math.cos(rivet) * (radius + 0.34)]}
              rotation={[Math.PI / 2, 0, -rivet]}
              castShadow
            >
              <cylinderGeometry args={[0.24, 0.3, 0.3, 6]} />
              <Surf color={color} />
            </mesh>
            <mesh
              position={[Math.sin(chevron) * (radius + 0.36), y, Math.cos(chevron) * (radius + 0.36)]}
              rotation={[Math.PI / 2, 0, -chevron]}
              castShadow
            >
              <cylinderGeometry args={[0.62, 0.62, 0.3, 3]} />
              <Surf color={P.orange} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/** Flat concrete yard slabs instead of lobes; no scatter rocks on a works floor. */
const SLABS: readonly TerrainLobe[] = [
  { position: [0, BASE_TOP, 0], radius: 7.8, height: 1.5, stretch: [1.2, 1] },
  { position: [-1.4, BASE_TOP, -5.9], radius: 6.4, height: 2.1, stretch: [1.05, 0.9] },
  { position: [-6.3, BASE_TOP, 3], radius: 5.1, height: 1.6, stretch: [0.95, 1.1] },
  { position: [5.9, BASE_TOP, -2.9], radius: 5.7, height: 1.9, stretch: [1, 0.92] },
  { position: [5.4, BASE_TOP, 3.7], radius: 5.4, height: 1.5, stretch: [1.05, 0.9] },
  { position: [0.6, BASE_TOP, 5.2], radius: 4.6, height: 1.1, stretch: [1.25, 0.8] },
]

export const heavyIndustry: BiomeBouquet = {
  spec: {
    id: 'heavy-industry',
    name: 'Rivet Gantry Works',
    silhouette: 'A plum-steel T-shaped gantry with one orange cab over a warm grey concrete disc; two pale chimneys lean off the left edge.',
    hero: 'gantry-crane',
    elements: [
      { id: 'gantry-crane', height: 32, slot: 'hero' },
      { id: 'chimney-pair', height: 28, slot: 'front-left' },
      { id: 'piston-press', height: 28, slot: 'back-right' },
      { id: 'pipe-run', height: 24, slot: 'front-right' },
    ],
    rim: 'Riveted steel edge band: a thin plum-steel ring with 12 rivet studs and 12 orange chevron wedges, one every 30 degrees.',
    exaggeration: 'The gantry beam is 38 m long on a 32 m plinth, so the T overhangs both plinth edges; its orange cab is a whole room wide.',
    closestProtected: 'No Kirby pedestal is industrial; nearest read is a generic "chemical plant" level with blue tubes. Ours is warm concrete, plum steel, a single orange cab and a riveted rim.',
  },
  Props,
  Rim,
  terrain: { primary: P.slab, secondary: P.concrete, lobes: SLABS, rocks: false },
}
