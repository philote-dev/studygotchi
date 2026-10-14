import { useEffect, useMemo, useRef } from 'react'
import { Stars as DreiStars } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  FRONTIER_LAYOUT as L,
  FRONTIER_PALETTE as P,
  courseProgress,
  generateLayout,
  landmarkStage,
  populationFor,
  seeded,
} from '../layout/biome-layout'
import { backdropSkyline, backdropWallHeightAt, SKYLINE_STRATA } from '../layout/skyline'
import { DIG, MINE, RAILWAY, RANCH, RESERVE, type Slot, TELEGRAPH_LINE, TOWN, reserveItemMinCount, reserveItems } from '../layout/placements'
import { PixelComposer } from '../render/PixelComposer'
import { Glow, Surf } from '../render/materials'
import type { LabState } from '../state'
import { FreeCameraRig } from '../camera/FreeCameraRig'
import { EdgeLabOverlay } from '../edge/EdgeLabPanel'
import { Outer } from '../edge/Outer'
import { DESERT_FOG, createOuterDesert } from '../edge/outer/desert'
import { frontierColliders } from '../collision/footprints'
import { type FrontierWalker as FrontierWalkerBody, createWalkers, stepWalkers } from './walkers'
import { ColliderProvider, type ColliderDevHook, useCollider, useColliderRegistry, useColliderSet } from '../../collision/ColliderRegistry'
import { ColliderDebug } from '../../collision/ColliderDebug'

/**
 * Haze the outer world bakes into the authored skyline (lerp toward the sky) so that, with the
 * fog pushed out to 1.65 km, the back wall keeps the dusty read the 420 m fog used to give it
 * from the overview, and the mesa rows behind it can continue the gradient (0.5 → 0.9).
 */
export const SKYLINE_HAZE = { near: 0.4, far: 0.54 } as const

const hazeScratch = new THREE.Color()
const skyScratch = new THREE.Color()
function hazed(colour: string, sky: string, amount: number): string {
  if (amount <= 0) return colour
  return `#${hazeScratch.set(colour).lerp(skyScratch.set(sky), amount).getHexString()}`
}

function Box({ position, size, color, rotation = [0, 0, 0], glow = false }: {
  position: [number, number, number]
  size: [number, number, number]
  color: string
  rotation?: [number, number, number]
  glow?: boolean
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      {glow ? <Glow color={color} on intensity={1.5} /> : <Surf color={color} />}
    </mesh>
  )
}

function Post({ x, y, z, h, color = P.timberDark, r = 0.16 }: { x: number; y: number; z: number; h: number; color?: string; r?: number }) {
  return (
    <mesh position={[x, y + h / 2, z]} castShadow>
      <cylinderGeometry args={[r, r * 1.15, h, 6]} />
      <Surf color={color} />
    </mesh>
  )
}

function StarBadge({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh><cylinderGeometry args={[0.42, 0.42, 0.16, 10]} /><Surf color={P.mustard} /></mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <Box key={i} position={[0, 0, 0]} size={[0.15, 1.15, 0.12]} color={P.mustard} rotation={[0, 0, (i * Math.PI) / 5]} />
      ))}
    </group>
  )
}

function FalseFront({ position, color, variant = 'store', night = false }: {
  position: [number, number, number]
  color: string
  variant?: 'store' | 'saloon' | 'sheriff' | 'hotel'
  night?: boolean
}) {
  const tall = variant === 'saloon' || variant === 'hotel'
  const h = tall ? 8.2 : variant === 'sheriff' ? 5.2 : 5.7
  const w = variant === 'hotel' ? 9 : variant === 'sheriff' ? 6.4 : 7.6
  const facadeTop = h + (variant === 'saloon' ? 1.35 : 0.9)
  return (
    <group position={position}>
      <Box position={[0, h / 2, 0]} size={[w, h, 5.4]} color={color} />
      <Box position={[0, facadeTop, 0.08]} size={[w + 0.8, variant === 'saloon' ? 2.7 : 1.8, 0.55]} color={color} />
      <Box position={[0, h + 0.55, -0.6]} size={[w + 0.15, 0.45, 6.2]} color={P.timberDark} rotation={[0.04, 0, 0]} />
      <Box position={[-w * 0.32, facadeTop + 1.1, 0.12]} size={[w * 0.22, 0.85, 0.62]} color={color} />
      <Box position={[w * 0.32, facadeTop + 1.1, 0.12]} size={[w * 0.22, 0.85, 0.62]} color={color} />
      <Box position={[0, 0.28, 3.55]} size={[w + 1.2, 0.56, 2.5]} color={P.timber} />
      <Box position={[0, 3.45, 3.3]} size={[w + 1.1, 0.28, 2.8]} color={variant === 'saloon' ? P.oxblood : P.timber} rotation={[0.13, 0, 0]} />
      {[-w * 0.4, 0, w * 0.4].map((x) => <Post key={x} x={x} y={0} z={3.25} h={3.35} r={0.19} />)}
      {[-w * 0.4, w * 0.4].map((x) => (
        <Box key={`brace${x}`} position={[x * 0.92, 2.8, 3.28]} size={[1.3, 0.17, 0.17]} color={P.timberDark} rotation={[0, 0, x > 0 ? -0.68 : 0.68]} />
      ))}
      {[-w * 0.27, w * 0.27].map((x) => <Box key={x} position={[x, tall ? 5.4 : 2.7, 2.73]} size={[1.25, 1.35, 0.14]} color={night ? P.lamp : '#40545a'} glow={night} />)}
      <Box position={[0, 1.35, 2.64]} size={[1.3, 2.7, 0.14]} color={P.timberDark} />
      <Box position={[0, h + 0.7, 0.4]} size={[w * 0.55, 0.55, 0.18]} color={variant === 'saloon' ? P.canvas : P.timberDark} />
      <Box position={[0, h + 0.7, 0.52]} size={[w * 0.38, 0.12, 0.12]} color={P.mustard} />
      {variant === 'saloon' && (
        <>
          <Box position={[0, 4.45, 3.15]} size={[w + 0.2, 0.35, 2.2]} color={P.timber} />
          {[-w * 0.43, w * 0.43].map((x) => <Post key={x} x={x} y={4.2} z={3.7} h={2.5} />)}
          <Box position={[0, 5.1, 2.76]} size={[w * 0.78, 0.18, 0.18]} color={P.mustard} />
        </>
      )}
      {variant === 'hotel' && <>
        <Box position={[w / 2 + 0.7, 4.3, 0.4]} size={[1.1, 8.3, 1.1]} color={P.timberDark} />
        <Box position={[w / 2 + 0.7, 8.9, 0.4]} size={[2.2, 0.55, 0.35]} color={P.canvas} />
      </>}
      {variant === 'sheriff' && <>
        <StarBadge position={[1.9, 3.8, 2.92]} />
        {[-2.3, -1.9, -1.5].map((x) => <Box key={x} position={[x, 2.65, 2.82]} size={[0.09, 1.55, 0.09]} color={P.ink} />)}
      </>}
      <Box position={[w * 0.3, h + 1.8, -1.4]} size={[0.8, 3.2, 0.8]} color={P.timberDark} />
    </group>
  )
}

function WaterTower({ night }: { night: boolean }) {
  return (
    <group>
      {[-2, 2].flatMap((x) => [-2, 2].map((z) => <Post key={`${x}:${z}`} x={x} y={0} z={z} h={9} r={0.25} />))}
      {[2.5, 5.5, 8].map((y) => <Box key={y} position={[0, y, 0]} size={[5.2, 0.22, 5.2]} color={P.timber} />)}
      <mesh position={[0, 10, 0]} castShadow>
        <cylinderGeometry args={[3.2, 3.2, 4.2, 12]} />
        <Surf color={P.teal} />
      </mesh>
      <mesh position={[0, 12.4, 0]} castShadow>
        <coneGeometry args={[3.6, 1.2, 12]} />
        <Surf color={P.oxblood} />
      </mesh>
      <Box position={[0, 10, 3.23]} size={[0.8, 1.3, 0.1]} color={night ? P.lamp : P.mustard} glow={night} />
    </group>
  )
}

function Cactus({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <Post x={0} y={0} z={0} h={5} r={0.42} color={P.cactus} />
      <Post x={1.2} y={2.1} z={0} h={2.2} r={0.3} color={P.cactus} />
      <Box position={[0.62, 2.25, 0]} size={[1.25, 0.55, 0.55]} color={P.cactus} />
      <Post x={-1} y={1.2} z={0} h={1.7} r={0.27} color={P.cactus} />
      <Box position={[-0.5, 1.35, 0]} size={[1, 0.5, 0.5]} color={P.cactus} />
    </group>
  )
}

function PricklyPear({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {[
        [-0.8, 0.7, 0, 0.75],
        [0, 1.0, 0, 1],
        [0.8, 0.65, 0.2, 0.7],
        [0.25, 1.8, -0.1, 0.62],
      ].map(([x, y, z, s], i) => (
        <mesh key={i} position={[x, y, z]} scale={[s, s * 1.3, 0.28]} castShadow>
          <sphereGeometry args={[0.7, 7, 5]} />
          <Surf color={i === 3 ? '#5a934f' : P.cactus} />
        </mesh>
      ))}
    </group>
  )
}

function Scrub({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {[-0.7, 0, 0.7].map((x, i) => (
        <mesh key={x} position={[x, 0.45 + i * 0.12, (i % 2) * 0.5]} castShadow>
          <dodecahedronGeometry args={[0.72, 0]} />
          <Surf color={i % 2 ? '#78904d' : '#6e8245'} />
        </mesh>
      ))}
    </group>
  )
}

function RockOutcrop({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1.0, 0]} scale={[1.8, 1, 1.1]} castShadow><dodecahedronGeometry args={[1, 0]} /><Surf color="#90745d" /></mesh>
      <mesh position={[1.5, 0.6, 0.5]} scale={[1.1, 0.7, 0.8]} castShadow><dodecahedronGeometry args={[1, 0]} /><Surf color={P.strata} /></mesh>
      <mesh position={[-1.2, 0.45, 0.8]} scale={[0.8, 0.5, 0.7]} castShadow><dodecahedronGeometry args={[1, 0]} /><Surf color="#7f6654" /></mesh>
    </group>
  )
}

function HayBale({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[1.2, 1.2, 2.2, 10]} />
      <Surf color="#e8c96a" />
    </mesh>
  )
}

function WindPump() {
  const wheel = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (wheel.current) wheel.current.rotation.z += delta * 0.65
  })
  return (
    <group>
      {[-1.5, 1.5].flatMap((x) => [-1.5, 1.5].map((z) => <Post key={`${x}:${z}`} x={x} y={0} z={z} h={9} r={0.13} />))}
      {[2.5, 5, 7.5].map((y) => <Box key={y} position={[0, y, 0]} size={[3.3 - y * 0.18, 0.14, 3.3 - y * 0.18]} color={P.timber} />)}
      <group ref={wheel} position={[0, 9, 1.5]}>
        <mesh>
          <torusGeometry args={[2.3, 0.16, 6, 16]} />
          <Surf color={P.canvas} />
        </mesh>
        {Array.from({ length: 8 }, (_, i) => (
          <Box key={i} position={[0, 0, 0]} size={[0.12, 4.5, 0.1]} color={P.timberDark} rotation={[0, 0, (i * Math.PI) / 8]} />
        ))}
      </group>
    </group>
  )
}

function Corral({ position, radius }: { position: [number, number, number]; radius: number }) {
  return (
    <group position={position}>
      <mesh position={[0, 1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.13, 5, 32]} />
        <Surf color={P.timber} />
      </mesh>
      <mesh position={[0, 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.13, 5, 32]} />
        <Surf color={P.timber} />
      </mesh>
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2
        return <Post key={i} x={Math.cos(a) * radius} y={0} z={Math.sin(a) * radius} h={2.5} r={0.12} />
      })}
    </group>
  )
}

function FenceRun({ position, length, yaw = 0 }: { position: [number, number, number]; length: number; yaw?: number }) {
  const posts = Math.max(2, Math.ceil(length / 4))
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {Array.from({ length: posts + 1 }, (_, i) => <Post key={i} x={-length / 2 + (i / posts) * length} y={0} z={0} h={2.2} r={0.11} />)}
      {[0.8, 1.55].map((y) => <Box key={y} position={[0, y, 0]} size={[length, 0.14, 0.14]} color={P.timber} />)}
    </group>
  )
}

function Animal({ position, color = '#8a6045', horned = false }: { position: [number, number, number]; color?: string; horned?: boolean }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.4, 0]} scale={[1.7, 0.85, 0.85]} castShadow><dodecahedronGeometry args={[1, 0]} /><Surf color={color} /></mesh>
      <mesh position={[1.55, 1.7, 0]} castShadow><dodecahedronGeometry args={[0.55, 0]} /><Surf color={color} /></mesh>
      {[-0.9, 0.9].flatMap((x) => [-0.42, 0.42].map((z) => <Post key={`${x}:${z}`} x={x} y={0} z={z} h={1.25} r={0.11} color={P.timberDark} />))}
      {horned && [-1, 1].map((s) => <mesh key={s} position={[1.65, 2.15, s * 0.45]} rotation={[0, 0, s * 0.7]}><coneGeometry args={[0.1, 0.85, 5]} /><Surf color={P.canvas} /></mesh>)}
    </group>
  )
}

function Depot({ night }: { night: boolean }) {
  return (
    <group>
      <Box position={[31, 0.35, 0]} size={[9, 0.7, 42]} color={P.timber} />
      {Array.from({ length: 18 }, (_, i) => <Box key={i} position={[31, 0.76, -19.5 + i * 2.3]} size={[8.8, 0.12, 0.12]} color={i % 2 ? P.timberDark : P.mustard} />)}
      <Box position={[17, 4.4, -3]} size={[24, 8.8, 14]} color={P.teal} />
      <mesh position={[17, 10, -3]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[14.8, 3.1, 4]} /><Surf color={P.oxblood} /></mesh>
      <Box position={[17, 2, 4.08]} size={[3, 4, 0.18]} color={P.timberDark} />
      {[-7.5, -2.5, 2.5, 7.5].map((x) => <Box key={x} position={[17 + x, 5, 4.12]} size={[1.5, 1.8, 0.16]} color={night ? P.lamp : '#40545a'} glow={night} />)}
      <Box position={[26, 6.2, 0]} size={[16, 0.42, 38]} color={P.sage} rotation={[0, 0, -0.06]} />
      {[-17, -11, -5, 1, 7, 13, 19].map((z) => <Post key={z} x={30} y={0} z={z} h={6.2} r={0.24} />)}
      {[-17, -11, -5, 1, 7, 13, 19].map((z) => <Box key={`brace${z}`} position={[28.5, 5.05, z]} size={[3.4, 0.22, 0.22]} color={P.timberDark} rotation={[0, 0, -0.65]} />)}
      <Box position={[17, 9.5, 4.24]} size={[13, 1.2, 0.22]} color={P.canvas} />
      <Box position={[17, 9.5, 4.38]} size={[9.5, 0.16, 0.16]} color={P.oxblood} />
      <Box position={[-3, 3.8, 10]} size={[18, 7.6, 12]} color={P.timber} />
      <Box position={[-3, 8.2, 10]} size={[19, 1.2, 13]} color={P.timberDark} rotation={[0.08, 0, 0]} />
      <Box position={[-3, 3.1, 16.08]} size={[7, 4.8, 0.18]} color={P.ink} />
      {[-8, -3, 2].map((x) => <Box key={x} position={[x, 0.7, -14]} size={[4.2, 1.4, 3.2]} color={P.mustard} />)}
    </group>
  )
}

function WaterCrane() {
  return (
    <group>
      <Post x={0} y={0} z={0} h={10} r={0.35} />
      <Box position={[2.5, 9.2, 0]} size={[5.2, 0.4, 0.5]} color={P.timberDark} />
      <Post x={5} y={5.8} z={0} h={3.5} r={0.18} color={P.timberDark} />
      <mesh position={[0, 2.8, 0]}><cylinderGeometry args={[2.4, 2.7, 5.6, 12]} /><Surf color={P.teal} /></mesh>
    </group>
  )
}

function SignalMast({ night }: { night: boolean }) {
  return (
    <group>
      <Post x={0} y={0} z={0} h={11} r={0.18} />
      <Box position={[1.8, 9.5, 0]} size={[3.8, 0.3, 0.3]} color={P.timberDark} />
      {[0.8, 2.6].map((x, i) => (
        <mesh key={x} position={[x, 9.5, 0.25]}><sphereGeometry args={[0.48, 8, 6]} /><Glow color={i ? '#b24c38' : P.mustard} on={night} intensity={1.6} /></mesh>
      ))}
    </group>
  )
}

function Train({ active, night }: { active: boolean; night: boolean }) {
  const train = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (train.current && active) train.current.position.z = ((clock.elapsedTime * 9 + 70) % 270) - 135
  })
  return (
    <group ref={train} position={[59, 0.9, active ? -100 : -56]} rotation={[0, Math.PI, 0]}>
      <mesh position={[0, 2.6, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[2.1, 2.1, 8, 12]} /><Surf color={P.ink} /></mesh>
      <Box position={[0, 3, -5]} size={[4.8, 6, 5]} color={P.oxblood} />
      <Post x={0} y={4.5} z={2.2} h={4} color={P.ink} r={0.65} />
      {[-2.2, 2.2].flatMap((x) => [-4, 1.5].map((z) => <mesh key={`${x}:${z}`} position={[x, 0.8, z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[1.15, 1.15, 0.45, 12]} /><Surf color={P.ink} /></mesh>))}
      <Box position={[0, 6, 1.5]} size={[1.8, 0.6, 1.8]} color={night ? P.lamp : P.mustard} glow={night} />
      {[-10, -19].map((z, i) => <group key={z}><Box position={[0, 2.6, z]} size={[5, 5.2, 8]} color={i ? P.mustard : P.teal} />{[-2.3, 2.3].flatMap((x) => [-2, 2].map((q) => <mesh key={`${x}:${q}`} position={[x, 0.7, z + q]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[1, 1, 0.4, 12]} /><Surf color={P.ink} /></mesh>))}</group>)}
    </group>
  )
}

function Headframe() {
  return (
    <group>
      {[-1, 1].flatMap((side) => [-1, 1].map((depth) => (
        <Box key={`${side}:${depth}`} position={[side * 2.8, 11, depth * 2.8]} size={[0.62, 23, 0.62]} color={P.timberDark} rotation={[depth * -0.045, 0, side * -0.16]} />
      )))}
      {[4, 9, 14, 19].map((y) => <Box key={y} position={[0, y, 0]} size={[7.6 - y * 0.12, 0.38, 6.5 - y * 0.08]} color={P.timber} />)}
      {[-1, 1].flatMap((side) => [5.2, 11.2, 17.2].map((y) => (
        <Box key={`${side}:${y}`} position={[side * 1.4, y, 3.02]} size={[6.8, 0.32, 0.32]} color={P.copper} rotation={[0, 0, side * 0.98]} />
      )))}
      <Box position={[0, 22, 0]} size={[7.8, 1.2, 7]} color={P.timberDark} />
      <mesh position={[-1.9, 21.8, 3.7]}><torusGeometry args={[2.35, 0.34, 7, 18]} /><Surf color={P.copper} /></mesh>
      <mesh position={[2.6, 21.8, 3.7]}><torusGeometry args={[2.35, 0.34, 7, 18]} /><Surf color={P.copper} /></mesh>
      {[-1.9, 2.6].flatMap((x) => [0, Math.PI / 3, -Math.PI / 3].map((r) => (
        <Box key={`${x}:${r}`} position={[x, 21.8, 3.72]} size={[0.18, 4.6, 0.18]} color={P.copper} rotation={[0, 0, r]} />
      )))}
      <Box position={[0, 0.4, 0]} size={[9.5, 0.8, 7.5]} color={P.strata} />
      <Box position={[0, 1.3, 0]} size={[4.2, 2.6, 4.2]} color={P.ink} />
      <Post x={0.2} y={2.4} z={2.8} h={19} r={0.11} color={P.copper} />
    </group>
  )
}

function Landmark({ stage, night }: { stage: ReturnType<typeof landmarkStage>; night: boolean }) {
  return (
    <group position={[118, 3, 65]}>
      <mesh position={[0, -1.5, 0]} castShadow><cylinderGeometry args={[8, 10, 3, 12]} /><Surf color={P.redRock} /></mesh>
      <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[8.1, 8.4, 0.24, 12]} /><Surf color={P.sand} /></mesh>
      {[0, 0.7, 1.3].map((y, i) => <mesh key={y} position={[-3.5, y + 0.3, 2]}><dodecahedronGeometry args={[1.2 - i * 0.2, 0]} /><Surf color={i % 2 ? P.strata : '#8b6a4a'} /></mesh>)}
      <Post x={-1} y={0} z={2.2} h={3} />
      {[-0.9, 0.9].map((x) => <Box key={x} position={[x, 1.5, -1]} size={[0.16, 3.5, 0.16]} color={P.timber} rotation={[0, 0, x > 0 ? -0.2 : 0.2]} />)}
      <Box position={[0, 3, -1]} size={[2.2, 0.22, 0.22]} color={P.oxblood} />
      {stage !== 'stake' && <Box position={[0, 3.5, -1]} size={[3.5, 0.18, 0.18]} color={P.timberDark} />}
      {(stage === 's2' || stage === 's3') && (
        <>
          {[-2.5, 2.5].flatMap((x) => [-2.5, 2.5].map((z) => <Post key={`${x}:${z}`} x={x} y={0} z={z} h={stage === 's3' ? 14 : 9} r={0.25} />))}
          <Box position={[0, stage === 's3' ? 13.5 : 8.5, 0]} size={[6.6, 0.5, 6.6]} color={P.timber} />
          <mesh position={[0, stage === 's3' ? 14.8 : 9.8, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[4.7, 2.2, 4]} /><Surf color={P.sage} /></mesh>
        </>
      )}
      {stage === 's3' && (
        <>
          {Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2
            return <Post key={i} x={Math.cos(a) * 6.2} y={0} z={Math.sin(a) * 6.2} h={4.2} r={0.22} />
          })}
          <Box position={[0, 14, 2.72]} size={[1.4, 1.2, 0.12]} color={night ? P.lamp : P.mustard} glow={night} />
          <Box position={[5, 1.8, 2]} size={[4.5, 3.6, 3.2]} color={P.teal} />
          <Post x={-5.5} y={0} z={0} h={12} />
          {night && <pointLight position={[0, 14, 3]} color={P.lamp} intensity={16} distance={40} />}
        </>
      )}
    </group>
  )
}

function BackdropSkyline({ night, fraction, haze = { near: 0, far: 0 } }: { night: boolean; fraction: number; haze?: { near: number; far: number } }) {
  const sky = backdropSkyline(fraction)
  const skyColour = night ? P.skyNight : P.sky
  return (
    <group>
      {sky.rows.map((b) => {
        const amount = b.row ? haze.far : haze.near
        return (
          <group key={`${b.row}:${b.index}`} position={[b.x, b.h / 2, b.z]}>
            <Box position={[0, 0, 0]} size={[b.w, b.h, b.d]} color={hazed(night ? (b.row ? '#3a2f45' : '#6f3f38') : b.row ? P.farRock : P.redRock, skyColour, amount)} />
            <Box position={[0, b.h / 2 - 1.1, 0]} size={[b.w + 0.5, 2.2, b.d + 0.5]} color={hazed(night ? '#8f684e' : P.sand, skyColour, amount)} />
            {!b.row && SKYLINE_STRATA.map((k) => <Box key={k} position={[0, -b.h / 2 + b.h * k, 12.15]} size={[b.w + 0.15, 0.7, 0.35]} color={hazed(P.strata, skyColour, amount)} />)}
          </group>
        )
      })}
      {/*
        The fog wings were made to fade into the 420 m side fog at the old yaw limits; they are out
        of frame from the overview. With the outer world (no fog wall, geography on every side) they
        would stand in the free camera's way as translucent boxes, so the outer mode retires them.
      */}
      {haze.near > 0
        ? null
        : sky.wings.map((w) => (
            <mesh key={`${w.side}:${w.index}`} position={[w.x, w.h / 2, w.z]} rotation={[0, w.yaw, 0]}>
              <boxGeometry args={[16, w.h, 28]} />
              <Surf color={night ? '#6f3f38' : P.redRock} transparent opacity={w.opacity} />
            </mesh>
          ))}
      {sky.spire && (
        <group position={[sky.spire.x, 0, sky.spire.z]}>
          <mesh position={[0, (sky.spire.h - 2.2) / 2, 0]} castShadow><cylinderGeometry args={[5, 11, sky.spire.h - 2.2, 8]} /><Surf color={hazed(night ? '#6f3f38' : P.redRock, skyColour, haze.near)} /></mesh>
          <Box position={[0, sky.spire.h - 2.2, 0]} size={[15, 2.2, 12]} color={hazed(night ? '#8f684e' : P.sand, skyColour, haze.near)} />
        </group>
      )}
    </group>
  )
}

function Arroyo() {
  const points = generateLayout(1).fixed.arroyo
  return (
    <group>
      {points.slice(1).map((p, i) => {
        const a = points[i]
        const dx = p[0] - a[0]
        const dz = p[1] - a[1]
        const len = Math.hypot(dx, dz)
        return <Box key={i} position={[(a[0] + p[0]) / 2, 0.08, (a[1] + p[1]) / 2]} size={[9, 0.16, len + 1]} color={P.paleGravel} rotation={[0, Math.atan2(dx, dz), 0]} />
      })}
      <mesh position={[-95, 0.18, 84]} scale={[11, 1, 8]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[1, 32]} /><Surf color={P.water} /></mesh>
    </group>
  )
}

function Rails() {
  return (
    <group>
      {[56, 62].map((x) => <Box key={x} position={[x, 0.28, 0]} size={[0.38, 0.38, 270]} color="#55483f" />)}
      {Array.from({ length: 54 }, (_, i) => <Box key={i} position={[59, 0.12, -132 + i * 5]} size={[11, 0.24, 0.6]} color={P.timberDark} />)}
      {TELEGRAPH_LINE.map((p, i) => <Post key={i} x={p.x} y={0} z={p.z} h={8} />)}
    </group>
  )
}

function Wagon({ position, yaw = 0 }: { position: [number, number, number]; yaw?: number }) {
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <Box position={[0, 1.2, 0]} size={[4.2, 1.4, 2.4]} color={P.timber} />
      {[-1.5, 1.5].flatMap((x) => [-1.2, 1.2].map((z) => (
        <mesh key={`${x}:${z}`} position={[x, 0.7, z]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.85, 0.14, 6, 12]} /><Surf color={P.timberDark} /></mesh>
      )))}
      {[-0.8, 0.8].map((x) => <Box key={x} position={[3.2, 0.9, x]} size={[2.7, 0.16, 0.16]} color={P.timberDark} rotation={[0, 0, -0.08]} />)}
    </group>
  )
}

function Trough({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Box position={[0, 0.55, 0]} size={[4.5, 1.1, 1.7]} color={P.timber} />
      <Box position={[0, 1.02, 0]} size={[3.9, 0.12, 1.2]} color={P.water} />
    </group>
  )
}

function Tumbleweed({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {[0, Math.PI / 3, -Math.PI / 3].map((r) => (
        <mesh key={r} rotation={[r, r * 0.7, r]}><torusGeometry args={[1.05, 0.09, 4, 9]} /><Surf color="#8f6848" /></mesh>
      ))}
    </group>
  )
}

function CivicHall({ night }: { night: boolean }) {
  return (
    <group>
      <Box position={[0, 4, 0]} size={[10, 8, 8]} color={P.canvas} />
      <Box position={[0, 8.8, 0]} size={[11, 1.6, 8.8]} color={P.oxblood} />
      <Box position={[0, 11.2, 0]} size={[4.6, 3.6, 4.6]} color={P.teal} />
      <mesh position={[0, 13.8, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[3.5, 2.2, 4]} /><Surf color={P.timberDark} /></mesh>
      <mesh position={[0, 11.4, 2.36]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.9, 0.9, 0.15, 16]} /><Surf color={night ? P.lamp : P.mustard} emissive={night ? P.lamp : '#000'} emissiveIntensity={night ? 1.2 : 0} /></mesh>
      {[-3.2, 3.2].map((x) => <Post key={x} x={x} y={0} z={4.2} h={4.4} r={0.2} />)}
      <Box position={[0, 4.3, 4.1]} size={[9, 0.28, 2.4]} color={P.timber} />
    </group>
  )
}

const SIDING: Record<Slot['color'], string> = { oxblood: P.oxblood, teal: P.teal, sage: P.sage, timber: P.timber }

function Town({ count, night }: { count: number; night: boolean }) {
  return (
    <group>
      <group position={[TOWN.waterTower.x, 0, TOWN.waterTower.z]}><WaterTower night={night} /></group>
      <Box position={[TOWN.road.x, 0.1, TOWN.road.z]} size={[TOWN.road.w, 0.2, TOWN.road.d]} color="#cfae78" />
      <Box position={[3, 0.25, -9.3]} size={[78, 0.5, 5.2]} color={P.timber} />
      <Box position={[3, 0.25, 9.3]} size={[78, 0.5, 5.2]} color={P.timber} />
      {TOWN.slots.slice(0, count).map((slot, i) => (
        <group key={i} position={[slot.x, 0, slot.z]} rotation={[0, slot.yaw, 0]}>
          <FalseFront position={[0, 0, 0]} color={SIDING[slot.color]} variant={slot.variant} night={night} />
        </group>
      ))}
      {TOWN.wagons.filter((w) => count >= w.minCount).map((w) => <Wagon key={`wagon${w.x}`} position={[w.x, 0, w.z]} yaw={w.yaw} />)}
      {TOWN.troughs.filter((t) => count >= t.minCount).map((t) => <Trough key={`trough${t.x}`} position={[t.x, 0, t.z]} />)}
      {count >= 12 && <>
        <group position={[TOWN.civicHall.x, 0, TOWN.civicHall.z]} scale={TOWN.civicHall.scale}><CivicHall night={night} /></group>
        {TOWN.sheds.map((s) => <Box key={`shed${s.x}`} position={[s.x, 1.7, s.z]} size={[5.4, 3.4, 4.6]} color={s.sage ? P.sage : P.timber} />)}
        {TOWN.hitches.map((h) => <group key={`hitch${h.x}`} position={[h.x, 0, h.z]}><Post x={-1.3} y={0} z={0} h={1.3} r={0.1} /><Post x={1.3} y={0} z={0} h={1.3} r={0.1} /><Box position={[0, 1.05, 0]} size={[2.8, 0.14, 0.14]} color={P.timberDark} /></group>)}
        {TOWN.lamps.map((l) => <group key={`lamp${l.x}`} position={[l.x, 0, l.z]}><Post x={0} y={0} z={0} h={3.7} r={0.09} /><Box position={[0, 3.8, 0]} size={[0.7, 0.7, 0.7]} color={night ? P.lamp : P.mustard} glow={night} /></group>)}
        {TOWN.horses.map((h) => <Animal key={`horse${h.x}`} position={[h.x, 0, h.z]} color={h.color} />)}
        {TOWN.tumbleweeds.map((t) => <Tumbleweed key={`tumble${t.x}`} position={[t.x, t.y, t.z]} scale={t.scale} />)}
        {TOWN.posts.map((p) => <Post key={p.x} x={p.x} y={0} z={p.z} h={1.6} r={0.1} />)}
      </>}
    </group>
  )
}

function RailwayDistrict({ count, night }: { count: number; night: boolean }) {
  return (
    <group>
      <Depot night={night} />
      <group position={[RAILWAY.waterCrane.x, 0, RAILWAY.waterCrane.z]}><WaterCrane /></group>
      <group position={[RAILWAY.signalMast.x, 0, RAILWAY.signalMast.z]}><SignalMast night={night} /></group>
      {count >= RAILWAY.crateStack.minCount && Array.from({ length: 8 }, (_, i) => <Box key={i} position={[17 + (i % 4) * 2.2, 0.65 + Math.floor(i / 4) * 1.2, 11 + (i % 2) * 2]} size={[1.9, 1.3, 1.9]} color={i % 3 ? P.timber : P.mustard} />)}
      {count >= RAILWAY.wagon.minCount && <Wagon position={[RAILWAY.wagon.x, 0, RAILWAY.wagon.z]} yaw={RAILWAY.wagon.yaw} />}
      {count >= RAILWAY.shed.minCount && <>
        <Box position={[RAILWAY.shed.x, 2.8, RAILWAY.shed.z]} size={[RAILWAY.shed.w, 5.6, RAILWAY.shed.d]} color={P.sage} />
        <Box position={[RAILWAY.shed.x, 6.2, RAILWAY.shed.z]} size={[RAILWAY.shed.w + 1, 1, RAILWAY.shed.d + 1]} color={P.timberDark} />
      </>}
      {count >= RAILWAY.caboose.minCount && <Box position={[RAILWAY.caboose.x, 1.8, RAILWAY.caboose.z]} size={[RAILWAY.caboose.w, 3.6, RAILWAY.caboose.d]} color={P.mustard} />}
    </group>
  )
}

function Ranch({ count }: { count: number }) {
  return (
    <group>
      <group position={[RANCH.windPump.x, 0, RANCH.windPump.z]}><WindPump /></group>
      {RANCH.corrals.filter((c) => count >= c.minCount).map((c) => <Corral key={`corral${c.x}`} position={[c.x, 0, c.z]} radius={c.radius} />)}
      {count >= RANCH.house.minCount && <group position={[RANCH.house.x, 0, RANCH.house.z]} scale={RANCH.house.scale}><FalseFront position={[0, 0, 0]} color={P.sage} variant="store" /></group>}
      {count >= RANCH.barn.minCount && <>
        <Box position={[RANCH.barn.x, 4.8, RANCH.barn.z]} size={[RANCH.barn.w, 9.6, RANCH.barn.d]} color={P.timber} />
        <mesh position={[RANCH.barn.x, 10.8, RANCH.barn.z]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[10.5, 3.6, 4]} /><Surf color={P.oxblood} /></mesh>
        <Box position={[3, 4.2, -14.92]} size={[6.4, 7.2, 0.22]} color={P.ink} />
        <Box position={[3, 4.2, -14.78]} size={[0.25, 7.2, 0.25]} color={P.canvas} />
        <Box position={[3, 4.2, -14.76]} size={[6.4, 0.25, 0.25]} color={P.canvas} rotation={[0, 0, 0.75]} />
        <Box position={[3, 4.2, -14.74]} size={[6.4, 0.25, 0.25]} color={P.canvas} rotation={[0, 0, -0.75]} />
      </>}
      {RANCH.fences.filter((f) => count >= f.minCount).map((f) => <FenceRun key={`fence${f.x}:${f.z}`} position={[f.x, 0, f.z]} length={f.length} yaw={f.yaw} />)}
      {RANCH.cattle.filter((a) => count >= a.minCount).map((a) => <Animal key={`cow${a.x}`} position={[a.x, 0, a.z]} color={a.color} horned={a.horned} />)}
      {RANCH.horses.filter((a) => count >= a.minCount).map((a) => <Animal key={`horse${a.x}`} position={[a.x, 0, a.z]} color={a.color} />)}
      {count >= 4 && <>
        <Wagon position={[RANCH.wagon.x, 0, RANCH.wagon.z]} yaw={RANCH.wagon.yaw} />
        <Trough position={[RANCH.trough.x, 0, RANCH.trough.z]} />
        {RANCH.hay.map((h) => <HayBale key={h.x} position={[h.x, 1.2, h.z]} />)}
        <group position={[RANCH.shed.x, 0, RANCH.shed.z]}><Box position={[0, 1.6, 0]} size={[RANCH.shed.w, 3.2, RANCH.shed.d]} color={P.sage} /><Box position={[0, 3.5, 0]} size={[RANCH.shed.w + 0.8, 0.7, RANCH.shed.d + 0.8]} color={P.timberDark} /></group>
      </>}
    </group>
  )
}

function Mine({ count, night }: { count: number; night: boolean }) {
  return (
    <group>
      <Box position={[MINE.rock.x, MINE.rock.h / 2, MINE.rock.z]} size={[MINE.rock.w, MINE.rock.h, MINE.rock.d]} color={P.redRock} />
      <mesh position={[MINE.adit.x, 3.6, MINE.adit.z]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[4.2, 1.8, 6, 14, Math.PI]} /><Surf color={P.ink} /></mesh>
      <group position={[MINE.headframe.x, 0, MINE.headframe.z]}><Headframe /></group>
      <Box position={[MINE.spur.x, 0.22, MINE.spur.z]} size={[MINE.spur.w, 0.25, MINE.spur.d]} color={P.timberDark} />
      <Box position={[-3.5, 0.22, 13]} size={[0.25, 0.25, 32]} color={P.copper} />
      <Box position={[-12.5, 0.22, 13]} size={[0.25, 0.25, 32]} color={P.copper} />
      {Array.from({ length: 9 }, (_, i) => <Box key={i} position={[-8, 0.17, -1 + i * 4]} size={[10, 0.18, 0.5]} color={P.timberDark} />)}
      {count >= 2 && <>
        <mesh position={[MINE.boiler.x, 4.5, MINE.boiler.z]}><cylinderGeometry args={[3, MINE.boiler.radius, 9, 12]} /><Surf color={P.copper} /></mesh>
        <Post x={MINE.boiler.x} y={8} z={MINE.boiler.z} h={7} r={0.6} color={P.ink} />
        <Box position={[MINE.shed.x, 3.2, MINE.shed.z]} size={[MINE.shed.w, 6.4, MINE.shed.d]} color={P.timber} />
      </>}
      {MINE.carts.filter((c) => count >= c.minCount).map((c) => <Box key={`cart${c.x}`} position={[c.x, 1.2, c.z]} size={[c.w, 2.4, c.d]} color={P.copper} />)}
      {MINE.tailings.filter((t) => count >= t.minCount).map((t, i) => <mesh key={`tail${t.x}`} position={[t.x, t.lift, t.z]}><coneGeometry args={[t.radius, t.h, 8]} /><Surf color={i % 2 ? P.strata : '#9e724b'} /></mesh>)}
      {MINE.tents.filter((t) => count >= t.minCount).map((t) => <group key={`tent${t.x}`} position={[t.x, 0, t.z]}><mesh position={[0, 1.8, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[3.8, 3.6, 4]} /><Surf color={P.canvas} /></mesh>{night && <pointLight position={[0, 2, 2]} intensity={2} color={P.lamp} />}</group>)}
      {count >= MINE.assay.minCount && <Box position={[MINE.assay.x, 2.8, MINE.assay.z]} size={[MINE.assay.w, 5.6, MINE.assay.d]} color={P.sage} />}
    </group>
  )
}

function Foundation({ position, size, buried = false }: { position: [number, number, number]; size: [number, number]; buried?: boolean }) {
  const [w, d] = size
  const y = buried ? 0.35 : 0.7
  return (
    <group position={position}>
      <Box position={[0, 0.06, 0]} size={[w - 1, 0.12, d - 1]} color="#9a704d" />
      <Box position={[0, y, -d / 2]} size={[w, y * 2, 0.8]} color={P.strata} />
      <Box position={[0, y, d / 2]} size={[w, y * 2, 0.8]} color={P.strata} />
      <Box position={[-w / 2, y, 0]} size={[0.8, y * 2, d]} color={P.redRock} />
      <Box position={[w / 2, y, 0]} size={[0.8, y * 2, d]} color={P.redRock} />
      {w > 13 && <Box position={[0, y, 0]} size={[0.7, y * 2, d]} color={P.strata} />}
    </group>
  )
}

function ExcavationTrench({ position, size }: { position: [number, number, number]; size: [number, number] }) {
  const [w, d] = size
  return (
    <group position={position}>
      <Box position={[0, 0.08, 0]} size={[w, 0.16, d]} color="#6f4f39" />
      <Box position={[0, 0.23, 0]} size={[w - 1.4, 0.12, d - 1.4]} color="#b1845b" />
      {[-w / 2, w / 2].map((x) => <Box key={x} position={[x, 0.7, 0]} size={[0.55, 1.4, d]} color={P.strata} />)}
      {[-d / 2, d / 2].map((z) => <Box key={z} position={[0, 0.7, z]} size={[w, 1.4, 0.55]} color={P.redRock} />)}
      {[-w / 2, 0, w / 2].map((x) => <Post key={x} x={x} y={0} z={-d / 2 - 0.5} h={2.3} r={0.07} />)}
      {[-d / 2, 0, d / 2].map((z) => <Box key={z} position={[0, 2.05, z]} size={[w + 1.2, 0.05, 0.05]} color={P.canvas} />)}
      {[-w / 3, w / 3].map((x) => <Box key={x} position={[x, 2.05, 0]} size={[0.05, 0.05, d + 1.2]} color={P.canvas} />)}
      <Box position={[-w * 0.22, 0.42, 0]} size={[w * 0.45, 0.16, 0.8]} color={P.canvas} />
      <mesh position={[w * 0.2, 0.48, d * 0.12]}><torusGeometry args={[0.55, 0.16, 5, 8, Math.PI * 1.45]} /><Surf color={P.copper} /></mesh>
    </group>
  )
}

function Dig({ count }: { count: number }) {
  return (
    <group>
      {DIG.foundations.filter((f) => count >= f.minCount).map((f) => <Foundation key={`found${f.x}:${f.z}`} position={[f.x, 0, f.z]} size={[f.w, f.d]} buried={f.buried} />)}
      {DIG.trenches.map((t, i) => <ExcavationTrench key={i} position={[t.x, 0, t.z]} size={[t.w, t.d]} />)}
      {DIG.tents.filter((t) => count >= t.minCount).map((t) => <group key={`tent${t.x}`} position={[t.x, 0, t.z]}><mesh position={[0, 2.2, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[5, 4.4, 4]} /><Surf color={P.canvas} /></mesh><Post x={0} y={0} z={0} h={5.5} r={0.1} /></group>)}
      {count >= DIG.table.minCount && <>
        <Box position={[DIG.table.x, 1.2, DIG.table.z]} size={[DIG.table.w, 2.4, DIG.table.d]} color={P.timber} />
        {DIG.crates.map((c) => <Box key={c.x} position={[c.x, 0.65, c.z]} size={[c.w, 1.3, c.d]} color={P.timber} />)}
      </>}
      {count >= DIG.scaffold.minCount && <group position={[DIG.scaffold.x, 0, DIG.scaffold.z]}>{DIG.scaffold.legs.flatMap((x) => DIG.scaffold.legsZ.map((z) => <Post key={`${x}:${z}`} x={x} y={0} z={z} h={7} />))}<Box position={[0, 6.7, 0]} size={[11, 0.35, 7]} color={P.timber} />{[2, 4].map((y) => <Box key={y} position={[0, y, 3]} size={[10, 0.16, 0.16]} color={P.timberDark} />)}</group>}
      {count >= 8 && <>
        {DIG.spoil.map((s) => <mesh key={s.x} position={[s.x, s.lift, s.z]}><coneGeometry args={[s.radius, s.h, 8]} /><Surf color="#a87952" /></mesh>)}
        <group position={[DIG.sortingTable.x, 0, DIG.sortingTable.z]}><Box position={[0, 1.2, 0]} size={[DIG.sortingTable.w, 0.28, DIG.sortingTable.d]} color={P.timber} />{[-1.7, 1.7].flatMap((x) => [-1.1, 1.1].map((z) => <Post key={`${x}:${z}`} x={x} y={0} z={z} h={1.2} r={0.1} />))}</group>
        {DIG.barrels.map((b, i) => <mesh key={b.x} position={[b.x, 0.55, b.z]}><cylinderGeometry args={[b.radius, 0.32, 1.1, 8]} /><Surf color={i % 2 ? P.oxblood : P.copper} /></mesh>)}
        <Wagon position={[DIG.wagon.x, 0, DIG.wagon.z]} yaw={DIG.wagon.yaw} />
      </>}
    </group>
  )
}

function Reserve({ seed, count, wildlife }: { seed: number; count: number; wildlife: boolean }) {
  const items = useMemo(() => reserveItems(seed), [seed])
  return (
    <group>
      {RESERVE.cacti.map((c) => <Cactus key={c.x} position={[c.x, 0, c.z]} scale={c.scale} />)}
      {items.map((c, i) => {
        const minCount = reserveItemMinCount(c.kind)
        if (minCount === null || count < minCount) return null
        if (c.kind === 0) return <Cactus key={i} position={[c.x, 0, c.z]} scale={c.s} />
        if (c.kind === 1 || c.kind === 2) return <PricklyPear key={i} position={[c.x, 0, c.z]} scale={c.s} />
        if (c.kind === 3 || c.kind === 4) return <Scrub key={i} position={[c.x, 0, c.z]} scale={c.s} />
        if (c.kind === 5 || c.kind === 6) return <RockOutcrop key={i} position={[c.x, 0, c.z]} scale={c.s * 0.8} />
        return <Tumbleweed key={i} position={[c.x, c.s, c.z]} scale={c.s * 0.7} />
      })}
      <group position={[RESERVE.tank.x, 0, RESERVE.tank.z]}>
        <mesh position={[0, 5, 0]}><cylinderGeometry args={[5, RESERVE.tank.radius, 8, 12]} /><Surf color={P.timber} /></mesh>
        {[-3.5, 3.5].flatMap((x) => [-3.5, 3.5].map((z) => <Post key={`${x}:${z}`} x={x} y={0} z={z} h={5} r={0.2} />))}
      </group>
      {RESERVE.telegraph.map((p) => <group key={p.z} position={[p.x, 0, p.z]}><Post x={0} y={0} z={0} h={9} /><Box position={[0, 8.3, 0]} size={[5.2, 0.28, 0.28]} color={P.timberDark} /></group>)}
      {[-1.3, 0, 1.3].map((x) => <Box key={x} position={[-28 + x, 8.5, -7]} size={[0.08, 0.08, 170]} color={P.timberDark} />)}
      {wildlife && count >= 1 && RESERVE.wildlife.map((a, i) => <Animal key={i} position={[a.x, 0, a.z]} color={a.color} />)}
      {count >= 3 && RESERVE.burrows.map((b, i) => <mesh key={i} position={[b.x, 0.12, b.z]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.3, 3.2, 12]} /><Surf color="#79583e" /></mesh>)}
      {count >= 4 && <>
        <group position={[RESERVE.formation.x, 0, RESERVE.formation.z]}>
          <mesh position={[-4, 6, 0]} scale={[2.8, 6, 2.2]}><dodecahedronGeometry args={[1, 0]} /><Surf color={P.redRock} /></mesh>
          <mesh position={[4, 7.5, 0]} scale={[2.5, 7.5, 2]}><dodecahedronGeometry args={[1, 0]} /><Surf color={P.strata} /></mesh>
          <Box position={[0, 10.8, 0]} size={[7.5, 2.1, 3.2]} color={P.redRock} />
        </group>
        <group position={[RESERVE.stack.x, 0, RESERVE.stack.z]}>
          {[0, 4, 8].map((y, i) => <mesh key={y} position={[0, y * 0.8 + 1.5, 0]} scale={[5 - i * 0.7, 1.5, 4 - i * 0.5]}><dodecahedronGeometry args={[1, 0]} /><Surf color={i % 2 ? P.strata : P.redRock} /></mesh>)}
        </group>
        {RESERVE.washes.map((w) => <group key={w.z} position={[w.x, 0, w.z]}><Box position={[0, 0.09, 0]} size={[13, 0.18, 4.2]} color={P.paleGravel} /><PricklyPear position={[-4, 0, 1]} scale={0.8} /><Scrub position={[4, 0, -1]} scale={0.9} /></group>)}
      </>}
    </group>
  )
}

function FrontierWalker({ index, bodies, night }: { index: number; bodies: React.RefObject<FrontierWalkerBody[]>; night: boolean }) {
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    const root = group.current
    const body = bodies.current?.[index]
    if (!root) return
    if (!body) {
      root.visible = false
      return
    }
    root.visible = true
    root.position.set(body.x, 0, body.z)
    // Headings are atan2(dz, dx); the mesh faces +z, so rotation.y = atan2(dirX, dirZ).
    root.rotation.y = Math.atan2(Math.cos(body.heading), Math.sin(body.heading))
  })
  return (
    <group ref={group} scale={L.creatureScale} visible={false}>
      <mesh position={[0, 0.65, 0]} castShadow><dodecahedronGeometry args={[0.52, 0]} /><Surf color={index % 2 ? P.canvas : P.teal} /></mesh>
      <mesh position={[0, 1.32, 0]} castShadow><icosahedronGeometry args={[0.38, 1]} /><Surf color={P.canvas} /></mesh>
      <mesh position={[0, 1.7, 0]} castShadow><cylinderGeometry args={[0.52, 0.42, 0.25, 10]} /><Surf color={index % 3 ? P.oxblood : P.mustard} /></mesh>
      <mesh position={[0, 1.93, 0]} castShadow><cylinderGeometry args={[0.31, 0.38, 0.5, 8]} /><Surf color={index % 3 ? P.oxblood : P.mustard} /></mesh>
      {night && <pointLight position={[0, 1.4, 0.7]} intensity={0.4} color={P.lamp} />}
    </group>
  )
}

/** Frames the collider registry must hold still before the first bodies are placed. */
const SETTLE_FRAMES = 2

/**
 * The residents: one deterministic simulation (`stepWalkers`) runs once per frame at priority −1,
 * before the figures read their bodies. Each body steers round the registered colliders, sweeps
 * its circle and is kept apart from the others (scene/walkers.ts).
 */
function Creatures({ generated, residents, night }: { generated: ReturnType<typeof generateLayout>; residents: number; night: boolean }) {
  const registry = useColliderRegistry()
  const colliders = useColliderSet()
  const bodies = useRef<FrontierWalkerBody[]>([])
  const settle = useRef({ version: -1, frames: 0 })

  useEffect(() => {
    registry.setAgents('frontier-walkers', bodies.current)
    return () => registry.clearAgents('frontier-walkers')
  }, [registry])

  useEffect(() => {
    // Rebuild the cast when the layout re-rolls so homes follow the districts.
    bodies.current.length = 0
  }, [generated])

  useFrame(({ clock }, dt) => {
    const set = colliders.current
    const list = bodies.current
    if (registry.version !== settle.current.version) {
      settle.current.version = registry.version
      settle.current.frames = 0
    } else settle.current.frames += 1
    if (list.length === 0 && settle.current.frames < SETTLE_FRAMES) return
    if (list.length !== residents) {
      list.length = 0
      list.push(...createWalkers(generated, set, residents))
    }
    if (list.length === 0) return
    stepWalkers(list, set, clock.elapsedTime, dt)
  }, -1)

  return (
    <group name="frontier-walkers">
      {Array.from({ length: residents }, (_, i) => (
        <FrontierWalker key={i} index={i} bodies={bodies} night={night} />
      ))}
    </group>
  )
}

/** Registers every footprint derived from the placement data (the same rows the meshes map over). */
function Colliders({ generated, progress, wildlife }: { generated: ReturnType<typeof generateLayout>; progress: LabState['progress']; wildlife: boolean }) {
  const shapes = useMemo(() => frontierColliders(generated, progress, wildlife), [generated, progress, wildlife])
  useCollider(shapes)
  const registry = useColliderRegistry()
  useEffect(() => {
    // A future character (or a dev console) can read the live set without the `?colliders=1` flag.
    window.__colliders = {
      count: () => registry.count(),
      penetration: (x, z, r) => registry.penetration(x, z, r),
      shapes: () => registry.shapes(),
      version: () => registry.version,
    }
    return () => {
      delete window.__colliders
    }
  }, [registry])
  return null
}

declare global {
  interface Window {
    __colliders?: ColliderDevHook
  }
}

function Dust({ dense = false }: { dense?: boolean }) {
  const particles = useMemo(() => {
    const rng = seeded(144)
    return Array.from({ length: dense ? 180 : 80 }, () => [rng() * 330 - 165, rng() * 16 + 1, rng() * 260 - 130] as [number, number, number])
  }, [dense])
  return (
    <group>
      {particles.map((p, i) => <mesh key={i} position={p} scale={0.2 + (i % 3) * 0.12}><dodecahedronGeometry args={[1, 0]} /><meshBasicMaterial color={P.paleGravel} transparent opacity={0.35} /></mesh>)}
    </group>
  )
}

/** Linear fog near / far per mode: the dust storm, the slab as shipped (420 m wall), or the outer world's aerial perspective. */
export function fogRange(state: Pick<LabState, 'edge' | 'night' | 'catastrophe'>): [number, number] {
  if (state.catastrophe.phase === 'dust') return [70, 210]
  if (state.edge === 'outer') {
    const fog = state.night ? DESERT_FOG.night : DESERT_FOG.day
    return [fog.near, fog.far]
  }
  return [190, 420]
}

export function FrontierScene({ state, onPickDistrict }: { state: LabState; onPickDistrict: (id: string) => void }) {
  const generated = useMemo(() => generateLayout(state.seed), [state.seed])
  const fraction = courseProgress(state.progress)
  const ruin = state.catastrophe.phase === 'ruin' || state.catastrophe.phase === 'impact'
  const sky = state.night ? P.skyNight : state.catastrophe.phase === 'dust' ? '#b69062' : P.sky
  const outer = state.edge === 'outer'
  const [fogNear, fogFar] = fogRange(state)
  const reducedMotion = state.reducedMotion ?? false
  const desert = useMemo(() => (outer ? createOuterDesert(state.seed) : null), [outer, state.seed])
  // What the free camera must stay above: the outer heightfield and the authored skyline boxes.
  const cameraGround = useMemo(
    () => (x: number, z: number) => Math.max(desert ? desert.heightAt(x, z) : 0, backdropWallHeightAt(x, z, fraction)),
    [desert, fraction],
  )
  return (
    <ColliderProvider>
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, fogNear, fogFar]} />
      <hemisphereLight args={[state.night ? '#59618a' : '#fff0ce', state.night ? '#281d28' : '#9f5c3d', state.night ? 0.7 : 0.9]} />
      <directionalLight position={state.night ? [-80, 75, 40] : [95, 88, 125]} intensity={state.night ? 1.2 : 2.5} color={state.night ? '#91a7d8' : '#ffe4b5'} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-190} shadow-camera-right={190} shadow-camera-top={170} shadow-camera-bottom={-170} />

      {outer && desert ? (
        <Outer desert={desert} night={state.night} reducedMotion={reducedMotion} />
      ) : (
        <mesh position={[0, -0.35, 150]} receiveShadow><boxGeometry args={[520, 0.7, 800]} /><Surf color={state.night ? '#7f5f4d' : P.sand} /></mesh>
      )}
      <BackdropSkyline night={state.night} fraction={fraction} haze={outer ? SKYLINE_HAZE : undefined} />
      <Arroyo />
      <Rails />
      <Train active={state.train} night={state.night} />

      {generated.districts.map((district) => {
        const pop = populationFor(district, state.progress[district.id] ?? 0)
        const broken = ruin && state.catastrophe.districtId === district.id
        return (
          <group
            key={district.id}
            position={[district.center[0], broken ? -0.6 : 0, district.center[1]]}
            rotation={[broken ? 0.05 : 0, district.yaw, broken ? 0.06 : 0]}
            onClick={(event) => { event.stopPropagation(); onPickDistrict(district.id) }}
          >
            {district.id === 'main-town' && <Town count={pop.buildings} night={state.night && !broken} />}
            {district.id === 'railway-station' && <RailwayDistrict count={pop.buildings} night={state.night && !broken} />}
            {district.id === 'outskirts-reserve' && <Reserve seed={state.seed} count={pop.buildings} wildlife={state.wildlife} />}
            {district.id === 'broad-ranch' && <Ranch count={pop.buildings} />}
            {district.id === 'mine-works' && <Mine count={pop.buildings} night={state.night && !broken} />}
            {district.id === 'archaeology-dig' && <Dig count={pop.buildings} />}
          </group>
        )
      })}

      <Landmark stage={landmarkStage(fraction)} night={state.night} />
      <Colliders generated={generated} progress={state.progress} wildlife={state.wildlife} />
      <Creatures generated={generated} residents={state.residents} night={state.night} />
      <ColliderDebug groundAt={() => 0} />
      {state.dust && <Dust dense={state.catastrophe.phase === 'dust'} />}
      {state.night && (outer ? <DreiStars radius={1900} depth={300} count={2500} factor={14} saturation={0.25} fade speed={0.2} /> : <DreiStars radius={280} depth={80} count={2500} factor={4} saturation={0.25} fade speed={0.2} />)}
      {ruin && state.catastrophe.districtId && <pointLight position={[0, 12, 0]} color="#c34e32" intensity={6} distance={70} />}
      <FreeCameraRig state={state} generated={generated} poseId={state.pose ?? null} custom={state.customCamera ?? null} readyKey={state.edge ?? 'outer'} groundAt={cameraGround} />
      <EdgeLabOverlay />
      {state.pixel && <PixelComposer />}
    </ColliderProvider>
  )
}
