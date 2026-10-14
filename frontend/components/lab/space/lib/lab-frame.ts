import { createContext, useContext } from "react";
import * as THREE from "three";
import type { LabTheme } from "./lab-uniforms";

export type Vec3 = readonly [number, number, number];

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

export interface LensState {
  active: boolean;
  /** Black hole centre in composer UV. */
  center: THREE.Vector2;
  /** Einstein radius in UV y units. */
  thetaE: number;
  /** Disc (sprite) radius in UV y units; nothing inside it is warped. */
  disc: number;
  /** Displacement cap in cells. */
  maxCells: number;
}

/**
 * Everything the composer needs for one frame, written by the active scene
 * each frame (mutated in place, no allocations) and read by `LabComposer`.
 * During a hop two layer sets and two camera poses are live: A is outgoing,
 * B is incoming, and `mix` dissolves between their pixel targets.
 */
/**
 * Snapshot curtain: the composer copies the composed frame into a render
 * target while `capture` is set, and shows that snapshot (zoomed, pixelated,
 * Bayer-dissolved against live geometry by `mix`) until the readiness gate
 * lifts it. `mix` 1 = live only.
 */
export interface CurtainState {
  capture: boolean;
  mix: number;
  zoom: number;
  /** CSS px per snapshot cell. */
  pixel: number;
}

export interface LabFrame {
  theme: LabTheme;
  layersA: string[];
  layersB: string[];
  camA: CameraPose;
  camB: CameraPose;
  mix: number;
  /** CSS px per pixel-pass cell. */
  pixel: number;
  flash: number;
  flashColor: THREE.Color;
  lens: LensState;
  curtain: CurtainState;
  /** Layer names to render once offscreen this frame (readiness warm-up); the composer moves them into `warmed`. */
  warm: string[];
  warmed: Set<string>;
}

export function createLabFrame(theme: LabTheme): LabFrame {
  const pose: CameraPose = { position: [0, 0, 3.4], target: [0, 0, 0], fov: 40 };
  return {
    theme,
    layersA: [],
    layersB: [],
    camA: pose,
    camB: pose,
    mix: 0,
    pixel: 2,
    flash: 0,
    flashColor: new THREE.Color("#fff0c2"),
    lens: { active: false, center: new THREE.Vector2(0.5, 0.5), thetaE: 0.1, disc: 0.05, maxCells: 8 },
    curtain: { capture: false, mix: 1, zoom: 1, pixel: 2 },
    warm: [],
    warmed: new Set(),
  };
}

export type LabRegistry = Map<string, THREE.Object3D>;

export const LabRegistryContext = createContext<LabRegistry | null>(null);

export function useLabRegistry(): LabRegistry {
  const registry = useContext(LabRegistryContext);
  if (!registry) throw new Error("useLabRegistry outside SpaceLab");
  return registry;
}

/** Make exactly the named groups visible. */
export function applyLayers(registry: LabRegistry, visible: readonly string[]): void {
  for (const [name, object] of registry) object.visible = visible.includes(name);
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

/**
 * The lab clock: one time source for spin, twinkle, beads and the director.
 * Hit-stop and slow motion scale it; everything that reads `seconds` agrees.
 */
export class LabClock {
  seconds = 0;
  /** Slow-motion factor (1 or 0.25). */
  scale = 1;
  /** Real-time seconds remaining in a hit-stop (time scale 0.1 while > 0). */
  hitStop = 0;
  /** When set, the clock is frozen at this value (debug `?t=`). */
  frozenAt: number | null = null;

  advance(dtReal: number): number {
    if (this.frozenAt !== null) {
      this.seconds = this.frozenAt;
      return 0;
    }
    let factor = this.scale;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dtReal);
      factor *= 0.1;
    }
    const dt = Math.min(dtReal, 0.1) * factor;
    this.seconds += dt;
    return dt;
  }

  stop(realSeconds: number): void {
    this.hitStop = Math.max(this.hitStop, realSeconds);
  }
}

export const labClock = new LabClock();
