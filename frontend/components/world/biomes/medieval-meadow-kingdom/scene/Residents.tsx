import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MEADOW_PALETTE as P, type DistrictProgress, type GeneratedKingdom } from '../layout/biome-layout'
import { animalPlacements, sampleTerrain, type AnimalPlacement } from '../layout/terrain'
import { Surf } from '../render/materials'
import type { CatastrophePhase } from '../state'
import { collidersDebugEnabled, useColliderRegistry, useColliderSet, type WalkerDevHook } from '../../collision/ColliderRegistry'
import { createWalker, settleWalkers, stepWalkers, walkerDistricts, type WalkerBody } from '../collision/walkers'

/** Live resident positions so the camera can follow one without React state churn. */
export const residentPositions: THREE.Vector3[] = []

const ACCENTS = [P.coral, P.ochre, P.rose, P.wheat, P.forestLight, P.light]

/** Height of the modelled creature (hat tip) at scale 1. */
const MODEL_HEIGHT = 1.5

const WALKER_AGENTS_ID = 'meadow-walkers'
/** Frames the collider registry must hold still before the first bodies are placed. */
const SETTLE_FRAMES = 2

function Animal({ animal }: { animal: AnimalPlacement }) {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    group.current.position.y = animal.position[1] + Math.abs(Math.sin(clock.elapsedTime * 2.1 + animal.position[0])) * 0.06
  })
  const bodyColor = animal.kind === 'cow' ? '#b98055' : animal.kind === 'sheep' ? '#eee6cf' : P.wheat
  const size = animal.kind === 'cow' ? 1.5 : animal.kind === 'sheep' ? 1.05 : 0.48
  return (
    <group ref={group} position={animal.position} rotation={[0, animal.yaw, 0]} scale={animal.scale * size}>
      <mesh position={[0, 0.72, 0]} scale={[1.35, 0.8, 0.78]} castShadow>
        <dodecahedronGeometry args={[0.62, animal.kind === 'sheep' ? 1 : 0]} />
        <Surf color={bodyColor} />
      </mesh>
      <mesh position={[0, 0.73, 0.62]} castShadow>
        <dodecahedronGeometry args={[animal.kind === 'cow' ? 0.34 : 0.28, 0]} />
        <Surf color={animal.kind === 'sheep' ? '#4b4039' : bodyColor} />
      </mesh>
      {[-0.4, 0.4].flatMap((x) => [-0.24, 0.24].map((z) => (
        <mesh key={`${x}:${z}`} position={[x, 0.25, z]}>
          <cylinderGeometry args={[0.055, 0.075, 0.5, 5]} />
          <Surf color={animal.kind === 'chicken' ? P.ochre : '#55463b'} />
        </mesh>
      )))}
      {animal.kind === 'cow' && [-0.18, 0.18].map((x) => (
        <mesh key={x} position={[x, 1.02, 0.75]} rotation={[Math.PI / 2, 0, x * 2]}>
          <coneGeometry args={[0.08, 0.42, 5]} />
          <Surf color={P.limestone} />
        </mesh>
      ))}
      {animal.kind === 'chicken' && (
        <mesh position={[0, 1.02, 0.65]}>
          <coneGeometry args={[0.12, 0.28, 5]} />
          <Surf color={P.coral} />
        </mesh>
      )}
    </group>
  )
}

/** The blob faces +z: a heading (cos h, sin h) in XZ is rotation.y = atan2(dirX, dirZ). */
function yawFromHeading(heading: number): number {
  return Math.atan2(Math.cos(heading), Math.sin(heading))
}

function Resident({
  index,
  apart,
  bodies,
  layout,
  sleeping,
  scale,
}: {
  index: number
  apart: React.MutableRefObject<number>
  bodies: React.RefObject<WalkerBody[]>
  layout: GeneratedKingdom
  sleeping: boolean
  scale: number
}) {
  const group = useRef<THREE.Group>(null)
  const body = useRef<THREE.Mesh>(null)
  const head = useRef<THREE.Mesh>(null)
  const hat = useRef<THREE.Mesh>(null)
  const accent = ACCENTS[index % ACCENTS.length]
  const phase = index * 1.7

  useFrame(({ clock }) => {
    const root = group.current
    const walker = bodies.current?.[index]
    if (!root || !body.current || !head.current || !hat.current) return
    if (!walker) {
      root.visible = false
      return
    }
    root.visible = true
    const t = clock.elapsedTime
    // Position from the collision simulation; height read from the heightfield.
    const s = sampleTerrain(layout, walker.x, walker.z)
    const y = Math.max(layout.waterHeight + 0.5, s.height)
    root.position.set(walker.x, y, walker.z)
    if (!sleeping) root.rotation.y = yawFromHeading(walker.heading)
    if (!residentPositions[index]) residentPositions[index] = new THREE.Vector3()
    residentPositions[index].copy(root.position)

    // Walk cycle: hop and lean while moving. Fall apart: parts spring out and the head tumbles, then reassemble.
    const a = apart.current
    const ease = a * a * (3 - 2 * a)
    const walking = walker.moving && !sleeping
    const bob = walking ? Math.abs(Math.sin(t * 6 + phase)) * 0.12 : 0
    body.current.position.set(0, 0.42 + bob - ease * 0.3, 0)
    body.current.rotation.z = sleeping ? 1.4 : (walking ? Math.sin(t * 6 + phase) * 0.08 : 0) + ease * 1.2
    head.current.position.set(ease * 0.9, 0.86 + bob + ease * 0.4, ease * 0.5)
    head.current.rotation.x = ease * 2.4
    hat.current.position.set(-ease * 0.8, 1.25 + bob + ease * 1.1, -ease * 0.3)
    hat.current.rotation.z = ease * 2.0
  })

  return (
    <group ref={group} scale={scale} visible={false}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.42, 12]} />
        <meshBasicMaterial color={P.ink} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh ref={body} castShadow scale={[1.0, 0.9, 0.95]}>
        <dodecahedronGeometry args={[0.5, 1]} />
        <Surf color={index % 2 ? P.limestone : '#e8dec0'} />
      </mesh>
      <mesh ref={head} castShadow>
        <icosahedronGeometry args={[0.4, 2]} />
        <Surf color={P.limestone} />
        {[-0.14, 0.14].map((x) => (
          <mesh key={x} position={[x, 0.06, 0.36]}>
            <sphereGeometry args={[0.05, 8, 6]} />
            <meshBasicMaterial color={P.ink} />
          </mesh>
        ))}
      </mesh>
      <mesh ref={hat} castShadow>
        <coneGeometry args={[0.32, 0.52, 7]} />
        <Surf color={accent} />
      </mesh>
    </group>
  )
}

/**
 * Residents walk the land on the shared collision API: one simulation (`stepWalkers`) runs once per
 * frame at priority −1, before the blobs read their bodies. Each body steers round the registered
 * colliders, sweeps its circle (no tunnelling), stays out of the river, and is kept apart from
 * the others. Sleeping residents (night) hold still; during the catastrophe everyone holds still
 * and is only kept clear of colliders.
 */
export function Residents({
  layout,
  progress,
  count,
  seed,
  phase,
  night,
}: {
  layout: GeneratedKingdom
  progress: DistrictProgress
  count: number
  seed: number
  phase: CatastrophePhase
  night: boolean
}) {
  const apart = useRef(0)
  // Scale rule: base height × the per-course creature scale (biome-layout.ts, requiredCreatureScale).
  const scale = (layout.creatureHeight / MODEL_HEIGHT) * layout.creatureScale
  const districts = useMemo(() => walkerDistricts(layout, progress, count), [layout, progress, count])
  const animals = useMemo(() => animalPlacements(layout, seed), [layout, seed])
  const dismantle = phase === 'bang' || phase === 'ruin'

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

  // A district change (progress) rebuilds the bodies from scratch.
  useEffect(() => {
    bodies.current.length = 0
  }, [districts])

  useFrame((_, dt) => {
    const target = dismantle ? 1 : 0
    const rate = phase === 'bang' ? 4.5 : 1.6
    apart.current += (target - apart.current) * Math.min(1, dt * rate)
    if (Math.abs(target - apart.current) < 0.005) apart.current = target

    const set = colliders.current
    const list = bodies.current
    // Wait for the registrations of the first frames to settle before placing anyone.
    if (registry.version !== settle.current.version) {
      settle.current.version = registry.version
      settle.current.frames = 0
    } else settle.current.frames += 1
    if (list.length === 0 && settle.current.frames < SETTLE_FRAMES) return
    if (list.length > districts.length) list.length = districts.length
    while (list.length < districts.length) list.push(createWalker(layout, set, districts, list.length))
    if (list.length === 0) return
    for (const body of list) body.still = night && body.index % 3 === 0
    const t0 = performance.now()
    if (dismantle) settleWalkers(layout, list, set)
    else stepWalkers(layout, list, set, dt)
    stats.current.ms += (performance.now() - t0 - stats.current.ms) * 0.1
  }, -1)

  return (
    <group name="meadow-residents">
      {districts.map((_, i) => (
        <Resident key={i} index={i} apart={apart} bodies={bodies} layout={layout} sleeping={night && i % 3 === 0} scale={scale} />
      ))}
      {animals.map((animal, index) => <Animal key={`${animal.kind}-${index}`} animal={animal} />)}
    </group>
  )
}
