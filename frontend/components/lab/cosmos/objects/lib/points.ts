"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { COSMOS_UNIFORMS, GLSL_COMMON } from "./uniforms";
import type { ObjectTheme } from "./types";

/**
 * Point layers: every exhibit's crisp part is a `Points` draw with one cell
 * (or an odd NxN sprite) per vertex, snapped to the pixel-pass grid in the
 * vertex shader. Buffers are plain arrays so generators are testable in node.
 */
export interface PointBuffers {
  count: number;
  /** xyz in the object's [-1, 1] box (or generator-defined meaning). */
  position: Float32Array;
  color: Float32Array;
  /** Point size in cells (odd integers). */
  size: Float32Array;
  phase: Float32Array;
  /** 0 square, 1 plus, 2 round blob, 3 sparkle 5x5, 4 lit moon. */
  shape: Float32Array;
  /** Generator-defined vec4 per point. */
  aux: Float32Array;
}

export const SHAPE = { cell: 0, plus: 1, blob: 2, sparkle: 3, moon: 4 } as const;

export class PointWriter {
  readonly position: Float32Array;
  readonly color: Float32Array;
  readonly size: Float32Array;
  readonly phase: Float32Array;
  readonly shape: Float32Array;
  readonly aux: Float32Array;
  count = 0;
  private readonly c = new THREE.Color();

  constructor(readonly capacity: number) {
    this.position = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.phase = new Float32Array(capacity);
    this.shape = new Float32Array(capacity);
    this.aux = new Float32Array(capacity * 4);
  }

  push(
    x: number,
    y: number,
    z: number,
    color: string | THREE.Color,
    size = 1,
    phase = 0,
    shape: number = SHAPE.cell,
    aux: readonly [number, number, number, number] = [0, 0, 0, 0],
  ): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.position[i * 3] = x;
    this.position[i * 3 + 1] = y;
    this.position[i * 3 + 2] = z;
    const c = typeof color === "string" ? this.c.set(color) : color;
    this.color[i * 3] = c.r;
    this.color[i * 3 + 1] = c.g;
    this.color[i * 3 + 2] = c.b;
    this.size[i] = size;
    this.phase[i] = phase;
    this.shape[i] = shape;
    this.aux.set(aux, i * 4);
  }

  finish(): PointBuffers {
    const n = this.count;
    return {
      count: n,
      position: this.position.subarray(0, n * 3),
      color: this.color.subarray(0, n * 3),
      size: this.size.subarray(0, n),
      phase: this.phase.subarray(0, n),
      shape: this.shape.subarray(0, n),
      aux: this.aux.subarray(0, n * 4),
    };
  }
}

export function pointsGeometry(b: PointBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
  g.setAttribute("color", new THREE.BufferAttribute(b.color, 3));
  g.setAttribute("size", new THREE.BufferAttribute(b.size, 1));
  g.setAttribute("phase", new THREE.BufferAttribute(b.phase, 1));
  g.setAttribute("shape", new THREE.BufferAttribute(b.shape, 1));
  g.setAttribute("aux", new THREE.BufferAttribute(b.aux, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export function usePointsGeometry(buffers: PointBuffers): THREE.BufferGeometry {
  const geometry = useMemo(() => pointsGeometry(buffers), [buffers]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/** Vertex prelude: shared uniforms, attributes, varyings and `emitPoint`. */
export const POINT_PRELUDE = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uFade;
attribute float size;
attribute float phase;
attribute float shape;
attribute vec4 aux;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vSize;
varying float vSide;
${GLSL_COMMON}
void emitPoint(vec3 p, vec3 c, float a, float s, float sh) {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_Position = snapClip(clip, uRes);
  gl_PointSize = s;
  vColor = themeTone(c, uLight);
  vAlpha = a * uFade;
  vShape = sh;
  vSize = s;
  vSide = 0.0;
}
`;

/** Default vertex: static points, two-step twinkle on anything bigger than a cell. */
export const POINT_VERT = /* glsl */ `
${POINT_PRELUDE}
void main() {
  float tw = size > 1.5 ? mix(0.6, 1.0, twinkle2(uTime, phase)) : 1.0;
  emitPoint(position, color * tw, 1.0, size, shape);
}
`;

export const POINT_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vSize;
varying float vSide;
void main() {
  if (vAlpha <= 0.002) discard;
  float a = vAlpha;
  if (vSize > 1.5) {
    float n = floor(vSize + 0.5);
    vec2 q = floor(gl_PointCoord * n);
    float h = floor(n * 0.5);
    vec2 d = abs(q - h);
    float m = max(d.x, d.y);
    if (vShape < 0.5) {
      // square: full
    } else if (vShape < 1.5) {
      // plus: corners empty, arms dimmer
      if (d.x > 0.0 && d.y > 0.0) discard;
      if (m > 0.0) a *= 0.45;
    } else if (vShape < 2.5) {
      // round blob: drop corners
      if (d.x + d.y > h + 0.5) discard;
    } else if (vShape < 3.5) {
      // sparkle: plus with a 2-step falloff, bright centre
      if (d.x > 0.0 && d.y > 0.0) discard;
      a *= m <= 0.0 ? 1.0 : m <= 1.0 ? 0.7 : 0.35;
    } else {
      // lit moon: round, far side from the sun dimmed
      if (d.x + d.y > h + 0.5) discard;
      if ((q.x - h) * vSide < -0.5) a *= 0.4;
    }
  }
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

export interface PointsMaterialOptions {
  vertexShader?: string;
  fragmentShader?: string;
  uniforms?: Record<string, THREE.IUniform>;
  theme: ObjectTheme;
  fade?: number;
  /** Additive on the dark sky (default); set false for opaque sprites. */
  additive?: boolean;
}

export function makePointsMaterial(o: PointsMaterialOptions): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: o.vertexShader ?? POINT_VERT,
    fragmentShader: o.fragmentShader ?? POINT_FRAG,
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: o.theme === "dark" && o.additive !== false ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: COSMOS_UNIFORMS.uTime,
      uRes: COSMOS_UNIFORMS.uRes,
      uLight: COSMOS_UNIFORMS.uLight,
      uFade: { value: o.fade ?? 1 },
      ...(o.uniforms ?? {}),
    },
  });
  return m;
}

/** Memoised points material; `uniforms` object identity is the dependency, write `.value` to animate. */
export function usePointsMaterial(o: PointsMaterialOptions): THREE.ShaderMaterial {
  const material = useMemo(
    () => makePointsMaterial(o),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o.vertexShader, o.fragmentShader, o.uniforms, o.theme, o.additive],
  );
  useEffect(() => {
    material.uniforms.uFade.value = o.fade ?? 1;
  }, [material, o.fade]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}
