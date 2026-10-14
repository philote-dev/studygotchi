import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { FRONTIER_PALETTE as P } from '../layout/biome-layout'
import { Surf } from '../render/materials'
import type { OuterDesert } from './outer/desert'
import { type Built, buildMast, buildMesaTown, buildMission, buildTrain, buildTrestle } from './outer/structures'
import type { Vista } from './outer/vistas'
import type { OuterMotionRefs } from './motion'

/**
 * The four places you can see but never reach, one per window, each with exactly one light at
 * night: the mesa settlement's water-tower lamp, the far train's headlamp, the mission's belfry
 * lantern, the mast's red beacon. The train and the beacon register with the single outer motion
 * loop (Outer.tsx); nothing here runs its own frame callback.
 */

const LAMP: Record<Vista['light'], string> = { warm: P.lamp, red: '#ff4a2e' }
const LAMP_OFF: Record<Vista['light'], string> = { warm: '#a9a39a', red: '#8a3a30' }

/** Metres past the rail yard's centre (away from the trestle) where the line starts inside the engine shed. */
export const YARD_SHED_START = 66

function useBuilt(build: () => Built, deps: unknown[]): Built {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(build, deps)
  useEffect(() => () => built.geometry.dispose(), [built])
  return built
}

function Lamp({ position, radius, light, night, materialRef }: { position: [number, number, number]; radius: number; light: Vista['light']; night: boolean; materialRef?: React.Ref<THREE.MeshToonMaterial> }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[radius, 7, 5]} />
      <meshToonMaterial ref={materialRef} color={night ? LAMP[light] : LAMP_OFF[light]} emissive={LAMP[light]} emissiveIntensity={night ? 2.2 : 0} />
    </mesh>
  )
}

function Static({ vista, built, night }: { vista: Vista; built: Built; night: boolean }) {
  return (
    <group position={[vista.x, vista.base, vista.z]} rotation={[0, vista.yaw, 0]}>
      <mesh geometry={built.geometry}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      <Lamp position={built.lamp} radius={built.lampRadius} light={vista.light} night={night} />
    </group>
  )
}

export function Vistas({ desert, night, motion }: { desert: OuterDesert; night: boolean; motion: React.MutableRefObject<OuterMotionRefs> }) {
  const byId = (id: Vista['id']) => desert.vistas.find((v) => v.id === id)!
  const north = byId('north')
  const east = byId('east')
  const south = byId('south')
  const west = byId('west')

  const town = useBuilt(() => buildMesaTown(night), [night])
  const mission = useBuilt(() => buildMission(night), [night])
  const mast = useBuilt(() => buildMast(west.height, night), [night, west.height])
  const train = useBuilt(() => buildTrain(night), [night])
  // The line starts inside the rail yard's engine shed (when the yard exists) and ends in the portal.
  const yardStart = useMemo<[number, number] | undefined>(() => {
    const yard = desert.places.find((p) => p.kind === 'rail-yard')
    if (!yard) return undefined
    const b = (desert.trestle.bearingDeg * Math.PI) / 180
    return [yard.x + Math.sin(b) * YARD_SHED_START, yard.z + Math.cos(b) * YARD_SHED_START]
  }, [desert])
  const trestle = useMemo(() => buildTrestle(desert, desert.trestle, night, yardStart), [desert, night, yardStart])
  useEffect(() => () => trestle.geometry.dispose(), [trestle])

  const run = useMemo(() => {
    const dx = trestle.runEnd[0] - trestle.runStart[0]
    const dz = trestle.runEnd[1] - trestle.runStart[1]
    const length = Math.hypot(dx, dz)
    return { built: trestle, length, dx: dx / length, dz: dz / length, yaw: Math.atan2(dx, dz) }
  }, [trestle])

  useEffect(() => {
    motion.current.trainRun = run
  }, [motion, run])

  return (
    <group name="edge-vistas">
      <Static vista={north} built={town} night={night} />
      <Static vista={south} built={mission} night={night} />
      <group position={[west.x, west.base, west.z]} rotation={[0, west.yaw, 0]}>
        <mesh geometry={mast.geometry}>
          <Surf color="#ffffff" vertexColors />
        </mesh>
        <Lamp
          position={mast.lamp}
          radius={mast.lampRadius}
          light="red"
          night={night}
          materialRef={(mat) => {
            motion.current.beacon = mat
          }}
        />
      </group>
      <mesh geometry={trestle.geometry}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      <group
        ref={(g) => {
          motion.current.train = g
        }}
        position={[trestle.runStart[0], trestle.deckY + 0.5, trestle.runStart[1]]}
        rotation={[0, run.yaw, 0]}
      >
        <mesh geometry={train.geometry}>
          <Surf color="#ffffff" vertexColors />
        </mesh>
        <Lamp position={train.lamp} radius={train.lampRadius} light={east.light} night={night} />
      </group>
    </group>
  )
}
