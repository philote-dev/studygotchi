"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GalaxyScenery as GalaxySceneryPlacement } from "@/lib/stage/galaxy-scenery";
import { applySkyBlend, STAGE_UNIFORMS, type StageTheme } from "../../lib/uniforms";
import { POINTS_FRAG, POINTS_VERT, QUAD_FRAG, QUAD_VERT } from "../sky/sky-shaders";
import { GALAXY_RENDER_ORDER } from "./galaxy-layer-model";
import { buildGalaxyScenery, sceneryGroupTransform, type GalaxySceneryBuild } from "./galaxy-scenery-build";

export interface GalaxySceneryProps {
  scenery: GalaxySceneryPlacement;
  theme: StageTheme;
  /** The rung's current fade (0..1), read per frame: the sky point shader has no fade uniform, so point alphas are rescaled on change. */
  fadeRef: RefObject<number>;
  reducedMotion?: boolean;
  onBuild?: (stats: GalaxySceneryBuild["stats"]) => void;
}

/**
 * Galaxy-rung scenery (S3-5): the placed objects drawn with the sky layer's
 * quad and point shaders, two draws, seated in the galaxy's pattern frame
 * (mount it as a child of `GalaxyLayer`, which puts children in the group
 * that rides the arms). Draw order: after the arm field, before the stars,
 * so the disc's grain sprinkles over a nebula instead of under it.
 */
export function GalaxyScenery({ scenery, theme, fadeRef, reducedMotion = false, onBuild }: GalaxySceneryProps) {
  const built = useMemo(() => buildGalaxyScenery(scenery, theme), [scenery, theme]);
  useEffect(() => onBuild?.(built.stats), [built, onBuild]);

  const pointsGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = built.points;
    g.setAttribute("position", new THREE.BufferAttribute(p.position, 3));
    g.setAttribute("color", new THREE.BufferAttribute(p.color, 3));
    g.setAttribute("size", new THREE.BufferAttribute(p.size, 1));
    // A copy: the fade rescales it in place while the build keeps the base values.
    g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(p.alpha), 1));
    g.setAttribute("phase", new THREE.BufferAttribute(p.phase, 1));
    g.setAttribute("shape", new THREE.BufferAttribute(p.shape, 1));
    g.setAttribute("drift", new THREE.BufferAttribute(p.drift, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [built]);
  const pointsMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: POINTS_VERT,
        fragmentShader: POINTS_FRAG,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uTime: STAGE_UNIFORMS.uTime, uRes: STAGE_UNIFORMS.uRes, uCellPx: STAGE_UNIFORMS.uCellPx, uLight: STAGE_UNIFORMS.uLight, uDrift: { value: 0 } },
      }),
    [],
  );

  const quadMesh = useMemo(() => {
    const q = built.quads;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("iKind", new THREE.InstancedBufferAttribute(q.kind, 1));
    geometry.setAttribute("iParams", new THREE.InstancedBufferAttribute(q.params, 4));
    geometry.setAttribute("iParams2", new THREE.InstancedBufferAttribute(q.params2, 4));
    geometry.setAttribute("iC0", new THREE.InstancedBufferAttribute(q.c0, 3));
    geometry.setAttribute("iC1", new THREE.InstancedBufferAttribute(q.c1, 3));
    geometry.setAttribute("iC2", new THREE.InstancedBufferAttribute(q.c2, 3));
    geometry.setAttribute("iC3", new THREE.InstancedBufferAttribute(q.c3, 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: QUAD_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: STAGE_UNIFORMS.uTime, uRes: STAGE_UNIFORMS.uRes, uLight: STAGE_UNIFORMS.uLight, uFade: { value: 1 }, uMotion: { value: 1 } },
    });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, q.count));
    mesh.instanceMatrix.array.set(q.matrices);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = q.count;
    mesh.frustumCulled = false;
    mesh.renderOrder = GALAXY_RENDER_ORDER + 1.5;
    return mesh;
  }, [built]);

  useEffect(() => {
    applySkyBlend(pointsMaterial, theme);
    applySkyBlend(quadMesh.material as THREE.Material, theme);
  }, [pointsMaterial, quadMesh, theme]);
  useEffect(() => {
    (quadMesh.material as THREE.ShaderMaterial).uniforms.uMotion.value = reducedMotion ? 0 : 1;
  }, [quadMesh, reducedMotion]);

  // Point alphas follow the rung's fade (the points shader has no uFade): rewritten only when it changes.
  const lastFade = useRef(-1);
  useEffect(() => {
    lastFade.current = -1;
  }, [pointsGeometry]);
  useFrame(() => {
    const fade = Math.max(0, Math.min(1, fadeRef.current ?? 1));
    if (fade === lastFade.current) return;
    lastFade.current = fade;
    const attr = pointsGeometry.getAttribute("alpha") as THREE.BufferAttribute;
    const base = built.points.alpha;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < base.length; i++) arr[i] = base[i] * fade;
    attr.needsUpdate = true;
  });

  useEffect(() => () => pointsGeometry.dispose(), [pointsGeometry]);
  useEffect(() => () => pointsMaterial.dispose(), [pointsMaterial]);
  useEffect(
    () => () => {
      quadMesh.geometry.dispose();
      (quadMesh.material as THREE.Material).dispose();
    },
    [quadMesh],
  );

  const t = sceneryGroupTransform();
  return (
    <group name="galaxy-scenery" rotation-x={t.rotationX} position={t.position}>
      <primitive object={quadMesh} />
      <points geometry={pointsGeometry} material={pointsMaterial} frustumCulled={false} renderOrder={GALAXY_RENDER_ORDER + 1.6} />
    </group>
  );
}
