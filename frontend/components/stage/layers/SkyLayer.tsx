"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { bucketAspect, placeBackdrop } from "@/lib/stage/placement";
import { STAGE_UNIFORMS, applySkyBlend, type StageTheme } from "../lib/uniforms";
import { STAGE_CAMERA } from "../lib/view";
import { useStageLayer } from "../StageContext";
import { buildSky, galaxyPatternSpeed, STAR_DRIFT_NDC_PER_S, type SkyBuild } from "./sky/sky-build";
import type { SkyTokens } from "./sky/sky-palette";
import { GALAXY_FRAG, GALAXY_VERT, POINTS_FRAG, POINTS_VERT, QUAD_FRAG, QUAD_VERT } from "./sky/sky-shaders";

export interface SkyLayerProps {
  seed: number;
  theme: StageTheme;
  tokens: SkyTokens;
  /** prefers-reduced-motion: keep the two-step twinkle (an opacity change), drop every movement. */
  reducedMotion?: boolean;
  onBuild?: (stats: SkyBuild["stats"]) => void;
}

/** Shared unit plane for every quad instance; never disposed. */
let unitPlane: THREE.PlaneGeometry | null = null;
function unitPlaneGeometry(): THREE.PlaneGeometry {
  if (!unitPlane) unitPlane = new THREE.PlaneGeometry(1, 1);
  return unitPlane;
}

/**
 * S1, the first layer of the persistent stage: three parallax depths of grain
 * stars, a far galaxy hint that really spins, and 3 to 5 seeded far objects,
 * in three draws. Rebuilt only when the seed, theme or viewport changes.
 */
export function SkyLayer({ seed, theme, tokens, reducedMotion = false, onBuild }: SkyLayerProps) {
  const root = useStageLayer<THREE.Group>("sky");
  const size = useThree((s) => s.size);
  const aspectBucket = bucketAspect(size.width, size.height);
  const placement = useMemo(() => placeBackdrop(seed, { aspect: aspectBucket }), [seed, aspectBucket]);
  const built = useMemo(
    () => buildSky({ seed, theme, width: size.width, height: size.height, fovDeg: STAGE_CAMERA.fov, tokens, placement }),
    [seed, theme, size.width, size.height, tokens, placement],
  );
  useEffect(() => onBuild?.(built.stats), [built, onBuild]);

  // ---- grain points (stars + object sparkles) ----
  const pointsGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = built.points;
    g.setAttribute("position", new THREE.BufferAttribute(p.position, 3));
    g.setAttribute("color", new THREE.BufferAttribute(p.color, 3));
    g.setAttribute("size", new THREE.BufferAttribute(p.size, 1));
    g.setAttribute("alpha", new THREE.BufferAttribute(p.alpha, 1));
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
        uniforms: { uTime: STAGE_UNIFORMS.uTime, uRes: STAGE_UNIFORMS.uRes, uCellPx: STAGE_UNIFORMS.uCellPx, uLight: STAGE_UNIFORMS.uLight, uDrift: { value: STAR_DRIFT_NDC_PER_S } },
      }),
    [],
  );

  // ---- far galaxy ----
  const galaxyGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const b = built.galaxy.buffers;
    g.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
    g.setAttribute("orbit", new THREE.BufferAttribute(b.orbit, 4));
    g.setAttribute("kind", new THREE.BufferAttribute(b.kind, 1));
    g.setAttribute("color", new THREE.BufferAttribute(b.color, 3));
    g.setAttribute("phase", new THREE.BufferAttribute(b.phase, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [built]);
  const galaxyMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GALAXY_VERT,
        fragmentShader: GALAXY_FRAG,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uTime: STAGE_UNIFORMS.uTime,
          uRes: STAGE_UNIFORMS.uRes,
          uLight: STAGE_UNIFORMS.uLight,
          uPattern: { value: 0 },
          uV0: { value: 0 },
          uACore: { value: 0.1 },
          uB: { value: 0 },
          uArms: { value: 2 },
          uThetaBar: { value: 0 },
          uEcc: { value: 0 },
          uFade: { value: 0.8 },
          uArmTint: { value: new THREE.Color("#ffffff") },
        },
      }),
    [],
  );
  useEffect(() => {
    const spec = built.galaxy.spec;
    const u = galaxyMaterial.uniforms;
    // Reduced motion freezes the pattern and the orbits (the spiral still shows, it just rests).
    u.uPattern.value = reducedMotion ? 0 : galaxyPatternSpeed(spec);
    u.uV0.value = reducedMotion ? 0 : spec.v0;
    u.uACore.value = spec.aCore;
    u.uB.value = spec.b;
    u.uArms.value = spec.arms;
    u.uThetaBar.value = spec.thetaBar;
    u.uEcc.value = spec.eccentricity;
    u.uFade.value = theme === "dark" ? 0.8 : 0.7;
    (u.uArmTint.value as THREE.Color).set(spec.palette.tip);
    pointsMaterial.uniforms.uDrift.value = reducedMotion ? 0 : STAR_DRIFT_NDC_PER_S;
  }, [built, galaxyMaterial, pointsMaterial, theme, reducedMotion]);

  // ---- soft quads ----
  const quadMesh = useMemo(() => {
    const q = built.quads;
    const geometry = unitPlaneGeometry().clone();
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
      uniforms: { uTime: STAGE_UNIFORMS.uTime, uRes: STAGE_UNIFORMS.uRes, uLight: STAGE_UNIFORMS.uLight, uFade: { value: 1 }, uMotion: { value: 1 } },
    });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, q.count));
    mesh.instanceMatrix.array.set(q.matrices);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = q.count;
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    return mesh;
  }, [built]);

  // Theme blend: light adds on the dark sky, ink lies over paper on the light one.
  useEffect(() => {
    applySkyBlend(pointsMaterial, theme);
    applySkyBlend(galaxyMaterial, theme);
    applySkyBlend(quadMesh.material as THREE.Material, theme);
  }, [pointsMaterial, galaxyMaterial, quadMesh, theme]);
  useEffect(() => {
    (quadMesh.material as THREE.ShaderMaterial).uniforms.uMotion.value = reducedMotion ? 0 : 1;
  }, [quadMesh, reducedMotion]);

  useEffect(() => () => pointsGeometry.dispose(), [pointsGeometry]);
  useEffect(() => () => galaxyGeometry.dispose(), [galaxyGeometry]);
  useEffect(
    () => () => {
      quadMesh.geometry.dispose();
      (quadMesh.material as THREE.Material).dispose();
    },
    [quadMesh],
  );
  useEffect(
    () => () => {
      pointsMaterial.dispose();
      galaxyMaterial.dispose();
    },
    [pointsMaterial, galaxyMaterial],
  );

  const t = built.galaxy.transform;
  return (
    <group ref={root} name="stage-sky">
      {/* Soft glows first, then the galaxy, then the grain on top. */}
      <primitive object={quadMesh} />
      <group position={t.position} rotation-z={t.roll}>
        <group rotation-x={-Math.PI / 2 + t.tilt} scale={t.radius}>
          <points geometry={galaxyGeometry} material={galaxyMaterial} frustumCulled={false} renderOrder={0} />
        </group>
      </group>
      <points geometry={pointsGeometry} material={pointsMaterial} frustumCulled={false} renderOrder={1} />
    </group>
  );
}
