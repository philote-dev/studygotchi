import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { blendProgress, easeInOutCubic, lerp } from '../scene/sky-blend'
import {
  DOME_RADIUS,
  DOME_SEGMENTS,
  NIGHT_HAZE,
  RINGS,
  SKY_GLOW_HEIGHT,
  TAU,
  ZENITH,
  buildRing,
  hazeLambda,
  hexToLinear,
  type RingSpec,
} from './parallax/horizon'
import { DOME_FRAGMENT, DOME_VERTEX, RING_FRAGMENT, RING_VERTEX } from './parallax/shaders'
import type { EdgeSceneProps, EdgeTechnique } from './types'

/**
 * Painted horizon. Four concentric silhouette rings (skerries 700 m, a far coast with a frozen
 * city 1050 m, ranges 1500 m, the great range 2100 m) rise out of the sea haze under a
 * sky-gradient dome. One merged strip per ring, unlit, fog baked per fragment from the camera
 * distance; five draw calls, ~21k triangles. Pure data in `./parallax/horizon`, GLSL in
 * `./parallax/shaders`.
 */

const AURORA = { a: '#8fd0e8', b: '#c9a2e6', intensity: 0.2 } as const

function ringGeometry(seed: number, spec: RingSpec, index: number): THREE.BufferGeometry {
  const ring = buildRing(seed, spec, index)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(ring.position, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(ring.normal, 3))
  geometry.setAttribute('colorDay', new THREE.BufferAttribute(ring.colorDay, 3))
  geometry.setAttribute('colorNight', new THREE.BufferAttribute(ring.colorNight, 3))
  geometry.setIndex(new THREE.BufferAttribute(ring.index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

function ringMaterial(spec: RingSpec): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHaze: { value: new THREE.Color('#dbe2ee') },
      uNight: { value: 0 },
      uFogNear: { value: 220 },
      uFogFar: { value: 720 },
      uLambda: { value: hazeLambda(spec.radius, spec.haze) },
      uBaseFade: { value: spec.baseFade },
      uClear: { value: 1 },
      uNightHaze: { value: NIGHT_HAZE },
    },
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    fog: false,
    side: THREE.FrontSide,
  })
}

function domeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHaze: { value: new THREE.Color('#dbe2ee') },
      uZenithDay: { value: new THREE.Color().setRGB(...hexToLinear(ZENITH.day)) },
      uZenithNight: { value: new THREE.Color().setRGB(...hexToLinear(ZENITH.night)) },
      uAuroraA: { value: new THREE.Color().setRGB(...hexToLinear(AURORA.a)) },
      uAuroraB: { value: new THREE.Color().setRGB(...hexToLinear(AURORA.b)) },
      uNight: { value: 0 },
      uGlow: { value: SKY_GLOW_HEIGHT },
      uTime: { value: 0 },
      uAurora: { value: AURORA.intensity },
    },
    vertexShader: DOME_VERTEX,
    fragmentShader: DOME_FRAGMENT,
    fog: false,
    // Inside of a sphere that never writes depth: the pixel pass's normal / depth edge detection
    // sees it exactly like the flat background it replaces.
    side: THREE.BackSide,
    depthWrite: false,
  })
}

/** A 1.2 s eased crossfade of one scalar, in step with SkyBlend's day / night / storm blend. */
interface Fade {
  value: number
  from: number
  to: number
  t: number
}

function retarget(fade: Fade, to: number) {
  if (fade.to === to) return
  fade.from = fade.value
  fade.to = to
  fade.t = 0
}

function advance(fade: Fade, delta: number, instant: boolean) {
  if (fade.t >= 1) {
    fade.value = fade.to
    return
  }
  fade.t = blendProgress(fade.t, delta, instant)
  fade.value = lerp(fade.from, fade.to, easeInOutCubic(fade.t))
}

interface LookAtControls {
  setLookAt: (px: number, py: number, pz: number, tx: number, ty: number, tz: number, transition?: boolean) => Promise<void> | void
}

declare global {
  interface Window {
    /**
     * Dev-only hook for the free-camera capture script (kept under /tmp): drive the lab camera,
     * hide the technique to difference its cost, read the previous frame's renderer totals.
     */
    __iceParallax?: {
      lookAt: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => void
      hide: (hidden: boolean) => void
      stats: () => { calls: number; triangles: number }
    }
  }
}

function Scene({ night, storm, seed, reducedMotion }: EdgeSceneProps) {
  const scene = useThree((state) => state.scene)
  const controls = useThree((state) => state.controls) as unknown as LookAtControls | null
  const gl = useThree((state) => state.gl)
  const group = useRef<THREE.Group>(null)
  const frameStats = useRef({ calls: 0, triangles: 0, tracking: false })

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const stats = frameStats.current
    stats.tracking = true
    gl.info.autoReset = false
    window.__iceParallax = {
      lookAt: (px, py, pz, tx, ty, tz) => void controls?.setLookAt(px, py, pz, tx, ty, tz, false),
      hide: (hidden) => {
        if (group.current) group.current.visible = !hidden
      },
      stats: () => ({ calls: stats.calls, triangles: stats.triangles }),
    }
    return () => {
      stats.tracking = false
      gl.info.autoReset = true
      delete window.__iceParallax
    }
  }, [controls, gl])

  const rings = useMemo(
    () => RINGS.map((spec, index) => ({ spec, geometry: ringGeometry(seed, spec, index), material: ringMaterial(spec) })),
    [seed],
  )
  const dome = useMemo(
    () => ({
      // Upper hemisphere plus a few degrees under the waterline, so the water always covers its rim.
      geometry: new THREE.SphereGeometry(DOME_RADIUS, DOME_SEGMENTS[0], DOME_SEGMENTS[1], 0, TAU, 0, Math.PI / 2 + 0.06),
      material: domeMaterial(),
    }),
    [],
  )

  useEffect(
    () => () => {
      for (const ring of rings) {
        ring.geometry.dispose()
        ring.material.dispose()
      }
    },
    [rings],
  )
  useEffect(
    () => () => {
      dome.geometry.dispose()
      dome.material.dispose()
    },
    [dome],
  )

  const fades = useRef<{ night: Fade; clear: Fade }>({
    night: { value: night ? 1 : 0, from: night ? 1 : 0, to: night ? 1 : 0, t: 1 },
    clear: { value: storm ? 0 : 1, from: storm ? 0 : 1, to: storm ? 0 : 1, t: 1 },
  })
  useEffect(() => retarget(fades.current.night, night ? 1 : 0), [night])
  useEffect(() => retarget(fades.current.clear, storm ? 0 : 1), [storm])

  useFrame((_, delta) => {
    // Dev stats: this runs before the composer (priority 1), so the totals are the previous frame's.
    const stats = frameStats.current
    if (stats.tracking) {
      stats.calls = gl.info.render.calls
      stats.triangles = gl.info.render.triangles
      gl.info.reset()
    }
    const { night: nightFade, clear } = fades.current
    advance(nightFade, delta, reducedMotion)
    advance(clear, delta, reducedMotion)
    const fog = scene.fog instanceof THREE.Fog ? scene.fog : null
    const haze = fog?.color ?? (scene.background instanceof THREE.Color ? scene.background : null)
    for (const ring of rings) {
      const u = ring.material.uniforms
      if (haze) (u.uHaze.value as THREE.Color).copy(haze)
      if (fog) {
        u.uFogNear.value = fog.near
        u.uFogFar.value = fog.far
      }
      u.uNight.value = nightFade.value
      u.uClear.value = clear.value
    }
    const d = dome.material.uniforms
    if (haze) (d.uHaze.value as THREE.Color).copy(haze)
    d.uNight.value = nightFade.value
    // Every aurora frequency in the dome shader divides 120π, so wrapping there is seamless.
    if (!reducedMotion) d.uTime.value = (d.uTime.value + delta) % (120 * Math.PI)
  })

  return (
    <group ref={group} name="edge-parallax">
      <mesh geometry={dome.geometry} material={dome.material} frustumCulled={false} />
      {rings.map((ring) => (
        <mesh key={ring.spec.id} name={`edge-parallax-${ring.spec.id}`} geometry={ring.geometry} material={ring.material} frustumCulled={false} />
      ))}
    </group>
  )
}

export const parallax: EdgeTechnique = {
  id: 'parallax',
  name: 'Painted horizon',
  lineage: 'Octopath Traveler, Ori and the Blind Forest, Ghibli backgrounds, Uncharted vistas: matte-painted layers at separate depths',
  pitch:
    'Beyond the plate, four silhouette rings — skerries and icebergs at 700 m, a far coast with a frozen city at 1050 m, ranges at 1500 m, the great range at 2100 m — rise out of the sea haze under a gradient sky dome. Each ring is real geometry, so trucking across the land slides the near skerries against the far peaks; each sits closer to the sky colour, like a painted backdrop with depth. Drop to 12° and truck between coasts to see it move.',
  Scene,
}
