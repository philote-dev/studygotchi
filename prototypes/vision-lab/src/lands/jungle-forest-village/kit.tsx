import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Glow, Surf, toonMaterial } from '../../render/materials'
import { G, leanMatrix, mats, placeMatrix, ribbonGeometry, segmentMatrix, smoothPath, type HeightFn, type V2, type V3 } from './lib'
import { P } from './palette'
import { buildTerrain, type TerrainSpec } from './terrain'

/* ------------------------------------------------------------------ instancing */

export function Instances({
  geometry,
  matrices,
  children,
  shadow = true,
}: {
  geometry: THREE.BufferGeometry
  matrices: readonly THREE.Matrix4[]
  children: ReactNode
  shadow?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [matrices])
  if (matrices.length === 0) return null
  return (
    <instancedMesh key={matrices.length} ref={ref} args={[undefined, undefined, matrices.length]} castShadow={shadow} receiveShadow={shadow}>
      <primitive object={geometry} attach="geometry" dispose={null} />
      {children}
    </instancedMesh>
  )
}

function useDisposable<T extends THREE.BufferGeometry>(geometry: T): T {
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

const M = () => new THREE.Matrix4()

/* ------------------------------------------------------------------ terrain and water */

export function Terrain({ spec }: { spec: TerrainSpec }) {
  const mesh = useMemo(() => {
    const object = new THREE.Mesh(
      buildTerrain(spec),
      spec.materials.map((color) => toonMaterial({ color })),
    )
    object.castShadow = true
    object.receiveShadow = true
    return object
  }, [spec])
  useEffect(() => () => mesh.geometry.dispose(), [mesh])
  return <primitive object={mesh} />
}

export function WaterPlane({ level, night, size = 2600 }: { level: number; night: boolean; size?: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, level, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <Surf color={night ? P.waterNight : P.water} />
    </mesh>
  )
}

interface FallSpec {
  top: V3
  bottom: V3
  flow: V2
}

function MistPulse({ width, bottom }: { width: number; bottom: V3 }) {
  const mist = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!mist.current) return
    const s = 1 + 0.1 * Math.sin(clock.elapsedTime * 1.4)
    mist.current.scale.set(width * 0.95 * s, 3.2 * (2 - s), width * 0.6 * s)
  })
  return (
    <mesh ref={mist} position={[bottom[0], bottom[1] + 1.8, bottom[2]]} scale={[width * 0.95, 3.2, width * 0.6]}>
      <primitive object={G.ico} attach="geometry" dispose={null} />
      <Surf color={P.mist} transparent opacity={0.34} />
    </mesh>
  )
}

/** White curtain from `top` to `bottom`, oriented across the flow, with lip and pool foam. */
export function Falls({ top, bottom, flow, width, pulse = false }: FallSpec & { width: number; pulse?: boolean }) {
  const frame = useMemo(() => {
    const T = new THREE.Vector3(top[0], top[1], top[2])
    const B = new THREE.Vector3(bottom[0], bottom[1], bottom[2])
    const zAxis = B.clone().sub(T)
    const length = zAxis.length()
    zAxis.normalize()
    const f = new THREE.Vector3(flow[0], 0, flow[1]).normalize()
    const xAxis = new THREE.Vector3(-f.z, 0, f.x)
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize()
    xAxis.crossVectors(yAxis, zAxis).normalize()
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis))
    return { position: T.clone().lerp(B, 0.5), quaternion, length }
  }, [top, bottom, flow])
  return (
    <group>
      <mesh position={frame.position} quaternion={frame.quaternion} scale={[width, 1.3, frame.length]} castShadow>
        <primitive object={G.boxC} attach="geometry" dispose={null} />
        <Surf color={P.foam} />
      </mesh>
      <mesh position={[top[0], top[1] + 0.2, top[2]]} scale={[width * 0.6, 0.9, width * 0.35]}>
        <primitive object={G.ico} attach="geometry" dispose={null} />
        <Surf color={P.foam} />
      </mesh>
      <mesh position={[bottom[0], bottom[1] + 0.3, bottom[2]]} scale={[width * 0.8, 1.2, width * 0.55]}>
        <primitive object={G.ico} attach="geometry" dispose={null} />
        <Surf color={P.foam} transparent opacity={0.85} />
      </mesh>
      {pulse ? (
        <MistPulse width={width} bottom={bottom} />
      ) : (
        <mesh position={[bottom[0], bottom[1] + 1.8, bottom[2]]} scale={[width * 0.95, 3.2, width * 0.6]}>
          <primitive object={G.ico} attach="geometry" dispose={null} />
          <Surf color={P.mist} transparent opacity={0.3} />
        </mesh>
      )}
    </group>
  )
}

/**
 * Water ribbon laid on the carved channel; drops steeper than ~1 m between samples become
 * waterfalls automatically, so the same river reads as reaches, pools and falls.
 */
export function River({
  points,
  height,
  width,
  night,
  depth = 0.6,
  step = 3,
  hero = false,
}: {
  points: readonly V2[]
  height: HeightFn
  width: number
  night: boolean
  depth?: number
  step?: number
  hero?: boolean
}) {
  const built = useMemo(() => {
    const path = smoothPath(points, step)
    const samples = path.map(([x, z]) => [x, height(x, z) + depth, z] as V3)
    const falls: FallSpec[] = []
    let i = 0
    while (i < samples.length - 1) {
      if (samples[i][1] - samples[i + 1][1] > 0.9) {
        const start = i
        while (i < samples.length - 1 && samples[i][1] - samples[i + 1][1] > 0.35) i++
        const top = samples[start]
        const bottom = samples[i]
        if (top[1] - bottom[1] > 1.8) falls.push({ top, bottom, flow: [bottom[0] - top[0], bottom[2] - top[2]] })
      } else {
        i++
      }
    }
    falls.sort((a, b) => b.top[1] - b.bottom[1] - (a.top[1] - a.bottom[1]))
    return { geometry: ribbonGeometry(samples, width), falls }
  }, [points, height, width, depth, step])
  useDisposable(built.geometry)
  return (
    <group>
      <mesh geometry={built.geometry} receiveShadow>
        <Surf color={night ? P.waterNight : P.water} side={THREE.DoubleSide} />
      </mesh>
      {built.falls.map((fall, k) => (
        <Falls key={k} {...fall} width={width * 0.92} pulse={hero && k === 0} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ paths, decks, stairs */

export function Path({
  points,
  width,
  height,
  color = P.path,
  lift = 0.14,
  step = 3,
  closed = false,
}: {
  points: readonly V2[]
  width: number
  height: HeightFn
  color?: string
  lift?: number
  step?: number
  closed?: boolean
}) {
  const geometry = useDisposable(
    useMemo(() => {
      const path = smoothPath(points, step, closed)
      return ribbonGeometry(
        path.map(([x, z]) => [x, height(x, z) + lift, z] as V3),
        width,
      )
    }, [points, width, height, lift, step, closed]),
  )
  return (
    <mesh geometry={geometry} receiveShadow>
      <Surf color={color} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** Flat plank ribbon at a fixed height; with `ground` it stands on stilts (docks, stilt walkways). */
export function Boardwalk({
  points,
  width,
  y,
  ground,
  color = P.deck,
  step = 3,
}: {
  points: readonly V2[]
  width: number
  y: number
  ground?: number
  color?: string
  step?: number
}) {
  const built = useMemo(() => {
    const path = smoothPath(points, step)
    const geometry = ribbonGeometry(
      path.map(([x, z]) => [x, y, z] as V3),
      width,
    )
    const stilts: THREE.Matrix4[] = []
    if (ground !== undefined) {
      for (let i = 0; i < path.length; i += 2) {
        const prev = path[Math.max(0, i - 1)]
        const next = path[Math.min(path.length - 1, i + 1)]
        const dx = next[0] - prev[0]
        const dz = next[1] - prev[1]
        const len = Math.hypot(dx, dz) || 1
        for (const s of [-1, 1]) {
          const px = path[i][0] + (-dz / len) * s * (width / 2 - 0.3)
          const pz = path[i][1] + (dx / len) * s * (width / 2 - 0.3)
          stilts.push(placeMatrix(M(), px, ground - 0.5, pz, 0, 0.24, y - ground + 0.5, 0.24))
        }
      }
    }
    return { geometry, stilts }
  }, [points, width, y, ground, step])
  useDisposable(built.geometry)
  return (
    <group>
      <mesh geometry={built.geometry} castShadow receiveShadow>
        <Surf color={color} side={THREE.DoubleSide} />
      </mesh>
      <Instances geometry={G.stiltB} matrices={built.stilts}>
        <Surf color={P.bark} />
      </Instances>
    </group>
  )
}

/** Overlapping treads that follow the terrain: flat on the level, a staircase on slopes. */
export function Stairs({
  points,
  width,
  height,
  step = 1.1,
  color = P.deck,
  lift = 0.22,
}: {
  points: readonly V2[]
  width: number
  height: HeightFn
  step?: number
  color?: string
  lift?: number
}) {
  const matrices = useMemo(() => {
    const path = smoothPath(points, step)
    return mats(path.length - 1, (i, m) => {
      const [x0, z0] = path[i]
      const [x1, z1] = path[i + 1]
      const mx = (x0 + x1) / 2
      const mz = (z0 + z1) / 2
      placeMatrix(m, mx, height(mx, mz) + lift, mz, Math.atan2(x1 - x0, z1 - z0), width, 0.5, step * 1.45)
    })
  }, [points, width, height, step, lift])
  return (
    <Instances geometry={G.boxC} matrices={matrices}>
      <Surf color={color} />
    </Instances>
  )
}

/* ------------------------------------------------------------------ canopy */

export interface Tree {
  x: number
  y: number
  z: number
  /** Crown centre above ground. */
  crown: number
  radius: number
  squash: number
  yaw: number
  /** 0 bright low canopy, 1 dark low canopy, 2 emergent. */
  kind: 0 | 1 | 2
}

const CROWN_COLORS = [P.canopyBright, P.canopy, P.canopyDark] as const

export function Canopy({ trees }: { trees: readonly Tree[] }) {
  const crowns = useMemo(
    () =>
      [0, 1, 2].map((kind) =>
        trees
          .filter((tree) => tree.kind === kind)
          .map((tree) => placeMatrix(M(), tree.x, tree.y + tree.crown, tree.z, tree.yaw, tree.radius, tree.radius * tree.squash, tree.radius)),
      ),
    [trees],
  )
  const trunks = useMemo(
    () =>
      trees
        .filter((tree) => tree.kind === 2 || tree.crown - tree.radius * tree.squash > 3.2)
        .map((tree) => placeMatrix(M(), tree.x, tree.y - 0.4, tree.z, tree.yaw, tree.radius * 0.16, tree.crown + 0.4, tree.radius * 0.16)),
    [trees],
  )
  return (
    <group>
      {crowns.map((list, kind) => (
        <Instances key={kind} geometry={G.ico} matrices={list}>
          <Surf color={CROWN_COLORS[kind]} />
        </Instances>
      ))}
      <Instances geometry={G.trunkB} matrices={trunks}>
        <Surf color={P.bark} />
      </Instances>
    </group>
  )
}

/* ------------------------------------------------------------------ giant trees with decks (refs 01, 02) */

export interface BigTree {
  x: number
  y: number
  z: number
  /** Trunk height to the crown base. */
  h: number
  r: number
  crown: number
  /** Deck heights above the base. */
  decks?: readonly number[]
  /** Deck radius multiplier (civic decks are wider). */
  deckScale?: number
  ladder?: boolean
}

export function bigTreeDeckRadius(tree: BigTree): number {
  return Math.max(5, tree.r * 3.2) * (tree.deckScale ?? 1)
}

export function BigTrees({ trees, night }: { trees: readonly BigTree[]; night: boolean }) {
  const built = useMemo(() => {
    const trunks: THREE.Matrix4[] = []
    const roots: THREE.Matrix4[] = []
    const crowns: THREE.Matrix4[] = []
    const crownsDark: THREE.Matrix4[] = []
    const clumps: THREE.Matrix4[] = []
    const decks: THREE.Matrix4[] = []
    const posts: THREE.Matrix4[] = []
    const rails: THREE.Matrix4[] = []
    const ladders: THREE.Matrix4[] = []
    const lanterns: V3[] = []
    for (const t of trees) {
      trunks.push(placeMatrix(M(), t.x, t.y - 0.6, t.z, 0.3, t.r, t.h + t.crown * 0.45, t.r))
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.4
        roots.push(leanMatrix(M(), t.x + Math.cos(a) * t.r * 1.1, t.y - 0.4, t.z + Math.sin(a) * t.r * 1.1, -a, 0.55, t.r * 2.2, 3.2, t.r * 0.6))
      }
      const top = t.y + t.h
      crowns.push(placeMatrix(M(), t.x, top + t.crown * 0.25, t.z, 0.2, t.crown, t.crown * 0.6, t.crown))
      crownsDark.push(placeMatrix(M(), t.x + t.crown * 0.6, top - t.crown * 0.05, t.z - t.crown * 0.35, 1.1, t.crown * 0.72, t.crown * 0.42, t.crown * 0.72))
      crowns.push(placeMatrix(M(), t.x - t.crown * 0.55, top + t.crown * 0.02, t.z + t.crown * 0.4, 2.3, t.crown * 0.66, t.crown * 0.4, t.crown * 0.66))
      crownsDark.push(placeMatrix(M(), t.x + t.crown * 0.1, top + t.crown * 0.5, t.z + t.crown * 0.1, 0.7, t.crown * 0.5, t.crown * 0.35, t.crown * 0.5))
      const R = bigTreeDeckRadius(t)
      const deckList = t.decks ?? []
      deckList.forEach((d, index) => {
        decks.push(placeMatrix(M(), t.x, t.y + d, t.z, index * 0.3, R, 0.5, R))
        const a0 = index * 0.9
        clumps.push(placeMatrix(M(), t.x + Math.cos(a0) * R * 0.75, t.y + d + 3.6, t.z + Math.sin(a0) * R * 0.75, a0, R * 0.55, R * 0.28, R * 0.55))
        clumps.push(placeMatrix(M(), t.x + Math.cos(a0 + 2.6) * t.r * 1.6, t.y + d + 2.2 + index, t.z + Math.sin(a0 + 2.6) * t.r * 1.6, a0, R * 0.32, R * 0.2, R * 0.32))
        const corners: THREE.Vector3[] = []
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + index * 0.3
          const p = new THREE.Vector3(t.x + Math.cos(a) * (R - 0.35), t.y + d + 0.25, t.z + Math.sin(a) * (R - 0.35))
          corners.push(p)
          posts.push(placeMatrix(M(), p.x, p.y, p.z, 0, 0.22, 1.15, 0.22))
        }
        for (let k = 0; k < 8; k++) {
          const a = corners[k].clone().setY(corners[k].y + 1.05)
          const b = corners[(k + 1) % 8].clone().setY(corners[k].y + 1.05)
          rails.push(segmentMatrix(M(), a, b, 0.12, 0.12))
        }
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + 0.6 + index * 0.3
          lanterns.push([t.x + Math.cos(a) * (R - 0.9), t.y + d + 1.5, t.z + Math.sin(a) * (R - 0.9)])
        }
      })
      if (t.ladder && deckList.length > 0) {
        const d = deckList[0]
        const a = 1.2
        const lx = t.x + Math.cos(a) * (R - 0.6)
        const lz = t.z + Math.sin(a) * (R - 0.6)
        const sx = -Math.sin(a) * 0.5
        const sz = Math.cos(a) * 0.5
        ladders.push(placeMatrix(M(), lx + sx, t.y, lz + sz, -a, 0.14, d + 1.2, 0.14))
        ladders.push(placeMatrix(M(), lx - sx, t.y, lz - sz, -a, 0.14, d + 1.2, 0.14))
        const rungs = Math.min(9, Math.round(d / 1.3))
        for (let k = 1; k <= rungs; k++) ladders.push(placeMatrix(M(), lx, t.y + (k * d) / (rungs + 1), lz, -a, 1.1, 0.1, 0.1))
      }
    }
    return { trunks, roots, crowns, crownsDark, clumps, decks, posts, rails, ladders, lanterns }
  }, [trees])
  return (
    <group>
      <Instances geometry={G.trunkB} matrices={built.trunks}>
        <Surf color={P.bark} />
      </Instances>
      <Instances geometry={G.boxB} matrices={built.roots}>
        <Surf color={P.bark} />
      </Instances>
      <Instances geometry={G.ico} matrices={built.crowns}>
        <Surf color={P.canopy} />
      </Instances>
      <Instances geometry={G.ico} matrices={built.crownsDark}>
        <Surf color={P.canopyDark} />
      </Instances>
      <Instances geometry={G.ico} matrices={built.clumps}>
        <Surf color={P.canopyBright} />
      </Instances>
      <Instances geometry={G.disc} matrices={built.decks}>
        <Surf color={P.deck} />
      </Instances>
      <Instances geometry={G.boxB} matrices={built.posts} shadow={false}>
        <Surf color={P.barkLight} />
      </Instances>
      <Instances geometry={G.boxC} matrices={built.rails} shadow={false}>
        <Surf color={P.rope} />
      </Instances>
      <Instances geometry={G.boxB} matrices={built.ladders} shadow={false}>
        <Surf color={P.barkLight} />
      </Instances>
      <GlowPoints points={built.lanterns} night={night} color={P.window} size={0.4} poles={false} />
    </group>
  )
}

/* ------------------------------------------------------------------ trunk towers and galleries (ref 04, not literal) */

export interface TowerSpec {
  x: number
  y: number
  z: number
  floors: number
  radius: number
  floorHeight?: number
  roof: string
  /** Crown radius of the trunk that rises through the tower; 0 for a free-standing tower. */
  crown?: number
}

export function towerTop(t: TowerSpec): number {
  return t.y + t.floors * (t.floorHeight ?? 4.2)
}

export function TrunkTowers({ towers, night }: { towers: readonly TowerSpec[]; night: boolean }) {
  const built = useMemo(() => {
    const trunks: THREE.Matrix4[] = []
    const crowns: THREE.Matrix4[] = []
    const floors: THREE.Matrix4[] = []
    const walls: THREE.Matrix4[] = []
    const roofs: THREE.Matrix4[] = []
    const spires: THREE.Matrix4[] = []
    const windows: THREE.Matrix4[] = []
    const posts: THREE.Matrix4[] = []
    for (const t of towers) {
      const fh = t.floorHeight ?? 4.2
      const H = t.floors * fh
      const crown = t.crown ?? 0
      if (crown > 0) {
        trunks.push(placeMatrix(M(), t.x, t.y - 0.5, t.z, 0, t.radius * 0.42, H + 7 + crown * 0.4, t.radius * 0.42))
        crowns.push(placeMatrix(M(), t.x, t.y + H + 7 + crown * 0.3, t.z, 0.4, crown, crown * 0.6, crown))
        crowns.push(placeMatrix(M(), t.x + crown * 0.55, t.y + H + 6.5, t.z - crown * 0.3, 1.3, crown * 0.7, crown * 0.42, crown * 0.7))
      }
      for (let k = 0; k < t.floors; k++) {
        const R = t.radius * (1 - k * 0.07)
        const y = t.y + k * fh
        floors.push(placeMatrix(M(), t.x, y + 0.25, t.z, k * 0.2, R, 0.5, R))
        walls.push(placeMatrix(M(), t.x, y + 0.5, t.z, k * 0.2, R * 0.78, fh - 0.5, R * 0.78))
        for (let w = 0; w < 4; w++) {
          const a = (w / 4) * Math.PI * 2 + k * 0.2 + 0.4
          windows.push(placeMatrix(M(), t.x + Math.cos(a) * R * 0.8, y + fh * 0.55, t.z + Math.sin(a) * R * 0.8, -a + Math.PI / 2, 1.1, 0.9, 0.25))
        }
        for (let p = 0; p < 6; p++) {
          const a = (p / 6) * Math.PI * 2 + k * 0.2
          posts.push(placeMatrix(M(), t.x + Math.cos(a) * (R - 0.3), y + 0.5, t.z + Math.sin(a) * (R - 0.3), -a, 0.2, 1.1, 0.2))
        }
      }
      const Rt = t.radius * (1 - (t.floors - 1) * 0.07)
      roofs.push(placeMatrix(M(), t.x, t.y + H, t.z, 0.2, Rt * 1.25, fh * 1.4, Rt * 1.25))
      spires.push(placeMatrix(M(), t.x, t.y + H + fh * 1.3, t.z, 0, 0.5, 2.6, 0.5))
    }
    return { trunks, crowns, floors, walls, roofs, spires, windows, posts }
  }, [towers])
  const roofColors = useMemo(() => Array.from(new Set(towers.map((t) => t.roof))), [towers])
  const roofsByColor = useMemo(
    () =>
      roofColors.map((color) => ({
        color,
        matrices: built.roofs.filter((_, i) => towers[i].roof === color),
      })),
    [roofColors, built.roofs, towers],
  )
  return (
    <group>
      <Instances geometry={G.trunkB} matrices={built.trunks}>
        <Surf color={P.bark} />
      </Instances>
      <Instances geometry={G.ico} matrices={built.crowns}>
        <Surf color={P.canopy} />
      </Instances>
      <Instances geometry={G.disc} matrices={built.floors}>
        <Surf color={P.deck} />
      </Instances>
      <Instances geometry={G.wall8} matrices={built.walls}>
        <Surf color={P.hutWall} />
      </Instances>
      {roofsByColor.map(({ color, matrices }) => (
        <Instances key={color} geometry={G.cone8} matrices={matrices}>
          <Surf color={color} />
        </Instances>
      ))}
      <Instances geometry={G.cone8} matrices={built.spires} shadow={false}>
        <Surf color={P.bark} />
      </Instances>
      <Instances geometry={G.boxC} matrices={built.windows} shadow={false}>
        <Glow color={P.window} on={night} intensity={1.5} />
      </Instances>
      <Instances geometry={G.boxB} matrices={built.posts} shadow={false}>
        <Surf color={P.barkLight} />
      </Instances>
    </group>
  )
}

export interface GallerySpec {
  a: V3
  b: V3
}

/** Covered elevated walkways between towers and decks, on posts down to the ground. */
export function Galleries({ items, height, roof = P.thatchDark }: { items: readonly GallerySpec[]; height: HeightFn; roof?: string }) {
  const built = useMemo(() => {
    const floors: THREE.Matrix4[] = []
    const rails: THREE.Matrix4[] = []
    const roofs: THREE.Matrix4[] = []
    const posts: THREE.Matrix4[] = []
    for (const { a, b } of items) {
      const A = new THREE.Vector3(a[0], a[1], a[2])
      const B = new THREE.Vector3(b[0], b[1], b[2])
      const dir = B.clone().sub(A).setY(0).normalize()
      const side = new THREE.Vector3(-dir.z, 0, dir.x)
      floors.push(segmentMatrix(M(), A, B, 2.8, 0.35))
      for (const s of [-1, 1]) {
        const off = side.clone().multiplyScalar(s * 1.3).setY(1.0)
        rails.push(segmentMatrix(M(), A.clone().add(off), B.clone().add(off), 0.12, 0.12))
      }
      const up = new THREE.Vector3(0, 3.1, 0)
      roofs.push(segmentMatrix(M(), A.clone().add(up), B.clone().add(up), 3.8, 0.3))
      roofs.push(segmentMatrix(M(), A.clone().add(up).setY(A.y + 3.6), B.clone().add(up).setY(B.y + 3.6), 1.2, 0.6))
      const span = A.distanceTo(B)
      const count = Math.max(1, Math.round(span / 8))
      for (let i = 0; i <= count; i++) {
        const p = A.clone().lerp(B, i / count)
        for (const s of [-1, 1]) {
          const q = p.clone().add(side.clone().multiplyScalar(s * 1.2))
          const ground = height(q.x, q.z) - 0.4
          posts.push(placeMatrix(M(), q.x, ground, q.z, 0, 0.3, p.y - ground + 3.2, 0.3))
        }
      }
    }
    return { floors, rails, roofs, posts }
  }, [items, height])
  return (
    <group>
      <Instances geometry={G.boxC} matrices={built.floors}>
        <Surf color={P.deck} />
      </Instances>
      <Instances geometry={G.boxC} matrices={built.rails} shadow={false}>
        <Surf color={P.rope} />
      </Instances>
      <Instances geometry={G.boxC} matrices={built.roofs}>
        <Surf color={roof} />
      </Instances>
      <Instances geometry={G.boxB} matrices={built.posts}>
        <Surf color={P.bark} />
      </Instances>
    </group>
  )
}

/* ------------------------------------------------------------------ houses */

export interface Hut {
  x: number
  y: number
  z: number
  yaw: number
  w: number
  d: number
  h: number
  /** Ground height under a stilt hut; stilts are drawn from here to the floor. */
  ground?: number
  /** Round pod (ref 03) instead of a box hut. */
  pod?: boolean
}

/** Huts and pods: wood walls, one jewel roof colour (per district), two warm windows, optional stilts. */
export function Huts({ huts, night, wall = P.hutWall, roof = P.thatch }: { huts: readonly Hut[]; night: boolean; wall?: string; roof?: string }) {
  const built = useMemo(() => {
    const bodies: THREE.Matrix4[] = []
    const pods: THREE.Matrix4[] = []
    const roofs: THREE.Matrix4[] = []
    const caps: THREE.Matrix4[] = []
    const windows: THREE.Matrix4[] = []
    const stilts: THREE.Matrix4[] = []
    const chimneys: THREE.Matrix4[] = []
    for (const hut of huts) {
      const c = Math.cos(hut.yaw)
      const s = Math.sin(hut.yaw)
      const local = (ox: number, oz: number): [number, number] => [hut.x + ox * c + oz * s, hut.z - ox * s + oz * c]
      if (hut.pod) {
        const r = Math.max(hut.w, hut.d) / 2
        pods.push(placeMatrix(M(), hut.x, hut.y + hut.h * 0.45, hut.z, hut.yaw, r * 1.05, hut.h * 0.55, r * 1.05))
        caps.push(placeMatrix(M(), hut.x, hut.y + hut.h * 0.62, hut.z, hut.yaw, r * 1.2, hut.h * 0.6, r * 1.2))
      } else {
        bodies.push(placeMatrix(M(), hut.x, hut.y, hut.z, hut.yaw, hut.w, hut.h, hut.d))
        roofs.push(placeMatrix(M(), hut.x, hut.y + hut.h - 0.05, hut.z, hut.yaw, hut.w * 0.9, hut.h * 0.75, hut.d * 0.9))
        const [cx, cz] = local(hut.w * 0.28, -hut.d * 0.2)
        chimneys.push(placeMatrix(M(), cx, hut.y + hut.h + hut.h * 0.3, cz, hut.yaw, 0.5, hut.h * 0.45, 0.5))
      }
      for (const side of [-1, 1]) {
        const [wx, wz] = local(0, side * (hut.d / 2 + (hut.pod ? 0.0 : 0.08)))
        windows.push(placeMatrix(M(), wx, hut.y + hut.h * 0.48, wz, hut.yaw, Math.min(1.2, hut.w * 0.28), 0.8, 0.3))
      }
      if (hut.ground !== undefined && hut.y - hut.ground > 0.3) {
        for (const ox of [-1, 1]) {
          for (const oz of [-1, 1]) {
            const [sx, sz] = local(ox * (hut.w / 2 - 0.45), oz * (hut.d / 2 - 0.45))
            stilts.push(placeMatrix(M(), sx, hut.ground - 0.5, sz, hut.yaw, 0.26, hut.y - hut.ground + 0.5, 0.26))
          }
        }
        bodies.push(placeMatrix(M(), hut.x, hut.y - 0.35, hut.z, hut.yaw, hut.w + 1.6, 0.35, hut.d + 1.6))
      }
    }
    return { bodies, pods, roofs, caps, windows, stilts, chimneys }
  }, [huts])
  return (
    <group>
      <Instances geometry={G.boxB} matrices={built.bodies}>
        <Surf color={wall} />
      </Instances>
      <Instances geometry={G.ico} matrices={built.pods}>
        <Surf color={wall} />
      </Instances>
      <Instances geometry={G.roofB} matrices={built.roofs}>
        <Surf color={roof} />
      </Instances>
      <Instances geometry={G.cone8} matrices={built.caps}>
        <Surf color={roof} />
      </Instances>
      <Instances geometry={G.boxB} matrices={built.chimneys} shadow={false}>
        <Surf color={P.stoneDark} />
      </Instances>
      <Instances geometry={G.boxC} matrices={built.windows} shadow={false}>
        <Glow color={P.window} on={night} intensity={1.5} />
      </Instances>
      <Instances geometry={G.stiltB} matrices={built.stilts}>
        <Surf color={P.bark} />
      </Instances>
    </group>
  )
}

/* ------------------------------------------------------------------ rope bridges */

export interface BridgeSpec {
  a: V3
  b: V3
  planks?: number
  sag?: number
}

function bridgeParts({ a, b, planks = 14, sag = 0.07 }: BridgeSpec) {
  const A = new THREE.Vector3(a[0], a[1], a[2])
  const B = new THREE.Vector3(b[0], b[1], b[2])
  const span = A.distanceTo(B)
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= planks; i++) {
    const t = i / planks
    const p = A.clone().lerp(B, t)
    p.y -= sag * span * 4 * t * (1 - t)
    pts.push(p.sub(A))
  }
  const dir = B.clone().sub(A).setY(0).normalize()
  const side = new THREE.Vector3(-dir.z, 0, dir.x)
  const plankMats = mats(planks, (i, m) => segmentMatrix(m, pts[i], pts[i + 1], 2.1, 0.16, 0.78))
  const ropeMats: THREE.Matrix4[] = []
  for (const s of [-1, 1]) {
    const off = side.clone().multiplyScalar(s * 1.1).setY(1.05)
    for (let i = 0; i < planks; i++) ropeMats.push(segmentMatrix(M(), pts[i].clone().add(off), pts[i + 1].clone().add(off), 0.12, 0.12, 1.04))
  }
  const postMats: THREE.Matrix4[] = []
  for (const end of [pts[0], pts[planks]]) {
    for (const s of [-1, 1]) {
      const p = end.clone().add(side.clone().multiplyScalar(s * 1.1))
      postMats.push(placeMatrix(M(), p.x, p.y - 0.2, p.z, 0, 0.32, 1.5, 0.32))
    }
  }
  const lights: V3[] = []
  for (let i = 2; i < planks - 1; i += 3) lights.push([pts[i].x, pts[i].y + 1.0, pts[i].z])
  return { plankMats, ropeMats, postMats, lights, axis: B.clone().sub(A).normalize() }
}

/** Static rope bridges, batched: one draw call for every plank, rope segment and post; string lights at night. */
export function RopeBridges({ bridges, night, lit = true }: { bridges: readonly BridgeSpec[]; night: boolean; lit?: boolean }) {
  const built = useMemo(() => {
    const planks: THREE.Matrix4[] = []
    const ropes: THREE.Matrix4[] = []
    const posts: THREE.Matrix4[] = []
    const lights: V3[] = []
    for (const bridge of bridges) {
      const parts = bridgeParts(bridge)
      const shift = new THREE.Matrix4().makeTranslation(bridge.a[0], bridge.a[1], bridge.a[2])
      planks.push(...parts.plankMats.map((m) => m.premultiply(shift)))
      ropes.push(...parts.ropeMats.map((m) => m.premultiply(shift)))
      posts.push(...parts.postMats.map((m) => m.premultiply(shift)))
      lights.push(...parts.lights.map((p): V3 => [p[0] + bridge.a[0], p[1] + bridge.a[1], p[2] + bridge.a[2]]))
    }
    return { planks, ropes, posts, lights }
  }, [bridges])
  return (
    <group>
      <Instances geometry={G.boxC} matrices={built.planks}>
        <Surf color={P.deck} />
      </Instances>
      <Instances geometry={G.boxC} matrices={built.ropes} shadow={false}>
        <Surf color={P.rope} />
      </Instances>
      <Instances geometry={G.boxC} matrices={built.posts}>
        <Surf color={P.bark} />
      </Instances>
      {lit ? <GlowPoints points={built.lights} night={night} color={P.window} size={0.28} poles={false} /> : null}
    </group>
  )
}

/** The one animated bridge per scene: a slow sway about its own chord. */
export function SwayingBridge({ night, ...spec }: BridgeSpec & { night: boolean }) {
  const built = useMemo(() => bridgeParts(spec), [spec])
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (group.current) group.current.quaternion.setFromAxisAngle(built.axis, Math.sin(clock.elapsedTime * 0.6) * 0.03)
  })
  return (
    <group ref={group} position={[spec.a[0], spec.a[1], spec.a[2]]}>
      <Instances geometry={G.boxC} matrices={built.plankMats}>
        <Surf color={P.deck} />
      </Instances>
      <Instances geometry={G.boxC} matrices={built.ropeMats} shadow={false}>
        <Surf color={P.rope} />
      </Instances>
      <Instances geometry={G.boxC} matrices={built.postMats}>
        <Surf color={P.bark} />
      </Instances>
      <GlowPoints points={built.lights} night={night} color={P.window} size={0.28} poles={false} />
    </group>
  )
}

/* ------------------------------------------------------------------ ruin commons and landmark */

export function Columns({
  items,
  radius = 0.7,
  color = P.stone,
}: {
  items: readonly { x: number; y: number; z: number; h: number }[]
  radius?: number
  color?: string
}) {
  const matrices = useMemo(() => items.map((c) => placeMatrix(M(), c.x, c.y, c.z, 0, radius, c.h, radius)), [items, radius])
  return (
    <Instances geometry={G.columnB} matrices={matrices}>
      <Surf color={color} />
    </Instances>
  )
}

/** Axis-aligned slabs (plazas, piers, platforms, lintels): [x, y, z, w, h, d, yaw?]. */
export function Slabs({ items, color = P.stone }: { items: readonly (readonly number[])[]; color?: string }) {
  const matrices = useMemo(() => items.map((s) => placeMatrix(M(), s[0], s[1], s[2], s[6] ?? 0, s[3], s[4], s[5])), [items])
  return (
    <Instances geometry={G.boxB} matrices={matrices}>
      <Surf color={color} />
    </Instances>
  )
}

/** The Ruin Commons' broken root gate: two roots leaning into an arch over a pale broken stone U, vines hanging. */
export function RootGate({ x, y, z, yaw = 0, height = 14 }: { x: number; y: number; z: number; yaw?: number; height?: number }) {
  const built = useMemo(() => {
    const roots: THREE.Matrix4[] = []
    const stones: THREE.Matrix4[] = []
    const vines: THREE.Matrix4[] = []
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const local = (ox: number, oz: number): [number, number] => [x + ox * c + oz * s, z - ox * s + oz * c]
    for (const side of [-1, 1]) {
      const [rx, rz] = local(side * 5.5, 0)
      roots.push(leanMatrix(M(), rx, y - 0.5, rz, yaw, side * 0.3, 1.8, height, 1.6))
      const [px, pz] = local(side * 7.5, 0)
      stones.push(placeMatrix(M(), px, y - 0.4, pz, yaw, 3, side < 0 ? height * 0.55 : height * 0.38, 3))
    }
    const [tx, tz] = local(5.4, 0)
    roots.push(leanMatrix(M(), tx, y + height * 0.86, tz, yaw, Math.PI / 2 - 0.08, 1.4, 11, 1.4))
    for (let k = 0; k < 6; k++) {
      const [vx, vz] = local(-4.5 + k * 1.8, 0.5)
      vines.push(placeMatrix(M(), vx, y + height * 0.84 - (3 + (k % 3) * 1.8), vz, 0, 0.25, 3 + (k % 3) * 1.8, 0.25))
    }
    return { roots, stones, vines }
  }, [x, y, z, yaw, height])
  return (
    <group>
      <Instances geometry={G.boxB} matrices={built.roots}>
        <Surf color={P.bark} />
      </Instances>
      <Instances geometry={G.boxB} matrices={built.stones}>
        <Surf color={P.stone} />
      </Instances>
      <Instances geometry={G.boxB} matrices={built.vines} shadow={false}>
        <Surf color={P.canopyBright} />
      </Instances>
    </group>
  )
}

/** The landmark, Root-Crown Shrine at stage 3: plinth, root tripod, ring deck, crown hall with canopy fins and a lantern ring. */
export function RootCrownShrine({ x, y, z, night }: { x: number; y: number; z: number; night: boolean }) {
  const built = useMemo(() => {
    const roots: THREE.Matrix4[] = []
    const fins: THREE.Matrix4[] = []
    const lanterns: V3[] = []
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5
      roots.push(leanMatrix(M(), x + Math.cos(a) * 4.2, y + 0.4, z + Math.sin(a) * 4.2, -a, 0.42, 1.4, 9.5, 1.4))
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 1.5
      fins.push(placeMatrix(M(), x + Math.cos(a) * 5.5, y + 19.5, z + Math.sin(a) * 5.5, a, 4.5, 2.8, 4.5))
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      lanterns.push([x + Math.cos(a) * 6.6, y + 12.8, z + Math.sin(a) * 6.6])
    }
    return { roots, fins, lanterns }
  }, [x, y, z])
  return (
    <group>
      <mesh position={[x, y - 0.6, z]} scale={[10, 1.6, 10]} castShadow receiveShadow>
        <primitive object={G.disc} attach="geometry" dispose={null} />
        <Surf color={P.stone} />
      </mesh>
      <Instances geometry={G.boxB} matrices={built.roots}>
        <Surf color={P.bark} />
      </Instances>
      <mesh position={[x, y, z]} scale={[1.7, 16, 1.7]} castShadow>
        <primitive object={G.trunkB} attach="geometry" dispose={null} />
        <Surf color={P.bark} />
      </mesh>
      <mesh position={[x, y + 11.6, z]} scale={[7.2, 0.5, 7.2]} castShadow receiveShadow>
        <primitive object={G.disc} attach="geometry" dispose={null} />
        <Surf color={P.deck} />
      </mesh>
      <mesh position={[x, y + 12, z]} scale={[4.4, 5.6, 4.4]} castShadow>
        <primitive object={G.wall8} attach="geometry" dispose={null} />
        <Surf color={P.hutWall} />
      </mesh>
      <mesh position={[x, y + 17.4, z]} scale={[5.6, 5.2, 5.6]} castShadow>
        <primitive object={G.cone8} attach="geometry" dispose={null} />
        <Surf color={P.gold} />
      </mesh>
      <Instances geometry={G.ico} matrices={built.fins}>
        <Surf color={P.canopy} />
      </Instances>
      <GlowPoints points={built.lanterns} night={night} color={P.window} size={0.4} poles={false} />
      <GlowPoints
        points={[
          [x + 1.6, y + 15, z + 3.6],
          [x - 3.6, y + 15, z - 1.4],
          [x + 2.4, y + 15, z - 3.2],
        ]}
        night={night}
        color={P.window}
        size={0.5}
        poles={false}
      />
    </group>
  )
}

/* ------------------------------------------------------------------ ground life */

/** Reed clumps at the water's edge (ref 01): six thin blades each. */
export function Reeds({ clumps, y, color = P.reed }: { clumps: readonly V2[]; y: number; color?: string }) {
  const matrices = useMemo(() => {
    const out: THREE.Matrix4[] = []
    clumps.forEach(([x, z], i) => {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + i
        out.push(leanMatrix(M(), x + Math.cos(a) * 0.8, y - 0.4, z + Math.sin(a) * 0.8, a, 0.12 + (k % 3) * 0.05, 0.16, 1.6 + ((i + k) % 4) * 0.5, 0.16))
      }
    })
    return out
  }, [clumps, y])
  return (
    <Instances geometry={G.stiltB} matrices={matrices} shadow={false}>
      <Surf color={color} />
    </Instances>
  )
}

/** Bamboo stands: three tall thin stalks with leaf tufts. */
export function Bamboo({ clumps, height }: { clumps: readonly V2[]; height: HeightFn }) {
  const built = useMemo(() => {
    const stalks: THREE.Matrix4[] = []
    const tufts: THREE.Matrix4[] = []
    clumps.forEach(([x, z], i) => {
      const y = height(x, z) - 0.3
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + i * 0.7
        const h = 7 + ((i + k) % 4) * 1.3
        const sx = x + Math.cos(a) * 0.9
        const sz = z + Math.sin(a) * 0.9
        stalks.push(leanMatrix(M(), sx, y, sz, a, 0.06, 0.22, h, 0.22))
        tufts.push(placeMatrix(M(), sx + Math.cos(a) * 0.6, y + h - 0.6, sz + Math.sin(a) * 0.6, a, 1.3, 0.7, 1.3))
      }
    })
    return { stalks, tufts }
  }, [clumps, height])
  return (
    <group>
      <Instances geometry={G.stiltB} matrices={built.stalks} shadow={false}>
        <Surf color={P.bamboo} />
      </Instances>
      <Instances geometry={G.ico} matrices={built.tufts} shadow={false}>
        <Surf color={P.canopyBright} />
      </Instances>
    </group>
  )
}

/** Farm plots: a pale bed with dark furrows. [x, z, w, d, yaw] */
export function Farms({ plots, height }: { plots: readonly (readonly number[])[]; height: HeightFn }) {
  const built = useMemo(() => {
    const beds: THREE.Matrix4[] = []
    const furrows: THREE.Matrix4[] = []
    for (const [x, z, w, d, yaw = 0] of plots) {
      const y = height(x, z)
      beds.push(placeMatrix(M(), x, y - 0.1, z, yaw, w, 0.35, d))
      const rows = Math.max(2, Math.floor(w / 2.2))
      const c = Math.cos(yaw)
      const s = Math.sin(yaw)
      for (let k = 0; k < rows; k++) {
        const ox = -w / 2 + (k + 0.5) * (w / rows)
        furrows.push(placeMatrix(M(), x + ox * c, y + 0.2, z - ox * s, yaw, 0.5, 0.3, d * 0.9))
      }
    }
    return { beds, furrows }
  }, [plots, height])
  return (
    <group>
      <Instances geometry={G.boxB} matrices={built.beds} shadow={false}>
        <Surf color={P.farm} />
      </Instances>
      <Instances geometry={G.boxB} matrices={built.furrows} shadow={false}>
        <Surf color={P.furrow} />
      </Instances>
    </group>
  )
}

/** Dye racks: two posts, a bar, and a hanging cloth in the district jewel. [x, z, yaw] */
export function DyeRacks({ racks, height, color }: { racks: readonly (readonly number[])[]; height: HeightFn; color: string }) {
  const built = useMemo(() => {
    const posts: THREE.Matrix4[] = []
    const cloths: THREE.Matrix4[] = []
    for (const [x, z, yaw = 0] of racks) {
      const y = height(x, z) - 0.2
      const c = Math.cos(yaw)
      const s = Math.sin(yaw)
      for (const side of [-1, 1]) posts.push(placeMatrix(M(), x + side * 2 * c, y, z - side * 2 * s, yaw, 0.2, 3.2, 0.2))
      posts.push(placeMatrix(M(), x, y + 3.1, z, yaw, 4.4, 0.15, 0.15))
      cloths.push(placeMatrix(M(), x, y + 1.0, z, yaw, 3.4, 2.1, 0.12))
    }
    return { posts, cloths }
  }, [racks, height])
  return (
    <group>
      <Instances geometry={G.boxB} matrices={built.posts} shadow={false}>
        <Surf color={P.barkLight} />
      </Instances>
      <Instances geometry={G.boxB} matrices={built.cloths}>
        <Surf color={color} side={THREE.DoubleSide} />
      </Instances>
    </group>
  )
}

/** Chimney smoke that drifts upward; the one animated element in the Forest Settlement. */
export function Smoke({ chimneys }: { chimneys: readonly V3[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = chimneys.length * 3
  const scratch = useMemo(() => new THREE.Matrix4(), [])
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const time = clock.elapsedTime
    chimneys.forEach((c, i) => {
      for (let k = 0; k < 3; k++) {
        const phase = (i * 0.37 + k / 3) % 1
        const t = (time * 0.12 + phase) % 1
        const s = 0.7 + t * 2.2
        placeMatrix(scratch, c[0] + Math.sin(t * 5 + i) * 0.8 + t * 1.5, c[1] + t * 9, c[2] + Math.cos(t * 4 + i) * 0.5, 0, s, s * 0.8, s)
        mesh.setMatrixAt(i * 3 + k, scratch)
      }
    })
    mesh.instanceMatrix.needsUpdate = true
  })
  if (count === 0) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <primitive object={G.ico} attach="geometry" dispose={null} />
      <Surf color={P.smoke} transparent opacity={0.45} />
    </instancedMesh>
  )
}

/* ------------------------------------------------------------------ small things */

export function GlowPoints({
  points,
  night,
  color = P.torch,
  size = 0.55,
  offColor = '#6c4c37',
  intensity = 1.8,
  poles = true,
}: {
  points: readonly V3[]
  night: boolean
  color?: string
  size?: number
  offColor?: string
  intensity?: number
  poles?: boolean
}) {
  const heads = useMemo(() => points.map((p) => placeMatrix(M(), p[0], p[1], p[2], 0.3, size, size * 1.5, size)), [points, size])
  const sticks = useMemo(() => (poles ? points.map((p) => placeMatrix(M(), p[0], p[1] - 2.2, p[2], 0, 0.2, 2.2, 0.2)) : []), [points, poles])
  return (
    <group>
      <Instances geometry={G.glow} matrices={heads} shadow={false}>
        <Glow color={color} on={night} offColor={offColor} intensity={intensity} />
      </Instances>
      <Instances geometry={G.boxB} matrices={sticks} shadow={false}>
        <Surf color={P.bark} />
      </Instances>
    </group>
  )
}

/** A waterwheel: an eight-sided disc stood on edge, half in the race. */
export function Wheel({ x, y, z, radius, yaw = 0 }: { x: number; y: number; z: number; radius: number; yaw?: number }) {
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} scale={[radius, 0.7, radius]} castShadow>
        <primitive object={G.disc} attach="geometry" dispose={null} />
        <Surf color={P.bark} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]} scale={[radius * 0.55, 1.1, radius * 0.55]} castShadow>
        <primitive object={G.disc} attach="geometry" dispose={null} />
        <Surf color={P.deck} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.35, 2.6, 0.35]}>
        <primitive object={G.disc} attach="geometry" dispose={null} />
        <Surf color={P.barkLight} />
      </mesh>
    </group>
  )
}

export function Canoes({ items, y }: { items: readonly V2[]; y: number }) {
  const matrices = useMemo(() => items.map(([x, z], i) => placeMatrix(M(), x, y, z, i * 1.7, 0.75, 0.32, 2.4)), [items, y])
  return (
    <Instances geometry={G.ico} matrices={matrices}>
      <Surf color={P.bark} />
    </Instances>
  )
}

/** Toybox residents: a peach blob with a bigger blob head, 1.8 m tall, placed by (x, y, z). */
export function Walkers({ items }: { items: readonly V3[] }) {
  const bodies = useMemo(() => items.map((p, i) => placeMatrix(M(), p[0], p[1] + 0.55, p[2], i * 0.9, 0.5, 0.6, 0.5)), [items])
  const heads = useMemo(() => items.map((p, i) => placeMatrix(M(), p[0], p[1] + 1.3, p[2], i * 0.9 + 0.5, 0.58, 0.55, 0.58)), [items])
  return (
    <group>
      <Instances geometry={G.ico} matrices={bodies}>
        <Surf color={P.creature} />
      </Instances>
      <Instances geometry={G.ico} matrices={heads}>
        <Surf color={P.creature} />
      </Instances>
    </group>
  )
}

/** Writes the scene's triangle count (instances multiplied) to `<html data-jungle-triangles>` for the budget check. */
export function TriangleProbe() {
  const scene = useThree((state) => state.scene)
  useEffect(() => {
    let total = 0
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const geometry = mesh.geometry
      const triangles = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3
      total += triangles * ((object as THREE.InstancedMesh).isInstancedMesh ? (object as THREE.InstancedMesh).count : 1)
    })
    document.documentElement.dataset.jungleTriangles = String(Math.round(total))
  })
  return null
}
