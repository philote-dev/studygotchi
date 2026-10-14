import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CameraControls, PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { type BiomeLayout, seededDistrictPlan } from '../layout/biome-layout'
import { sampleTerrain } from '../layout/terrain'
import { residentPositions } from '../scene/Residents'
import { edgePose, edgePosePosition, type EdgePose, type EdgePoseId } from '../edge/poses'
import { EDGE_CAMERA_EVENT, EDGE_LAB_EVENT, type EdgeCameraDetail } from '../edge/use-edge-lab'
import {
  COASTAL_CAMERA_LIMITS,
  COASTAL_LOOK_BOX,
  STATIONS,
  boxToRender,
  overviewSubject,
  toRender,
  type CameraOverride,
  type Pose,
  type StationId,
  divePose,
  easeInOutCubic,
  poseFor,
} from './stations'

/**
 * The coastal camera: the shipped station poses (arrival dive, then the overview) applied exactly
 * as before, with CameraControls underneath for a free orbit: full yaw, pitch 12–64°, 40–470 m,
 * look-at clamped to the land. The station pose is re-applied every frame until the user takes
 * the camera (so the product overview is bit-for-bit the old frame); a lab pose (`?pose=`) snaps
 * the camera and flags `data-edge-ready` for the capture harness eight frames later.
 */

interface CameraRigProps {
  layout: BiomeLayout
  seed: number
  station: StationId
  override: CameraOverride
  focusDistrict: string | null
  diving: boolean
  markerMode: boolean
  onDiveEnd: () => void
  /** Edge lab: a fixed comparison pose; null leaves the camera to the stations / the user. */
  poseId?: EdgePoseId | null
  /** Any value whose change should reset the harness readiness flag (the edge mode). */
  readyKey?: string | null
}

const DIVE_SECONDS = 1.6
/** How many frames after a pose is applied before the capture harness may screenshot. */
const EDGE_READY_FRAMES = 8

export function stationSubject(layout: BiomeLayout, seed: number, station: StationId, focusDistrict: string | null, markerMode: boolean) {
  if (markerMode) return { center: [0, 5, 0] as [number, number, number], chord: 40 }
  const scale = layout.renderScale
  if (station === 'landmark') {
    return {
      center: [layout.headland.center[0] * scale, layout.headland.height * scale, layout.headland.center[1] * scale] as [number, number, number],
      chord: 30 * scale,
    }
  }
  if (station === 'district' && focusDistrict) {
    const district = layout.districts.find((candidate) => candidate.id === focusDistrict)
    if (district) {
      const [x, z] = seededDistrictPlan(layout, seed)[district.id].center
      return {
        center: [x * scale, Math.max(layout.seaLevel, sampleTerrain(layout, x, z).height) * scale, z * scale] as [number, number, number],
        chord: district.cameraChord * scale,
      }
    }
  }
  if (station === 'resident' && residentPositions[0]) {
    const position = residentPositions[0]
    return { center: [position.x * scale, position.y * scale, position.z * scale] as [number, number, number], chord: 4 * scale }
  }
  return overviewSubject(layout)
}

function applyPose(camera: THREE.PerspectiveCamera, pose: Pose) {
  camera.position.set(...pose.position)
  camera.lookAt(...pose.target)
  camera.updateMatrixWorld()
}

function box3(box: { min: [number, number, number]; max: [number, number, number] }) {
  return new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max))
}

export function CameraRig({ layout, seed, station, override, focusDistrict, diving, markerMode, onDiveEnd, poseId = null, readyKey = null }: CameraRigProps) {
  const camera = useRef<THREE.PerspectiveCamera>(null)
  const controls = useRef<CameraControls>(null)
  const aspect = useThree((state) => state.size.width / state.size.height)
  const dive = useRef<{ from: Pose; to: Pose; t: number } | null>(null)
  const userTookOver = useRef(false)
  const readyFrames = useRef(0)
  const [controlsOn, setControlsOn] = useState(false)
  const scratchFrom = useMemo(() => new THREE.Vector3(), [])
  const scratchTo = useMemo(() => new THREE.Vector3(), [])

  const scale = layout.renderScale
  const lookBox = useMemo(() => box3(boxToRender(layout, COASTAL_LOOK_BOX)), [layout])
  const labPose = useMemo(() => edgePose(poseId), [poseId])

  // The camera exists after the first commit; the controls mount once it does.
  useEffect(() => {
    if (!controlsOn && camera.current) setControlsOn(true)
  }, [controlsOn])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    c.setBoundary(lookBox)
    const mark = () => {
      userTookOver.current = true
    }
    c.addEventListener('controlstart', mark)
    return () => c.removeEventListener('controlstart', mark)
  }, [lookBox, controlsOn])

  // A station change (arrival → overview, district pick) hands the camera back to the stations.
  useEffect(() => {
    userTookOver.current = false
  }, [station, focusDistrict, markerMode])

  // Lab pose: snap the camera there and restart the readiness count.
  useLayoutEffect(() => {
    document.documentElement.dataset.edgeReady = 'false'
    readyFrames.current = 0
    const activeCamera = camera.current
    if (!labPose || !activeCamera) return
    const position = toRender(layout, edgePosePosition(labPose))
    const target = toRender(layout, labPose.target)
    applyPose(activeCamera, { position, target })
    void controls.current?.setLookAt(...position, ...target, false)
    userTookOver.current = true
  }, [labPose, layout, readyKey, controlsOn])

  // Every lab event (panel click or harness) restarts the readiness count, even when the pose and
  // mode are unchanged, so a capture always waits for fresh frames. The sweep hook snaps the
  // camera to an arbitrary pose (lab tooling only; it takes the camera over like a drag would).
  useEffect(() => {
    const restart = () => {
      readyFrames.current = 0
      document.documentElement.dataset.edgeReady = 'false'
    }
    const sweep = (event: Event) => {
      const detail = (event as CustomEvent<EdgeCameraDetail>).detail
      const activeCamera = camera.current
      if (!detail || !activeCamera) return
      const pose: EdgePose = { id: 'overview', label: '', why: '', target: detail.target, pitchDeg: detail.pitchDeg, azimuthDeg: detail.azimuthDeg, distance: detail.distance }
      const position = toRender(layout, edgePosePosition(pose))
      const target = toRender(layout, detail.target)
      applyPose(activeCamera, { position, target })
      void controls.current?.setLookAt(...position, ...target, false)
      userTookOver.current = true
      restart()
    }
    window.addEventListener(EDGE_LAB_EVENT, restart)
    window.addEventListener(EDGE_CAMERA_EVENT, sweep)
    return () => {
      window.removeEventListener(EDGE_LAB_EVENT, restart)
      window.removeEventListener(EDGE_CAMERA_EVENT, sweep)
    }
  }, [layout])

  useFrame((_, delta) => {
    const activeCamera = camera.current
    if (!activeCamera) return
    if (readyFrames.current < EDGE_READY_FRAMES && !diving) {
      readyFrames.current += 1
      if (readyFrames.current === EDGE_READY_FRAMES) document.documentElement.dataset.edgeReady = 'true'
    }
    if (labPose) return
    const subject = stationSubject(layout, seed, station, focusDistrict, markerMode)
    const stationDef = markerMode ? { ...STATIONS.overview, distance: 72, fitWidth: undefined } : STATIONS[station]
    const restingPose = poseFor(stationDef, override, subject, aspect)
    if (diving && !dive.current) {
      dive.current = { from: divePose(restingPose), to: restingPose, t: 0 }
      applyPose(activeCamera, dive.current.from)
    }
    if (dive.current) {
      dive.current.t = Math.min(1, dive.current.t + delta / DIVE_SECONDS)
      const progress = easeInOutCubic(dive.current.t)
      scratchFrom.set(...dive.current.from.position).lerp(scratchTo.set(...dive.current.to.position), progress)
      activeCamera.position.copy(scratchFrom)
      scratchFrom.set(...dive.current.from.target).lerp(scratchTo.set(...dive.current.to.target), progress)
      activeCamera.lookAt(scratchFrom)
      activeCamera.updateMatrixWorld()
      if (dive.current.t >= 1) {
        dive.current = null
        void controls.current?.setLookAt(...restingPose.position, ...restingPose.target, false)
        onDiveEnd()
      }
      return
    }
    if (userTookOver.current) return
    // Resting on a station: the shipped pose, exactly, and the controls kept in step for the hand-over.
    applyPose(activeCamera, restingPose)
    void controls.current?.setLookAt(...restingPose.position, ...restingPose.target, false)
  })

  const minPolar = THREE.MathUtils.degToRad(90 - COASTAL_CAMERA_LIMITS.pitchMaxDeg)
  const maxPolar = THREE.MathUtils.degToRad(90 - COASTAL_CAMERA_LIMITS.pitchMinDeg)
  const yaw = COASTAL_CAMERA_LIMITS.yawDeg >= 180 ? Infinity : THREE.MathUtils.degToRad(COASTAL_CAMERA_LIMITS.yawDeg)

  return (
    <>
      <PerspectiveCamera ref={camera} makeDefault fov={override.fov} near={0.25} far={1200} position={[0, 60, 80]} />
      {controlsOn ? (
        <CameraControls
          ref={controls}
          makeDefault
          minDistance={COASTAL_CAMERA_LIMITS.minDistance * scale}
          maxDistance={COASTAL_CAMERA_LIMITS.maxDistance * scale}
          minPolarAngle={minPolar}
          maxPolarAngle={maxPolar}
          minAzimuthAngle={-yaw}
          maxAzimuthAngle={yaw}
          truckSpeed={0.92}
          dollySpeed={0.95}
          azimuthRotateSpeed={0.7}
          polarRotateSpeed={0.4}
          smoothTime={0.28}
          draggingSmoothTime={0.1}
        />
      ) : null}
    </>
  )
}
