"use client";

import { Glow, Surf } from '../materials'
import { BASE_RADIUS, BASE_TOP, outwardRotation, placementFor } from '../bouquetGeometry'
import type { BiomeBouquet, BouquetPropsProps } from './types'

/**
 * Ink World · "Sumi Stroke Summit"
 *
 * A torn-paper plinth with one calligraphy peak. Everything is paper, ink and
 * grey wash; the only saturated colour is the seal-red stamp on the plinth side.
 * At night only the lantern paper glows, softly (×0.6).
 */
const P = {
  stack: '#d9d2c4',
  paper: '#f4efe6',
  cream: '#fffaf3',
  ink: '#3a2f45',
  wash: '#8c8698',
  seal: '#c8323c',
} as const

/** Deterministic jitter in [0, 1) so the deckle edge is irregular but stable between renders. */
const jitter = (index: number, salt: number) => (((index * 7 + salt * 13) * 9301 + 49297) % 233280) / 233280

// ---------------------------------------------------------------------------
// P1 · brush-stroke peak (hero, 32 m)
// One bending dry-brush stroke built as a chain of flattened cylinder segments:
// thick ink at the press, thinning and curling left, fading to grey wash at the tip.
// ---------------------------------------------------------------------------

interface StrokeSegment {
  length: number
  tilt: number
  top: number
  bottom: number
  wash: boolean
}

const STROKE_SEGMENTS: readonly StrokeSegment[] = [
  { length: 6.2, tilt: 0.1, top: 3.3, bottom: 4.7, wash: false },
  { length: 5.0, tilt: 0.3, top: 2.3, bottom: 3.4, wash: false },
  { length: 4.4, tilt: 0.52, top: 1.3, bottom: 2.4, wash: false },
  { length: 4.2, tilt: 0.78, top: 0, bottom: 1.4, wash: true },
]

const STROKE = (() => {
  let x = 0
  let y = 0
  return STROKE_SEGMENTS.map((segment) => {
    const dx = -Math.sin(segment.tilt)
    const dy = Math.cos(segment.tilt)
    const start = [x, y] as const
    const position = [x + (dx * segment.length) / 2, y + (dy * segment.length) / 2, 0] as const
    x += dx * segment.length
    y += dy * segment.length
    return { ...segment, start, position }
  })
})()

const PEAK_AUTHORED_HEIGHT = 17.8
const STROKE_FLATNESS = 0.36

function Bristle({ from, tilt, length }: { from: readonly [number, number]; tilt: number; length: number }) {
  const dx = -Math.sin(tilt)
  const dy = Math.cos(tilt)
  return (
    <mesh position={[from[0] + (dx * length) / 2, from[1] + (dy * length) / 2, 0.15]} rotation={[0, 0, tilt]} scale={[1, 1, STROKE_FLATNESS]} castShadow>
      <coneGeometry args={[0.42, length, 5]} />
      <Surf color={P.wash} />
    </mesh>
  )
}

function BrushPeak() {
  const place = placementFor('hero')
  const tip = STROKE[STROKE.length - 1]
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / PEAK_AUTHORED_HEIGHT}>
        {/* the press: an ink pool where the brush first touched the paper */}
        <mesh position={[0.6, 0.3, 0.9]} scale={[6.2, 0.6, 3.4]} rotation={[0, 0.35, 0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.ink} />
        </mesh>
        {STROKE.map((segment, index) => (
          <mesh key={index} position={segment.position} rotation={[0, 0, segment.tilt]} scale={[1, 1, STROKE_FLATNESS]} castShadow>
            {segment.wash ? (
              <coneGeometry args={[segment.bottom, segment.length + 0.7, 6]} />
            ) : (
              <cylinderGeometry args={[segment.top, segment.bottom, segment.length + 0.7, 6]} />
            )}
            <Surf color={segment.wash ? P.wash : P.ink} />
          </mesh>
        ))}
        {/* dry-brush split at the tip */}
        <Bristle from={tip.start} tilt={tip.tilt - 0.34} length={3.8} />
        <Bristle from={tip.start} tilt={tip.tilt + 0.3} length={2.8} />
        {/* the wash ghost: a second, fainter peak behind, between the stroke and the pine */}
        <mesh position={[2.6, 6.4, -2.6]} rotation={[0, 0, -0.12]} scale={[1, 1, 0.28]} castShadow>
          <coneGeometry args={[3.2, 13, 6]} />
          <Surf color={P.wash} />
        </mesh>
        {/* splatter dots */}
        <mesh position={[3.6, 0.3, 2.4]} scale={[0.6, 0.22, 0.5]}>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[-3.9, 0.26, 1.6]} scale={[0.45, 0.2, 0.4]}>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.ink} />
        </mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// P2 · paper pavilion (front-left, 28 m)
// Drawn the way a sumi painter draws one: four ink posts carrying two flat
// paper roofs, each outlined by one clean 0.5 m ink line along its eaves (the
// lower roof twice as wide as the post square), a paper deck below and a paper
// clerestory between the roofs.
// ---------------------------------------------------------------------------

const PAVILION_AUTHORED_HEIGHT = 14.2
const PAVILION_SCALE = 28 / PAVILION_AUTHORED_HEIGHT
/** Roof lines are 0.5 m thick in world units (review note). */
const ROOF_LINE_THICKNESS = 0.5 / PAVILION_SCALE
const ROOF_SLAB_THICKNESS = 0.45
const POST_HALF = 2.4
const POST_HEIGHT = 6.4
const LOWER_ROOF_Y = 1.3 + POST_HEIGHT
const UPPER_ROOF_Y = LOWER_ROOF_Y + 3.4

/** A flat paper roof with one clean ink line running round its eaves. */
function PaperRoof({ y, width, depth }: { y: number; width: number; depth: number }) {
  const lineY = ROOF_SLAB_THICKNESS / 2 - ROOF_LINE_THICKNESS / 2 + 0.04
  return (
    <group position={[0, y, 0]}>
      <mesh castShadow>
        <boxGeometry args={[width, ROOF_SLAB_THICKNESS, depth]} />
        <Surf color={P.paper} />
      </mesh>
      {([-1, 1] as const).map((side) => (
        <mesh key={`z${side}`} position={[0, lineY, side * (depth / 2)]}>
          <boxGeometry args={[width + ROOF_LINE_THICKNESS, ROOF_LINE_THICKNESS, ROOF_LINE_THICKNESS]} />
          <Surf color={P.ink} />
        </mesh>
      ))}
      {([-1, 1] as const).map((side) => (
        <mesh key={`x${side}`} position={[side * (width / 2), lineY, 0]}>
          <boxGeometry args={[ROOF_LINE_THICKNESS, ROOF_LINE_THICKNESS, depth + ROOF_LINE_THICKNESS]} />
          <Surf color={P.ink} />
        </mesh>
      ))}
    </group>
  )
}

function PaperPavilion() {
  const place = placementFor('front-left')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={PAVILION_SCALE}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[7.6, 0.8, 7.6]} />
          <Surf color={P.stack} />
        </mesh>
        <mesh position={[0, 1.05, 0]} castShadow>
          <boxGeometry args={[5.6, 0.5, 5.6]} />
          <Surf color={P.paper} />
        </mesh>
        {/* four ink posts, no walls */}
        {([-1, 1] as const).map((sx) =>
          ([-1, 1] as const).map((sz) => (
            <mesh key={`${sx}${sz}`} position={[sx * POST_HALF, 1.3 + POST_HEIGHT / 2, sz * POST_HALF]} castShadow>
              <cylinderGeometry args={[0.3, 0.36, POST_HEIGHT, 6]} />
              <Surf color={P.ink} />
            </mesh>
          )),
        )}
        <PaperRoof y={LOWER_ROOF_Y} width={10.4} depth={8.2} />
        <mesh position={[0, LOWER_ROOF_Y + 1.7, 0]} castShadow>
          <boxGeometry args={[3.2, 3.0, 3.2]} />
          <Surf color={P.paper} />
        </mesh>
        <PaperRoof y={UPPER_ROOF_Y} width={6.8} depth={5.4} />
        <mesh position={[0, UPPER_ROOF_Y + 1.0, 0]} castShadow>
          <coneGeometry args={[0.5, 1.6, 6]} />
          <Surf color={P.ink} />
        </mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// P3 · ink-blot pine (back-right, 28 m)
// One thin bent trunk carrying three flat ink splats, each ten times wider than
// the trunk, with two drips hanging off the blots.
// ---------------------------------------------------------------------------

const PINE_AUTHORED_HEIGHT = 14.5

function Blot({
  position,
  scale,
  spin,
}: {
  position: readonly [number, number, number]
  scale: readonly [number, number, number]
  spin: number
}) {
  return (
    <mesh position={position} scale={scale} rotation={[0.06, spin, -0.05]} castShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <Surf color={P.ink} />
    </mesh>
  )
}

function InkBlotPine() {
  const place = placementFor('back-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={place.height / PINE_AUTHORED_HEIGHT}>
        <mesh position={[0, 3.1, 0]} castShadow>
          <cylinderGeometry args={[0.36, 0.58, 6.4, 6]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0.55, 9.0, 0]} rotation={[0, 0, -0.13]} castShadow>
          <cylinderGeometry args={[0.24, 0.38, 6.2, 6]} />
          <Surf color={P.ink} />
        </mesh>
        <Blot position={[0.3, 4.8, 0.2]} scale={[3.2, 0.85, 2.5]} spin={0.4} />
        <Blot position={[0.7, 8.5, 0.3]} scale={[2.5, 0.75, 1.95]} spin={1.3} />
        <Blot position={[1.15, 11.7, 0]} scale={[1.8, 0.7, 1.45]} spin={2.1} />
        <mesh position={[1.35, 13.4, 0]} rotation={[0, 0, -0.13]} castShadow>
          <coneGeometry args={[0.65, 2.4, 5]} />
          <Surf color={P.ink} />
        </mesh>
        {/* drips */}
        <mesh position={[2.9, 3.9, 0.9]} scale={[0.4, 0.75, 0.4]}>
          <sphereGeometry args={[1, 5, 4]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[-1.6, 7.6, 0.6]} scale={[0.32, 0.6, 0.32]}>
          <sphereGeometry args={[1, 5, 4]} />
          <Surf color={P.ink} />
        </mesh>
        {/* a splat on the ground where a drip landed */}
        <mesh position={[1.9, 0.14, 1.6]} scale={[1.7, 0.22, 1.3]} rotation={[0, 0.8, 0]}>
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={P.ink} />
        </mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// P4 · paper lantern post (front-right, 24 m)
// A thin ink post with a braced arm, from which hangs a 3 m paper chōchin with
// three ink hoops and a dark cap. The paper is the marker's only night glow.
// ---------------------------------------------------------------------------

const LANTERN_AUTHORED_HEIGHT = 11.6
const LANTERN_SCALE = 24 / LANTERN_AUTHORED_HEIGHT
const LANTERN_X = 2.6
const LANTERN_Y = 7.9
/** 3 m diameter in world units (review note). */
const LANTERN_RADIUS = 1.5 / LANTERN_SCALE
const LANTERN_BODY = 2.2
const BRACE_LENGTH = Math.hypot(LANTERN_X, 1.5)
const BRACE_TILT = -Math.atan2(LANTERN_X, 1.5)

function PaperLantern({ night }: { night: boolean }) {
  const place = placementFor('front-right')
  return (
    <group position={place.position} rotation={outwardRotation(place)}>
      <group scale={LANTERN_SCALE}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[0.95, 1.15, 0.6, 6]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, 5.6, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.42, 10.6, 6]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[0, 11.1, 0]} castShadow>
          <coneGeometry args={[0.62, 0.9, 6]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[LANTERN_X / 2 + 0.15, 10.1, 0]} castShadow>
          <boxGeometry args={[LANTERN_X + 0.6, 0.32, 0.32]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[LANTERN_X / 2, 8.6 + 0.75, 0]} rotation={[0, 0, BRACE_TILT]}>
          <cylinderGeometry args={[0.1, 0.1, BRACE_LENGTH, 5]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[LANTERN_X, 9.65, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.6, 5]} />
          <Surf color={P.ink} />
        </mesh>
        {/* dark cap */}
        <mesh position={[LANTERN_X, LANTERN_Y + LANTERN_BODY / 2 + 0.2, 0]} castShadow>
          <cylinderGeometry args={[0.42, LANTERN_RADIUS + 0.08, 0.42, 8]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[LANTERN_X, LANTERN_Y, 0]} castShadow>
          <cylinderGeometry args={[LANTERN_RADIUS, LANTERN_RADIUS, LANTERN_BODY, 8]} />
          <Glow color="#ffe9a8" offColor={P.paper} intensity={0.6} on={night} />
        </mesh>
        {/* three ink hoops */}
        {[-0.65, 0, 0.65].map((offset) => (
          <mesh key={offset} position={[LANTERN_X, LANTERN_Y + offset, 0]}>
            <cylinderGeometry args={[LANTERN_RADIUS + 0.06, LANTERN_RADIUS + 0.06, 0.1, 8]} />
            <Surf color={P.ink} />
          </mesh>
        ))}
        <mesh position={[LANTERN_X, LANTERN_Y - LANTERN_BODY / 2 - 0.15, 0]} castShadow>
          <cylinderGeometry args={[LANTERN_RADIUS + 0.04, 0.4, 0.3, 8]} />
          <Surf color={P.ink} />
        </mesh>
        <mesh position={[LANTERN_X, LANTERN_Y - LANTERN_BODY / 2 - 0.75, 0]}>
          <cylinderGeometry args={[0.1, 0.22, 0.9, 5]} />
          <Surf color={P.ink} />
        </mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Accent · seal-red stamp block, 3 × 3 m, centred on plinth facet 0 (facing +Z).
// The one saturated colour on the marker.
// ---------------------------------------------------------------------------

/** Facet 0 is a flat face at BASE_RADIUS·cos 15° from the centre, slanting out toward the foot. */
const FACET_DEPTH = BASE_RADIUS * Math.cos(Math.PI / 12)

function SealStamp() {
  return (
    <group>
      <mesh position={[0, 1.2, FACET_DEPTH + 0.5]} castShadow>
        <boxGeometry args={[3, 3, 0.6]} />
        <Surf color={P.seal} />
      </mesh>
      <mesh position={[0, 1.2, FACET_DEPTH + 0.84]}>
        <boxGeometry args={[1.4, 1.4, 0.12]} />
        <Surf color={P.cream} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Rim · deckle (torn) paper edge with one 0.4 m brush-stroke band.
// ---------------------------------------------------------------------------

const BAND_CENTRE = -0.95
const BAND_PIECES: readonly { start: number; arc: number; tube: number }[] = [
  { start: BAND_CENTRE - 0.85, arc: 0.42, tube: 0.11 },
  { start: BAND_CENTRE - 0.55, arc: 1.1, tube: 0.2 },
  { start: BAND_CENTRE + 0.43, arc: 0.42, tube: 0.11 },
]

function BrushBand({ color }: { color: string }) {
  return (
    <group>
      {BAND_PIECES.map((piece, index) => (
        <group key={index} rotation={[0, piece.start - Math.PI / 2, 0]}>
          <mesh position={[0, BASE_TOP - 0.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[BASE_RADIUS + 0.34, piece.tube, 4, 14, piece.arc]} />
            <Surf color={color} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

const FLAP_COUNT = 18

function InkRim({ color }: { color: string }) {
  return (
    <group>
      {/* two sheet lines on the plinth side so the cliff reads as stacked paper */}
      {(
        [
          [0.8, 16.55],
          [1.6, 16.33],
        ] as const
      ).map(([y, radius]) => (
        <mesh key={y} position={[0, y, 0]} rotation={[0, Math.PI / 12, 0]}>
          <cylinderGeometry args={[radius, radius + 0.04, 0.14, 12]} />
          <Surf color={P.paper} />
        </mesh>
      ))}
      {Array.from({ length: FLAP_COUNT }, (_, index) => {
        // Half-step offset keeps facet 0 (the seal stamp) clear of a flap.
        const angle = ((index + 0.5) / FLAP_COUNT) * Math.PI * 2 + (jitter(index, 1) - 0.5) * 0.14
        const width = 1.5 + jitter(index, 2) * 1.2
        const depth = 0.9 + jitter(index, 3) * 0.8
        const droop = 0.1 + jitter(index, 4) * 0.32
        const flapColor = index % 3 === 0 ? P.stack : index % 3 === 1 ? P.paper : P.cream
        return (
          <group key={index} rotation={[0, angle, 0]}>
            <group position={[0, BASE_TOP + 0.06 + (index % 2) * 0.08, BASE_RADIUS - 0.35 + jitter(index, 5) * 0.4]} rotation={[droop, (jitter(index, 6) - 0.5) * 0.3, 0]}>
              <mesh position={[0, 0, depth / 2]} castShadow>
                <boxGeometry args={[width, 0.12, depth]} />
                <Surf color={flapColor} />
              </mesh>
            </group>
          </group>
        )
      })}
      <BrushBand color={color} />
    </group>
  )
}

// ---------------------------------------------------------------------------

function InkProps({ propCount, night }: BouquetPropsProps) {
  return (
    <group>
      <SealStamp />
      <BrushPeak />
      <PaperPavilion />
      {propCount >= 3 && <InkBlotPine />}
      {propCount >= 4 && <PaperLantern night={night} />}
    </group>
  )
}

export const inkWorld: BiomeBouquet = {
  spec: {
    id: 'ink-world',
    name: 'Sumi Stroke Summit',
    silhouette: 'One black brush-stroke peak sweeping up and left off a white paper disc, with two smaller ink marks (blot pine, pavilion roof) to its right.',
    hero: 'brush-peak',
    elements: [
      { id: 'brush-peak', height: 32, slot: 'hero' },
      { id: 'paper-pavilion', height: 28, slot: 'front-left' },
      { id: 'ink-blot-pine', height: 28, slot: 'back-right' },
      { id: 'paper-lantern', height: 24, slot: 'front-right' },
    ],
    rim: 'Deckle-torn paper edge: irregular thin cream flaps and wedges around the plinth lip, plus one 0.4 m ink brush-stroke band sweeping a quarter of the rim at the front-left.',
    exaggeration: 'The hero peak is a single 32 m dry-brush stroke: a flat ink blade whose tip fades to grey wash and overhangs the plinth; the only colour on the marker is the 3 m seal-red stamp on facet 0 of the plinth.',
    closestProtected: 'Kirby W3 (a stand of pines on a soft dough disc). Ours is a torn-paper plinth with one calligraphy peak, a white paper pavilion and a single ink-blot pine, so the tree is never the read.',
  },
  Props: InkProps,
  Rim: InkRim,
  terrain: {
    primary: '#f4efe6',
    secondary: '#d9d2c4',
    rocks: false,
    // Flatter lobes than the shared set: paper sheets, not snow drifts.
    lobes: [
      { position: [0, BASE_TOP, 0], radius: 7.8, height: 2.0, stretch: [1.2, 1] },
      { position: [-1.5, BASE_TOP, -5.8], radius: 6.3, height: 2.8, stretch: [1.05, 0.9] },
      { position: [-6.2, BASE_TOP, 3], radius: 5.2, height: 1.8, stretch: [0.9, 1.1] },
      { position: [5.8, BASE_TOP, -2.8], radius: 5.8, height: 2.4, stretch: [1, 0.92] },
      { position: [5.3, BASE_TOP, 3.6], radius: 5.6, height: 1.6, stretch: [1.05, 0.9] },
      { position: [0.5, BASE_TOP, 5], radius: 4.8, height: 1.2, stretch: [1.25, 0.8] },
    ],
  },
}
