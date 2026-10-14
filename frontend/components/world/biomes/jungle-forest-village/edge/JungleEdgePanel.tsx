'use client'

import { useLayoutEffect, type CSSProperties } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useThree } from '@react-three/fiber'
import { EDGE_MODES, type EdgeMode } from './edge-lab'
import { EDGE_POSES } from './poses'
import { useEdgeLab } from './use-edge-lab'

const MODE_LABEL: Record<EdgeMode, string> = { none: 'None (as shipped)', outer: 'Expansive world' }

const PITCH: Record<EdgeMode, string> = {
  none: 'Baseline: the land as it shipped (flat ground to the fog, two rear canopy rows), with the free camera.',
  outer:
    'Endless continuation and natural barriers composed: the forest rolls on past the plate into four ridge rows, each hazed further toward the mist, with mist curtains in the valleys between them and the lagoon outflow running east as a silver thread to a delta and a hazy sea. A wall of waterfall cliffs and giant buttress-root trees encloses the village; its four windows frame a stepped temple with a torch, the delta beacon, a swaying rope bridge over a gorge, and a distant volcano with a plume. One light each at night.',
}

function Panel() {
  const lab = useEdgeLab()
  if (!lab.active) return null
  return (
    <aside
      data-edge-lab-panel
      style={{
        position: 'absolute',
        right: 16,
        top: 16,
        zIndex: 40,
        width: 300,
        padding: 12,
        border: '1px solid rgba(23,54,41,0.4)',
        background: 'rgba(244,251,246,0.92)',
        color: '#173629',
        font: '12px/1.4 ui-sans-serif, system-ui',
        boxShadow: '4px 4px 0 rgba(23,54,41,0.18)',
        pointerEvents: 'auto',
      }}
    >
      <div style={heading}>Jungle edge · world</div>
      <div style={row}>
        {EDGE_MODES.map((mode) => (
          <button key={mode} type="button" aria-pressed={lab.mode === mode} onClick={() => lab.set({ mode })} style={buttonStyle(lab.mode === mode)}>
            {MODE_LABEL[mode]}
          </button>
        ))}
      </div>
      <div style={heading}>Pose</div>
      <div style={row}>
        <button type="button" aria-pressed={lab.pose === null} onClick={() => lab.set({ pose: null })} style={buttonStyle(lab.pose === null)}>
          Free
        </button>
        {EDGE_POSES.map((pose) => (
          <button key={pose.id} type="button" aria-pressed={lab.pose === pose.id} onClick={() => lab.set({ pose: pose.id })} style={buttonStyle(lab.pose === pose.id)} title={pose.why}>
            {pose.label}
          </button>
        ))}
      </div>
      <p style={{ margin: 0 }}>{PITCH[lab.mode]}</p>
    </aside>
  )
}

const heading: CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0 10px' }

function buttonStyle(active: boolean): CSSProperties {
  return {
    padding: '4px 7px',
    border: '1px solid #173629',
    background: active ? '#173629' : '#ffffff',
    color: active ? '#ffffff' : '#173629',
    font: '11px ui-monospace, monospace',
    cursor: 'pointer',
  }
}

/**
 * Floating lab controls over the jungle land. The land mounts inside the Canvas, so the panel is
 * rendered into its own DOM root appended to the canvas's parent (the `data-land-mount` element),
 * the way drei's `Html` does; the capture harness hides it through `data-edge-lab-panel`.
 */
export function JungleEdgePanel() {
  const gl = useThree((state) => state.gl)
  useLayoutEffect(() => {
    const target = gl.domElement.parentElement
    if (!target) return
    // A fresh container per effect run (Strict Mode runs setup twice): a root is never created twice on one element.
    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;inset:0;pointer-events:none;'
    target.appendChild(el)
    const root: Root = createRoot(el)
    root.render(<Panel />)
    return () => {
      target.removeChild(el)
      // Unmount asynchronously: React forbids unmounting a root while another root is rendering.
      setTimeout(() => root.unmount(), 0)
    }
  }, [gl])
  return null
}
