import { useLayoutEffect, type RefObject } from "react";
import * as THREE from "three";
import { backOut, clamp01, easeOutQuad } from "./easing";
import { gravityClock } from "./clock";
import type { GravityFrame, Vec3 } from "./frame";
import type { GravityTheme } from "./uniforms";
import { OBJECT_LAYER } from "../render/lens-pass";

/** Props every gravity object shares, so the galaxy layout can place any of them. */
export interface GravityObjectBase {
  /** Outer radius in CSS px at the hero camera distance. */
  size: number;
  seed: number;
  theme: GravityTheme;
  /** 0..1 activity and brightness multiplier (particles, glow, lens ring). */
  intensity: number;
  /** World position; the hero camera sits at z = 3.3 looking at the origin. */
  position: Vec3;
  /** Which of the shared lens pass's slots this object writes. */
  lensSlot: number;
  /** Multiplier on the object's default Einstein radius. */
  lensStrength: number;
  frame: RefObject<GravityFrame>;
  onHover?: (hovered: boolean) => void;
}

/** A one-shot beat timeline on wall time (frozen for `?t=` captures). */
export class Beat {
  startedAt = -1e9;
  start(): void {
    this.startedAt = gravityClock.beatStart();
  }
  elapsed(): number {
    return gravityClock.real - this.startedAt;
  }
  /** 0..1 progress through [from, to] seconds, clamped. */
  progress(from: number, to: number): number {
    return clamp01((this.elapsed() - from) / Math.max(1e-6, to - from));
  }
  within(duration: number): boolean {
    const e = this.elapsed();
    return e >= 0 && e < duration;
  }
}

/** Hover swell: back-out on enter (180 ms), ease-out on leave (220 ms). */
export class Swell {
  value = 1;
  private from = 1;
  private to = 1;
  private start = 0;
  on = false;

  set(on: boolean, scale = 1.06): void {
    if (this.on === on) return;
    this.on = on;
    this.from = this.value;
    this.to = on ? scale : 1;
    this.start = gravityClock.real;
  }

  update(): number {
    const dur = this.to > this.from ? 0.18 : 0.22;
    const k = clamp01((gravityClock.real - this.start) / dur);
    this.value = this.from + (this.to - this.from) * (this.to > this.from ? backOut(k) : easeOutQuad(k));
    return this.value;
  }
}

/** Put an object (and its children) on the layer the lens pass composites over the sky. */
export function useObjectLayer(...refs: RefObject<THREE.Object3D | null>[]): void {
  useLayoutEffect(() => {
    for (const ref of refs) ref.current?.traverse((o) => o.layers.set(OBJECT_LAYER));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function setColor(uniform: THREE.IUniform, hex: string): void {
  (uniform.value as THREE.Color).set(hex);
}

export const vec3 = (v: Vec3) => new THREE.Vector3(v[0], v[1], v[2]);
