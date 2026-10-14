import * as THREE from "three";
import type { GravityTheme } from "./uniforms";

export type Vec3 = readonly [number, number, number];

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** How many gravity objects the shared lens pass can warp at once. */
export const MAX_LENSES = 4;

/**
 * One lens centre for the shared post pass. Radii are in composer UV *y*
 * units (1 = full canvas height), the same units the pass measures distance in
 * after correcting for aspect, so a value of `r / size.height` is `r` CSS px.
 */
export interface LensSource {
  /** Centre in composer UV (0..1, origin bottom-left). */
  center: THREE.Vector2;
  /** Einstein radius: deflection is thetaE^2 / r, capped at `maxCells`. */
  thetaE: number;
  /** Nothing inside this radius is warped (the object's own sprite covers it). */
  inner: number;
  /** +1 pulls the sky inward into arcs (black hole, wormhole), -1 pushes it away (white hole), 0 off. */
  sign: number;
  /** Banded brightening of a 1 to 2 cell ring at thetaE (the Einstein ring). 0..1. */
  ring: number;
  /** Tangential twist, radians at the inner edge, fading by 2 thetaE (wormhole swirl). */
  swirl: number;
  /** Overall strength multiplier on thetaE^2; 0 disables the slot. */
  strength: number;
  /** Displacement cap in cells for this lens (bigger objects earn a bigger cap). */
  maxCells: number;
}

/**
 * Everything the composer needs for one frame. Written in place by the scene
 * and the exhibits (no allocations), read by `GravityComposer`.
 */
export interface GravityFrame {
  theme: GravityTheme;
  cam: CameraPose;
  /** CSS px per pixel-pass cell. */
  pixel: number;
  /** Default displacement cap in cells (exhibits scale it with their size). */
  maxCells: number;
  lenses: LensSource[];
  flash: number;
  flashColor: THREE.Color;
  ringColor: THREE.Color;
}

export const HERO_POSE: CameraPose = { position: [0, 0, 3.3], target: [0, 0, 0], fov: 40 };

export function createLens(): LensSource {
  return { center: new THREE.Vector2(0.5, 0.5), thetaE: 0.1, inner: 0.05, sign: 1, ring: 0, swirl: 0, strength: 0, maxCells: 16 };
}

export function createGravityFrame(theme: GravityTheme): GravityFrame {
  return {
    theme,
    cam: HERO_POSE,
    pixel: 2,
    maxCells: 16,
    lenses: Array.from({ length: MAX_LENSES }, createLens),
    flash: 0,
    flashColor: new THREE.Color("#fff0c2"),
    ringColor: new THREE.Color("#fff0c2"),
  };
}

const target = new THREE.Vector3();

export function applyPose(camera: THREE.Camera, pose: CameraPose): void {
  camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
  target.set(pose.target[0], pose.target[1], pose.target[2]);
  camera.lookAt(target);
  if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - pose.fov) > 1e-4) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const right = new THREE.Vector3();

/**
 * Project a world-space circle (centre, radius) to composer UV: centre in UV
 * and the on-screen radius in UV y units. Uses the camera's right vector so a
 * dolly toward the object scales the lens with the sprite.
 */
export function projectCircle(camera: THREE.Camera, center: THREE.Vector3, radius: number, aspect: number, out: THREE.Vector2): number {
  scratchA.copy(center).project(camera);
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  scratchB.copy(center).addScaledVector(right, radius).project(camera);
  out.set(scratchA.x * 0.5 + 0.5, scratchA.y * 0.5 + 0.5);
  return Math.abs(scratchB.x - scratchA.x) * 0.5 * aspect;
}

/** World-space radius that renders as `px` CSS px at `distance` for a perspective camera. */
export function worldRadiusForPx(camera: THREE.Camera, px: number, distance: number, viewportHeightPx: number): number {
  const cam = camera as THREE.PerspectiveCamera;
  const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  return (px / viewportHeightPx) * viewHeight;
}
