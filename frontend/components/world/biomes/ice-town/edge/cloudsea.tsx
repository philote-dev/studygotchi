import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ICE_TOWN_PALETTE as P } from '../layout/biome-layout'
import { Surf, toonRamp } from '../render/materials'
import { useStormWind } from '../scene/StormWind'
import { STORM_WIND } from '../scene/storm-weather'
import {
  CLOUD_SEA,
  buildBeyondMesh,
  buildCoastModel,
  buildCutWall,
  buildDeck,
  cloudSeaSky,
  farPeaks,
  scatterHeads,
  sisterPlateau,
  type MeshData,
} from './cloudsea/cloud-field'
import type { EdgeSceneProps, EdgeTechnique } from './types'

/**
 * Cloud sea / inversion layer. The land is a high plateau; sixty metres past every coast the water
 * gives way to a faceted deck of cloud lobes that climbs to the horizon, with big far peaks and a
 * sister plateau poking through. All geometry is opaque and toon-lit like the ambient `Clouds`;
 * motion is object transforms only (deck breath, head sway / heave), so the pixel pass's normal and
 * depth buffers always agree with the beauty pass.
 */

const WIND = (() => {
  const len = Math.hypot(STORM_WIND.x, STORM_WIND.z)
  return { x: STORM_WIND.x / len, z: STORM_WIND.z / len }
})()

/**
 * Smooth vertex normals on the indexed mesh (so the pixel pass's normal-edge detector stays quiet on
 * the big far facets), expanded to non-indexed so each facet carries its own flat colour; the
 * material's `flatShading` draws the facets from screen-space derivatives.
 */
function toGeometry(mesh: MeshData): THREE.BufferGeometry {
  const indexed = new THREE.BufferGeometry()
  indexed.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
  indexed.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
  indexed.computeVertexNormals()
  const geometry = indexed.toNonIndexed()
  indexed.dispose()
  const colors = new Float32Array(mesh.triangles * 9)
  for (let f = 0; f < mesh.triangles; f++) {
    for (let v = 0; v < 3; v++) {
      colors[f * 9 + v * 3] = mesh.faceColors[f * 3]
      colors[f * 9 + v * 3 + 1] = mesh.faceColors[f * 3 + 1]
      colors[f * 9 + v * 3 + 2] = mesh.faceColors[f * 3 + 2]
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

function useMeshGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = useMemo(() => toGeometry(mesh), [mesh])
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

/**
 * Flat-shaded toon surface on the shared three-step ramp. `flatShading` is read generically by the
 * renderer for every material (the toon shader's `FLAT_SHADED` path) but is missing from the toon
 * material's typings, so it is set after construction.
 */
function useFlatToon(color: string, vertexColors: boolean, boost = 1): THREE.MeshToonMaterial {
  const material = useMemo(() => {
    const toon = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), vertexColors })
    // Crests sit in the ramp's middle step (their normals point up, not at the sun); lift the base so
    // lit cloud reads white against the slightly darker sky.
    toon.color.multiplyScalar(boost)
    Object.assign(toon, { flatShading: true })
    return toon
  }, [color, vertexColors, boost])
  useEffect(() => () => material.dispose(), [material])
  return material
}

const AURORA_BANDS = [
  { color: '#8fd0e8', position: [-620, 170, -720] as const, rotation: [0.35, 0.6, 0.15] as const, width: 1300, height: 110, opacity: 0.11 },
  { color: '#c9a2e6', position: [-860, 205, -420] as const, rotation: [0.3, 1.05, -0.1] as const, width: 1100, height: 80, opacity: 0.09 },
]

function Scene({ layout, night, storm, seed, reducedMotion }: EdgeSceneProps) {
  const model = useMemo(() => buildCoastModel(layout), [layout])
  const deckMesh = useMemo(() => buildDeck(layout, model, seed), [layout, model, seed])
  const wallMesh = useMemo(() => buildCutWall(layout, model, seed), [layout, model, seed])
  const heads = useMemo(() => scatterHeads(model, seed), [model, seed])
  const peaks = useMemo(() => farPeaks(seed), [seed])
  const plateau = useMemo(() => sisterPlateau(seed), [seed])
  const beyondMesh = useMemo(() => buildBeyondMesh(peaks, plateau, seed), [peaks, plateau, seed])
  const deck = useMeshGeometry(deckMesh)
  const wall = useMeshGeometry(wallMesh)
  const beyond = useMeshGeometry(beyondMesh)
  // Heads: the ambient Clouds' dodecahedron, with smooth normals so the pixel pass does not outline
  // every facet in white (the material's flatShading still draws the facets).
  const headGeometry = useMemo(() => {
    const geometry = mergeVertices(new THREE.DodecahedronGeometry(1, 0))
    geometry.computeVertexNormals()
    return geometry
  }, [])
  useEffect(() => () => headGeometry.dispose(), [headGeometry])
  const observatory = peaks.find((peak) => peak.observatory) ?? peaks[0]
  const lights = useMemo(
    () => Float32Array.from([observatory.x, observatory.height + 3, observatory.z, ...plateau.lights.flat()]),
    [observatory, plateau],
  )

  const group = useRef<THREE.Group>(null)
  const instanced = useRef<THREE.InstancedMesh>(null)
  const aurora = useRef<THREE.Group>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const { intensityRef } = useStormWind()
  const written = useRef(-1)

  const cloud = storm ? CLOUD_SEA.colours.cloudStorm : night ? CLOUD_SEA.colours.cloudNight : CLOUD_SEA.colours.cloudDay
  const landTint = storm ? '#7a8098' : night ? '#6f769a' : '#ffffff'
  const deckMaterial = useFlatToon(cloud, true, 1.12)
  const headMaterial = useFlatToon(cloud, false, 1.3)
  const landMaterial = useFlatToon(landTint, true)

  const writeHeads = (time: number, intensity: number) => {
    const mesh = instanced.current
    if (!mesh) return
    const grow = 1 + (CLOUD_SEA.stormGrow - 1) * intensity
    const motion = reducedMotion ? 0 : 1
    for (let i = 0; i < heads.length; i++) {
      const head = heads[i]
      const sway = motion * head.sway * (1 + intensity) * Math.sin(time * head.rate + head.phase)
      const bob = motion * head.bob * (1 + CLOUD_SEA.stormBob * intensity) * Math.sin(time * head.rate * 1.7 + head.phase * 2.1)
      dummy.position.set(head.x + WIND.x * sway, head.y + bob, head.z + WIND.z * sway)
      dummy.rotation.set(0, head.yaw, 0)
      dummy.scale.set(head.sx * grow, head.sy * grow, head.sz * grow)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  useLayoutEffect(() => {
    writeHeads(0, intensityRef.current)
    written.current = intensityRef.current
    // A little per-head brightness variation so the field does not read as one tone.
    const mesh = instanced.current
    if (mesh) {
      const colour = new THREE.Color()
      heads.forEach((head, i) => mesh.setColorAt(i, colour.setScalar(0.88 + 0.12 * (0.5 + 0.5 * Math.sin(head.phase * 3.1)))))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heads])

  // The one frame loop: deck breath and storm lift, head sway / heave, aurora sway. Off under reduced motion.
  useFrame(({ clock }) => {
    const intensity = intensityRef.current
    const time = clock.elapsedTime
    if (group.current) {
      const breath = reducedMotion ? 0 : 0.18 * (1 + intensity) * Math.sin(time * 0.3)
      group.current.position.y = CLOUD_SEA.stormLift * intensity + breath
    }
    if (!reducedMotion || Math.abs(intensity - written.current) > 0.003) {
      writeHeads(time, intensity)
      written.current = intensity
    }
    if (aurora.current && !reducedMotion) {
      aurora.current.children.forEach((child, i) => {
        const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
        material.opacity = AURORA_BANDS[i].opacity + Math.sin(time * 0.4 + i * 1.9) * 0.03
        child.position.y = AURORA_BANDS[i].position[1] + Math.sin(time * 0.17 + i) * 6
      })
    }
  })

  return (
    <group>
      {/* The cloud deck and its heads lift together in the storm. */}
      <group ref={group}>
        <mesh geometry={deck} material={deckMaterial} frustumCulled={false} />
        <instancedMesh ref={instanced} args={[headGeometry, headMaterial, heads.length]} frustumCulled={false} />
      </group>

      {/* Ice cliff under the sliced back land: the plateau's north face dropping into the cloud. */}
      <mesh geometry={wall} material={landMaterial} />

      {/* Far peaks and the sister plateau. */}
      <mesh geometry={beyond} material={landMaterial} frustumCulled={false} />
      <mesh position={[observatory.x, observatory.height - 1.5, observatory.z]}>
        <sphereGeometry args={[6, 8, 5]} />
        <Surf color={P.cream} emissive={night ? P.light : '#000000'} emissiveIntensity={night ? 1.3 : 0} />
      </mesh>

      {night ? (
        <>
          <points>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[lights, 3]} />
            </bufferGeometry>
            <pointsMaterial color={P.light} size={3} sizeAttenuation={false} fog={false} transparent opacity={0.95} depthWrite={false} />
          </points>
          <group ref={aurora}>
            {AURORA_BANDS.map((band) => (
              <mesh key={band.color} position={[...band.position]} rotation={[...band.rotation]}>
                <planeGeometry args={[band.width, band.height, 1, 1]} />
                <meshBasicMaterial color={band.color} transparent opacity={band.opacity} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
              </mesh>
            ))}
          </group>
        </>
      ) : null}
    </group>
  )
}

export const cloudsea: EdgeTechnique = {
  id: 'cloudsea',
  name: 'Cloud sea',
  lineage: "Skyward Sword's cloud barrier · Breath of the Wild's sky islands · Super Mario Galaxy · Celeste's summit",
  pitch:
    'The land is a high plateau above an inversion layer. Sixty metres past every coast the water gives way to a faceted sea of cloud lobes that climbs toward the horizon and swallows the flat sea by two hundred metres; big far peaks and a sister plateau poke through it, and at night an aurora hangs over them. Look for the north cliffs dropping into cloud, the heads of cloud drifting on the storm wind, and the harbour water still open inside the rim.',
  Scene,
  sky: cloudSeaSky,
}
