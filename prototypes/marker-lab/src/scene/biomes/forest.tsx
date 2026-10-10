import { Glow, Surf } from '../../render/materials'
import { BASE_RADIUS, BASE_TOP, outwardRotation, placementFor } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/** Forest palette: roster row + pedestal hexes, ink and cream for details. */
const P = {
  canopy: '#4f8a4a',
  leaf: '#6fa86a',
  grass: '#8fc48a',
  turf: '#a9d69a',
  bark: '#8b5a3c',
  cap: '#d9765c',
  wall: '#f2e3c6',
  cream: '#f4e9d2',
  ink: '#3a2f45',
  light: '#ffe9a8',
} as const

/**
 * P1 great round tree, 32 m. Exaggerated feature: ONE faceted ball canopy,
 * about 34 m across on a 16 m plinth, so the tree is wider than its ground.
 */
function GreatRoundTree() {
  const place = placementFor('hero')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 32}>
        <mesh position={[0, 6.8, 0]} castShadow>
          <cylinderGeometry args={[2.7, 3.9, 13.6, 8]} />
          <Surf color={P.bark} />
        </mesh>
        {(
          [
            [-3.1, 0.9, 1.7, 0.6],
            [3.3, 0.8, 1.1, -0.9],
            [0.6, 0.7, -3.4, 2.4],
          ] as const
        ).map(([x, y, z, yaw]) => (
          <mesh key={`${x}:${z}`} position={[x, y, z]} rotation={[0, yaw, 0]} scale={[2.5, 1.3, 1.5]} castShadow>
            <dodecahedronGeometry args={[1, 0]} />
            <Surf color={P.bark} />
          </mesh>
        ))}
        <mesh position={[-6.6, 10.4, 1.6]} rotation={[0.15, 0, 1.25]} castShadow>
          <cylinderGeometry args={[0.7, 1.3, 9.2, 6]} />
          <Surf color={P.bark} />
        </mesh>
        <mesh position={[0, 21.3, 0]} rotation={[0, 0.3, 0]} scale={[1.3, 0.82, 1.15]} castShadow>
          <dodecahedronGeometry args={[13, 1]} />
          <Surf color={P.canopy} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * P2 round-tree pair, 28 m. Exaggerated feature: the size gap, a 28 m lollipop
 * with a 16 m companion tucked at its foot; both are plain balls on long trunks.
 */
function RoundTreePair() {
  const place = placementFor('front-left')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 28}>
        <mesh position={[0, 9.1, 0]} castShadow>
          <cylinderGeometry args={[1.15, 1.75, 18.2, 7]} />
          <Surf color={P.bark} />
        </mesh>
        <mesh position={[0.2, 0.9, 0.3]} rotation={[0, 0.5, 0]} scale={[2.3, 1, 1.9]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.bark} />
        </mesh>
        <mesh position={[2.3, 12.4, 0.6]} rotation={[0, 0, -0.95]} castShadow>
          <cylinderGeometry args={[0.45, 0.85, 5, 6]} />
          <Surf color={P.bark} />
        </mesh>
        <mesh position={[0, 21.9, 0]} rotation={[0, 0.7, 0]} scale={[1.04, 0.98, 1]} castShadow>
          <dodecahedronGeometry args={[6.2, 1]} />
          <Surf color={P.leaf} />
        </mesh>
        <mesh position={[3.9, 4.6, 4.3]} rotation={[0.06, 0, -0.08]} castShadow>
          <cylinderGeometry args={[0.7, 1.05, 9.2, 6]} />
          <Surf color={P.bark} />
        </mesh>
        <mesh position={[4.3, 12.4, 4.6]} rotation={[0.2, 0.4, 0]} castShadow>
          <dodecahedronGeometry args={[4.1, 0]} />
          <Surf color={P.leaf} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * P3 mushroom cottage, 28 m. The family's accent object. Exaggerated feature:
 * a coral cap 26 m wide that swallows the 9 m cottage stem under it. No white
 * spots (that is Kirby W1's toadstool); it is a house, with door, window, chimney.
 */
function MushroomCottage({ night }: { night: boolean }) {
  const place = placementFor('back-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group position={[1.6, 0, -2.4]} scale={place.height / 28}>
        <mesh position={[0, 8, 0]} castShadow>
          <cylinderGeometry args={[4.2, 5.2, 16, 8]} />
          <Surf color={P.wall} />
        </mesh>
        <mesh position={[0, 18.4, 0]} castShadow>
          <cylinderGeometry args={[9.4, 7.2, 3, 8]} />
          <Surf color={P.cream} />
        </mesh>
        <mesh position={[0, 22, 0]} rotation={[0, 0.4, 0]} scale={[1.15, 0.7, 1.15]} castShadow>
          <dodecahedronGeometry args={[8.6, 1]} />
          <Surf color={P.cap} />
        </mesh>
        <mesh position={[4.4, 25.6, -2.2]} castShadow>
          <boxGeometry args={[1.9, 5.6, 1.9]} />
          <Surf color={P.wall} />
        </mesh>
        <mesh position={[4.4, 28.5, -2.2]}>
          <boxGeometry args={[2.3, 0.6, 2.3]} />
          <Surf color={P.ink} />
        </mesh>
        <group position={[3.3, 7.4, 3.3]} rotation={[0, Math.PI / 4, 0]}>
          <mesh>
            <boxGeometry args={[3.2, 5.2, 0.5]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, -0.1, 0.3]}>
            <boxGeometry args={[2.4, 4.4, 0.3]} />
            <Glow color={P.light} on={night} />
          </mesh>
          <mesh position={[0, -2.85, 0.7]} castShadow>
            <boxGeometry args={[3.8, 0.55, 2]} />
            <Surf color={P.cream} />
          </mesh>
        </group>
        <group position={[-3.4, 9.6, 3.4]} rotation={[0, -Math.PI / 4, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[1.75, 1.75, 0.4, 8]} />
            <Surf color={P.ink} />
          </mesh>
          <mesh position={[0, 0, 0.3]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[1.25, 1.25, 0.3, 8]} />
            <Glow color={P.light} on={night} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/** [yaw, outward tilt, blade length, colour] for the fern fronds; they fan front and left so the cottage door stays open. */
const FRONDS = [
  [0.15, 0.06, 23, P.canopy],
  [-1.1, 0.46, 20, P.canopy],
  [0.3, 0.44, 18.5, P.leaf],
  [-2.2, 0.5, 17, P.leaf],
  [2.8, 0.42, 15, P.canopy],
] as const

/**
 * P4 log + fern clump, 24 m. Exaggerated feature: fern blades as tall as the
 * trees, fanning out over the plinth edge from behind a house-thick log.
 */
function LogFern() {
  const place = placementFor('front-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 24}>
        <group position={[-5.8, 3.1, 2.4]} rotation={[0, -0.6, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[3.4, 3, 13, 8]} />
            <Surf color={P.bark} />
          </mesh>
          <mesh position={[6.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[2.6, 2.6, 0.5, 8]} />
            <Surf color={P.cream} />
          </mesh>
          <mesh position={[-2.4, 3.6, -0.8]} rotation={[0.35, 0, 0.5]} castShadow>
            <cylinderGeometry args={[0.6, 1.05, 5.2, 6]} />
            <Surf color={P.bark} />
          </mesh>
        </group>
        <group position={[-0.2, 0, -2.2]}>
          <mesh position={[0, 1.6, 0]} scale={[1.8, 0.9, 1.5]} castShadow>
            <dodecahedronGeometry args={[2.4, 0]} />
            <Surf color={P.leaf} />
          </mesh>
          {FRONDS.map(([yaw, tilt, length, color]) => (
            <group key={yaw} rotation={[0, yaw, 0]}>
              <group position={[0, 1, 0]} rotation={[tilt, 0, 0]}>
                <mesh position={[0, length / 2, 0]} scale={[1.7, 1, 0.28]} castShadow>
                  <coneGeometry args={[2.6, length, 5]} />
                  <Surf color={color} />
                </mesh>
              </group>
            </group>
          ))}
        </group>
      </group>
    </group>
  )
}

function ForestProps({ propCount, night }: BouquetPropsProps) {
  return (
    <group>
      <GreatRoundTree />
      <RoundTreePair />
      {propCount >= 3 && <MushroomCottage night={night} />}
      {propCount >= 4 && <LogFern />}
    </group>
  )
}

/** Grass-tuft edge: twelve leaning turf blades with brown root knuckles poking over between them. */
function ForestRim({ color }: { color: string }) {
  return (
    <group>
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2
        const tall = index % 3 === 0 ? 2.7 : 2.1
        return (
          <group key={`tuft-${index}`} rotation={[0, angle, 0]}>
            <group position={[0, BASE_TOP - 0.3, BASE_RADIUS + 0.15]} rotation={[0.42, 0, 0]}>
              <mesh position={[0, tall / 2, 0]} scale={[1.3, 1, 0.5]} castShadow>
                <coneGeometry args={[0.85, tall, 5]} />
                <Surf color={color} />
              </mesh>
            </group>
          </group>
        )
      })}
      {Array.from({ length: 6 }, (_, index) => {
        const angle = ((index + 0.5) / 6) * Math.PI * 2 + Math.PI / 12
        return (
          <group key={`root-${index}`} rotation={[0, angle, 0]}>
            <mesh position={[0, BASE_TOP - 0.35, BASE_RADIUS + 0.5]} rotation={[0.3, 0, 0]} scale={[1.1, 0.65, 1.7]} castShadow>
              <dodecahedronGeometry args={[0.7, 0]} />
              <Surf color={P.bark} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export const forest: BiomeBouquet = {
  spec: {
    id: 'forest',
    name: 'Giant Canopy Glade',
    silhouette:
      'One dark-green faceted ball, wider than the plinth, floating over a pale green disc, with a coral mushroom dot tucked at its right shoulder.',
    hero: 'great-round-tree',
    elements: [
      { id: 'great-round-tree', height: 32, slot: 'hero' },
      { id: 'round-tree-pair', height: 28, slot: 'front-left' },
      { id: 'mushroom-cottage', height: 28, slot: 'back-right' },
      { id: 'log-fern', height: 24, slot: 'front-right' },
    ],
    rim: 'Grass-tuft edge: twelve leaning turf blades around the plinth lip with brown root knuckles poking over the edge between them.',
    exaggeration: 'The hero canopy is a single faceted ball about 34 m across on a 16 m plinth: the tree is wider than the ground it grows from.',
    closestProtected:
      'Kirby W1 (spotted red toadstool and round bushes on grass dough) and W5 (round-canopy tree trio). Ours is one giant faceted ball that dwarfs everything, a coral mushroom cottage with door, window and chimney (no white spots), a lollipop tree pair and a fallen log with fern fronds, on a cliff-sided plinth with a turf-tuft rim.',
  },
  Props: ForestProps,
  Rim: ForestRim,
  terrain: { primary: P.grass, secondary: P.turf, rocks: true },
}
