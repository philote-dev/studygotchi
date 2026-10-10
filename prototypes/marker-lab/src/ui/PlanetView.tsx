import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { MARKERS } from '../markers'
import {
  PLANET_BELT_OUTER_RADIUS,
  PLANET_CAMERA,
  PLANET_ORBIT_PERIOD_S,
  PLANET_RADIUS,
  autoRotateSpeedFor,
  planetCameraPosition,
  planetPalette,
  planetZoomLimits,
} from '../planet'
import { PixelComposer } from '../render/PixelComposer'
import { PlanetMarkers } from '../scene/PlanetMarkers'
import type { MarkerRenderState } from '../state'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(REDUCED_MOTION)
      query.addEventListener('change', notify)
      return () => query.removeEventListener('change', notify)
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  )
}

/** Flip ready only once two frames (incl. the pixel pass) have actually drawn. */
function ReadyFrames({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0)
  useFrame(() => {
    if (!onReady || frames.current >= 2) return
    frames.current += 1
    if (frames.current === 2) onReady()
  })
  return null
}

/**
 * Default pose from PLANET_CAMERA, re-fitted to the measured aspect (a
 * portrait canvas fits by width instead) until the user first grabs the globe.
 */
function PlanetCamera({ touched }: { touched: RefObject<boolean> }) {
  const camera = useThree((state) => state.camera)
  const aspect = useThree((state) => state.viewport.aspect)
  useLayoutEffect(() => {
    if (touched.current || !Number.isFinite(aspect) || aspect <= 0) return
    const fit = PLANET_CAMERA.fit * Math.min(1, aspect)
    camera.position.set(...planetCameraPosition(PLANET_RADIUS, PLANET_CAMERA.fov, fit))
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [aspect, camera, touched])
  return null
}

/**
 * Turntable lighting: the key light rides with the camera (upper-left of the
 * viewer) so the lit face of the globe is always the face being reviewed, even
 * while the auto-orbit carries the camera around.
 */
function PlanetLights({ night }: { night: boolean }) {
  const key = useRef<THREE.DirectionalLight>(null)
  const fill = useRef<THREE.DirectionalLight>(null)
  const scratch = useMemo(() => ({ dir: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), [])
  useFrame(({ camera }) => {
    const { dir, up } = scratch
    if (key.current) {
      dir.copy(camera.position).normalize().applyAxisAngle(up, -0.5)
      dir.addScaledVector(up, 0.7).normalize()
      key.current.position.copy(dir).multiplyScalar(PLANET_BELT_OUTER_RADIUS * 3)
    }
    if (fill.current) {
      // Soft fill from the viewer's lower-right so the far side of the globe never goes black.
      dir.copy(camera.position).normalize().applyAxisAngle(up, 0.9)
      dir.addScaledVector(up, -0.35).normalize()
      fill.current.position.copy(dir).multiplyScalar(PLANET_BELT_OUTER_RADIUS * 3)
    }
  })
  const shadowExtent = PLANET_BELT_OUTER_RADIUS * 1.08
  return (
    <>
      <hemisphereLight
        args={[night ? '#3a2f45' : '#f3e4ee', night ? '#221d30' : '#d9c3d6', night ? 1.6 : 1.9]}
      />
      <directionalLight ref={fill} position={[120, -40, -100]} color={night ? '#5b6a9c' : '#dfe8f4'} intensity={night ? 0.8 : 0.9} />
      <directionalLight
        ref={key}
        position={[-110, 140, 160]}
        color={night ? '#8fa3d8' : '#fff1dc'}
        intensity={night ? 2.4 : 2.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-camera-near={PLANET_BELT_OUTER_RADIUS}
        shadow-camera-far={PLANET_BELT_OUTER_RADIUS * 4.2}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
    </>
  )
}

export function PlanetView({
  state,
  onReady,
}: {
  state: MarkerRenderState
  onReady: (id: string) => void
}) {
  const reducedMotion = usePrefersReducedMotion()
  const touched = useRef(false)
  const palette = planetPalette(state.night)
  const zoom = planetZoomLimits()
  const initialPosition = planetCameraPosition()

  return (
    <section className="planet-view" aria-label="Planet marker belt">
      <div className="planet-canvas">
        <Canvas
          shadows
          dpr={1}
          camera={{ position: [...initialPosition], fov: PLANET_CAMERA.fov, near: 2, far: zoom.max + PLANET_RADIUS * 3 }}
          gl={{ antialias: false, preserveDrawingBuffer: true }}
        >
          <color attach="background" args={[palette.sky]} />
          <PlanetLights night={state.night} />
          <PlanetMarkers propCount={state.propCount} night={state.night} creature={state.creature} />
          <PlanetCamera touched={touched} />
          <OrbitControls
            target={[0, 0, 0]}
            enablePan={false}
            minDistance={zoom.min}
            maxDistance={zoom.max}
            autoRotate={!reducedMotion}
            autoRotateSpeed={autoRotateSpeedFor(PLANET_ORBIT_PERIOD_S)}
            onStart={() => {
              touched.current = true
            }}
          />
          <PixelComposer />
          <ReadyFrames onReady={() => onReady('planet')} />
        </Canvas>
      </div>
      <p className="planet-caption">{MARKERS.length} bouquets · drag to orbit</p>
    </section>
  )
}
