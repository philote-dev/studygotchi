'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { NORDIC_PALETTE as P, type BiomeLayout, generateDistricts } from '../layout/biome-layout'
import { GROUND_Y } from '../layout/terrain'
import { Surf } from '../render/materials'
import { collidersDebugEnabled, useColliderRegistry, useColliderSet, type WalkerDevHook } from '../../collision/ColliderRegistry'
import { WALKER_DISTRICTS, createWalker, settleWalkers, stepWalkers, type WalkerBody } from './parade'

const WALKER_AGENTS_ID = 'nordic-walkers'
/** Frames the collider registry must hold still before the first bodies are placed. */
const SETTLE_FRAMES = 2

/** Headings are atan2(dz, dx); the figure faces +z, so rotation.y = atan2(dirX, dirZ). */
function yawFromHeading(heading: number): number {
  return Math.atan2(Math.cos(heading), Math.sin(heading))
}

function Walker({ index, scale, night, bodies, frozen }: { index: number; scale: number; night: boolean; bodies: React.RefObject<WalkerBody[]>; frozen: boolean }) {
  const group = useRef<THREE.Group>(null)
  const figure = useRef<THREE.Group>(null)
  const phase = useRef(index * 1.7)
  useFrame((_, dt) => {
    const root = group.current
    const body = bodies.current?.[index]
    if (!root) return
    if (!body) {
      root.visible = false
      return
    }
    root.visible = true
    root.position.set(body.x, GROUND_Y, body.z)
    root.rotation.set(0, yawFromHeading(body.heading), 0)
    if (!frozen && body.moving && body.speed > 0.2) phase.current += dt * 9
    const bob = body.moving && !frozen ? Math.abs(Math.sin(phase.current)) * 0.12 : 0
    if (figure.current) {
      figure.current.position.y = bob
      figure.current.rotation.z = body.moving && !frozen ? Math.sin(phase.current) * 0.05 : 0
    }
  })
  return (
    <group ref={group} scale={scale}>
      <group ref={figure}>
        <mesh position={[0, 0.85, 0]} castShadow>
          <capsuleGeometry args={[0.35, 0.8, 3, 6]} />
          <Surf color={index % 3 === 0 ? P.red : '#4b5968'} />
        </mesh>
        <mesh position={[0, 1.65, 0]}>
          <sphereGeometry args={[0.34, 7, 5]} />
          <Surf color="#d7b08a" />
        </mesh>
        <mesh position={[0, 1.95, 0]} rotation={[0, index, 0]}>
          <coneGeometry args={[0.5, 0.5, 6]} />
          <Surf color={night ? '#b8c6d0' : P.cream} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * The parade: one deterministic simulation (`stepWalkers`) runs once per frame at priority −1,
 * before the figures read their bodies. Under a frozen lab pose the bodies only settle (kept
 * clear of colliders and each other) so captures repeat exactly.
 */
export function Walkers({ layout, count, seed, night, frozen }: { layout: BiomeLayout; count: number; seed: number; night: boolean; frozen: boolean }) {
  const districts = useMemo(() => generateDistricts(layout, seed), [layout, seed])
  const shown = Math.min(count, WALKER_DISTRICTS.length)
  const registry = useColliderRegistry()
  const colliders = useColliderSet()
  const bodies = useRef<WalkerBody[]>([])
  const settle = useRef({ version: -1, frames: 0 })
  const stats = useRef({ ms: 0 })

  useEffect(() => {
    registry.setAgents(WALKER_AGENTS_ID, bodies.current)
    return () => registry.clearAgents(WALKER_AGENTS_ID)
  }, [registry])

  useEffect(() => {
    if (!collidersDebugEnabled()) return
    const hook: WalkerDevHook = Object.assign(() => bodies.current.map((body) => ({ x: body.x, z: body.z, r: body.r })), {
      ms: () => stats.current.ms,
    })
    window.__iceWalkers = hook
    return () => {
      delete window.__iceWalkers
    }
  }, [])

  useFrame((_, dt) => {
    const set = colliders.current
    const list = bodies.current
    if (registry.version !== settle.current.version) {
      settle.current.version = registry.version
      settle.current.frames = 0
    } else settle.current.frames += 1
    if (list.length === 0 && settle.current.frames < SETTLE_FRAMES) return
    if (list.length > shown) list.length = shown
    while (list.length < shown) list.push(createWalker(districts, set, WALKER_DISTRICTS, list.length))
    if (list.length === 0) return
    const t0 = performance.now()
    if (frozen) settleWalkers(list, set)
    else stepWalkers(districts, list, set, dt)
    stats.current.ms += (performance.now() - t0 - stats.current.ms) * 0.1
  }, -1)

  return (
    <group name="nordic-walkers">
      {Array.from({ length: shown }, (_, index) => (
        <Walker key={index} index={index} scale={layout.creatureScale} night={night} bodies={bodies} frozen={frozen} />
      ))}
    </group>
  )
}
