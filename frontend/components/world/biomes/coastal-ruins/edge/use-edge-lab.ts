'use client'

import { useCallback, useEffect, useState } from 'react'
import { edgePose, type EdgePoseId } from './poses'

/**
 * Edge lab state lives in the URL so the capture harness, the panel and the scene agree:
 *   ?edge=outer|none   the outer world (default) or the land as shipped
 *   ?pose=<id>         a fixed comparison pose
 * Any change dispatches `ice-edge-lab` (the harness dispatches the same event) so every
 * subscriber re-reads without a reload.
 */
export const EDGE_LAB_EVENT = 'ice-edge-lab'

/**
 * Free-camera sweep hook for throwaway lab tooling: `window.dispatchEvent(new CustomEvent(
 * 'coastal-edge-camera', { detail: { pitchDeg, azimuthDeg, distance, target } }))` (metres, the
 * edge-pose convention) snaps the camera there and restarts the `data-edge-ready` count.
 */
export const EDGE_CAMERA_EVENT = 'coastal-edge-camera'

export interface EdgeCameraDetail {
  pitchDeg: number
  azimuthDeg: number
  distance: number
  target: [number, number, number]
}

export type EdgeMode = 'outer' | 'none'

export interface EdgeLabState {
  /** True when an `edge` or `pose` param is present: the panel shows and poses apply. */
  active: boolean
  mode: EdgeMode
  pose: EdgePoseId | null
}

function params(search: string | URLSearchParams): URLSearchParams {
  if (typeof search !== 'string') return search
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
}

/** `none` turns the outer world off; anything else (including no param) leaves it on. */
export function edgeModeFromSearch(search: string | URLSearchParams): EdgeMode {
  return params(search).get('edge') === 'none' ? 'none' : 'outer'
}

export function edgeLabFromSearch(search: string | URLSearchParams): EdgeLabState {
  const p = params(search)
  return {
    active: p.has('edge') || p.has('pose'),
    mode: edgeModeFromSearch(p),
    pose: edgePose(p.get('pose'))?.id ?? null,
  }
}

function readSearch(): EdgeLabState {
  if (typeof window === 'undefined') return { active: false, mode: 'outer', pose: null }
  return edgeLabFromSearch(window.location.search)
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
  // The land mounts client-only (`dynamic`, ssr: false), so the URL can be read on the first render.
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
