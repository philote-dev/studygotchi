import { ICE_FREE_CAMERA_LIMITS, ICE_LOOK_AT, type IceCameraLimits } from '../camera/stations'

/**
 * Fixed comparison poses for the edge lab. Every technique is captured from the same list so
 * the only variable is the technique. Pitch is elevation above the tangent plane; azimuth is the
 * direction from the target to the camera, measured from +z (south, the harbour side) toward +x.
 * So azimuth 16° puts the camera south of the target looking north, and 184° looks south out to sea.
 */
export type EdgePoseId =
  | 'overview'
  | 'north-out'
  | 'east-out'
  | 'south-out'
  | 'west-out'
  | 'low-horizon'
  | 'zoom-max'

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

export const EDGE_POSES: readonly EdgePose[] = [
  {
    id: 'overview',
    label: 'Overview',
    why: 'The product pose. The technique must not change how the town reads.',
    target: ICE_LOOK_AT,
    pitchDeg: 38,
    azimuthDeg: 16,
    distance: 250,
  },
  {
    id: 'north-out',
    label: 'North, over the range',
    why: 'Standing at the mountain camp looking past the peaks: what is behind the back wall?',
    target: [-60, 10, -120],
    pitchDeg: 18,
    azimuthDeg: 16,
    distance: 150,
  },
  {
    id: 'east-out',
    label: 'East, off the research island',
    why: 'From the island looking out to sea: the terrain plate ends 30 m from here.',
    target: [135, 2, 60],
    pitchDeg: 16,
    azimuthDeg: 276,
    distance: 120,
  },
  {
    id: 'south-out',
    label: 'South, from the harbour',
    why: 'The forbidden view in the old contract: open sea to the sky line.',
    target: [10, 1, 110],
    pitchDeg: 15,
    azimuthDeg: 184,
    distance: 130,
  },
  {
    id: 'west-out',
    label: 'West, past the glacier',
    why: 'The glacier shelf edge and the flat sea beyond it.',
    target: [-135, 2, 10],
    pitchDeg: 17,
    azimuthDeg: 92,
    distance: 130,
  },
  {
    id: 'low-horizon',
    label: 'Low horizon through town',
    why: 'Minimum pitch from the town centre: the sea / sky join is in frame.',
    target: [2, 6, 8],
    pitchDeg: 12,
    azimuthDeg: 40,
    distance: 110,
  },
  {
    id: 'zoom-max',
    label: 'Maximum zoom out',
    why: 'The whole plate and everything the technique puts beyond it.',
    target: [0, 4, 0],
    pitchDeg: 30,
    azimuthDeg: 22,
    distance: 380,
  },
]

export function edgePose(id: string | null | undefined): EdgePose | null {
  return EDGE_POSES.find((pose) => pose.id === id) ?? null
}

/** Camera position for a pose (same convention as `poseFor`). */
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

/** Every comparison pose must be reachable under the lab's free camera limits. */
export function poseWithinLimits(pose: EdgePose, limits: IceCameraLimits = ICE_FREE_CAMERA_LIMITS): boolean {
  return (
    pose.pitchDeg >= limits.pitchMinDeg &&
    pose.pitchDeg <= limits.pitchMaxDeg &&
    pose.distance >= limits.minDistance &&
    pose.distance <= limits.maxDistance
  )
}
