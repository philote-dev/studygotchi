import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ICE_TOWN_PALETTE as P, type BiomeLayout, whaleStateAt } from '../layout/biome-layout'
import { toonRamp } from '../render/materials'
import { useStormWind } from '../scene/StormWind'
import type { EdgeSceneProps, EdgeTechnique } from './types'
import { bindHazeSpace, createHazeUniforms, patchHaze, type HazeUniforms } from './sea/horizon-haze'
import { buildApron, readTerrainEdge } from './sea/north-apron'
import {
  PACK_BANDS,
  SEA_HORIZON,
  icebreakerSchedule,
  icebreakerStateAt,
  mirageSites,
  packIce,
  seaPalette,
  seaSky,
  spoutSites,
  type MirageId,
  type SeaPalette,
} from './sea/sea-horizon'
import {
  buildAnnulus,
  buildBergShape,
  buildCabinIsland,
  buildFarIcebreaker,
  buildFloeShape,
  buildHazeWall,
  buildIceCathedral,
  buildTabularGiant,
  buildTabularShape,
  buildVolcanoBerg,
  createWallMaterial,
  type MirageParts,
} from './sea/sea-meshes'

/**
 * Living sea horizon (The Wind Waker, Sea of Thieves, Raft). The ocean is the world: beyond the
 * authored water a far annulus pales toward a haze colour, a haze wall at the horizon radius
 * lifts that colour into the sky, pack ice thickens in three bands toward the horizon, four
 * mirage places sit just beyond reach, and the far sea is alive: an icebreaker crossing every
 * ~90 s, far whales spouting on their own schedules, the pack drifting with the tide.
 *
 * Draw calls: water 1, wall 1, north apron 1, pack ice 3, mirages 7, icebreaker 2 and far whales 6
 * while visible (<= 21 at once). Triangles ~26k.
 */

/* ---------- shared haze ---------- */

function useHorizonHaze(night: boolean, reducedMotion: boolean): HazeUniforms {
  const uniforms = useMemo(() => createHazeUniforms(SEA_HORIZON.hazeNear, SEA_HORIZON.hazeFar, SEA_HORIZON.innerRadius), [])
  const colours = useMemo(
    () => ({
      day: new THREE.Color(seaPalette(false, false).haze),
      night: new THREE.Color(seaPalette(true, false).haze),
      storm: new THREE.Color(seaPalette(false, true).haze),
      moon: new THREE.Color(seaPalette(true, false).moon),
    }),
    [],
  )
  const { intensityRef } = useStormWind()
  const nightK = useRef(night ? 1 : 0)

  useFrame(({ clock }, delta) => {
    const target = night ? 1 : 0
    nightK.current = reducedMotion ? target : nightK.current + (target - nightK.current) * Math.min(1, delta * 3.2)
    if (Math.abs(target - nightK.current) < 0.002) nightK.current = target
    const stormK = intensityRef.current
    uniforms.hazeLinear.copy(colours.day).lerp(colours.night, nightK.current).lerp(colours.storm, stormK)
    uniforms.moonLinear.copy(colours.moon)
    uniforms.time.value = reducedMotion ? 0 : clock.elapsedTime
    uniforms.chop.value = stormK
    uniforms.moon.value = nightK.current * (1 - stormK)
  })

  return uniforms
}

interface HazedToonOptions {
  color?: string
  vertexColors?: boolean
  emissive?: string
  emissiveIntensity?: number
  lift: number
  sea?: boolean
}

/** A toon material with the horizon haze installed; disposed when its inputs change. */
function useHazedToon(uniforms: HazeUniforms, options: HazedToonOptions): THREE.MeshToonMaterial {
  const { color = '#ffffff', vertexColors = false, emissive = '#000000', emissiveIntensity = 0, lift, sea = false } = options
  const material = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), vertexColors, emissive, emissiveIntensity })
    patchHaze(m, uniforms, lift, sea)
    return m
  }, [color, vertexColors, emissive, emissiveIntensity, lift, sea, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return material
}

function useDisposable<T extends THREE.BufferGeometry>(geometry: T): T {
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

function useHazeBind(uniforms: HazeUniforms) {
  return useCallback((object: THREE.Object3D | null) => {
    if (object) bindHazeSpace(object, uniforms)
  }, [uniforms])
}

/* ---------- far water and the horizon ---------- */

function FarWater({ layout, palette, uniforms }: { layout: BiomeLayout; palette: SeaPalette; uniforms: HazeUniforms }) {
  const geometry = useDisposable(useMemo(() => buildAnnulus(palette), [palette]))
  const material = useHazedToon(uniforms, { vertexColors: true, lift: 1, sea: true })
  const bind = useHazeBind(uniforms)
  return <mesh ref={bind} geometry={geometry} material={material} position={[0, layout.seaLevel + SEA_HORIZON.surfaceLift, 0]} frustumCulled={false} />
}

function HazeWall({ layout, uniforms }: { layout: BiomeLayout; uniforms: HazeUniforms }) {
  const geometry = useDisposable(useMemo(() => buildHazeWall(), []))
  const material = useMemo(() => createWallMaterial(uniforms.hazeLinear, layout.seaLevel), [layout.seaLevel, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return <mesh geometry={geometry} material={material} position={[0, layout.seaLevel, 0]} frustumCulled={false} />
}

/** Continues the authored heightfield past the plate's straight north cut into a wobbling ice coast. */
function NorthApron({ layout, night, uniforms }: { layout: BiomeLayout; night: boolean; uniforms: HazeUniforms }) {
  const scene = useThree((state) => state.scene)
  const [edge, setEdge] = useState<{ key: string; heights: Float32Array } | null>(null)
  const edgeKey = useRef<string | null>(null)
  const frames = useRef(0)
  useFrame(() => {
    frames.current += 1
    // Poll until the authored terrain mesh exists, then only watch for a rebuild (new mountain band).
    if (frames.current % (edgeKey.current ? 90 : 6) !== 1) return
    const found = readTerrainEdge(scene, layout.worldExtent)
    if (found && found.key !== edgeKey.current) {
      edgeKey.current = found.key
      setEdge(found)
    }
  })
  const geometry = useDisposable(useMemo(() => buildApron(layout, night, edge?.heights ?? null), [layout, night, edge]))
  const material = useHazedToon(uniforms, { vertexColors: true, lift: 0.35 })
  const bind = useHazeBind(uniforms)
  return <mesh ref={bind} geometry={geometry} material={material} frustumCulled={false} />
}

/* ---------- pack ice ---------- */

const DRIFT = { amplitude: 0.055, period: 240 } as const

function PackIce({ layout, seed, palette, uniforms, reducedMotion }: { layout: BiomeLayout; seed: number; palette: SeaPalette; uniforms: HazeUniforms; reducedMotion: boolean }) {
  const pieces = useMemo(() => packIce(layout, seed), [layout, seed])
  const shapes = [
    useDisposable(useMemo(() => buildFloeShape(palette), [palette])),
    useDisposable(useMemo(() => buildBergShape(palette), [palette])),
    useDisposable(useMemo(() => buildTabularShape(palette), [palette])),
  ]
  const material = useHazedToon(uniforms, { vertexColors: true, lift: 0.75, emissive: palette.shadowLift, emissiveIntensity: 0.4 })
  const bind = useHazeBind(uniforms)
  const meshes = [useRef<THREE.InstancedMesh>(null), useRef<THREE.InstancedMesh>(null), useRef<THREE.InstancedMesh>(null)]
  const groups = [useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null)]
  const { intensityRef } = useStormWind()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tint = useMemo(() => new THREE.Color(), [])
  const farTint = useMemo(() => new THREE.Color(0.78, 0.87, 0.94), [])
  const counts = PACK_BANDS.map((band) => pieces.filter((piece) => piece.band === band.index).length)

  useLayoutEffect(() => {
    PACK_BANDS.forEach((band, b) => {
      const mesh = meshes[b].current
      if (!mesh) return
      let i = 0
      for (const piece of pieces) {
        if (piece.band !== band.index) continue
        dummy.position.set(piece.x, layout.seaLevel + piece.height * (band.kind === 'floe' ? 0.35 : 0.4), piece.z)
        dummy.rotation.set(0, piece.yaw, 0)
        dummy.scale.set(piece.size, piece.height, piece.size * (band.kind === 'tabular' ? 0.5 : band.kind === 'berg' ? 0.75 : 0.85))
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        // Distance tint: far ice sits lower-contrast and bluer in the haze than the near floes.
        const far = THREE.MathUtils.smoothstep(piece.r, 300, 1600)
        tint.setScalar(0.92 + piece.tint * 0.08).lerp(farTint, far)
        mesh.setColorAt(i, tint)
        i++
      }
      mesh.count = i
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces, layout.seaLevel, palette])

  useFrame(({ clock }) => {
    const storm = intensityRef.current
    for (let b = 0; b < groups.length; b++) {
      const group = groups[b].current
      if (!group) continue
      if (reducedMotion) {
        group.rotation.y = 0
        continue
      }
      // Tidal drift: the bands breathe back and forth (never far enough to reach the mirage places).
      const speed = (1 + storm * 1.8) / (1 + b * 0.6)
      group.rotation.y = DRIFT.amplitude * Math.sin((clock.elapsedTime * speed * Math.PI * 2) / DRIFT.period + b * 2.1)
    }
  })

  return (
    <>
      {PACK_BANDS.map((band, b) => (
        <group key={band.index} ref={groups[b]}>
          <instancedMesh
            ref={(mesh) => {
              meshes[b].current = mesh
              bind(mesh)
            }}
            args={[shapes[b], material, Math.max(1, counts[b])]}
            frustumCulled={false}
          />
        </group>
      ))}
    </>
  )
}

/* ---------- mirage places ---------- */

const MIRAGE_BUILDERS: Record<MirageId, (palette: SeaPalette) => MirageParts> = {
  'cabin-island': buildCabinIsland,
  'volcano-berg': buildVolcanoBerg,
  'ice-cathedral': buildIceCathedral,
  'tabular-giant': buildTabularGiant,
}

function Mirage({ id, position, yaw, palette, night, uniforms, reducedMotion }: { id: MirageId; position: [number, number, number]; yaw: number; palette: SeaPalette; night: boolean; uniforms: HazeUniforms; reducedMotion: boolean }) {
  const parts = useMemo(() => MIRAGE_BUILDERS[id](palette), [id, palette])
  useEffect(
    () => () => {
      parts.body.dispose()
      parts.accent?.dispose()
    },
    [parts],
  )
  const body = useHazedToon(uniforms, { vertexColors: true, lift: 0.35 })
  const accentColour = id === 'cabin-island' ? P.light : P.crystal
  const lit = id === 'cabin-island' ? true : night
  const accent = useHazedToon(uniforms, { color: accentColour, emissive: accentColour, emissiveIntensity: lit ? (night ? 1.6 : 0.9) : 0.25, lift: 0.35 })
  const bind = useHazeBind(uniforms)
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh ref={bind} geometry={parts.body} material={body} frustumCulled={false} />
      {parts.accent ? <mesh ref={bind} geometry={parts.accent} material={accent} frustumCulled={false} /> : null}
      {id === 'volcano-berg' ? <Plume palette={palette} uniforms={uniforms} reducedMotion={reducedMotion} /> : null}
    </group>
  )
}

/** Steam puffs rising from the crater: three instances cycling up, out and larger. */
function Plume({ palette, uniforms, reducedMotion }: { palette: SeaPalette; uniforms: HazeUniforms; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useDisposable(useMemo(() => new THREE.DodecahedronGeometry(1, 0), []))
  const material = useHazedToon(uniforms, { color: palette.snow, lift: 0.35 })
  const bind = useHazeBind(uniforms)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const write = (time: number) => {
    const m = mesh.current
    if (!m) return
    for (let k = 0; k < 3; k++) {
      const d = reducedMotion ? k / 3 : ((time * 0.11 + k / 3) % 1)
      dummy.position.set(Math.sin(d * 5 + k) * 4 + d * 9, 74 + d * 34, Math.cos(d * 4 + k * 2) * 3 + d * 4)
      dummy.scale.setScalar(5 + d * 11)
      dummy.rotation.set(d * 2, k, d)
      dummy.updateMatrix()
      m.setMatrixAt(k, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  }
  useLayoutEffect(() => write(0))
  useFrame(({ clock }) => {
    if (!reducedMotion) write(clock.elapsedTime)
  })
  return (
    <instancedMesh
      ref={(m) => {
        mesh.current = m
        bind(m)
      }}
      args={[geometry, material, 3]}
      frustumCulled={false}
    />
  )
}

function Mirages({ seed, palette, night, uniforms, reducedMotion, layout }: { seed: number; palette: SeaPalette; night: boolean; uniforms: HazeUniforms; reducedMotion: boolean; layout: BiomeLayout }) {
  const sites = useMemo(() => mirageSites(seed), [seed])
  return (
    <>
      {sites.map((site) => (
        <Mirage key={site.id} id={site.id} position={[site.x, layout.seaLevel, site.z]} yaw={site.yaw} palette={palette} night={night} uniforms={uniforms} reducedMotion={reducedMotion} />
      ))}
    </>
  )
}

/* ---------- life: the icebreaker crossing ---------- */

const SHIP_SCALE = 1.7

function IcebreakerCrossing({ layout, seed, palette, uniforms, reducedMotion }: { layout: BiomeLayout; seed: number; palette: SeaPalette; uniforms: HazeUniforms; reducedMotion: boolean }) {
  const schedule = useMemo(() => icebreakerSchedule(seed), [seed])
  const group = useRef<THREE.Group>(null)
  const puffs = useRef<THREE.InstancedMesh>(null)
  const hull = useDisposable(useMemo(() => buildFarIcebreaker(), []))
  const puff = useDisposable(useMemo(() => new THREE.DodecahedronGeometry(1, 0), []))
  const hullMaterial = useHazedToon(uniforms, { vertexColors: true, lift: 0.5 })
  const smoke = useHazedToon(uniforms, { color: palette.snow, lift: 0.5 })
  const bind = useHazeBind(uniforms)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    if (reducedMotion) {
      g.visible = false
      return
    }
    const state = icebreakerStateAt(schedule, clock.elapsedTime)
    g.visible = state.visible
    if (!state.visible) return
    g.position.set(state.x, layout.seaLevel - 0.2, state.z)
    g.rotation.y = state.yaw
    const m = puffs.current
    if (!m) return
    for (let k = 0; k < 3; k++) {
      const d = (clock.elapsedTime * 0.55 + k / 3) % 1
      dummy.position.set(Math.sin(k * 2.1 + d * 6) * 0.5, 8.6 + d * 4.2, -4.4 - d * 9)
      dummy.scale.setScalar(0.8 + d * 1.9)
      dummy.rotation.set(d * 3, k * 1.3, 0)
      dummy.updateMatrix()
      m.setMatrixAt(k, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={group} visible={false} scale={SHIP_SCALE}>
      <mesh ref={bind} geometry={hull} material={hullMaterial} frustumCulled={false} />
      <instancedMesh
        ref={(m) => {
          puffs.current = m
          bind(m)
        }}
        args={[puff, smoke, 3]}
        frustumCulled={false}
      />
    </group>
  )
}

/* ---------- life: far whale spouts ---------- */

const FAR_WHALE = '#4f6378'
const FAR_WHALE_SCALE = 1.6

function easeOut(k: number): number {
  return 1 - (1 - k) * (1 - k)
}

function FarWhale({ site, layout, uniforms, reducedMotion }: { site: ReturnType<typeof spoutSites>[number]; layout: BiomeLayout; uniforms: HazeUniforms; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null)
  const back = useRef<THREE.Group>(null)
  const puff = useRef<THREE.Mesh>(null)
  const backMaterial = useHazedToon(uniforms, { color: FAR_WHALE, lift: 0.5 })
  const bind = useHazeBind(uniforms)
  const puffMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }), [])
  useEffect(() => () => puffMaterial.dispose(), [puffMaterial])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g || !back.current || !puff.current) return
    if (reducedMotion) {
      g.visible = false
      return
    }
    const state = whaleStateAt(site.schedule, clock.elapsedTime)
    if (state.phase === 'hidden' || !state.event) {
      g.visible = false
      return
    }
    g.visible = true
    const { phase, k } = state
    let y = -3.6
    let pitch = 0
    let puffK = 0
    let slide = 0
    switch (phase) {
      case 'rise':
        y = -3.6 + 3.6 * easeOut(k)
        pitch = -0.25 * (1 - k)
        break
      case 'blow':
        y = 0
        puffK = k
        break
      case 'glide':
        y = Math.sin(k * Math.PI * 2) * 0.12
        slide = k * 10
        break
      case 'dive':
        y = -3.8 * k * k
        pitch = 0.5 * k
        slide = 10 + k * 4
        break
      case 'breach': {
        const arc = Math.sin(k * Math.PI)
        y = -0.6 + arc * 6
        pitch = (0.5 - k) * 1.6
        break
      }
    }
    back.current.position.set(0, y, slide)
    back.current.rotation.x = pitch
    puff.current.visible = puffK > 0
    const ps = 0.6 + puffK * 3.2
    puff.current.scale.set(ps, ps * 1.5, ps)
    puff.current.position.set(0, y + 1.6 + puffK * 3.4, 1.6 + slide)
    puffMaterial.opacity = 0.85 * (1 - puffK)
  })

  return (
    <group ref={group} position={[site.x, layout.seaLevel, site.z]} rotation={[0, site.yaw, 0]} scale={FAR_WHALE_SCALE} visible={false}>
      <group ref={back}>
        <mesh ref={bind} material={backMaterial} scale={[1.7, 1.4, 4.6]} frustumCulled={false}>
          <sphereGeometry args={[1, 8, 6]} />
        </mesh>
        <mesh ref={bind} material={backMaterial} position={[0, 1.3, -1.0]} rotation={[0.3, 0, 0]} frustumCulled={false}>
          <coneGeometry args={[0.35, 0.9, 5]} />
        </mesh>
      </group>
      <mesh ref={puff} material={puffMaterial} visible={false} frustumCulled={false}>
        <dodecahedronGeometry args={[0.5, 1]} />
      </mesh>
    </group>
  )
}

function FarWhales({ layout, seed, uniforms, reducedMotion }: { layout: BiomeLayout; seed: number; uniforms: HazeUniforms; reducedMotion: boolean }) {
  const sites = useMemo(() => spoutSites(layout, seed), [layout, seed])
  return (
    <>
      {sites.map((site, i) => (
        <FarWhale key={i} site={site} layout={layout} uniforms={uniforms} reducedMotion={reducedMotion} />
      ))}
    </>
  )
}

/* ---------- the technique ---------- */

function Scene({ layout, night, storm, seed, reducedMotion }: EdgeSceneProps) {
  const uniforms = useHorizonHaze(night, reducedMotion)
  const palette = useMemo(() => seaPalette(night, storm), [night, storm])
  return (
    <group name="edge-sea">
      <FarWater layout={layout} palette={palette} uniforms={uniforms} />
      <HazeWall layout={layout} uniforms={uniforms} />
      <NorthApron layout={layout} night={night} uniforms={uniforms} />
      <PackIce layout={layout} seed={seed} palette={palette} uniforms={uniforms} reducedMotion={reducedMotion} />
      <Mirages layout={layout} seed={seed} palette={palette} night={night} uniforms={uniforms} reducedMotion={reducedMotion} />
      <IcebreakerCrossing layout={layout} seed={seed} palette={palette} uniforms={uniforms} reducedMotion={reducedMotion} />
      <FarWhales layout={layout} seed={seed} uniforms={uniforms} reducedMotion={reducedMotion} />
    </group>
  )
}

export const sea: EdgeTechnique = {
  id: 'sea',
  name: 'Living sea horizon',
  lineage: 'The Wind Waker, Sea of Thieves, Raft: the ocean is the world, so the game gives it a true horizon and keeps it alive.',
  pitch:
    'Accept the sea. Past the harbour the water pales into a haze band where it meets the sky instead of a fog wall; the back land ends in an ice cliff like every other coast. Pack ice thickens in three bands toward the horizon, and just out of reach sit a volcanic berg with a steam plume, a low island with one cabin light, an ice cathedral and a tabular giant with a blue crevasse. An icebreaker crosses the southern sea about every 90 s, three far whales spout on their own schedules, and the pack drifts with the tide; at night the far water turns to ink under a moon path.',
  Scene,
  sky: seaSky,
}
