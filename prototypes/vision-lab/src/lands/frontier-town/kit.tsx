import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Glow, Surf, toonMaterial } from '../../render/materials'
import { PAL, makePath, placeLocal, range, segment, yawToward, type Item, type Path, type Vec3 } from './lib'

/**
 * Frontier Town blockout kit: instanced primitives, the heightfield mesh, ribbons, and the
 * hero pieces every direction shares (false-front streets, water tower, bell tower, wind pump,
 * headframe, train, saguaros, fences, lamps). Everything is `Surf` / `Glow` over shared unit
 * geometries; triangle counts stay in the low tens of thousands per scene.
 */

/* Shared unit geometries: module singletons, never disposed by one mesh. */
export const BOX = new THREE.BoxGeometry(1, 1, 1)
export const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6)
export const CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8)
export const CONE8 = new THREE.ConeGeometry(0.5, 1, 8)
export const PYRAMID = new THREE.ConeGeometry(0.72, 1, 4)
export const ROCK = new THREE.DodecahedronGeometry(0.6, 0)
export const SCRUB = new THREE.IcosahedronGeometry(0.6, 0)
export const BULB = new THREE.DodecahedronGeometry(0.5, 0)
export const PRISM = gablePrism()

/** Unit gable prism: footprint 1 x 1 (x, z), ridge along z at y = 1, eaves at y = 0. */
function gablePrism(): THREE.BufferGeometry {
  const a: Vec3 = [-0.5, 0, -0.5]
  const b: Vec3 = [0.5, 0, -0.5]
  const c: Vec3 = [0.5, 0, 0.5]
  const d: Vec3 = [-0.5, 0, 0.5]
  const r0: Vec3 = [0, 1, -0.5]
  const r1: Vec3 = [0, 1, 0.5]
  const tris: Vec3[] = [
    // right slope
    b, r0, r1, b, r1, c,
    // left slope
    d, r1, r0, d, r0, a,
    // gable ends
    a, r0, b, c, r1, d,
    // underside
    a, b, c, a, c, d,
  ]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3))
  geo.computeVertexNormals()
  return geo
}

const M = new THREE.Matrix4()
const P = new THREE.Vector3()
const Q = new THREE.Quaternion()
const S = new THREE.Vector3()
const E = new THREE.Euler()

/** Instanced copies of one geometry; children supply the material (`Surf` or `Glow`). */
export function Inst({ geometry, items, children, shadow = true }: { geometry: THREE.BufferGeometry; items: readonly Item[]; children: ReactNode; shadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    items.forEach((item, i) => {
      P.set(item.p[0], item.p[1], item.p[2])
      if (item.q) Q.copy(item.q)
      else if (item.euler) Q.setFromEuler(E.set(item.euler[0], item.euler[1], item.euler[2]))
      else Q.setFromEuler(E.set(0, item.yaw ?? 0, 0))
      S.set(item.s[0], item.s[1], item.s[2])
      mesh.setMatrixAt(i, M.compose(P, Q, S))
    })
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
  }, [items])
  if (items.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, items.length]} castShadow={shadow} receiveShadow frustumCulled={false}>
      {children}
    </instancedMesh>
  )
}

export type ColorItem = Item & { color: string }

/** Items grouped by colour into one instanced mesh per colour. */
export function Colored({ geometry, items, shadow = true }: { geometry: THREE.BufferGeometry; items: readonly ColorItem[]; shadow?: boolean }) {
  const groups = useMemo(() => {
    const map = new Map<string, Item[]>()
    for (const item of items) {
      const list = map.get(item.color) ?? []
      list.push(item)
      map.set(item.color, list)
    }
    return [...map.entries()]
  }, [items])
  return (
    <>
      {groups.map(([color, list]) => (
        <Inst key={color} geometry={geometry} items={list} shadow={shadow}>
          <Surf color={color} />
        </Inst>
      ))}
    </>
  )
}

/** Memoised geometry that is disposed when its owner unmounts. */
export function useGeo(factory: () => THREE.BufferGeometry, deps: readonly unknown[]): THREE.BufferGeometry {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geo = useMemo(factory, deps)
  useEffect(() => () => geo.dispose(), [geo])
  return geo
}

/** The heightfield: one mesh, one toon material per paint index. */
export function Terrain({ geometry, colors }: { geometry: THREE.BufferGeometry; colors: readonly string[] }) {
  const materials = useMemo(() => colors.map((color) => toonMaterial({ color })), [colors])
  return <mesh geometry={geometry} material={materials} castShadow receiveShadow />
}

/**
 * Endless base plane so the land has no visible edge before the fog. With `hole` (the
 * heightfield's size) it becomes four slabs around the terrain, so carved gorges and washes
 * below the plane's level stay visible.
 */
export function Ground({ y, color, hole = 0 }: { y: number; color: string; hole?: number }) {
  if (!hole) {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
        <planeGeometry args={[4000, 4000]} />
        <Surf color={color} />
      </mesh>
    )
  }
  const far = 2000
  const h = hole / 2 - 1.5
  const slabs: Array<[number, number, number, number]> = [
    [-(far + h) / 2, 0, far - h, 2 * far],
    [(far + h) / 2, 0, far - h, 2 * far],
    [0, -(far + h) / 2, 2 * h, far - h],
    [0, (far + h) / 2, 2 * h, far - h],
  ]
  return (
    <>
      {slabs.map(([cx, cz, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[cx, y, cz]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <Surf color={color} />
        </mesh>
      ))}
    </>
  )
}

export function Strip({ geometry, color, transparent = false, opacity = 1, shadow = false }: { geometry: THREE.BufferGeometry; color: string; transparent?: boolean; opacity?: number; shadow?: boolean }) {
  return (
    <mesh geometry={geometry} receiveShadow castShadow={shadow}>
      <Surf color={color} transparent={transparent} opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** Writes the scene's triangle count to `<html data-frontier-triangles>` for the capture scripts. */
export function Readout({ label }: { label: string }) {
  const scene = useThree((state) => state.scene)
  useEffect(() => {
    let tris = 0
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.visible) return
      const geometry = mesh.geometry
      const faces = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3
      const instanced = mesh as THREE.InstancedMesh
      tris += faces * (instanced.isInstancedMesh ? instanced.count : 1)
    })
    document.documentElement.dataset.frontierTriangles = `${label}:${Math.round(tris)}`
  })
  return null
}

/* ---------------------------------------------------------------------------------------- */
/* Buildings                                                                                 */

export type Roof = 'flat' | 'gable' | 'false'

export interface Building {
  x: number
  y: number
  z: number
  yaw: number
  w: number
  d: number
  h: number
  color: string
  roofColor: string
  roof: Roof
  porch: boolean
}

export interface StreetOpts {
  /** -1 / 1 for one side of the path, 0 for both. */
  side: -1 | 0 | 1
  setback: number
  gap: readonly [number, number]
  width: readonly [number, number]
  depth: readonly [number, number]
  height: readonly [number, number]
  colors: readonly string[]
  roofColors: readonly string[]
  roof: Roof | 'mixed'
  porch?: boolean
  from?: number
  to?: number
  heightAt: (x: number, z: number) => number
}

/** Buildings shoulder to shoulder along a path, fronts facing the path. */
export function street(r: () => number, path: Path, opts: StreetOpts): Building[] {
  const out: Building[] = []
  const sides = opts.side === 0 ? [-1, 1] : [opts.side]
  const from = (opts.from ?? 0) * path.total
  const to = (opts.to ?? 1) * path.total
  for (const side of sides) {
    let s = from + range(r, 0, opts.gap[1])
    while (s < to) {
      const w = range(r, opts.width[0], opts.width[1])
      if (s + w > to) break
      const d = range(r, opts.depth[0], opts.depth[1])
      const h = range(r, opts.height[0], opts.height[1])
      const { p, dir } = path.at((s + w / 2) / path.total)
      const sx = -dir[1] * side
      const sz = dir[0] * side
      const x = p[0] + sx * (opts.setback + d / 2)
      const z = p[2] + sz * (opts.setback + d / 2)
      const roof = opts.roof === 'mixed' ? (r() < 0.55 ? 'false' : r() < 0.6 ? 'flat' : 'gable') : opts.roof
      out.push({
        x,
        z,
        y: opts.heightAt(x, z),
        yaw: yawToward(-sx, -sz),
        w,
        d,
        h,
        color: opts.colors[Math.floor(r() * opts.colors.length)],
        roofColor: opts.roofColors[Math.floor(r() * opts.roofColors.length)],
        roof,
        porch: opts.porch ?? roof === 'false',
      })
      s += w + range(r, opts.gap[0], opts.gap[1])
    }
  }
  return out
}

/** One building placed by hand. */
export function building(x: number, z: number, y: number, yaw: number, w: number, d: number, h: number, color: string, roof: Roof, roofColor: string = PAL.timberDark, porch = false): Building {
  return { x, y, z, yaw, w, d, h, color, roofColor, roof, porch }
}

export interface TownItems {
  walls: ColorItem[]
  roofsFlat: ColorItem[]
  roofsGable: ColorItem[]
  trim: Item[]
  windows: Item[]
}

/** Walls, roofs, false fronts, porches and window panes for a set of buildings. */
export function townItems(buildings: readonly Building[]): TownItems {
  const walls: ColorItem[] = []
  const roofsFlat: ColorItem[] = []
  const roofsGable: ColorItem[] = []
  const trim: Item[] = []
  const windows: Item[] = []
  for (const b of buildings) {
    walls.push({ p: [b.x, b.y + b.h / 2, b.z], s: [b.w, b.h, b.d], yaw: b.yaw, color: b.color })
    const front = (lx: number, lz: number) => placeLocal(b.x, b.z, b.yaw, lx, lz)
    if (b.roof === 'gable') {
      roofsGable.push({ p: [b.x, b.y + b.h, b.z], s: [b.w + 0.8, Math.max(1.6, b.w * 0.42), b.d + 0.6], yaw: b.yaw, color: b.roofColor })
    } else {
      roofsFlat.push({ p: [b.x, b.y + b.h + 0.2, b.z], s: [b.w + 0.5, 0.4, b.d + 0.5], yaw: b.yaw, color: b.roofColor })
    }
    if (b.roof === 'false') {
      const [fx, fz] = front(0, b.d / 2 + 0.2)
      walls.push({ p: [fx, b.y + (b.h + 2) / 2, fz], s: [b.w + 0.5, b.h + 2, 0.4], yaw: b.yaw, color: b.color })
      const [cx, cz] = front(0, b.d / 2 + 0.3)
      trim.push({ p: [cx, b.y + b.h + 1.9, cz], s: [b.w + 0.9, 0.35, 0.7], yaw: b.yaw })
    }
    if (b.porch) {
      const [ax, az] = front(0, b.d / 2 + 1.3)
      trim.push({ p: [ax, b.y + 3.1, az], s: [b.w + 0.4, 0.25, 2.2], yaw: b.yaw })
      for (const lx of [-b.w / 2 + 0.4, b.w / 2 - 0.4]) {
        const [px, pz] = front(lx, b.d / 2 + 2.2)
        trim.push({ p: [px, b.y + 1.55, pz], s: [0.3, 3.1, 0.3], yaw: b.yaw })
      }
    }
    const floors = Math.max(1, Math.round(b.h / 3.6))
    const across = b.w > 8 ? 3 : 2
    for (let f = 0; f < floors; f++) {
      for (let k = 0; k < across; k++) {
        const lx = -b.w / 2 + (b.w * (k + 0.5)) / across
        const [wx, wz] = front(lx, b.d / 2 + (b.roof === 'false' ? 0.5 : 0.1))
        windows.push({ p: [wx, b.y + 1.7 + f * 3.4, wz], s: [0.9, 1.3, 0.25], yaw: b.yaw })
      }
    }
  }
  return { walls, roofsFlat, roofsGable, trim, windows }
}

export function Town({ items, night }: { items: TownItems; night: boolean }) {
  return (
    <>
      <Colored geometry={BOX} items={items.walls} />
      <Colored geometry={BOX} items={items.roofsFlat} />
      <Colored geometry={PRISM} items={items.roofsGable} />
      <Inst geometry={BOX} items={items.trim}>
        <Surf color={PAL.timberDark} />
      </Inst>
      <Inst geometry={BOX} items={items.windows} shadow={false}>
        <Glow color={PAL.lamp} on={night} offColor="#6a5a56" />
      </Inst>
    </>
  )
}

/* ---------------------------------------------------------------------------------------- */
/* Hero pieces as item lists (so each scene composes them freely)                            */

/** Four-stilt water tower: legs, tank, conical roof. `h` is the deck height. */
export function waterTower(x: number, y: number, z: number, h: number, scale = 1): { timber: Item[]; tank: Item[]; roof: Item[] } {
  const timber: Item[] = []
  const spread = 2.4 * scale
  for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    timber.push(segment([x + lx * spread * 1.25, y, z + lz * spread * 1.25], [x + lx * spread * 0.8, y + h, z + lz * spread * 0.8], 0.4 * scale))
  }
  timber.push({ p: [x, y + h * 0.5, z], s: [spread * 2.3, 0.3, 0.3], yaw: 0 })
  timber.push({ p: [x, y + h * 0.5, z], s: [0.3, 0.3, spread * 2.3], yaw: 0 })
  timber.push({ p: [x, y + h, z], s: [spread * 2.4, 0.5, spread * 2.4], yaw: 0 })
  const tank: Item[] = [{ p: [x, y + h + 2.4 * scale, z], s: [4.6 * scale, 4.4 * scale, 4.6 * scale], yaw: 0 }]
  const roof: Item[] = [{ p: [x, y + h + 4.6 * scale + 1.2 * scale, z], s: [5.6 * scale, 2.4 * scale, 5.6 * scale], yaw: Math.PI / 8 }]
  return { timber, tank, roof }
}

/** Lattice wind pump; the wheel item is returned separately so a scene can spin it. */
export function windpump(x: number, y: number, z: number, h: number, yaw: number): { timber: Item[]; head: Vec3 } {
  const timber: Item[] = []
  for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    timber.push(segment([x + lx * 2.2, y, z + lz * 2.2], [x + lx * 0.5, y + h, z + lz * 0.5], 0.28))
  }
  for (const f of [0.35, 0.7]) {
    const w = 4.4 * (1 - f) + 1.2 * f
    timber.push({ p: [x, y + h * f, z], s: [w, 0.22, 0.22], yaw: 0 })
    timber.push({ p: [x, y + h * f, z], s: [0.22, 0.22, w], yaw: 0 })
  }
  const [tx, tz] = placeLocal(x, z, yaw, 0, -1.6)
  timber.push({ p: [tx, y + h + 0.9, tz], s: [0.2, 1.4, 2.4], yaw })
  return { timber, head: [x, y + h + 0.9, z] }
}

export function Wheel({ at, yaw, radius, refs }: { at: Vec3; yaw: number; radius: number; refs: RefObject<THREE.Object3D[]> }) {
  const [hx, hz] = placeLocal(at[0], at[2], yaw, 0, 1.1)
  return (
    <group position={[hx, at[1], hz]} rotation={[0, yaw, 0]}>
      <group
        ref={(node) => {
          if (node && !refs.current.includes(node)) refs.current.push(node)
        }}
      >
        <mesh geometry={CYL8} rotation={[Math.PI / 2, 0, 0]} scale={[radius * 2, 0.25, radius * 2]} castShadow>
          <Surf color={PAL.cream} />
        </mesh>
        <mesh geometry={BOX} scale={[radius * 2.2, 0.3, 0.3]}>
          <Surf color={PAL.timberDark} />
        </mesh>
        <mesh geometry={BOX} scale={[0.3, radius * 2.2, 0.3]}>
          <Surf color={PAL.timberDark} />
        </mesh>
      </group>
    </group>
  )
}

/** Mission church: nave, bell tower with an open belfry, pyramid roofs; lantern glows at night. */
export function Mission({ x, y, z, yaw, night, towerH = 22 }: { x: number; y: number; z: number; yaw: number; night: boolean; towerH?: number }) {
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh geometry={BOX} position={[0, 4, -4]} scale={[9, 8, 18]} castShadow receiveShadow>
        <Surf color={PAL.mission} />
      </mesh>
      <mesh geometry={PRISM} position={[0, 8, -4]} scale={[9.6, 3.2, 18.6]} castShadow>
        <Surf color={PAL.oxblood} />
      </mesh>
      <mesh geometry={BOX} position={[0, towerH / 2, 7]} scale={[5.4, towerH, 5.4]} castShadow receiveShadow>
        <Surf color={PAL.mission} />
      </mesh>
      <mesh geometry={BOX} position={[0, towerH - 2.6, 7]} scale={[5.8, 2.6, 2.2]}>
        <Surf color={PAL.timberDark} />
      </mesh>
      <mesh geometry={BOX} position={[0, towerH - 2.6, 7]} scale={[2.2, 2.6, 5.8]}>
        <Surf color={PAL.timberDark} />
      </mesh>
      <mesh geometry={BULB} position={[0, towerH - 2.6, 7]} scale={[1.2, 1.2, 1.2]}>
        <Glow color={PAL.lamp} on={night} offColor={PAL.mustard} />
      </mesh>
      <mesh geometry={PYRAMID} position={[0, towerH + 1.8, 7]} rotation={[0, Math.PI / 4, 0]} scale={[6, 3.6, 6]} castShadow>
        <Surf color={PAL.oxblood} />
      </mesh>
      <mesh geometry={BOX} position={[0, 1.6, 16.2]} scale={[1.6, 3.2, 0.4]}>
        <Surf color={PAL.timberDark} />
      </mesh>
    </group>
  )
}

/** Mine headframe: an A-frame tower with a sheave wheel, hoist shed and dark adit mouth. */
export function headframe(x: number, y: number, z: number, yaw: number, h = 11): { timber: Item[]; shed: ColorItem[]; adit: Item[] } {
  const timber: Item[] = []
  const local = (lx: number, lz: number): readonly [number, number] => placeLocal(x, z, yaw, lx, lz)
  for (const lx of [-2, 2]) {
    const [bx, bz] = local(lx, 0)
    const [tx, tz] = local(lx * 0.3, 0)
    timber.push(segment([bx, y, bz], [tx, y + h, tz], 0.45))
    const [ax, az] = local(lx * 1.3, -5)
    timber.push(segment([ax, y, az], [tx, y + h - 0.6, tz], 0.4))
  }
  for (const f of [0.45, 0.8]) {
    const w = 4.4 * (1 - f) + 1.6 * f
    const [cx, cz] = local(0, 0)
    timber.push({ p: [cx, y + h * f, cz], s: [w, 0.3, 0.5], yaw })
  }
  const [hx, hz] = local(0, 0)
  timber.push({ p: [hx, y + h + 0.6, hz], s: [2.6, 2.6, 0.5], yaw, euler: [0, yaw, Math.PI / 4] })
  const [sx, sz] = local(0, -8)
  const shed: ColorItem[] = [{ p: [sx, y + 2.2, sz], s: [7, 4.4, 6], yaw, color: PAL.timber }]
  const [ex, ez] = local(0, 3.2)
  const adit: Item[] = [{ p: [ex, y + 1.8, ez], s: [4, 3.6, 2.4], yaw }]
  return { timber, shed, adit }
}

/** Depot: long low building with a platform canopy on posts along its +z side. */
export function depot(x: number, y: number, z: number, yaw: number, len = 22): { walls: ColorItem[]; roofs: ColorItem[]; timber: Item[]; windows: Item[] } {
  const local = (lx: number, lz: number): readonly [number, number] => placeLocal(x, z, yaw, lx, lz)
  const walls: ColorItem[] = [{ p: [x, y + 3, z], s: [len, 6, 10], yaw, color: PAL.sage }]
  const roofs: ColorItem[] = [{ p: [x, y + 6, z], s: [len + 1.2, 3, 11], yaw, color: PAL.oxblood }]
  const timber: Item[] = []
  const [cx, cz] = local(0, 8.5)
  roofs.push({ p: [cx, y + 4.2, cz], s: [len + 6, 0.35, 7.5], yaw, color: PAL.timberDark })
  for (let i = -1; i <= 1; i++) {
    const [px, pz] = local((i * (len + 4)) / 2, 11.6)
    timber.push({ p: [px, y + 2.1, pz], s: [0.35, 4.2, 0.35], yaw })
  }
  const [bx, bz] = local(0, 9)
  timber.push({ p: [bx, y + 0.35, bz], s: [len + 8, 0.7, 9], yaw })
  const windows: Item[] = []
  for (let i = -2; i <= 2; i++) {
    const [wx, wz] = local((i * len) / 5.4, 5.1)
    windows.push({ p: [wx, y + 2.6, wz], s: [1.4, 1.6, 0.25], yaw })
  }
  return { walls, roofs, timber, windows }
}

/** Pueblo: stepped adobe cubes on terraces, ladders as thin bars. */
export function pueblo(r: () => number, x: number, y: number, z: number, yaw: number, tiers = 3, width = 30): { blocks: ColorItem[]; ladders: Item[] } {
  const blocks: ColorItem[] = []
  const ladders: Item[] = []
  for (let t = 0; t < tiers; t++) {
    const count = Math.max(2, Math.round((width / 6) * (1 - t * 0.28)))
    const span = width * (1 - t * 0.28)
    for (let i = 0; i < count; i++) {
      const lx = -span / 2 + (span * (i + 0.5)) / count + range(r, -0.6, 0.6)
      const lz = -t * 5.2 + range(r, -0.8, 0.8)
      const [bx, bz] = placeLocal(x, z, yaw, lx, lz)
      const h = range(r, 3.2, 4.4)
      const w = range(r, 4.8, 6.4)
      const d = range(r, 4.8, 6.4)
      const roll = r()
      blocks.push({ p: [bx, y + t * 3.6 + h / 2, bz], s: [w, h, d], yaw, color: roll < 0.55 ? PAL.adobe : roll < 0.8 ? PAL.adobeDark : PAL.cream })
      // parapet lip and a dark doorway on the sunward face
      blocks.push({ p: [bx, y + t * 3.6 + h + 0.2, bz], s: [w + 0.5, 0.4, d + 0.5], yaw, color: PAL.adobeDark })
      const [dx, dz] = placeLocal(x, z, yaw, lx, lz + d / 2 + 0.05)
      blocks.push({ p: [dx, y + t * 3.6 + 1, dz], s: [1, 2, 0.3], yaw, color: PAL.ink })
      if (r() < 0.4) {
        const [lxw, lzw] = placeLocal(x, z, yaw, lx + 1.6, lz + 3.4)
        ladders.push({ p: [lxw, y + t * 3.6 + 2.2, lzw], s: [0.9, 4.4, 0.15], yaw, euler: [0.3, yaw, 0] })
      }
    }
  }
  return { blocks, ladders }
}

/** Saguaros: trunk plus two arms, five cylinders each. */
export function saguaros(r: () => number, spots: readonly Vec3[]): Item[] {
  const items: Item[] = []
  for (const [x, y, z] of spots) {
    const h = range(r, 5, 9)
    const yaw = r() * Math.PI * 2
    items.push({ p: [x, y + h / 2, z], s: [1, h, 1], yaw })
    for (const side of [-1, 1]) {
      if (r() < 0.2) continue
      const ah = range(r, 0.4, 0.62) * h
      const [sx, sz] = placeLocal(x, z, yaw, side * 1.1, 0)
      items.push({ p: [sx, y + ah, sz], s: [0.7, 1.5, 0.7], euler: [0, yaw, Math.PI / 2] })
      const [ax, az] = placeLocal(x, z, yaw, side * 1.7, 0)
      const arm = range(r, 2, 3.6)
      items.push({ p: [ax, y + ah + arm / 2 - 0.3, az], s: [0.7, arm, 0.7], yaw })
    }
  }
  return items
}

export interface FenceItems {
  posts: Item[]
  rails: Item[]
}

/** Post-and-rail fence along a polyline, draped on the height sampler. */
export function fence(points: readonly Vec3[], heightAt: (x: number, z: number) => number, spacing = 3): FenceItems {
  const path = makePath(points)
  const n = Math.max(1, Math.round(path.total / spacing))
  const posts: Item[] = []
  const rails: Item[] = []
  let prev: Vec3 | null = null
  for (let i = 0; i <= n; i++) {
    const { p } = path.at(i / n)
    const y = heightAt(p[0], p[2])
    posts.push({ p: [p[0], y + 0.7, p[2]], s: [0.22, 1.4, 0.22], yaw: 0 })
    const top: Vec3 = [p[0], y + 1.25, p[2]]
    if (prev) rails.push(segment(prev, top, 0.14))
    prev = top
  }
  return { posts, rails }
}

/** Lamp posts with glowing heads; `spots` are ground points. */
export function lamps(spots: readonly Vec3[]): { posts: Item[]; heads: Item[] } {
  return {
    posts: spots.map(([x, y, z]) => ({ p: [x, y + 1.8, z], s: [0.22, 3.6, 0.22], yaw: 0 }) as Item),
    heads: spots.map(([x, y, z]) => ({ p: [x, y + 3.85, z], s: [0.7, 0.8, 0.7], yaw: 0 }) as Item),
  }
}

/** Telegraph poles with a crossbar every `spacing` metres along a path. */
export function telegraph(path: Path, heightAt: (x: number, z: number) => number, offset: number, spacing = 24): Item[] {
  const items: Item[] = []
  const n = Math.max(1, Math.round(path.total / spacing))
  for (let i = 0; i <= n; i++) {
    const { p, dir } = path.at(i / n)
    const x = p[0] - dir[1] * offset
    const z = p[2] + dir[0] * offset
    const y = heightAt(x, z)
    items.push({ p: [x, y + 3.6, z], s: [0.26, 7.2, 0.26], yaw: 0 })
    items.push({ p: [x, y + 6.6, z], s: [1.8, 0.2, 0.2], yaw: yawToward(dir[0], dir[1]) })
  }
  return items
}

/** Rail line: tie bed ribbon plus two rails, draped on the height sampler. */
export function RailLine({ path, heightAt, lift = 0.3 }: { path: Path; heightAt: (x: number, z: number) => number; lift?: number }) {
  const bed = useGeo(() => ribbonAlong(path, 4.2, lift, heightAt), [path, heightAt, lift])
  const left = useGeo(() => ribbonAlong(path, 0.35, lift + 0.22, heightAt, -0.75), [path, heightAt, lift])
  const right = useGeo(() => ribbonAlong(path, 0.35, lift + 0.22, heightAt, 0.75), [path, heightAt, lift])
  return (
    <>
      <Strip geometry={bed} color={PAL.timberDark} />
      <Strip geometry={left} color={PAL.iron} />
      <Strip geometry={right} color={PAL.iron} />
    </>
  )
}

/** Ribbon resampled along a path every 4 m with a sideways offset (boardwalks, rails). */
export function ribbonAlong(path: Path, width: number, lift: number, heightAt: (x: number, z: number) => number, offset = 0): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  const n = Math.max(2, Math.round(path.total / 4))
  for (let i = 0; i <= n; i++) {
    const { p, dir } = path.at(i / n)
    const sx = -dir[1]
    const sz = dir[0]
    const cx = p[0] + sx * offset
    const cz = p[2] + sz * offset
    for (const s of [-1, 1]) {
      const px = cx + sx * (width / 2) * s
      const pz = cz + sz * (width / 2) * s
      pos.push(px, heightAt(px, pz) + lift, pz)
    }
    if (i > 0) {
      const a = (i - 1) * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/** Steam train facing local +z; the scene moves the group along its rail path. */
export function Train({ groupRef, night, cars = 4 }: { groupRef: RefObject<THREE.Group | null>; night: boolean; cars?: number }) {
  const freight = useMemo<ColorItem[]>(() => {
    const list: ColorItem[] = []
    for (let i = 0; i < cars; i++) {
      const last = i === cars - 1
      list.push({ p: [0, 2.1, -16.5 - i * 10.5], s: [2.7, 3, 9.2], yaw: 0, color: last ? PAL.oxblood : i % 2 ? PAL.timber : PAL.teal })
      if (last) list.push({ p: [0, 4.1, -16.5 - i * 10.5], s: [1.6, 1.2, 3], yaw: 0, color: PAL.mustard })
    }
    return list
  }, [cars])
  return (
    <group ref={groupRef}>
      <mesh geometry={CYL8} position={[0, 2.3, 1.6]} rotation={[Math.PI / 2, 0, 0]} scale={[2.3, 7.4, 2.3]} castShadow>
        <Surf color={PAL.iron} />
      </mesh>
      <mesh geometry={BOX} position={[0, 2.8, -3]} scale={[2.9, 3.6, 3.2]} castShadow>
        <Surf color={PAL.oxblood} />
      </mesh>
      <mesh geometry={BOX} position={[0, 1, 0.4]} scale={[2.7, 1.2, 11]} castShadow>
        <Surf color={PAL.timberDark} />
      </mesh>
      <mesh geometry={CYL8} position={[0, 4.6, 4.2]} scale={[1, 2.4, 1]} castShadow>
        <Surf color={PAL.iron} />
      </mesh>
      <mesh geometry={BOX} position={[0, 0.9, 5.6]} rotation={[-0.5, 0, 0]} scale={[2.6, 1.4, 1]} castShadow>
        <Surf color={PAL.iron} />
      </mesh>
      <mesh geometry={BULB} position={[0, 3.4, 5.4]} scale={[0.9, 0.9, 0.9]}>
        <Glow color={PAL.headlamp} on={night} intensity={2.4} offColor={PAL.mustard} />
      </mesh>
      <mesh geometry={BOX} position={[0, 2, -8.3]} scale={[2.7, 2.8, 6.2]} castShadow>
        <Surf color={PAL.timberDark} />
      </mesh>
      <Colored geometry={BOX} items={freight} />
    </group>
  )
}

/**
 * Far buttes beyond the heightfield: three stacked, unevenly scaled drums per butte in the strata
 * colours, plus a sand cap, so the horizon has silhouettes before the fog eats it.
 */
export function farButtes(base: number, spots: readonly (readonly [number, number, number, number])[]): ColorItem[] {
  const items: ColorItem[] = []
  const layers = [PAL.rockDark, PAL.strata, PAL.rock, PAL.rockDark]
  spots.forEach(([x, z, radius, h], i) => {
    for (let layer = 0; layer < 4; layer++) {
      const f = layer / 4
      const shrink = 1 - f * 0.4 - (layer === 3 ? 0.08 : 0)
      const stretch = 1.25 + 0.35 * ((i * 7 + layer * 3) % 3)
      items.push({
        p: [x + ((i + layer) % 3) * 4 - 4, base + h * f + h / 8, z + ((i * 5 + layer) % 3) * 4 - 4],
        s: [radius * 2 * shrink, h / 4, radius * stretch * shrink],
        yaw: x * 0.013 + i + layer * 0.5,
        color: layers[layer],
      })
    }
    items.push({ p: [x, base + h + 0.6, z], s: [radius * 1.1, 1.2, radius * 0.8], yaw: x * 0.013 + i, color: PAL.sand })
  })
  return items
}

/** Covered wagons and carts: body, canvas hood, wheels as flat cylinders. */
export function wagons(spots: readonly { p: Vec3; yaw: number; covered: boolean }[]): { timber: Item[]; canvas: Item[]; wheels: Item[] } {
  const timber: Item[] = []
  const canvas: Item[] = []
  const wheels: Item[] = []
  for (const { p, yaw, covered } of spots) {
    timber.push({ p: [p[0], p[1] + 1.1, p[2]], s: [2, 1, 4], yaw })
    if (covered) canvas.push({ p: [p[0], p[1] + 2.3, p[2]], s: [2.3, 1.6, 4.4], yaw })
    for (const [lx, lz] of [[-1.1, -1.3], [1.1, -1.3], [-1.1, 1.3], [1.1, 1.3]]) {
      const [wx, wz] = placeLocal(p[0], p[2], yaw, lx, lz)
      wheels.push({ p: [wx, p[1] + 0.7, wz], s: [1.4, 0.2, 1.4], euler: [0, yaw, Math.PI / 2] })
    }
  }
  return { timber, canvas, wheels }
}
