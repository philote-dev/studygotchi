'use client'

import { useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useThree } from '@react-three/fiber'
import { EDGE_TECHNIQUES } from './index'
import { EDGE_POSES } from './poses'
import { useEdgeLab } from './use-edge-lab'

/** Floating lab controls over the land: the outer world on / off and a comparison pose. */
export function EdgeLabPanel() {
  const lab = useEdgeLab()
  if (!lab.active) return null
  const current = EDGE_TECHNIQUES.find((technique) => technique.id === lab.technique) ?? null
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
        border: '1px solid rgba(52,45,69,0.35)',
        background: 'rgba(247,251,253,0.92)',
        color: '#342d45',
        font: '12px/1.4 ui-sans-serif, system-ui',
        boxShadow: '4px 4px 0 rgba(52,45,69,0.18)',
      }}
    >
      <div style={labelStyle}>Edge lab · highlands</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0 10px' }}>
        <button type="button" aria-pressed={lab.technique === null} onClick={() => lab.set({ technique: 'none' })} style={buttonStyle(lab.technique === null)}>
          None
        </button>
        {EDGE_TECHNIQUES.map((technique) => (
          <button key={technique.id} type="button" aria-pressed={lab.technique === technique.id} onClick={() => lab.set({ technique: technique.id })} style={buttonStyle(lab.technique === technique.id)}>
            {technique.name}
          </button>
        ))}
      </div>
      <div style={labelStyle}>Pose</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0 10px' }}>
        <button type="button" aria-pressed={lab.pose === null} onClick={() => lab.set({ pose: null })} style={buttonStyle(lab.pose === null)}>
          Free
        </button>
        {EDGE_POSES.map((pose) => (
          <button key={pose.id} type="button" aria-pressed={lab.pose === pose.id} onClick={() => lab.set({ pose: pose.id })} style={buttonStyle(lab.pose === pose.id)} title={pose.why}>
            {pose.label}
          </button>
        ))}
      </div>
      {current ? (
        <p style={{ margin: 0 }}>
          <b>{current.name}</b>
          <span style={{ color: '#655f76' }}> · {current.lineage}</span>
          <br />
          {current.pitch}
        </p>
      ) : (
        <p style={{ margin: 0, color: '#655f76' }}>Baseline: the land as authored, with the free camera. The slab edges and the water disc are in plain view.</p>
      )}
      {lab.pose ? <p style={{ margin: '8px 0 0', color: '#655f76' }}>Fixed pose: scene time is frozen so captures repeat exactly. Drag to leave it.</p> : null}
    </aside>
  )
}

const labelStyle: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }

function buttonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 7px',
    border: '1px solid #342d45',
    background: active ? '#342d45' : '#ffffff',
    color: active ? '#ffffff' : '#342d45',
    font: '11px ui-monospace, monospace',
    cursor: 'pointer',
  }
}

/**
 * Mounts the panel into the land's DOM mount from inside the Canvas (the shared canvas only
 * mounts the ice panel). A separate React root in a div appended beside the canvas, like drei's
 * `Html`; unmounted on a microtask so React never unmounts a root mid-commit.
 */
export function EdgeLabPanelPortal() {
  const gl = useThree((state) => state.gl)
  const root = useRef<Root | null>(null)
  useEffect(() => {
    const host = (gl.domElement.closest('[data-land-mount]') as HTMLElement | null) ?? gl.domElement.parentElement
    if (!host) return
    const el = document.createElement('div')
    el.dataset.edgeLabHost = 'nordic'
    host.appendChild(el)
    const r = createRoot(el)
    root.current = r
    r.render(<EdgeLabPanel />)
    return () => {
      root.current = null
      queueMicrotask(() => {
        r.unmount()
        el.remove()
      })
    }
  }, [gl])
  return null
}
