import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Glow, Surf } from '../../render/materials'
import { facetedGeometry, type HeightField } from './heightfield'
import type { GeometryKey, InstancedLayer, Item } from './plan-types'
import { nightTone } from './rng'

/* ------------------------------------------------------------------ unit geometries */

function prismGeometry(): THREE.BufferGeometry {
  // Gable roof: base 1 × 1 on y = 0, ridge along x at y = 1, no underside.
  const v = (x: number, y: number, z: number) => [x, y, z]
  const tris = [
    // +z slope
    ...v(-0.5, 0, 0.5), ...v(0.5, 0, 0.5), ...v(0.5, 1, 0),
    ...v(-0.5, 0, 0.5), ...v(0.5, 1, 0), ...v(-0.5, 1, 0),
    // -z slope
    ...v(0.5, 0, -0.5), ...v(-0.5, 0, -0.5), ...v(-0.5, 1, 0),
    ...v(0.5, 0, -0.5), ...v(-0.5, 1, 0), ...v(0.5, 1, 0),
    // gables
    ...v(0.5, 0, 0.5), ...v(0.5, 0, -0.5), ...v(0.5, 1, 0),
    ...v(-0.5, 0, -0.5), ...v(-0.5, 0, 0.5), ...v(-0.5, 1, 0),
  ]
  return facetedGeometry(Float32Array.from(tris))
}

function based<T extends THREE.BufferGeometry>(geometry: T): T {
  geometry.translate(0, 0.5, 0)
  return geometry
}

let cache: Record<GeometryKey, THREE.BufferGeometry> | null = null

export function unitGeometries(): Record<GeometryKey, THREE.BufferGeometry> {
  if (cache) return cache
  const cone4 = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4)
  cone4.rotateY(Math.PI / 4)
  cache = {
    box: based(new THREE.BoxGeometry(1, 1, 1)),
    prism: prismGeometry(),
    cone6: based(new THREE.ConeGeometry(0.5, 1, 6)),
    cone4: based(cone4),
    cyl8: based(new THREE.CylinderGeometry(0.5, 0.5, 1, 8)),
    cyl6: based(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)),
    ico: new THREE.IcosahedronGeometry(0.5, 0),
    plane: new THREE.PlaneGeometry(1, 1),
    arch: new THREE.TorusGeometry(1, 0.2, 4, 8, Math.PI),
  }
  return cache
}

/* ------------------------------------------------------------------ instancing */

const scratchMatrix = new THREE.Matrix4()
const scratchPos = new THREE.Vector3()
const scratchQuat = new THREE.Quaternion()
const scratchScale = new THREE.Vector3()
const scratchColor = new THREE.Color()
const Y_AXIS = new THREE.Vector3(0, 1, 0)

export function Instanced({
  geometry,
  items,
  color,
  night = false,
  glow = false,
  castShadow = true,
  receiveShadow = true,
}: {
  geometry: GeometryKey
  items: readonly Item[]
  color: string
  night?: boolean
  glow?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const unit = unitGeometries()[geometry]
  const tinted = items.some((item) => item.color)
  // the product's night grade: props darken toward blue like the ground does, glows are exempt
  const grade = (hex: string) => (night && !glow ? nightTone(hex, 0.62) : hex)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    items.forEach((item, index) => {
      scratchPos.set(item.p[0], item.p[1], item.p[2])
      scratchQuat.setFromAxisAngle(Y_AXIS, item.ry ?? 0)
      const s = item.s ?? [1, 1, 1]
      scratchScale.set(s[0], s[1], s[2])
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale)
      mesh.setMatrixAt(index, scratchMatrix)
      if (tinted) mesh.setColorAt(index, scratchColor.set(grade(item.color ?? color)))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items, tinted, color, night, glow])
  if (items.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[unit, undefined, items.length]} castShadow={castShadow} receiveShadow={receiveShadow} frustumCulled={false}>
      {glow ? <Glow color={color} on={night} intensity={1.8} /> : <Surf color={tinted ? '#ffffff' : grade(color)} />}
    </instancedMesh>
  )
}

export function Layers({ layers, night }: { layers: readonly InstancedLayer[]; night: boolean }) {
  return (
    <>
      {layers.map((layer) => (
        <Instanced key={layer.id} geometry={layer.geometry} items={layer.items} color={layer.color} glow={layer.glow} night={night} castShadow={layer.castShadow ?? true} />
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ ground + draped surfaces */

function useOwnedGeometry(positions: Float32Array): THREE.BufferGeometry {
  const geometry = useMemo(() => facetedGeometry(positions), [positions])
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

export function Ground({ hf, classify, colors }: { hf: HeightField; classify: (x: number, z: number, y: number, ny: number) => string; colors: Record<string, string> }) {
  const groups = useMemo(() => Array.from(hf.groups(classify), ([key, positions]) => ({ key, geometry: facetedGeometry(positions) })), [hf, classify])
  useEffect(() => () => groups.forEach((group) => group.geometry.dispose()), [groups])
  return (
    <group>
      {groups.map((group) => (
        <mesh key={group.key} geometry={group.geometry} receiveShadow castShadow>
          <Surf color={colors[group.key] ?? '#ff00ff'} />
        </mesh>
      ))}
    </group>
  )
}

/** A merged triangle list (roads, plazas, fields of one colour) rendered with one toon surface. */
export function Draped({ positions, color, castShadow = false }: { positions: Float32Array; color: string; castShadow?: boolean }) {
  const geometry = useOwnedGeometry(positions)
  if (positions.length === 0) return null
  return (
    <mesh geometry={geometry} receiveShadow castShadow={castShadow}>
      <Surf color={color} />
    </mesh>
  )
}

export function WaterSheet({ size, y, color }: { size: number; y: number; color: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <Surf color={color} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ moving bits (one slow useFrame per scene) */

export function WaterWheel({ position, radius, axisYaw, color, speed = 0.5 }: { position: readonly [number, number, number]; radius: number; axisYaw: number; color: string; speed?: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.x += delta * speed
  })
  const paddles = useMemo(() => Array.from({ length: 8 }, (_, index) => (index / 8) * Math.PI * 2), [])
  const geometries = unitGeometries()
  return (
    <group position={[position[0], position[1], position[2]]} rotation={[0, axisYaw, 0]}>
      <group ref={ref}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[radius, radius, 0.5, 10]} />
          <Surf color={color} />
        </mesh>
        {paddles.map((angle) => (
          <mesh key={angle} geometry={geometries.box} position={[0, Math.cos(angle) * radius * 0.6, Math.sin(angle) * radius * 0.6]} rotation={[angle, 0, 0]} scale={[1.8, radius * 0.5, 0.25]} castShadow>
            <Surf color={color} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

export function WindmillSails({ position, radius, yaw, color, speed = 0.35 }: { position: readonly [number, number, number]; radius: number; yaw: number; color: string; speed?: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * speed
  })
  const geometries = unitGeometries()
  return (
    <group position={[position[0], position[1], position[2]]} rotation={[0, yaw, 0]}>
      <group ref={ref}>
        {[0, 1, 2, 3].map((index) => (
          <mesh key={index} geometry={geometries.box} rotation={[0, 0, (index * Math.PI) / 2]} position={[0, 0, 0]} scale={[radius * 0.22, radius, 0.3]} castShadow>
            <Surf color={color} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ triangle report */

/** Counts triangles under the scene group and publishes them for the capture harness. */
export function useTriangleReport(label: string) {
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    let total = 0
    root.updateMatrixWorld(true)
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const geometry = mesh.geometry
      const faces = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3
      const count = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1
      total += faces * count
    })
    document.documentElement.dataset.visionTriangles = String(Math.round(total))
    document.documentElement.dataset.visionTrianglesLabel = label
  }, [label])
  return ref
}
