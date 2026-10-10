import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CameraControls, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import { type BiomeLayout, districtCentre, districtChord } from '../layout/biome-layout'
import { sampleTerrain } from '../layout/terrain'
import { residentPositions } from '../scene/Residents'
import { edgePose, edgePosePosition, type EdgePoseId } from '../edge/poses'
import { EDGE_LAB_EVENT } from '../edge/use-edge-lab'
import {
  ICE_CAMERA_BOX,
  ICE_CAMERA_LIMITS,
  ICE_FREE_CAMERA_BOX,
  ICE_FREE_CAMERA_LIMITS,
  ICE_FREE_LOOK_BOX,
  ICE_LOOK_AT,
  ICE_LOOK_BOX,
  ICE_OVERVIEW_CHORD,
  STATIONS,
  clampCameraPosition,
  defaultOverride,
  districtStationAzimuth,
  type CameraOverride,
  type IceCameraLimits,
  type Pose,
  type StationId,
  divePose,
  easeInOutCubic,
  poseFor,
} from './stations'

interface CameraRigProps {
  layout: BiomeLayout
  station: StationId
  override: CameraOverride
  focusDistrict: string | null
  diving: boolean
  onDiveEnd: () => void
}

const DIVE_SECONDS = 1.6

/** What the station looks at: the district shape (chord as seen from the azimuth), a resident, or the land. */
export function stationSubject(layout: BiomeLayout, station: StationId, override: CameraOverride, focusDistrict: string | null) {
  if (station === 'district' && focusDistrict) {
    const district = layout.districts.find((c) => c.id === focusDistrict)
    if (district) {
      const [x, z] = districtCentre(district)
      const y = Math.max(layout.seaLevel, sampleTerrain(layout, x, z).height)
      return { center: [x, y, z] as [number, number, number], chord: districtChord(district, override.azimuthDeg) }
    }
  }
  if (station === 'resident' && residentPositions[0]) {
    const p = residentPositions[0]
    return { center: [p.x, p.y, p.z] as [number, number, number], chord: 4 }
  }
  // Frame the mainland with the range behind it: centre sits a little back of the origin.
  return { center: [-2, layout.groundHeight, -8] as [number, number, number], chord: layout.frameRadius * 2 }
}

function box3(box: { min: [number, number, number]; max: [number, number, number] }) {
  return new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max))
}

/** How many frames after a lab pose is applied before the capture harness may screenshot. */
const EDGE_READY_FRAMES = 8

export interface EdgeCameraProps {
  /** Edge lab: free orbit, low pitch, every coast reachable. */
  free?: boolean
  /** Fixed comparison pose; null leaves the camera where the user put it. */
  poseId?: EdgePoseId | null
  /** Technique-specific tightening of the free limits. */
  limitsOverride?: Partial<IceCameraLimits>
  /** Any value whose change should reset the harness readiness flag (e.g. the technique id). */
  readyKey?: string | null
}

/** Station pose for the product camera: district station along the district's `stationAzimuth`, else overview. */
export function iceStationOverride(layout: BiomeLayout, focusDistrict: string | null): CameraOverride {
  const station = focusDistrict ? STATIONS.district : STATIONS.overview
  const district = focusDistrict ? layout.districts.find((entry) => entry.id === focusDistrict) : null
  const azimuthDeg = focusDistrict ? districtStationAzimuth(district) : station.azimuthDeg
  return { ...defaultOverride(station), azimuthDeg }
}

/** Subject the station frames; the district chord is measured from the station azimuth. */
export function iceSubject(layout: BiomeLayout, focusDistrict: string | null, azimuthDeg = ICE_CAMERA_LIMITS.preferredAzimuthDeg) {
  if (focusDistrict) {
    const district = layout.districts.find((entry) => entry.id === focusDistrict)
    if (district) {
      const [x, z] = districtCentre(district)
      const y = Math.max(layout.seaLevel, sampleTerrain(layout, x, z).height)
      const pullSouth = district.id === "forest" || district.id === "glacier" ? 22 : 0
      return {
        center: [x, y, z + pullSouth] as [number, number, number],
        chord: Math.min(district.id === "station" ? 48 : 72, districtChord(district, azimuthDeg) + pullSouth * 0.4),
      }
    }
  }
  return { center: ICE_LOOK_AT, chord: ICE_OVERVIEW_CHORD }
}

/** Product land: look at the mainland on the first frame. No CameraControls delay. */
export function LockedOverviewCamera({
  layout,
  focusDistrict = null,
  ...edge
}: {
  layout: BiomeLayout
  focusDistrict?: string | null
} & EdgeCameraProps) {
  return <BoundedIceCamera layout={layout} focusDistrict={focusDistrict} {...edge} />
}

/** Preferred town look, yaw/pitch/zoom clamps so the range stays the edge of the world. */
export function BoundedIceCamera({
  layout,
  focusDistrict = null,
  free = false,
  poseId = null,
  limitsOverride,
  readyKey = null,
}: {
  layout: BiomeLayout
  focusDistrict?: string | null
} & EdgeCameraProps) {
  const controls = useRef<CameraControls>(null)
  const size = useThree((state) => state.size)
  const camera = useThree((state) => state.camera)
  const hasPose = useRef(false)
  const lastFocus = useRef<string | null>(null)
  const userTookOver = useRef(false)
  const [controlsOn, setControlsOn] = useState(false)
  const readyFrames = useRef(EDGE_READY_FRAMES)

  const limits = useMemo<IceCameraLimits>(
    () => (free ? { ...ICE_FREE_CAMERA_LIMITS, ...limitsOverride } : ICE_CAMERA_LIMITS),
    [free, limitsOverride],
  )
  const boundaries = useMemo(
    () => ({
      look: box3(free ? ICE_FREE_LOOK_BOX : ICE_LOOK_BOX),
      cameraBox: free ? ICE_FREE_CAMERA_BOX : ICE_CAMERA_BOX,
      camera: box3(free ? ICE_FREE_CAMERA_BOX : ICE_CAMERA_BOX),
    }),
    [free],
  )
  const labPose = useMemo(() => (free ? edgePose(poseId) : null), [free, poseId])

  const applyPose = (smooth: boolean) => {
    const aspect = size.width / Math.max(1, size.height)
    const station = focusDistrict ? STATIONS.district : STATIONS.overview
    const override = iceStationOverride(layout, focusDistrict)
    const pose = poseFor(station, override, iceSubject(layout, focusDistrict, override.azimuthDeg), aspect)
    const from = new THREE.Vector3(...pose.position)
    const to = new THREE.Vector3(...pose.target)
    const dir = from.clone().sub(to)
    const distance = THREE.MathUtils.clamp(dir.length(), limits.minDistance, limits.maxDistance)
    dir.setLength(distance)
    const raw = to.clone().add(dir)
    const clamped = clampCameraPosition(raw.x, raw.y, raw.z, to.z, boundaries.cameraBox, limits.southOnly)
    const position = new THREE.Vector3(...clamped)
    boundaries.camera.clampPoint(position, position)
    camera.position.copy(position)
    camera.lookAt(to)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = station.fov
      camera.near = 0.5
      camera.far = 3000
      camera.aspect = aspect
      camera.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()
    void controls.current?.setLookAt(position.x, position.y, position.z, to.x, to.y, to.z, smooth)
  }

  useLayoutEffect(() => {
    const focusChanged = lastFocus.current !== focusDistrict
    if (userTookOver.current && !focusChanged && hasPose.current) return
    const smooth = hasPose.current && focusChanged
    applyPose(smooth)
    lastFocus.current = focusDistrict
    if (focusChanged) userTookOver.current = false
    hasPose.current = true
    if (!controlsOn) setControlsOn(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, focusDistrict, layout, size.height, size.width])

  // Edge lab: a fixed comparison pose overrides the station pose and flags readiness for captures.
  useLayoutEffect(() => {
    if (!free) return
    document.documentElement.dataset.edgeReady = 'false'
    readyFrames.current = 0
    if (!labPose) return
    const position = edgePosePosition(labPose)
    camera.position.set(...position)
    camera.lookAt(...labPose.target)
    camera.updateMatrixWorld()
    void controls.current?.setLookAt(...position, ...labPose.target, false)
    userTookOver.current = true
  }, [camera, controlsOn, free, labPose, readyKey])

  // Every lab event (panel click or harness) restarts the readiness count, even when the pose
  // and technique are unchanged, so a capture always waits for fresh frames.
  useEffect(() => {
    if (!free) return
    const restart = () => {
      readyFrames.current = 0
      document.documentElement.dataset.edgeReady = 'false'
    }
    window.addEventListener(EDGE_LAB_EVENT, restart)
    return () => window.removeEventListener(EDGE_LAB_EVENT, restart)
  }, [free])

  useFrame(() => {
    if (free && readyFrames.current < EDGE_READY_FRAMES) {
      readyFrames.current += 1
      if (readyFrames.current === EDGE_READY_FRAMES) document.documentElement.dataset.edgeReady = 'true'
    }
    if (!controls.current) return
    if (!hasPose.current) {
      applyPose(false)
      hasPose.current = true
    }
  })

  useEffect(() => {
    const c = controls.current
    if (!c) return
    c.setBoundary(boundaries.look)
    const mark = () => {
      userTookOver.current = true
    }
    c.addEventListener('controlstart', mark)
    return () => c.removeEventListener('controlstart', mark)
  }, [camera, boundaries])

  const minPolar = THREE.MathUtils.degToRad(90 - limits.pitchMaxDeg)
  const maxPolar = THREE.MathUtils.degToRad(90 - limits.pitchMinDeg)
  const yaw = limits.yawDeg >= 180 ? Infinity : THREE.MathUtils.degToRad(limits.yawDeg)

  return (
    <>
      <PerspectiveCamera makeDefault fov={STATIONS.overview.fov} near={0.5} far={3000} position={[18, 78, 188]} />
      {controlsOn ? (
      <CameraControls
        key={free ? 'free' : 'product'}
        ref={controls}
        makeDefault
        minDistance={limits.minDistance}
        maxDistance={limits.maxDistance}
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

export function CameraRig({ layout, station, override, focusDistrict, diving, onDiveEnd }: CameraRigProps) {
  const controls = useRef<CameraControls>(null)
  const aspect = useThree((s) => s.size.width / s.size.height)
  // drei rebuilds CameraControls when the default camera changes; re-apply the pose then.
  const camera = useThree((s) => s.camera)
  const dive = useRef<{ from: Pose; to: Pose; t: number } | null>(null)
  const hasPose = useRef(false)

  const subject = () => stationSubject(layout, station, override, focusDistrict)

  useEffect(() => {
    if (diving) {
      const to = poseFor(STATIONS.arrival, { ...override, pitchDeg: STATIONS.arrival.pitchDeg, azimuthDeg: STATIONS.arrival.azimuthDeg, dolly: 1 }, subject(), aspect)
      dive.current = { from: divePose(to), to, t: 0 }
      return
    }
    dive.current = null
    const pose = poseFor(STATIONS[station], override, subject(), aspect)
    void controls.current?.setLookAt(...pose.position, ...pose.target, hasPose.current)
    hasPose.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, camera, diving, focusDistrict, override, station, layout])

  useFrame((_, delta) => {
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
    if (station === 'resident' && residentPositions[0]) {
      const pose = poseFor(STATIONS.resident, override, subject(), aspect)
      void c.setLookAt(...pose.position, ...pose.target, true)
    }
  })

  return (
    <>
      <PerspectiveCamera makeDefault fov={override.fov} near={0.5} far={3000} position={[80, 60, 120]} />
      <CameraControls
        ref={controls}
        makeDefault
        minDistance={4}
        maxDistance={1200}
        minPolarAngle={0.35}
        maxPolarAngle={1.25}
        truckSpeed={0}
        dollySpeed={0.5}
        smoothTime={0.55}
        draggingSmoothTime={0.14}
      />
    </>
  )
}
