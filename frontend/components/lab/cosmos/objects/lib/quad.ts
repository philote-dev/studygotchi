"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { COSMOS_UNIFORMS, GLSL_COMMON } from "./uniforms";
import type { ObjectTheme } from "./types";

/**
 * Billboard quads: the soft part of every exhibit (nebula clouds, glows,
 * planet bodies) is one unit plane with a fragment shader. `vUv` is -1..1.
 * Glow is always banded (floor into 3 to 5 steps), never a smooth gradient,
 * so it survives the pixel pass as chunky rings instead of mush.
 */
export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const QUAD_PRELUDE = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uFade;
uniform float uCute;
varying vec2 vUv;
${GLSL_COMMON}
`;

/** Shared unit plane; never disposed (one for the whole gallery). */
let unitPlane: THREE.PlaneGeometry | null = null;
export function unitPlaneGeometry(): THREE.PlaneGeometry {
  if (!unitPlane) unitPlane = new THREE.PlaneGeometry(1, 1);
  return unitPlane;
}

export interface QuadMaterialOptions {
  fragmentShader: string;
  vertexShader?: string;
  uniforms: Record<string, THREE.IUniform>;
  theme: ObjectTheme;
  fade?: number;
  cute?: number;
  /** Additive on the dark sky (glows); false for opaque bodies. */
  additive?: boolean;
}

export function makeQuadMaterial(o: QuadMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: o.vertexShader ?? QUAD_VERT,
    fragmentShader: o.fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: o.theme === "dark" && o.additive !== false ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: COSMOS_UNIFORMS.uTime,
      uRes: COSMOS_UNIFORMS.uRes,
      uLight: COSMOS_UNIFORMS.uLight,
      uFade: { value: o.fade ?? 1 },
      uCute: { value: o.cute ?? 0.5 },
      ...o.uniforms,
    },
  });
}

/** Memoised quad material keyed on shader text, uniforms identity, theme and blend; fade / cute are written in place. */
export function useQuadMaterial(o: QuadMaterialOptions): THREE.ShaderMaterial {
  const material = useMemo(
    () => makeQuadMaterial(o),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o.fragmentShader, o.vertexShader, o.uniforms, o.theme, o.additive],
  );
  useEffect(() => {
    material.uniforms.uFade.value = o.fade ?? 1;
    material.uniforms.uCute.value = o.cute ?? 0.5;
  }, [material, o.fade, o.cute]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

export function color(hex: string): THREE.IUniform<THREE.Color> {
  return { value: new THREE.Color(hex) };
}

export function num(v: number): THREE.IUniform<number> {
  return { value: v };
}

export function vec2(x: number, y: number): THREE.IUniform<THREE.Vector2> {
  return { value: new THREE.Vector2(x, y) };
}

export function vec3(x: number, y: number, z: number): THREE.IUniform<THREE.Vector3> {
  return { value: new THREE.Vector3(x, y, z) };
}
