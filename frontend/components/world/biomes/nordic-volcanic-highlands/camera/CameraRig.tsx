import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CameraControls, PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { type BiomeLayout, districtChord } from '../layout/biome-layout'
import { edgePose, edgePosePosition, type EdgePoseId } from '../edge/poses'
import { EDGE_LAB_EVENT } from '../edge/use-edge-lab'
import { FREE_CAMERA_LIMITS, LOOK_BOX, STATIONS, type CameraOverride, type Pose, type StationId, divePose, easeInOutCubic, poseFor } from './stations'

/** Terrain / massif height under a point, for the camera floor; undefined when nothing is out there. */
export type FloorAt = (x: number, z: number) => number

interface CameraRigProps {
  layout: BiomeLayout
  station: StationId
  override: CameraOverride
  focusDistrict: string | null
  diving: boolean
  onDiveEnd: () => void
  /** Fixed lab pose; null leaves the camera to the stations and the user. */
  poseId?: EdgePoseId | null
  /** Anything whose change should reset the harness readiness flag (the technique id). */
  readyKey?: string | null
  /** Ground the camera must stay above (the outer world); null when the baseline is shown. */
  floorAt?: FloorAt | null
}

/** How many frames after a lab pose is applied before the capture harness may screenshot. */
const EDGE_READY_FRAMES = 8
/** Metres the camera keeps above the outer ground along its line to the target. */
const FLOOR_CLEARANCE = 5
/** The clear-distance march starts past the minimum distance (the plate itself is flat and never a floor). */
const FLOOR_STEP = 8

function stationSubject(layout: BiomeLayout, station: StationId, focusDistrict: string | null) {
  if (station === 'landmark') {
    return { center: [layout.landmark.center[0], layout.groundHeight, layout.landmark.center[1]] as [number, number, number], chord: 38 }
  }
  const district = layout.districts.find((d) => d.id === focusDistrict)
  if (station === 'district' && district) {
    return { center: [district.center[0], layout.groundHeight, district.center[1]] as [number, number, number], chord: districtChord(district) }
  }
  if (station === 'resident') {
    const home = district ?? layout.districts[0]
    return { center: [home.center[0] + 7, layout.groundHeight + 0.8, home.center[1] + 4] as [number, number, number], chord: 4 }
  }
  return { center: [0, layout.groundHeight, 0] as [number, number, number], chord: layout.frameRadius * 2 }
}

export function CameraRig({ layout, station, override, focusDistrict, diving, onDiveEnd, poseId = null, readyKey = null, floorAt = null }: CameraRigProps) {
  const controls = useRef<CameraControls>(null)
  const camera = useThree((state) => state.camera)
  const aspect = useThree((state) => state.size.width / state.size.height)
  const hasPose = useRef(false)
  const dive = useRef<{ from: Pose; to: Pose; t: number } | null>(null)
  const labPose = useMemo(() => edgePose(poseId), [poseId])
  // `?cam=x,y,z,tx,ty,tz` (lab sweeps only) places the camera anywhere for a crack hunt.
  const sweepPose = useMemo<Pose | null>(() => {
    if (typeof window === 'undefined') return null
    const numbers = new URLSearchParams(window.location.search).get('cam')?.split(',').map(Number)
    if (!numbers || numbers.length !== 6 || !numbers.every((n) => Number.isFinite(n))) return null
    return { position: [numbers[0], numbers[1], numbers[2]], target: [numbers[3], numbers[4], numbers[5]] }
    // Re-read whenever the lab state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseId, readyKey])
  const fixed = useMemo<Pose | null>(() => (labPose ? { position: edgePosePosition(labPose), target: labPose.target } : sweepPose), [labPose, sweepPose])
  const readyFrames = useRef(EDGE_READY_FRAMES)
  const scratch = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), dir: new THREE.Vector3(), to: new THREE.Vector3() }), [])

  // Stations and the arrival dive (unchanged contract), unless a lab pose owns the camera.
  useEffect(() => {
    if (fixed) return
    const subject = stationSubject(layout, station, focusDistrict)
    if (diving) {
      const to = poseFor(STATIONS.arrival, { ...override, pitchDeg: 35, azimuthDeg: 12, dolly: 1 }, subject, aspect)
      dive.current = { from: divePose(to), to, t: 0 }
      return
    }
    dive.current = null
    const pose = poseFor(STATIONS[station], override, subject, aspect)
    void controls.current?.setLookAt(...pose.position, ...pose.target, hasPose.current)
    hasPose.current = true
  }, [aspect, camera, diving, fixed, focusDistrict, layout, override, station])

  // Edge lab: a fixed comparison pose (or a sweep pose) overrides everything and flags readiness for captures.
  useLayoutEffect(() => {
    document.documentElement.dataset.edgeReady = 'false'
    readyFrames.current = 0
    if (!fixed) return
    dive.current = null
    camera.position.set(...fixed.position)
    camera.lookAt(...fixed.target)
    camera.updateMatrixWorld()
    void controls.current?.setLookAt(...fixed.position, ...fixed.target, false)
    hasPose.current = true
  }, [camera, fixed, readyKey])

  // Every lab event (panel click or harness) restarts the readiness count so a capture always waits for fresh frames.
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
    c.setBoundary(new THREE.Box3(new THREE.Vector3(...LOOK_BOX.min), new THREE.Vector3(...LOOK_BOX.max)))
  }, [camera])

  useFrame((_, delta) => {
    if (readyFrames.current < EDGE_READY_FRAMES) {
      readyFrames.current += 1
      if (readyFrames.current === EDGE_READY_FRAMES) document.documentElement.dataset.edgeReady = 'true'
    }
    const control = controls.current
    if (!control) return
    const active = dive.current
    if (active) {
      active.t = Math.min(1, active.t + delta / 1.6)
      const k = easeInOutCubic(active.t)
      const position = scratch.position.set(...active.from.position).lerp(scratch.target.set(...active.to.position), k)
      const target = scratch.dir.set(...active.from.target).lerp(scratch.to.set(...active.to.target), k)
      void control.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
      if (active.t === 1) {
        dive.current = null
        hasPose.current = true
        onDiveEnd()
      }
      return
    }
    // Camera floor: the farthest distance along the current view line that stays above the outer
    // ground and the barrier tops. CameraControls clamps the dolly to it smoothly, so the camera
    // slides in instead of passing into a mountain.
    if (floorAt && !fixed) {
      control.getTarget(scratch.target)
      control.getPosition(scratch.position)
      scratch.dir.subVectors(scratch.position, scratch.target)
      const distance = scratch.dir.length()
      if (distance > 1e-3) {
        scratch.dir.divideScalar(distance)
        let clear = FREE_CAMERA_LIMITS.maxDistance
        for (let d = FREE_CAMERA_LIMITS.minDistance; d <= FREE_CAMERA_LIMITS.maxDistance; d += FLOOR_STEP) {
          const x = scratch.target.x + scratch.dir.x * d
          const y = scratch.target.y + scratch.dir.y * d
          const z = scratch.target.z + scratch.dir.z * d
          if (floorAt(x, z) + FLOOR_CLEARANCE > y) {
            clear = Math.max(FREE_CAMERA_LIMITS.minDistance, d - FLOOR_STEP)
            break
          }
        }
        control.maxDistance = clear
      }
    } else control.maxDistance = FREE_CAMERA_LIMITS.maxDistance
  })

  const minPolar = THREE.MathUtils.degToRad(90 - FREE_CAMERA_LIMITS.pitchMaxDeg)
  const maxPolar = THREE.MathUtils.degToRad(90 - FREE_CAMERA_LIMITS.pitchMinDeg)

  return (
    <>
      <PerspectiveCamera makeDefault fov={override.fov} near={0.5} far={3000} position={[80, 72, 130]} />
      <CameraControls
        ref={controls}
        makeDefault
        minDistance={FREE_CAMERA_LIMITS.minDistance}
        maxDistance={FREE_CAMERA_LIMITS.maxDistance}
        minPolarAngle={minPolar}
        maxPolarAngle={maxPolar}
        minAzimuthAngle={-Infinity}
        maxAzimuthAngle={Infinity}
        truckSpeed={0.9}
        dollySpeed={0.45}
        azimuthRotateSpeed={0.7}
        polarRotateSpeed={0.4}
        smoothTime={0.5}
        draggingSmoothTime={0.12}
      />
    </>
  )
}
