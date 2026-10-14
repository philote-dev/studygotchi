import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { Glow, Surf } from '../../render/materials'
import type { Placed } from './bag'
import { GEOMETRY } from './geometries'
import type { Heightfield } from './heightfield'
import type { Layout, Skiff, Windmill } from './layout'
import { palette, type ColorKey, type Palette } from './palette'

const LAND_PARTS = new Set(['cap', 'cliff', 'scrub', 'plaza'])

function TerrainMesh({ field, pal }: { field: Heightfield; pal: Palette }) {
  const geometries = useMemo(
    () =>
      Object.entries(field.parts).map(([key, part]) => {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
        geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3))
        return [key, geometry] as const
      }),
    [field],
  )
  useEffect(
    () => () => {
      for (const [, geometry] of geometries) geometry.dispose()
    },
    [geometries],
  )
  return (
    <>
      {geometries.map(([key, geometry]) => (
        <mesh key={key} geometry={geometry} castShadow={LAND_PARTS.has(key)} receiveShadow>
          <Surf color={pal[key as ColorKey] ?? '#ff00ff'} />
        </mesh>
      ))}
    </>
  )
}

/** Semi-transparent sheet over the banded seabed, and an opaque abyss plane out to the fog. */
function Water({ pal }: { pal: Palette }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[1800, 1800]} />
        <Surf color={pal.water} transparent opacity={pal.waterOpacity} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -8, 0]}>
        <planeGeometry args={[1800, 1800]} />
        <Surf color={pal.deep} />
      </mesh>
    </>
  )
}

const MATRIX = new THREE.Matrix4()
const POSITION = new THREE.Vector3()
const QUATERNION = new THREE.Quaternion()
const SCALE = new THREE.Vector3()
// YXZ: yaw is outermost, so a pitched (fallen) column lies along its own yawed direction.
const EULER = new THREE.Euler(0, 0, 0, 'YXZ')

function Instanced({
  geometry,
  items,
  castShadow,
  receiveShadow,
  children,
}: {
  geometry: THREE.BufferGeometry
  items: readonly Placed[]
  castShadow: boolean
  receiveShadow: boolean
  children: ReactNode
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    items.forEach((item, index) => {
      EULER.set(item.pitch ?? 0, item.yaw ?? 0, item.roll ?? 0)
      QUATERNION.setFromEuler(EULER)
      POSITION.set(item.x, item.y, item.z)
      SCALE.set(item.sx ?? 1, item.sy ?? 1, item.sz ?? 1)
      MATRIX.compose(POSITION, QUATERNION, SCALE)
      mesh.setMatrixAt(index, MATRIX)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items])
  return (
    <instancedMesh key={items.length} ref={ref} args={[geometry, undefined, items.length]} castShadow={castShadow} receiveShadow={receiveShadow}>
      {children}
    </instancedMesh>
  )
}

/** Every windmill's sails, spun by one slow useFrame. */
function Sails({ items }: { items: readonly Windmill[] }) {
  const refs = useRef<Array<THREE.Group | null>>([])
  useFrame((_, delta) => {
    for (const group of refs.current) if (group) group.rotation.z += delta * 0.45
  })
  return (
    <>
      {items.map((mill, index) => (
        <group
          key={index}
          position={[mill.x, mill.y, mill.z]}
          rotation={[0, mill.yaw, index * 0.7]}
          ref={(element) => {
            refs.current[index] = element
          }}
        >
          {[0, Math.PI / 2].map((angle) => (
            <mesh key={angle} rotation={[0, 0, angle]} castShadow>
              <boxGeometry args={[0.8, 14, 0.16]} />
              <Surf color="#f7f3ea" />
            </mesh>
          ))}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.5, 0.5, 1.1, 6]} />
            <Surf color="#6f675a" />
          </mesh>
        </group>
      ))}
    </>
  )
}

function SkiffLoop({ skiff }: { skiff: Skiff }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const group = ref.current
    if (!group) return
    const t = clock.elapsedTime * skiff.speed + skiff.phase
    group.position.set(skiff.cx + Math.cos(t) * skiff.radius, 0.05, skiff.cz + Math.sin(t) * skiff.radius)
    group.rotation.y = -t
  })
  return (
    <group ref={ref}>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[1.7, 1, 4.6]} />
        <Surf color="#f7f3ea" />
      </mesh>
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[1.8, 0.24, 4.7]} />
        <Surf color="#5279a5" />
      </mesh>
      <mesh position={[0, 0.9, 2.5]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[1.1, 0.9, 1.1]} />
        <Surf color="#f7f3ea" />
      </mesh>
      <mesh position={[0, 3, 0]}>
        <boxGeometry args={[0.14, 4.8, 0.14]} />
        <Surf color="#8a6a4c" />
      </mesh>
      <mesh position={[0, 3.2, -0.95]}>
        <boxGeometry args={[0.08, 3.2, 1.8]} />
        <Surf color="#f7f3ea" />
      </mesh>
    </group>
  )
}

export function Blockout({ layout, night }: { layout: Layout; night: boolean }) {
  const pal = palette(night)
  return (
    <group>
      <TerrainMesh field={layout.field} pal={pal} />
      <Water pal={pal} />
      {layout.batches.map((batch) => (
        <Instanced
          key={`${batch.geo}|${batch.color}|${batch.glow ? 1 : 0}|${batch.shadow ? 1 : 0}`}
          geometry={GEOMETRY[batch.geo]}
          items={batch.items}
          castShadow={batch.shadow}
          receiveShadow={!batch.glow}
        >
          {batch.glow ? <Glow color={pal.window} on={night} offColor={pal.windowOff} intensity={1.7} /> : <Surf color={pal[batch.color]} />}
        </Instanced>
      ))}
      {layout.windmills.length > 0 ? <Sails items={layout.windmills} /> : null}
      {layout.skiff ? <SkiffLoop skiff={layout.skiff} /> : null}
      {night && layout.lamp ? <pointLight position={layout.lamp} color={pal.window} intensity={420} distance={110} decay={2} /> : null}
    </group>
  )
}
