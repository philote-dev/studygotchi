import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  MEADOW_PALETTE as P,
  courseProgress,
  greenCrownProfile,
  landmarkStage,
  type GeneratedKingdom,
} from '../layout/biome-layout'
import { sampleTerrain } from '../layout/terrain'
import { CameraRig } from '../camera/CameraRig'
import { PixelComposer } from '../render/PixelComposer'
import type { LabState } from '../state'
import { Birds, Clouds, MeadowMotes, Stars } from './Ambient'
import { Catastrophe } from './Catastrophe'
import { Landmark } from './Landmark'
import { Residents } from './Residents'
import { Districts } from './Structures'
import { HoverTabs } from './HoverTabs'
import { GreenCrown, MeadowScatter, River, Roads, Terrain, Woodland } from './Terrain'
import { OuterScene } from '../edge/outer'
import { EdgeLabPanel } from '../edge/EdgeLabPanel'
import { endlessFog } from '../edge/outer/outer-world'
import { EDGE_LAB_EVENT } from '../edge/use-edge-lab'
import { ColliderProvider } from '../../collision/ColliderRegistry'
import { ColliderDebug } from '../../collision/ColliderDebug'
import { LandColliders } from '../collision/LandColliders'

/**
 * Fog follows the camera distance (the shipped behaviour) so the land stays crisp from every
 * station; with the outer world on, the far distance is pushed to 1.6 km (1.25 km at night) so
 * the meadow dissolves into the sky instead of ending on a fog wall (`endlessFog`).
 */
function FogFollow({ catastrophe, outer, night }: { catastrophe: boolean; outer: boolean; night: boolean }) {
  const scene = useThree((state) => state.scene)
  const center = useMemo(() => new THREE.Vector3(0, 0, 0), [])
  const forward = useMemo(() => new THREE.Vector3(), [])
  // A lab pose change (panel or capture harness) snaps the fog instead of easing it, so a capture
  // taken a few frames later shows the settled values whatever the frame rate.
  const snap = useRef(0)
  useEffect(() => {
    const arm = () => {
      // The pose lands a render later than the event; keep snapping through the readiness window.
      snap.current = 10
    }
    window.addEventListener(EDGE_LAB_EVENT, arm)
    return () => window.removeEventListener(EDGE_LAB_EVENT, arm)
  }, [])
  useFrame(({ camera }) => {
    const fog = scene.fog as THREE.Fog | null
    if (!fog) return
    const distance = camera.position.distanceTo(center)
    let near = catastrophe ? distance * 0.35 : distance * 1.4
    let far = catastrophe ? distance * 0.9 : distance * 2.8
    if (outer && !catastrophe) {
      camera.getWorldDirection(forward)
      const pitchDeg = (Math.asin(THREE.MathUtils.clamp(-forward.y, -1, 1)) * 180) / Math.PI
      const endless = endlessFog(distance, night, pitchDeg)
      near = endless.near
      far = endless.far
    }
    const k = snap.current > 0 ? 1 : 0.08
    if (snap.current > 0) snap.current -= 1
    fog.near += (near - fog.near) * k
    fog.far += (far - fog.far) * k
  })
  return null
}

export function BiomeScene({
  layout,
  state,
  onDiveEnd,
  onPickDistrict,
  hoveredId,
  onHover,
}: {
  layout: GeneratedKingdom
  state: LabState
  onDiveEnd: () => void
  onPickDistrict: (id: string) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
}) {
  const fraction = courseProgress(layout, state.progress)
  const crown = greenCrownProfile(fraction)
  const disrupted = state.catastrophe.phase !== 'calm' && state.catastrophe.phase !== 'recovering'
  const darkDistrict = disrupted ? state.catastrophe.districtId : null
  const sky = state.night ? P.skyNight : disrupted ? '#9ba9a0' : P.sky
  const landmarkSample = sampleTerrain(layout, ...layout.landmark.position)
  const landmarkPosition: [number, number, number] = [
    layout.landmark.position[0],
    landmarkSample.height,
    layout.landmark.position[1],
  ]
  const outer = state.edge === 'outer'
  const stage = landmarkStage(fraction)

  return (
    <>
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, 250, 620]} />
      <FogFollow catastrophe={disrupted} outer={outer} night={state.night} />
      <hemisphereLight
        args={[state.night ? '#536184' : '#e9f6ed', state.night ? '#20233a' : '#6f8055', state.night ? 0.75 : 0.7]}
      />
      <directionalLight
        position={state.night ? [-70, 90, 30] : [70, 105, 85]}
        intensity={state.night ? 1.4 : 2.3}
        color={state.night ? '#9db5e3' : '#fff0cf'}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={150}
        shadow-camera-bottom={-150}
        shadow-camera-near={10}
        shadow-camera-far={420}
        shadow-bias={-0.0006}
      />

      <ColliderProvider>
        {outer ? <OuterScene layout={layout} night={state.night} seed={state.seed} reducedMotion={state.reducedMotion} /> : null}
        <Terrain layout={layout} night={state.night} />
        <River layout={layout} night={state.night} />
        <Roads layout={layout} />
        <GreenCrown profile={crown} night={state.night} />
        <Woodland layout={layout} seed={state.seed} night={state.night} />
        <MeadowScatter layout={layout} seed={state.seed} />
        <Districts
          layout={layout}
          progress={state.progress}
          night={state.night}
          darkDistrict={darkDistrict}
        />
        <Landmark position={landmarkPosition} stage={stage} night={state.night} />
        <LandColliders layout={layout} progress={state.progress} seed={state.seed} stage={stage} />
        <Residents
          layout={layout}
          progress={state.progress}
          count={state.residents}
          seed={state.seed}
          phase={state.catastrophe.phase}
          night={state.night}
        />
        <ColliderDebug groundAt={(x, z) => Math.max(layout.waterHeight, sampleTerrain(layout, x, z).height)} />
        <Catastrophe layout={layout} state={state.catastrophe} />

        {state.clouds && <Clouds layout={layout} night={state.night} />}
        {state.snowfall && <MeadowMotes layout={layout} density={1} />}
        {state.whale && <Birds />}
        {state.night && <MeadowMotes layout={layout} density={0.65} />}
        {state.night && <Stars />}

        {layout.districts.map((district) => (
          <group key={district.id} position={[district.centre[0], district.id === 'castle-court' ? 2.2 : 0, district.centre[1]]}>
            <mesh
              position={[0, 2.5, 0]}
              onClick={(event) => {
                event.stopPropagation()
                onPickDistrict(district.id)
              }}
            >
              <cylinderGeometry args={[11, 11, 5, 10]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        ))}
        <HoverTabs layout={layout} state={state} hoveredId={hoveredId} onHover={onHover} />

        <CameraRig
          layout={layout}
          station={state.station}
          override={state.camera}
          focusDistrict={state.focusDistrict}
          diving={state.diving}
          onDiveEnd={onDiveEnd}
          poseId={state.pose}
          readyKey={state.edge}
        />
        {state.edgeLab ? <EdgeLabPanel /> : null}
      </ColliderProvider>
      {state.pixel && <PixelComposer />}
    </>
  )
}
