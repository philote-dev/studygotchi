import { CAMERA_BOX, FREE_CAMERA_LIMITS, LOOK_BOX, STATIONS, type FreeCameraLimits, fitDistance, insideBox } from '../camera/stations'
import { NORDIC_LAYOUT, type DistrictKind, districtChord, generateDistricts } from '../layout/biome-layout'

/** The seed the shipped land uses (Mount.tsx); the district stations frame the jittered centres. */
export const LAND_SEED = 7

/** The product district station for one district at 16:9 (pitch 34, azimuth 0, fit 0.75 of the district chord). */
function districtPose(id: DistrictKind, label: string, why: string): EdgePose {
  const district = generateDistricts(NORDIC_LAYOUT, LAND_SEED).find((d) => d.id === id)!
  return {
    id: `district-${id === 'fjord-village' ? 'village' : id === 'basalt-canyon' ? 'canyon' : id === 'highland-hamlet' ? 'hamlet' : id === 'geothermal-farms' ? 'geothermal' : 'archipelago'}` as EdgePoseId,
    label,
    why,
    target: [district.center[0], NORDIC_LAYOUT.groundHeight + STATIONS.district.targetLift, district.center[1]],
    pitchDeg: STATIONS.district.pitchDeg,
    azimuthDeg: STATIONS.district.azimuthDeg,
    distance: fitDistance(districtChord(district), STATIONS.district.fitWidth ?? 0.75, STATIONS.district.fov, 16 / 9),
  }
}

/**
 * Fixed comparison poses for the edge lab (`?pose=<id>`). Pitch is elevation above the tangent
 * plane; azimuth is the direction from the target to the camera, measured from +z (south, the
 * front) toward +x. Azimuth 0 puts the camera south of the target looking north up the fjord;
 * 180 looks south down the fjord to the sea.
 */
export type EdgePoseId =
  | 'overview'
  | 'north-out'
  | 'east-out'
  | 'south-out'
  | 'west-out'
  | 'low-horizon'
  | 'zoom-max'
  | 'horizon-max'
  | 'district-village'
  | 'district-canyon'
  | 'district-hamlet'
  | 'district-geothermal'
  | 'district-archipelago'
  | 'walk-quay'
  | 'walk-hamlet'

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

/** The product overview station at 16:9 (pitch 38, azimuth 0, fit 0.82 of the 224 m chord): ≈ 332.8 m. */
export const OVERVIEW_DISTANCE = fitDistance(NORDIC_LAYOUT.frameRadius * 2, STATIONS.overview.fitWidth ?? 0.82, STATIONS.overview.fov, 16 / 9)

export const EDGE_POSES: readonly EdgePose[] = [
  {
    id: 'overview',
    label: 'Overview',
    why: 'The product pose. The outer world must not change how the land reads.',
    target: [0, NORDIC_LAYOUT.groundHeight + STATIONS.overview.targetLift, 0],
    pitchDeg: STATIONS.overview.pitchDeg,
    azimuthDeg: STATIONS.overview.azimuthDeg,
    distance: OVERVIEW_DISTANCE,
  },
  {
    id: 'north-out',
    label: 'North, over the range',
    why: 'The authored range closes the fjord; from high over the hamlet the look clears its peaks: the rows behind it and the smoking volcano against the sky.',
    target: [19, 40, -150],
    pitchDeg: 14,
    azimuthDeg: 0,
    distance: 260,
  },
  {
    id: 'east-out',
    label: 'East, past the headland',
    why: 'Over the geothermal farms to the basalt palisade and the geyser field in its window.',
    target: [150, 4, -20],
    pitchDeg: 15,
    azimuthDeg: 270,
    distance: 170,
  },
  {
    id: 'south-out',
    label: 'South, down the fjord',
    why: 'The front crop as a real view: the fjord mouth, the bay, the longhouse headland and the sea beyond.',
    target: [-10, 2, 140],
    pitchDeg: 14,
    azimuthDeg: 180,
    distance: 170,
  },
  {
    id: 'west-out',
    label: 'West, over the canyon',
    why: 'Past the mine to the west palisade; the stave church on its moss hill and the glacier tongues behind.',
    target: [-150, 4, -40],
    pitchDeg: 15,
    azimuthDeg: 90,
    distance: 170,
  },
  {
    id: 'low-horizon',
    label: 'Low horizon down the fjord',
    why: 'Minimum pitch: the sea / sky join is in frame at the fjord mouth.',
    target: [0, 3, 20],
    pitchDeg: 12,
    azimuthDeg: 180,
    distance: 120,
  },
  {
    id: 'zoom-max',
    label: 'Maximum zoom out',
    why: 'The whole plate and everything beyond it, at the deepest dolly.',
    target: [0, 4, 0],
    pitchDeg: 30,
    azimuthDeg: 20,
    distance: 420,
  },
  {
    id: 'horizon-max',
    label: 'Horizon at maximum zoom',
    why: 'Lowest pitch at the furthest distance: whatever is above the horizon is in frame.',
    target: [0, 4, 0],
    pitchDeg: 12,
    azimuthDeg: 20,
    distance: 420,
  },
  districtPose('fjord-village', 'Station: village', 'The product district station on the fjord village and quay.'),
  districtPose('basalt-canyon', 'Station: canyon', 'The product district station on the basalt canyon and forge.'),
  districtPose('highland-hamlet', 'Station: hamlet', 'The product district station on the highland hamlet and pasture.'),
  districtPose('geothermal-farms', 'Station: geothermal', 'The product district station on the geothermal farms.'),
  districtPose('archipelago', 'Station: archipelago', 'The product district station on the lava archipelago.'),
  {
    id: 'walk-quay',
    label: 'Walking height: the quay',
    why: 'Eye level on the west moor looking east over the village to the quay and the fjord.',
    target: [-70, 3, 30],
    pitchDeg: 14,
    azimuthDeg: 250,
    distance: 60,
  },
  {
    id: 'walk-hamlet',
    label: 'Walking height: the hamlet',
    why: 'Eye level over the fjord looking west at the hamlet with the canyon behind.',
    target: [-35, 3, -45],
    pitchDeg: 14,
    azimuthDeg: 120,
    distance: 60,
  },
]

export const EDGE_POSE_IDS: readonly EdgePoseId[] = EDGE_POSES.map((pose) => pose.id)

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

/** Every comparison pose must be reachable under the free camera limits and inside both boxes. */
export function poseWithinLimits(pose: EdgePose, limits: FreeCameraLimits = FREE_CAMERA_LIMITS): boolean {
  const [x, y, z] = edgePosePosition(pose)
  return (
    pose.pitchDeg >= limits.pitchMinDeg &&
    pose.pitchDeg <= limits.pitchMaxDeg &&
    pose.distance >= limits.minDistance &&
    pose.distance <= limits.maxDistance &&
    insideBox(LOOK_BOX, ...pose.target) &&
    insideBox(CAMERA_BOX, x, y, z)
  )
}
