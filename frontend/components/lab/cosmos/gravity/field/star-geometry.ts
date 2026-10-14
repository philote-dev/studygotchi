import * as THREE from "three";
import { mulberry32 } from "../lib/rng";
import { SKY } from "../palettes";

export interface StarPatchOptions {
  seed: number;
  count: number;
  /** Half-extents of the patch in world units at depth 1 (scaled per layer by its depth). */
  halfWidth: number;
  halfHeight: number;
  /** Constant world-unit margin added to every layer so a lateral dolly never shows the patch edge. */
  slack?: number;
}

/**
 * Three depth layers of stars filling a frustum-shaped slab in front of the
 * camera (not a sphere: the lens needs a dense field *behind* the objects, and
 * a sphere puts only ~7 percent of its points in a 40 degree view). Layers at
 * depth 1.0 / 0.6 / 0.35 of the far plane, so a dolly parallaxes them.
 * Dense far layer of soft single cells, mid layer of bright cells, sparse near
 * layer of 3x3 plus stars that twinkle.
 */
export const STAR_LAYERS = [
  { share: 0.6, depth: 1.0, size: 1, bright: 0.45 },
  { share: 0.33, depth: 0.6, size: 1, bright: 1.0 },
  { share: 0.07, depth: 0.35, size: 3, bright: 1.0 },
] as const;

export function buildStarPatch({ seed, count, halfWidth, halfHeight, slack = 1.8 }: StarPatchOptions, farZ: number): THREE.BufferGeometry {
  const rng = mulberry32(seed ^ 0x51a7);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const shape = new Float32Array(count);
  const star = new THREE.Color(SKY.starDark);
  const soft = new THREE.Color(SKY.starSoftDark);
  const warm = new THREE.Color(SKY.starWarm);
  const blue = new THREE.Color(SKY.starBlue);
  const c = new THREE.Color();
  let i = 0;
  for (const layer of STAR_LAYERS) {
    const n = Math.round(count * layer.share);
    const z = -farZ * layer.depth;
    const sx = halfWidth * farZ * layer.depth + slack;
    const sy = halfHeight * farZ * layer.depth + slack;
    for (let k = 0; k < n && i < count; k++, i++) {
      pos.set([(rng() * 2 - 1) * sx, (rng() * 2 - 1) * sy, z * (0.94 + 0.12 * rng())], i * 3);
      c.copy(layer.bright < 1 ? soft : star);
      const roll = rng();
      if (layer.size > 1) c.copy(roll < 0.3 ? warm : roll < 0.55 ? blue : star);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = layer.size;
      phase[i] = rng();
      shape[i] = layer.size > 1 ? 1 : 0;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("size", new THREE.BufferAttribute(size, 1));
  g.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
  g.setAttribute("shape", new THREE.BufferAttribute(shape, 1));
  return g;
}

/** Uniform sphere shell, for the wormhole's inner sky where the camera turns. */
export function buildStarShell(seed: number, count: number, radius: number): THREE.BufferGeometry {
  const rng = mulberry32(seed ^ 0x77a3);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const shape = new Float32Array(count);
  const star = new THREE.Color(SKY.starDark);
  const soft = new THREE.Color(SKY.starSoftDark);
  const warm = new THREE.Color(SKY.starWarm);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const z = rng() * 2 - 1;
    const t = rng() * Math.PI * 2;
    const rr = Math.sqrt(1 - z * z);
    pos.set([rr * Math.cos(t) * radius, z * radius, rr * Math.sin(t) * radius], i * 3);
    const roll = rng();
    const big = roll < 0.08;
    c.copy(big ? (rng() < 0.5 ? warm : star) : roll < 0.5 ? soft : star);
    col.set([c.r, c.g, c.b], i * 3);
    size[i] = big ? 3 : 1;
    phase[i] = rng();
    shape[i] = big ? 1 : 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("size", new THREE.BufferAttribute(size, 1));
  g.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
  g.setAttribute("shape", new THREE.BufferAttribute(shape, 1));
  return g;
}
