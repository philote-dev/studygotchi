import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { COASTAL_PALETTE as P, type BiomeLayout, type DistrictProgress } from '../layout/biome-layout'
import { sampleTerrain } from '../layout/terrain'
import { Surf } from '../render/materials'
import type { CatastrophePhase } from '../state'
import { collidersDebugEnabled, useColliderRegistry, useColliderSet, type WalkerDevHook } from '../../collision/ColliderRegistry'
import { WALKER_RADIUS_M, activeDistricts, createWalker, settleWalkers, stepWalkers, type WalkerBody } from './walkers'

export const residentPositions: THREE.Vector3[] = []
const MODEL_HEIGHT = 1.65
const WALKER_AGENTS_ID = 'coastal-walkers'
/** Frames the collider registry must hold still before the first bodies are placed. */
const SETTLE_FRAMES = 2

/** Bodies face +z: a heading (cos h, sin h) in XZ is rotation.y = atan2(dirX, dirZ). */
function yawFromHeading(heading: number): number {
  return Math.atan2(Math.cos(heading), Math.sin(heading))
}

function Resident({
  index,
  layout,
  apart,
  sleeping,
  scale,
  bodies,
}: {
  index: number
  layout: BiomeLayout
  apart: React.MutableRefObject<number>
  sleeping: boolean
  scale: number
  bodies: React.RefObject<WalkerBody[]>
}) {
  const group = useRef<THREE.Group>(null)
  const body = useRef<THREE.Mesh>(null)
  const head = useRef<THREE.Group>(null)
  const satchel = useRef<THREE.Mesh>(null)
  const yaw = useRef(0)

  useFrame(({ clock }) => {
    const root = group.current
    const walker = bodies.current?.[index]
    if (!root || !body.current || !head.current || !satchel.current) return
    if (!walker) {
      root.visible = false
      return
    }
    root.visible = true
    walker.still = sleeping
    const x = walker.x
    const z = walker.z
    const y = Math.max(layout.seaLevel + 0.25, sampleTerrain(layout, x, z).height)
    root.position.set(x, y, z)
    if (walker.moving) yaw.current = yawFromHeading(walker.heading)
    root.rotation.y = yaw.current
    if (!residentPositions[index]) residentPositions[index] = new THREE.Vector3()
    residentPositions[index].copy(root.position)

    const amount = apart.current
    const stepping = walker.moving && !sleeping
    const bob = stepping ? Math.abs(Math.sin(clock.elapsedTime * 5.5 + index)) * 0.12 : 0
    body.current.position.set(0, 0.56 + bob - amount * 0.25, 0)
    body.current.rotation.z = (sleeping ? 1.2 : stepping ? Math.sin(clock.elapsedTime * 5.5 + index) * 0.08 : 0) + amount * (index % 2 ? -1 : 1)
    head.current.position.set(amount * 0.8, 1.22 + bob + amount * 0.5, amount * 0.35)
    head.current.rotation.z = amount * 1.7
    satchel.current.position.set(-0.42 - amount * 0.7, 0.55 + amount * 0.3, 0.12)
  })

  return (
    <group ref={group} scale={scale} visible={false}>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.48, 12]} />
        <meshBasicMaterial color={P.ink} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh ref={body} castShadow scale={[0.8, 1, 0.75]}>
        <dodecahedronGeometry args={[0.6, 1]} />
        <Surf color={index % 3 === 1 ? '#e2cfaa' : P.plaster} />
      </mesh>
      <group ref={head}>
        <mesh castShadow>
          <icosahedronGeometry args={[0.45, 1]} />
          <Surf color={P.ground} />
        </mesh>
        {[-0.23, 0.23].map((x) => (
          <mesh key={x} position={[x, 0.34, -0.03]} rotation={[0, 0, x * -0.7]}>
            <coneGeometry args={[0.17, 0.45, 5]} />
            <Surf color={P.cliff} />
          </mesh>
        ))}
        {[-0.14, 0.14].map((x) => (
          <mesh key={`eye-${x}`} position={[x, 0.05, 0.4]}>
            <sphereGeometry args={[0.045, 6, 5]} />
            <meshBasicMaterial color={P.ink} />
          </mesh>
        ))}
      </group>
      <mesh ref={satchel} castShadow>
        <boxGeometry args={[0.42, 0.48, 0.22]} />
        <Surf color={index % 2 ? P.cobalt : P.violet} />
      </mesh>
    </group>
  )
}

/**
 * The residents: one deterministic simulation (`stepWalkers`) runs once per frame at priority −1,
 * before the bodies are read. Each walker steers round the registered colliders, sweeps its circle
 * (no tunnelling), stays off the sea, and is kept apart from the others. During the catastrophe
 * the bodies hold still and are only kept clear of colliders.
 */
export function Residents({
  layout,
  progress,
  count,
  seed,
  phase,
  night,
}: {
  layout: BiomeLayout
  progress: DistrictProgress
  count: number
  seed: number
  phase: CatastrophePhase
  night: boolean
}) {
  const apart = useRef(0)
  const scale = (layout.creatureHeight / MODEL_HEIGHT) * layout.creatureScale
  const districts = useMemo(() => activeDistricts(layout, progress), [layout, progress])
  const shown = districts.length === 0 ? 0 : count
  const dismantle = phase === 'quake' || phase === 'ruin'

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

  // A new seed or district set restarts the cast.
  useEffect(() => {
    bodies.current.length = 0
  }, [seed, districts])

  useFrame((_, delta) => {
    const target = phase === 'quake' || phase === 'ruin' ? 1 : 0
    const rate = phase === 'quake' ? 4.5 : 1.8
    apart.current += (target - apart.current) * Math.min(1, delta * rate)

    const set = colliders.current
    const list = bodies.current
    if (registry.version !== settle.current.version) {
      settle.current.version = registry.version
      settle.current.frames = 0
    } else settle.current.frames += 1
    if (list.length === 0 && settle.current.frames < SETTLE_FRAMES) return
    if (list.length > shown) list.length = shown
    while (list.length < shown) list.push(createWalker(layout, seed, set, districts, list.length, WALKER_RADIUS_M))
    if (list.length === 0) return
    const t0 = performance.now()
    if (dismantle) settleWalkers(layout, list, set)
    else stepWalkers(layout, seed, list, set, delta)
    stats.current.ms += (performance.now() - t0 - stats.current.ms) * 0.1
  }, -1)

  return (
    <group name="coastal-residents">
      {Array.from({ length: shown }, (_, index) => (
        <Resident key={index} index={index} layout={layout} apart={apart} sleeping={night && index % 4 === 0} scale={scale} bodies={bodies} />
      ))}
    </group>
  )
}
