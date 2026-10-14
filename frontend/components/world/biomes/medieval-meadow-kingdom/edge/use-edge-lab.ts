'use client'

import { useCallback, useEffect, useState } from 'react'
import { edgePose, type EdgePoseId } from './poses'
import { DEFAULT_EDGE_MODE, type EdgeMode, isEdgeMode } from './types'

/**
 * Lab state lives in the URL (`?edge=none|outer&pose=<id>`) so the capture harness, the panel and
 * the scene all agree. Changing it dispatches the shared `ice-edge-lab` event (the harness in
 * tools/edge-lab/capture.mjs dispatches the same one) so every subscriber re-reads without a reload.
 */
export const EDGE_LAB_EVENT = 'ice-edge-lab'

export interface EdgeLabState {
  /** True whenever an `edge` param is present, including `none` (baseline with the lab rig on). */
  active: boolean
  /** The outer world on or off; the product default (no param) is `outer`. */
  mode: EdgeMode
  pose: EdgePoseId | null
}

export function readEdgeLab(search: string): EdgeLabState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const edge = params.get('edge')
  const mode: EdgeMode = isEdgeMode(edge) ? edge : edge === null ? DEFAULT_EDGE_MODE : 'none'
  return { active: edge !== null, mode, pose: edgePose(params.get('pose'))?.id ?? null }
}

function readWindow(): EdgeLabState {
  if (typeof window === 'undefined') return { active: false, mode: DEFAULT_EDGE_MODE, pose: null }
  return readEdgeLab(window.location.search)
}

export function setEdgeLab(next: { mode?: EdgeMode; pose?: EdgePoseId | null }) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (next.mode !== undefined) url.searchParams.set('edge', next.mode)
  if (next.pose !== undefined) {
    if (next.pose) url.searchParams.set('pose', next.pose)
    else url.searchParams.delete('pose')
  }
  window.history.replaceState(window.history.state, '', url)
  window.dispatchEvent(new CustomEvent(EDGE_LAB_EVENT))
}

export function useEdgeLab(): EdgeLabState & { set: typeof setEdgeLab } {
  const [state, setState] = useState<EdgeLabState>(() => ({ active: false, mode: DEFAULT_EDGE_MODE, pose: null }))
  useEffect(() => {
    const sync = () => setState(readWindow())
    sync()
    window.addEventListener(EDGE_LAB_EVENT, sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener(EDGE_LAB_EVENT, sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])
  const set = useCallback((next: Parameters<typeof setEdgeLab>[0]) => setEdgeLab(next), [])
  return { ...state, set }
}
