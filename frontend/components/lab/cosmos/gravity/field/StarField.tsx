"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GRAVITY_UNIFORMS, type GravityTheme } from "../lib/uniforms";
import { SKY_LAYER } from "../render/lens-pass";
import { buildStarPatch } from "./star-geometry";
import { STAR_FRAG, STAR_VERT } from "./star-shaders";

export interface StarFieldProps {
  seed: number;
  theme: GravityTheme;
  /** Total points across the three layers. */
  count?: number;
  /** Camera fov in degrees and aspect, to size the slab to the frustum. */
  fov: number;
  aspect: number;
  farZ?: number;
}

/**
 * The shared sky every gravity object lenses: one draw call, `count` grain
 * stars in a frustum-filling slab, additive on dark and ink on light. Lives on
 * the sky layer so the lens pass warps it and nothing else.
 */
export function StarField({ seed, theme, count = 3200, fov, aspect, farZ = 30 }: StarFieldProps) {
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * 1.35;
    return buildStarPatch({ seed, count, halfWidth: halfHeight * aspect, halfHeight }, farZ);
  }, [seed, count, fov, aspect, farZ]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uTime: GRAVITY_UNIFORMS.uTime, uRes: GRAVITY_UNIFORMS.uRes, uLight: GRAVITY_UNIFORMS.uLight, uFade: { value: 1 } },
      }),
    [],
  );

  useEffect(() => {
    material.blending = theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.needsUpdate = true;
  }, [material, theme]);

  useLayoutEffect(() => {
    points.current?.layers.set(SKY_LAYER);
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />;
}
