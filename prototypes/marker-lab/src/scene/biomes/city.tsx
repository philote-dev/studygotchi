import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { Glow, Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, outwardRotation, placementFor, type TerrainLobe } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/** City palette: roster row + pedestal hexes, ink and cream for details. */
const P = {
  wall: '#e6f2fb',
  /** Roof plates: one step darker than the plinth side (review: `#b98bb0` merged into the plaster). */
  roof: '#a57aa0',
  paving: '#d9c3d6',
  kerbCream: '#f6ecd2',
  kerb: '#6b5f7a',
  awning: '#e88a8a',
  leaf: '#4f8a4a',
  ink: '#3a2f45',
  cream: '#fffaf3',
  light: '#ffe9a8',
} as const

const LOWER_COLS = [-6, -2, 2, 6] as const
const LOWER_ROWS = [6.2, 12.6] as const
const UPPER_COLS = [-2.2, 2.2] as const
const UPPER_ROWS = [20.4, 25.8] as const

/**
 * Night checker: 6 of the 12 facets light up, so at 48 px every lit window has a
 * dark neighbour on each side (≥ 4 m pitch between lit boxes) and the grid reads
 * as points rather than one bright block.
 */
const lit = (column: number, row: number) => (column + row) % 2 === 0

/**
 * P1 tower block, 32 m. Exaggerated feature: it is all window grid, twelve
 * storey-tall facets on a stepped slab with mauve roof plates, six lit at night.
 */
function TowerBlock({ night }: { night: boolean }) {
  const place = placementFor('hero')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 32}>
        <mesh position={[0, 1.2, 0]} castShadow>
          <boxGeometry args={[16.8, 2.4, 11.2]} />
          <Surf color={P.roof} />
        </mesh>
        <mesh position={[0, 9.65, 0]} castShadow>
          <boxGeometry args={[16, 14.5, 10]} />
          <Surf color={P.wall} />
        </mesh>
        <mesh position={[0, 17.4, 0]} castShadow>
          <boxGeometry args={[17, 1, 11]} />
          <Surf color={P.roof} />
        </mesh>
        <mesh position={[0, 23.4, -0.6]} castShadow>
          <boxGeometry args={[10, 11, 8]} />
          <Surf color={P.wall} />
        </mesh>
        <mesh position={[0, 29.6, -0.6]} castShadow>
          <boxGeometry args={[11.4, 1.4, 9.4]} />
          <Surf color={P.roof} />
        </mesh>
        <mesh position={[0, 31.15, -1]} castShadow>
          <boxGeometry args={[5, 1.7, 4.4]} />
          <Surf color={P.roof} />
        </mesh>
        {LOWER_ROWS.map((y, row) =>
          LOWER_COLS.map((x, column) => (
            <mesh key={`${x}:${y}`} position={[x, y, 5.15]}>
              <boxGeometry args={[2.6, 3.6, 0.3]} />
              <Glow color={P.light} on={night && lit(column, row)} />
            </mesh>
          )),
        )}
        {UPPER_ROWS.map((y, row) =>
          UPPER_COLS.map((x, column) => (
            <mesh key={`${x}:${y}`} position={[x, y, 3.55]}>
              <boxGeometry args={[2.8, 3.6, 0.3]} />
              <Glow color={P.light} on={night && lit(column, row + 1)} />
            </mesh>
          )),
        )}
      </group>
    </group>
  )
}

/**
 * P2 clock tower, 28 m. Exaggerated feature: a blank cream clock face whose
 * radius is 0.4 of the tower width (the disc spans 80 % of the clock stage),
 * two ink hands, no numerals. The hands tick: the family's one useFrame.
 */
function ClockTower() {
  const place = placementFor('front-left')
  const minute = useRef<Group>(null)
  const hour = useRef<Group>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (minute.current) minute.current.rotation.z = -t * 0.55
    if (hour.current) hour.current.rotation.z = -t * 0.046 - 0.9
  })
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      {/* Review: +2 m outward left so the tower block and clock tower do not merge. */}
      <group position={[-2, 0, 0]} scale={place.height / 28}>
        <mesh position={[0, 1.5, 0]} castShadow>
          <boxGeometry args={[8, 3, 8]} />
          <Surf color={P.roof} />
        </mesh>
        <mesh position={[0, 10.5, 0]} castShadow>
          <boxGeometry args={[6, 15, 6]} />
          <Surf color={P.wall} />
        </mesh>
        <mesh position={[0, 18.4, 0]} castShadow>
          <boxGeometry args={[7.6, 0.8, 7.6]} />
          <Surf color={P.roof} />
        </mesh>
        <mesh position={[0, 21.8, 0]} castShadow>
          <boxGeometry args={[7, 6, 7]} />
          <Surf color={P.wall} />
        </mesh>
        <mesh position={[0, 26.4, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[5.4, 3.2, 4]} />
          <Surf color={P.roof} />
        </mesh>
        <mesh position={[0, 21.8, 3.6]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[3.2, 3.2, 0.3, 10]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, 21.8, 3.85]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[2.8, 2.8, 0.3, 10]} />
          <Surf color={P.cream} />
        </mesh>
        <group ref={minute} position={[0, 21.8, 4.1]}>
          <mesh position={[0, 1.2, 0]}>
            <boxGeometry args={[0.45, 2.4, 0.2]} />
            <Surf color={P.ink} />
          </mesh>
        </group>
        <group ref={hour} position={[0, 21.8, 4.1]}>
          <mesh position={[0, 0.8, 0]}>
            <boxGeometry args={[0.55, 1.6, 0.2]} />
            <Surf color={P.ink} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

function Townhouse({
  position,
  width,
  wallHeight,
  roofHeight,
  windows,
  awnings,
  chimney,
  night,
}: {
  position: readonly [number, number, number]
  width: number
  wallHeight: number
  roofHeight: number
  windows: readonly number[]
  awnings: readonly number[]
  chimney?: boolean
  night: boolean
}) {
  const depth = 7
  const front = depth / 2
  return (
    <group position={position}>
      <mesh position={[0, wallHeight / 2, 0]} castShadow>
        <boxGeometry args={[width, wallHeight, depth]} />
        <Surf color={P.wall} />
      </mesh>
      <mesh position={[0, wallHeight + roofHeight / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[width * 0.78, roofHeight, 4]} />
        <Surf color={P.roof} />
      </mesh>
      {chimney && (
        <mesh position={[width * 0.3, wallHeight + roofHeight * 0.3, -depth * 0.3]} castShadow>
          <boxGeometry args={[1.4, roofHeight * 0.7, 1.4]} />
          <Surf color={P.roof} />
        </mesh>
      )}
      {windows.map((y) => (
        <mesh key={y} position={[0, y, front + 0.15]}>
          <boxGeometry args={[2.4, 3.2, 0.3]} />
          <Glow color={P.light} on={night} />
        </mesh>
      ))}
      <mesh position={[0, 2.2, front + 0.1]}>
        <boxGeometry args={[2.2, 4.4, 0.3]} />
        <Surf color={P.ink} />
      </mesh>
      {awnings.map((y) => (
        <mesh key={y} position={[0, y - 0.85, front + 2.55]} rotation={[0.32, 0, 0]} castShadow>
          <boxGeometry args={[width * 1.1, 0.6, 5.4]} />
          <Surf color={P.awning} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * P3 townhouse pair, 28 m. The family's accent object. Exaggerated feature:
 * coral awnings that stick out a full storey (5 m) over door and top window.
 */
function TownhousePair({ night }: { night: boolean }) {
  const place = placementFor('back-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 28}>
        <Townhouse position={[-2.6, 0, 0.6]} width={5.8} wallHeight={23} roofHeight={5} windows={[9, 16.5]} awnings={[5.4, 20.6]} chimney night={night} />
        <Townhouse position={[3.2, 0, -1]} width={5.4} wallHeight={16.5} roofHeight={4.5} windows={[7.5, 12.5]} awnings={[15.8]} night={night} />
      </group>
    </group>
  )
}

/**
 * P4 lamp post + planter tree, 24 m. Exaggerated feature: a lamp post as tall
 * as a six-storey house with a lantern the size of a room, beside a planter
 * tree whose box is as big as the tree's own canopy.
 */
function LampPlanter({ night }: { night: boolean }) {
  const place = placementFor('front-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 24}>
        <group position={[0, 0, 2.6]}>
          <mesh position={[0, 0.7, 0]} castShadow>
            <cylinderGeometry args={[1.3, 1.7, 1.4, 8]} />
            <Surf color={P.kerb} />
          </mesh>
          <mesh position={[0, 10.7, 0]} castShadow>
            <cylinderGeometry args={[0.42, 0.65, 18.6, 8]} />
            <Surf color={P.kerb} />
          </mesh>
          <mesh position={[0, 20.35, 0]} castShadow>
            <cylinderGeometry args={[1.25, 0.6, 0.7, 8]} />
            <Surf color={P.kerb} />
          </mesh>
          <mesh position={[0, 21.8, 0]}>
            <boxGeometry args={[2.6, 2.2, 2.6]} />
            <Glow color={P.light} on={night} intensity={1.8} />
          </mesh>
          <mesh position={[0, 23.45, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[2.4, 1.1, 4]} />
            <Surf color={P.kerb} />
          </mesh>
        </group>
        <group position={[4.8, 0, 1]}>
          <mesh position={[0, 1.3, 0]} castShadow>
            <boxGeometry args={[5.6, 2.6, 5.6]} />
            <Surf color={P.kerb} />
          </mesh>
          <mesh position={[0, 2.8, 0]} castShadow>
            <boxGeometry args={[6.2, 0.6, 6.2]} />
            <Surf color={P.kerbCream} />
          </mesh>
          <mesh position={[0, 4.6, 0]} castShadow>
            <cylinderGeometry args={[0.55, 0.8, 3.4, 6]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, 9.6, 0]} scale={[1.05, 0.92, 1]} castShadow>
            <sphereGeometry args={[3.8, 7, 5]} />
            <Surf color={P.leaf} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

function CityProps({ propCount, night }: BouquetPropsProps) {
  return (
    <group>
      <TowerBlock night={night} />
      <ClockTower />
      {propCount >= 3 && <TownhousePair night={night} />}
      {propCount >= 4 && <LampPlanter night={night} />}
    </group>
  )
}

/** Kerb and cobble ring: a plum kerb band around the plinth edge with flat cream and mauve cobble plates set on top. */
function CityRim({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, BASE_TOP - 0.15, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
        <cylinderGeometry args={[BASE_RADIUS + 0.45, BASE_RADIUS + 0.25, 0.7, 12]} />
        <Surf color={P.kerb} />
      </mesh>
      {Array.from({ length: 24 }, (_, index) => {
        const angle = (index / 24) * Math.PI * 2 + 0.08
        return (
          <group key={index} rotation={[0, angle, 0]}>
            <mesh position={[0, BASE_TOP + 0.36, BASE_RADIUS + 0.1]} castShadow>
              <boxGeometry args={[index % 2 ? 3 : 2.4, 0.36, 1.1]} />
              <Surf color={index % 2 ? color : P.paving} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/** Paving plates: the shared lobe footprint, flattened to 1–1.8 m so the terrain reads as a plaza, not hills. */
const PAVING_LOBES: readonly TerrainLobe[] = [
  { position: [0, BASE_TOP, 0], radius: 7.6, height: 1.4, stretch: [1.2, 1] },
  { position: [-1.5, BASE_TOP, -5.8], radius: 6.3, height: 1.8, stretch: [1.05, 0.9] },
  { position: [-6.2, BASE_TOP, 3], radius: 5.2, height: 1.2, stretch: [0.9, 1.1] },
  { position: [5.8, BASE_TOP, -2.8], radius: 5.8, height: 1.6, stretch: [1, 0.92] },
  { position: [5.3, BASE_TOP, 3.6], radius: 5.6, height: 1.3, stretch: [1.05, 0.9] },
  { position: [0.5, BASE_TOP, 5], radius: 4.8, height: 1, stretch: [1.25, 0.8] },
]

export const city: BiomeBouquet = {
  spec: {
    id: 'city',
    name: 'Lilac Block Skyline',
    silhouette:
      'A pale stepped tower block with mauve roof plates, over a mauve paving disc; a cream clock dot at front-left and a coral awning flash at the right.',
    hero: 'tower-block',
    elements: [
      { id: 'tower-block', height: 32, slot: 'hero' },
      { id: 'clock-tower', height: 28, slot: 'front-left' },
      { id: 'townhouse-pair', height: 28, slot: 'back-right' },
      { id: 'lamp-planter', height: 24, slot: 'front-right' },
    ],
    rim: 'Kerb and cobble ring: a dark plum kerb band around the plinth edge with a ring of flat cream and mauve cobble plates set on top of it.',
    exaggeration: 'The tower block is all window grid: twelve chunky facets across its stepped front, each a full storey tall, six lit in a checker at night.',
    closestProtected:
      'Kirby W6 (sandstone keep towers with green pipes on a stone pedestal). Ours has no keep and no pipes: a stepped window-grid tower block, a clock tower whose face spans most of its width, townhouses with awnings that stick out a storey, and a 24 m lamp post, on a paving-plate plinth with a cobble kerb.',
  },
  Props: CityProps,
  Rim: CityRim,
  terrain: { primary: P.paving, secondary: P.kerbCream, lobes: PAVING_LOBES, rocks: false },
}
