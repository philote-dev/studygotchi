import { Surf } from '../../render/materials'
import {
  BASE_HEIGHT,
  BASE_RADIUS,
  BASE_TOP,
  BOUQUET_PLACEMENTS,
  outwardRotation,
  placementFor,
  type BouquetPlacement,
  type BouquetSlot,
} from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/**
 * Fractal Recursion palette: the three roster slates for the props, the
 * pedestal's lavender side / top for every nested plinth, ink for the trunk,
 * and the hot-pink sub-pedestal lip (matte, never lit).
 */
const P = {
  slate: '#8a90a8',
  mist: '#a8b0c4',
  pale: '#dfe3ff',
  side: '#7a6f9e',
  top: '#a99fc9',
  ink: '#3a2f45',
  lip: '#ff7ad9',
} as const

/**
 * Family slots: the pyramid steps out to the far front-left and the marker
 * copy to the far front-right so the tree's root block shows between them.
 */
const PLACEMENTS: readonly BouquetPlacement[] = BOUQUET_PLACEMENTS.map((entry) => {
  if (entry.id === 'hero') return { ...entry, position: [0.5, BASE_TOP, -6.5] }
  if (entry.id === 'front-left') return { ...entry, position: [-8.5, BASE_TOP, 4.5] }
  if (entry.id === 'front-right') return { ...entry, position: [7.5, BASE_TOP, 4.5] }
  return entry
})

const slot = (id: BouquetSlot) => placementFor(id, PLACEMENTS)

/** Scale of the P4 marker copy (roster: one-third) and of the two rim buds (roster: one-quarter). */
const COPY = 1 / 3
const BUD = 1 / 4

// ---------------------------------------------------------------------------
// P1 · Pythagoras tree

const TREE_SIDE = 4
const TREE_RATIO = 0.66
const TREE_STUMP = 0.8 * TREE_SIDE
/** Height of a tree with `levels` square generations above the root (bounding box, measured). */
const TREE_HEIGHT = { 3: TREE_STUMP + 2.776 * TREE_SIDE, 2: TREE_STUMP + 2.369 * TREE_SIDE } as const

function Square({ size, depth, maxDepth }: { size: number; depth: number; maxDepth: number }) {
  const child = size * TREE_RATIO
  const offset = (child / 2) * Math.SQRT1_2
  const thickness = depth === 0 ? size * 0.7 : size * 0.5
  const color = depth % 2 === 0 ? P.slate : P.pale
  return (
    <group>
      <mesh position={[0, size / 2, 0]} castShadow>
        <boxGeometry args={[size, size, thickness]} />
        <Surf color={color} />
      </mesh>
      {depth < maxDepth &&
        ([-1, 1] as const).map((side) => (
          <group key={side} position={[side * (size / 2 - offset), size + offset, 0]} rotation={[0, 0, -side * Math.PI * 0.25]}>
            <Square size={child} depth={depth + 1} maxDepth={maxDepth} />
          </group>
        ))}
    </group>
  )
}

/**
 * Pythagoras tree: an ink trunk, one monolithic slate root square, then
 * generations of children rotated ±45° alternating pale / slate / pale by
 * depth so the branching reads at 48 px. The root square is the exaggeration:
 * a block 9 m on a side at bouquet scale. 15 boxes (7 in the mini copy).
 */
function PythagorasTree({ mini = false }: { mini?: boolean }) {
  const place = slot('hero')
  const levels = mini ? 2 : 3
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / TREE_HEIGHT[levels]}>
        <mesh position={[0, TREE_STUMP / 2, 0]} castShadow>
          <boxGeometry args={[TREE_SIDE * 0.55, TREE_STUMP, TREE_SIDE * 0.55]} />
          <Surf color={P.ink} />
        </mesh>
        <group position={[0, TREE_STUMP - 0.05, 0]}>
          <Square size={TREE_SIDE} depth={0} maxDepth={levels} />
        </group>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// P2 · stepped Sierpinski pyramid

const PYR_HEIGHT = 6.5
const PYR_RADIUS = 3
const PYR_HALF = PYR_RADIUS * Math.SQRT1_2 + 0.2
const PYR_SLAB = 0.8
const PYRAMID_HEIGHT = PYR_SLAB + PYR_HEIGHT * 2

function StepPyramid({ position, color, band, mini }: { position: readonly [number, number, number]; color: string; band: string; mini: boolean }) {
  return (
    <group position={position}>
      <mesh position={[0, PYR_HEIGHT / 2, 0]} rotation={[0, Math.PI * 0.25, 0]} castShadow>
        <coneGeometry args={[PYR_RADIUS, PYR_HEIGHT, 4]} />
        <Surf color={color} />
      </mesh>
      {!mini && (
        <mesh position={[0, PYR_HEIGHT * 0.42, 0]} castShadow>
          <boxGeometry args={[PYR_HALF * 1.25, 0.55, PYR_HALF * 1.25]} />
          <Surf color={band} />
        </mesh>
      )}
    </group>
  )
}

/**
 * Two-level Sierpinski: four slate 4-sided pyramids on a mist slab with a fifth
 * riding their tips, each wearing a pale stepped band. The exaggeration is the
 * hollow: the four base pyramids stand apart so daylight shows through the
 * middle. 11 meshes (6 in the mini copy).
 */
function SierpinskiPyramid({ mini = false }: { mini?: boolean }) {
  const place = slot('front-left')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / PYRAMID_HEIGHT}>
        <mesh position={[0, PYR_SLAB / 2, 0]} castShadow>
          <boxGeometry args={[PYR_HALF * 4, PYR_SLAB, PYR_HALF * 4]} />
          <Surf color={P.mist} />
        </mesh>
        <group position={[0, PYR_SLAB, 0]}>
          {([-1, 1] as const).map((x) =>
            ([-1, 1] as const).map((z) => (
              <StepPyramid key={`${x}${z}`} position={[x * PYR_HALF, 0, z * PYR_HALF]} color={P.slate} band={P.pale} mini={mini} />
            )),
          )}
          <StepPyramid position={[0, PYR_HEIGHT, 0]} color={P.slate} band={P.pale} mini={mini} />
        </group>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// P3 · spiral shell

const SHELL_RATIO = 0.78
const SHELL: readonly { r: number; y: number; x: number; z: number }[] = (() => {
  const out: { r: number; y: number; x: number; z: number }[] = []
  let r = 2.4
  let y = r * 0.8
  for (let index = 0; index < 6; index += 1) {
    if (index > 0) {
      const next = r * SHELL_RATIO
      y += r * 0.75 + next * 0.55
      r = next
    }
    const angle = index * 1.9
    const drift = Math.max(0, 1.3 - index * 0.18)
    out.push({ r, y, x: Math.sin(angle) * drift, z: Math.cos(angle) * drift })
  }
  return out
})()
const SHELL_TIP = 1.2
const SHELL_HEIGHT = SHELL[SHELL.length - 1].y + SHELL[SHELL.length - 1].r + SHELL_TIP

/**
 * Spiral shell: six shrinking chambers drifting round a conical helix, pale and
 * slate by turns, with a pale tip. The exaggeration is the mouth: a slate ring
 * as wide as the whole base chamber. 8 meshes (5 in the mini copy, at 5×4).
 */
function SpiralShell({ mini = false }: { mini?: boolean }) {
  const place = slot('back-right')
  const chambers = mini ? SHELL.slice(0, 5) : SHELL
  const base = SHELL[0]
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / SHELL_HEIGHT}>
        {chambers.map((chamber, index) => (
          <mesh key={index} position={[chamber.x, chamber.y, chamber.z]} castShadow>
            <sphereGeometry args={mini ? [chamber.r, 5, 4] : [chamber.r, 7, 5]} />
            <Surf color={index % 2 === 0 ? P.pale : P.slate} />
          </mesh>
        ))}
        {!mini && (
          <mesh position={[base.x + base.r * 0.3, base.y - 0.1, base.z + base.r * 0.55]} rotation={[0.25, 0.5, 0]} castShadow>
            <torusGeometry args={[base.r * 0.9, 0.5, 4, 10]} />
            <Surf color={P.slate} />
          </mesh>
        )}
        {!mini && (
          <mesh position={[SHELL[5].x, SHELL[5].y + SHELL[5].r + SHELL_TIP * 0.4, SHELL[5].z]} castShadow>
            <coneGeometry args={[0.55, SHELL_TIP, 4]} />
            <Surf color={P.pale} />
          </mesh>
        )}
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// P4 · one-third-scale copy of this marker

/** Stalk length: the art director asked for the copy 6 m higher than the first pass (12 → 18). */
const STALK_HEIGHT = 18

/**
 * The marker again at one-third scale: an ink-dark slate stalk lifts a 12-facet
 * lavender plinth with a thick hot-pink lip, one terrain blob and mini P1–P3,
 * tilted at the camera. The accent object of the family. 5 + 18 meshes.
 */
function MarkerCopy() {
  const place = slot('front-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / 24}>
        <mesh position={[0, STALK_HEIGHT / 2, 0]} castShadow>
          <cylinderGeometry args={[1.1, 2, STALK_HEIGHT, 6]} />
          <Surf color={P.side} />
        </mesh>
        <group position={[0, STALK_HEIGHT, 0]} rotation={[0.42, 0.1, 0]} scale={COPY}>
          <mesh position={[0, BASE_HEIGHT / 2, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
            <cylinderGeometry args={[BASE_RADIUS, BASE_RADIUS * 1.04, BASE_HEIGHT, 12]} />
            <Surf color={P.side} />
          </mesh>
          <mesh position={[0, BASE_TOP + 0.15, 0]} rotation={[0, Math.PI / 12, 0]}>
            <cylinderGeometry args={[BASE_RADIUS + 0.3, BASE_RADIUS + 0.3, 0.3, 12]} />
            <Surf color={P.top} />
          </mesh>
          <mesh position={[0, BASE_TOP - 0.2, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[BASE_RADIUS + 0.4, 2, 4, 10]} />
            <Surf color={P.lip} />
          </mesh>
          <mesh position={[0, BASE_TOP + 0.9, 0]} scale={[8, 1.8, 7]} rotation={[0, 0.4, 0]} castShadow>
            <dodecahedronGeometry args={[1, 0]} />
            <Surf color={P.top} />
          </mesh>
          <PythagorasTree mini />
          <SierpinskiPyramid mini />
          <SpiralShell mini />
        </group>
      </group>
    </group>
  )
}

function Props({ propCount }: BouquetPropsProps) {
  return (
    <group>
      <PythagorasTree />
      <SierpinskiPyramid />
      {propCount >= 3 && <SpiralShell />}
      {propCount >= 4 && <MarkerCopy />}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Rim

const BUD_RADIUS = BASE_RADIUS * BUD
const BUD_ANGLES = [Math.PI * (2 / 3), -Math.PI * (2 / 3)] as const

/**
 * Two one-quarter-scale plinth discs budding off the rim at ±120° (back-left
 * and back-right, so the plinth band stays clear at the front), each with a
 * thick matte hot-pink lip and one pale terrain blob. Nothing here emits.
 */
function Rim({ color }: { color: string }) {
  return (
    <group>
      {BUD_ANGLES.map((angle) => {
        const x = Math.sin(angle) * (BASE_RADIUS + 1.2)
        const z = Math.cos(angle) * (BASE_RADIUS + 1.2)
        return (
          <group key={angle} position={[x, BASE_TOP - 0.4, z]} rotation={[0, angle, 0]}>
            <mesh rotation={[0, Math.PI / 12, 0]} castShadow>
              <cylinderGeometry args={[BUD_RADIUS, BUD_RADIUS * 1.04, 0.8, 12]} />
              <Surf color={P.side} />
            </mesh>
            <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <torusGeometry args={[BUD_RADIUS + 0.1, 0.64, 4, 10]} />
              <Surf color={P.lip} />
            </mesh>
            <mesh position={[0.2, 0.75, 0.6]} scale={[2.1, 0.7, 1.7]} rotation={[0, 0.5, 0]} castShadow>
              <dodecahedronGeometry args={[1, 0]} />
              <Surf color={color} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export const fractalRecursion: BiomeBouquet = {
  spec: {
    id: 'fractal-recursion',
    name: 'Slate Echo Grove',
    silhouette:
      'A lavender disc that sprouts smaller copies of itself: a wide pale-and-slate branching-square tree on an ink trunk across the back, a five-piece stepped pyramid front-left, a twisted shell behind, and a third-scale marker held high on a stalk front-right.',
    hero: 'pythagoras-tree',
    elements: [
      { id: 'pythagoras-tree', height: 32, slot: 'hero' },
      { id: 'sierpinski-pyramid', height: 28, slot: 'front-left' },
      { id: 'spiral-shell', height: 28, slot: 'back-right' },
      { id: 'marker-copy', height: 24, slot: 'front-right' },
    ],
    rim: 'Two one-quarter-scale lavender plinth discs budding off the rim at plus and minus 120 degrees, each with a thick matte hot-pink #ff7ad9 lip and one pale terrain blob; the plinth band stays clear at the front.',
    exaggeration:
      'Self-similarity itself: the fourth element is the whole marker again at one-third scale, held 18 m up on a slate stalk so its pink-lipped disc reads at 48 px.',
    closestProtected:
      'Kirby W6 (sandstone stacked towers with green pipes on a stone slab) and W2 (one solid pyramid on a pancake stack). Ours is a lavender disc with a branching-square tree as the skyline, a hollow five-piece Sierpinski instead of a solid pyramid, no pipes, and the disc repeating itself at quarter scale on its rim and third scale on a stalk.',
    placements: PLACEMENTS,
  },
  Props,
  Rim,
  terrain: { primary: '#a99fc9', secondary: '#7a6f9e', rocks: true },
}
