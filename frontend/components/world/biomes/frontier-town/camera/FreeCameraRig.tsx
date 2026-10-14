import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import type { generateLayout } from '../layout/biome-layout'
import type { LabState } from '../state'
import { FRONTIER_FREE_FOV, FRONTIER_CAMERA_BOX, FRONTIER_CAMERA_LIMITS, FRONTIER_LOOK_BOX, clampToBox } from './limits'
import { stationPose } from './station-pose'
import { type FrontierPoseId, frontierPose, frontierPosePosition } from '../edge/poses'

// CameraControls clamps distance / polar angle on its own update, so a QA look-at outside the
// limits settles to the nearest allowed view; the raw camera placement still renders first.
import { EDGE_LAB_EVENT } from '../edge/use-edge-lab'

/** How many frames after a lab pose is applied before the capture harness may screenshot. */
const EDGE_READY_FRAMES = 8
const CAMERA_FAR = 3000

function box3(box: { min: [number, number, number]; max: [number, number, number] }) {
  return new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max))
}

/**
 * The free camera: every station pose the land has always used is applied through
 * CameraControls, then the user may orbit all the way round, drop to 12°, and zoom from one
 * district to the whole land; the look-at is boxed to the plate. A lab pose (`?pose=`) overrides
 * the station and raises `data-edge-ready` eight frames later for the capture harness; every
 * `ice-edge-lab` event resets it.
 */
/** Metres the camera keeps above the ground / skyline under it. */
export const CAMERA_GROUND_CLEARANCE = 6

/** Fraction of the target → camera segment next to the target that is not checked (the look-at may sit against the skyline). */
const CLEAR_FROM = 0.2
const CLEAR_SAMPLES = 24

/**
 * Largest distance along target → camera (≤ the current one) at which the whole segment from
 * 20 % out to the camera stays `clearance` above the ground: the camera is never buried in a
 * mesa and never parked behind one with the land out of sight. `minDistance` when nothing clears.
 */
export function clearDistance(
  target: [number, number, number],
  position: [number, number, number],
  groundAt: (x: number, z: number) => number,
  minDistance: number,
  clearance = CAMERA_GROUND_CLEARANCE,
): number {
  const dx = position[0] - target[0]
  const dy = position[1] - target[1]
  const dz = position[2] - target[2]
  const distance = Math.hypot(dx, dy, dz)
  if (distance < 1e-6) return distance
  const clearAt = (d: number) => {
    const k = d / distance
    return target[1] + dy * k >= groundAt(target[0] + dx * k, target[2] + dz * k) + clearance
  }
  // Longest clear prefix of the segment, from 20 % out.
  let blockedAt = -1
  for (let i = 0; i <= CLEAR_SAMPLES; i++) {
    const k = CLEAR_FROM + (1 - CLEAR_FROM) * (i / CLEAR_SAMPLES)
    if (!clearAt(k * distance)) {
      blockedAt = k
      break
    }
  }
  if (blockedAt < 0) return distance
  // Pull in to just before the block, then make sure the camera point itself is clear.
  let d = blockedAt <= CLEAR_FROM ? minDistance : Math.max(minDistance, blockedAt * distance - ((1 - CLEAR_FROM) * distance) / CLEAR_SAMPLES - 2)
  while (d > minDistance && !clearAt(d)) d = Math.max(minDistance, d - 4)
  return d
}

export function FreeCameraRig({
  state,
  generated,
  poseId,
  custom = null,
  readyKey,
  groundAt,
}: {
  state: LabState
  generated: ReturnType<typeof generateLayout>
  poseId: FrontierPoseId | null
  /** QA look-at (`?cam=`): applied raw, over any pose. */
  custom?: { position: [number, number, number]; target: [number, number, number] } | null
  readyKey: string
  /** Ground / skyline height under a point: the camera is kept CAMERA_GROUND_CLEARANCE above it (dollied in, never through a mesa). */
  groundAt?: (x: number, z: number) => number
}) {
  const controls = useRef<CameraControls>(null)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const [controlsOn, setControlsOn] = useState(false)
  const hasPose = useRef(false)
  const userTookOver = useRef(false)
  const lastStationKey = useRef<string>('')
  const readyFrames = useRef(0)

  const limits = FRONTIER_CAMERA_LIMITS
  const lookBox = useMemo(() => box3(FRONTIER_LOOK_BOX), [])
  const customKey = custom ? [...custom.position, ...custom.target].join(',') : ''
  const labPose = useMemo(() => {
    if (custom) return { id: 'custom' as const, position: custom.position, target: custom.target }
    const pose = frontierPose(poseId)
    return pose ? { id: pose.id, position: frontierPosePosition(pose), target: pose.target } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseId, customKey])

  const setProjection = (fov: number) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    camera.fov = fov
    camera.near = 0.5
    camera.far = CAMERA_FAR
    camera.aspect = size.width / Math.max(1, size.height)
    camera.updateProjectionMatrix()
  }

  const applyStation = (smooth: boolean) => {
    const pose = stationPose(state, generated)
    const position = clampToBox(FRONTIER_CAMERA_BOX, ...pose.position)
    setProjection(pose.fov)
    camera.position.set(...position)
    camera.lookAt(...pose.target)
    camera.updateMatrixWorld()
    void controls.current?.setLookAt(...position, ...pose.target, smooth)
  }

  // Station changes (arrival → overview, district focus) re-pose the camera; a user who has
  // taken over keeps their view until the station changes.
  const stationKey = `${state.station}|${state.focusDistrict ?? ''}|${state.camera.azimuthDeg}|${state.camera.pitchDeg}|${state.camera.dolly}|${state.camera.fov}`
  useLayoutEffect(() => {
    if (labPose) return
    const changed = lastStationKey.current !== stationKey
    if (userTookOver.current && !changed && hasPose.current) return
    applyStation(hasPose.current && changed)
    lastStationKey.current = stationKey
    if (changed) userTookOver.current = false
    hasPose.current = true
    if (!controlsOn) setControlsOn(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, stationKey, generated, size.width, size.height, labPose, controlsOn])

  // Lab pose: fixed comparison camera, and the readiness flag for captures.
  useLayoutEffect(() => {
    document.documentElement.dataset.edgeReady = 'false'
    readyFrames.current = 0
    if (!labPose) return
    const position = labPose.position
    setProjection(FRONTIER_FREE_FOV)
    camera.position.set(...position)
    camera.lookAt(...labPose.target)
    camera.updateMatrixWorld()
    void controls.current?.setLookAt(...position, ...labPose.target, false)
    userTookOver.current = true
    hasPose.current = true
    if (!controlsOn) setControlsOn(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controlsOn, labPose, readyKey, size.width, size.height])

  useEffect(() => {
    const restart = () => {
      readyFrames.current = 0
      document.documentElement.dataset.edgeReady = 'false'
    }
    window.addEventListener(EDGE_LAB_EVENT, restart)
    return () => window.removeEventListener(EDGE_LAB_EVENT, restart)
  }, [])

  const groundRef = useRef(groundAt)
  groundRef.current = groundAt
  const scratchTarget = useRef(new THREE.Vector3())

  useFrame(() => {
    if (readyFrames.current < EDGE_READY_FRAMES) {
      readyFrames.current += 1
      if (readyFrames.current === EDGE_READY_FRAMES) document.documentElement.dataset.edgeReady = 'true'
    }
    // Terrain clearance: an orbit that would put the camera inside a mesa is dollied in instead.
    const c = controls.current
    const ground = groundRef.current
    if (!c || !ground) return
    const t = c.getTarget(scratchTarget.current)
    const p = camera.position
    const d = clearDistance([t.x, t.y, t.z], [p.x, p.y, p.z], ground, limits.minDistance)
    const current = c.distance
    if (d < current - 0.05) {
      c.dollyTo(d, false)
      c.update(0)
    }
  })

  useEffect(() => {
    const c = controls.current
    if (!c) return
    c.setBoundary(lookBox)
    const mark = () => {
      userTookOver.current = true
    }
    c.addEventListener('controlstart', mark)
    return () => c.removeEventListener('controlstart', mark)
  }, [controlsOn, lookBox])

  const minPolar = THREE.MathUtils.degToRad(90 - limits.pitchMaxDeg)
  const maxPolar = THREE.MathUtils.degToRad(90 - limits.pitchMinDeg)

  return controlsOn ? (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={limits.minDistance}
      maxDistance={limits.maxDistance}
      minPolarAngle={minPolar}
      maxPolarAngle={maxPolar}
      truckSpeed={0.92}
      dollySpeed={0.95}
      azimuthRotateSpeed={0.7}
      polarRotateSpeed={0.4}
      smoothTime={0.45}
      draggingSmoothTime={0.1}
    />
  ) : null
}
