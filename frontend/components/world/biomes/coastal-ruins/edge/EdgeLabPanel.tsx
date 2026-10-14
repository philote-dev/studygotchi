'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useThree } from '@react-three/fiber'
import { EDGE_POSES } from './poses'
import { useEdgeLab } from './use-edge-lab'

/**
 * Floating lab controls over the coastal land (`?edge=` / `?pose=`): outer world on / off and the
 * fixed comparison poses. The land mounts inside a shared Canvas it does not own, so the panel is
 * rendered through its own DOM root appended beside the canvas (the way drei's `Html` does it).
 */
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
        width: 290,
        padding: 12,
        pointerEvents: 'auto',
        border: '1px solid rgba(39,62,73,0.4)',
        background: 'rgba(249,246,236,0.94)',
        color: '#273e49',
        font: '12px/1.4 ui-sans-serif, system-ui',
        boxShadow: '4px 4px 0 rgba(39,62,73,0.18)',
      }}
    >
      <div style={labelStyle}>Coastal edge lab · outer world</div>
      <div style={rowStyle}>
        <button type="button" aria-pressed={lab.mode === 'none'} onClick={() => lab.set({ mode: 'none' })} style={buttonStyle(lab.mode === 'none')}>
          None
        </button>
        <button type="button" aria-pressed={lab.mode === 'outer'} onClick={() => lab.set({ mode: 'outer' })} style={buttonStyle(lab.mode === 'outer')}>
          Outer world
        </button>
      </div>
      <div style={labelStyle}>Pose</div>
      <div style={rowStyle}>
        <button type="button" aria-pressed={lab.pose === null} onClick={() => lab.set({ pose: null })} style={buttonStyle(lab.pose === null)}>
          Free
        </button>
        {EDGE_POSES.map((pose) => (
          <button key={pose.id} type="button" aria-pressed={lab.pose === pose.id} onClick={() => lab.set({ pose: pose.id })} style={buttonStyle(lab.pose === pose.id)} title={pose.why}>
            {pose.label}
          </button>
        ))}
      </div>
      <p style={{ margin: 0, color: '#4f6670' }}>
        {lab.mode === 'outer'
          ? 'Endless limestone country, a stack-and-cape ring with four vista windows, and a true sea horizon with far islands, a sail and a moon path.'
          : 'Baseline: the land as shipped, with the free camera.'}
      </p>
    </aside>
  )
}

const labelStyle: CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }
const rowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0 10px' }

function buttonStyle(active: boolean): CSSProperties {
  return {
    padding: '4px 7px',
    border: '1px solid #273e49',
    background: active ? '#273e49' : '#ffffff',
    color: active ? '#ffffff' : '#273e49',
    font: '11px ui-monospace, monospace',
    cursor: 'pointer',
  }
}

/** Mount inside the Canvas: renders `children` into a DOM root over the canvas's container. */
export function DomOverlay({ children }: { children: ReactNode }) {
  const gl = useThree((state) => state.gl)
  const [root, setRoot] = useState<{ root: Root; element: HTMLDivElement } | null>(null)
  useEffect(() => {
    const host = gl.domElement.parentElement
    if (!host) return
    const element = document.createElement('div')
    element.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:40'
    host.appendChild(element)
    const created = createRoot(element)
    setRoot({ root: created, element })
    return () => {
      // Unmount outside React's commit phase.
      setTimeout(() => {
        created.unmount()
        element.remove()
      }, 0)
      setRoot(null)
    }
  }, [gl])
  useEffect(() => {
    root?.root.render(children)
  }, [root, children])
  return null
}

/** The panel, mounted from the scene. */
export function EdgeLabOverlay() {
  return (
    <DomOverlay>
      <EdgeLabPanel />
    </DomOverlay>
  )
}
