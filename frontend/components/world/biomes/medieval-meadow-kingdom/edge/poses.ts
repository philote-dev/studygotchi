import {
  MEADOW_CAMERA_BOX,
  MEADOW_FREE_CAMERA_LIMITS,
  MEADOW_LOOK_BOX,
  STATIONS,
  insideBox,
  overviewPose,
  type FreeCameraLimits,
} from '../camera/stations'

/**
 * Fixed comparison poses for the meadow edge lab (`?pose=<id>`). Pitch is elevation above the
 * ground plane; azimuth is the direction from the target to the camera, measured from +z (south,
 * the old diorama front) toward +x. Azimuth 8° puts the camera south of the target looking north
 * over the Green Crown; 184° looks south toward the lake; 92° / 278° look west / east.
 *
 * The outward looks sit at 14–16° so the frame top is 2–4° above the horizon: the horizon line is
 * in every one of them, which is exactly where a plate edge or a fog wall would show.
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

/** The lab camera: the land's station FOV on a 16:9 capture. */
export const FRAME = { fovDeg: STATIONS.overview.fov, aspect: 16 / 9 } as const

const product = overviewPose(FRAME.aspect)
const productDistance = Math.hypot(
  product.position[0] - product.target[0],
  product.position[1] - product.target[1],
  product.position[2] - product.target[2],
)

export const EDGE_POSES: readonly EdgePose[] = [
  {
    id: 'overview',
    label: 'Overview',
    why: 'The product pose at 16:9. The outer world must not change how the kingdom reads.',
    target: product.target,
    pitchDeg: STATIONS.overview.pitchDeg,
    azimuthDeg: STATIONS.overview.azimuthDeg,
    distance: Math.round(productDistance * 100) / 100,
  },
  {
    id: 'north-out',
    label: 'North, over the Green Crown',
    why: 'From the north meadow looking past the crown hills: the ridge line and the castle crag window.',
    target: [-30, 6, -110],
    pitchDeg: 16,
    azimuthDeg: 8,
    distance: 150,
  },
  {
    id: 'east-out',
    label: 'East, over the east meadow',
    // The camera stands over the river bank by the south common, so the foreground is open meadow
    // (not the market's roofs) and the forest edge and the walled-city window sit in the middle distance.
    why: 'From the river bank looking east across the east meadow: the forest edge and the walled-city window.',
    target: [125, 2, 60],
    pitchDeg: 15,
    azimuthDeg: 278,
    distance: 140,
  },
  {
    id: 'south-out',
    label: 'South, down the river',
    why: 'The old forbidden view: the river running on under the camera to the lake and the monastery window.',
    target: [20, 1, 120],
    pitchDeg: 14,
    azimuthDeg: 184,
    distance: 140,
  },
  {
    id: 'west-out',
    label: 'West, past the forest hamlet',
    // Over the water meadow east of the river, so the village and hamlet sit in the middle distance and no roof is under the lens.
    why: 'Over the river village and the hamlet to the western forest edge and the windmill-hill window.',
    target: [-100, 2, -40],
    pitchDeg: 16,
    azimuthDeg: 92,
    distance: 140,
  },
  {
    id: 'low-horizon',
    label: 'Low horizon through the market',
    why: 'Minimum pitch from the land centre: the ground / sky join is in frame over the whole kingdom.',
    target: [0, 4, 10],
    pitchDeg: 12,
    azimuthDeg: 30,
    distance: 120,
  },
  {
    id: 'zoom-max',
    label: 'Maximum zoom out',
    why: 'The whole plate and everything the outer world puts beyond it.',
    target: [0, 4, 0],
    pitchDeg: 30,
    azimuthDeg: 8,
    distance: 380,
  },
  {
    id: 'horizon-max',
    label: 'Horizon at maximum zoom',
    why: 'Lowest pitch at the furthest distance: whatever stands above the horizon is in frame.',
    target: [0, 4, 0],
    pitchDeg: 12,
    azimuthDeg: 20,
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

/** Every comparison pose must be reachable under the free camera limits and sit inside both boxes. */
export function poseWithinLimits(pose: EdgePose, limits: FreeCameraLimits = MEADOW_FREE_CAMERA_LIMITS): boolean {
  const [x, y, z] = edgePosePosition(pose)
  return (
    pose.pitchDeg >= limits.pitchMinDeg &&
    pose.pitchDeg <= limits.pitchMaxDeg &&
    pose.distance >= limits.minDistance &&
    pose.distance <= limits.maxDistance &&
    insideBox(MEADOW_CAMERA_BOX, x, y, z) &&
    insideBox(MEADOW_LOOK_BOX, ...pose.target)
  )
}

/* ---------- camera frame maths (shared by the barrier plan and the tests) ---------- */

export interface Cam {
  x: number
  y: number
  z: number
}

export function poseCamera(pose: EdgePose): Cam {
  const [x, y, z] = edgePosePosition(pose)
  return { x, y, z }
}

/** Direction the pose looks (camera → target), degrees from +z toward +x. */
export function viewBearingDeg(pose: EdgePose): number {
  return (pose.azimuthDeg + 180) % 360
}

export function wrapDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

export function bearingDeltaDeg(a: number, b: number): number {
  return Math.abs(wrapDeg(a - b))
}

export function bearingOf(x: number, z: number): number {
  return ((Math.atan2(x, z) * 180) / Math.PI + 360) % 360
}

/** Degrees below the horizontal from the camera to a point (positive = looking down). */
export function elevationDownDeg(cam: Cam, x: number, y: number, z: number): number {
  return (Math.atan2(cam.y - y, Math.hypot(x - cam.x, z - cam.z)) * 180) / Math.PI
}

export function frameTopDeg(pose: EdgePose, fovDeg: number = FRAME.fovDeg): number {
  return pose.pitchDeg - fovDeg / 2
}

export function frameBottomDeg(pose: EdgePose, fovDeg: number = FRAME.fovDeg): number {
  return pose.pitchDeg + fovDeg / 2
}

export function frameHalfWidthDeg(fovDeg: number = FRAME.fovDeg, aspect: number = FRAME.aspect): number {
  return (Math.atan(Math.tan((fovDeg * Math.PI) / 360) * aspect) * 180) / Math.PI
}

/** Horizontal angle of a point off the pose's view direction. */
export function lateralDeg(pose: EdgePose, x: number, z: number): number {
  const cam = poseCamera(pose)
  return bearingDeltaDeg(bearingOf(x - cam.x, z - cam.z), viewBearingDeg(pose))
}

/** Whether a world point lands inside the pose's frame, with a safety margin (degrees). */
export function inPoseFrame(pose: EdgePose, x: number, y: number, z: number, margin = 0.6, aspect: number = FRAME.aspect): boolean {
  const down = elevationDownDeg(poseCamera(pose), x, y, z)
  if (down < frameTopDeg(pose) + margin || down > frameBottomDeg(pose) - margin) return false
  return lateralDeg(pose, x, z) <= frameHalfWidthDeg(FRAME.fovDeg, aspect) - margin
}

/** Distance from a point to the horizontal segment camera → landmark, for sightline checks. */
export function distanceToSightline(cam: Cam, to: { x: number; z: number }, x: number, z: number): number {
  const dx = to.x - cam.x
  const dz = to.z - cam.z
  const len2 = dx * dx + dz * dz || 1
  const t = Math.min(1, Math.max(0, ((x - cam.x) * dx + (z - cam.z) * dz) / len2))
  return Math.hypot(cam.x + dx * t - x, cam.z + dz * t - z)
}

/**
 * Whether a ground point is inside the product overview frustum at a given aspect (the frame is
 * fit by width, so narrower viewports pull the camera back and see further). Used to keep the
 * outer world's decoration out of the shipped overview.
 */
export function inOverviewFrustum(x: number, y: number, z: number, aspect: number, marginDeg = 0): boolean {
  const pose = overviewPose(aspect)
  const [cx, cy, cz] = pose.position
  const [tx, ty, tz] = pose.target
  // Camera basis: forward toward the target, right = forward × up, up = right × forward.
  let fx = tx - cx
  let fy = ty - cy
  let fz = tz - cz
  const fl = Math.hypot(fx, fy, fz) || 1
  fx /= fl
  fy /= fl
  fz /= fl
  const rx = fz
  const rz = -fx
  const rl = Math.hypot(rx, rz) || 1
  const ux = -fy * (rz / rl)
  const uy = fx * (rz / rl) - fz * (rx / rl)
  const uz = fy * (rx / rl)
  const dx = x - cx
  const dy = y - cy
  const dz = z - cz
  const depth = dx * fx + dy * fy + dz * fz
  if (depth <= 0) return false
  const side = (dx * rx + dz * rz) / rl
  const rise = dx * ux + dy * uy + dz * uz
  const halfV = Math.tan(((STATIONS.overview.fov / 2 + marginDeg) * Math.PI) / 180)
  const halfH = Math.tan(((frameHalfWidthDeg(STATIONS.overview.fov, aspect) + marginDeg) * Math.PI) / 180)
  return Math.abs(rise) <= depth * halfV && Math.abs(side) <= depth * halfH
}
