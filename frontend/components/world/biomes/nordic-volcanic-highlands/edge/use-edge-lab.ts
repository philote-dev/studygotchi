'use client'

import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_TECHNIQUE, EDGE_TECHNIQUE_IDS, type EdgeTechniqueId } from './types'
import { edgePose, type EdgePoseId } from './poses'

/**
 * Lab state lives in the URL (`?edge=<id|none>&pose=<pose>`) so the capture harness, the panel
 * and the scene all agree. Changing it dispatches the shared lab event (the harness dispatches
 * the same one, named for the ice land where the lab began) so every subscriber re-reads
 * without a reload.
 */
export const EDGE_LAB_EVENT = 'ice-edge-lab'

export interface EdgeLabState {
  /** True whenever an `edge` or `pose` param is present (the panel shows). */
  active: boolean
  /** The outer world, or null for the authored baseline (`edge=none`). */
  technique: EdgeTechniqueId | null
  pose: EdgePoseId | null
}

export function readEdgeLab(search: string | URLSearchParams): EdgeLabState {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search
  const edge = params.get('edge')
  const pose = edgePose(params.get('pose'))?.id ?? null
  const technique = edge === null ? DEFAULT_TECHNIQUE : (EDGE_TECHNIQUE_IDS as readonly string[]).includes(edge) ? (edge as EdgeTechniqueId) : null
  return { active: edge !== null || pose !== null, technique, pose }
}

function readSearch(): EdgeLabState {
  if (typeof window === 'undefined') return { active: false, technique: DEFAULT_TECHNIQUE, pose: null }
  return readEdgeLab(window.location.search)
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
  const [state, setState] = useState<EdgeLabState>({ active: false, technique: DEFAULT_TECHNIQUE, pose: null })
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
