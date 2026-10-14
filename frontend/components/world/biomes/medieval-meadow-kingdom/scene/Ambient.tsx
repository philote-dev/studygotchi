import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MEADOW_PALETTE as P, seeded, type GeneratedKingdom } from '../layout/biome-layout'
import { cloudDriftHalfWidth, cloudPlacements } from '../layout/terrain'
import { Surf } from '../render/materials'

export function Clouds({ layout, night }: { layout: GeneratedKingdom; night: boolean }) {
  const group = useRef<THREE.Group>(null)
  // Placement and altitude live in layout/terrain.ts (cloudPlacements) so the edge lab can test them against the poses.
  const clouds = useMemo(() => cloudPlacements(layout), [layout])
  const halfWidth = cloudDriftHalfWidth(layout)
  useFrame((_, delta) => {
    group.current?.children.forEach((child, index) => {
      child.position.x += clouds[index].speed * delta
      if (child.position.x > halfWidth) child.position.x = -halfWidth
    })
  })
  return (
    <group ref={group}>
      {clouds.map((cloud, index) => (
        <group key={index} position={[cloud.x, cloud.y, cloud.z]} scale={cloud.scale}>
          {[[-1, 0, 0, 0.8], [0, 0.2, 0, 1], [1, -0.1, 0.2, 0.7]].map(([x, y, z, radius], part) => (
            <mesh key={part} position={[x, y, z]} scale={[1.2, 0.55, 0.9]}>
              <dodecahedronGeometry args={[radius, 0]} />
              <Surf color={night ? '#4a5675' : '#f7f0dc'} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

export function MeadowMotes({ layout, density = 1 }: { layout: GeneratedKingdom; density?: number }) {
  const points = useRef<THREE.Points>(null)
  const count = Math.round(500 * density)
  const positions = useMemo(() => {
    const rng = seeded(42)
    const values = new Float32Array(count * 3)
    for (let index = 0; index < count; index++) {
      values[index * 3] = (rng() - 0.5) * layout.frameSize[0] * 1.3
      values[index * 3 + 1] = rng() * 12
      values[index * 3 + 2] = (rng() - 0.5) * layout.frameSize[1] * 1.3
    }
    return values
  }, [count, layout])
  useFrame(({ clock }) => {
    if (!points.current) return
    points.current.rotation.y = clock.elapsedTime * 0.01
    points.current.position.y = Math.sin(clock.elapsedTime * 0.35) * 0.8
  })
  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={P.light} size={0.24} transparent opacity={0.65} depthWrite={false} />
    </points>
  )
}

export function Birds() {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    group.current.rotation.y = clock.elapsedTime * 0.035
    group.current.position.y = 18 + Math.sin(clock.elapsedTime * 0.4)
  })
  return (
    <group ref={group} position={[0, 18, 0]}>
      {[0, 1, 2, 3, 4].map((index) => (
        <group key={index} position={[32 + index * 3, index * 0.8, -14 + index * 4]} rotation={[0, index * 0.22, 0]}>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.5, 0, 0]} rotation={[0, 0, side * 0.35]}>
              <boxGeometry args={[0.9, 0.06, 0.3]} />
              <Surf color={P.ink} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

export function Stars() {
  const positions = useMemo(() => {
    const rng = seeded(23)
    const values = new Float32Array(500 * 3)
    for (let index = 0; index < 500; index++) {
      const angle = rng() * Math.PI * 2
      const radius = 450
      values[index * 3] = Math.cos(angle) * radius
      values[index * 3 + 1] = 40 + rng() * 220
      values[index * 3 + 2] = Math.sin(angle) * radius
    }
    return values
  }, [])
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#fff6d5" size={2} sizeAttenuation={false} transparent opacity={0.8} />
    </points>
  )
}
