'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { EdgeSceneProps, EdgeTechnique } from './types'
import { createCurvatureRig, type CurvatureRig, type CurvatureTuning } from './curvature/rig'

/** How often the sweep looks for materials that appeared since the last pass (frames). */
const SWEEP_EVERY = 15

declare global {
  interface Window {
    /** Live tuning from the console while the technique is mounted: `__iceCurvature.tune({ k: 0.001 })`. */
    __iceCurvature?: {
      tune(next: Partial<CurvatureTuning>): CurvatureTuning
      tuning(): CurvatureTuning
      patched(): number
    }
  }
}

/**
 * World curvature. No geometry of its own: it bends everything already in the scene by
 * patching every material's vertex stage (see `curvature/shader.ts`), swaps the fan-shaped
 * 2400 m water disc for a ringed one so the roll is sampled, and traps the pixel pass's
 * normal override so its edges bend with the beauty pass. Everything is restored on unmount.
 */
function Scene({ reducedMotion }: EdgeSceneProps) {
  const scene = useThree((state) => state.scene)
  const rig = useMemo<CurvatureRig>(() => createCurvatureRig(), [])
  const frame = useRef(0)

  useLayoutEffect(() => {
    rig.install(scene)
    window.__iceCurvature = { tune: rig.tune, tuning: rig.tuning, patched: rig.patchedCount }
    return () => {
      rig.uninstall(scene)
      if (window.__iceCurvature?.tune === rig.tune) delete window.__iceCurvature
    }
  }, [rig, scene])

  useFrame((state, delta) => {
    rig.tick(state.camera, delta, reducedMotion)
    frame.current += 1
    if (frame.current % SWEEP_EVERY === 0) rig.sweep(state.scene)
  })

  return null
}

export const curvature: EdgeTechnique = {
  id: 'curvature',
  name: 'World curvature',
  lineage: 'Animal Crossing (GameCube to New Horizons), Death Stranding far-field roll, Subway Surfers / Temple Run track bend',
  pitch:
    'A vertex-shader bend in every material: beyond 160 m from the land centre the world drops by (r − 160)² / 1250, so the plate edge and the sea roll under a horizon that sits 6–8° lower than the flat one, and the sea fades to sky where your view ray grazes the rolled surface. Nothing inside the town moves. Look for sky filling the top third of each outward pose, floes dipping past the island and the glacier, and the back rows of the range settling by a metre. Console: __iceCurvature.tune({ k, start, follow: "camera" }).',
  Scene,
}
