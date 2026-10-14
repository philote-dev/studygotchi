import { dioramaCameraPose } from '../layout/biome-layout'
import { FRONTIER_CAMERA_BOX, FRONTIER_CAMERA_LIMITS, FRONTIER_LOOK_BOX, type Box, type FrontierCameraLimits, orbitOf, orbitPosition } from '../camera/limits'

/**
 * Fixed comparison poses for the frontier edge lab (`?pose=<id>`). The baseline and the outer
 * world are captured from the same list so the only variable is the technique. Pitch is
 * elevation above the ground plane; azimuth is the direction from the target to the camera,
 * measured from +z (south, the front) toward +x. The four outward looks sit on the land and
 * look over its edges at 14–15°, the low horizon at the 12° floor, and the two max poses at the
 * zoom limit.
 */
export type FrontierPoseId =
  | 'overview'
  | 'north-out'
  | 'east-out'
  | 'south-out'
  | 'west-out'
  | 'low-horizon'
  | 'zoom-max'
  | 'horizon-max'

export interface FrontierPose {
  id: FrontierPoseId
  label: string
  /** What the pose is testing. */
  why: string
  target: [number, number, number]
  pitchDeg: number
  azimuthDeg: number
  distance: number
}

/** The product overview: plan-v4 fixed station, yaw 0, pitch 37, no dolly. */
const diorama = dioramaCameraPose(0, 1, 37)
const overviewOrbit = orbitOf(diorama.position, diorama.target)

export const FRONTIER_POSES: readonly FrontierPose[] = [
  {
    id: 'overview',
    label: 'Overview',
    why: 'The product pose (plan-v4 station). The outer world must not change how the town reads.',
    target: diorama.target,
    pitchDeg: overviewOrbit.pitchDeg,
    azimuthDeg: overviewOrbit.azimuthDeg,
    distance: overviewOrbit.distance,
  },
  {
    id: 'north-out',
    label: 'North, over the mesas',
    why: 'From above the dig looking north over the authored skyline: what stands behind the back wall?',
    target: [-10, 42, -166],
    pitchDeg: 14,
    azimuthDeg: 4,
    distance: 300,
  },
  {
    id: 'east-out',
    label: 'East, across the reserve',
    why: 'From the rails looking east over the reserve: the ground plate ends 80 m past the last saguaro.',
    target: [230, 6, 60],
    pitchDeg: 15,
    azimuthDeg: 278,
    distance: 200,
  },
  {
    id: 'south-out',
    label: 'South, from the town',
    why: 'The view the fixed camera never allowed: south over the dig to where the basin should go on.',
    target: [-20, 4, 160],
    pitchDeg: 14,
    azimuthDeg: 184,
    distance: 190,
  },
  {
    id: 'west-out',
    label: 'West, over the ranch',
    why: 'From over the town looking west across the ranch and the arroyo: the flat sand and the box edge beyond.',
    target: [-230, 18, 90],
    pitchDeg: 15,
    azimuthDeg: 86,
    distance: 280,
  },
  {
    id: 'low-horizon',
    label: 'Low horizon through town',
    why: 'Minimum pitch from Main Street: the ground / sky join is in frame.',
    target: [-40, 6, 4],
    pitchDeg: 12,
    azimuthDeg: 30,
    distance: 120,
  },
  {
    id: 'zoom-max',
    label: 'Maximum zoom out',
    why: 'The whole plate and everything the outer world puts beyond it.',
    target: [0, 4, -10],
    pitchDeg: 30,
    azimuthDeg: 10,
    distance: 520,
  },
  {
    id: 'horizon-max',
    label: 'Horizon at maximum zoom',
    why: 'Lowest pitch at the furthest distance: whatever stands above the horizon is in frame.',
    target: [0, 4, -10],
    pitchDeg: 12,
    azimuthDeg: 10,
    distance: 460,
  },
]

export const FRONTIER_POSE_IDS: readonly FrontierPoseId[] = FRONTIER_POSES.map((pose) => pose.id)

export function frontierPose(id: string | null | undefined): FrontierPose | null {
  return FRONTIER_POSES.find((pose) => pose.id === id) ?? null
}

export function frontierPosePosition(pose: FrontierPose): [number, number, number] {
  return orbitPosition(pose.target, pose.pitchDeg, pose.azimuthDeg, pose.distance)
}

/** Every comparison pose must be reachable under the free camera limits and boxes. */
export function poseWithinLimits(pose: FrontierPose, limits: FrontierCameraLimits = FRONTIER_CAMERA_LIMITS, cameraBox: Box = FRONTIER_CAMERA_BOX, lookBox: Box = FRONTIER_LOOK_BOX): boolean {
  if (pose.pitchDeg < limits.pitchMinDeg - 1e-6 || pose.pitchDeg > limits.pitchMaxDeg + 1e-6) return false
  if (pose.distance < limits.minDistance - 1e-6 || pose.distance > limits.maxDistance + 1e-6) return false
  const [x, y, z] = frontierPosePosition(pose)
  const inside = (box: Box, px: number, py: number, pz: number) =>
    px >= box.min[0] - 1e-6 && px <= box.max[0] + 1e-6 && py >= box.min[1] - 1e-6 && py <= box.max[1] + 1e-6 && pz >= box.min[2] - 1e-6 && pz <= box.max[2] + 1e-6
  return inside(cameraBox, x, y, z) && inside(lookBox, ...pose.target)
}
