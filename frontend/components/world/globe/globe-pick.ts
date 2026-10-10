export interface GlobePickVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GlobePickLandmark {
  readonly id: string;
  readonly position: GlobePickVec3;
  readonly screen?: { readonly x: number; readonly y: number };
}

export type GlobePickIntent = "hover" | "click";

/** Allow the exact silhouette so edge towns stay hittable. */
export const GLOBE_PICK_FACING_EPSILON = 1e-3;

/** World-unit pad around a landmark footprint. Not the globe radius. */
export const GLOBE_PICK_RADIUS = 0.95;

/** Covers the on-screen bouquet without reaching across the globe. */
export const GLOBE_PICK_SCREEN_PX = 120;

/** Real spin: settle to the facing course only when the pointer is not on a town. */
export const GLOBE_SPIN_SETTLE_PX = 24;

export function globeLayoutSize(node: {
  clientWidth: number;
  clientHeight: number;
}): { width: number; height: number } {
  return {
    width: Math.max(1, node.clientWidth),
    height: Math.max(1, node.clientHeight),
  };
}

export function globePointerNdc(
  offsetX: number,
  offsetY: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: (offsetX / Math.max(1, viewport.width)) * 2 - 1,
    y: -(offsetY / Math.max(1, viewport.height)) * 2 + 1,
  };
}

export type GlobePointerUpResult =
  | { readonly type: "select"; readonly courseId: string }
  | { readonly type: "settle" }
  | { readonly type: "none" };

export function resolveGlobePointerUp(args: {
  facingLandmarkId: string | null;
  travelPx: number;
  spinThresholdPx?: number;
}): GlobePointerUpResult {
  if (args.facingLandmarkId) {
    return { type: "select", courseId: args.facingLandmarkId };
  }
  if (args.travelPx >= (args.spinThresholdPx ?? GLOBE_SPIN_SETTLE_PX)) {
    return { type: "settle" };
  }
  return { type: "none" };
}

export interface GlobePickArgs {
  rayOrigin: GlobePickVec3;
  rayDirection: GlobePickVec3;
  camera: GlobePickVec3;
  globeCenter: GlobePickVec3;
  landmarks: readonly GlobePickLandmark[];
  pickRadius?: number;
  facingEpsilon?: number;
  intent?: GlobePickIntent;
  pointer?: { readonly x: number; readonly y: number };
  maxScreenPx?: number;
}

function sub(a: GlobePickVec3, b: GlobePickVec3): GlobePickVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: GlobePickVec3, b: GlobePickVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(a: GlobePickVec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: GlobePickVec3): GlobePickVec3 {
  const hyp = length(a);
  if (hyp === 0) return { x: 0, y: 0, z: 0 };
  return { x: a.x / hyp, y: a.y / hyp, z: a.z / hyp };
}

export function globeLandmarkFacingDot(
  landmark: GlobePickVec3,
  globeCenter: GlobePickVec3,
  camera: GlobePickVec3,
): number {
  return dot(sub(landmark, globeCenter), sub(camera, landmark));
}

export function isGlobeLandmarkFacing(
  landmark: GlobePickVec3,
  globeCenter: GlobePickVec3,
  camera: GlobePickVec3,
  epsilon = GLOBE_PICK_FACING_EPSILON,
): boolean {
  return globeLandmarkFacingDot(landmark, globeCenter, camera) > -epsilon;
}

function distanceToRay(
  point: GlobePickVec3,
  origin: GlobePickVec3,
  direction: GlobePickVec3,
): number {
  const offset = sub(point, origin);
  const along = dot(offset, direction);
  if (along <= 0) return Number.POSITIVE_INFINITY;
  const closest = {
    x: origin.x + direction.x * along,
    y: origin.y + direction.y * along,
    z: origin.z + direction.z * along,
  };
  return length(sub(point, closest));
}

export function pickGlobeLandmark(args: GlobePickArgs): string | null {
  const direction = normalize(args.rayDirection);
  const radius = args.pickRadius ?? GLOBE_PICK_RADIUS;
  const epsilon = args.facingEpsilon ?? GLOBE_PICK_FACING_EPSILON;
  const screenLimit = args.maxScreenPx ?? GLOBE_PICK_SCREEN_PX;
  const useScreen = Boolean(args.pointer);
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCameraDistance = Number.POSITIVE_INFINITY;

  for (const landmark of args.landmarks) {
    if (!isGlobeLandmarkFacing(landmark.position, args.globeCenter, args.camera, epsilon)) {
      continue;
    }
    const rayDistance = distanceToRay(landmark.position, args.rayOrigin, direction);
    const screenDistance =
      useScreen && args.pointer && landmark.screen
        ? Math.hypot(
            landmark.screen.x - args.pointer.x,
            landmark.screen.y - args.pointer.y,
          )
        : Number.POSITIVE_INFINITY;
    const inWorld = rayDistance <= radius;
    const inScreen = screenDistance <= screenLimit;
    if (!inWorld && !inScreen) continue;
    const distance = inScreen ? screenDistance : rayDistance;
    const cameraDistance = length(sub(landmark.position, args.camera));
    if (
      distance < bestDistance ||
      (distance === bestDistance && cameraDistance < bestCameraDistance)
    ) {
      bestDistance = distance;
      bestCameraDistance = cameraDistance;
      bestId = landmark.id;
    }
  }

  return bestId;
}
