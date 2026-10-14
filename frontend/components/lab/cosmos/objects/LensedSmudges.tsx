"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { clamp, mulberry32, pick, range } from "./lib/rng";
import { QUAD_PRELUDE, color, unitPlaneGeometry, useQuadMaterial } from "./lib/quad";
import type { Exhibit, ObjectBase } from "./lib/types";

/**
 * Distant galaxy smudges for backgrounds: a set of tiny tilted ellipses and
 * lensed arcs (partial rings bent around an unseen mass), cream and blue,
 * two alpha bands each. Refs: the background galaxies in 06-cartwheel and
 * 01-m101 (confetti of warm ovals), Abell cluster lensing arcs.
 * Stylised: Spore's far galaxies, Outer Wilds' end-of-loop sky.
 *
 * Budget: 1 instanced quad draw (<= 12 instances).
 */
export interface SmudgeParams extends Record<string, number | string> {
  count: number;
  arcs: number;
}

export const SMUDGE_PALETTE = ["#e8cf9a", "#f0d9a8", "#c9d6e6", "#8fb0d8", "#e9a6c9"] as const;
export const SMUDGE_MAX = 12;

export interface SmudgeSpec {
  count: number;
  matrices: Float32Array;
  /** Per instance: r, g, b, kind (0 ellipse, 1 arc). */
  colorKind: Float32Array;
  /** Per instance: squash, arc span, arc phase, seed. */
  shape: Float32Array;
}

export function generateSmudges(seed: number, size: number, count: number, arcShare: number, cute: number): SmudgeSpec {
  const rng = mulberry32(seed ^ 0x5d6e);
  const n = clamp(Math.round(count), 1, SMUDGE_MAX);
  const matrices = new Float32Array(n * 16);
  const colorKind = new Float32Array(n * 4);
  const shape = new Float32Array(n * 4);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    // Loose ring layout so arcs read as bending around the centre.
    const a = (i / n) * Math.PI * 2 + range(rng, -0.3, 0.3);
    const r = range(rng, 0.35, 0.85);
    p.set(Math.cos(a) * r, Math.sin(a) * r, 0);
    const kind = rng() < arcShare ? 1 : 0;
    const w = size >= 96 ? range(rng, 0.12, 0.26) : range(rng, 0.18, 0.3);
    s.set(w, w, 1);
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), kind === 1 ? a + Math.PI / 2 : range(rng, 0, Math.PI));
    m.compose(p, q, s);
    m.toArray(matrices, i * 16);
    c.set(pick(rng, SMUDGE_PALETTE));
    colorKind.set([c.r, c.g, c.b, kind], i * 4);
    shape.set([range(rng, 0.3, 0.7) + 0.2 * cute, range(rng, 0.9, 1.8), 0, range(rng, 0, 100)], i * 4);
  }
  return { count: n, matrices, colorKind, shape };
}

const SMUDGE_VERT = /* glsl */ `
attribute vec4 iColorKind;
attribute vec4 iShape;
varying vec2 vUv;
varying vec4 vColorKind;
varying vec4 vShape;
void main() {
  vUv = uv * 2.0 - 1.0;
  vColorKind = iColorKind;
  vShape = iShape;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const SMUDGE_FRAG = /* glsl */ `
${QUAD_PRELUDE}
varying vec4 vColorKind;
varying vec4 vShape;
uniform vec3 uCore;
void main() {
  vec2 p = vUv;
  float a = 0.0;
  vec3 c = vColorKind.rgb;
  if (vColorKind.w < 0.5) {
    // Tilted ellipse, two bands, a one-cell warm core.
    float r = length(p / vec2(1.0, vShape.x));
    float lvl = band((1.0 - smoothstep(0.1, 1.0, r)) * 1.1, 3.0);
    if (lvl <= 0.0) discard;
    a = 0.3 + 0.4 * lvl;
    if (r < 0.2) c = uCore;
  } else {
    // Lensed arc: a thin partial ring whose span is vShape.y radians.
    float r = length(p);
    float th = atan(p.y, p.x);
    float inRing = step(abs(r - 0.78), 0.14);
    float inSpan = step(abs(th), vShape.y * 0.5);
    float soft = 1.0 - smoothstep(vShape.y * 0.3, vShape.y * 0.5, abs(th));
    float lvl = band(inRing * inSpan * (0.5 + 0.6 * soft) * (1.0 - smoothstep(0.08, 0.14, abs(r - 0.78))), 2.0);
    if (lvl <= 0.0) discard;
    a = 0.35 + 0.35 * lvl;
  }
  gl_FragColor = vec4(themeTone(c, uLight), a * uFade);
  #include <colorspace_fragment>
}
`;

export function LensedSmudges({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: SmudgeParams }) {
  const count = Number(params.count);
  const arcs = Number(params.arcs);
  const spec = useMemo(() => generateSmudges(seed, size, count, arcs, cute), [seed, size, count, arcs, cute]);
  const uniforms = useMemo(() => ({ uCore: color("#fff0c2") }), []);
  const material = useQuadMaterial({ fragmentShader: SMUDGE_FRAG, vertexShader: SMUDGE_VERT, uniforms, theme, fade: intensity, cute });
  const mesh = useMemo(() => {
    const geometry = unitPlaneGeometry().clone();
    geometry.setAttribute("iColorKind", new THREE.InstancedBufferAttribute(spec.colorKind, 4));
    geometry.setAttribute("iShape", new THREE.InstancedBufferAttribute(spec.shape, 4));
    const im = new THREE.InstancedMesh(geometry, material, spec.count);
    im.instanceMatrix.array.set(spec.matrices);
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    im.renderOrder = 1;
    return im;
  }, [spec, material]);
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

export const SMUDGES_EXHIBIT: Exhibit<SmudgeParams> = {
  id: "smudges",
  title: "Lensed galaxy smudges",
  ref: "Background ovals in 06-cartwheel / 01-m101, Abell lensing arcs; Spore far field",
  budget: "1 instanced quad draw (<= 12 instances)",
  meaning: "Other people's courses, far away; arcs bend around a heavy course near you",
  su: 20,
  knobs: [
    { key: "count", label: "count", min: 3, max: 12, step: 1 },
    { key: "arcs", label: "arc share", min: 0, max: 1, step: 0.1 },
  ],
  defaults: { count: 8, arcs: 0.4 },
  Component: LensedSmudges,
};
