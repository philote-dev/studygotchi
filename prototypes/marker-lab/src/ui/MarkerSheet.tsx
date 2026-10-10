import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { MARKERS, type MarkerDefinition } from '../markers'
import type { MarkerRenderState } from '../state'
import { Creature } from '../scene/Creature'
import { MARKER_CAMERA, MarkerScene } from '../scene/MarkerScene'
import { WorldProps } from '../scene/WorldProps'

const CELL = 96

/** Extra frames to let the pixel pass settle after MarkerScene reports ready. */
const SETTLE_FRAMES = 1

/**
 * Renders one marker in the shared hidden canvas and, once MarkerScene reports
 * ready and the pixel composer (useFrame priority 1) has written the drawing
 * buffer, reads the canvas back as a PNG data URL. Keyed per marker so the
 * ready/capture state resets for every roster row.
 */
function SheetCapture({
  marker,
  state,
  onCapture,
}: {
  marker: MarkerDefinition
  state: MarkerRenderState
  onCapture: (dataUrl: string) => void
}) {
  const gl = useThree((three) => three.gl)
  const armed = useRef(false)
  const settled = useRef(0)
  const captured = useRef(false)
  const latest = useRef(onCapture)
  latest.current = onCapture

  const arm = useCallback(() => {
    armed.current = true
  }, [])

  // Priority 2 runs after PixelComposer's priority-1 pass in the same frame,
  // so the composed output is already on the (preserved) drawing buffer.
  useFrame(() => {
    if (!armed.current || captured.current) return
    settled.current += 1
    if (settled.current <= SETTLE_FRAMES) return
    captured.current = true
    latest.current(gl.domElement.toDataURL('image/png'))
  }, 2)

  return (
    <MarkerScene marker={marker} night={state.night} onReady={arm}>
      <WorldProps marker={marker} propCount={state.propCount} night={state.night} />
      {state.creature && <Creature />}
    </MarkerScene>
  )
}

/**
 * All 17 markers at 96 px drawn through ONE WebGL context. A hidden 96×96
 * canvas cycles through the roster one marker at a time; each finished frame is
 * read back as a PNG and shown as an <img> in the same figure/frame structure
 * the capture harness and CSS expect. `onReady(id)` fires once each image has
 * loaded, so `data-render-ready` only flips after all 17 cells are drawn.
 */
export function MarkerSheet({
  state,
  onReady,
}: {
  state: MarkerRenderState
  onReady: (id: string) => void
}) {
  const [index, setIndex] = useState(0)
  const [shots, setShots] = useState<Partial<Record<string, string>>>({})
  const startedAt = useRef(performance.now())
  const current: MarkerDefinition | undefined = index < MARKERS.length ? MARKERS[index] : undefined

  // Diagnostic only: how long the 17-marker cycle took, readable by the harness.
  useEffect(() => {
    const root = document.documentElement
    if (current) delete root.dataset.sheetRenderMs
    else root.dataset.sheetRenderMs = String(Math.round(performance.now() - startedAt.current))
  }, [current])

  const handleCapture = useCallback(
    (dataUrl: string) => {
      const marker = MARKERS[index]
      if (!marker) return
      setShots((previous) => (previous[marker.id] === dataUrl ? previous : { ...previous, [marker.id]: dataUrl }))
      setIndex((previous) => (previous === index ? previous + 1 : previous))
    },
    [index],
  )

  return (
    <section className="marker-sheet" aria-label="17-marker sheet" aria-busy={current !== undefined}>
      {MARKERS.map((entry) => {
        const shot = shots[entry.id]
        return (
          <figure key={entry.id} className="marker-viewport" data-size={CELL} data-rendered={shot !== undefined}>
            <div className="marker-viewport-frame" style={{ width: CELL, height: CELL }} data-marker-cell={CELL}>
              {shot && (
                <img
                  src={shot}
                  width={CELL}
                  height={CELL}
                  alt={`${entry.name} marker at ${CELL} px`}
                  decoding="sync"
                  onLoad={() => onReady(entry.id)}
                  ref={(img) => {
                    // Data-URL images can be complete before onLoad attaches.
                    if (img?.complete && img.naturalWidth > 0) onReady(entry.id)
                  }}
                />
              )}
            </div>
            <figcaption>{entry.name}</figcaption>
          </figure>
        )
      })}

      {current && (
        <div className="marker-sheet-offscreen" aria-hidden="true" style={{ width: CELL, height: CELL }}>
          <Canvas
            shadows
            dpr={1}
            camera={{ position: MARKER_CAMERA.position, fov: MARKER_CAMERA.fov, near: MARKER_CAMERA.near, far: MARKER_CAMERA.far }}
            gl={{ antialias: false, preserveDrawingBuffer: true }}
          >
            <SheetCapture key={current.id} marker={current} state={state} onCapture={handleCapture} />
          </Canvas>
        </div>
      )}
    </section>
  )
}
