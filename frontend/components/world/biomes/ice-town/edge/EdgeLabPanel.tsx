'use client'

import { EDGE_TECHNIQUES } from './index'
import { EDGE_POSES } from './poses'
import { useEdgeLab } from './use-edge-lab'

/** Floating lab controls over the ice land: pick a technique and a comparison pose. */
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
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>
        Edge lab · technique
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0 10px' }}>
        <button type="button" aria-pressed={lab.technique === null} onClick={() => lab.set({ technique: 'none' })} style={buttonStyle(lab.technique === null)}>
          None
        </button>
        {EDGE_TECHNIQUES.map((technique) => (
          <button
            key={technique.id}
            type="button"
            aria-pressed={lab.technique === technique.id}
            onClick={() => lab.set({ technique: technique.id })}
            style={buttonStyle(lab.technique === technique.id)}
          >
            {technique.name}
          </button>
        ))}
      </div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>
        Pose
      </div>
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
          {current.lineage ? <span style={{ color: '#655f76' }}> · {current.lineage}</span> : null}
          {current.pitch ? <><br />{current.pitch}</> : <><br /><i>Not built yet.</i></>}
        </p>
      ) : (
        <p style={{ margin: 0, color: '#655f76' }}>Baseline: the land as shipped, with the free lab camera.</p>
      )}
    </aside>
  )
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
