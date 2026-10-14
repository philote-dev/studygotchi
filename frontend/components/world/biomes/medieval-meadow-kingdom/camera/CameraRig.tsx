import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CameraControls, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { GeneratedKingdom } from '../layout/biome-layout'
import { sampleTerrain } from '../layout/terrain'
import { residentPositions } from '../scene/Residents'
import { edgePose, edgePosePosition, type EdgePoseId } from '../edge/poses'
import { outerBuildStatus } from '../edge/outer/build-status'
import { EDGE_LAB_EVENT } from '../edge/use-edge-lab'
import {
  MEADOW_CAMERA_BOX,
  MEADOW_FREE_CAMERA_LIMITS,
  MEADOW_LOOK_BOX,
  STATIONS,
  clampCameraPosition,
  insideBox,
  type CameraOverride,
  type Pose,
  type StationId,
  divePose,
  easeInOutCubic,
  poseFor,
} from './stations'

interface CameraRigProps {
  layout: GeneratedKingdom
  station: StationId
  override: CameraOverride
  focusDistrict: string | null
  diving: boolean
  onDiveEnd: () => void
  /** Edge lab: a fixed comparison pose overrides the station pose; null leaves the camera to the user. */
  poseId?: EdgePoseId | null
  /** Any value whose change should reset the capture readiness flag (the edge mode). */
  readyKey?: string | null
}

const DIVE_SECONDS = 1.6
/** How many frames after a lab pose is applied before the capture harness may screenshot. */
const EDGE_READY_FRAMES = 8

declare global {
  interface Window {
    /** Edge lab only: the live camera pose and a world → NDC projection, for the capture harness and probes. */
    __meadowCamera?: {
      pose(): { position: number[]; target: number[] | null; fov: number; aspect: number }
      project(x: number, y: number, z: number): [number, number, number]
      look(x: number, y: number, z: number, tx: number, ty: number, tz: number): void
    }
  }
}

/** What the station looks at: the district shape (chord as seen from the azimuth), a resident, or the land. */
export function stationSubject(layout: GeneratedKingdom, station: StationId, _override: CameraOverride, focusDistrict: string | null) {
  if (station === 'district' && focusDistrict) {
    const district = layout.districts.find((c) => c.id === focusDistrict)
    if (district) {
      const [x, z] = district.centre
      const y = sampleTerrain(layout, x, z).height
      return { center: [x, y, z] as [number, number, number], chord: district.stationChord }
    }
  }
  if (station === 'resident' && residentPositions[0]) {
    const p = residentPositions[0]
    return { center: [p.x, p.y, p.z] as [number, number, number], chord: 4 }
  }
  // Frame the mainland with the range behind it: centre sits a little back of the origin.
  return { center: [0, layout.groundHeight, 0] as [number, number, number], chord: layout.frameSize[0] }
}

function box3(box: { min: [number, number, number]; max: [number, number, number] }) {
  return new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max))
}

const scratch = new THREE.Vector3()

/**
 * Free roam over the kingdom (edge rollout): the camera orbits all the way round, pitches 12–64°,
 * dollies 40–380 m, looks only at the land (CameraControls boundary = the look box) and sits only
 * inside the ±460 m camera box (clamped every frame). The stations keep their diorama values and
 * the arrival dive, the district focus and the resident follow all still play.
 */
export function CameraRig({ layout, station, override, focusDistrict, diving, onDiveEnd, poseId = null, readyKey = null }: CameraRigProps) {
  const controls = useRef<CameraControls>(null)
  const aspect = useThree((s) => s.size.width / s.size.height)
  // drei rebuilds CameraControls when the default camera changes; re-apply the pose then.
  const camera = useThree((s) => s.camera)
  const dive = useRef<{ from: Pose; to: Pose; t: number } | null>(null)
  const hasPose = useRef(false)
  const userTookOver = useRef(false)
  const lastStation = useRef(station)
  const readyFrames = useRef(EDGE_READY_FRAMES)
  const limits = MEADOW_FREE_CAMERA_LIMITS
  const lookBox = useMemo(() => box3(MEADOW_LOOK_BOX), [])
  const labPose = useMemo(() => edgePose(poseId), [poseId])

  const subject = () => stationSubject(layout, station, override, focusDistrict)

  useEffect(() => {
    if (labPose) return
    if (diving) {
      userTookOver.current = false
      const to = poseFor(
        STATIONS.arrival,
        { ...override, pitchDeg: STATIONS.arrival.pitchDeg, azimuthDeg: STATIONS.arrival.azimuthDeg, dolly: 1 },
        subject(),
        aspect,
      )
      dive.current = { from: divePose(to), to, t: 0 }
      return
    }
    dive.current = null
    if (userTookOver.current && lastStation.current === station) return
    lastStation.current = station
    const pose = poseFor(STATIONS[station], override, subject(), aspect)
    void controls.current?.setLookAt(...pose.position, ...pose.target, hasPose.current)
    hasPose.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, camera, diving, focusDistrict, override, station, layout, labPose])

  // Edge lab: a fixed comparison pose overrides the station pose and flags readiness for captures.
  useLayoutEffect(() => {
    document.documentElement.dataset.edgeReady = 'false'
    readyFrames.current = 0
    if (!labPose) return
    dive.current = null
    const position = edgePosePosition(labPose)
    camera.position.set(...position)
    camera.lookAt(...labPose.target)
    camera.updateMatrixWorld()
    void controls.current?.setLookAt(...position, ...labPose.target, false)
    userTookOver.current = true
    hasPose.current = true
  }, [camera, labPose, readyKey])

  // Every lab event (panel click or harness) restarts the readiness count, even when the pose and
  // mode are unchanged, so a capture always waits for fresh frames.
  useEffect(() => {
    const restart = () => {
      readyFrames.current = 0
      document.documentElement.dataset.edgeReady = 'false'
    }
    window.addEventListener(EDGE_LAB_EVENT, restart)
    return () => window.removeEventListener(EDGE_LAB_EVENT, restart)
  }, [])

  // Lab dev hook: where the camera really is, and where a world point lands on screen (NDC).
  useEffect(() => {
    if (!labPose) return
    const probe = new THREE.Vector3()
    window.__meadowCamera = {
      pose: () => ({ position: camera.position.toArray(), target: controls.current?.getTarget(probe).toArray() ?? null, fov: (camera as THREE.PerspectiveCamera).fov, aspect: (camera as THREE.PerspectiveCamera).aspect }),
      project: (x, y, z) => {
        probe.set(x, y, z).project(camera)
        return [probe.x, probe.y, probe.z]
      },
      // Through the controls, so the free-camera limits (distance, pitch, look box, camera box) still apply.
      look: (x, y, z, tx, ty, tz) => {
        userTookOver.current = true
        void controls.current?.setLookAt(x, y, z, tx, ty, tz, false)
        readyFrames.current = 0
        document.documentElement.dataset.edgeReady = 'false'
      },
    }
    return () => {
      delete window.__meadowCamera
    }
  }, [camera, labPose])

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

  useFrame((_, delta) => {
    if (outerBuildStatus.pending > 0) {
      // The outer world is still being built across frames: a capture must wait for the whole horizon.
      readyFrames.current = 0
      if (document.documentElement.dataset.edgeReady !== 'false') document.documentElement.dataset.edgeReady = 'false'
    } else if (readyFrames.current < EDGE_READY_FRAMES) {
      readyFrames.current += 1
      if (readyFrames.current === EDGE_READY_FRAMES) document.documentElement.dataset.edgeReady = 'true'
    }
    const c = controls.current
    if (!c) return
    if (dive.current) {
      dive.current.t = Math.min(1, dive.current.t + delta / DIVE_SECONDS)
      const k = easeInOutCubic(dive.current.t)
      const { from, to } = dive.current
      const p = new THREE.Vector3(...from.position).lerp(new THREE.Vector3(...to.position), k)
      const t = new THREE.Vector3(...from.target).lerp(new THREE.Vector3(...to.target), k)
      void c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false)
      if (dive.current.t >= 1) {
        dive.current = null
        hasPose.current = true
        onDiveEnd()
      }
      return
    }
    if (!labPose && station === 'resident' && residentPositions[0]) {
      const pose = poseFor(STATIONS.resident, override, subject(), aspect)
      void c.setLookAt(...pose.position, ...pose.target, true)
      return
    }
    // Keep the camera inside its box: a hard wall, applied after CameraControls' own update (priority −1).
    const p = camera.position
    if (!insideBox(MEADOW_CAMERA_BOX, p.x, p.y, p.z)) {
      const [x, y, z] = clampCameraPosition(p.x, p.y, p.z)
      c.getTarget(scratch)
      void c.setLookAt(x, y, z, scratch.x, scratch.y, scratch.z, false)
    }
  })

  const minPolar = THREE.MathUtils.degToRad(90 - limits.pitchMaxDeg)
  const maxPolar = THREE.MathUtils.degToRad(90 - limits.pitchMinDeg)

  return (
    <>
      <PerspectiveCamera makeDefault fov={override.fov} near={0.5} far={3000} position={[80, 48, 140]} />
      <CameraControls
        ref={controls}
        makeDefault
        minDistance={limits.minDistance}
        maxDistance={limits.maxDistance}
        minPolarAngle={minPolar}
        maxPolarAngle={maxPolar}
        truckSpeed={0.6}
        dollySpeed={0.8}
        azimuthRotateSpeed={0.7}
        polarRotateSpeed={0.45}
        smoothTime={0.4}
        draggingSmoothTime={0.12}
      />
    </>
  )
}
