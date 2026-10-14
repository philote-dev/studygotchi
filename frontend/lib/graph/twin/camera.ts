/**
 * The 2D constellation camera `{x, y, k}` as an orthographic projection.
 *
 * `KnowledgeCanvas` draws with `sx = (wx − cam.x)·k + w/2`, `sy = (wy − cam.y)·k + h/2`
 * (CSS px, y down). The twin keeps world coordinates in its vertex buffers and
 * lets a world-space orthographic camera do the same map: half extents `w/(2k)`
 * and `h/(2k)` around `(cam.x, cam.y)`, with `top < bottom` so world +y runs
 * down the screen exactly as it does on the canvas. Everything here is pure so
 * the mapping can be checked against the parity JSON without a GL context.
 */

import type { Camera2D, TwinSize } from "./types";

export interface OrthoFrustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  /** Camera position: the 2D camera centre, looking down −z. */
  position: { x: number; y: number; z: number };
}

export const TWIN_CAMERA_Z = 10;

/** The 2D canvas's world → screen map, verbatim. */
export function screenFromWorld(cam: Camera2D, size: TwinSize, x: number, y: number): { sx: number; sy: number } {
  return { sx: (x - cam.x) * cam.k + size.w / 2, sy: (y - cam.y) * cam.k + size.h / 2 };
}

/** Inverse of `screenFromWorld`. */
export function worldFromScreen(cam: Camera2D, size: TwinSize, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - size.w / 2) / cam.k + cam.x, y: (sy - size.h / 2) / cam.k + cam.y };
}

/** Orthographic frustum (world units) equivalent to the 2D camera over a `size` box. */
export function orthoFrom2D(cam: Camera2D, size: TwinSize): OrthoFrustum {
  const k = cam.k > 0 ? cam.k : 1;
  const halfW = size.w / (2 * k);
  const halfH = size.h / (2 * k);
  return {
    left: -halfW,
    right: halfW,
    // Flipped on purpose: the canvas's y grows downward.
    top: -halfH,
    bottom: halfH,
    near: 0.1,
    far: 100,
    position: { x: cam.x, y: cam.y, z: TWIN_CAMERA_Z },
  };
}

/**
 * The column-major projection × view matrix `orthoFrom2D` yields (what three's
 * `OrthographicCamera.updateProjectionMatrix` builds from the same frustum, times
 * the inverse of a translation to `position`). Only used to verify the mapping.
 */
export function viewProjectionMatrix(f: OrthoFrustum): Float64Array {
  const w = 1 / (f.right - f.left);
  const h = 1 / (f.top - f.bottom);
  const p = 1 / (f.far - f.near);
  const x = (f.right + f.left) * w;
  const y = (f.top + f.bottom) * h;
  const z = (f.far + f.near) * p;
  // three: makeOrthographic (column-major)
  const proj = new Float64Array([2 * w, 0, 0, 0, 0, 2 * h, 0, 0, 0, 0, -2 * p, 0, -x, -y, -z, 1]);
  // view = inverse(translate(position)) = translate(−position)
  const tx = -f.position.x;
  const ty = -f.position.y;
  const tz = -f.position.z;
  const out = new Float64Array(16);
  // out = proj × view, where view only has a translation column (tx, ty, tz, 1).
  for (let c = 0; c < 3; c += 1) for (let r = 0; r < 4; r += 1) out[c * 4 + r] = proj[c * 4 + r];
  for (let r = 0; r < 4; r += 1) {
    out[12 + r] = proj[r] * tx + proj[4 + r] * ty + proj[8 + r] * tz + proj[12 + r];
  }
  return out;
}

/** World → CSS-px screen position through the matrix (the GL viewport transform). */
export function projectThroughMatrix(m: Float64Array, size: TwinSize, x: number, y: number, z = 0): { sx: number; sy: number } {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  const nx = cx / cw;
  const ny = cy / cw;
  return { sx: ((nx + 1) / 2) * size.w, sy: ((1 - ny) / 2) * size.h };
}
