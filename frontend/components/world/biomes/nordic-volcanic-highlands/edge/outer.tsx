import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { NORDIC_PALETTE as P } from '../layout/biome-layout'
import { GROUND_Y, WATER_Y, inPlateRect } from '../layout/terrain'
import { Surf } from '../render/materials'
import type { EdgeSceneProps, EdgeTechnique } from './types'
import {
  type OuterGrade,
  type RingMeshData,
  bergGeometry,
  buildOuterMeshes,
  crackGeometry,
  hummockGeometry,
  lobeGeometry,
  paintByNormal,
  recolourGeometry,
  ringGeometry,
  OUTER_COLOURS,
} from './outer/outer-mesh'
import { type OuterWorld, createOuterWorld } from './outer/outer-world'
import { type Instance, emberCracks, fjordBergs, mistLobes, mossHummocks, volcanoVent } from './outer/scatter'
import { type BarrierPlan, type Massif, type Vista, barrierPlan, geyserProfile, geyserStateAt } from './barriers/geography'
import { buildEnclosure, buildVista } from './barriers/build'

/**
 * The outer world of the highlands, composed: the endless continuation (LOD rings seamed to the
 * slabs, aerial perspective baked per face), the barriers (basalt palisades, fjord walls, the
 * glacier front) with four vista windows, the valley mist layer and the sea horizon. One frame
 * loop drives everything that moves: the volcano's smoke, the geyser on its schedule, the mist's
 * breath. Nothing is allocated per frame; reduced motion holds everything still.
 */

const dummy = new THREE.Object3D()
const PLUME_PUFFS = 7
const GEYSER_PUFFS = 9
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

/** Instanced meshes start with identity matrices (a puff at the world origin): hide them until the loop writes. */
function hideAll(mesh: THREE.InstancedMesh | null): void {
  if (!mesh) return
  for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, HIDDEN)
  mesh.instanceMatrix.needsUpdate = true
}
const LAMP: Record<Vista['light'], string> = { ember: '#ff7a2e', aqua: P.geothermal, warm: P.window }
const LAMP_OFF: Record<Vista['light'], string> = { ember: '#5b3a30', aqua: '#6f9e98', warm: '#b8ad92' }

/* ---------- shared world + plan (built once per seed) ---------- */

export interface OuterBundle {
  world: OuterWorld
  plan: BarrierPlan
  meshes: RingMeshData[]
}

const bundles = new Map<number, OuterBundle>()

export function outerBundle(seed: number): OuterBundle {
  let bundle = bundles.get(seed)
  if (!bundle) {
    const world = createOuterWorld(seed)
    bundle = { world, plan: barrierPlan(world, seed), meshes: buildOuterMeshes(world, WATER_Y) }
    bundles.set(seed, bundle)
  }
  return bundle
}

/** Ground + massif tops for the camera floor; the slab itself inside the plate. */
export function outerFloor(bundle: OuterBundle): (x: number, z: number) => number {
  const { world, plan } = bundle
  return (x, z) => {
    if (inPlateRect(x, z)) return GROUND_Y
    let h = world.heightAt(x, z)
    for (const m of plan.massifs) {
      const r = Math.max(m.rx, m.rz)
      if (Math.abs(m.x - x) > r || Math.abs(m.z - z) > r) continue
      h = Math.max(h, m.seatY + m.height)
    }
    return h
  }
}

/* ---------- rings ---------- */

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
    <group>
      {geometries.map((geometry, i) => (
        <mesh key={`${meshes[i].ring}-${meshes[i].quadrant}`} geometry={geometry} frustumCulled>
          <Surf color="#ffffff" vertexColors />
        </mesh>
      ))}
    </group>
  )
}

/* ---------- instances ---------- */

function useBuilt<T extends THREE.BufferGeometry>(build: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(build, deps)
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

function writeInstances(mesh: THREE.InstancedMesh | null, items: Instance[], y: (i: Instance) => number) {
  if (!mesh) return
  items.forEach((it, i) => {
    dummy.position.set(it.x, y(it), it.z)
    dummy.rotation.set(0, it.yaw, 0)
    dummy.scale.set(it.sx, it.sy, it.sz)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  })
  mesh.count = items.length
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

function Instances({ items, geometry, children, y = (it) => it.y }: { items: Instance[]; geometry: THREE.BufferGeometry; children: React.ReactNode; y?: (i: Instance) => number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => writeInstances(ref.current, items, y), [items, y])
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, Math.max(1, items.length)]} frustumCulled={false}>
      {children}
    </instancedMesh>
  )
}

/* ---------- vistas ---------- */

interface Motion {
  plume: THREE.InstancedMesh | null
  vent: [number, number, number]
  geyser: THREE.InstancedMesh | null
  vents: Array<[number, number, number]>
  mist: THREE.Group | null
  /** Set whenever a moving part (re)attaches, so a frozen scene writes it again. */
  dirty: boolean
}

function Landmark({ vista, night, seed, motion }: { vista: Vista; night: boolean; seed: number; motion: React.MutableRefObject<Motion> }) {
  const built = useMemo(() => buildVista(vista, night, seed), [vista, night, seed])
  useEffect(() => () => built.geometry.dispose(), [built])
  useEffect(() => {
    if (built.vents) {
      motion.current.vents = built.vents
      motion.current.dirty = true
    }
  }, [built, motion])
  const lamp = LAMP[vista.light]
  const steam = night ? '#9fb0bd' : '#eef3f3'
  return (
    <group>
      <mesh geometry={built.geometry}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      {vista.kind === 'geysers' ? (
        // The pool glow is this vista's one light; the eruption column is live.
        <>
          <mesh position={[vista.lamp[0], vista.lamp[1], vista.lamp[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[6.4, 9]} />
            <Surf color={night ? lamp : LAMP_OFF.aqua} emissive={lamp} emissiveIntensity={night ? 0.9 : 0.1} />
          </mesh>
          <instancedMesh
            args={[undefined, undefined, GEYSER_PUFFS]}
            frustumCulled={false}
            ref={(m) => {
              if (m && motion.current.geyser !== m) hideAll(m)
              motion.current.geyser = m
              motion.current.dirty = true
            }}
          >
            <dodecahedronGeometry args={[1, 0]} />
            <Surf color={steam} />
          </instancedMesh>
        </>
      ) : (
        <mesh position={[vista.lamp[0], vista.lamp[1], vista.lamp[2]]}>
          <sphereGeometry args={[vista.kind === 'volcano' ? 2.6 : 0.9, 7, 5]} />
          <Surf color={night ? lamp : LAMP_OFF[vista.light]} emissive={lamp} emissiveIntensity={night ? (vista.kind === 'volcano' ? 2.2 : 2.4) : vista.kind === 'volcano' ? 0.5 : 0} />
        </mesh>
      )}
      {vista.kind === 'volcano' ? (
        <instancedMesh
          args={[undefined, undefined, PLUME_PUFFS]}
          frustumCulled={false}
          ref={(m) => {
            if (m && motion.current.plume !== m) hideAll(m)
            motion.current.plume = m
            motion.current.dirty = true
          }}
        >
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={night ? '#4a505c' : '#b9bfc4'} />
        </instancedMesh>
      ) : null}
    </group>
  )
}

/** One frame loop: the volcano's smoke, the geyser on its schedule, the mist's breath. */
function OuterMotion({ motion, plan, reducedMotion, frozenTime }: { motion: React.MutableRefObject<Motion>; plan: BarrierPlan; reducedMotion: boolean; frozenTime: number | null }) {
  const settled = useRef(false)
  useFrame(({ clock }) => {
    const t = frozenTime ?? (reducedMotion ? 0 : clock.elapsedTime)
    const still = frozenTime !== null || reducedMotion
    if (still && settled.current && !motion.current.dirty) return
    const { plume, vent, geyser, vents, mist } = motion.current
    if (plume) {
      for (let i = 0; i < PLUME_PUFFS; i++) {
        const k = (t * 0.06 + i / PLUME_PUFFS) % 1
        // Rise from the crater, drift downwind (east), swell, thin out.
        dummy.position.set(vent[0] + k * 26 + Math.sin(i * 2.1 + k * 6) * 2, vent[1] + 3 + k * 30, vent[2] - k * 9)
        const size = (3.2 + k * 9) * Math.min(1, (1 - k) * 4)
        dummy.scale.setScalar(Math.max(0.001, size))
        dummy.rotation.set(k * 2, i, k)
        dummy.updateMatrix()
        plume.setMatrixAt(i, dummy.matrix)
      }
      plume.instanceMatrix.needsUpdate = true
    }
    if (geyser && vents.length === 3) {
      const state = geyserStateAt(plan.geysers, t)
      for (let i = 0; i < GEYSER_PUFFS; i++) {
        if (!state) {
          // Between eruptions: two faint wisps over the vents, the rest hidden.
          const v = vents[i % 3]
          const show = i < 2
          dummy.position.set(v[0] + Math.sin(t * 0.5 + i) * 0.6, v[1] + 1.2 + i * 1.3 + Math.sin(t * 0.8 + i) * 0.3, v[2])
          dummy.scale.setScalar(show ? 1.4 + i * 0.5 : 0.001)
        } else {
          const v = vents[state.vent]
          const { column, spread } = geyserProfile(state.k)
          const h = (i / (GEYSER_PUFFS - 1)) * column
          const drift = spread * (1 + i * 0.3)
          dummy.position.set(v[0] + Math.sin(i * 1.7) * drift * 1.5 + drift * 2, v[1] + h + spread * 6, v[2] + Math.cos(i * 1.3) * drift * 0.8)
          const size = (1.2 + (i / GEYSER_PUFFS) * 2.6 + spread * 3) * Math.min(1, column / 6)
          dummy.scale.setScalar(Math.max(0.001, size))
        }
        dummy.rotation.set(i, t * 0.3 + i, 0)
        dummy.updateMatrix()
        geyser.setMatrixAt(i, dummy.matrix)
      }
      geyser.instanceMatrix.needsUpdate = true
    }
    if (mist) mist.position.y = still ? 0 : 0.35 * Math.sin(t * 0.21)
    // A frozen scene writes once, but only once every moving part has mounted and been written,
    // and again whenever one of them re-attaches.
    settled.current = still && plume !== null && geyser !== null && vents.length === 3 && mist !== null
    motion.current.dirty = false
  })
  return null
}

/* ---------- the scene ---------- */

function Scene({ night, storm, seed, reducedMotion, frozenTime }: EdgeSceneProps) {
  const bundle = useMemo(() => outerBundle(seed), [seed])
  const { world, plan, meshes } = bundle
  const grade = useMemo<OuterGrade>(() => ({ night, storm }), [night, storm])
  const palette = night ? OUTER_COLOURS.night : OUTER_COLOURS.day

  const hummocks = useMemo(() => mossHummocks(world), [world])
  const cracks = useMemo(() => emberCracks(world), [world])
  const lobes = useMemo(() => mistLobes(world), [world])
  const bergs = useMemo(() => fjordBergs(world), [world])
  const hummockGeo = useBuilt(() => {
    const g = hummockGeometry()
    paintByNormal(g, night ? '#2f3d36' : '#74835f', night ? '#273530' : '#5e6d52', 0.1, palette.sky)
    return g
  }, [night, palette.sky])
  const crackGeo = useBuilt(() => crackGeometry(), [])
  const lobeGeo = useBuilt(() => lobeGeometry(), [])
  const bergGeo = useBuilt(() => {
    const g = bergGeometry()
    paintByNormal(g, night ? '#8a9aa6' : '#e4ecee', night ? '#56707f' : '#a9c5d0', 0.08, palette.sky)
    return g
  }, [night, palette.sky])
  const enclosure = useBuilt(() => buildEnclosure(plan, seed, night), [plan, seed, night])

  const motion = useRef<Motion>({ plume: null, vent: volcanoVent(world), geyser: null, vents: [], mist: null, dirty: true })
  const seaLevelY = (it: Instance) => it.y
  // Mist sits a third of the way toward the sky colour so it reads as haze pooled in hollows, not paper.
  const mistColour = useMemo(() => `#${new THREE.Color(night ? '#5f6d82' : storm ? '#9aa4b2' : '#e9eef0').lerp(new THREE.Color(palette.sky), 0.35).getHexString()}`, [night, storm, palette.sky])

  return (
    <group name="edge-outer">
      <OuterRings meshes={meshes} grade={grade} />
      <Instances items={hummocks} geometry={hummockGeo}>
        <Surf color="#ffffff" vertexColors />
      </Instances>
      <Instances items={cracks} geometry={crackGeo}>
        <Surf color={P.lava} emissive={P.lava} emissiveIntensity={night ? 1.1 : 0.45} />
      </Instances>
      <Instances items={bergs} geometry={bergGeo} y={seaLevelY}>
        <Surf color="#ffffff" vertexColors />
      </Instances>
      <mesh geometry={enclosure} frustumCulled={false}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      {plan.vistas.map((vista) => (
        <Landmark key={vista.id} vista={vista} night={night} seed={seed} motion={motion} />
      ))}
      <group
        ref={(g) => {
          motion.current.mist = g
          motion.current.dirty = true
        }}
      >
        <Instances items={lobes} geometry={lobeGeo}>
          <Surf color={mistColour} />
        </Instances>
      </group>
      <OuterMotion motion={motion} plan={plan} reducedMotion={reducedMotion} frozenTime={frozenTime} />
    </group>
  )
}

export const outer: EdgeTechnique = {
  id: 'outer',
  name: 'Outer world',
  lineage: 'Breath of the Wild and Ghost of Tsushima for the endless land; Skyrim, Journey and God of War for the walls and their windows; Skyward Sword for the cloud layer; The Wind Waker for the sea.',
  pitch:
    'The highlands continue past the slabs on three LOD rings seamed to the authored ground: black-sand flats and cooled lava fields east, moss moor with hummocks and two glacier tongues west, mountain rows receding north behind the authored range, and the fjord opening south into a bay and the open sea. Geography encloses the land: basalt column palisades east and west, the fjord walls continuing up the arm to a glacier front, the sea to the south. Four windows frame places you can see but never reach, each with one light at night: up the fjord an ice-capped shield volcano smoking over the glacier (ember at the notch), east a geyser field erupting on its own schedule (the pool glows), south a chieftain’s hall on the bay headland (one window), west a stave church on its moss hill (one lantern). A mist layer lies in the far valleys and every far face is tinted toward the sky, so the horizon dissolves with no band and no plate edge to find.',
  Scene,
}

export type { Massif }
