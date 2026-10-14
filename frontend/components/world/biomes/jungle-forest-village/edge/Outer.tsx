'use client'

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { JUNGLE_PALETTE as P } from '../layout/jungle-layout'
import { Surf } from '../render/materials'
import type { BarrierPlan } from './barriers/geography'
import {
  type VistaBuild,
  buildVista,
  buildWall,
  curtainGeometry,
  domeGeometry,
  farDomeGeometry,
  palmCrownGeometry,
  sheetGeometry,
  trunkGeometry,
} from './barriers/build'
import { type OuterWorld, createOuterWorld, mistColour } from './outer/heightfield'
import { type RibbonData, buildRiver } from './outer/river'
import { type OuterGrade, buildOuterMeshes, recolourGeometry, ringGeometry } from './outer/rings'
import { canopyDomes, mistCurtains, palms, ridgeFalls } from './outer/scatter'
import { Places, type PlacesMotion, stepPlaces } from './Places'

/**
 * The expansive jungle beyond the plate: the endless continuation (LOD rings of rolling canopy
 * into four hazed ridge rows, the river as a silver thread to a delta and a hazy sea, instanced
 * canopy domes and palms thinning with distance, white falls on the far ridges, mist curtains in
 * the valleys) composed with the barriers (a wall of fall cliffs and buttress-root trees round
 * the village) and four vista windows (temple, delta, rope bridge, volcano), one light each at
 * night. One `useFrame` drives everything that moves; nothing allocates per frame.
 */

const dummy = new THREE.Object3D()
const scratch = new THREE.Color()
const scratchMist = new THREE.Color()
const PLUME_PUFFS = 9
const SWAY_AXIS = new THREE.Vector3()

interface OuterProps {
  seed: number
  night: boolean
  reducedMotion: boolean
}

function hazed(base: string, haze: number, night: boolean): THREE.Color {
  scratch.set(base)
  if (night) scratch.offsetHSL(0.02, -0.08, -0.2)
  return scratch.lerp(scratchMist.set(mistColour(night)), haze)
}

/* ---------- rings ---------- */

function OuterRings({ world, grade }: { world: OuterWorld; grade: OuterGrade }) {
  const meshes = useMemo(() => buildOuterMeshes(world), [world])
  const built = useRef<{ meshes: typeof meshes; grade: OuterGrade; geometries: THREE.BufferGeometry[] } | null>(null)
  // Geometry is created once per world; a day / night change recolours it in place.
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
        <mesh key={`${meshes[i].ring}-${meshes[i].quadrant}`} geometry={geometry} frustumCulled>
          <Surf color="#ffffff" vertexColors />
        </mesh>
      ))}
    </group>
  )
}

/* ---------- instances ---------- */

function Instances({
  geometry,
  count,
  write,
  unlit = false,
  frustumCulled = true,
}: {
  geometry: THREE.BufferGeometry
  count: number
  /** Fill `target` (matrix) and `color` for instance i. */
  write: (i: number, target: THREE.Object3D, color: THREE.Color) => void
  unlit?: boolean
  frustumCulled?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < count; i++) {
      dummy.position.set(0, 0, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, 1, 1)
      write(i, dummy, scratch)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, scratch)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [count, write])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (count === 0) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} geometry={geometry} frustumCulled={frustumCulled}>
      {unlit ? <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} /> : <Surf color="#ffffff" />}
    </instancedMesh>
  )
}

const CROWN_VARIANTS = [P.canopy, '#3f7f4d', '#2f6a3a'] as const

function Canopy({ world, plan, night }: { world: OuterWorld; plan: BarrierPlan; night: boolean }) {
  const domes = useMemo(() => canopyDomes(world, plan), [world, plan])
  const near = useMemo(() => domes.filter((d) => d.tier === 1), [domes])
  const far = useMemo(() => domes.filter((d) => d.tier === 2), [domes])
  const palmList = useMemo(() => palms(world), [world])
  const falls = useMemo(() => ridgeFalls(world), [world])
  const crownGeo = useMemo(() => domeGeometry(), [])
  const farGeo = useMemo(() => farDomeGeometry(), [])
  const trunkGeo = useMemo(() => trunkGeometry(), [])
  const palmTrunkGeo = useMemo(() => trunkGeometry(), [])
  const palmCrownGeo = useMemo(() => palmCrownGeometry(), [])
  const sheetGeo = useMemo(() => sheetGeometry(), [])

  const writeCrown = useMemo(
    () => (i: number, target: THREE.Object3D, color: THREE.Color) => {
      const d = near[i]
      target.position.set(d.x, d.y + d.trunk + d.radius * 0.22, d.z)
      target.rotation.set(0, d.yaw, 0)
      target.scale.set(d.radius, d.radius * 0.38, d.radius * 0.86)
      color.copy(hazed(night ? P.canopyNight : CROWN_VARIANTS[d.variant], d.haze, night))
    },
    [near, night],
  )
  const writeTrunk = useMemo(
    () => (i: number, target: THREE.Object3D, color: THREE.Color) => {
      const d = near[i]
      target.position.set(d.x, d.y - 0.4, d.z)
      target.scale.set(d.radius * 0.16, d.trunk + 0.4 + d.radius * 0.1, d.radius * 0.16)
      color.copy(hazed(P.bark, d.haze, night))
    },
    [near, night],
  )
  const writeFar = useMemo(
    () => (i: number, target: THREE.Object3D, color: THREE.Color) => {
      const d = far[i]
      target.position.set(d.x, d.y + d.radius * 0.12, d.z)
      target.rotation.set(0, d.yaw, 0)
      target.scale.set(d.radius, d.radius * 0.42, d.radius * 0.88)
      // Half the baked haze: the scene fog adds the rest, and a clump that reaches the sky colour
      // leaves only its inked outline behind (a soap bubble).
      color.copy(hazed(night ? P.canopyNight : d.variant === 0 ? P.canopyDark : P.canopy, d.haze * 0.5, night))
    },
    [far, night],
  )
  const writePalmTrunk = useMemo(
    () => (i: number, target: THREE.Object3D, color: THREE.Color) => {
      const p = palmList[i]
      target.position.set(p.x, p.y - 0.3, p.z)
      target.rotation.set(0, p.yaw, p.lean)
      target.scale.set(0.34, p.height, 0.34)
      color.copy(hazed('#8b6840', p.haze, night))
    },
    [palmList, night],
  )
  const writePalmCrown = useMemo(
    () => (i: number, target: THREE.Object3D, color: THREE.Color) => {
      const p = palmList[i]
      target.position.set(p.x, p.y - 0.3, p.z)
      target.rotation.set(0, p.yaw, p.lean)
      target.scale.set(p.height * 0.62, p.height, p.height * 0.62)
      color.copy(hazed(night ? '#1f4a33' : '#4f8a4a', p.haze, night))
    },
    [palmList, night],
  )
  const writeSheet = useMemo(
    () => (i: number, target: THREE.Object3D, color: THREE.Color) => {
      const f = falls[i]
      target.position.set(f.x, (f.y0 + f.y1) / 2, f.z)
      target.rotation.set(0, f.yaw, 0)
      target.scale.set(f.width, f.y1 - f.y0, 1)
      color.copy(hazed(night ? '#9fc4c0' : '#f2fff1', f.haze * 0.7, night))
    },
    [falls, night],
  )

  return (
    <group name="outer-canopy">
      <Instances geometry={crownGeo} count={near.length} write={writeCrown} />
      <Instances geometry={trunkGeo} count={near.length} write={writeTrunk} />
      <Instances geometry={farGeo} count={far.length} write={writeFar} />
      <Instances geometry={palmTrunkGeo} count={palmList.length} write={writePalmTrunk} />
      <Instances geometry={palmCrownGeo} count={palmList.length} write={writePalmCrown} />
      <Instances geometry={sheetGeo} count={falls.length} write={writeSheet} unlit frustumCulled={false} />
    </group>
  )
}

/* ---------- river ---------- */

function ribbonGeometry(data: RibbonData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.position, 3))
  geo.setIndex(new THREE.BufferAttribute(data.index, 1))
  geo.computeVertexNormals()
  return geo
}

function River({ world, night }: { world: OuterWorld; night: boolean }) {
  const river = useMemo(() => buildRiver(world), [world])
  const geometries = useMemo(() => {
    const all = [river.main, ...river.delta]
    return all.map((r) => ({ water: ribbonGeometry(r.water), wet: ribbonGeometry(r.wet) }))
  }, [river])
  useEffect(
    () => () =>
      geometries.forEach((g) => {
        g.water.dispose()
        g.wet.dispose()
      }),
    [geometries],
  )
  return (
    <group name="outer-river">
      {geometries.map((g, i) => (
        <group key={i}>
          <mesh geometry={g.wet}>
            <Surf color={night ? '#1b4d50' : P.wet} side={THREE.DoubleSide} />
          </mesh>
          <mesh geometry={g.water}>
            <Surf color={night ? P.waterNight : P.water} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/* ---------- wall, mist, vistas ---------- */

function useBuilt<T extends THREE.BufferGeometry>(build: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(build, deps)
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

interface Motion extends PlacesMotion {
  curtains: THREE.Mesh[]
  drifts: number[]
  deck: THREE.Mesh | null
  plume: THREE.InstancedMesh | null
  crater: [number, number, number]
}

function Mist({ world, night, motion }: { world: OuterWorld; night: boolean; motion: React.MutableRefObject<Motion> }) {
  const curtains = useMemo(() => mistCurtains(world), [world])
  const geometries = useMemo(
    () => curtains.map((c, i) => curtainGeometry(c.radius, c.y0, c.y1, c.opacity, night ? '#1d3f38' : '#eef8f1', world.seed + i * 1.7)),
    [curtains, night, world.seed],
  )
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries])
  useEffect(() => {
    motion.current.drifts = curtains.map((c) => c.drift)
  }, [curtains, motion])
  return (
    <group name="outer-mist">
      {geometries.map((geometry, i) => (
        <mesh
          key={i}
          geometry={geometry}
          frustumCulled={false}
          renderOrder={5}
          ref={(m) => {
            if (m) motion.current.curtains[i] = m
          }}
        >
          <meshBasicMaterial vertexColors transparent depthWrite={false} side={THREE.BackSide} />
        </mesh>
      ))}
    </group>
  )
}

function Landmark({ build, night, motion, kind }: { build: VistaBuild; night: boolean; motion: React.MutableRefObject<Motion>; kind: string }) {
  useEffect(
    () => () => {
      build.geometry.dispose()
      build.deck?.dispose()
    },
    [build],
  )
  return (
    <group>
      <mesh geometry={build.geometry}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      <mesh position={build.lamp}>
        <sphereGeometry args={[build.lampRadius, 8, 6]} />
        <Surf color={night ? build.lampColor : '#9a9289'} emissive={build.lampColor} emissiveIntensity={night ? 2.2 : 0} />
      </mesh>
      {build.deck && build.deckPivot ? (
        <mesh
          geometry={build.deck}
          position={build.deckPivot}
          ref={(m) => {
            motion.current.deck = m
          }}
        >
          <Surf color="#ffffff" vertexColors />
        </mesh>
      ) : null}
      {kind === 'volcano' ? (
        <instancedMesh
          args={[undefined, undefined, PLUME_PUFFS]}
          frustumCulled={false}
          ref={(m) => {
            motion.current.plume = m
            motion.current.crater = build.lamp
          }}
        >
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={night ? '#5a3a30' : '#c9d6d0'} emissive={night ? '#ff7a3a' : '#000000'} emissiveIntensity={night ? 0.35 : 0} />
        </instancedMesh>
      ) : null}
    </group>
  )
}

/** One frame loop for everything that moves: mist drift, the bridge's sway, the volcano's plume, cook-fire smoke, the canoes. */
function OuterMotion({ motion, reducedMotion, gorgeYaw }: { motion: React.MutableRefObject<Motion>; reducedMotion: boolean; gorgeYaw: number }) {
  const settled = useRef(false)
  useEffect(() => {
    settled.current = false
  }, [reducedMotion])
  useFrame(({ clock }) => {
    if (reducedMotion && settled.current) return
    const t = reducedMotion ? 0 : clock.elapsedTime
    stepPlaces(motion.current, t)
    const { curtains, drifts, deck, plume, crater } = motion.current
    for (let i = 0; i < curtains.length; i++) {
      const c = curtains[i]
      if (!c) continue
      c.rotation.y = t * (drifts[i] ?? 0)
      c.position.y = Math.sin(t * 0.07 + i * 2.1) * 1.5
    }
    if (deck) {
      // Rock about the span (the deck runs across the gorge, perpendicular to the trench).
      SWAY_AXIS.set(Math.cos(gorgeYaw), 0, -Math.sin(gorgeYaw))
      deck.quaternion.setFromAxisAngle(SWAY_AXIS, Math.sin(t * 0.55) * 0.035 + Math.sin(t * 1.3) * 0.008)
    }
    if (plume) {
      for (let i = 0; i < PLUME_PUFFS; i++) {
        const k = (t * 0.045 + i / PLUME_PUFFS) % 1
        dummy.position.set(crater[0] + k * 70 + Math.sin(i * 2.3) * 6, crater[1] + 4 + k * 150, crater[2] - k * 26 + Math.cos(i * 1.7) * 6)
        const size = (7 + k * 26) * Math.min(1, (1 - k) * 4)
        dummy.scale.setScalar(Math.max(0.001, size))
        dummy.rotation.set(k * 2, i, k)
        dummy.updateMatrix()
        plume.setMatrixAt(i, dummy.matrix)
      }
      plume.instanceMatrix.needsUpdate = true
    }
    settled.current = reducedMotion
  })
  return null
}

/* ---------- the scene ---------- */

declare global {
  interface Window {
    /** Dev-only hook for the lab's free-camera sweep (kept under /tmp): the outer world's root group. */
    __jungleOuter?: THREE.Group | null
  }
}

export function OuterWorldScene({ seed, night, reducedMotion }: OuterProps) {
  const world = useMemo(() => createOuterWorld(seed), [seed])
  const plan = world.barriers
  const grade = useMemo<OuterGrade>(() => ({ night }), [night])
  const wall = useBuilt(() => buildWall(plan, world, night), [plan, world, night])
  const vistas = useMemo(() => plan.vistas.map((vista) => ({ vista, build: buildVista(vista, plan, world, night) })), [plan, world, night])
  const motion = useRef<Motion>({ curtains: [], drifts: [], deck: null, plume: null, crater: [0, 0, 0], smoke: null, fires: [], canoes: null, tracks: [] })
  const root = useRef<THREE.Group>(null)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    window.__jungleOuter = root.current
    return () => {
      delete window.__jungleOuter
    }
  }, [])
  return (
    <group ref={root} name="jungle-outer-world">
      <OuterRings world={world} grade={grade} />
      <Canopy world={world} plan={plan} night={night} />
      <River world={world} night={night} />
      <mesh geometry={wall} frustumCulled={false}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      {vistas.map(({ vista, build }) => (
        <Landmark key={vista.id} build={build} night={night} motion={motion} kind={vista.kind} />
      ))}
      <Places world={world} night={night} motion={motion} />
      <Mist world={world} night={night} motion={motion} />
      <OuterMotion motion={motion} reducedMotion={reducedMotion} gorgeYaw={plan.gorge.yaw} />
    </group>
  )
}
