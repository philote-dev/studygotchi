import { Suspense, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  ICE_TOWN_PALETTE as P,
  type BiomeLayout,
  courseProgress,
  landmarkStage,
  mountainProfile,
} from '../layout/biome-layout'
import { sampleTerrain } from '../layout/terrain'
import { LockedOverviewCamera } from '../camera/CameraRig'
import type { LabState } from '../state'
import { Aurora, Clouds, GustRibbons, Hailfall, Snowfall, Stars, WhaleEvent } from './Ambient'
import { Catastrophe } from './Catastrophe'
import { StormWindProvider, usePrefersReducedMotion } from './StormWind'
import { stormGrade } from './storm-weather'
import { skyGradeFor } from './sky-blend'
import { SkyBlend } from './SkyBlend'
import { PixelComposer } from '../render/PixelComposer'
import { IceHover } from './IceHover'
import { Landmark } from './Landmark'
import { Residents } from './Residents'
import { Districts, Paths } from './Structures'
import { Floes, Forest, Landforms, Scatter, Terrain, Water } from './Terrain'
import { WorldScene } from '../world/WorldScene'
import { ICE_PRODUCT_EDGE, edgeTechnique } from '../edge'
import { ColliderProvider } from '../../collision/ColliderRegistry'
import { ColliderDebug } from '../../collision/ColliderDebug'

interface BiomeSceneProps {
  layout: BiomeLayout
  state: LabState
  onDiveEnd: () => void
  onPickDistrict: (id: string) => void
  hoveredId?: string | null
  onHover?: (id: string | null) => void
}

function DelayedResidents({
  layout,
  progress,
  phase,
}: {
  layout: BiomeLayout
  progress: LabState['progress']
  phase: LabState['catastrophe']['phase']
}) {
  const [ready, setReady] = useState(false)
  useFrame(() => {
    if (!ready) setReady(true)
  })
  if (!ready) return null
  return (
    <Suspense fallback={null}>
      <Residents layout={layout} progress={progress} phase={phase} />
    </Suspense>
  )
}

export function BiomeScene({ layout, state, onDiveEnd, onPickDistrict, hoveredId = null, onHover }: BiomeSceneProps) {
  const { night, catastrophe } = state
  const blizzard = catastrophe.phase === 'blizzard'
  const ruined = catastrophe.phase === 'ruin' || catastrophe.phase === 'bang'
  const storm = blizzard || ruined
  const darkDistrict = storm ? '*' : null

  const fraction = courseProgress(layout, state.progress)
  const profile = useMemo(() => mountainProfile(Math.max(0.62, fraction)), [fraction])
  const headland = useMemo(() => {
    const [x, z] = layout.headland.center
    return [x, sampleTerrain(layout, x, z).height, z] as [number, number, number]
  }, [layout])

  const world = layout.world
  const reducedMotion = usePrefersReducedMotion()
  // The outer world. Product: the chosen `combined` technique (shelf + vistas; Philote, 2026-10-10).
  // Edge lab (`?edge=`): whatever the URL names, including `none` for the bare plate.
  const edge = state.edgeLab ? edgeTechnique(state.edge) : edgeTechnique(ICE_PRODUCT_EDGE)
  // Sky, fog and lights crossfade over 1.2 s between day / night / storm (bible §6).
  const skyGrade = useMemo(() => {
    const base = skyGradeFor(night, storm ? stormGrade(1) : null, {
      sky: world?.colours.sky ?? P.sky,
      skyNight: world?.colours.skyNight ?? P.skyNight,
    })
    return edge?.sky ? edge.sky(base, { night, storm }) : base
  }, [edge, night, storm, world])

  return (
    <>
      <SkyBlend grade={skyGrade} instant={reducedMotion} />

      <StormWindProvider storm={storm} reducedMotion={reducedMotion}>
      <ColliderProvider>
      {edge ? <edge.Scene layout={layout} night={night} storm={storm} seed={state.seed} reducedMotion={reducedMotion} profile={world ? undefined : profile} /> : null}
      {world ? (
        <WorldScene layout={layout} world={world} progress={state.progress} seed={state.seed} night={night} darkDistrict={darkDistrict} />
      ) : (
        <>
          <Water layout={layout} night={night} />
          <Terrain layout={layout} profile={profile} night={night} />
          <Floes layout={layout} seed={state.seed} night={night} />
          <Landforms layout={layout} night={night} />
          <Scatter layout={layout} seed={state.seed} />
          <Forest layout={layout} seed={state.seed} night={night} />
          <Paths layout={layout} progress={state.progress} />
          <Districts layout={layout} progress={state.progress} seed={state.seed} night={night} darkDistrict={darkDistrict} />
          <Landmark position={headland} stage={landmarkStage(fraction)} night={night} />
        </>
      )}
      <DelayedResidents layout={layout} progress={state.progress} phase={catastrophe.phase} />
      <ColliderDebug groundAt={(x, z) => Math.max(layout.seaLevel, sampleTerrain(layout, x, z).height)} />
      <Catastrophe layout={layout} state={catastrophe} />

      {(state.clouds || storm) && <Clouds layout={layout} night={night || storm} />}
      {!world && (state.snowfall || storm || night) && (
        <Snowfall
          density={storm ? 0.7 : night && !state.snowfall ? 0.15 : 0.4}
          storm={storm}
          layout={layout}
        />
      )}
      {storm ? <GustRibbons layout={layout} /> : null}
      {storm ? <Hailfall layout={layout} /> : null}
      {state.whale && (!world || world.creatureEvent) && <WhaleEvent layout={layout} seed={state.seed} paused={catastrophe.phase !== 'calm'} />}
      {night && !world && <Aurora />}
      {night && <Stars />}

      <IceHover
        layout={layout}
        hoveredId={hoveredId}
        selectedId={state.focusDistrict}
        onHover={onHover ?? (() => undefined)}
        onPick={onPickDistrict}
      />

      <LockedOverviewCamera
        layout={layout}
        focusDistrict={state.focusDistrict}
        free={state.edgeLab ?? false}
        poseId={state.pose ?? null}
        limitsOverride={edge?.camera}
        readyKey={state.edge ?? ICE_PRODUCT_EDGE}
      />
      </ColliderProvider>
      </StormWindProvider>
      {state.pixel && <PixelComposer />}
    </>
  )
}
