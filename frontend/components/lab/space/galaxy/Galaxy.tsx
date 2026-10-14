"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LAB_UNIFORMS, type LabTheme } from "../lib/lab-uniforms";
import { buildGalaxyBuffers, type PointBuffers } from "./galaxy-points";
import { armAngle, patternAngle, patternSpeed, type GalaxySpec } from "./galaxy-spec";
import { GALAXY_VERT, GLOW_FRAG, GLOW_VERT, POINT_FRAG } from "./galaxy-shaders";

function pointsGeometry(b: PointBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
  g.setAttribute("orbit", new THREE.BufferAttribute(b.orbit, 4));
  g.setAttribute("kind", new THREE.BufferAttribute(b.kind, 1));
  g.setAttribute("phase", new THREE.BufferAttribute(b.phase, 1));
  g.setAttribute("color", new THREE.BufferAttribute(b.color, 3));
  // Orbits move the points; a generous sphere keeps culling honest without per-frame bounds.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.4);
  return g;
}

function galaxyMaterial(spec: GalaxySpec, fade: number, cells: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: GALAXY_VERT,
    fragmentShader: POINT_FRAG,
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTime: LAB_UNIFORMS.uTime,
      uRes: LAB_UNIFORMS.uRes,
      uLight: LAB_UNIFORMS.uLight,
      uPattern: { value: patternSpeed(spec) },
      uV0: { value: spec.v0 },
      uACore: { value: spec.aCore },
      uB: { value: spec.b },
      uArms: { value: spec.arms },
      uBarLen: { value: spec.barLength },
      uThetaBar: { value: spec.thetaBar },
      uEcc: { value: spec.eccentricity },
      uBarEcc: { value: spec.barEccentricity },
      uCells: { value: cells },
      uFade: { value: fade },
      uArmTint: { value: new THREE.Color(spec.palette.tip) },
    },
  });
}

export interface GalaxyProps {
  spec: GalaxySpec;
  theme: LabTheme;
  /** Disc radius in world units. */
  radius?: number;
  /** Point size in pixel-pass cells (1 = one cell). */
  cells?: number;
  /** Overall alpha. 0.6 dark / 0.72 light are the product slot values; 1 for a hero. */
  fade?: number;
  /** Set false to skip the haze / core / companion glow quads. */
  glow?: boolean;
  /** Extra objects placed in the disc plane (XZ, unit radius) that co-rotate with the spiral pattern. */
  children?: React.ReactNode;
}

/**
 * The seeded point-cloud galaxy. Outer group: roll in the view plane; inner
 * group: inclination (pi/2 is face-on); the disc itself lies in XZ.
 */
export function Galaxy({ spec, theme, radius = 1, cells = 1, fade = 1, glow = true, children }: GalaxyProps) {
  const buffers = useMemo(() => buildGalaxyBuffers(spec), [spec]);
  const starGeo = useMemo(() => pointsGeometry(buffers.stars), [buffers]);
  const dustGeo = useMemo(() => pointsGeometry(buffers.dust), [buffers]);
  const starMat = useMemo(() => galaxyMaterial(spec, fade, cells), [spec, fade, cells]);
  const dustMat = useMemo(() => {
    const m = galaxyMaterial(spec, 0.72 * fade, cells);
    m.blending = THREE.NormalBlending;
    return m;
  }, [spec, fade, cells]);
  const pattern = useRef<THREE.Group>(null);

  useEffect(() => {
    starMat.blending = theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending;
    starMat.needsUpdate = true;
  }, [starMat, theme]);

  useEffect(
    () => () => {
      starGeo.dispose();
      dustGeo.dispose();
      starMat.dispose();
      dustMat.dispose();
    },
    [starGeo, dustGeo, starMat, dustMat],
  );

  useFrame(() => {
    // Glow quads ride the pattern frame (psi advances by +pattern angle => rotate -angle about Y).
    if (pattern.current) pattern.current.rotation.y = -patternAngle(spec, LAB_UNIFORMS.uTime.value);
  });

  return (
    <group rotation-z={spec.roll} scale={radius}>
      <group rotation-x={Math.PI / 2 - spec.inclination}>
        <points geometry={starGeo} material={starMat} frustumCulled={false} renderOrder={2} />
        <points geometry={dustGeo} material={dustMat} frustumCulled={false} renderOrder={3} />
        <group ref={pattern}>
          {glow ? <GlowSprites spec={spec} theme={theme} fade={fade} /> : null}
          {children}
        </group>
      </group>
    </group>
  );
}

/** Core, companion and 1 to 2 nebula haze patches as one instanced draw of flat quads in the disc plane. */
function GlowSprites({ spec, theme, fade }: { spec: GalaxySpec; theme: LabTheme; fade: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = 1 + (spec.companion ? 1 : 0) + spec.hazeCount;
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(2, 2);
    const colors = new Float32Array(count * 3);
    const params = new Float32Array(count * 4);
    const c = new THREE.Color();
    let i = 0;
    const set = (hex: string, alpha: number, mottle: number, seed: number) => {
      c.set(hex);
      colors.set([c.r, c.g, c.b], i * 3);
      params.set([alpha, mottle, seed, 0], i * 4);
      i++;
    };
    set(spec.palette.core, 0.55 * fade, 0, 0);
    if (spec.companion) set(spec.palette.companion, 0.5 * fade, 0, 1);
    for (let h = 0; h < spec.hazeCount; h++) set(spec.palette.haze, 0.17 * fade, 1, 2 + h + spec.seed * 0.001);
    g.setAttribute("iColor", new THREE.InstancedBufferAttribute(colors, 3));
    g.setAttribute("iParams", new THREE.InstancedBufferAttribute(params, 4));
    return g;
  }, [spec, count, fade]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uLight: LAB_UNIFORMS.uLight, uTime: LAB_UNIFORMS.uTime },
      }),
    [],
  );

  useEffect(() => {
    material.blending = theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.needsUpdate = true;
  }, [material, theme]);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const place = (index: number, x: number, z: number, size: number) => {
      mat.compose(new THREE.Vector3(x, 0, z), flat, new THREE.Vector3(size, size, 1));
      m.setMatrixAt(index, mat);
    };
    let i = 0;
    place(i++, 0, 0, Math.max(0.12, spec.coreSize * 1.35));
    if (spec.companion) {
      const psi = armAngle(spec, Math.min(spec.companionRadius, 1), spec.companionArm);
      place(i++, spec.companionRadius * Math.cos(psi), spec.companionRadius * Math.sin(psi), 0.085);
    }
    for (let h = 0; h < spec.hazeCount; h++) {
      const a = 0.42 + 0.3 * h + (spec.seed % 7) * 0.012;
      const psi = armAngle(spec, a, (h + 1) % spec.arms) + spec.spinDir * 0.08;
      place(i++, a * Math.cos(psi), a * Math.sin(psi), 0.2 + 0.06 * h);
    }
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
  }, [spec, count]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} renderOrder={1} />;
}
