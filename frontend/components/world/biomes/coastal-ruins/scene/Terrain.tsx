import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { COASTAL_PALETTE as P, COASTAL_RUINS_LAYOUT, type BiomeLayout, type SkylineProfile, seeded } from '../layout/biome-layout'
import { fbm, sampleTerrain, seaStacks, smoothstep, type GroundMaterial } from '../layout/terrain'
import { OLIVE_SPOTS, STONE_SPOTS, WATCH_X, stoneSpotScale } from '../layout/dressing'
import { buildEscarpmentGrid, escarpmentHeight, hillDots, type EscarpmentGrid, type HillDot } from '../layout/escarpment'
import { Surf, toonRamp } from '../render/materials'
import { useCollider } from '../../collision/ColliderRegistry'
import { dressingColliders, escarpmentColliders, seaStackColliders } from '../collision/footprints'
import { bindHazeSpace, patchHaze, type HazeUniforms } from '../edge/sea/horizon-haze'
import { SEA_HORIZON } from '../edge/sea/sea-horizon'

const SEGMENTS = 280

const DAY_COLORS: Record<GroundMaterial, string> = {
  sea: '#246f89',
  shallows: P.shallows,
  limestone: P.ground,
  terrace: '#ded2b1',
  'ruin-bed': '#58aeb8',
}

const NIGHT_COLORS: Record<GroundMaterial, string> = {
  sea: P.waterNight,
  shallows: P.shallowsNight,
  limestone: '#676e72',
  terrace: '#60686a',
  'ruin-bed': '#2f6f78',
}

export function Terrain({ layout, night }: { layout: BiomeLayout; night: boolean }) {
  const built = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(layout.worldExtent * 2, layout.worldExtent * 2, SEGMENTS, SEGMENTS)
    geometry.rotateX(-Math.PI / 2)
    const positions = geometry.attributes.position as THREE.BufferAttribute
    const samples = Array.from({ length: positions.count }, (_, index) => {
      const sample = sampleTerrain(layout, positions.getX(index), positions.getZ(index))
      positions.setY(index, sample.height)
      return sample
    })
    geometry.computeVertexNormals()
    return { geometry, samples }
  }, [layout])

  const geometry = useMemo(() => {
    const positions = built.geometry.attributes.position as THREE.BufferAttribute
    const normals = built.geometry.attributes.normal as THREE.BufferAttribute
    const colors = new Float32Array(positions.count * 3)
    const color = new THREE.Color()
    const palette = night ? NIGHT_COLORS : DAY_COLORS
    for (let index = 0; index < positions.count; index++) {
      const sample = built.samples[index]
      color.set(palette[sample.material])
      if (sample.material === 'limestone' || sample.material === 'terrace') {
        if (normals.getY(index) < 0.75) color.set(night ? P.cliffNight : P.cliff)
        else {
          const broad = fbm(positions.getX(index) * 0.025, positions.getZ(index) * 0.025)
          const grain = fbm(positions.getX(index) * 0.11, positions.getZ(index) * 0.11)
          color.offsetHSL(broad * 0.015, broad * 0.025, broad * 0.12 + grain * 0.035)
        }
      } else if (sample.material === 'ruin-bed') {
        color.offsetHSL(0, fbm(positions.getX(index) * 0.09, positions.getZ(index) * 0.09) * 0.08, fbm(positions.getX(index) * 0.04, positions.getZ(index) * 0.04) * 0.12)
      }
      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b
    }
    built.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return built.geometry
  }, [built, night])

  return (
    <mesh geometry={geometry} receiveShadow castShadow>
      <Surf color="#ffffff" vertexColors />
    </mesh>
  )
}

/**
 * The authored water disc. With the outer world on, `haze` installs the horizon haze on its
 * material (identical to the plain fog within the land's view depths) and the disc runs out to
 * the horizon radius under the haze wall; neither changes a pixel the overview sees.
 */
export function Water({ layout, night, haze = null }: { layout: BiomeLayout; night: boolean; haze?: HazeUniforms | null }) {
  const colour = night ? P.waterNight : P.water
  const hazed = useMemo(() => {
    if (!haze) return null
    const material = new THREE.MeshToonMaterial({ color: colour, gradientMap: toonRamp(), transparent: true, opacity: 0.78 })
    patchHaze(material, haze, 1, true, 1 / layout.renderScale)
    return material
  }, [haze, colour, layout.renderScale])
  useEffect(() => () => hazed?.dispose(), [hazed])
  const bind = useMemo(() => (object: THREE.Object3D | null) => {
    if (object && haze) bindHazeSpace(object, haze)
  }, [haze])
  return (
    <group>
      {hazed ? (
        // Keyed apart from the plain disc: a swapped `material` prop on a reused mesh would reset to the default material.
        <mesh key="hazed" ref={bind} position={[0, layout.seaLevel, 0]} rotation={[-Math.PI / 2, 0, 0]} material={hazed} receiveShadow>
          <circleGeometry args={[SEA_HORIZON.horizonRadius, 144]} />
        </mesh>
      ) : (
        <mesh key="plain" position={[0, layout.seaLevel, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[1800, 72]} />
          <Surf color={colour} transparent opacity={0.78} />
        </mesh>
      )}
      <mesh position={[0, layout.seaLevel + 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[520, 72]} />
        <meshBasicMaterial color={night ? '#1d5265' : '#3f97aa'} transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </group>
  )
}

function coastPoints(layout: BiomeLayout): Array<{ x: number; z: number; yaw: number; length: number }> {
  const coast = layout.coastline.slice(11, 25)
  const points: Array<{ x: number; z: number; yaw: number; length: number }> = []
  for (let index = 1; index < coast.length; index++) {
    const a = coast[index - 1]
    const b = coast[index]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    points.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), length })
  }
  return points
}

export function CoastFoam({ layout, night }: { layout: BiomeLayout; night: boolean }) {
  const points = useMemo(() => coastPoints(layout), [layout])
  return (
    <group>
      {points.map((point, index) => (
        <mesh key={index} position={[point.x, layout.seaLevel + 0.09, point.z]} rotation={[-Math.PI / 2, 0, -point.yaw]}>
          <planeGeometry args={[1.1, point.length]} />
          <meshBasicMaterial color={night ? '#85aeb4' : '#f8f2df'} transparent opacity={0.7} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function patchGeometry(points: Array<[number, number]>): THREE.BufferGeometry {
  const vertices = points.flatMap(([x, z]) => [x, 0, z])
  const indices: number[] = []
  for (let index = 1; index < points.length - 1; index++) indices.push(0, index, index + 1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function GroundPatch({ points, color, y = 2.48 }: { points: Array<[number, number]>; color: string; y?: number }) {
  const geometry = useMemo(() => patchGeometry(points), [points])
  return (
    <mesh geometry={geometry} position={[0, y, 0]} receiveShadow>
      <Surf color={color} side={THREE.DoubleSide} />
    </mesh>
  )
}

function OliveTree({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.25, 2.4, 6]} />
        <Surf color="#76604d" />
      </mesh>
      {[[0, 2.5, 0, 1.2], [0.75, 2.15, 0.15, 0.82], [-0.65, 2.1, -0.2, 0.76]].map(([x, y, z, radius], index) => (
        <mesh key={index} position={[x, y, z]} scale={[1.25, 0.7, 1]} castShadow>
          <dodecahedronGeometry args={[radius, 0]} />
          <Surf color={index === 0 ? P.olive : '#87936c'} />
        </mesh>
      ))}
    </group>
  )
}

function StoneCluster({ position, yaw, scale = 1 }: { position: [number, number, number]; yaw: number; scale?: number }) {
  return (
    <group position={position} rotation={[0, yaw, 0]} scale={scale}>
      {[[0, 0.65, 0, 1.15], [1.35, 0.4, 0.4, 0.72], [-1.05, 0.34, 0.7, 0.62]].map(([x, y, z, radius], index) => (
        <mesh key={index} position={[x, y, z]} scale={[1.25, 0.75, 1]} castShadow receiveShadow>
          <dodecahedronGeometry args={[radius, 0]} />
          <Surf color={index === 0 ? P.roadEdge : P.ruin} />
        </mesh>
      ))}
    </group>
  )
}

function GrassTuft({ position, yaw }: { position: [number, number, number]; yaw: number }) {
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {[-0.35, 0, 0.35].map((x, index) => (
        <mesh key={x} position={[x, 0.38 + index * 0.08, 0]} rotation={[0, 0, (index - 1) * 0.28]}>
          <coneGeometry args={[0.16, 0.8 + index * 0.12, 4]} />
          <Surf color={index === 1 ? '#89906b' : '#9c9a75'} />
        </mesh>
      ))}
    </group>
  )
}

/** Authored negative-space dressing: broad material seams, sparse olives, scrub, and limestone. */
export function CoastalDressing({ night }: { night: boolean }) {
  const stoneSpots = STONE_SPOTS
  const oliveSpots = OLIVE_SPOTS
  useCollider(useMemo(() => dressingColliders(), []))
  const grass = useMemo(() => {
    const rng = seeded(4409)
    return Array.from({ length: 38 }, (_, index) => ({
      position: [(-84 + rng() * 165), 2.46, (-70 + rng() * 122)] as [number, number, number],
      yaw: rng() * Math.PI * 2,
      show: index % 3 !== 0,
    })).filter((item) => item.show)
  }, [])
  const shade = night ? 0.7 : 1
  return (
    <group>
      <GroundPatch color={night ? '#5b5f5c' : '#d9cfad'} points={[[-82, -69], [-55, -75], [-42, -60], [-55, -42], [-86, -47]]} />
      <GroundPatch color={night ? '#5e615e' : '#ded5b8'} points={[[10, -67], [38, -70], [44, -48], [25, -35], [5, -44]]} />
      <GroundPatch color={night ? '#555d5c' : '#d3c6a0'} points={[[-82, -5], [-52, -10], [-42, 14], [-61, 30], [-89, 20]]} />
      <GroundPatch color={night ? '#596260' : '#e0d7bc'} points={[[18, -14], [48, -8], [51, 17], [33, 30], [12, 18]]} />
      {stoneSpots.map(([x, y, z, yaw], index) => <StoneCluster key={index} position={[x, y, z]} yaw={yaw} scale={stoneSpotScale(index)} />)}
      {oliveSpots.map(([x, y, z, scale], index) => <OliveTree key={index} position={[x, y, z]} scale={scale} />)}
      {grass.map((item, index) => <GrassTuft key={index} position={item.position} yaw={item.yaw} />)}
      <mesh position={[-9, 2.5, -10]} rotation={[-Math.PI / 2, 0, 0.18]}>
        <planeGeometry args={[42, 2.4]} />
        <meshBasicMaterial color={P.roadEdge} transparent opacity={0.45 * shade} />
      </mesh>
    </group>
  )
}

/** Escarpment colours: cream treads (two tones alternating), a darker retaining-wall riser, the back row paler and greyer. */
const HILL_DAY = { tread: '#b4a67c', tread2: '#c6b890', riser: '#7d6c48', backTread: '#a7b1a4', backRiser: '#7f8c84', crest: P.ground }
const HILL_NIGHT = { tread: '#5d5753', tread2: '#605a56', riser: '#433e3a', backTread: '#3d4c57', backRiser: '#303d47', crest: '#6a6762' }

/** The terraced hill surface as one indexed mesh with smooth normals and per-vertex colours. */
function hillGeometry(grid: EscarpmentGrid, night: boolean): THREE.BufferGeometry {
  const { nx, nz, cell, minX, minZ } = grid
  const positions = new Float32Array(nx * nz * 3)
  const colors = new Float32Array(nx * nz * 3)
  const palette = night ? HILL_NIGHT : HILL_DAY
  const c = new THREE.Color()
  const riserColour = new THREE.Color()
  const crest = new THREE.Color(palette.crest)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const x = minX + i * cell
      const z = minZ + j * cell
      positions[k * 3] = x
      // Lifted a hair so the strip never fights the plain it rests on where the hills fade out.
      positions[k * 3 + 1] = grid.height[k] + 0.04
      positions[k * 3 + 2] = z
      const back = grid.back[k]
      const even = grid.tread[k] % 2 === 0
      // Front hills: two close tread tones with a clearly darker wall stripe; the back row one soft tone.
      c.set(back > 0.5 ? palette.backTread : even ? palette.tread : palette.tread2)
      c.lerp(riserColour.set(back > 0.5 ? palette.backRiser : palette.riser), grid.riser[k] * (back > 0.5 ? 0.6 : 1))
      // The high crests pale toward the cap colour; a little grain like the plain.
      c.lerp(crest, 0.35 * smoothstep(9, 16, grid.mass[k]) * (1 - grid.riser[k]))
      c.offsetHSL(0, 0, fbm(x * 0.11, z * 0.11) * 0.03)
      colors[k * 3] = c.r
      colors[k * 3 + 1] = c.g
      colors[k * 3 + 2] = c.b
    }
  }
  const indices: number[] = []
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      const b = a + 1
      const d = a + nx
      const e = d + 1
      // Skip cells that lie flat on the plain (no hill under any corner).
      if (grid.mass[a] + grid.mass[b] + grid.mass[d] + grid.mass[e] < 0.05) continue
      if ((i + j) % 2 === 0) indices.push(a, d, b, b, d, e)
      else indices.push(a, d, e, a, e, b)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/** Scrub and olive dots on the treads (one instanced mesh per kind). */
function HillDots({ dots, night }: { dots: HillDot[]; night: boolean }) {
  const scrub = useRef<THREE.InstancedMesh>(null)
  const olive = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const counts = [dots.filter((d) => d.kind === 0).length, dots.filter((d) => d.kind === 1).length]
  useLayoutEffect(() => {
    for (const [kind, ref] of [[0, scrub], [1, olive]] as const) {
      const mesh = ref.current
      if (!mesh) continue
      let i = 0
      for (const d of dots) {
        if (d.kind !== kind) continue
        dummy.position.set(d.x, d.y + (kind === 1 ? 1.1 * d.scale : 0.25 * d.scale), d.z)
        dummy.rotation.set(0, d.x * 0.7, 0)
        dummy.scale.set(d.scale * (kind === 1 ? 1.3 : 1.1), d.scale * (kind === 1 ? 0.9 : 0.55), d.scale)
        dummy.updateMatrix()
        mesh.setMatrixAt(i++, dummy.matrix)
      }
      mesh.count = i
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [dots, dummy])
  return (
    <>
      <instancedMesh ref={scrub} args={[undefined, undefined, Math.max(1, counts[0])]} frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <Surf color={night ? '#4d5a50' : '#8e9470'} />
      </instancedMesh>
      <instancedMesh ref={olive} args={[undefined, undefined, Math.max(1, counts[1])]} frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <Surf color={night ? '#3f4c43' : P.olive} />
      </instancedMesh>
    </>
  )
}

function WatchVillage({ x, y, z, index, night }: { x: number; y: number; z: number; index: number; night: boolean }) {
  const height = 4.6 + (index % 2) * 1.2
  return (
    <group position={[x, y, z]} rotation={[0, (index - 1.5) * 0.12, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[6.8, height, 5.4]} />
        <Surf color={night ? '#89847d' : P.plaster} />
      </mesh>
      <mesh position={[0, height + 0.2, 0]}>
        <boxGeometry args={[7.3, 0.4, 5.9]} />
        <Surf color={P.ruin} />
      </mesh>
      <mesh position={[0, height * 0.58, 2.74]}>
        <boxGeometry args={[1.1, 1.9, 0.15]} />
        <Surf color={night ? '#243543' : P.ink} />
      </mesh>
      <mesh position={[2.1, height + 2, -0.8]}>
        <cylinderGeometry args={[0.08, 0.11, 4, 5]} />
        <Surf color={P.ruinDark} />
      </mesh>
    </group>
  )
}

/**
 * The north escarpment: terraced limestone hills on a 2.5 m lattice (see layout/escarpment.ts),
 * grown by the skyline profile exactly where the box comb stood, with scrub and olive dots on the
 * treads and the four watch villages sitting on the crests at 100 %.
 */
export function Escarpment({ profile, night, layout = COASTAL_RUINS_LAYOUT }: { profile: SkylineProfile; night: boolean; layout?: BiomeLayout }) {
  const grid = useMemo(() => buildEscarpmentGrid(layout, profile), [layout, profile])
  const geometry = useMemo(() => hillGeometry(grid, night), [grid, night])
  useEffect(() => () => geometry.dispose(), [geometry])
  const dots = useMemo(() => hillDots(layout, profile), [layout, profile])
  useCollider(useMemo(() => escarpmentColliders(profile), [profile]))
  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <Surf color="#ffffff" vertexColors />
      </mesh>
      <HillDots dots={dots} night={night} />
      {Array.from({ length: profile.slitMasses }, (_, index) => {
        const x = WATCH_X[index]
        const z = -94 - (index % 2) * 5
        return <WatchVillage key={`watch-${index}`} x={x} y={escarpmentHeight(layout, x, z, profile) + 0.2} z={z} index={index} night={night} />
      })}
    </group>
  )
}

export function HorizonStacks({ night }: { night: boolean }) {
  const stacks = useMemo(seaStacks, [])
  useCollider(useMemo(() => seaStackColliders(), []))
  return (
    <group>
      {stacks.map((stack, index) => (
        <mesh
          key={index}
          position={[stack.x, stack.height / 2 - 0.5, stack.z]}
          rotation={[0, stack.yaw, 0]}
          scale={[stack.radius, stack.height / 2, stack.radius * 0.8]}
          castShadow
        >
          <dodecahedronGeometry args={[1, 0]} />
          <Surf color={night ? '#5f544d' : index % 2 ? P.ruin : P.horizon} />
        </mesh>
      ))}
    </group>
  )
}

export function GlobeMarker({ progress, night }: { progress: number; night: boolean }) {
  const tiers = progress < 0.33 ? 1 : progress < 0.67 ? 2 : 3
  const heights = [0, 2.8, 5.6]
  const radii = [16, 11.5, 7.5]
  return (
    <group>
      {Array.from({ length: tiers }, (_, index) => (
        <group key={index} position={[0, heights[index], 0]}>
          <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[radii[index], radii[index], 2.8, 12]} />
            <Surf color={night ? '#8a6d5c' : P.cliff} />
          </mesh>
          <mesh position={[0, 2.86, 0]} receiveShadow>
            <cylinderGeometry args={[radii[index] + 0.7, radii[index] + 0.7, 0.18, 12]} />
            <Surf color={night ? '#879097' : P.ground} />
          </mesh>
          {Array.from({ length: 6 }, (_, notch) => {
            const angle = (notch / 6) * Math.PI * 2
            return (
              <mesh key={notch} position={[Math.cos(angle) * radii[index], 2.72, Math.sin(angle) * radii[index]]}>
                <boxGeometry args={[2.4, 0.6, 1.2]} />
                <Surf color={night ? P.shallowsNight : P.shallows} />
              </mesh>
            )
          })}
        </group>
      ))}
      <group position={[0, heights[tiers - 1] + 3, 0]}>
        <group position={[-7, 0, -7]}>
          {[4.2, 6.2, 8, 5.2, 6.8].map((height, index) => (
            <mesh key={height} position={[(index - 2) * 1.4, height / 2, 0]} rotation={[0, index * 0.18, 0]} castShadow>
              <boxGeometry args={[1.2, height, 2.3]} />
              <Surf color={night ? (index % 2 ? '#87968f' : '#71817d') : index % 2 ? P.horizon : P.horizonBack} />
            </mesh>
          ))}
        </group>
        <mesh position={[6, 2.7, -1]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.7, 0.45, 5, 12, Math.PI * 1.45]} />
          <Surf color={night ? '#8b8274' : P.ruin} />
        </mesh>
        {tiers >= 2 && (
          <group position={[-5, 0, 7]}>
            <mesh position={[2.4, 0.35, 0]}><boxGeometry args={[5, 0.7, 1]} /><Surf color={night ? '#9a8a73' : P.ruinDark} /></mesh>
            <mesh position={[4.4, 0.35, 2]}><boxGeometry args={[1, 0.7, 4]} /><Surf color={night ? '#9a8a73' : P.ruinDark} /></mesh>
          </group>
        )}
        {tiers >= 3 && (
          <mesh position={[5, 1.2, -7]}>
            <cylinderGeometry args={[2, 2.2, 2.4, 12]} />
            <Surf color={night ? '#648ab2' : P.cobalt} />
          </mesh>
        )}
      </group>
    </group>
  )
}
