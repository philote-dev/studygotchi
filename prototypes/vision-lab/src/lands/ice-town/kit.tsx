/**
 * Rendering kit for the three Ice blockouts: the land palette, a handful of unit geometries
 * (every cabin, pine, pier, floe and penguin is an instance of one of these), the instanced-mesh
 * wrapper, the faceted terrain renderer, `WorldMeshes` (draws everything a `WorldData` holds), and
 * the hero silhouettes the references use: the oversized lighthouse on its rock, the ice arch,
 * the research mast, the icebreaker, the church, the lit plaza tree, the whale, the balloon.
 * Everything draws with the lab's cached toon materials.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Glow, Surf, toonMaterial } from '../../render/materials'
import type { FacetClassifier, Heightfield } from './terrain'
import type { Boat, Cabin, Pine, Placement, WorldData } from './world'

/** Ice / Chilly Town palette: soft pale snow, pale cyan ice, deep teal water, warm cabin accents. */
export const ICE = {
  snow: '#eef4f7',
  snowAlt: '#e4edf3',
  snowShadow: '#d9e5ee',
  paleIce: '#d8e9f4',
  iceShade: '#c3dcef',
  plateSide: '#9dd3e6',
  plateSideDeep: '#82c3dc',
  lakeIce: '#cfe6f5',
  lakeIceAlt: '#dbeefa',
  paving: '#cdd9e4',
  planks: '#9c7a5a',
  timber: '#6b5343',
  water: '#357a90',
  waterDeep: '#235a6c',
  waterNight: '#16304a',
  cream: '#f4e9d2',
  white: '#fbfcfd',
  red: '#c8524a',
  orange: '#e08a4f',
  blue: '#5a86b0',
  teal: '#5f9ea8',
  slate: '#8a97a8',
  pine: '#5f8f78',
  pineDeep: '#4f7f68',
  pineSnow: '#e9f1f5',
  stationRed: '#d9553f',
  yellow: '#e8b64a',
  crystal: '#7fd0ee',
  crystalDeep: '#46a9e6',
  penguin: '#3a3f52',
  seal: '#9a8a7c',
  light: '#ffe7a3',
  treeLight: '#bfe6ff',
  coral: '#e88a8a',
  peach: '#f2a86f',
  lilac: '#c9a2e6',
  whale: '#3d6f85',
  lampOff: '#aaa4b4',
} as const

/* ---------- unit geometries (base on y = 0 so `y` is always the ground) ---------- */

function up(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  return geo.translate(0, 0.5, 0)
}

/** Gable roof: ridge along z, base y 0 → ridge y 1, width 1 (x), depth 1 (z). Six facets, no floor. */
function gable(): THREE.BufferGeometry {
  const A = [-0.5, 0, 0.5]
  const B = [0.5, 0, 0.5]
  const T = [0, 1, 0.5]
  const A2 = [-0.5, 0, -0.5]
  const B2 = [0.5, 0, -0.5]
  const T2 = [0, 1, -0.5]
  const tris = [
    [A, B, T],
    [B2, A2, T2],
    [A, T, T2],
    [A, T2, A2],
    [B, B2, T2],
    [B, T2, T],
  ]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat(2)), 3))
  geo.computeVertexNormals()
  return geo
}

export const GEO = {
  box: up(new THREE.BoxGeometry(1, 1, 1)),
  roof: gable(),
  cone: up(new THREE.ConeGeometry(1, 1, 6)),
  pyramid: up(new THREE.ConeGeometry(1, 1, 4)),
  cyl: up(new THREE.CylinderGeometry(1, 1, 1, 8)),
  hex: up(new THREE.CylinderGeometry(1, 1, 1, 6)),
  spire: up(new THREE.CylinderGeometry(0.12, 1, 1, 5)),
  dome: new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
  sphere: new THREE.SphereGeometry(1, 8, 6),
} as const

export function triangles(geo: THREE.BufferGeometry): number {
  return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3
}

/* ---------- materials ---------- */

export const mat = (color: string) => toonMaterial({ color })

/** Same semantics as `<Glow>`, for instanced lights: muted grey by day, emissive at night. */
export function glowMaterial(color: string, on: boolean, intensity = 1.6, offColor: string = ICE.lampOff) {
  return toonMaterial({ color: on ? color : offColor, emissive: on ? color : '#000000', emissiveIntensity: on ? intensity : 0 })
}

/* ---------- instancing ---------- */

export function Instanced({
  geometry,
  material,
  items,
  shadow = true,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  items: readonly Placement[]
  shadow?: boolean
}) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length))
    const o = new THREE.Object3D()
    items.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z)
      if (it.lookAt) o.lookAt(it.lookAt[0], it.lookAt[1], it.lookAt[2])
      else o.rotation.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0)
      o.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    })
    m.count = items.length
    m.instanceMatrix.needsUpdate = true
    m.castShadow = shadow
    m.receiveShadow = shadow
    // The base geometry's bounding sphere sits at the origin; instances are everywhere.
    m.frustumCulled = false
    return m
  }, [geometry, material, items, shadow])
  useEffect(() => () => mesh.dispose(), [mesh])
  return <primitive object={mesh} />
}

/* ---------- terrain ---------- */

/**
 * Facet rule for ice lands: steep faces are pale cyan plate sides (paler ice shade high on the
 * rounded mountains), gentle slopes snow-shadow, flats a two-tone snow quilt, the wet shore pale
 * ice; facets fully under the sea are dropped. `mask` runs first for lakes, lanes and leads.
 */
export function iceFacet(options: { highLine?: number; mask?: (cx: number, cz: number, cy: number, ny: number, h: number) => string | null }): FacetClassifier {
  const highLine = options.highLine ?? 30
  return (cx, cy, cz, ny, h, top) => {
    if (top < -1.2) return null
    const masked = options.mask?.(cx, cz, cy, ny, h)
    if (masked) return masked
    if (ny < 0.45) {
      if (cy > highLine) return h < 0.5 ? ICE.paleIce : ICE.iceShade
      return h < 0.5 ? ICE.plateSide : ICE.plateSideDeep
    }
    if (ny < 0.8) return cy > highLine ? ICE.paleIce : ICE.snowShadow
    if (cy < 0.9) return ICE.paleIce
    return h < 0.5 ? ICE.snow : ICE.snowAlt
  }
}

/** Facet colours that glow softly at night (frozen rivers and lakes in the winter-valley reference). */
export const NIGHT_GLOW: Record<string, number> = { [ICE.lakeIce]: 0.32, [ICE.lakeIceAlt]: 0.32 }

export function TerrainMeshes({ field, night }: { field: Heightfield; night: boolean }) {
  const geos = useMemo(
    () =>
      field.groups.map((group) => {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(group.positions, 3))
        geo.computeVertexNormals()
        return { color: group.color, geo }
      }),
    [field],
  )
  useEffect(() => () => geos.forEach((entry) => entry.geo.dispose()), [geos])
  return (
    <>
      {geos.map((entry) => {
        const glow = night ? NIGHT_GLOW[entry.color] : undefined
        return (
          <mesh key={entry.color} geometry={entry.geo} castShadow receiveShadow>
            {glow ? <Surf color={entry.color} emissive={entry.color} emissiveIntensity={glow} /> : <Surf color={entry.color} />}
          </mesh>
        )
      })}
    </>
  )
}

export function Sea({ night, y = 0 }: { night: boolean; y?: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={y} receiveShadow>
      <planeGeometry args={[2600, 2600]} />
      <Surf color={night ? ICE.waterNight : ICE.water} />
    </mesh>
  )
}

/* ---------- kits ---------- */

/** Cabins: coloured walls, snow gable, white eave trim, white window frame with a lit pane, chimney and smoke. */
export function CabinKit({ cabins, night }: { cabins: readonly Cabin[]; night: boolean }) {
  const parts = useMemo(() => {
    const walls = new Map<string, Placement[]>()
    const roofs: Placement[] = []
    const eaves: Placement[] = []
    const frames: Placement[] = []
    const panes: Placement[] = []
    const chimneys: Placement[] = []
    const smoke: Placement[] = []
    cabins.forEach((c, i) => {
      let list = walls.get(c.color)
      if (!list) {
        list = []
        walls.set(c.color, list)
      }
      list.push({ x: c.x, y: c.y, z: c.z, ry: c.ry, sx: c.w, sy: c.h, sz: c.d })
      roofs.push({ x: c.x, y: c.y + c.h, z: c.z, ry: c.ry, sx: c.w * 1.18, sy: c.h * 0.6, sz: c.d * 1.14 })
      eaves.push({ x: c.x, y: c.y + c.h - 0.35, z: c.z, ry: c.ry, sx: c.w * 1.22, sy: 0.35, sz: c.d * 1.18 })
      const fx = Math.sin(c.ry)
      const fz = Math.cos(c.ry)
      frames.push({ x: c.x + fx * (c.d / 2), y: c.y + c.h * 0.36, z: c.z + fz * (c.d / 2), ry: c.ry, sx: c.w * 0.42, sy: c.h * 0.4, sz: 0.36 })
      panes.push({ x: c.x + fx * (c.d / 2), y: c.y + c.h * 0.4, z: c.z + fz * (c.d / 2), ry: c.ry, sx: c.w * 0.3, sy: c.h * 0.3, sz: 0.5 })
      if (c.chimney) {
        const cx = c.x - fx * c.d * 0.2 + fz * c.w * 0.22
        const cz = c.z - fz * c.d * 0.2 - fx * c.w * 0.22
        const top = c.y + c.h + c.h * 0.6
        chimneys.push({ x: cx, y: top - 1.2, z: cz, ry: c.ry, sx: 0.8, sy: 1.8, sz: 0.8 })
        if (i % 2 === 0) {
          smoke.push({ x: cx + 0.1, y: top + 0.7, z: cz, sx: 0.3, sy: 0.3, sz: 0.3 })
          smoke.push({ x: cx + 0.4, y: top + 1.3, z: cz + 0.15, sx: 0.42, sy: 0.4, sz: 0.42 })
          smoke.push({ x: cx + 0.8, y: top + 2, z: cz + 0.3, sx: 0.55, sy: 0.5, sz: 0.55 })
        }
      }
    })
    return { walls: [...walls.entries()], roofs, eaves, frames, panes, chimneys, smoke }
  }, [cabins])
  return (
    <>
      {parts.walls.map(([color, items]) => (
        <Instanced key={color} geometry={GEO.box} material={mat(color)} items={items} />
      ))}
      <Instanced geometry={GEO.roof} material={mat(ICE.snow)} items={parts.roofs} />
      <Instanced geometry={GEO.box} material={mat(ICE.white)} items={parts.eaves} shadow={false} />
      <Instanced geometry={GEO.box} material={mat(ICE.white)} items={parts.frames} shadow={false} />
      <Instanced geometry={GEO.box} material={glowMaterial(ICE.light, night)} items={parts.panes} shadow={false} />
      <Instanced geometry={GEO.box} material={mat(ICE.slate)} items={parts.chimneys} shadow={false} />
      <Instanced geometry={GEO.sphere} material={mat(ICE.white)} items={parts.smoke} shadow={false} />
    </>
  )
}

export function PineKit({ pines }: { pines: readonly Pine[] }) {
  const parts = useMemo(
    () => ({
      cones: pines.map((p): Placement => ({ x: p.x, y: p.y, z: p.z, sx: p.r, sy: p.h, sz: p.r })),
      caps: pines.map((p): Placement => ({ x: p.x, y: p.y + p.h * 0.5, z: p.z, sx: p.r * 0.62, sy: p.h * 0.52, sz: p.r * 0.62 })),
    }),
    [pines],
  )
  return (
    <>
      <Instanced geometry={GEO.cone} material={mat(ICE.pine)} items={parts.cones} />
      <Instanced geometry={GEO.cone} material={mat(ICE.pineSnow)} items={parts.caps} />
    </>
  )
}

export function LampKit({ lamps, night }: { lamps: readonly Placement[]; night: boolean }) {
  const parts = useMemo(
    () => ({
      posts: lamps.map((l): Placement => ({ x: l.x, y: l.y, z: l.z, sx: 0.26, sy: 3, sz: 0.26 })),
      bulbs: lamps.map((l): Placement => ({ x: l.x, y: l.y + 3, z: l.z, sx: 0.7, sy: 0.7, sz: 0.7 })),
    }),
    [lamps],
  )
  return (
    <>
      <Instanced geometry={GEO.box} material={mat(ICE.timber)} items={parts.posts} shadow={false} />
      <Instanced geometry={GEO.box} material={glowMaterial(ICE.light, night, 2)} items={parts.bulbs} shadow={false} />
    </>
  )
}

export function BoatKit({ boats }: { boats: readonly Boat[] }) {
  const parts = useMemo(() => {
    const hulls = new Map<string, Placement[]>()
    const cabins: Placement[] = []
    for (const b of boats) {
      let list = hulls.get(b.color)
      if (!list) {
        list = []
        hulls.set(b.color, list)
      }
      list.push({ x: b.x, y: -0.35, z: b.z, ry: b.ry, sx: 2.2, sy: 1.1, sz: 5.6 })
      cabins.push({ x: b.x - Math.sin(b.ry) * 1.1, y: 0.75, z: b.z - Math.cos(b.ry) * 1.1, ry: b.ry, sx: 1.6, sy: 1.4, sz: 2 })
    }
    return { hulls: [...hulls.entries()], cabins }
  }, [boats])
  return (
    <>
      {parts.hulls.map(([color, items]) => (
        <Instanced key={color} geometry={GEO.box} material={mat(color)} items={items} />
      ))}
      <Instanced geometry={GEO.box} material={mat(ICE.white)} items={parts.cabins} />
    </>
  )
}

/** Penguins as dots: a dark body and a white belly on the front. */
function PenguinKit({ penguins }: { penguins: readonly Placement[] }) {
  const parts = useMemo(
    () => ({
      bodies: penguins.map((p): Placement => ({ x: p.x, y: p.y, z: p.z, ry: p.ry, sx: 0.6, sy: p.sy ?? 1, sz: 0.5 })),
      bellies: penguins.map((p): Placement => ({
        x: p.x + Math.sin(p.ry ?? 0) * 0.2,
        y: p.y + 0.1,
        z: p.z + Math.cos(p.ry ?? 0) * 0.2,
        ry: p.ry,
        sx: 0.42,
        sy: (p.sy ?? 1) * 0.7,
        sz: 0.24,
      })),
    }),
    [penguins],
  )
  return (
    <>
      <Instanced geometry={GEO.box} material={mat(ICE.penguin)} items={parts.bodies} shadow={false} />
      <Instanced geometry={GEO.box} material={mat(ICE.white)} items={parts.bellies} shadow={false} />
    </>
  )
}

/** Everything a WorldData holds, as instanced meshes; the scenes add their hero JSX on top. */
export function WorldMeshes({ world, night }: { world: WorldData; night: boolean }) {
  return (
    <>
      <TerrainMeshes field={world.field} night={night} />
      <Sea night={night} />
      <CabinKit cabins={world.cabins} night={night} />
      <PineKit pines={world.pines} />
      <LampKit lamps={world.lamps} night={night} />
      <BoatKit boats={world.boats} />
      <PenguinKit penguins={world.penguins} />
      <Instanced geometry={GEO.box} material={mat(ICE.planks)} items={world.decks} />
      <Instanced geometry={GEO.cyl} material={mat(ICE.timber)} items={world.posts} />
      <Instanced geometry={GEO.box} material={mat(ICE.paleIce)} items={world.steps} />
      <Instanced geometry={GEO.hex} material={mat(ICE.paleIce)} items={world.floes} />
      <Instanced geometry={GEO.box} material={mat(ICE.iceShade)} items={world.shards} />
      <Instanced geometry={GEO.spire} material={mat(ICE.crystalDeep)} items={world.crystals} />
      <Instanced geometry={GEO.spire} material={mat(ICE.paleIce)} items={world.pinnacles} />
      <Instanced geometry={GEO.dome} material={mat(ICE.snow)} items={world.igloos} />
      <Instanced geometry={GEO.pyramid} material={mat(ICE.orange)} items={world.tents} />
      <Instanced geometry={GEO.box} material={mat(ICE.seal)} items={world.seals.map((s) => ({ ...s, sx: 1.9, sy: 0.6, sz: 0.9 }))} shadow={false} />
      <Instanced geometry={GEO.box} material={mat(ICE.stationRed)} items={world.modules} />
      <Instanced geometry={GEO.cyl} material={mat(ICE.cream)} items={world.tanks} />
      <Instanced geometry={GEO.box} material={mat(ICE.red)} items={world.vehicles} />
      <Instanced geometry={GEO.box} material={mat(ICE.timber)} items={world.fences} shadow={false} />
    </>
  )
}

/* ---------- hero silhouettes ---------- */

/**
 * The landmark at stage 3 (landmark-ice-town.md): tapered cream tower, three cliff-ice bands,
 * gallery, lamp room, red cap, the igloo annex kept beside it. `s` scales the 8.65 m spec; the
 * references want it oversized, so the blockouts use s ≈ 3.
 */
export function Lighthouse({ x, y, z, s = 3, night }: { x: number; y: number; z: number; s?: number; night: boolean }) {
  const radiusAt = (h: number) => 1.5 - (0.45 / 6.4) * h
  return (
    <group position={[x, y, z]} scale={s}>
      <mesh position-y={3.2} castShadow>
        <cylinderGeometry args={[1.05, 1.5, 6.4, 10]} />
        <Surf color={ICE.white} />
      </mesh>
      {[1.6, 3.4, 5.2].map((h) => (
        <mesh key={h} position-y={h} castShadow>
          <cylinderGeometry args={[radiusAt(h + 0.275) + 0.09, radiusAt(h - 0.275) + 0.09, 0.55, 10]} />
          <Surf color={h === 3.4 ? ICE.red : ICE.plateSide} />
        </mesh>
      ))}
      <mesh position-y={6.25} castShadow>
        <cylinderGeometry args={[1.45, 1.45, 0.3, 10]} />
        <Surf color={ICE.slate} />
      </mesh>
      <mesh position-y={7.3}>
        <cylinderGeometry args={[0.85, 0.85, 1.6, 10]} />
        <Glow color={ICE.light} on={night} intensity={2.2} />
      </mesh>
      <mesh position-y={8.65 - 0.55} castShadow>
        <coneGeometry args={[1.3, 1.1, 10]} />
        <Surf color={ICE.red} />
      </mesh>
      <mesh position={[2.6, 0, 1.4]} scale={[1.3, 0.8, 1.3]} castShadow>
        <primitive object={GEO.dome} attach="geometry" />
        <Surf color={ICE.snow} />
      </mesh>
    </group>
  )
}

/** Rotating translucent beam for the lighthouse at night; parent it at the lamp-room height. */
export function sweepGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(5, 70, 8, 1, true)
  geo.translate(0, -35, 0)
  geo.rotateZ(Math.PI / 2)
  return geo
}

/** Natural ice arch: a chunky half torus standing on its feet. */
export function IceArch({ x, y, z, yaw = 0, span, tube = 3 }: { x: number; y: number; z: number; yaw?: number; span: number; tube?: number }) {
  return (
    <mesh position={[x, y, z]} rotation-y={yaw} castShadow>
      <torusGeometry args={[span / 2, tube, 5, 9, Math.PI]} />
      <Surf color={ICE.paleIce} />
    </mesh>
  )
}

/** Research mast: a tall red lattice stand-in with a white top and a red beacon. */
export function Mast({ x, y, z, h = 24, night }: { x: number; y: number; z: number; h?: number; night: boolean }) {
  return (
    <group position={[x, y, z]}>
      <mesh position-y={h / 2} castShadow>
        <cylinderGeometry args={[0.35, 0.9, h, 4]} />
        <Surf color={ICE.stationRed} />
      </mesh>
      {[0.3, 0.6, 0.85].map((t) => (
        <mesh key={t} position-y={h * t}>
          <boxGeometry args={[2.2, 0.25, 2.2]} />
          <Surf color={ICE.white} />
        </mesh>
      ))}
      <mesh position-y={h + 0.6}>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <Glow color={ICE.red} on={night} intensity={2.4} />
      </mesh>
    </group>
  )
}

export function Helipad({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <group position={[x, y, z]}>
      <mesh position-y={0.15}>
        <cylinderGeometry args={[5, 5, 0.3, 8]} />
        <Surf color={ICE.slate} />
      </mesh>
      <mesh position-y={0.32}>
        <boxGeometry args={[0.8, 0.1, 4.4]} />
        <Surf color={ICE.white} />
      </mesh>
      <mesh position={[-1.6, 0.32, 0]}>
        <boxGeometry args={[0.8, 0.1, 4.4]} />
        <Surf color={ICE.white} />
      </mesh>
      <mesh position={[1.6, 0.32, 0]}>
        <boxGeometry args={[0.8, 0.1, 4.4]} />
        <Surf color={ICE.white} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <boxGeometry args={[4, 0.1, 0.8]} />
        <Surf color={ICE.white} />
      </mesh>
    </group>
  )
}

/** The icebreaker from the arctic-slab reference: warm hull, white house, red funnel, lit bridge. */
export function Icebreaker({ x, z, yaw, night, hull = ICE.yellow }: { x: number; z: number; yaw: number; night: boolean; hull?: string }) {
  return (
    <group position={[x, 0, z]} rotation-y={yaw}>
      <mesh position-y={0.7} castShadow>
        <boxGeometry args={[5.6, 2.6, 20]} />
        <Surf color={hull} />
      </mesh>
      <mesh position={[0, 2.4, 9.2]} rotation-x={0.5} castShadow>
        <boxGeometry args={[4.6, 2, 3.4]} />
        <Surf color={hull} />
      </mesh>
      <mesh position={[0, 3.6, -1]} castShadow>
        <boxGeometry args={[4.4, 3.4, 7]} />
        <Surf color={ICE.white} />
      </mesh>
      <mesh position={[0, 6.4, -3]} castShadow>
        <cylinderGeometry args={[0.9, 1, 2.8, 8]} />
        <Surf color={ICE.red} />
      </mesh>
      <mesh position={[0, 5.8, 2.4]}>
        <boxGeometry args={[3.6, 0.9, 0.5]} />
        <Glow color={ICE.light} on={night} />
      </mesh>
      <mesh position={[0, 8.6, -1]}>
        <boxGeometry args={[0.3, 4, 0.3]} />
        <Surf color={ICE.slate} />
      </mesh>
    </group>
  )
}

/** The red church from the fishing-village reference: tall nave, white trim, steeple with a white spire. */
export function Church({ x, y, z, yaw, night }: { x: number; y: number; z: number; yaw: number; night: boolean }) {
  return (
    <group position={[x, y, z]} rotation-y={yaw}>
      <mesh position-y={3.6} castShadow>
        <boxGeometry args={[8, 7.2, 13]} />
        <Surf color={ICE.red} />
      </mesh>
      <mesh position-y={7.2} scale={[9.4, 4.4, 14.6]} castShadow>
        <primitive object={GEO.roof} attach="geometry" />
        <Surf color={ICE.snow} />
      </mesh>
      <mesh position-y={6.9}>
        <boxGeometry args={[9.6, 0.4, 14.8]} />
        <Surf color={ICE.white} />
      </mesh>
      <mesh position={[0, 7, 4.6]} castShadow>
        <boxGeometry args={[3.4, 14, 3.4]} />
        <Surf color={ICE.red} />
      </mesh>
      <mesh position={[0, 14, 4.6]} scale={[2.6, 5, 2.6]} castShadow>
        <primitive object={GEO.pyramid} attach="geometry" />
        <Surf color={ICE.white} />
      </mesh>
      <mesh position={[0, 3.2, 6.6]}>
        <boxGeometry args={[2.2, 3.4, 0.5]} />
        <Glow color={ICE.light} on={night} />
      </mesh>
      {[-4.05, 4.05].map((sx) =>
        [-3.5, 0, 3.5].map((oz) => (
          <mesh key={`${sx}-${oz}`} position={[sx, 3.8, oz]}>
            <boxGeometry args={[0.4, 2.4, 1.4]} />
            <Glow color={ICE.light} on={night} />
          </mesh>
        )),
      )}
    </group>
  )
}

/** Plaza tree: a big snow pine strung with lights that glow at night, benches round a frozen fountain disc. */
export function LitTree({ x, y, z, night }: { x: number; y: number; z: number; night: boolean }) {
  const lights: Array<[number, number, number]> = []
  for (let i = 0; i < 14; i++) {
    const t = i / 14
    const r = 3.2 * (1 - t * 0.85)
    const a = t * Math.PI * 5
    lights.push([Math.cos(a) * r, 1.2 + t * 7.4, Math.sin(a) * r])
  }
  return (
    <group position={[x, y, z]}>
      <mesh position-y={0.2}>
        <cylinderGeometry args={[6, 6, 0.4, 10]} />
        <Surf color={ICE.lakeIce} />
      </mesh>
      <mesh position-y={0.4} scale={[3.4, 9.2, 3.4]} castShadow>
        <primitive object={GEO.cone} attach="geometry" />
        <Surf color={ICE.pineDeep} />
      </mesh>
      <mesh position-y={5} scale={[2, 4.8, 2]} castShadow>
        <primitive object={GEO.cone} attach="geometry" />
        <Surf color={ICE.pineSnow} />
      </mesh>
      {lights.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[0.45, 0.45, 0.45]} />
          <Glow color={ICE.treeLight} on={night} intensity={2} offColor={ICE.white} />
        </mesh>
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} position={[Math.cos((i / 6) * Math.PI * 2) * 8.5, 0.5, Math.sin((i / 6) * Math.PI * 2) * 8.5]} rotation-y={-(i / 6) * Math.PI * 2}>
          <boxGeometry args={[0.6, 0.8, 2.4]} />
          <Surf color={ICE.teal} />
        </mesh>
      ))}
    </group>
  )
}

export function SkatingRing({ x, y, z, r }: { x: number; y: number; z: number; r: number }) {
  return (
    <mesh position={[x, y + 0.3, z]} rotation-x={Math.PI / 2}>
      <torusGeometry args={[r, 0.3, 4, 12]} />
      <Surf color={ICE.timber} />
    </mesh>
  )
}

/** A whale surfacing: dark teal back and a raised tail fluke a body-length behind. */
export function Whale({ x, z, yaw }: { x: number; z: number; yaw: number }) {
  return (
    <group position={[x, 0, z]} rotation-y={yaw}>
      <mesh position={[0, -0.6, 0]} scale={[3.2, 2.4, 9]} castShadow>
        <primitive object={GEO.dome} attach="geometry" />
        <Surf color={ICE.whale} />
      </mesh>
      <mesh position={[0, 0.2, -2.2]} scale={[1.2, 1.6, 2.4]}>
        <primitive object={GEO.pyramid} attach="geometry" />
        <Surf color={ICE.whale} />
      </mesh>
      <mesh position={[0, 0.4, -13]} rotation={[0.5, 0, 0]} castShadow>
        <boxGeometry args={[6, 0.6, 2.6]} />
        <Surf color={ICE.whale} />
      </mesh>
      <mesh position={[0, -0.5, -12]} scale={[0.9, 3.2, 0.9]}>
        <primitive object={GEO.cyl} attach="geometry" />
        <Surf color={ICE.whale} />
      </mesh>
    </group>
  )
}

/** Hot-air balloon: red envelope with a white band, a basket on ropes. */
export function Balloon({ night }: { night: boolean }) {
  return (
    <group>
      <mesh position-y={10} scale={[6.2, 7, 6.2]} castShadow>
        <primitive object={GEO.sphere} attach="geometry" />
        <Surf color={ICE.red} />
      </mesh>
      <mesh position-y={10} rotation-x={Math.PI / 2}>
        <torusGeometry args={[6.1, 0.9, 5, 14]} />
        <Surf color={ICE.white} />
      </mesh>
      <mesh position-y={3.2} scale={[1.6, 1, 1.6]}>
        <primitive object={GEO.cone} attach="geometry" />
        <Surf color={ICE.red} />
      </mesh>
      <mesh position-y={0.8}>
        <boxGeometry args={[2.2, 1.6, 2.2]} />
        <Surf color={ICE.planks} />
      </mesh>
      <mesh position-y={2.2}>
        <boxGeometry args={[1.2, 0.5, 1.2]} />
        <Glow color={ICE.light} on={night} />
      </mesh>
    </group>
  )
}
