'use client'

import { useCallback, useEffect, useState } from 'react'
import { type EdgeMode, edgeModeFromSearch } from './types'
import { type FrontierPoseId, frontierPose } from './poses'

/**
 * Lab state lives in the URL (`?edge=none|outer&pose=<id>`) so the capture harness, the panel
 * and the scene agree. Changing it dispatches the ice lab's event name (`ice-edge-lab`) so the
 * shared harness in tools/edge-lab/capture.mjs drives this land unchanged.
 */
export const EDGE_LAB_EVENT = 'ice-edge-lab'

export interface CustomCamera {
  position: [number, number, number]
  target: [number, number, number]
}

export interface FrontierEdgeLabState {
  /** True when an `edge` param is present (the panel shows itself then). */
  active: boolean
  mode: EdgeMode
  pose: FrontierPoseId | null
  /** `?cam=x,y,z,tx,ty,tz`: an arbitrary look-at for QA sweeps (overrides the pose; not clamped). */
  custom: CustomCamera | null
}

/** Parses `x,y,z,tx,ty,tz`; null unless all six are finite numbers. */
export function parseCustomCamera(raw: string | null | undefined): CustomCamera | null {
  if (!raw) return null
  const parts = raw.split(',').map((part) => Number(part.trim()))
  if (parts.length !== 6 || parts.some((n) => !Number.isFinite(n))) return null
  return { position: [parts[0], parts[1], parts[2]], target: [parts[3], parts[4], parts[5]] }
}

function readSearch(): FrontierEdgeLabState {
  if (typeof window === 'undefined') return { active: false, mode: 'outer', pose: null, custom: null }
  const params = new URLSearchParams(window.location.search)
  return {
    active: params.has('edge'),
    mode: edgeModeFromSearch(params),
    pose: frontierPose(params.get('pose'))?.id ?? null,
    custom: parseCustomCamera(params.get('cam')),
  }
}

export function setEdgeLab(next: { mode?: EdgeMode; pose?: FrontierPoseId | null }) {
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

export function useEdgeLab(): FrontierEdgeLabState & { set: typeof setEdgeLab } {
  const [state, setState] = useState<FrontierEdgeLabState>(() => readSearch())
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
