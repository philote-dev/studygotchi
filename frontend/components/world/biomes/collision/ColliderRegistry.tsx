'use client'

/**
 * React side of the biome collision system: a registry of collider groups that scene components
 * fill with `useCollider`, exposed through context as a versioned, lazily rebuilt `ColliderSet`
 * that walkers read inside `useFrame`. The registry itself is plain TypeScript so instanced
 * meshes or non-React code can bulk-register through `colliderRegistry.registerMany`.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { type Collider, type ColliderSet, buildColliderSet, penetrationDepth } from './colliders'

/** A moving body (walker) for the debug overlay and the dev hooks. */
export interface AgentBody {
  x: number
  z: number
  r: number
}

export interface ColliderDevHook {
  count: () => number
  penetration: (x: number, z: number, r: number) => number
  shapes: () => Collider[]
  version: () => number
}

export type WalkerDevHook = (() => AgentBody[]) & {
  /** Smoothed milliseconds per frame spent in the walker update. */
  ms: () => number
}

declare global {
  interface Window {
    __iceColliders?: ColliderDevHook
    __iceWalkers?: WalkerDevHook
  }
}

export class ColliderRegistry {
  private readonly groups = new Map<string, readonly Collider[]>()
  private set: ColliderSet | null = null
  private dirty = true
  private nextId = 0
  /** Bumps on every registration change; the debug overlay rebuilds when it moves. */
  version = 0
  /** Live bodies published by the walker systems, by system id. */
  readonly agents = new Map<string, readonly AgentBody[]>()

  constructor(readonly cellSize = 4) {}

  allocateId(prefix = 'c'): string {
    this.nextId += 1
    return `${prefix}:${this.nextId}`
  }

  register(id: string, shape: Collider): void {
    this.registerMany(id, [shape])
  }

  /** Replace the group `id` with `shapes` (bulk registration for instanced meshes). */
  registerMany(id: string, shapes: readonly Collider[]): void {
    this.groups.set(id, shapes)
    this.touch()
  }

  unregister(id: string): void {
    if (this.groups.delete(id)) this.touch()
  }

  /** The current set, rebuilt only when a group changed since the last call. */
  getSet(): ColliderSet {
    if (this.dirty || !this.set) {
      this.set = buildColliderSet(this.shapes(), this.cellSize)
      this.dirty = false
    }
    return this.set
  }

  shapes(): Collider[] {
    const out: Collider[] = []
    for (const group of this.groups.values()) out.push(...group)
    return out
  }

  count(): number {
    let n = 0
    for (const group of this.groups.values()) n += group.length
    return n
  }

  penetration(x: number, z: number, r: number): number {
    return penetrationDepth(this.getSet(), x, z, r)
  }

  setAgents(id: string, bodies: readonly AgentBody[]): void {
    this.agents.set(id, bodies)
  }

  clearAgents(id: string): void {
    this.agents.delete(id)
  }

  private touch(): void {
    this.dirty = true
    this.version += 1
  }
}

/** Shared default registry (the provider uses it unless given another). */
export const colliderRegistry = new ColliderRegistry()

const ColliderContext = createContext<ColliderRegistry>(colliderRegistry)

/** `?colliders=1` turns on the overlay and the `window.__ice*` dev hooks. */
export function collidersDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('colliders') === '1'
}

/** Client-only read of the debug flag (false during SSR / the first render). */
export function useCollidersDebug(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => setEnabled(collidersDebugEnabled()), [])
  return enabled
}

export function ColliderProvider({ registry = colliderRegistry, children }: { registry?: ColliderRegistry; children: ReactNode }) {
  useEffect(() => {
    if (!collidersDebugEnabled()) return
    window.__iceColliders = {
      count: () => registry.count(),
      penetration: (x, z, r) => registry.penetration(x, z, r),
      shapes: () => registry.shapes(),
      version: () => registry.version,
    }
    return () => {
      delete window.__iceColliders
    }
  }, [registry])
  return <ColliderContext.Provider value={registry}>{children}</ColliderContext.Provider>
}

export function useColliderRegistry(): ColliderRegistry {
  return useContext(ColliderContext)
}

const EMPTY: readonly Collider[] = []

function shapesKey(shapes: readonly Collider[]): string {
  let key = ''
  for (const s of shapes) {
    key += s.kind === 'circle' ? `c${s.x.toFixed(3)},${s.z.toFixed(3)},${s.r.toFixed(3)};` : `b${s.x.toFixed(3)},${s.z.toFixed(3)},${s.hx.toFixed(3)},${s.hz.toFixed(3)},${s.yaw.toFixed(4)};`
  }
  return key
}

/**
 * Register one collider or a list for the lifetime of the component (world XZ; callers pass the
 * coordinates they place their meshes at). Re-registers when the shapes' values change, removes
 * on unmount, and survives Strict Mode's setup / cleanup pair.
 */
export function useCollider(shape: Collider | readonly Collider[] | null | undefined): void {
  const registry = useColliderRegistry()
  const idRef = useRef<string | null>(null)
  if (idRef.current === null) idRef.current = registry.allocateId('react')
  const id = idRef.current
  const shapes = useMemo<readonly Collider[]>(() => (shape ? (Array.isArray(shape) ? (shape as readonly Collider[]) : [shape as Collider]) : EMPTY), [shape])
  const key = useMemo(() => shapesKey(shapes), [shapes])
  const latest = useRef(shapes)
  latest.current = shapes
  useEffect(() => {
    if (latest.current.length === 0) {
      registry.unregister(id)
      return
    }
    registry.registerMany(id, latest.current)
    return () => registry.unregister(id)
    // `key` stands in for the shapes' values; identity churn with equal values must not re-register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, id, key])
}

/** Ref-like handle whose `current` is the live set (rebuilt lazily when the registry is dirty). */
export interface ColliderSetRef {
  readonly current: ColliderSet
}

export function useColliderSet(): ColliderSetRef {
  const registry = useColliderRegistry()
  return useMemo<ColliderSetRef>(
    () => ({
      get current() {
        return registry.getSet()
      },
    }),
    [registry],
  )
}
