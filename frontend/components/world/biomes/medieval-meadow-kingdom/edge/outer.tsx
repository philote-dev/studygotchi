'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MEADOW_PALETTE as P, type GeneratedKingdom } from '../layout/biome-layout'
import { Glow, Surf } from '../render/materials'
import { buildFarMill, buildVista, windmillSailsGeometry } from './barriers/vistas'
import { Batch, place } from './outer/batch'
import { type OuterBuild, type RibbonSet, createOuterBuild } from './outer/build'
import { outerBuildStatus } from './outer/build-status'
import { type DecalData, type RingMeshData, decalGeometry, recolourDecals, recolourGeometry, recolourRibbon, ringGeometry } from './outer/outer-mesh'
import { type OuterWorld, createOuterWorld } from './outer/outer-world'
import { OUTER_COLOURS, type OuterGrade, skyColour, waterColour } from './outer/palette'
import type { CanopyInstance, CopseInstance, HayInstance, HedgeInstance, TreeInstance } from './outer/scatter'

/**
 * The composed `outer` technique: the endless meadow (rings, decals, river, tracks, instanced
 * hedgerows / trees / woods / copses / haystacks) and the barrier vistas (four landmarks with one
 * lamp each, the far mill). The world is built in steps spread over frames (`outer/build.ts`),
 * nearest ring first, and regraded in place for night; one `useFrame` drives the only motion
 * (the western windmill's sails) and allocates nothing.
 */
export interface OuterSceneProps {
  layout: GeneratedKingdom
  night: boolean
  seed: number
  reducedMotion: boolean
}

const dummy = new THREE.Object3D()
const tint = new THREE.Color()
const skyLinear = new THREE.Color()
const forestLinear = new THREE.Color()
const SAIL_SPEED = 0.22
/** Milliseconds of build work per frame: several tiny steps may share a frame, a big one never splits it. */
const BUILD_FRAME_BUDGET_MS = 6

function useDisposable<T extends THREE.BufferGeometry>(geometry: T): T {
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

/* ---------- rings and decals ---------- */

function RingMesh({ data, grade }: { data: RingMeshData; grade: OuterGrade }) {
  const geometry = useDisposable(useMemo(() => ringGeometry(data, { night: false }), [data]))
  useLayoutEffect(() => recolourGeometry(geometry, data, grade), [geometry, data, grade])
  return (
    <mesh geometry={geometry} frustumCulled>
      <Surf color="#ffffff" vertexColors />
    </mesh>
  )
}

function PlateDecals({ data, grade }: { data: DecalData; grade: OuterGrade }) {
  const geometry = useDisposable(useMemo(() => decalGeometry(data, { night: false }), [data]))
  useLayoutEffect(() => recolourDecals(geometry, data, grade), [geometry, data, grade])
  if (data.triangles === 0) return null
  return (
    <mesh geometry={geometry} frustumCulled receiveShadow>
      <Surf color="#ffffff" vertexColors />
    </mesh>
  )
}

/* ---------- ribbons ---------- */

function Ribbons({ set, grade }: { set: RibbonSet; grade: OuterGrade }) {
  useLayoutEffect(() => {
    for (const geo of set.waters) recolourRibbon(geo, waterColour(grade))
  }, [set, grade])
  useEffect(
    () => () => {
      for (const geo of [...set.banks, ...set.waters, ...set.tracks]) geo.dispose()
    },
    [set],
  )
  return (
    <group name="outer-ribbons">
      {set.banks.map((geo, i) => (
        <mesh key={`bank-${i}`} geometry={geo} receiveShadow>
          <Surf color="#ffffff" vertexColors side={THREE.DoubleSide} />
        </mesh>
      ))}
      {set.waters.map((geo, i) => (
        <mesh key={`water-${i}`} geometry={geo} receiveShadow>
          <Surf color="#ffffff" vertexColors side={THREE.DoubleSide} />
        </mesh>
      ))}
      {set.tracks.map((geo, i) => (
        <mesh key={`track-${i}`} geometry={geo} receiveShadow>
          <Surf color="#ffffff" vertexColors side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------- geometries (triangle counts in the names; the budget test checks them) ---------- */

/** L0, 50 tris: trunk, crown and a lighter blob, like the authored RoundTree at a coarser facet count. */
export function treeGeometry(): THREE.BufferGeometry {
  const batch = new Batch()
  const trunk = new THREE.CylinderGeometry(0.3, 0.42, 4.2, 5, 1, true)
  batch.geo(trunk, place(0, 2.1, 0), P.timber)
  trunk.dispose()
  const crown = new THREE.IcosahedronGeometry(2, 0)
  batch.geo(crown, place(0, 4.6, 0), P.forest)
  crown.dispose()
  const blob = new THREE.IcosahedronGeometry(1.3, 0)
  batch.geo(blob, place(0.7, 5.1, -0.3), P.forestLight)
  blob.dispose()
  return batch.build()
}

/** L1, 16 tris: a four-sided trunk under an eight-facet canopy (the lollipop). */
export function lollipopGeometry(): THREE.BufferGeometry {
  const batch = new Batch()
  const trunk = new THREE.CylinderGeometry(0.3, 0.42, 4.0, 4, 1, true)
  batch.geo(trunk, place(0, 2.0, 0), P.timber)
  trunk.dispose()
  const canopy = new THREE.OctahedronGeometry(2.4, 0)
  batch.geo(canopy, place(0, 4.7, 0, 0.4, 0, 0, 1.1, 1, 1.1), P.forest)
  canopy.dispose()
  return batch.build()
}

/** L2, 4 tris: two crossed trapezoids, brown at the foot and green above, a tree-shaped silhouette for 400 m and up. */
export function crossGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const normals: number[] = []
  const trunk = new THREE.Color(P.timber)
  const leaf = new THREE.Color(P.forest)
  const quad = (yaw: number) => {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const p = (u: number, y: number) => [u * c, y, u * s] as const
    const b0 = p(-0.35, 0)
    const b1 = p(0.35, 0)
    const t0 = p(-2.0, 6.4)
    const t1 = p(2.0, 6.4)
    for (const v of [b0, b1, t1, b0, t1, t0]) positions.push(...v)
    for (const col of [trunk, trunk, leaf, trunk, leaf, leaf]) colors.push(col.r, col.g, col.b)
    for (let i = 0; i < 6; i++) normals.push(-s, 0, c)
  }
  quad(0)
  quad(Math.PI / 2)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.computeBoundingSphere()
  return geo
}

/** Woods canopy, 20 tris: one squat icosahedron standing for about two crowns. */
export function canopyGeometry(): THREE.BufferGeometry {
  const batch = new Batch()
  const blob = new THREE.IcosahedronGeometry(2.7, 0)
  batch.geo(blob, place(0, 5.0, 0, 0, 0, 0, 1.35, 0.95, 1.35), P.forest)
  blob.dispose()
  return batch.build()
}

/** Woods trunk, 8 tris. */
export function trunkGeometry(): THREE.BufferGeometry {
  const batch = new Batch()
  const trunk = new THREE.CylinderGeometry(0.34, 0.5, 5.0, 4, 1, true)
  batch.geo(trunk, place(0, 2.5, 0), P.timber)
  trunk.dispose()
  return batch.build()
}

/** A copse, 84 tris: three canopies of two greens over three trunks; instances scale it 0.7–1.5. */
export function copseGeometry(): THREE.BufferGeometry {
  const batch = new Batch()
  const crowns: Array<[number, number, number, number, string]> = [
    [0, 5.2, 0, 4.6, P.forest],
    [-4.2, 4.6, 2.6, 3.6, P.forestLight],
    [3.8, 4.4, -2.2, 3.3, P.forest],
  ]
  for (const [x, y, z, r, colour] of crowns) {
    const blob = new THREE.IcosahedronGeometry(r, 0)
    batch.geo(blob, place(x, y, z, x * 0.3, 0, 0, 1.2, 0.9, 1.2), colour)
    blob.dispose()
  }
  for (const [x, z] of [
    [0, 0],
    [-3.8, 2.2],
    [3.4, -2.0],
  ]) {
    const trunk = new THREE.CylinderGeometry(0.35, 0.5, 4.4, 4, 1, true)
    batch.geo(trunk, place(x, 2.2, z), P.timber)
    trunk.dispose()
  }
  return batch.build()
}

/** Hedge segment, 10 tris: a box without its bottom (1.1 across, 1.3 tall, 1 along; instances scale the length). */
export function hedgeGeometry(): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(1.1, 1.3, 1).toNonIndexed()
  const pos = box.getAttribute('position')
  const nor = box.getAttribute('normal')
  const positions: number[] = []
  const normals: number[] = []
  for (let f = 0; f < pos.count; f += 3) {
    if (nor.getY(f) < -0.5) continue
    for (let v = f; v < f + 3; v++) {
      positions.push(pos.getX(v), pos.getY(v) + 0.65, pos.getZ(v))
      normals.push(nor.getX(v), nor.getY(v), nor.getZ(v))
    }
  }
  box.dispose()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.computeBoundingSphere()
  return geo
}

export function hayGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.7, 0.7, 1.3, 6)
  geo.translate(0, 0.65, 0)
  return geo
}

/* ---------- instances ---------- */

function Trees({ list, lod, grade }: { list: TreeInstance[]; lod: 0 | 1 | 2; grade: OuterGrade }) {
  const geometry = useDisposable(useMemo(() => (lod === 0 ? treeGeometry() : lod === 1 ? lollipopGeometry() : crossGeometry()), [lod]))
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    skyLinear.set(skyColour(grade))
    forestLinear.set(P.forest)
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      dummy.position.set(t.x, t.y, t.z)
      dummy.rotation.set(0, t.yaw, 0)
      dummy.scale.setScalar(t.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      if (lod === 2) {
        // Far silhouettes haze toward the sky by distance: a per-instance multiplier on the leaf colour.
        const h = Math.min(0.6, t.haze + 0.12)
        tint.setRGB(
          (forestLinear.r * (1 - h) + skyLinear.r * h) / Math.max(1e-3, forestLinear.r),
          (forestLinear.g * (1 - h) + skyLinear.g * h) / Math.max(1e-3, forestLinear.g),
          (forestLinear.b * (1 - h) + skyLinear.b * h) / Math.max(1e-3, forestLinear.b),
        )
        tint.multiplyScalar(t.tint)
      } else {
        tint.setScalar(t.tint)
      }
      mesh.setColorAt(i, tint)
    }
    mesh.count = list.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [list, lod, grade])
  if (list.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, list.length]} frustumCulled>
      <Surf color="#ffffff" vertexColors side={lod === 2 ? THREE.DoubleSide : THREE.FrontSide} />
    </instancedMesh>
  )
}

function Woods({ list, grade }: { list: CanopyInstance[]; grade: OuterGrade }) {
  const canopy = useDisposable(useMemo(() => canopyGeometry(), []))
  const trunk = useDisposable(useMemo(() => trunkGeometry(), []))
  const canopies = useRef<THREE.InstancedMesh>(null)
  const trunks = useRef<THREE.InstancedMesh>(null)
  const trunked = useMemo(() => list.filter((c) => c.trunk), [list])
  useLayoutEffect(() => {
    const mesh = canopies.current
    if (!mesh) return
    skyLinear.set(skyColour(grade))
    forestLinear.set(P.forest)
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      dummy.position.set(c.x, c.y, c.z)
      dummy.rotation.set(0, c.yaw, 0)
      dummy.scale.setScalar(c.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      const h = Math.min(0.5, c.haze * 0.9)
      tint.setRGB(
        (forestLinear.r * (1 - h) + skyLinear.r * h) / Math.max(1e-3, forestLinear.r),
        (forestLinear.g * (1 - h) + skyLinear.g * h) / Math.max(1e-3, forestLinear.g),
        (forestLinear.b * (1 - h) + skyLinear.b * h) / Math.max(1e-3, forestLinear.b),
      )
      tint.multiplyScalar(c.tint)
      mesh.setColorAt(i, tint)
    }
    mesh.count = list.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [list, grade])
  useLayoutEffect(() => {
    const mesh = trunks.current
    if (!mesh) return
    for (let i = 0; i < trunked.length; i++) {
      const c = trunked[i]
      dummy.position.set(c.x, c.y, c.z)
      dummy.rotation.set(0, c.yaw, 0)
      dummy.scale.setScalar(c.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.count = trunked.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [trunked])
  if (list.length === 0) return null
  return (
    <group name="outer-woods">
      <instancedMesh ref={canopies} args={[canopy, undefined, list.length]} frustumCulled>
        <Surf color="#ffffff" vertexColors />
      </instancedMesh>
      {trunked.length > 0 ? (
        <instancedMesh ref={trunks} args={[trunk, undefined, trunked.length]} frustumCulled>
          <Surf color="#ffffff" vertexColors />
        </instancedMesh>
      ) : null}
    </group>
  )
}

function Copses({ list }: { list: CopseInstance[] }) {
  const geometry = useDisposable(useMemo(() => copseGeometry(), []))
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      dummy.position.set(c.x, c.y, c.z)
      dummy.rotation.set(0, c.yaw, 0)
      dummy.scale.setScalar(c.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, tint.setScalar(c.tint))
    }
    mesh.count = list.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [list])
  if (list.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, list.length]} frustumCulled>
      <Surf color="#ffffff" vertexColors />
    </instancedMesh>
  )
}

function Hedges({ list }: { list: HedgeInstance[] }) {
  const geometry = useDisposable(useMemo(() => hedgeGeometry(), []))
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < list.length; i++) {
      const h = list[i]
      dummy.position.set(h.x, h.y - 0.15, h.z)
      dummy.rotation.set(0, h.yaw, 0)
      dummy.scale.set(1, 1, h.length + 0.15)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.count = list.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [list])
  if (list.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, list.length]} frustumCulled>
      <Surf color={OUTER_COLOURS.hedge} />
    </instancedMesh>
  )
}

function Haystacks({ list }: { list: HayInstance[] }) {
  const geometry = useDisposable(useMemo(() => hayGeometry(), []))
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < list.length; i++) {
      const h = list[i]
      dummy.position.set(h.x, h.y, h.z)
      dummy.rotation.set(0, h.yaw, 0)
      dummy.scale.setScalar(h.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.count = list.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [list])
  if (list.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, list.length]} frustumCulled>
      <Surf color={OUTER_COLOURS.hay} />
    </instancedMesh>
  )
}

/* ---------- vistas ---------- */

interface Motion {
  sails: THREE.Mesh | null
}

function Vistas({ world, grade, motion }: { world: OuterWorld; grade: OuterGrade; motion: React.MutableRefObject<Motion> }) {
  const built = useMemo(
    () =>
      world.plan.vistas.map((vista) => {
        const sample = world.sample(vista.x, vista.z)
        return { vista, ground: world.meshHeight(vista.x, vista.z), build: buildVista(vista, grade, sample.haze, world.seed) }
      }),
    [world, grade],
  )
  const sails = useDisposable(useMemo(() => windmillSailsGeometry(8), []))
  useEffect(() => () => built.forEach((b) => b.build.geometry.dispose()), [built])
  const night = grade.night
  return (
    <group name="outer-vistas">
      {built.map(({ vista, ground, build }) => (
        <group key={vista.id} position={[vista.x, ground, vista.z]} rotation={[0, vista.yaw, 0]}>
          <mesh geometry={build.geometry}>
            <Surf color="#ffffff" vertexColors />
          </mesh>
          <mesh position={build.lamp}>
            <sphereGeometry args={[build.lampRadius, 7, 5]} />
            <Glow color={vista.light === 'warm' ? P.light : '#dff3ff'} on={night} intensity={2.4} />
          </mesh>
          {build.sails ? (
            <mesh
              geometry={sails}
              position={build.sails.position}
              ref={(mesh) => {
                motion.current.sails = mesh
              }}
            >
              <Surf color="#ffffff" vertexColors />
            </mesh>
          ) : null}
        </group>
      ))}
    </group>
  )
}

function FarMill({ world, grade }: { world: OuterWorld; grade: OuterGrade }) {
  const { mill } = world.river
  const ground = useMemo(() => world.meshHeight(mill.x, mill.z), [world, mill])
  const geometry = useDisposable(useMemo(() => buildFarMill(grade, world.sample(mill.x, mill.z).haze), [grade, world, mill]))
  return (
    <group position={[mill.x, ground, mill.z]} rotation={[0, mill.yaw, 0]}>
      <mesh geometry={geometry}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
    </group>
  )
}

/** The one frame loop: the windmill's sails turn slowly; reduced motion holds them. */
function OuterMotion({ motion, reducedMotion }: { motion: React.MutableRefObject<Motion>; reducedMotion: boolean }) {
  useFrame((_, delta) => {
    const sails = motion.current.sails
    if (!sails || reducedMotion) return
    sails.rotation.z -= delta * SAIL_SPEED
  })
  return null
}

/* ---------- the chunked build ---------- */

/**
 * Runs the build steps across frames: each frame takes steps until `BUILD_FRAME_BUDGET_MS` is
 * spent (a single step always completes), bumps a version so the pieces re-render, and keeps
 * `outerBuildStatus.pending` for the camera's readiness flag.
 */
function useChunkedBuild(world: OuterWorld): { build: OuterBuild; version: number } {
  const build = useMemo(() => createOuterBuild(world), [world])
  const [version, setVersion] = useState(0)
  useEffect(() => {
    outerBuildStatus.pending = build.steps.length - build.next
    return () => {
      outerBuildStatus.pending = 0
    }
  }, [build])
  useFrame(() => {
    if (build.next >= build.steps.length) return
    const t0 = performance.now()
    do {
      build.steps[build.next++].run()
    } while (build.next < build.steps.length && performance.now() - t0 < BUILD_FRAME_BUDGET_MS)
    outerBuildStatus.pending = build.steps.length - build.next
    setVersion((v) => v + 1)
  })
  return { build, version }
}

export function OuterScene({ layout, night, seed, reducedMotion }: OuterSceneProps) {
  const world = useMemo(() => createOuterWorld(layout, seed), [layout, seed])
  const grade = useMemo<OuterGrade>(() => ({ night }), [night])
  const { build, version } = useChunkedBuild(world)
  const b = build.built
  const motion = useRef<Motion>({ sails: null })
  // Instance lists only change identity when a step adds to them; snapshot the arrays per version.
  const woods = useMemo(() => b.woods.slice(), [b, version, b.woods.length]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group name="edge-outer">
      <group name="outer-rings">
        {b.rings.map((data) => (
          <RingMesh key={`${data.ring}-${data.quadrant}`} data={data} grade={grade} />
        ))}
      </group>
      {b.decals ? <PlateDecals data={b.decals} grade={grade} /> : null}
      {b.ribbons ? <Ribbons set={b.ribbons} grade={grade} /> : null}
      {b.hedges ? <Hedges list={b.hedges} /> : null}
      {b.lone ? (
        <>
          <Trees list={b.lone.l0} lod={0} grade={grade} />
          <Trees list={b.lone.l1} lod={1} grade={grade} />
          <Trees list={b.lone.l2} lod={2} grade={grade} />
        </>
      ) : null}
      <Woods list={woods} grade={grade} />
      {b.copses ? <Copses list={b.copses} /> : null}
      {b.hay ? <Haystacks list={b.hay} /> : null}
      <Vistas world={world} grade={grade} motion={motion} />
      <FarMill world={world} grade={grade} />
      <OuterMotion motion={motion} reducedMotion={reducedMotion} />
    </group>
  )
}
