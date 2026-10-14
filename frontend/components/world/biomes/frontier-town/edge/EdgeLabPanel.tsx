'use client'

import { useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useThree } from '@react-three/fiber'
import { EDGE_MODES } from './types'
import { FRONTIER_POSES } from './poses'
import { useEdgeLab } from './use-edge-lab'

const COPY = {
  none: 'Baseline: the land as it shipped, with the free lab camera. Look for the slab edge, the 420 m fog wall and the back of the skyline.',
  outer:
    'Outer world: beyond the plate the basin goes on in three LOD rings to 2.5 km (flats, washes, the arroyo into a dry lake, a dune ridge, a gorge, a badlands step, mesa country in rows) with fog pushed to 1.65 km and far faces tinted to the sky. Four windows in the enclosure frame a mesa-top settlement, a train on a trestle, a mission across the playa and a radio mast, one light each at night.',
} as const

/** Floating lab controls over the frontier land: technique (none / outer) and comparison pose. */
export function EdgeLabPanel() {
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
        border: '1px solid rgba(58,47,69,0.35)',
        background: 'rgba(250,243,230,0.94)',
        color: '#3a2f45',
        font: '12px/1.4 ui-sans-serif, system-ui',
        boxShadow: '4px 4px 0 rgba(58,47,69,0.18)',
        pointerEvents: 'auto',
      }}
    >
      <div style={labelStyle}>Edge lab · technique</div>
      <div style={rowStyle}>
        {EDGE_MODES.map((mode) => (
          <button key={mode} type="button" aria-pressed={lab.mode === mode} onClick={() => lab.set({ mode })} style={buttonStyle(lab.mode === mode)}>
            {mode === 'none' ? 'None' : 'Outer world'}
          </button>
        ))}
      </div>
      <div style={labelStyle}>Pose</div>
      <div style={rowStyle}>
        <button type="button" aria-pressed={lab.pose === null} onClick={() => lab.set({ pose: null })} style={buttonStyle(lab.pose === null)}>
          Free
        </button>
        {FRONTIER_POSES.map((pose) => (
          <button key={pose.id} type="button" aria-pressed={lab.pose === pose.id} onClick={() => lab.set({ pose: pose.id })} style={buttonStyle(lab.pose === pose.id)} title={pose.why}>
            {pose.label}
          </button>
        ))}
      </div>
      <p style={{ margin: 0 }}>{COPY[lab.mode]}</p>
    </aside>
  )
}

const labelStyle: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }
const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0 10px' }

function buttonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 7px',
    border: '1px solid #3a2f45',
    background: active ? '#3a2f45' : '#ffffff',
    color: active ? '#ffffff' : '#3a2f45',
    font: '11px ui-monospace, monospace',
    cursor: 'pointer',
  }
}

/**
 * The frontier scene lives inside the shared Canvas, whose host only mounts the ice panel, so the
 * panel is rendered into its own DOM root beside the canvas (the same mechanism drei's `Html`
 * uses). Mount this inside the Canvas; it renders nothing in the scene.
 */
export function EdgeLabOverlay() {
  const gl = useThree((state) => state.gl)
  const root = useRef<{ el: HTMLDivElement; root: Root } | null>(null)
  useEffect(() => {
    const host = gl.domElement.parentElement
    if (!host) return
    const el = document.createElement('div')
    el.style.position = 'absolute'
    el.style.inset = '0'
    el.style.pointerEvents = 'none'
    host.appendChild(el)
    const r = createRoot(el)
    r.render(<EdgeLabPanel />)
    root.current = { el, root: r }
    return () => {
      const current = root.current
      root.current = null
      // Unmount asynchronously: React refuses to unmount a root while another root is rendering.
      setTimeout(() => {
        current?.root.unmount()
        current?.el.remove()
      }, 0)
    }
  }, [gl])
  return null
}
