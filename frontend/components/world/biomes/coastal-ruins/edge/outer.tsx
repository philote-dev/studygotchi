import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { COASTAL_PALETTE as P, type BiomeLayout } from '../layout/biome-layout'
import { toonRamp } from '../render/materials'
import { barrierPlan, type Vista } from './barriers/geography'
import { buildRing, buildVista } from './barriers/build'
import {
  buildRing as buildLatticeRing,
  buildSeamStrip,
  latticeGeometry,
  outcropGeometry,
  paintOutcrop,
  paintPier,
  paintScrub,
  pierGeometry,
  recolourGeometry,
  scrubGeometry,
  type LatticeMeshData,
  type OuterGrade,
} from './endless/outer-mesh'
import { aqueductStubs, createOuterWorld, karstOutcrops, maquisScrub, type OuterInstance } from './endless/outer-world'
import { bindHazeSpace, createHazeUniforms, patchHaze, type HazeUniforms } from './sea/horizon-haze'
import { ISLAND_BANDS, SEA_HORIZON, farIslands, sailSchedule, sailStateInto, seaPalette, type SailState } from './sea/sea-horizon'
import { buildFarSail, buildHazeWall, buildIslandShape, buildIsletShape, buildStackShape, createWallMaterial, islandColours, silhouette } from './sea/sea-meshes'

/**
 * The coastal outer world: the endless limestone continuation (LOD rings, scatter), the barrier
 * ring with its four vista windows, and the living sea horizon (far islands, haze wall, far sail,
 * moon path), composed inside the land's scaled group so everything here is in metres.
 *
 * Draw calls: 4 lattices + 3 scatter + 1 ring + 4 vistas + 4 lamps + 3 island bands + 1 sail + 1
 * wall ≈ 21. One `useFrame` drives the haze uniforms, the sail and the lamps; nothing allocates
 * per frame.
 */

export interface OuterWorldProps {
  layout: BiomeLayout
  night: boolean
  seed: number
  reducedMotion: boolean
  /** Shared horizon-haze uniforms (also installed on the authored water disc by BiomeScene). */
  haze: HazeUniforms
}

export { createHazeUniforms }

/* ---------- material helpers ---------- */

function useHazedToon(haze: HazeUniforms, layout: BiomeLayout, options: { color?: string; vertexColors?: boolean; emissive?: string; emissiveIntensity?: number; lift: number; sea?: boolean; transparent?: boolean; opacity?: number }) {
  const { color = '#ffffff', vertexColors = true, emissive = '#000000', emissiveIntensity = 0, lift, sea = false, transparent = false, opacity = 1 } = options
  const material = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), vertexColors, emissive, emissiveIntensity, transparent, opacity })
    patchHaze(m, haze, lift, sea, 1 / layout.renderScale)
    return m
  }, [color, vertexColors, emissive, emissiveIntensity, lift, sea, transparent, opacity, haze, layout.renderScale])
  useEffect(() => () => material.dispose(), [material])
  return material
}

function useBuilt<T extends THREE.BufferGeometry>(build: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(build, deps)
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

function bind(haze: HazeUniforms) {
  return (object: THREE.Object3D | null) => {
    if (object) bindHazeSpace(object, haze)
  }
}

const dummy = new THREE.Object3D()

/* ---------- the land continuation ---------- */

interface BuiltLattice {
  data: LatticeMeshData
  geometry: THREE.BufferGeometry
  grade: OuterGrade
}

/** The four lattice meshes, built one per frame (seam strip first, then the rings outward) so no single frame pays for all of them. */
function Lattices({ world, grade, haze, layout }: { world: ReturnType<typeof createOuterWorld>; grade: OuterGrade; haze: HazeUniforms; layout: BiomeLayout }) {
  const [built, setBuilt] = useState<{ world: typeof world; items: BuiltLattice[] }>(() => ({ world, items: [] }))
  const gradeRef = useRef(grade)
  gradeRef.current = grade
  const items = built.world === world ? built.items : []

  // Geometries created for the current world; disposed when the world changes or the scene unmounts.
  const owned = useRef<THREE.BufferGeometry[]>([])
  useEffect(
    () => () => {
      owned.current.forEach((g) => g.dispose())
      owned.current = []
    },
    [world],
  )

  useFrame(() => {
    const step = built.world === world ? built.items.length : 0
    if (step >= LATTICE_STEPS) return
    const data = step === 0 ? buildSeamStrip(world) : buildLatticeRing(world, world.rings[step - 1], world.rings[step] ?? null)
    const geometry = latticeGeometry(data, gradeRef.current)
    owned.current.push(geometry)
    const item: BuiltLattice = { data, geometry, grade: gradeRef.current }
    setBuilt((prev) => ({ world, items: prev.world === world ? [...prev.items, item] : [item] }))
  })

  // A day / night change recolours the built meshes in place (no rebuild).
  useLayoutEffect(() => {
    for (const item of items) {
      if (item.grade.night === grade.night) continue
      recolourGeometry(item.geometry, item.data, grade)
      item.grade = grade
    }
  }, [grade, items])

  const material = useHazedToon(haze, layout, { lift: 0.85 })
  const ref = useMemo(() => bind(haze), [haze])
  return (
    <group name="outer-lattices">
      {items.map((item) => (
        <mesh key={item.data.ring} ref={ref} geometry={item.geometry} material={material} frustumCulled={false} />
      ))}
    </group>
  )
}

const LATTICE_STEPS = 4

function Instances({
  geometry,
  items,
  grade,
  paint,
  material,
  haze,
}: {
  geometry: THREE.BufferGeometry
  items: OuterInstance[]
  grade: OuterGrade
  paint: (geo: THREE.BufferGeometry, grade: OuterGrade) => void
  material: THREE.Material
  haze: HazeUniforms
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => paint(geometry, grade), [geometry, grade, paint])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z)
      dummy.rotation.set(0, it.yaw, 0)
      dummy.scale.set(it.sx, it.sy, it.sz)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    bindHazeSpace(mesh, haze)
  }, [items, haze])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <instancedMesh ref={ref} args={[geometry, material, Math.max(1, items.length)]} frustumCulled={false} />
}

/* ---------- barriers and vistas ---------- */

const LAMP_OFF = '#9a948c'

function VistaMesh({ vista, night, seed, haze, layout, groundHeight, lampRef }: { vista: Vista; night: boolean; seed: number; haze: HazeUniforms; layout: BiomeLayout; groundHeight: number; lampRef: (m: THREE.Mesh | null) => void }) {
  const built = useMemo(() => buildVista(vista, night, seed, groundHeight), [vista, night, seed, groundHeight])
  useEffect(() => () => built.geometry.dispose(), [built])
  const material = useHazedToon(haze, layout, { lift: 0.5 })
  const ref = useMemo(() => bind(haze), [haze])
  return (
    <group position={[vista.x, 0, vista.z]} rotation={[0, vista.yaw, 0]}>
      <mesh ref={ref} geometry={built.geometry} material={material} frustumCulled={false} />
      <mesh ref={lampRef} position={built.lamp}>
        <sphereGeometry args={[built.lampRadius, 7, 5]} />
        <meshToonMaterial color={night ? P.window : LAMP_OFF} gradientMap={toonRamp()} emissive={P.window} emissiveIntensity={night ? 2.2 : 0} />
      </mesh>
    </group>
  )
}

/* ---------- far islands ---------- */

function Islands({ layout, seed, night, haze, plan }: { layout: BiomeLayout; seed: number; night: boolean; haze: HazeUniforms; plan: ReturnType<typeof barrierPlan> }) {
  const pieces = useMemo(() => farIslands(layout, seed, plan), [layout, seed, plan])
  const colours = useMemo(() => islandColours(night), [night])
  // Near stacks keep their facets; the middle and far bands are hazed silhouettes.
  const shapes = [
    useBuilt(() => buildStackShape(colours), [colours]),
    useBuilt(() => silhouette(buildIsletShape(colours), night, 0.35), [colours, night]),
    useBuilt(() => silhouette(buildIslandShape(colours), night, 0.6), [colours, night]),
  ]
  const material = useHazedToon(haze, layout, { lift: 0.55 })
  const refs = [useRef<THREE.InstancedMesh>(null), useRef<THREE.InstancedMesh>(null), useRef<THREE.InstancedMesh>(null)]
  const counts = ISLAND_BANDS.map((band) => pieces.filter((p) => p.band === band.index).length)
  const tint = useMemo(() => new THREE.Color(), [])
  useLayoutEffect(() => {
    ISLAND_BANDS.forEach((band, b) => {
      const mesh = refs[b].current
      if (!mesh) return
      let i = 0
      for (const piece of pieces) {
        if (piece.band !== band.index) continue
        dummy.position.set(piece.x, layout.seaLevel - 0.4, piece.z)
        dummy.rotation.set(0, piece.yaw, 0)
        dummy.scale.set(piece.size, piece.height, piece.size * (band.kind === 'island' ? 0.7 : 0.9))
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        tint.setScalar(0.9 + piece.tint * 0.1)
        mesh.setColorAt(i, tint)
        i++
      }
      mesh.count = i
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      bindHazeSpace(mesh, haze)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces, layout.seaLevel, colours, haze])
  return (
    <>
      {ISLAND_BANDS.map((band, b) => (
        <instancedMesh key={band.index} ref={refs[b]} args={[shapes[b], material, Math.max(1, counts[b])]} frustumCulled={false} />
      ))}
    </>
  )
}

/* ---------- the horizon wall ---------- */

function HazeWall({ layout, haze }: { layout: BiomeLayout; haze: HazeUniforms }) {
  const geometry = useBuilt(() => buildHazeWall(), [])
  const material = useMemo(() => createWallMaterial(haze.hazeLinear, layout.seaLevel * layout.renderScale, SEA_HORIZON.glowHeight * layout.renderScale), [haze, layout.seaLevel, layout.renderScale])
  useEffect(() => () => material.dispose(), [material])
  // The wall is unlit and mixes nothing: its colour must be the display-space haze, like the fog.
  const ref = useMemo(
    () => (object: THREE.Object3D | null) => {
      if (!object) return
      object.onBeforeRender = (renderer) => {
        const space = renderer.getRenderTarget() === null ? renderer.outputColorSpace : THREE.ColorManagement.workingColorSpace
        haze.hazeLinear.getRGB(material.uniforms.uHaze.value as THREE.Color, space)
      }
    },
    [haze, material],
  )
  return <mesh ref={ref} geometry={geometry} material={material} position={[0, layout.seaLevel, 0]} frustumCulled={false} renderOrder={-1} />
}

/* ---------- motion: one frame loop ---------- */

interface Motion {
  sail: THREE.Group | null
  lamps: THREE.Mesh[]
}

function OuterMotion({ haze, night, reducedMotion, seed, motion, layout }: { haze: HazeUniforms; night: boolean; reducedMotion: boolean; seed: number; motion: React.MutableRefObject<Motion>; layout: BiomeLayout }) {
  const schedule = useMemo(() => sailSchedule(seed), [seed])
  const colours = useMemo(
    () => ({ day: new THREE.Color(seaPalette(false).haze), night: new THREE.Color(seaPalette(true).haze), moon: new THREE.Color(seaPalette(true).moon) }),
    [],
  )
  const nightK = useRef(night ? 1 : 0)
  const state = useRef<SailState>({ visible: false, x: 0, z: 0, yaw: 0, k: 0 })
  useFrame(({ clock }, delta) => {
    const target = night ? 1 : 0
    nightK.current = reducedMotion ? target : nightK.current + (target - nightK.current) * Math.min(1, delta * 3.2)
    if (Math.abs(target - nightK.current) < 0.002) nightK.current = target
    haze.hazeLinear.copy(colours.day).lerp(colours.night, nightK.current)
    haze.moonLinear.copy(colours.moon)
    const t = reducedMotion ? 0 : clock.elapsedTime
    haze.time.value = t
    haze.moon.value = nightK.current
    const sail = motion.current.sail
    if (sail) {
      if (reducedMotion) sailStateInto(schedule, schedule[0].startAt + schedule[0].duration * 0.5, state.current)
      else sailStateInto(schedule, t, state.current)
      const s = state.current
      sail.visible = s.visible
      if (s.visible) {
        sail.position.set(s.x, layout.seaLevel - 0.1, s.z)
        sail.rotation.y = s.yaw
      }
    }
    // Lamps breathe very slightly at night (a far light, not a strobe); still under reduced motion.
    const lamps = motion.current.lamps
    for (let i = 0; i < lamps.length; i++) {
      const m = lamps[i].material as THREE.MeshToonMaterial
      if (!night) continue
      m.emissiveIntensity = 2.0 + (reducedMotion ? 0 : 0.25 * Math.sin(t * 1.3 + i * 2.1))
    }
  })
  return null
}

/* ---------- the composition ---------- */

export function OuterWorld({ layout, night, seed, reducedMotion, haze }: OuterWorldProps) {
  const world = useMemo(() => createOuterWorld(layout, seed), [layout, seed])
  const grade = useMemo<OuterGrade>(() => ({ night }), [night])
  const plan = useMemo(() => barrierPlan(layout, seed), [layout, seed])
  const outcrops = useMemo(() => karstOutcrops(world), [world])
  const scrub = useMemo(() => maquisScrub(world), [world])
  const piers = useMemo(() => aqueductStubs(world), [world])
  const outcropGeo = useMemo(() => outcropGeometry(), [])
  const scrubGeo = useMemo(() => scrubGeometry(), [])
  const pierGeo = useMemo(() => pierGeometry(), [])
  const scatterMaterial = useHazedToon(haze, layout, { lift: 0.6 })
  const ring = useBuilt(() => buildRing(plan, seed, night), [plan, seed, night])
  const ringMaterial = useHazedToon(haze, layout, { lift: 0.5 })
  const ringRef = useMemo(() => bind(haze), [haze])
  const sailGeometry = useBuilt(() => buildFarSail(night), [night])
  const sailMaterial = useHazedToon(haze, layout, { lift: 0.5 })
  const sailRef = useMemo(() => bind(haze), [haze])
  const motion = useRef<Motion>({ sail: null, lamps: [] })
  const acropolisGround = useMemo(() => world.sample(world.acropolisSite.x, world.acropolisSite.z).height, [world])

  return (
    <group name="edge-outer">
      <Lattices world={world} grade={grade} haze={haze} layout={layout} />
      <Instances geometry={outcropGeo} items={outcrops} grade={grade} paint={paintOutcrop} material={scatterMaterial} haze={haze} />
      <Instances geometry={scrubGeo} items={scrub} grade={grade} paint={paintScrub} material={scatterMaterial} haze={haze} />
      <Instances geometry={pierGeo} items={piers} grade={grade} paint={paintPier} material={scatterMaterial} haze={haze} />
      <mesh ref={ringRef} geometry={ring} material={ringMaterial} frustumCulled={false} />
      {plan.vistas.map((vista, i) => (
        <VistaMesh
          key={vista.id}
          vista={vista}
          night={night}
          seed={seed}
          haze={haze}
          layout={layout}
          groundHeight={vista.id === 'north' ? acropolisGround : 0}
          lampRef={(m) => {
            if (m) motion.current.lamps[i] = m
          }}
        />
      ))}
      <Islands layout={layout} seed={seed} night={night} haze={haze} plan={plan} />
      <group
        ref={(g) => {
          motion.current.sail = g
        }}
        visible={false}
      >
        <mesh ref={sailRef} geometry={sailGeometry} material={sailMaterial} frustumCulled={false} />
      </group>
      <HazeWall layout={layout} haze={haze} />
      <OuterMotion haze={haze} night={night} reducedMotion={reducedMotion} seed={seed} motion={motion} layout={layout} />
    </group>
  )
}
