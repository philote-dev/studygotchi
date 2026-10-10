'use client'

import { useCallback, useEffect, useState } from 'react'
import { EDGE_TECHNIQUE_IDS, type EdgeTechniqueId } from './types'
import { edgePose, type EdgePoseId } from './poses'

/**
 * Lab state lives in the URL (`?edge=<id|none>&pose=<pose>`) so a capture harness, the panel and
 * the scene all agree. Changing it dispatches `ice-edge-lab` so every subscriber re-reads without
 * a reload; the harness dispatches the same event.
 */
export const EDGE_LAB_EVENT = 'ice-edge-lab'

export interface EdgeLabState {
  /** True whenever an `edge` param is present, including `none` (baseline with the free camera). */
  active: boolean
  technique: EdgeTechniqueId | null
  pose: EdgePoseId | null
}

function readSearch(): EdgeLabState {
  if (typeof window === 'undefined') return { active: false, technique: null, pose: null }
  const params = new URLSearchParams(window.location.search)
  const edge = params.get('edge')
  const technique = (EDGE_TECHNIQUE_IDS as readonly string[]).includes(edge ?? '') ? (edge as EdgeTechniqueId) : null
  return { active: edge !== null, technique, pose: edgePose(params.get('pose'))?.id ?? null }
}

export function setEdgeLab(next: { technique?: EdgeTechniqueId | 'none'; pose?: EdgePoseId | null }) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (next.technique !== undefined) url.searchParams.set('edge', next.technique)
  if (next.pose !== undefined) {
    if (next.pose) url.searchParams.set('pose', next.pose)
    else url.searchParams.delete('pose')
  }
  window.history.replaceState(window.history.state, '', url)
  window.dispatchEvent(new CustomEvent(EDGE_LAB_EVENT))
}

export function useEdgeLab(): EdgeLabState & { set: typeof setEdgeLab } {
  const [state, setState] = useState<EdgeLabState>(() => readSearch())
  useEffect(() => {
    const sync = () => setState(readSearch())
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
