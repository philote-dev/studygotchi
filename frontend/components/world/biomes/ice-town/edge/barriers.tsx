import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ICE_TOWN_PALETTE as P } from '../layout/biome-layout'
import { Surf } from '../render/materials'
import { type Floe, type Vista, barrierPlan } from './barriers/geography'
import { type VistaBuild, buildApron, buildFloeGeometry, buildRing, buildVista } from './barriers/build'
import { type OuterWorldOptions, createOuterWorld } from './endless/outer-world'
import type { EdgeSceneProps, EdgeTechnique } from './types'
import { landSpan } from '@/lib/world/land-marks'

/**
 * Barriers and vistas: the land is enclosed by a fjord ring of faceted ice (cliffs, spires, sea
 * stacks, tabular bergs, one gate) standing 225–320 m out in open water, and four composed gaps
 * in that ring, one per outward pose, each framing a distant place you can see but never reach.
 * The sea beyond is hazed to a far fog line and salted with a sparse floe field for scale. The
 * back land is continued past the terrain plate on its own heightfield so no plate edge shows.
 * Everything merges into ~13 draw calls; one `useFrame` drives the far lighthouse sweep and the
 * icebreaker's plume.
 */

const LAMP: Record<Vista['light'], string> = { warm: P.light, cyan: P.crystal }
const LAMP_OFF = '#8d93a6'
const SWEEP_SPEED = 0.32
const PLUME_PUFFS = 7

/** Owns a built geometry: disposes the old one when the inputs change or the scene unmounts. */
function useBuilt<T extends THREE.BufferGeometry>(build: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(build, deps)
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

function FloeField({ floes, seaLevel, night }: { floes: Floe[]; seaLevel: number; night: boolean }) {
  const geometry = useBuilt(() => buildFloeGeometry(night), [night])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    floes.forEach(([x, z, r, yaw], i) => {
      dummy.position.set(x, seaLevel + 0.1, z)
      dummy.rotation.set(0, yaw, 0)
      dummy.scale.set(r, 1, r)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.count = floes.length
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [floes, seaLevel, dummy])
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, floes.length]} frustumCulled={false}>
      <Surf color="#ffffff" vertexColors />
    </instancedMesh>
  )
}

interface Motion {
  sweep: THREE.Group | null
  plume: THREE.InstancedMesh | null
  funnel: [number, number, number]
}

/** One frame loop for everything that moves: the far lighthouse's sweep and the icebreaker's smoke. */
function BarrierMotion({ motion, reducedMotion }: { motion: React.MutableRefObject<Motion>; reducedMotion: boolean }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const settled = useRef(false)
  useFrame(({ clock }) => {
    const t = reducedMotion ? 0 : clock.elapsedTime
    const { sweep, plume, funnel } = motion.current
    if (sweep) sweep.rotation.y = t * SWEEP_SPEED + 0.8
    if (plume) {
      if (reducedMotion && settled.current) return
      for (let i = 0; i < PLUME_PUFFS; i++) {
        const k = (t * 0.085 + i / PLUME_PUFFS) % 1
        // Rise, drift downwind along the hull, grow, then thin out and vanish.
        dummy.position.set(funnel[0] - k * 34, funnel[1] + 2 + k * 24, funnel[2] - k * 6)
        const size = (2.4 + k * 6.5) * Math.min(1, (1 - k) * 5)
        dummy.scale.setScalar(Math.max(0.001, size))
        dummy.rotation.set(k * 2, i, k)
        dummy.updateMatrix()
        plume.setMatrixAt(i, dummy.matrix)
      }
      plume.instanceMatrix.needsUpdate = true
      settled.current = reducedMotion
    }
  })
  return null
}

function Landmark({ vista, night, seed, motion }: { vista: Vista; night: boolean; seed: number; motion: React.MutableRefObject<Motion> }) {
  const built: VistaBuild = useMemo(() => landSpan(`vista-${vista.id}`, () => buildVista(vista, night, seed)), [vista, night, seed])
  useEffect(() => () => built.geometry.dispose(), [built])
  const lamp = LAMP[vista.light]
  const sweep = vista.kind === 'lighthouse'
  const plume = vista.kind === 'icebreaker'
  useEffect(() => {
    if (plume && built.funnel) motion.current.funnel = built.funnel
  }, [plume, built, motion])
  return (
    <group position={[vista.x, vista.seatY ?? 0, vista.z]} rotation={[0, vista.yaw, 0]}>
      <mesh geometry={built.geometry}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      <mesh position={built.lamp}>
        <sphereGeometry args={[built.lampRadius, 7, 5]} />
        <Surf color={night ? lamp : LAMP_OFF} emissive={lamp} emissiveIntensity={night ? 2.4 : 0} />
      </mesh>
      {sweep && (
        <group
          position={built.lamp}
          ref={(g) => {
            motion.current.sweep = g
          }}
        >
          {night && (
            <mesh position={[0, 0, 23]} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[3.2, 46, 8, 1, true]} />
              <meshBasicMaterial color={lamp} transparent opacity={0.17} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          )}
        </group>
      )}
      {plume && (
        <instancedMesh
          args={[undefined, undefined, PLUME_PUFFS]}
          frustumCulled={false}
          ref={(m) => {
            motion.current.plume = m
          }}
        >
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={night ? '#6c6878' : '#cfc9d8'} />
        </instancedMesh>
      )}
    </group>
  )
}

export interface BarriersSceneProps extends EdgeSceneProps {
  /** The snow apron that continues the back land past the plate edge; off when the shelf provides that land. */
  apron?: boolean
  /** The mid and far floe fields; off when the shelf's pack ice and drift floes are there. */
  floes?: boolean
  /**
   * Seat the ring and vistas on the endless shelf (pack ice, leads, its outer mountain rows). Pass
   * the same `OuterWorldOptions` the shelf is built with so both read one heightfield; `true` uses
   * the shelf's defaults. Defaults to "the apron is off", which is how a combination signals that
   * the shelf is present.
   */
  shelf?: boolean | OuterWorldOptions
}

function ApronMesh({ layout, plan, night }: { layout: BarriersSceneProps['layout']; plan: ReturnType<typeof barrierPlan>; night: boolean }) {
  const apron = useBuilt(() => buildApron(layout, plan.apron, night), [layout, plan.apron, night])
  return (
    <mesh geometry={apron}>
      <Surf color="#ffffff" vertexColors />
    </mesh>
  )
}

/**
 * The barriers as a composable scene: the combined technique renders this beside the endless shelf
 * with `apron={false} floes={false}`, which also seats every wall on the shelf's ice.
 */
export function BarriersScene({ layout, night, seed, reducedMotion, apron = true, floes = true, shelf }: BarriersSceneProps) {
  const onShelf = shelf ?? !apron
  const options = typeof onShelf === 'object' ? onShelf : null
  const world = useMemo(() => (onShelf ? landSpan('outer-world', () => createOuterWorld(layout, seed, options ?? {})) : null), [onShelf, options, layout, seed])
  const plan = useMemo(() => landSpan('barrier-plan', () => barrierPlan(layout, seed, { shelf: world })), [layout, seed, world])
  const ring = useBuilt(() => landSpan('barrier-ring', () => buildRing(plan, seed, night)), [plan, seed, night])
  const floeList = useMemo(() => [...plan.floes.mid, ...plan.floes.far], [plan])
  const motion = useRef<Motion>({ sweep: null, plume: null, funnel: [0, 0, 0] })
  return (
    <group name="edge-barriers">
      <mesh geometry={ring} frustumCulled={false}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      {apron && <ApronMesh layout={layout} plan={plan} night={night} />}
      {floes && <FloeField floes={floeList} seaLevel={layout.seaLevel} night={night} />}
      {plan.vistas.map((vista) => (
        <Landmark key={vista.id} vista={vista} night={night} seed={seed} motion={motion} />
      ))}
      <BarrierMotion motion={motion} reducedMotion={reducedMotion} />
    </group>
  )
}

function Scene(props: EdgeSceneProps) {
  return <BarriersScene {...props} />
}

export const barriers: EdgeTechnique = {
  id: 'barriers',
  name: 'Barriers and vistas',
  lineage: "Skyrim's mountain walls, Journey's dunes, God of War's framed vistas, Zelda's distant unreachable landmarks",
  pitch:
    'The land is fenced by geography, not by a fog line: a fjord ring of faceted ice cliffs, spires, sea stacks and ' +
    'a tabular berg the size of the town stands 225–320 m out in open water, roots under the sea, heights uneven so it ' +
    'reads as a coast. Four composed gaps in the ring sit on the four outward poses: north, a far ridge with an ' +
    'observatory dome in the notch of the range; east, a second, darker lighthouse island whose lamp sweeps slowly; ' +
    'south, through a 56 m ice gate, an icebreaker trailing smoke; west, an ice cathedral with a frozen cascade. Each ' +
    'is a place you can see but never reach, hazed by a far fog line and given scale by a sparse floe field. The back ' +
    'land is continued past the terrain plate so the plate edge never shows. At night every vista has exactly one ' +
    'light; the walls stay dark.',
  Scene,
  sky: (grade, { night, storm }) => {
    if (storm) return grade
    // Horizon haze: push the fog out so the sea between the walls and the sky is not a flat disc,
    // while the vistas at 320–400 m keep a readable 10–20 % veil.
    return { ...grade, fogNear: night ? 230 : 250, fogFar: night ? 1050 : 1200 }
  },
}
