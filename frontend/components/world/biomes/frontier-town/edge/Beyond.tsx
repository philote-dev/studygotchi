import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { FRONTIER_PALETTE as P } from '../layout/biome-layout'
import { Surf } from '../render/materials'
import type { OuterDesert } from './outer/desert'
import { type DressingKind, buildPlaces, buildRoute, dressingGeometry, ferryChannelYaw, laneRibbons, placeBase } from './outer/beyond-build'
import { type Place, cartLanes, cattle, fenceRails, graves, lightFalloff, milestones, placeLights, planLanes, smokeSources, trees } from './outer/places'
import type { OuterMotionRefs } from './motion'
import { PUFFS } from './motion'

/**
 * The inhabited beyond: thirteen places in one merged batch, their dressing instanced, the lanes
 * as flat ribbons, one light per place (dimmer with distance), and the moving things (carts, smoke,
 * the raft, the windmill wheels) registered with the single outer motion loop in Outer.tsx.
 */

const dummy = new THREE.Object3D()
const colour = new THREE.Color()
const colour2 = new THREE.Color()
const LAMP_OFF = '#a9a39a'

interface Placement {
  x: number
  y: number
  z: number
  yaw: number
  scale: number | [number, number, number]
  pitch?: number
}

function Instanced({
  kind,
  night,
  items,
  onMesh,
  frustumCulled = true,
  colours,
  basic = false,
}: {
  kind: DressingKind
  night: boolean
  items: Placement[]
  /** Registers the mesh with the motion loop (kept in a ref; identity changes do not re-place instances). */
  onMesh?: (mesh: THREE.InstancedMesh | null) => void
  frustumCulled?: boolean
  /** Optional per-instance colours (hex). */
  colours?: string[]
  /** Unlit material (the lights). */
  basic?: boolean
}) {
  const geometry = useMemo(() => dressingGeometry(kind, night), [kind, night])
  useEffect(() => () => geometry.dispose(), [geometry])
  const ref = useRef<THREE.InstancedMesh>(null)
  const register = useRef(onMesh)
  register.current = onMesh
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    items.forEach((item, i) => {
      dummy.position.set(item.x, item.y, item.z)
      dummy.rotation.set(item.pitch ?? 0, item.yaw, 0, 'YXZ')
      if (typeof item.scale === 'number') dummy.scale.setScalar(item.scale)
      else dummy.scale.set(...item.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      if (colours) mesh.setColorAt(i, colour.set(colours[i]))
    })
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    register.current?.(mesh)
    return () => register.current?.(null)
  }, [items, colours, geometry])
  if (items.length === 0) return null
  const vertexColours = geometry.getAttribute('color') !== undefined
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, items.length]} frustumCulled={frustumCulled}>
      {basic ? <meshBasicMaterial color="#ffffff" toneMapped={false} fog={false} /> : <Surf color="#ffffff" vertexColors={vertexColours} />}
    </instancedMesh>
  )
}

function localToWorld(p: Place, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.yaw)
  const s = Math.sin(p.yaw)
  return [p.x + (lx * c + lz * s) * p.scale, p.z + (-lx * s + lz * c) * p.scale]
}

export function Beyond({ desert, night, motion }: { desert: OuterDesert; night: boolean; motion: React.MutableRefObject<OuterMotionRefs> }) {
  const places = desert.places
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places])
  const built = useMemo(() => buildPlaces(desert, night), [desert, night])
  useEffect(() => () => built.geometry.dispose(), [built])
  const { lanes } = useMemo(() => planLanes(places, desert.windows), [places, desert.windows])
  const bases = useMemo(() => new Map(places.map((p) => [p.id, placeBase(desert, p)])), [desert, places])

  const ground = (x: number, z: number) => desert.heightAt(x, z)
  const fences = useMemo<Placement[]>(() => fenceRails(places).map((r) => ({ x: r.x, y: ground(r.x, r.z), z: r.z, yaw: r.yaw, scale: [r.scale, byId.get(r.placeId)!.scale, byId.get(r.placeId)!.scale] as [number, number, number] })), [desert, places]) // eslint-disable-line react-hooks/exhaustive-deps
  const herd = useMemo<Placement[]>(() => cattle(places, desert.seed).map((c) => ({ x: c.x, y: ground(c.x, c.z), z: c.z, yaw: c.yaw, scale: c.scale })), [desert, places]) // eslint-disable-line react-hooks/exhaustive-deps
  const grove = useMemo<Placement[]>(() => trees(places, desert.seed).map((t) => ({ x: t.x, y: ground(t.x, t.z), z: t.z, yaw: t.yaw, scale: t.scale })), [desert, places]) // eslint-disable-line react-hooks/exhaustive-deps
  const stones = useMemo<Placement[]>(() => graves(places, desert.seed).map((g) => ({ x: g.x, y: ground(g.x, g.z), z: g.z, yaw: g.yaw, scale: g.scale })), [desert, places]) // eslint-disable-line react-hooks/exhaustive-deps
  const miles = useMemo<Placement[]>(() => milestones(lanes).map((m) => ({ x: m.x, y: ground(m.x, m.z), z: m.z, yaw: m.yaw, scale: 1 })), [desert, lanes]) // eslint-disable-line react-hooks/exhaustive-deps
  const ribbons = useMemo<Placement[]>(() => laneRibbons(desert, lanes).map((r) => ({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: r.pitch, scale: [r.width, 1, r.length] as [number, number, number] })), [desert, lanes])

  // One light per place: the sphere grows and dims with distance so the horizon is a scatter of lights.
  const lights = useMemo(() => placeLights(places), [places])
  const lightItems = useMemo<Placement[]>(() => lights.map((l) => ({ x: l.x, y: (bases.get(l.placeId) ?? 0) + l.dy, z: l.z, yaw: 0, scale: l.radius })), [lights, bases])
  const lightColours = useMemo(
    () =>
      lights.map((l) => {
        if (!night) return LAMP_OFF
        const fall = lightFalloff(byId.get(l.placeId)!.distance)
        return `#${colour.set(P.lamp).lerp(colour2.set(P.skyNight), 1 - fall).getHexString()}`
      }),
    [lights, night, byId],
  )

  // Motion sources: cart routes, smoke puffs, windmill wheels, the raft.
  const routes = useMemo(() => cartLanes(lanes).map((lane) => buildRoute(desert, lane)), [desert, lanes])
  const smoke = useMemo(() => smokeSources(places).map((s) => ({ ...s, y: (bases.get(s.placeId) ?? 0) + s.dy })), [places, bases])
  const smokeItems = useMemo<Placement[]>(() => smoke.flatMap((s) => Array.from({ length: PUFFS }, () => ({ x: s.x, y: s.y, z: s.z, yaw: 0, scale: 0.001 }))), [smoke])
  const smokeColours = useMemo(() => smoke.flatMap((s) => Array.from({ length: PUFFS }, () => (s.dust ? (night ? '#4e4138' : '#dcbd90') : night ? '#3e3a48' : '#e6d9c6'))), [smoke, night])
  const cartItems = useMemo<Placement[]>(() => routes.map(() => ({ x: 0, y: -50, z: 0, yaw: 0, scale: 1 })), [routes])
  const wheelPoses = useMemo(
    () =>
      places
        .filter((p) => p.kind === 'ranch')
        .map((p) => {
          const [x, z] = localToWorld(p, 18, -12.5)
          return { x, y: (bases.get(p.id) ?? 0) + 9.1 * p.scale, z, yaw: p.yaw, scale: p.scale }
        }),
    [places, bases],
  )
  const wheelItems = useMemo<Placement[]>(() => wheelPoses.map((w) => ({ x: w.x, y: w.y, z: w.z, yaw: w.yaw, scale: w.scale })), [wheelPoses])
  const ferry = places.find((p) => p.kind === 'ferry') ?? null
  const raftPose = useMemo(() => (ferry ? { x: ferry.x, y: (bases.get(ferry.id) ?? 0) - 0.25, z: ferry.z, yaw: ferryChannelYaw(desert, ferry) } : null), [desert, ferry, bases])
  const raftGeometry = useMemo(() => dressingGeometry('raft', night), [night])
  useEffect(() => () => raftGeometry.dispose(), [raftGeometry])

  useEffect(() => {
    const m = motion.current
    m.cartRoutes = routes
    m.smokeSources = smoke
    m.wheelPoses = wheelPoses
    m.raftPose = raftPose
  }, [motion, routes, smoke, wheelPoses, raftPose])

  return (
    <group name="edge-beyond">
      <mesh geometry={built.geometry}>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      <Instanced kind="fence" night={night} items={fences} />
      <Instanced kind="cattle" night={night} items={herd} />
      <Instanced kind="tree" night={night} items={grove} />
      <Instanced kind="grave" night={night} items={stones} />
      <Instanced kind="milestone" night={night} items={miles} />
      <Instanced kind="lane" night={night} items={ribbons} />
      <Instanced kind="light" night={night} items={lightItems} colours={lightColours} frustumCulled={false} basic />
      <Instanced kind="smoke" night={night} items={smokeItems} colours={smokeColours} frustumCulled={false} onMesh={(mesh) => void (motion.current.smoke = mesh)} />
      <Instanced kind="cart" night={night} items={cartItems} frustumCulled={false} onMesh={(mesh) => void (motion.current.carts = mesh)} />
      <Instanced kind="wheel" night={night} items={wheelItems} frustumCulled={false} onMesh={(mesh) => void (motion.current.wheels = mesh)} />
      {raftPose && (
        <group
          position={[raftPose.x, raftPose.y, raftPose.z]}
          rotation={[0, raftPose.yaw, 0]}
          ref={(g) => {
            motion.current.raft = g
          }}
        >
          <mesh geometry={raftGeometry}>
            <Surf color="#ffffff" vertexColors />
          </mesh>
        </group>
      )}
    </group>
  )
}
