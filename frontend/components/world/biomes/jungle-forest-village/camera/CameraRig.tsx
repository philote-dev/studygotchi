'use client'

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CameraControls, PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { JUNGLE_LAYOUT as L, type SeededDistrict } from '../layout/jungle-layout'
import type { JungleState } from '../jungle-state'
import { EDGE_LAB_EVENT } from '../edge/edge-lab'
import { type EdgePoseId, edgePose, edgePosePosition } from '../edge/poses'
import {
  ARRIVAL_DISTANCE,
  DISTRICT_DISTANCE,
  JUNGLE_CAMERA_BOX,
  JUNGLE_CAMERA_LIMITS,
  JUNGLE_LOOK_AT,
  JUNGLE_LOOK_BOX,
  OVERVIEW_DISTANCE,
  RESIDENT_DISTANCE,
  clampToBox,
  orbitPosition,
} from './stations'

/** How many frames after a pose is applied before the capture harness may screenshot. */
const EDGE_READY_FRAMES = 8
const CAMERA_FAR = 3000

declare global {
  interface Window {
    __jungleCamera?: {
      lookAt: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => void
    }
  }
}

interface CameraRigProps {
  state: JungleState
  districts: SeededDistrict[]
  onDiveEnd: () => void
  /** Fixed comparison pose (`?pose=`); null leaves the camera on its station or where the user put it. */
  poseId?: EdgePoseId | null
  /** Any value whose change should reset the harness readiness flag (the edge mode). */
  readyKey?: string | null
}

/** The station pose the product camera flies to (the overview is the lab's `overview` pose exactly). */
export function stationPose(state: JungleState, districts: SeededDistrict[]): { position: [number, number, number]; target: [number, number, number] } {
  const station = state.station
  const focused = districts.find((district) => district.id === state.focusDistrict)
  const center: [number, number, number] =
    station === 'district' && focused
      ? [focused.center[0], 5.5, focused.center[1]]
      : station === 'district'
        ? [L.headland.center[0], 8, L.headland.center[1]]
        : station === 'resident' && focused
          ? [focused.center[0], 1.5, focused.center[1]]
          : JUNGLE_LOOK_AT
  const distance =
    (station === 'resident' ? RESIDENT_DISTANCE : station === 'district' ? DISTRICT_DISTANCE : station === 'arrival' ? ARRIVAL_DISTANCE : OVERVIEW_DISTANCE) *
    state.camera.dolly
  const position = orbitPosition(center, state.camera.pitchDeg, state.camera.azimuthDeg, distance)
  return { position: clampToBox(JUNGLE_CAMERA_BOX, ...position), target: center }
}

/**
 * Free camera over the land: full orbit, 12–64° pitch, 40–380 m, look-at boxed to the land and
 * trucking allowed inside it. Stations fly in as before; a lab pose overrides them and flags
 * `data-edge-ready` for the capture harness eight frames later (reset on every lab event).
 */
export function JungleCameraRig({ state, districts, onDiveEnd, poseId = null, readyKey = null }: CameraRigProps) {
  const controls = useRef<CameraControls>(null)
  const hasPose = useRef(false)
  const camera = useThree((store) => store.camera)
  const labPose = useMemo(() => edgePose(poseId), [poseId])
  const readyFrames = useRef(0)
  const userTookOver = useRef(false)
  const lastStationKey = useRef<string | null>(null)
  const lookBox = useMemo(() => new THREE.Box3(new THREE.Vector3(...JUNGLE_LOOK_BOX.min), new THREE.Vector3(...JUNGLE_LOOK_BOX.max)), [])

  // Station pose (and the arrival dive) when no lab pose is set. A station or focus change flies
  // the camera; anything else (day / night, progress) leaves a camera the user has moved alone.
  useEffect(() => {
    const control = controls.current
    if (!control || labPose) return
    const key = `${state.station}:${state.focusDistrict ?? ''}:${state.diving ? 'dive' : ''}:${state.camera.dolly}:${state.camera.pitchDeg}:${state.camera.azimuthDeg}`
    if (key === lastStationKey.current && userTookOver.current && hasPose.current) return
    lastStationKey.current = key
    const { position, target } = stationPose(state, districts)
    if (state.diving) {
      void control.setLookAt(position[0] * 1.45, position[1] * 4.6, position[2] * 1.45, ...target, false)
      const frame = window.requestAnimationFrame(() => {
        void control.setLookAt(...position, ...target, true)
      })
      const timeout = window.setTimeout(onDiveEnd, 1800)
      return () => {
        window.cancelAnimationFrame(frame)
        window.clearTimeout(timeout)
      }
    }
    void control.setLookAt(...position, ...target, hasPose.current)
    hasPose.current = true
    userTookOver.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, districts, labPose, onDiveEnd, state.camera, state.diving, state.station, state.focusDistrict])

  // Lab pose: snap the camera, set its FOV, and restart the readiness count.
  useLayoutEffect(() => {
    document.documentElement.dataset.edgeReady = 'false'
    readyFrames.current = 0
    if (!labPose) return
    const position = edgePosePosition(labPose)
    camera.position.set(...position)
    camera.lookAt(...labPose.target)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = labPose.fov
      camera.near = 0.3
      camera.far = CAMERA_FAR
      camera.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()
    void controls.current?.setLookAt(...position, ...labPose.target, false)
    hasPose.current = true
  }, [camera, labPose, readyKey])

  // Every lab event (panel click or harness) restarts the readiness count, even when the pose
  // and mode are unchanged, so a capture always waits for fresh frames.
  useEffect(() => {
    const restart = () => {
      readyFrames.current = 0
      document.documentElement.dataset.edgeReady = 'false'
    }
    window.addEventListener(EDGE_LAB_EVENT, restart)
    return () => window.removeEventListener(EDGE_LAB_EVENT, restart)
  }, [])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    c.setBoundary(lookBox)
    const mark = () => {
      userTookOver.current = true
    }
    c.addEventListener('controlstart', mark)
    return () => c.removeEventListener('controlstart', mark)
  }, [camera, lookBox])

  // Dev-only hook for the free-camera crack sweep (a throwaway script under /tmp drives it).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    window.__jungleCamera = {
      lookAt: (px, py, pz, tx, ty, tz) => {
        userTookOver.current = true
        readyFrames.current = 0
        document.documentElement.dataset.edgeReady = 'false'
        void controls.current?.setLookAt(px, py, pz, tx, ty, tz, false)
      },
    }
    return () => {
      delete window.__jungleCamera
    }
  }, [])

  useFrame(() => {
    if (readyFrames.current < EDGE_READY_FRAMES) {
      readyFrames.current += 1
      if (readyFrames.current === EDGE_READY_FRAMES) document.documentElement.dataset.edgeReady = 'true'
    }
  })

  const minPolar = THREE.MathUtils.degToRad(90 - JUNGLE_CAMERA_LIMITS.pitchMaxDeg)
  const maxPolar = THREE.MathUtils.degToRad(90 - JUNGLE_CAMERA_LIMITS.pitchMinDeg)
  return (
    <>
      <PerspectiveCamera makeDefault fov={labPose?.fov ?? state.camera.fov} near={0.3} far={CAMERA_FAR} position={[100, 90, 140]} />
      <CameraControls
        ref={controls}
        makeDefault
        minDistance={JUNGLE_CAMERA_LIMITS.minDistance}
        maxDistance={JUNGLE_CAMERA_LIMITS.maxDistance}
        minPolarAngle={minPolar}
        maxPolarAngle={maxPolar}
        truckSpeed={0.9}
        dollySpeed={0.95}
        azimuthRotateSpeed={0.7}
        polarRotateSpeed={0.4}
        smoothTime={0.45}
        draggingSmoothTime={0.12}
      />
    </>
  )
}
