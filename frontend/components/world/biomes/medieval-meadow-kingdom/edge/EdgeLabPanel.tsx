'use client'

import { useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { EDGE_POSES } from './poses'
import { EDGE_MODES, EDGE_PITCH, type EdgeMode } from './types'
import { useEdgeLab } from './use-edge-lab'

const MODE_LABEL: Record<EdgeMode, string> = { none: 'None', outer: EDGE_PITCH.name }

const forward = new THREE.Vector3()

/**
 * Floating lab controls over the meadow: the outer world on / off and a comparison pose. The shared
 * canvas wrapper only mounts the ice land's panel, so this one rides inside the Canvas on a
 * full-screen `Html` layer that follows the camera (so it is never culled as "behind").
 */
export function EdgeLabPanel() {
  const lab = useEdgeLab()
  const anchor = useRef<THREE.Group>(null)
  useFrame(({ camera }) => {
    if (!anchor.current) return
    camera.getWorldDirection(forward)
    anchor.current.position.copy(camera.position).addScaledVector(forward, 20)
  })
  if (!lab.active) return null
  return (
    <group ref={anchor}>
      <Html fullscreen calculatePosition={(_, __, size) => [size.width / 2, size.height / 2]} style={{ pointerEvents: 'none' }} zIndexRange={[40, 30]}>
        <aside
          data-edge-lab-panel
          style={{
            position: 'absolute',
            right: 16,
            top: 16,
            width: 300,
            padding: 12,
            pointerEvents: 'auto',
            border: '1px solid rgba(52,45,69,0.35)',
            background: 'rgba(247,251,253,0.92)',
            color: '#342d45',
            font: '12px/1.4 ui-sans-serif, system-ui',
            boxShadow: '4px 4px 0 rgba(52,45,69,0.18)',
          }}
        >
          <div style={labelStyle}>Edge lab · meadow kingdom</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0 10px' }}>
            {EDGE_MODES.map((mode) => (
              <button key={mode} type="button" aria-pressed={lab.mode === mode} onClick={() => lab.set({ mode })} style={buttonStyle(lab.mode === mode)}>
                {MODE_LABEL[mode]}
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
          {lab.mode === 'outer' ? (
            <p style={{ margin: 0 }}>
              <b>{EDGE_PITCH.name}</b>
              <span style={{ color: '#655f76' }}> · {EDGE_PITCH.lineage}</span>
              <br />
              {EDGE_PITCH.pitch}
            </p>
          ) : (
            <p style={{ margin: 0, color: '#655f76' }}>Baseline: the land as shipped, with the free camera.</p>
          )}
        </aside>
      </Html>
    </group>
  )
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  fontWeight: 700,
}

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
