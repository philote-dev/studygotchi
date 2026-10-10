'use client'

/**
 * `?colliders=1`: every registered collider drawn as a thin magenta wireframe (circle = ring,
 * box = outline) at terrain height + 0.3, plus the live walker radii in green. One LineSegments
 * geometry for the static set, rebuilt only when the registry version moves (and at most every
 * 0.25 s while registrations are still arriving); a small one for the agents each frame.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Collider } from './colliders'
import { type AgentBody, useColliderRegistry, useCollidersDebug } from './ColliderRegistry'

const CIRCLE_SEGMENTS = 24
const AGENT_SEGMENTS = 20
const STATIC_COLOUR = '#ff2bd6'
const AGENT_COLOUR = '#39ff88'
const REBUILD_INTERVAL_S = 0.25

type GroundAt = (x: number, z: number) => number

function pushRing(out: number[], x: number, y: number, z: number, r: number, segments: number): void {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    out.push(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r)
  }
}

/** Box outline from its four corners, rotated with the collider convention (lx cos + lz sin, −lx sin + lz cos). */
function pushBox(out: number[], c: Extract<Collider, { kind: 'box' }>, y: number): void {
  const cs = Math.cos(c.yaw)
  const sn = Math.sin(c.yaw)
  const corners: Array<[number, number]> = [
    [-c.hx, -c.hz],
    [c.hx, -c.hz],
    [c.hx, c.hz],
    [-c.hx, c.hz],
  ]
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i]
    const [bx, bz] = corners[(i + 1) % 4]
    out.push(c.x + ax * cs + az * sn, y, c.z - ax * sn + az * cs, c.x + bx * cs + bz * sn, y, c.z - bx * sn + bz * cs)
  }
}

function staticLines(shapes: readonly Collider[], groundAt: GroundAt, lift: number): Float32Array {
  const out: number[] = []
  for (const c of shapes) {
    // One terrain sample per collider (not per vertex) keeps a 600-collider rebuild cheap.
    const y = groundAt(c.x, c.z) + lift
    if (c.kind === 'circle') pushRing(out, c.x, y, c.z, c.r, CIRCLE_SEGMENTS)
    else pushBox(out, c, y)
  }
  return new Float32Array(out)
}

function agentLines(bodies: readonly AgentBody[], groundAt: GroundAt, lift: number): Float32Array {
  const out: number[] = []
  for (const b of bodies) pushRing(out, b.x, groundAt(b.x, b.z) + lift, b.z, b.r, AGENT_SEGMENTS)
  return new Float32Array(out)
}

function ColliderDebugLines({ groundAt, lift }: { groundAt: GroundAt; lift: number }) {
  const registry = useColliderRegistry()
  const ground = useRef(groundAt)
  ground.current = groundAt
  const staticGeometry = useMemo(() => new THREE.BufferGeometry(), [])
  const agentGeometry = useMemo(() => new THREE.BufferGeometry(), [])
  const seenVersion = useRef(-1)
  const lastBuild = useRef(-Infinity)

  useEffect(
    () => () => {
      staticGeometry.dispose()
      agentGeometry.dispose()
    },
    [staticGeometry, agentGeometry],
  )

  useFrame(({ clock }) => {
    if (registry.version !== seenVersion.current && clock.elapsedTime - lastBuild.current >= REBUILD_INTERVAL_S) {
      seenVersion.current = registry.version
      lastBuild.current = clock.elapsedTime
      staticGeometry.setAttribute('position', new THREE.BufferAttribute(staticLines(registry.shapes(), ground.current, lift), 3))
      staticGeometry.computeBoundingSphere()
    }
    const bodies: AgentBody[] = []
    for (const list of registry.agents.values()) bodies.push(...list)
    const positions = agentLines(bodies, ground.current, lift)
    const attribute = agentGeometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (attribute && attribute.array.length === positions.length) {
      ;(attribute.array as Float32Array).set(positions)
      attribute.needsUpdate = true
    } else {
      agentGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    }
    agentGeometry.computeBoundingSphere()
  })

  return (
    <group name="collider-debug">
      <lineSegments geometry={staticGeometry} frustumCulled={false} renderOrder={999}>
        <lineBasicMaterial color={STATIC_COLOUR} depthTest={false} depthWrite={false} transparent opacity={0.95} />
      </lineSegments>
      <lineSegments geometry={agentGeometry} frustumCulled={false} renderOrder={1000}>
        <lineBasicMaterial color={AGENT_COLOUR} depthTest={false} depthWrite={false} />
      </lineSegments>
    </group>
  )
}

/** Mount inside the Canvas under a `ColliderProvider`; renders nothing unless `?colliders=1`. */
export function ColliderDebug({ groundAt, lift = 0.3 }: { groundAt: GroundAt; lift?: number }) {
  const enabled = useCollidersDebug()
  if (!enabled) return null
  return <ColliderDebugLines groundAt={groundAt} lift={lift} />
}
