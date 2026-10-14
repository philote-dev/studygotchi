import { COASTAL_RUINS_LAYOUT } from '../layout/biome-layout'
import { COASTAL_CAMERA_LIMITS, STATIONS, type CoastalCameraLimits } from '../camera/stations'

/**
 * Fixed comparison poses for the coastal edge lab, in metres (the land's unit; the rig scales them
 * to render units). Pitch is elevation above the tangent plane; azimuth is the direction from the
 * target to the camera, measured from +z (south, the open sea) toward +x (east). So azimuth 180°
 * puts the camera north of its target looking south, straight out to sea.
 */
export type EdgePoseId = 'overview' | 'north-out' | 'east-out' | 'south-out' | 'west-out' | 'low-horizon' | 'zoom-max' | 'horizon-max'

export interface EdgePose {
  id: EdgePoseId
  label: string
  /** What the pose is testing. */
  why: string
  target: [number, number, number]
  pitchDeg: number
  azimuthDeg: number
  distance: number
}

const S = COASTAL_RUINS_LAYOUT.renderScale

/** The product overview: the station's render-unit numbers expressed in metres. */
const OVERVIEW: EdgePose = {
  id: 'overview',
  label: 'Overview',
  why: 'The product pose. The outer world must not change how the coast reads.',
  target: [8, COASTAL_RUINS_LAYOUT.groundHeight + STATIONS.overview.targetLift / S, 23],
  pitchDeg: STATIONS.overview.pitchDeg,
  azimuthDeg: STATIONS.overview.azimuthDeg,
  distance: STATIONS.overview.distance! / S,
}

export const EDGE_POSES: readonly EdgePose[] = [
  OVERVIEW,
  {
    id: 'north-out',
    label: 'North, over the escarpment',
    why: 'Standing over the village looking past the limestone comb: what is behind the back wall?',
    target: [-10, 12, -108],
    pitchDeg: 16,
    azimuthDeg: 0,
    distance: 150,
  },
  {
    id: 'east-out',
    label: 'East, across the quay bay',
    why: 'From above the working quay looking east over the bay: the plate ends 200 m out.',
    target: [158, 2, -4],
    pitchDeg: 15,
    azimuthDeg: 270,
    distance: 130,
  },
  {
    id: 'south-out',
    label: 'South, straight out to sea',
    why: 'The forbidden view in the diorama contract: open sea to the sky line.',
    target: [0, 1, 118],
    pitchDeg: 15,
    azimuthDeg: 180,
    distance: 140,
  },
  {
    id: 'west-out',
    label: 'West, along the ridge coast',
    why: 'From the bay looking west along the archaeology coast and its sea.',
    target: [-158, 2, 112],
    pitchDeg: 14,
    azimuthDeg: 90,
    distance: 140,
  },
  {
    id: 'low-horizon',
    label: 'Low horizon through the cove',
    why: 'Minimum pitch from the land centre: the sea / sky join is in frame.',
    target: [8, 6, 23],
    pitchDeg: 12,
    azimuthDeg: 38,
    distance: 120,
  },
  {
    id: 'zoom-max',
    label: 'Maximum zoom out',
    why: 'The whole plate and everything the outer world puts beyond it.',
    target: [0, 4, 0],
    pitchDeg: 30,
    azimuthDeg: 20,
    distance: COASTAL_CAMERA_LIMITS.maxDistance,
  },
  {
    id: 'horizon-max',
    label: 'Horizon at maximum zoom',
    why: 'Lowest pitch at the farthest distance: whatever stands above the horizon is in frame.',
    target: [0, 4, 0],
    pitchDeg: 12,
    azimuthDeg: 20,
    distance: COASTAL_CAMERA_LIMITS.maxDistance,
  },
]

export function edgePose(id: string | null | undefined): EdgePose | null {
  return EDGE_POSES.find((pose) => pose.id === id) ?? null
}

/** Camera position for a pose (same convention as `poseFor`), metres. */
export function edgePosePosition(pose: EdgePose): [number, number, number] {
  const pitch = (pose.pitchDeg * Math.PI) / 180
  const azimuth = (pose.azimuthDeg * Math.PI) / 180
  const horizontal = Math.cos(pitch) * pose.distance
  return [
    pose.target[0] + Math.sin(azimuth) * horizontal,
    pose.target[1] + Math.sin(pitch) * pose.distance,
    pose.target[2] + Math.cos(azimuth) * horizontal,
  ]
}

/** Direction the pose looks (camera → target), degrees from +z toward +x. */
export function viewBearingDeg(pose: EdgePose): number {
  return (pose.azimuthDeg + 180) % 360
}

/** Every comparison pose must be reachable under the free camera limits. */
export function poseWithinLimits(pose: EdgePose, limits: CoastalCameraLimits = COASTAL_CAMERA_LIMITS): boolean {
  return (
    pose.pitchDeg >= limits.pitchMinDeg &&
    pose.pitchDeg <= limits.pitchMaxDeg &&
    pose.distance >= limits.minDistance &&
    pose.distance <= limits.maxDistance
  )
}
