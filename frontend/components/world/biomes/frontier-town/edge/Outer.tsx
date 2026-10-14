import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FRONTIER_PALETTE as P } from '../layout/biome-layout'
import { Surf } from '../render/materials'
import type { OuterDesert } from './outer/desert'
import { type Pose4, cartInto } from './outer/beyond-build'
import { runHeight } from './outer/structures'
import { Beyond } from './Beyond'
import { CART_SPEED, type OuterMotionRefs, PUFFS, beaconOn, emptyMotion, puffPhase, trainProgress } from './motion'
import {
  type OuterGrade,
  type RingMeshData,
  buildOuterMeshes,
  instanceTint,
  paintProp,
  plateGeometry,
  propGeometry,
  recolourGeometry,
  ringGeometry,
} from './outer/mesh'
import { RINGS } from './outer/plate'
import { type PropInstance, type PropKind, SCATTER, hoodooField, scatterProps } from './outer/scatter'
import { Vistas } from './Vistas'

/**
 * The outer world: the flat authored plate (replacing the old 520 × 800 m slab) and the endless
 * desert around it in three LOD rings, the instanced desert props, and the barriers' vistas.
 * Geometry is built once per seed; a day / night change recolours in place.
 */

const dummy = new THREE.Object3D()
const tint = new THREE.Color()

/** The flat plate under the town: same height, same material, same colour as the slab it replaces. */
export function Plate({ night }: { night: boolean }) {
  const geometry = useMemo(() => plateGeometry(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} receiveShadow>
      <Surf color={night ? '#7f5f4d' : P.sand} />
    </mesh>
  )
}

function OuterRings({ meshes, grade }: { meshes: RingMeshData[]; grade: OuterGrade }) {
  const built = useRef<{ meshes: RingMeshData[]; grade: OuterGrade; geometries: THREE.BufferGeometry[] } | null>(null)
  const geometries = useMemo(() => {
    const current = built.current
    if (current && current.meshes === meshes) return current.geometries
    const geometries = meshes.map((m) => ringGeometry(m, grade))
    built.current = { meshes, grade, geometries }
    return geometries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshes])

  useLayoutEffect(() => {
    const current = built.current
    if (!current || current.grade.night === grade.night) return
    meshes.forEach((m, i) => recolourGeometry(geometries[i], m, grade))
    current.grade = grade
  }, [grade, geometries, meshes])

  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries])

  return (
    <group name="outer-rings">
      {geometries.map((geometry, i) => (
        <mesh key={`${meshes[i].ring}-${meshes[i].quadrant}`} geometry={geometry} frustumCulled receiveShadow={meshes[i].ring === 1}>
          <Surf color="#ffffff" vertexColors />
        </mesh>
      ))}
    </group>
  )
}

function Props({ kind, items, grade, place }: { kind: PropKind; items: PropInstance[]; grade: OuterGrade; place?: (item: PropInstance, target: THREE.Object3D) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const built = useMemo(() => propGeometry(kind), [kind])
  useEffect(() => () => built.geometry.dispose(), [built])
  useLayoutEffect(() => {
    paintProp(built.geometry, built.which, kind, grade)
  }, [built, kind, grade])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (place) place(item, dummy)
      else {
        dummy.position.set(item.x, item.y, item.z)
        dummy.rotation.set(0, item.yaw, 0)
        dummy.scale.setScalar(item.scale)
      }
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, instanceTint(kind, grade, item.haze, tint))
    }
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items, kind, grade, place])
  if (items.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[built.geometry, undefined, items.length]} frustumCulled castShadow={false}>
      <Surf color="#ffffff" vertexColors />
    </instancedMesh>
  )
}

const placeHoodoo = (item: PropInstance & { height?: number; radius?: number }, target: THREE.Object3D) => {
  target.position.set(item.x, item.y, item.z)
  target.rotation.set(0, item.yaw, 0)
  target.scale.set(item.radius ?? 4, item.height ?? 20, item.radius ?? 4)
}

const cartPose: Pose4 = { x: 0, y: 0, z: 0, yaw: 0 }
const LAMP_RED = '#ff4a2e'
const LAMP_RED_OFF = '#8a3a30'

/**
 * The one frame loop for everything in the outer world that moves: the far train (yard → cutting
 * → trestle → portal), the mast beacon, the two carts on their lanes, chimney smoke and the drive's
 * dust, the ferry raft and the windmill wheels. No allocations; reduced motion holds every piece
 * at a fixed phase (train mid-deck, carts mid-lane, puffs frozen, beacon steady).
 */
function OuterMotion({ motion, night, reducedMotion }: { motion: React.MutableRefObject<OuterMotionRefs>; night: boolean; reducedMotion: boolean }) {
  const settled = useRef(false)
  useFrame(({ clock }, delta) => {
    const t = reducedMotion ? 0 : clock.elapsedTime
    const m = motion.current
    if (reducedMotion && settled.current && !night) return

    if (m.train && m.trainRun) {
      const run = m.trainRun
      const along = reducedMotion ? run.length * 0.55 : trainProgress(t, run.length)
      if (along === null) m.train.visible = false
      else {
        m.train.visible = true
        m.train.position.set(run.built.runStart[0] + run.dx * along, runHeight(run.built, along), run.built.runStart[1] + run.dz * along)
      }
    }
    if (m.beacon) {
      const on = night && (reducedMotion || beaconOn(t))
      m.beacon.emissiveIntensity = on ? 2.6 : 0
      m.beacon.color.set(on ? LAMP_RED : LAMP_RED_OFF)
    }
    if (m.carts && m.cartRoutes.length) {
      for (let i = 0; i < m.cartRoutes.length; i++) {
        const route = m.cartRoutes[i]
        cartInto(route, reducedMotion ? route.length * 0.4 : t, CART_SPEED, i * 37, cartPose)
        dummy.position.set(cartPose.x, cartPose.y, cartPose.z)
        dummy.rotation.set(0, cartPose.yaw, 0)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        m.carts.setMatrixAt(i, dummy.matrix)
      }
      m.carts.instanceMatrix.needsUpdate = true
    }
    if (m.smoke && m.smokeSources.length) {
      for (let i = 0; i < m.smokeSources.length; i++) {
        const s = m.smokeSources[i]
        for (let j = 0; j < PUFFS; j++) {
          const k = puffPhase(t, i, j, s.dust)
          // Rise, drift downwind (toward +x, −z), grow, thin out and vanish. The drive's dust stays
          // low and trails off the back of the column so the cattle still read in front of it.
          const rise = s.dust ? 0.8 + k * 3.5 : 1 + k * 16
          const drift = k * (s.dust ? 11 : 12)
          dummy.position.set(s.x + drift * 0.8, s.y + rise, s.z - drift * 0.5)
          const size = (s.dust ? 1.3 + k * 3.2 : 0.55 + k * 2.1) * Math.min(1, (1 - k) * 4)
          dummy.scale.setScalar(Math.max(0.001, size))
          dummy.rotation.set(k * 2, i + j, k)
          dummy.updateMatrix()
          m.smoke.setMatrixAt(i * PUFFS + j, dummy.matrix)
        }
      }
      m.smoke.instanceMatrix.needsUpdate = true
    }
    if (m.raft && m.raftPose) {
      const across = reducedMotion ? 1.5 : Math.sin(t * 0.21) * 4.5
      m.raft.position.set(m.raftPose.x + Math.cos(m.raftPose.yaw) * across, m.raftPose.y, m.raftPose.z - Math.sin(m.raftPose.yaw) * across)
    }
    if (m.wheels && m.wheelPoses.length) {
      for (let i = 0; i < m.wheelPoses.length; i++) {
        const w = m.wheelPoses[i]
        dummy.position.set(w.x, w.y, w.z)
        dummy.rotation.set(0, w.yaw, reducedMotion ? i : t * (0.9 + i * 0.17) + i)
        dummy.scale.setScalar(w.scale)
        dummy.updateMatrix()
        m.wheels.setMatrixAt(i, dummy.matrix)
      }
      m.wheels.instanceMatrix.needsUpdate = true
    }
    void delta
    settled.current = reducedMotion
  })
  return null
}

export function Outer({ desert, night, reducedMotion }: { desert: OuterDesert; night: boolean; reducedMotion: boolean }) {
  const meshes = useMemo(() => buildOuterMeshes(desert, RINGS), [desert])
  const grade = useMemo<OuterGrade>(() => ({ night }), [night])
  const fields = useMemo(() => SCATTER.map((spec) => ({ spec, items: scatterProps(desert, spec) })), [desert])
  const hoodoos = useMemo(() => hoodooField(desert), [desert])
  const motion = useRef<OuterMotionRefs>(emptyMotion())
  return (
    <group name="edge-outer">
      <Plate night={night} />
      <OuterRings meshes={meshes} grade={grade} />
      {fields.map(({ spec, items }) => (
        <Props key={spec.kind} kind={spec.kind} items={items} grade={grade} />
      ))}
      <Props kind="hoodoo" items={hoodoos} grade={grade} place={placeHoodoo} />
      <Vistas desert={desert} night={night} motion={motion} />
      <Beyond desert={desert} night={night} motion={motion} />
      <OuterMotion motion={motion} night={night} reducedMotion={reducedMotion} />
    </group>
  )
}
