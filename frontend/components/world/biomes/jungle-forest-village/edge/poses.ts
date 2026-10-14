import {
  JUNGLE_CAMERA_BOX,
  JUNGLE_CAMERA_LIMITS,
  JUNGLE_LOOK_AT,
  JUNGLE_LOOK_BOX,
  OVERVIEW_DISTANCE,
  STATIONS,
  clampToBox,
  orbitPosition,
  type JungleCameraLimits,
} from '../camera/stations'

/**
 * Fixed comparison poses for the jungle edge lab (`?pose=<id>`). Pitch is elevation above the
 * ground plane; azimuth is the direction from the target to the camera, measured from +z (south,
 * the diorama's front) toward +x. So azimuth 0 puts the camera south of the target looking north,
 * 180 looks south, 270 looks east and 90 looks west. Every pose uses the overview FOV (34°) so
 * the outward looks at 14–18° keep the horizon a few degrees inside the top of the frame.
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
  fov: number
}

const FOV = STATIONS.overview.fov

export const EDGE_POSES: readonly EdgePose[] = [
  {
    id: 'overview',
    label: 'Overview',
    why: 'The product pose, exactly the overview station: the outer world must not change how the village reads.',
    target: JUNGLE_LOOK_AT,
    pitchDeg: STATIONS.overview.pitchDeg,
    azimuthDeg: STATIONS.overview.azimuthDeg,
    distance: OVERVIEW_DISTANCE,
    fov: FOV,
  },
  {
    id: 'north-out',
    label: 'North, over the falls',
    why: 'From the Falls Terraces looking up the waterfall and past the rear canopy: what feeds the fall?',
    target: [22, 10, -120],
    pitchDeg: 16,
    azimuthDeg: 0,
    distance: 150,
    fov: FOV,
  },
  {
    id: 'east-out',
    label: 'East, down the outflow',
    why: 'From the Firefly clearing looking down the lagoon outflow (bearing 74°, the river’s own course): the river must keep going.',
    target: [130, 3, 48],
    pitchDeg: 15,
    azimuthDeg: 254,
    distance: 130,
    fov: FOV,
  },
  {
    id: 'south-out',
    label: 'South, past Riverworks',
    why: 'The old no-south-wall rule: the foreground had to end under the camera. Now it must continue.',
    target: [6, 2, 120],
    pitchDeg: 16,
    azimuthDeg: 180,
    distance: 130,
    fov: FOV,
  },
  {
    id: 'west-out',
    label: 'West, past the Orchid glade',
    why: 'Over the Ruin Commons and the glade toward the far side of the valley.',
    target: [-130, 3, 0],
    pitchDeg: 14,
    azimuthDeg: 90,
    distance: 130,
    fov: FOV,
  },
  {
    id: 'low-horizon',
    label: 'Low horizon through the village',
    why: 'Minimum pitch from the village centre: the canopy / sky join is in frame.',
    target: [0, 6, 0],
    pitchDeg: 12,
    azimuthDeg: 35,
    distance: 120,
    fov: FOV,
  },
  {
    id: 'zoom-max',
    label: 'Maximum zoom out',
    why: 'The whole plate and everything beyond it.',
    target: [0, 4, 0],
    pitchDeg: 30,
    azimuthDeg: 20,
    distance: 380,
    fov: FOV,
  },
  {
    id: 'horizon-max',
    label: 'Horizon at maximum zoom',
    why: 'Lowest pitch at the furthest distance: whatever stands above the horizon is in frame.',
    target: [0, 4, 0],
    pitchDeg: 12,
    azimuthDeg: 20,
    distance: 380,
    fov: FOV,
  },
]

export const EDGE_POSE_IDS: readonly EdgePoseId[] = EDGE_POSES.map((pose) => pose.id)

export function edgePose(id: string | null | undefined): EdgePose | null {
  return EDGE_POSES.find((pose) => pose.id === id) ?? null
}

/** Camera position for a pose (same convention as `poseFor`). */
export function edgePosePosition(pose: EdgePose): [number, number, number] {
  return orbitPosition(pose.target, pose.pitchDeg, pose.azimuthDeg, pose.distance)
}

/** Every comparison pose must be reachable under the free camera limits and inside both boxes. */
export function poseWithinLimits(pose: EdgePose, limits: JungleCameraLimits = JUNGLE_CAMERA_LIMITS): boolean {
  if (pose.pitchDeg < limits.pitchMinDeg || pose.pitchDeg > limits.pitchMaxDeg) return false
  if (pose.distance < limits.minDistance || pose.distance > limits.maxDistance) return false
  const position = edgePosePosition(pose)
  const clampedCamera = clampToBox(JUNGLE_CAMERA_BOX, ...position)
  const clampedTarget = clampToBox(JUNGLE_LOOK_BOX, ...pose.target)
  return position.every((v, i) => Math.abs(v - clampedCamera[i]) < 1e-9) && pose.target.every((v, i) => Math.abs(v - clampedTarget[i]) < 1e-9)
}

/** Direction the pose looks (camera → target), degrees from +z toward +x. */
export function viewBearingDeg(pose: EdgePose): number {
  return (pose.azimuthDeg + 180) % 360
}
