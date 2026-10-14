"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mulberry32 } from "../lib/rng";
import { LAB_UNIFORMS, type LabTheme } from "../lib/lab-uniforms";
import { SKY } from "./palettes";
import { BAND_FRAG, BAND_VERT, STAR_FRAG, STAR_VERT } from "./galaxy-shaders";

export interface StarShellProps {
  seed: number;
  theme: LabTheme;
  /** Radius of the far shell; mid and near shells sit at 0.6 and 0.35 of it. */
  radius: number;
  /** Total points across the three layers. */
  count?: number;
  fade?: number;
  band?: boolean;
}

export const STAR_LAYERS = [
  { share: 0.62, depth: 1.0, size: 1, bright: 0.45 },
  { share: 0.32, depth: 0.6, size: 1, bright: 1.0 },
  { share: 0.06, depth: 0.35, size: 3, bright: 1.0 },
] as const;

/**
 * Three parallax layers of grain stars in one draw: a dense far layer of soft
 * single cells, a mid layer of bright cells, and a sparse near layer of 3x3
 * plus stars that twinkle in two steps. Full sphere so camera moves parallax.
 */
export function StarShell({ seed, theme, radius, count = 1500, fade = 1, band = true }: StarShellProps) {
  const geometry = useMemo(() => {
    const rng = mulberry32(seed ^ 0x51a7);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const shape = new Float32Array(count);
    const star = new THREE.Color(SKY.starDark);
    const soft = new THREE.Color(SKY.starSoftDark);
    const warm = new THREE.Color("#ffe6a8");
    const blue = new THREE.Color("#b8dcff");
    const c = new THREE.Color();
    let i = 0;
    for (const layer of STAR_LAYERS) {
      const n = Math.round(count * layer.share);
      for (let k = 0; k < n && i < count; k++, i++) {
        // Uniform on the sphere.
        const z = rng() * 2 - 1;
        const t = rng() * Math.PI * 2;
        const rr = Math.sqrt(1 - z * z);
        const d = radius * layer.depth * (0.92 + 0.16 * rng());
        pos.set([rr * Math.cos(t) * d, z * d, rr * Math.sin(t) * d], i * 3);
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
  }, [seed, radius, count]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uTime: LAB_UNIFORMS.uTime, uRes: LAB_UNIFORMS.uRes, uLight: LAB_UNIFORMS.uLight, uFade: { value: fade } },
      }),
    [fade],
  );

  useEffect(() => {
    material.blending = theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.needsUpdate = true;
  }, [material, theme]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return (
    <>
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />
      {band ? <MilkyWayBand radius={radius} theme={theme} fade={0.12 * fade} seed={seed} /> : null}
    </>
  );
}

/** Low-contrast cream band behind everything, tilted, drifting at 0.1x. */
function MilkyWayBand({ radius, theme, fade, seed }: { radius: number; theme: LabTheme; fade: number; seed: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: BAND_VERT,
        fragmentShader: BAND_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uTime: LAB_UNIFORMS.uTime,
          uLight: LAB_UNIFORMS.uLight,
          uFade: { value: fade },
          uCream: { value: new THREE.Color(SKY.milkyWay) },
          uDust: { value: new THREE.Color(SKY.milkyWayDust) },
        },
      }),
    [fade],
  );
  useEffect(() => {
    material.blending = theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.needsUpdate = true;
  }, [material, theme]);
  useEffect(() => () => material.dispose(), [material]);
  const tilt = -0.35 + ((seed % 13) / 13) * 0.5;
  return (
    <mesh position={[0, 0, -radius * 0.98]} rotation-z={tilt} material={material} frustumCulled={false} renderOrder={-1}>
      <planeGeometry args={[radius * 3.2, radius * 0.9]} />
    </mesh>
  );
}
