import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Glow, Surf } from '../../render/materials'
import { type Heightfield, type XZ, ribbonGeometry } from './lib'

/* ------------------------------------------------------------------------------------------ */
/* Shared unit geometries (lazy singletons, never disposed: they are as shared as the materials) */

function memoGeometry<T extends THREE.BufferGeometry>(build: () => T): () => T {
  let cached: T | null = null
  return () => {
    if (!cached) cached = build()
    return cached
  }
}

/** 1 × 1 × 1 box whose base sits on y = 0. */
export const unitBox = memoGeometry(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0))
/** Gable roof prism: ridge along x, 1 long, 1 wide, apex at y = 1, eaves at y = 0. */
export const gable = memoGeometry(() => {
  const p = [
    [-0.5, 0, -0.5],
    [-0.5, 0, 0.5],
    [-0.5, 1, 0],
    [0.5, 0, -0.5],
    [0.5, 0, 0.5],
    [0.5, 1, 0],
  ]
  const tris = [
    [0, 2, 1], // west gable
    [3, 4, 5], // east gable
    [0, 3, 5],
    [0, 5, 2], // north slope
    [1, 2, 5],
    [1, 5, 4], // south slope
    [0, 1, 4],
    [0, 4, 3], // underside
  ]
  const positions: number[] = []
  for (const t of tris) for (const i of t) positions.push(...p[i])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.computeVertexNormals()
  return g
})
export const hexColumn = memoGeometry(() => new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0))
export const octColumn = memoGeometry(() => new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0))
export const pyramid = memoGeometry(() => new THREE.ConeGeometry(1, 1, 4).translate(0, 0.5, 0).rotateY(Math.PI / 4))
export const spike = memoGeometry(() => new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0))
export const disc = memoGeometry(() => new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2))
export const rock = memoGeometry(() => new THREE.DodecahedronGeometry(1, 0))
export const puff = memoGeometry(() => new THREE.SphereGeometry(1, 6, 4))
export const halfPipe = memoGeometry(() => new THREE.CylinderGeometry(1, 1, 1, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2))

/** Low-poly clinker hull: 1 long (x), 1 beam (z), keel at y = 0, gunwale at y = 1, stem and stern posts rising to 1.9. */
export const hull = memoGeometry(() => {
  const ts = [0, 0.08, 0.22, 0.4, 0.6, 0.78, 0.92, 1]
  const sections = ts.map((t) => {
    const s = Math.sin(Math.PI * t)
    const w = 0.5 * Math.pow(s, 0.6)
    const g = 1 + 0.9 * Math.pow(1 - s, 2)
    const k = 0.55 * Math.pow(1 - s, 1.6)
    return { x: t - 0.5, w, g, k }
  })
  const positions: number[] = []
  const tri = (a: number[], b: number[], c: number[], ref: number[]) => {
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    if (nx * ref[0] + ny * ref[1] + nz * ref[2] < 0) positions.push(...a, ...c, ...b)
    else positions.push(...a, ...b, ...c)
  }
  for (let i = 0; i < sections.length - 1; i++) {
    const s0 = sections[i]
    const s1 = sections[i + 1]
    const k0 = [s0.x, s0.k, 0]
    const k1 = [s1.x, s1.k, 0]
    const l0 = [s0.x, s0.g, -s0.w]
    const l1 = [s1.x, s1.g, -s1.w]
    const r0 = [s0.x, s0.g, s0.w]
    const r1 = [s1.x, s1.g, s1.w]
    tri(k0, l0, l1, [0, -0.2, -1])
    tri(k0, l1, k1, [0, -0.2, -1])
    tri(k0, r0, r1, [0, -0.2, 1])
    tri(k0, r1, k1, [0, -0.2, 1])
    tri(l0, r0, r1, [0, 1, 0])
    tri(l0, r1, l1, [0, 1, 0])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.computeVertexNormals()
  return g
})

/* ------------------------------------------------------------------------------------------ */
/* Instancing */

export interface Placement {
  x: number
  y: number
  z: number
  yaw?: number
  pitch?: number
  roll?: number
  sx?: number
  sy?: number
  sz?: number
}

const scratch = {
  m: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  e: new THREE.Euler(),
  p: new THREE.Vector3(),
  s: new THREE.Vector3(),
}

export function composePlacement(pl: Placement, target: THREE.Matrix4 = scratch.m): THREE.Matrix4 {
  scratch.e.set(pl.pitch ?? 0, pl.yaw ?? 0, pl.roll ?? 0, 'YXZ')
  scratch.q.setFromEuler(scratch.e)
  scratch.p.set(pl.x, pl.y, pl.z)
  scratch.s.set(pl.sx ?? 1, pl.sy ?? 1, pl.sz ?? 1)
  return target.compose(scratch.p, scratch.q, scratch.s)
}

/** One instanced mesh; `children` is the material (`<Surf>` or `<Glow>`). */
export function Instances({
  placements,
  geometry,
  children,
  castShadow = true,
  receiveShadow = false,
}: {
  placements: readonly Placement[]
  geometry: THREE.BufferGeometry
  children: ReactNode
  castShadow?: boolean
  receiveShadow?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    placements.forEach((pl, i) => mesh.setMatrixAt(i, composePlacement(pl)))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [placements])
  if (placements.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, placements.length]} castShadow={castShadow} receiveShadow={receiveShadow} frustumCulled={false}>
      {children}
    </instancedMesh>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Terrain, water, paths */

export function Terrain({ field, colors, night, lavaColor = '#e05a32' }: { field: Heightfield; colors: Record<string, string>; night: boolean; lavaColor?: string }) {
  useEffect(() => () => Object.values(field.geometries).forEach((g) => g.dispose()), [field])
  return (
    <group>
      {Object.entries(field.geometries).map(([bucket, geometry]) => (
        <mesh key={bucket} geometry={geometry} castShadow receiveShadow>
          {bucket === 'lava' ? <Glow color={lavaColor} on={night} intensity={1.3} offColor={colors.lava ?? '#c24a2e'} /> : <Surf color={colors[bucket] ?? '#ff00ff'} />}
        </mesh>
      ))}
    </group>
  )
}

export function Water({ y, color, size = 900, opacity = 1 }: { y: number; color: string; size?: number; opacity?: number }) {
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <Surf color={color} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

export function Ribbon({ points, width, heightAt, color, lift = 0.3, step = 3, smooth = 2 }: { points: readonly XZ[]; width: number; heightAt: (x: number, z: number) => number; color: string; lift?: number; step?: number; smooth?: number }) {
  const geometry = useMemo(() => ribbonGeometry(points, width, heightAt, lift, step, smooth), [points, width, heightAt, lift, step, smooth])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} receiveShadow>
      <Surf color={color} />
    </mesh>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Settlement */

export interface House {
  x: number
  y: number
  z: number
  yaw: number
  length: number
  width: number
  wall: number
  roof: number
  color: string
}

export function Longhouses({ houses, night, roofColor = '#556b46', windows = true }: { houses: readonly House[]; night: boolean; roofColor?: string; windows?: boolean }) {
  const parts = useMemo(() => {
    const walls = new Map<string, Placement[]>()
    const roofs: Placement[] = []
    const panes: Placement[] = []
    for (const h of houses) {
      const list = walls.get(h.color) ?? []
      list.push({ x: h.x, y: h.y, z: h.z, yaw: h.yaw, sx: h.length, sy: h.wall, sz: h.width })
      walls.set(h.color, list)
      roofs.push({ x: h.x, y: h.y + h.wall - 0.05, z: h.z, yaw: h.yaw, sx: h.length * 1.08, sy: h.roof, sz: h.width * 1.25 })
      if (!windows) continue
      const count = Math.max(1, Math.floor(h.length / 4.5))
      const cos = Math.cos(h.yaw)
      const sin = Math.sin(h.yaw)
      for (let i = 0; i < count; i++) {
        const lx = ((i + 0.5) / count - 0.5) * h.length * 0.8
        for (const side of [-1, 1]) {
          const lz = side * (h.width / 2 + 0.06)
          panes.push({ x: h.x + lx * cos + lz * sin, y: h.y + h.wall * 0.42, z: h.z - lx * sin + lz * cos, yaw: h.yaw, sx: 0.9, sy: h.wall * 0.3, sz: 0.2 })
        }
      }
    }
    return { walls: [...walls.entries()], roofs, panes }
  }, [houses, windows])
  return (
    <group>
      {parts.walls.map(([color, placements]) => (
        <Instances key={color} placements={placements} geometry={unitBox()}>
          <Surf color={color} />
        </Instances>
      ))}
      <Instances placements={parts.roofs} geometry={gable()}>
        <Surf color={roofColor} />
      </Instances>
      <Instances placements={parts.panes} geometry={unitBox()} castShadow={false}>
        <Glow color="#ffe9a8" on={night} intensity={1.8} />
      </Instances>
    </group>
  )
}

/** The hero hall: a long turf ridge, dragon-head finials, a porch facing down the processional axis. */
export function GreatHall({ x, y, z, yaw, length = 34, width = 12, wall = 5, roof = 9, body = '#4a3a33', turf = '#5b6b45', accent = '#d08a3c', night }: { x: number; y: number; z: number; yaw: number; length?: number; width?: number; wall?: number; roof?: number; body?: string; turf?: string; accent?: string; night: boolean }) {
  const panes = useMemo(() => {
    const out: Placement[] = []
    const count = Math.floor(length / 4)
    for (let i = 0; i < count; i++) {
      const lx = ((i + 0.5) / count - 0.5) * length * 0.82
      for (const side of [-1, 1]) out.push({ x: lx, y: wall * 0.5, z: side * (width / 2 + 0.08), sx: 1.2, sy: wall * 0.34, sz: 0.2 })
    }
    out.push({ x: length / 2 + 0.1, y: wall * 0.35, z: 0, sx: 0.2, sy: wall * 0.6, sz: 2.6 })
    return out
  }, [length, wall, width])
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh geometry={unitBox()} scale={[length, wall, width]} castShadow receiveShadow>
        <Surf color={body} />
      </mesh>
      <mesh geometry={gable()} position={[0, wall - 0.1, 0]} scale={[length * 1.1, roof, width * 1.3]} castShadow receiveShadow>
        <Surf color={turf} />
      </mesh>
      <mesh geometry={unitBox()} position={[0, wall + roof - 0.3, 0]} scale={[length * 1.14, 0.7, 0.9]} castShadow>
        <Surf color={body} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} geometry={unitBox()} position={[side * (length * 0.57), wall + roof - 0.2, 0]} rotation={[0, 0, side * -0.55]} scale={[1.4, 4.5, 1.1]} castShadow>
          <Surf color={accent} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={side} geometry={unitBox()} position={[0, wall - 0.4, side * (width * 0.52)]} scale={[length * 0.9, 1, 1.6]} castShadow>
          <Surf color={body} />
        </mesh>
      ))}
      <mesh geometry={unitBox()} position={[length / 2 + 2.4, 0, 0]} scale={[5.5, wall * 0.75, width * 0.5]} castShadow receiveShadow>
        <Surf color={body} />
      </mesh>
      <mesh geometry={gable()} position={[length / 2 + 2.4, wall * 0.72, 0]} scale={[6.4, wall * 0.6, width * 0.62]} castShadow>
        <Surf color={turf} />
      </mesh>
      <Instances placements={panes} geometry={unitBox()} castShadow={false}>
        <Glow color="#ffe9a8" on={night} intensity={2} />
      </Instances>
    </group>
  )
}

/** Tiered stave church: three shrinking gables, a tower, a spire, dragon heads on every ridge. */
export function StaveChurch({ x, y, z, yaw, scale = 1, body = '#3a2c28', roof = '#2a2522', accent = '#d08a3c', night }: { x: number; y: number; z: number; yaw: number; scale?: number; body?: string; roof?: string; accent?: string; night: boolean }) {
  const panes = useMemo<Placement[]>(() => [-4, 0, 4].flatMap((lx) => [-1, 1].map((side) => ({ x: lx, y: 2.4, z: side * 5.1, sx: 0.9, sy: 1.6, sz: 0.2 }))), [])
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]} scale={scale}>
      <mesh geometry={unitBox()} scale={[16, 5, 10]} castShadow receiveShadow>
        <Surf color={body} />
      </mesh>
      <mesh geometry={gable()} position={[0, 4.9, 0]} scale={[17.5, 4, 12]} castShadow>
        <Surf color={roof} />
      </mesh>
      <mesh geometry={unitBox()} scale={[10, 11, 6]} castShadow receiveShadow>
        <Surf color={body} />
      </mesh>
      <mesh geometry={gable()} position={[0, 10.9, 0]} scale={[11, 3.6, 7.6]} castShadow>
        <Surf color={roof} />
      </mesh>
      <mesh geometry={unitBox()} position={[0, 0, 0]} scale={[4.6, 19, 4.6]} castShadow receiveShadow>
        <Surf color={body} />
      </mesh>
      <mesh geometry={pyramid()} position={[0, 18.8, 0]} scale={[3.7, 3.2, 3.7]} castShadow>
        <Surf color={roof} />
      </mesh>
      <mesh geometry={spike()} position={[0, 21.6, 0]} scale={[1.1, 7, 1.1]} castShadow>
        <Surf color={roof} />
      </mesh>
      <mesh geometry={unitBox()} position={[0, 28.2, 0]} scale={[0.5, 2.2, 0.5]}>
        <Surf color={accent} />
      </mesh>
      {[
        [-8.9, 8.9, 1],
        [8.9, 8.9, -1],
        [-5.6, 14.5, 1],
        [5.6, 14.5, -1],
      ].map(([px, py, dir]) => (
        <mesh key={`${px}-${py}`} geometry={unitBox()} position={[px, py, 0]} rotation={[0, 0, dir * 0.5]} scale={[0.8, 2.6, 0.7]} castShadow>
          <Surf color={accent} />
        </mesh>
      ))}
      <mesh geometry={unitBox()} position={[0, 0, 5.2]} scale={[4, 3, 1.4]} castShadow>
        <Surf color={body} />
      </mesh>
      <Instances placements={panes} geometry={unitBox()} castShadow={false}>
        <Glow color="#ffe9a8" on={night} intensity={2} />
      </Instances>
    </group>
  )
}

/** Earth rampart in four arcs with gates on the cardinal bearings, a palisade on the crest, gate houses. */
export function RingFort({ x, y, z, radius, rampart = 5, palisade = 2.6, gapDeg = 9, earth = '#5c6a47', timber = '#5a4738', roofColor = '#556b46', gateHouses = true }: { x: number; y: number; z: number; radius: number; rampart?: number; palisade?: number; gapDeg?: number; earth?: string; timber?: string; roofColor?: string; gateHouses?: boolean }) {
  const half = (90 - gapDeg) / 2
  const torus = useMemo(() => new THREE.TorusGeometry(radius, rampart, 7, 36, THREE.MathUtils.degToRad(half * 2)), [half, radius, rampart])
  const wall = useMemo(() => new THREE.CylinderGeometry(radius, radius, palisade, 36, 1, true, THREE.MathUtils.degToRad(90 - half), THREE.MathUtils.degToRad(half * 2)).translate(0, palisade / 2, 0), [half, palisade, radius])
  useEffect(
    () => () => {
      torus.dispose()
      wall.dispose()
    },
    [torus, wall],
  )
  const bearings = [45, 135, 225, 315]
  return (
    <group position={[x, y, z]}>
      {bearings.map((bearing) => (
        <group key={bearing}>
          <group rotation={[0, -THREE.MathUtils.degToRad(bearing + half), 0]} scale={[1, 0.62, 1]}>
            <mesh geometry={torus} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
              <Surf color={earth} />
            </mesh>
          </group>
          <group rotation={[0, -THREE.MathUtils.degToRad(bearing), 0]} position={[0, rampart * 0.62 - 0.1, 0]}>
            <mesh geometry={wall} castShadow>
              <Surf color={timber} side={THREE.DoubleSide} />
            </mesh>
          </group>
        </group>
      ))}
      {gateHouses
        ? [0, 90, 180, 270].map((bearing) => {
            const a = THREE.MathUtils.degToRad(bearing)
            const gx = Math.cos(a) * radius
            const gz = Math.sin(a) * radius
            return (
              <group key={bearing} position={[gx, 0, gz]} rotation={[0, -a, 0]}>
                <mesh geometry={unitBox()} scale={[7, 7.5, 6]} castShadow receiveShadow>
                  <Surf color={timber} />
                </mesh>
                <mesh geometry={gable()} position={[0, 7.4, 0]} scale={[7.6, 3.4, 7.2]} castShadow>
                  <Surf color={roofColor} />
                </mesh>
              </group>
            )
          })
        : null}
    </group>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Scale cues and small life */

export interface Ship {
  x: number
  y: number
  z: number
  yaw: number
  length: number
  sail?: string | null
}

function shipPlacements(ships: readonly Ship[]) {
  const hulls: Placement[] = []
  const masts: Placement[] = []
  const sails = new Map<string, Placement[]>()
  for (const s of ships) {
    const beam = s.length * 0.19
    hulls.push({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, sx: s.length, sy: s.length * 0.11, sz: beam })
    masts.push({ x: s.x, y: s.y + s.length * 0.08, z: s.z, yaw: s.yaw, sx: 0.35, sy: s.length * 0.72, sz: 0.35 })
    if (s.sail) {
      const list = sails.get(s.sail) ?? []
      list.push({ x: s.x, y: s.y + s.length * 0.28, z: s.z, yaw: s.yaw, sx: s.length * 0.46, sy: s.length * 0.4, sz: 0.25 })
      sails.set(s.sail, list)
    }
  }
  return { hulls, masts, sails: [...sails.entries()] }
}

export function Longships({ ships, hullColor = '#3b2f2b' }: { ships: readonly Ship[]; hullColor?: string }) {
  const parts = useMemo(() => shipPlacements(ships), [ships])
  return (
    <group>
      <Instances placements={parts.hulls} geometry={hull()}>
        <Surf color={hullColor} />
      </Instances>
      <Instances placements={parts.masts} geometry={unitBox()}>
        <Surf color="#6b5745" />
      </Instances>
      {parts.sails.map(([color, placements]) => (
        <Instances key={color} placements={placements} geometry={unitBox()}>
          <Surf color={color} side={THREE.DoubleSide} />
        </Instances>
      ))}
    </group>
  )
}

/** The one animated element of a scene: a longship rowing a slow loop, with wake-free dignity. */
export function DriftingShip({ cx, cz, rx, rz, y, length = 18, sail = '#a64b3c', period = 110, phase = 0 }: { cx: number; cz: number; rx: number; rz: number; y: number; length?: number; sail?: string; period?: number; phase?: number }) {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const t = ((clock.elapsedTime / period) * Math.PI * 2 + phase) % (Math.PI * 2)
    const x = cx + Math.cos(t) * rx
    const z = cz + Math.sin(t) * rz
    const dx = -Math.sin(t) * rx
    const dz = Math.cos(t) * rz
    g.position.set(x, y + Math.sin(clock.elapsedTime * 0.9) * 0.08, z)
    g.rotation.set(0, Math.atan2(-dz, dx), Math.sin(clock.elapsedTime * 0.7) * 0.03)
  })
  const beam = length * 0.19
  return (
    <group ref={group} position={[cx + rx, y, cz]}>
      <mesh geometry={hull()} scale={[length, length * 0.11, beam]} castShadow>
        <Surf color="#3b2f2b" />
      </mesh>
      <mesh geometry={unitBox()} position={[0, length * 0.08, 0]} scale={[0.35, length * 0.72, 0.35]} castShadow>
        <Surf color="#6b5745" />
      </mesh>
      <mesh geometry={unitBox()} position={[0, length * 0.28, 0]} scale={[length * 0.46, length * 0.4, 0.25]} castShadow>
        <Surf color={sail} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

export function Sheep({ flock }: { flock: readonly Placement[] }) {
  return (
    <Instances placements={flock} geometry={unitBox()} castShadow>
      <Surf color="#ebe6dc" />
    </Instances>
  )
}

export function StandingStones({ stones, color = '#5a5962' }: { stones: readonly Placement[]; color?: string }) {
  return (
    <Instances placements={stones} geometry={unitBox()}>
      <Surf color={color} />
    </Instances>
  )
}

/** Fish-drying racks: an A-frame pair of legs and a long bar, instanced from a list of rack centres. */
export function FishRacks({ racks, color = '#7a6451' }: { racks: readonly Placement[]; color?: string }) {
  const parts = useMemo(() => {
    const legs: Placement[] = []
    const bars: Placement[] = []
    for (const r of racks) {
      const len = r.sx ?? 7
      const h = r.sy ?? 2.8
      const yaw = r.yaw ?? 0
      bars.push({ x: r.x, y: r.y + h - 0.2, z: r.z, yaw, sx: len, sy: 0.22, sz: 0.22 })
      for (const end of [-1, 1]) {
        const lx = end * len * 0.46
        for (const side of [-1, 1]) {
          legs.push({ x: r.x + lx * Math.cos(yaw), y: r.y, z: r.z - lx * Math.sin(yaw), yaw, roll: 0, pitch: side * 0.42, sx: 0.18, sy: h * 1.1, sz: 0.18 })
        }
      }
    }
    return { legs, bars }
  }, [racks])
  return (
    <group>
      <Instances placements={parts.legs} geometry={unitBox()}>
        <Surf color={color} />
      </Instances>
      <Instances placements={parts.bars} geometry={unitBox()}>
        <Surf color="#4a3f36" />
      </Instances>
    </group>
  )
}

export function Fires({ fires, night, color = '#ffb347', intensity = 2.4 }: { fires: readonly Placement[]; night: boolean; color?: string; intensity?: number }) {
  const pits = useMemo<Placement[]>(() => fires.map((f) => ({ ...f, sx: (f.sx ?? 1) * 1.6, sy: 0.5, sz: (f.sz ?? 1) * 1.6 })), [fires])
  return (
    <group>
      <Instances placements={pits} geometry={octColumn()} castShadow={false}>
        <Surf color="#3a3034" />
      </Instances>
      <Instances placements={fires} geometry={rock()} castShadow={false}>
        <Glow color={color} on={night} intensity={intensity} offColor="#8a4a3f" />
      </Instances>
    </group>
  )
}

export interface Pool {
  x: number
  y: number
  z: number
  r: number
}

export function HotPools({ pools, night, water = '#7cc8be', rim = '#d9d2c4' }: { pools: readonly Pool[]; night: boolean; water?: string; rim?: string }) {
  const parts = useMemo(() => {
    const rims: Placement[] = pools.map((p) => ({ x: p.x, y: p.y - 0.3, z: p.z, sx: p.r * 1.35, sy: 0.75, sz: p.r * 1.35 }))
    const basins: Placement[] = pools.map((p) => ({ x: p.x, y: p.y + 0.5, z: p.z, sx: p.r, sy: 1, sz: p.r }))
    return { rims, basins }
  }, [pools])
  return (
    <group>
      <Instances placements={parts.rims} geometry={octColumn()} castShadow={false} receiveShadow>
        <Surf color={rim} />
      </Instances>
      <Instances placements={parts.basins} geometry={disc()} castShadow={false}>
        <Glow color={water} on={night} intensity={0.9} offColor={water} />
      </Instances>
    </group>
  )
}

export interface Vent {
  x: number
  y: number
  z: number
  scale: number
  /** Geyser vents shoot a tall column on a period; fumaroles just drift. */
  geyser?: boolean
}

/** Steam puffs drifting up from vents; optional geysers erupt on a slow cycle. One useFrame per scene. */
export function Steam({ vents, color = '#eef2f3' }: { vents: readonly Vent[]; color?: string }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const columnRef = useRef<THREE.InstancedMesh>(null)
  const puffs = 4
  const geysers = useMemo(() => vents.filter((v) => v.geyser), [vents])
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (mesh) {
      const t = clock.elapsedTime
      let i = 0
      for (const v of vents) {
        for (let k = 0; k < puffs; k++) {
          const phase = (t * 0.09 + k / puffs + v.x * 0.013) % 1
          const rise = phase * 14 * v.scale
          const spread = (0.9 + phase * 2.2) * v.scale
          const sway = Math.sin(t * 0.5 + k * 1.7 + v.z) * 1.4 * v.scale * phase
          const fade = Math.sin(phase * Math.PI)
          mesh.setMatrixAt(i, composePlacement({ x: v.x + sway, y: v.y + 1.5 + rise, z: v.z + sway * 0.6, sx: spread * fade + 0.01, sy: spread * 0.8 * fade + 0.01, sz: spread * fade + 0.01 }))
          i += 1
        }
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    const columns = columnRef.current
    if (columns) {
      geysers.forEach((v, i) => {
        const cycle = (clock.elapsedTime * 0.07 + v.z * 0.01) % 1
        const burst = Math.max(0, Math.sin(cycle * Math.PI * 2.4)) ** 0.6
        const h = 0.2 + burst * 26 * v.scale
        columns.setMatrixAt(i, composePlacement({ x: v.x, y: v.y, z: v.z, sx: (0.9 + burst * 1.1) * v.scale, sy: h, sz: (0.9 + burst * 1.1) * v.scale }))
      })
      columns.instanceMatrix.needsUpdate = true
    }
  })
  if (vents.length === 0) return null
  return (
    <group>
      <instancedMesh ref={ref} args={[puff(), undefined, vents.length * puffs]} frustumCulled={false}>
        <Surf color={color} transparent opacity={0.55} />
      </instancedMesh>
      {geysers.length > 0 ? (
        <instancedMesh ref={columnRef} args={[octColumn(), undefined, geysers.length]} frustumCulled={false}>
          <Surf color="#f4f7f8" transparent opacity={0.8} />
        </instancedMesh>
      ) : null}
    </group>
  )
}

export function Bergs({ bergs, color = '#dbeaf2' }: { bergs: readonly Placement[]; color?: string }) {
  return (
    <Instances placements={bergs} geometry={rock()}>
      <Surf color={color} />
    </Instances>
  )
}

/** Basalt organ pipes: instanced hexagonal columns of varied height, the cliff face Reynisfjara is famous for. */
export function BasaltColumns({ columns, color = '#33353d' }: { columns: readonly Placement[]; color?: string }) {
  return (
    <Instances placements={columns} geometry={hexColumn()} receiveShadow>
      <Surf color={color} />
    </Instances>
  )
}

/** Distant shoulders (see `makeSkyline`): two instanced rows of broad five-sided cones, no shadows. */
export function Skyline({ near, far, nearColor = '#3a4049', farColor = '#55616a' }: { near: readonly Placement[]; far: readonly Placement[]; nearColor?: string; farColor?: string }) {
  return (
    <group>
      <Instances placements={far} geometry={spike()} castShadow={false}>
        <Surf color={farColor} />
      </Instances>
      <Instances placements={near} geometry={spike()} castShadow={false}>
        <Surf color={nearColor} />
      </Instances>
    </group>
  )
}

/** Dev diagnostic: counts triangles in the mounted scene and writes it to the document for the capture harness. */
export function TriangleReport({ label }: { label: string }) {
  const scene = useThree((state) => state.scene)
  useEffect(() => {
    let triangles = 0
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      const g = mesh.geometry
      const per = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3
      const count = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1
      triangles += per * count
    })
    document.documentElement.dataset.nordicTriangles = `${label}:${Math.round(triangles)}`
  }, [label, scene])
  return null
}
