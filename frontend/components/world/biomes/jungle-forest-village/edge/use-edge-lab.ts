'use client'

import { useCallback, useEffect, useState } from 'react'
import { EDGE_LAB_EVENT, type EdgeLabState, type EdgeMode, edgeLabFromSearch } from './edge-lab'
import type { EdgePoseId } from './poses'

const SERVER_STATE: EdgeLabState = { active: false, mode: 'outer', pose: null }

function readSearch(): EdgeLabState {
  if (typeof window === 'undefined') return SERVER_STATE
  return edgeLabFromSearch(window.location.search)
}

export function setEdgeLab(next: { mode?: EdgeMode; pose?: EdgePoseId | null }): void {
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

/** URL-backed lab state; re-reads on the lab event (panel or harness) and on history navigation. */
export function useEdgeLab(): EdgeLabState & { set: typeof setEdgeLab } {
  const [state, setState] = useState<EdgeLabState>(SERVER_STATE)
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
