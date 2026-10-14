import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { type MountainProfile, mountainProfile } from '../layout/biome-layout'
import { Surf } from '../render/materials'
import { useStormWind } from '../scene/StormWind'
import { authoredMountainProfile } from '../scene/Terrain'
import type { EdgeSceneProps, EdgeTechnique } from './types'
import {
  type BuildStep,
  type OuterGrade,
  type RingMeshData,
  bergGeometry,
  buildOuterWorldSteps,
  duneGeometry,
  floeGeometry,
  hummockGeometry,
  paintBerg,
  paintDune,
  paintFloe,
  paintHummock,
  primedOuterSteps,
  recolourGeometry,
  ringGeometry,
} from './endless/outer-mesh'
import { landSpan } from '@/lib/world/land-marks'
import {
  type BergInstance,
  type DuneInstance,
  type FloeInstance,
  type HummockInstance,
  type OuterWorld,
  type OuterWorldOptions,
  createOuterWorld,
  endlessFog,
} from './endless/outer-world'

/**
 * Endless shelf. The authored plate is 170 m of hand-placed land; beyond it a seeded outer world
 * (pure helpers in ./endless) continues the coast into pack ice and the back land into further
 * mountain rows, built as three Chebyshev LOD rings of flat-shaded tiles that share the authored
 * terrain's 1 m lattice at the seam. Aerial perspective does the hiding: the fog is pushed out to
 * 1.5–1.7 km so the land stays crisp, and every outer face is tinted toward the sky by distance
 * so the horizon dissolves into the background with no band.
 */

const dummy = new THREE.Object3D()

function useRecolour<T extends THREE.BufferGeometry>(geometry: T, grade: OuterGrade, paint: (geo: T, grade: OuterGrade) => void) {
  const applied = useRef<OuterGrade | null>(null)
  useLayoutEffect(() => {
    const last = applied.current
    if (last && last.night === grade.night && last.storm === grade.storm && applied.current !== null) return
    paint(geometry, grade)
    applied.current = grade
  }, [geometry, grade, paint])
}

/**
 * The ring meshes arrive one ring per frame; each gets its geometry once (keyed by the mesh data)
 * and keeps it until the world changes or the scene unmounts. A day / night / storm change
 * recolours every geometry in place.
 */
/**
 * Geometries of primed ring data, kept across mounts: the land build's ring meshes live for the
 * session, so their GPU buffers can too (a land that mounts again uploads nothing). Each
 * remembers the grade it was painted with. Per-build (lab) data keeps the per-mount map below.
 */
const retained = new WeakMap<RingMeshData, { geometry: THREE.BufferGeometry; grade: OuterGrade }>()

function OuterRings({ meshes, grade, keep }: { meshes: RingMeshData[]; grade: OuterGrade; keep: boolean }) {
  const store = useRef(new Map<RingMeshData, THREE.BufferGeometry>())
  const painted = useRef(grade)
  const geometries = useMemo(() => {
    const map = store.current
    const live = new Set(meshes)
    for (const [m, g] of map) {
      if (!live.has(m)) {
        if (!retained.has(m)) g.dispose()
        map.delete(m)
      }
    }
    for (const m of meshes) {
      if (map.has(m)) continue
      const kept = keep ? retained.get(m) : undefined
      if (kept) {
        if (kept.grade.night !== painted.current.night || kept.grade.storm !== painted.current.storm) {
          recolourGeometry(kept.geometry, m, painted.current)
          kept.grade = painted.current
        }
        map.set(m, kept.geometry)
        continue
      }
      const geometry = ringGeometry(m, painted.current)
      if (keep) retained.set(m, { geometry, grade: painted.current })
      map.set(m, geometry)
    }
    return meshes.map((m) => map.get(m)!)
  }, [meshes, keep])

  useLayoutEffect(() => {
    if (painted.current.night === grade.night && painted.current.storm === grade.storm) return
    painted.current = grade
    for (const [m, g] of store.current) {
      recolourGeometry(g, m, grade)
      const kept = retained.get(m)
      if (kept) kept.grade = grade
    }
  }, [grade])

  useEffect(() => {
    const map = store.current
    return () => {
      for (const [m, g] of map) if (!retained.has(m)) g.dispose()
      map.clear()
    }
  }, [])

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

function Instances({
  geometry,
  count,
  write,
  grade,
  paint,
}: {
  geometry: THREE.BufferGeometry
  count: number
  write: (i: number, target: THREE.Object3D) => void
  grade: OuterGrade
  paint: (geo: THREE.BufferGeometry, grade: OuterGrade) => void
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useRecolour(geometry, grade, paint)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < count; i++) {
      write(i, dummy)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [count, write])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} geometry={geometry} frustumCulled>
      <Surf color="#ffffff" vertexColors />
    </instancedMesh>
  )
}

/**
 * Drift ice idles on a slow seeded loop; the gale hurries it a little. Reduced motion holds still.
 * This is the scene's one frame loop, so it also takes the next build step each frame.
 */
function Drift({ reducedMotion, onFrame, children }: { reducedMotion: boolean; onFrame?: () => void; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const { intensityRef } = useStormWind()
  const phase = useRef(0)
  useFrame((_, delta) => {
    onFrame?.()
    if (!group.current || reducedMotion) return
    phase.current += delta * 0.11 * (1 + 2.5 * intensityRef.current)
    const t = phase.current
    group.current.position.x = Math.sin(t) * 1.4
    group.current.position.z = Math.cos(t * 0.73) * 1.1
  })
  return <group ref={group}>{children}</group>
}

interface Built {
  world: OuterWorld
  /** Remaining steps; null once everything is built. */
  steps: Generator<BuildStep, void, void> | null
  meshes: RingMeshData[]
  hummocks: HummockInstance[]
  dunes: DuneInstance[]
  floes: FloeInstance[]
  bergs: BergInstance[]
}

/**
 * Takes the first step (ring 0 with the plate seam) synchronously; the rest follow one per frame.
 * A world the land build Worker already built (`primedOuterSteps`) lands whole in this render.
 */
function startBuild(world: OuterWorld): Built {
  const primed = primedOuterSteps(world)
  if (primed) {
    let built: Built = { world, steps: null, meshes: [], hummocks: [], dunes: [], floes: [], bergs: [] }
    for (const step of primed) built = applyStep(built, { done: false, value: step })
    return built
  }
  return landSpan('outer-ring0', () => {
    const steps = buildOuterWorldSteps(world)
    const built: Built = { world, steps, meshes: [], hummocks: [], dunes: [], floes: [], bergs: [] }
    return applyStep(built, steps.next())
  })
}

function applyStep(built: Built, result: IteratorResult<BuildStep, void>): Built {
  if (result.done) return { ...built, steps: null }
  const step = result.value
  if (step.kind === 'ring') return { ...built, meshes: [...built.meshes, ...step.meshes] }
  if (step.kind === 'detail') return { ...built, hummocks: step.hummocks, dunes: step.dunes }
  return { ...built, floes: step.floes, bergs: step.bergs }
}

export interface EndlessSceneProps extends EdgeSceneProps {
  /** Shape the outer world for a combination (another technique's ring and landmarks standing in it). */
  world?: OuterWorldOptions
}

const NO_OPTIONS: OuterWorldOptions = {}
const PROFILE_POLL_FRAMES = 90

/**
 * The profile the authored plate was built with (`Terrain` tags its mesh), read from the scene
 * graph after the first commit and re-checked every ~90 frames so a progress change that adds a
 * mountain row is followed. Null until the plate has mounted; the lab's floor (band 2) when
 * there is no authored plate in the scene. Disabled when the caller already knows the profile.
 */
export function useAuthoredMountainProfile(enabled = true): MountainProfile | null {
  const scene = useThree((state) => state.scene)
  const [profile, setProfile] = useState<MountainProfile | null>(null)
  const frames = useRef(0)
  useLayoutEffect(() => {
    if (enabled) setProfile(authoredMountainProfile(scene) ?? mountainProfile(0.62))
  }, [scene, enabled])
  useFrame(() => {
    if (!enabled || ++frames.current % PROFILE_POLL_FRAMES !== 0) return
    const current = authoredMountainProfile(scene)
    if (current && current.band !== profile?.band) setProfile(current)
  })
  return enabled ? profile : null
}

/** Resolves the outer-world options (the authored profile above all) before building anything. */
export function EndlessScene(props: EndlessSceneProps) {
  const given = props.world ?? NO_OPTIONS
  const detected = useAuthoredMountainProfile(!given.mountainProfile)
  const options = useMemo(() => {
    if (given.mountainProfile) return given
    return detected ? { ...given, mountainProfile: detected } : null
  }, [given, detected])
  if (!options) return null
  return <EndlessWorld {...props} world={options} />
}

function EndlessWorld({ layout, night, storm, seed, reducedMotion, world: options = NO_OPTIONS }: EndlessSceneProps) {
  const world = useMemo(() => landSpan('outer-world', () => createOuterWorld(layout, seed, options)), [layout, seed, options])
  const grade = useMemo<OuterGrade>(() => ({ night, storm }), [night, storm])

  // The build is chunked: ring 0 now, then one step per frame (see `buildOuterWorldSteps`). A new
  // world (seed, options, the plate's profile) restarts it from ring 0 in the same render.
  const [built, setBuilt] = useState<Built>(() => startBuild(world))
  const latest = useRef(built)
  let current = built
  if (current.world !== world) {
    current = startBuild(world)
    latest.current = current
    setBuilt(current)
  }
  const advance = useCallback(() => {
    const b = latest.current
    if (!b.steps) return
    const next = landSpan('outer-step', () => applyStep(b, b.steps!.next()))
    latest.current = next
    setBuilt(next)
  }, [])
  const { meshes, floes, bergs, hummocks, dunes } = current

  const floeGeo = useMemo(() => floeGeometry(), [])
  const bergGeo = useMemo(() => bergGeometry(), [])
  const hummockGeo = useMemo(() => hummockGeometry(), [])
  const duneGeo = useMemo(() => duneGeometry(), [])

  const writeFloe = useMemo(
    () => (i: number, target: THREE.Object3D) => {
      const f = floes[i]
      target.position.set(f.x, world.seaLevel + 0.05, f.z)
      target.rotation.set(0, f.yaw, 0)
      target.scale.set(f.r, 1, f.r)
    },
    [floes, world.seaLevel],
  )
  const writeBerg = useMemo(
    () => (i: number, target: THREE.Object3D) => {
      const b = bergs[i]
      target.position.set(b.x, world.seaLevel, b.z)
      target.rotation.set(0, b.yaw, 0)
      target.scale.set(b.length / 2, b.height, b.width / 2)
    },
    [bergs, world.seaLevel],
  )
  const writeHummock = useMemo(
    () => (i: number, target: THREE.Object3D) => {
      const h = hummocks[i]
      target.position.set(h.x, h.y, h.z)
      target.rotation.set(0, h.yaw, 0)
      target.scale.set(h.w, h.h, h.w)
    },
    [hummocks],
  )
  const writeDune = useMemo(
    () => (i: number, target: THREE.Object3D) => {
      const d = dunes[i]
      target.position.set(d.x, d.y, d.z)
      target.rotation.set(0, d.yaw, 0)
      target.scale.set(d.width, d.height, d.length)
    },
    [dunes],
  )

  return (
    <group name="edge-endless">
      <OuterRings meshes={meshes} grade={grade} keep={current.steps === null && primedOuterSteps(world) !== null} />
      {hummocks.length > 0 && <Instances geometry={hummockGeo} count={hummocks.length} write={writeHummock} grade={grade} paint={paintHummock} />}
      {dunes.length > 0 && <Instances geometry={duneGeo} count={dunes.length} write={writeDune} grade={grade} paint={paintDune} />}
      {bergs.length > 0 && <Instances geometry={bergGeo} count={bergs.length} write={writeBerg} grade={grade} paint={paintBerg} />}
      <Drift reducedMotion={reducedMotion} onFrame={advance}>
        {floes.length > 0 && <Instances geometry={floeGeo} count={floes.length} write={writeFloe} grade={grade} paint={paintFloe} />}
      </Drift>
    </group>
  )
}

export const endless: EdgeTechnique = {
  id: 'endless',
  name: 'Endless shelf',
  lineage: 'Breath of the Wild, Ghost of Tsushima, Sable: the land simply continues past where you can walk.',
  pitch:
    'Seeded pack ice and snowfields continue the coast beyond the plate in four LOD rings (5 / 10 / 20 / 80 m cells to 2.2 km): a moat of open water and drift floes, then plates with open leads, sastrugi and hummocks in the near field, tabular bergs frozen in, and behind the range a snowfield the authored foothills ease down into before a second, third and ghost mountain row. Fog is pushed out to 1.5–1.7 km so the town stays crisp, and every far face is tinted toward the sky by distance, so look for a horizon that dissolves with no band and a plate edge you cannot find.',
  Scene: EndlessScene,
  sky: endlessFog,
}
