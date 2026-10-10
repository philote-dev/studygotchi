import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { Glow, Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, outwardRotation, placementFor, type TerrainLobe } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/**
 * Harbor Town: "Quayside Sail Burst". A tall ship moored in a stone basin at
 * the back, a canal-gabled warehouse cluster front-left, a treadwheel crane
 * back-right and a giant buoy with bollards in a front-right inlet.
 * No lighthouse (that belongs to Ice).
 */
const P = {
  quay: '#7f8f9c',
  cobble: '#a3aeb8',
  kerb: '#5f6f7c',
  hull: '#4a3c36',
  sail: '#f4e9d2',
  marigold: '#f0b429',
  teal: '#5f9ea8',
  slate: '#6d7f96',
  timber: '#786557',
  ink: '#3a2f45',
  cream: '#fffaf3',
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

const SHIP_HEIGHT = 16

/** P1: tall ship, broadside, mainsail wider than the hull is long; one marigold stripe. */
function TallShip() {
  const place = placementFor('hero')
  const bob = useRef<Group>(null)
  useFrame(({ clock }) => {
    const ship = bob.current
    if (!ship) return
    const t = clock.elapsedTime
    ship.position.y = Math.sin(t * 1.1) * 0.12
    ship.rotation.z = Math.sin(t * 0.8) * 0.025
  })
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group ref={bob} rotation={[0, 0.32, 0]}>
        <group scale={place.height / SHIP_HEIGHT} position={[-1.6, 0, 0]}>
          <mesh position={[0, 1.15, 0]} scale={[4.2, 1.15, 1.55]} castShadow>
            <dodecahedronGeometry args={[1, 0]} />
            <Surf color={P.hull} />
          </mesh>
          <mesh position={[0.2, 2.25, 0]} castShadow>
            <boxGeometry args={[6.8, 0.3, 2.5]} />
            <Surf color={P.cream} />
          </mesh>
          <mesh position={[-2.6, 2.95, 0]} castShadow>
            <boxGeometry args={[1.9, 1.2, 2.3]} />
            <Surf color={P.sail} />
          </mesh>
          <mesh position={[-2.6, 3.65, 0]} castShadow>
            <boxGeometry args={[2.2, 0.26, 2.6]} />
            <Surf color={P.hull} />
          </mesh>
          <mesh position={[0.6, 9.2, 0]} castShadow>
            <cylinderGeometry args={[0.24, 0.4, 13.6, 8]} />
            <Surf color={P.hull} />
          </mesh>
          <mesh position={[0.6, 6.7, 0.35]} castShadow>
            <boxGeometry args={[9.6, 5.2, 0.22]} />
            <Surf color={P.sail} />
          </mesh>
          <mesh position={[0.6, 6.9, 0.42]} castShadow>
            <boxGeometry args={[9.7, 1.3, 0.26]} />
            <Surf color={P.marigold} />
          </mesh>
          <mesh position={[0.6, 9.45, 0.3]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.26, 0.26, 10.6, 6]} />
            <Surf color={P.hull} />
          </mesh>
          <mesh position={[0.6, 4.0, 0.3]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.22, 0.22, 10, 6]} />
            <Surf color={P.hull} />
          </mesh>
          <mesh position={[0.6, 12, 0.35]} castShadow>
            <boxGeometry args={[7.6, 3.6, 0.22]} />
            <Surf color={P.sail} />
          </mesh>
          <mesh position={[0.6, 12.2, 0.42]} castShadow>
            <boxGeometry args={[7.7, 0.9, 0.26]} />
            <Surf color={P.marigold} />
          </mesh>
          <mesh position={[0.6, 13.95, 0.3]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.24, 0.24, 8.4, 6]} />
            <Surf color={P.hull} />
          </mesh>
          <mesh position={[0.6, 14.5, 0]} castShadow>
            <cylinderGeometry args={[0.7, 0.5, 0.6, 8]} />
            <Surf color={P.hull} />
          </mesh>
          <mesh position={[5.9, 3.4, 0]} rotation={[0, 0, -1.15]} castShadow>
            <cylinderGeometry args={[0.1, 0.2, 4.2, 6]} />
            <Surf color={P.hull} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

function Warehouse({
  x,
  z,
  yaw,
  width,
  depth,
  wallHeight,
  peak,
  color,
  night,
  window,
  hoist = false,
}: {
  x: number
  z: number
  yaw: number
  width: number
  depth: number
  wallHeight: number
  peak: number
  color: string
  night: boolean
  window?: number
  hoist?: boolean
}) {
  const rise = peak - wallHeight
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, wallHeight / 2, 0]} castShadow>
        <boxGeometry args={[width, wallHeight, depth]} />
        <Surf color={color} />
      </mesh>
      <Gable x={0} baseY={wallHeight} z={0} width={width * 1.14} depth={depth * 1.1} rise={rise} color={P.kerb} />
      <Gable x={0} baseY={wallHeight + rise * 0.08} z={0.18} width={width * 0.96} depth={depth * 1.1} rise={rise * 0.84} color={color} />
      <mesh position={[0, 1.7, depth / 2 + 0.06]}>
        <boxGeometry args={[0.9, 2.2, 0.12]} />
        <Surf color={P.ink} />
      </mesh>
      {window !== undefined && (
        <mesh position={[0, window, depth / 2 + 0.06]}>
          <boxGeometry args={[0.8, 1.1, 0.12]} />
          <Glow color={P.light} on={night} intensity={1.5} />
        </mesh>
      )}
      {hoist && (
        <mesh position={[0, peak - 0.9, depth / 2 + 0.9]} castShadow>
          <boxGeometry args={[0.28, 0.28, 1.7]} />
          <Surf color={P.ink} />
        </mesh>
      )}
    </group>
  )
}

const ROW_HEIGHT = 14

/** P2: three narrow canal warehouses, gables as tall as their walls, one hoist beam. */
function WarehouseRow({ night }: { night: boolean }) {
  const place = placementFor('front-left')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / ROW_HEIGHT} position={[-2.2, 0, 0]}>
        <Warehouse x={-2.4} z={1.3} yaw={0.12} width={2.6} depth={3.6} wallHeight={5.8} peak={10.4} color={P.teal} night={night} window={3.6} />
        <Warehouse x={0.3} z={-0.3} yaw={0} width={2.9} depth={3.8} wallHeight={7.8} peak={14} color={P.sail} night={night} window={5.2} hoist />
        <Warehouse x={2.9} z={-1.5} yaw={-0.14} width={2.6} depth={3.6} wallHeight={6.6} peak={11.6} color={P.slate} night={night} />
      </group>
    </group>
  )
}

const CRANE_HEIGHT = 15

/** P3: timber treadwheel crane; the wheel is wider than the crane house. */
function HarbourCrane() {
  const place = placementFor('back-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / CRANE_HEIGHT}>
        <mesh position={[0, 3.25, 0]} castShadow>
          <cylinderGeometry args={[1.7, 2.4, 6.5, 8]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[0, 7.75, 0]} castShadow>
          <coneGeometry args={[2.9, 2.5, 8]} />
          <Surf color={P.ink} />
        </mesh>
        <group position={[1.2, 3.9, 2.4]}>
          <mesh castShadow>
            <torusGeometry args={[2.5, 0.42, 6, 16]} />
            <Surf color={P.timber} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.5, 1.3, 6]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh castShadow>
            <boxGeometry args={[4.6, 0.3, 0.3]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <boxGeometry args={[4.6, 0.3, 0.3]} />
            <Surf color={P.ink} />
          </mesh>
        </group>
        <mesh position={[4.47, 11.8, 0]} rotation={[0, 0, -0.95]} castShadow>
          <cylinderGeometry args={[0.26, 0.42, 11, 6]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[3.25, 6.8, 0]} rotation={[0, 0, -0.289]} castShadow>
          <cylinderGeometry args={[0.17, 0.17, 8.8, 6]} />
          <Surf color={P.timber} />
        </mesh>
        <mesh position={[8.94, 11.8, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 6.4, 5]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[8.94, 7.1, 0]} castShadow>
          <boxGeometry args={[1.6, 1.4, 1.6]} />
          <Surf color={P.cream} />
        </mesh>
      </group>
    </group>
  )
}

const BUOY_HEIGHT = 12
const BOLLARDS: readonly (readonly [number, number, number])[] = [
  [-2.2, 1.6, 2.4],
  [-3.2, 3, 2],
  [-1.4, 3.3, 2.2],
]

/** P4: a buoy as big as the bollard cluster beside it, floating in the inlet. */
function BuoyBollards() {
  const place = placementFor('front-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / BUOY_HEIGHT}>
        <group position={[1.6, 0, 1.4]}>
          <mesh position={[0, 1.9, 0]} scale={[1, 0.85, 1]} castShadow>
            <sphereGeometry args={[1.9, 7, 5]} />
            <Surf color={P.marigold} />
          </mesh>
          <mesh position={[0, 1.9, 0]} castShadow>
            <cylinderGeometry args={[1.98, 1.98, 0.4, 7]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, 3.9, 0]} castShadow>
            <cylinderGeometry args={[0.7, 1.5, 1.8, 7]} />
            <Surf color={P.marigold} />
          </mesh>
          <mesh position={[0, 7.3, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.28, 5, 6]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, 9.9, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.7, 0.13, 4, 10]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, 10.4, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
            <Surf color={P.cream} />
          </mesh>
          <mesh position={[0, 11.45, 0]} castShadow>
            <coneGeometry args={[0.65, 1.1, 6]} />
            <Surf color={P.ink} />
          </mesh>
        </group>
        {BOLLARDS.map(([x, z, height]) => (
          <mesh key={`${x}:${z}`} position={[x, height / 2, z]} castShadow>
            <cylinderGeometry args={[0.8, 0.6, height, 8]} />
            <Surf color={P.ink} />
          </mesh>
        ))}
        <mesh position={[-2.2, 1.9, 1.6]} rotation={[Math.PI / 2 + 0.25, 0, 0]} castShadow>
          <torusGeometry args={[0.95, 0.17, 4, 10]} />
          <Surf color={P.sail} />
        </mesh>
      </group>
    </group>
  )
}

function HarborProps({ propCount, night }: BouquetPropsProps) {
  return (
    <group>
      <TallShip />
      <WarehouseRow night={night} />
      {propCount >= 3 && <HarbourCrane />}
      {propCount >= 4 && <BuoyBollards />}
    </group>
  )
}

/** Cobble kerb ring with six ink mooring bollards, each wearing a rope loop. */
function HarborRim({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, BASE_TOP - 0.3, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
        <cylinderGeometry args={[BASE_RADIUS + 0.4, BASE_RADIUS + 0.2, 0.6, 12]} />
        <Surf color={color} />
      </mesh>
      {Array.from({ length: 6 }, (_, index) => {
        const angle = (index / 6) * Math.PI * 2 + Math.PI / 6
        return (
          <group
            key={index}
            position={[Math.sin(angle) * (BASE_RADIUS + 0.15), BASE_TOP, Math.cos(angle) * (BASE_RADIUS + 0.15)]}
            rotation={[0, angle, 0]}
          >
            <mesh position={[0, 0.9, 0]} castShadow>
              <cylinderGeometry args={[0.62, 0.5, 1.8, 8]} />
              <Surf color={P.ink} />
            </mesh>
            <mesh position={[0, 1.2, 0]} rotation={[Math.PI / 2 + 0.2, 0, 0]} castShadow>
              <torusGeometry args={[0.78, 0.17, 4, 10]} />
              <Surf color={P.sail} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/** Quay slabs with two water lobes (indices 0 and 3 take the secondary colour): the ship basin and the buoy inlet. */
const LOBES: readonly TerrainLobe[] = [
  { position: [-1.4, BASE_TOP, -6.4], radius: 6.6, height: 1.3, stretch: [1.35, 0.78] },
  { position: [0.6, BASE_TOP, 0.4], radius: 7.2, height: 2.6, stretch: [1.15, 0.72] },
  { position: [-6.4, BASE_TOP, 3.2], radius: 5.4, height: 2.6, stretch: [1, 1.02] },
  { position: [7.6, BASE_TOP, 5.8], radius: 4.2, height: 1.2, stretch: [1.15, 0.9] },
  { position: [7.4, BASE_TOP, -1.6], radius: 5, height: 3.2, stretch: [0.9, 0.9] },
  { position: [0.4, BASE_TOP, 6.4], radius: 4.4, height: 2, stretch: [1.3, 0.75] },
]

export const harborTown: BiomeBouquet = {
  spec: {
    id: 'harbor-town',
    name: 'Quayside Sail Burst',
    silhouette: 'One tall mast with a cream square sail, wider than the dark hull under it, over a blue-grey cobble disc; a long crane jib tilts off the right edge.',
    hero: 'tall-ship',
    elements: [
      { id: 'tall-ship', height: 32, slot: 'hero' },
      { id: 'warehouse-row', height: 28, slot: 'front-left' },
      { id: 'harbour-crane', height: 28, slot: 'back-right' },
      { id: 'buoy-bollard', height: 24, slot: 'front-right' },
    ],
    rim: 'Cobble kerb ring in kerb slate around the quay edge, six ink mooring bollards at 60 degree steps, each with a cream rope loop slung over it.',
    exaggeration: 'The mainsail is wider than the hull is long: a 19 m cream sail with a marigold stripe on a 17 m hull, so the ship reads as sail first, boat second.',
    closestProtected: 'Kirby W4 (palm island with a lighthouse on soft dough). Ours has no lighthouse and no palm: a tall ship in a stone basin, canal-gabled warehouses, a treadwheel crane and a giant buoy on a cut-stone quay.',
  },
  Props: HarborProps,
  Rim: HarborRim,
  terrain: { primary: P.cobble, secondary: P.slate, lobes: LOBES, rocks: false },
}
