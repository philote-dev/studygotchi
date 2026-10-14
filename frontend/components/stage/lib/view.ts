/**
 * The stage camera and the mapping from viewport fractions to world space.
 *
 * S1 keeps the camera at the origin looking down -Z; the sky is built in world
 * space for that pose, with real depth per layer, so a later camera move
 * (the planet -> constellation pull-back) gets true parallax for free.
 */
export const STAGE_CAMERA = {
  fov: 40,
  near: 0.5,
  far: 400,
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
} as const;

/** Backdrop depths in world units: nearest to farthest object rung. */
export const BACKDROP_DISTANCE = { near: 70, far: 170 } as const;

export function backdropDistance(depth01: number): number {
  const t = Math.min(1, Math.max(0, depth01));
  return BACKDROP_DISTANCE.near + (BACKDROP_DISTANCE.far - BACKDROP_DISTANCE.near) * t;
}

/** Half extents of the view plane at `distance` for a vertical fov (degrees). */
export function viewHalfExtent(fovDeg: number, aspect: number, distance: number): { halfW: number; halfH: number } {
  const halfH = distance * Math.tan((fovDeg * Math.PI) / 360);
  return { halfW: halfH * aspect, halfH };
}

/** Viewport fractions (u right, v down) at `distance` -> world position on the view plane. */
export function toWorld(u: number, v: number, distance: number, fovDeg: number, aspect: number): [number, number, number] {
  const { halfW, halfH } = viewHalfExtent(fovDeg, aspect, distance);
  return [(u - 0.5) * 2 * halfW, (0.5 - v) * 2 * halfH, -distance];
}

/** World units per viewport height at `distance`. */
export function unitsPerViewportHeight(fovDeg: number, distance: number): number {
  return 2 * distance * Math.tan((fovDeg * Math.PI) / 360);
}
