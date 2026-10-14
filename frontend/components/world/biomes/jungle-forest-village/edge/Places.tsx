'use client'

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { JUNGLE_PALETTE as P } from '../layout/jungle-layout'
import { Surf } from '../render/materials'
import { mistColour, type OuterWorld } from './outer/heightfield'
import {
  type CanoeTrack,
  type Fire,
  type Instance,
  type PlacesBuild,
  buildPlaces,
  canoeGeometry,
  hutGeometry,
  lampGeometry,
  logGeometry,
  parrotGeometry,
  postGeometry,
  puffGeometry,
} from './places/build'

/**
 * The inhabited beyond, rendered: one merged batch for every static primitive, one ribbon for
 * the dirt paths, one unlit sheet for the still water, and instanced huts, posts, logs, parrots,
 * lights, smoke puffs and canoes — ten draw calls. Motion (smoke, the two canoes) is driven by the
 * outer world's single frame loop through `PlacesMotion`.
 */

export const PUFFS_PER_FIRE = 3
export const CANOE_SPEED = 0.9

export interface PlacesMotion {
  smoke: THREE.InstancedMesh | null
  fires: Fire[]
  canoes: THREE.InstancedMesh | null
  tracks: CanoeTrack[]
}

const dummy = new THREE.Object3D()
const scratch = new THREE.Color()
const scratchMist = new THREE.Color()

function hazed(base: string, haze: number, night: boolean): THREE.Color {
  scratch.set(base)
  if (night) scratch.offsetHSL(0.02, -0.08, -0.2)
  return scratch.lerp(scratchMist.set(mistColour(night)), haze)
}

function Instanced({
  geometry,
  items,
  write,
  unlit = false,
  emissiveNight = false,
}: {
  geometry: THREE.BufferGeometry
  items: readonly Instance[]
  write: (item: Instance, target: THREE.Object3D, color: THREE.Color) => void
  unlit?: boolean
  emissiveNight?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < items.length; i++) {
      dummy.position.set(0, 0, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, 1, 1)
      write(items[i], dummy, scratch)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, scratch)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items, write])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (items.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} geometry={geometry} frustumCulled>
      {unlit ? <meshBasicMaterial color="#ffffff" toneMapped={!emissiveNight} /> : <Surf color="#ffffff" />}
    </instancedMesh>
  )
}

export function Places({ world, night, motion }: { world: OuterWorld; night: boolean; motion: React.MutableRefObject<PlacesMotion> }) {
  const build: PlacesBuild = useMemo(() => buildPlaces(world, night), [world, night])
  useEffect(
    () => () => {
      build.statics.dispose()
      build.paths.dispose()
      build.water.dispose()
    },
    [build],
  )
  const hutGeo = useMemo(() => hutGeometry(night), [night])
  const postGeo = useMemo(() => postGeometry(), [])
  const logGeo = useMemo(() => logGeometry(), [])
  const parrotGeo = useMemo(() => parrotGeometry(), [])
  const lampGeo = useMemo(() => lampGeometry(), [])
  const puffGeo = useMemo(() => puffGeometry(), [])
  const canoeGeo = useMemo(() => canoeGeometry(night), [night])
  useEffect(() => () => puffGeo.dispose(), [puffGeo])

  const hazeOf = (x: number, z: number) => world.hazeAt(x, z) * 0.85

  const writeHut = useMemo(
    () => (item: Instance, target: THREE.Object3D, color: THREE.Color) => {
      target.position.set(item.x, item.y, item.z)
      target.rotation.set(0, item.yaw, 0)
      target.scale.set(item.sx, item.sy, item.sz)
      // The hut's walls are white in the geometry: the instance tint colours them (lightly, so posts and thatch keep their bake).
      color.copy(hazed(item.color, hazeOf(item.x, item.z), night)).lerp(scratchMist.set('#ffffff'), 0.55)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [night, world],
  )
  const writePost = useMemo(
    () => (item: Instance, target: THREE.Object3D, color: THREE.Color) => {
      target.position.set(item.x, item.y, item.z)
      target.rotation.set(0, item.yaw, item.tilt ?? 0)
      target.scale.set(item.sx, item.sy, item.sz)
      color.copy(hazed(item.color, hazeOf(item.x, item.z), night))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [night, world],
  )
  const writeParrot = useMemo(
    () => (item: Instance, target: THREE.Object3D, color: THREE.Color) => {
      target.position.set(item.x, item.y, item.z)
      target.rotation.set(0, item.yaw, 0)
      target.scale.set(item.sx, item.sy, item.sz)
      color.copy(hazed(item.color, hazeOf(item.x, item.z) * 0.5, night))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [night, world],
  )
  const lamps = useMemo<Instance[]>(
    () => build.lights.map((l) => ({ x: l.x, y: l.y, z: l.z, yaw: 0, sx: l.radius, sy: l.radius, sz: l.radius, color: P.window, tilt: l.intensity })),
    [build],
  )
  const writeLamp = useMemo(
    () => (item: Instance, target: THREE.Object3D, color: THREE.Color) => {
      target.position.set(item.x, item.y, item.z)
      target.scale.set(item.sx, item.sy, item.sz)
      if (night) color.set(P.window).multiplyScalar(item.tilt ?? 1)
      else color.copy(hazed('#a89880', hazeOf(item.x, item.z), false))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [night, world],
  )

  // Hand the moving parts to the one frame loop.
  useEffect(() => {
    motion.current.fires = build.fires
    motion.current.tracks = build.canoes
  }, [build, motion])

  return (
    <group name="outer-places">
      <mesh geometry={build.statics}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      <mesh geometry={build.paths}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      <mesh geometry={build.water} renderOrder={1}>
        <meshBasicMaterial vertexColors />
      </mesh>
      <Instanced geometry={hutGeo} items={build.huts} write={writeHut} />
      <Instanced geometry={postGeo} items={build.posts} write={writePost} />
      <Instanced geometry={logGeo} items={build.logs} write={writePost} />
      <Instanced geometry={parrotGeo} items={build.parrots} write={writeParrot} />
      <Instanced geometry={lampGeo} items={lamps} write={writeLamp} unlit emissiveNight={night} />
      <instancedMesh
        args={[undefined, undefined, build.fires.length * PUFFS_PER_FIRE]}
        geometry={puffGeo}
        frustumCulled={false}
        ref={(m) => {
          motion.current.smoke = m
        }}
      >
        <Surf color={night ? '#3f4a46' : '#c9d6d0'} />
      </instancedMesh>
      <instancedMesh
        args={[undefined, undefined, build.canoes.length]}
        geometry={canoeGeo}
        frustumCulled={false}
        ref={(m) => {
          motion.current.canoes = m
        }}
      >
        <Surf color="#ffffff" vertexColors />
      </instancedMesh>
    </group>
  )
}

/** Advance the places' moving parts for time `t` (seconds); allocation-free. Called from the outer world's frame loop. */
export function stepPlaces(motion: PlacesMotion, t: number): void {
  const { smoke, fires, canoes, tracks } = motion
  if (smoke && fires.length) {
    for (let f = 0; f < fires.length; f++) {
      const fire = fires[f]
      for (let j = 0; j < PUFFS_PER_FIRE; j++) {
        const k = (t * 0.09 + j / PUFFS_PER_FIRE + f * 0.17) % 1
        dummy.position.set(fire.x + k * 3.5 * fire.scale + Math.sin(f + j) * 0.4, fire.y + k * 13 * fire.scale, fire.z + k * 1.5 * fire.scale)
        const size = (0.7 + k * 2.4) * Math.min(1, (1 - k) * 4) * fire.scale
        dummy.scale.setScalar(Math.max(0.001, size))
        dummy.rotation.set(k * 2, j + f, k)
        dummy.updateMatrix()
        smoke.setMatrixAt(f * PUFFS_PER_FIRE + j, dummy.matrix)
      }
    }
    smoke.instanceMatrix.needsUpdate = true
  }
  if (canoes && tracks.length) {
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]
      if (track.total <= 0) continue
      // Drift down the track and back up again, so the canoe never jumps.
      const period = (track.total * 2) / CANOE_SPEED
      const phase = ((t + i * 37) % period) / period
      const s = (phase < 0.5 ? phase * 2 : 2 - phase * 2) * track.total
      let seg = 1
      while (seg < track.arclength.length - 1 && track.arclength[seg] < s) seg++
      const a0 = track.arclength[seg - 1]
      const a1 = track.arclength[seg]
      const u = a1 > a0 ? (s - a0) / (a1 - a0) : 0
      const p = track.points
      const x0 = p[(seg - 1) * 3]
      const y0 = p[(seg - 1) * 3 + 1]
      const z0 = p[(seg - 1) * 3 + 2]
      const x1 = p[seg * 3]
      const y1 = p[seg * 3 + 1]
      const z1 = p[seg * 3 + 2]
      const forward = phase < 0.5 ? 1 : -1
      dummy.position.set(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u + Math.sin(t * 1.3 + i) * 0.08, z0 + (z1 - z0) * u)
      dummy.rotation.set(0, Math.atan2((x1 - x0) * forward, (z1 - z0) * forward), Math.sin(t * 0.9 + i) * 0.04)
      dummy.scale.setScalar(1.15)
      dummy.updateMatrix()
      canoes.setMatrixAt(i, dummy.matrix)
    }
    canoes.instanceMatrix.needsUpdate = true
  }
}
