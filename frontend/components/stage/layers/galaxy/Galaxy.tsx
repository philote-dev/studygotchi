"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_DITHER_MODE, DITHER_MODE, glowUniforms, setGlowRamp, type DitherMode } from "@/lib/light";
import { ALL_FEATURES, buildGalaxyBuffers, type GalaxyFeatures, type PointBuffers } from "@/lib/galaxy/points";
import { armAngle, armRidgeAngle, barTwistAmount, omegaAt, patternAngle, patternSpeed, type GalaxySpec, type Spur } from "@/lib/galaxy/spec";
import { inkify, SKY, stellarColors } from "@/lib/galaxy/palettes";
import { applySkyBlend, STAGE_UNIFORMS, type StageTheme } from "../../lib/uniforms";
import { ARM_FIELD_FRAG, BULGE_FRAG, BULGE_VERT, DUST_FIELD_FRAG, FAR_FRAG, FAR_VERT, FIELD_VERT, GALAXY_VERT, GLOW_FRAG, GLOW_VERT, POINT_FRAG } from "./galaxy-shaders";
import { GALAXY_RENDER_ORDER, HERO_CAMERA_DISTANCE } from "./galaxy-layer-model";

export { GALAXY_RENDER_ORDER, HERO_CAMERA_DISTANCE };

/** The accepted light model (Philote: Bayer); `ign` stays selectable, `bands` is the old lab look. */
export const DEFAULT_LIGHT_MODEL: DitherMode = DEFAULT_DITHER_MODE;

const FAR_PERIOD_S = 260;

function pointsGeometry(b: PointBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
  g.setAttribute("orbit", new THREE.BufferAttribute(b.orbit, 4));
  g.setAttribute("kind", new THREE.BufferAttribute(b.kind, 1));
  g.setAttribute("phase", new THREE.BufferAttribute(b.phase, 1));
  g.setAttribute("color", new THREE.BufferAttribute(b.color, 3));
  g.setAttribute("cls", new THREE.BufferAttribute(b.cls, 1));
  // Orbits move the points; a generous sphere keeps culling honest without per-frame bounds.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
  return g;
}

/** A quad lying in the disc plane (XZ), `half` disc radii each way. */
function discQuad(half: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array([-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), half * 1.5);
  return g;
}

function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

/** Spec constants shared by every arm-aware material. */
function armUniforms(spec: GalaxySpec) {
  return {
    uB: { value: spec.b },
    uArms: { value: spec.arms },
    uBarLen: { value: spec.barLength },
    uThetaBar: { value: spec.thetaBar },
    uEcc: { value: spec.eccentricity },
    uBarEcc: { value: spec.barEccentricity },
    uBarTwist: { value: barTwistAmount(spec) },
  };
}

function spurUniforms(spec: GalaxySpec, spurs: Spur[]) {
  const list = spurs.slice(0, 6);
  const vec = list.map((s) => new THREE.Vector4(s.a0, (Math.PI * 2 * s.arm) / spec.arms, s.slope, s.len));
  const str = list.map((s) => s.strength);
  while (vec.length < 6) {
    vec.push(new THREE.Vector4(1, 0, 0, 0));
    str.push(0);
  }
  return { uSpur: { value: vec }, uSpurS: { value: str }, uSpurN: { value: list.length } };
}

const featureUniforms = () => ({
  uFCore: { value: 0 },
  uFArms: { value: 0 },
  uFHii: { value: 0 },
  uFColour: { value: 0 },
  uFHalo: { value: 0 },
  uFDepth: { value: 0 },
  uFLife: { value: 0 },
  uDither: { value: DITHER_MODE[DEFAULT_LIGHT_MODEL] },
  uPaper: { value: new THREE.Color(SKY.light) },
});

function applyFeatures(m: THREE.ShaderMaterial, f: GalaxyFeatures, light: DitherMode) {
  const u = m.uniforms;
  if (u.uFCore) u.uFCore.value = f.core ? 1 : 0;
  if (u.uFArms) u.uFArms.value = f.arms ? 1 : 0;
  if (u.uFHii) u.uFHii.value = f.hii ? 1 : 0;
  if (u.uFColour) u.uFColour.value = f.colour ? 1 : 0;
  if (u.uFHalo) u.uFHalo.value = f.halo ? 1 : 0;
  if (u.uFDepth) u.uFDepth.value = f.depth ? 1 : 0;
  if (u.uFLife) u.uFLife.value = f.life ? 1 : 0;
  if (u.uDither) u.uDither.value = DITHER_MODE[light];
}

/** Arm start radius used by the field amplitude (matches the young population in lib/galaxy/points.ts). */
function armStart(spec: GalaxySpec): number {
  return spec.bar ? spec.barLength * 1.1 : 0.28;
}

/** Every galaxy material carries `uFade`; the layer writes it without rebuilding anything. */
function setFade(m: THREE.ShaderMaterial, fade: number) {
  if (m.uniforms.uFade) m.uniforms.uFade.value = fade;
}

function galaxyMaterial(spec: GalaxySpec, cells: number, candidates: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: GALAXY_VERT,
    fragmentShader: POINT_FRAG,
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTime: STAGE_UNIFORMS.uTime,
      uRes: STAGE_UNIFORMS.uRes,
      uLight: STAGE_UNIFORMS.uLight,
      uPattern: { value: patternSpeed(spec) },
      uV0: { value: spec.v0 },
      uACore: { value: spec.aCore },
      ...armUniforms(spec),
      uCells: { value: cells },
      uCellPx: STAGE_UNIFORMS.uCellPx,
      uFade: { value: 1 },
      uSpin: { value: spec.spinDir },
      uCoreSize: { value: spec.coreSize },
      uArmTint: { value: new THREE.Color(spec.palette.tip) },
      uBulgeTint: { value: new THREE.Color(mix(spec.palette.core, "#f0a35e", 0.5)) },
      ...featureUniforms(),
      uFlashPeriod: { value: spec.flashPeriodS },
      uFlashRate: { value: 1.5 / Math.max(1, candidates) },
      uClassDark: { value: stellarColors("dark", spec.palette).map((h) => new THREE.Color(h)) },
      uClassLight: { value: stellarColors("light", spec.palette).map((h) => new THREE.Color(h)) },
    },
  });
}

export interface GalaxyProps {
  spec: GalaxySpec;
  theme: StageTheme;
  /** Disc radius in world units. */
  radius?: number;
  /** Point size in pixel-pass cells (1 = one cell). */
  cells?: number;
  /** Overall alpha, a uniform write (no rebuild). 0.6 dark / 0.72 light are the product slot values; 1 for a hero. */
  fade?: number;
  /** Set false to skip the haze / core / companion glow quads. */
  glow?: boolean;
  /** Polish toggles; all on by default, all off is the old lab galaxy. */
  features?: GalaxyFeatures;
  /** `bayer8` (default, accepted), `bayer4`, `ign` = the shared light model; `bands` = the lab's hard bands. */
  lightModel?: DitherMode;
  /** Distance from the camera to the disc centre (disc radii): scales the far layer's parallax. */
  cameraDistance?: number;
  /** prefers-reduced-motion: the pattern, the orbits and the far drift rest; the two-step twinkle stays. */
  reducedMotion?: boolean;
  /** Mounted in the group that rides the pattern (course beads live here). */
  children?: React.ReactNode;
}

/**
 * The seeded point-cloud galaxy. Outer group: roll in the view plane; inner
 * group: inclination (pi/2 is face-on); the disc itself lies in XZ.
 *
 * Draws, in order: far layer (0), arm field (1), near glows (1), bulge
 * billboard (2), old stars (3), dust field (4), dust grain (5), young stars (6),
 * all offset by GALAXY_RENDER_ORDER so they land after the sky layer.
 */
export function Galaxy({
  spec,
  theme,
  radius = 1,
  cells = 1,
  fade = 1,
  glow = true,
  features = ALL_FEATURES,
  lightModel = DEFAULT_LIGHT_MODEL,
  cameraDistance = HERO_CAMERA_DISTANCE,
  reducedMotion = false,
  children,
}: GalaxyProps) {
  const buffers = useMemo(() => buildGalaxyBuffers(spec), [spec]);
  const starGeo = useMemo(() => pointsGeometry(buffers.stars), [buffers]);
  const youngGeo = useMemo(() => pointsGeometry(buffers.young), [buffers]);
  const dustGeo = useMemo(() => pointsGeometry(buffers.dust), [buffers]);
  const candidates = buffers.stars.count + buffers.young.count;
  const starMat = useMemo(() => galaxyMaterial(spec, cells, candidates), [spec, cells, candidates]);
  const youngMat = useMemo(() => galaxyMaterial(spec, cells, candidates), [spec, cells, candidates]);
  const dustMat = useMemo(() => {
    const m = galaxyMaterial(spec, cells, candidates);
    m.blending = THREE.NormalBlending;
    return m;
  }, [spec, cells, candidates]);
  const pattern = useRef<THREE.Group>(null);
  const far = useRef<THREE.Group>(null);

  useEffect(() => {
    applySkyBlend(starMat, theme);
    applySkyBlend(youngMat, theme);
  }, [starMat, youngMat, theme]);

  useEffect(() => {
    for (const m of [starMat, youngMat, dustMat]) applyFeatures(m, features, lightModel);
  }, [starMat, youngMat, dustMat, features, lightModel]);

  useEffect(() => {
    setFade(starMat, fade);
    setFade(youngMat, fade);
    setFade(dustMat, 0.72 * fade);
  }, [starMat, youngMat, dustMat, fade]);

  useEffect(() => {
    for (const m of [starMat, youngMat, dustMat]) {
      m.uniforms.uPattern.value = reducedMotion ? 0 : patternSpeed(spec);
      m.uniforms.uV0.value = reducedMotion ? 0 : spec.v0;
    }
  }, [starMat, youngMat, dustMat, spec, reducedMotion]);

  useEffect(
    () => () => {
      starGeo.dispose();
      youngGeo.dispose();
      dustGeo.dispose();
      starMat.dispose();
      youngMat.dispose();
      dustMat.dispose();
    },
    [starGeo, youngGeo, dustGeo, starMat, youngMat, dustMat],
  );

  useFrame(() => {
    const t = reducedMotion ? 0 : STAGE_UNIFORMS.uTime.value;
    // Glow quads and course beads ride the pattern frame (psi advances by +pattern angle => rotate -angle about Y).
    if (pattern.current) pattern.current.rotation.y = -patternAngle(spec, t);
    // The far layer counter-rotates very slowly in the view plane.
    if (far.current) far.current.rotation.z = (-spec.spinDir * Math.PI * 2 * t) / FAR_PERIOD_S;
  });

  // Reduced motion: no flashes, no comet, no breathing halos (all `life`); the still picture stays.
  const effective = reducedMotion && features.life ? { ...features, life: false } : features;
  const showField = effective.arms || effective.core || effective.depth;
  const showFar = effective.halo || effective.life;
  const R = GALAXY_RENDER_ORDER;

  return (
    <group rotation-z={spec.roll} scale={radius}>
      {showFar ? (
        <group ref={far}>
          <FarLayer spec={spec} theme={theme} fade={fade} features={effective} lightModel={lightModel} cameraDistance={cameraDistance} />
        </group>
      ) : null}
      {effective.core ? <Bulge spec={spec} theme={theme} fade={fade} lightModel={lightModel} /> : null}
      <group rotation-x={Math.PI / 2 - spec.inclination}>
        <points geometry={starGeo} material={starMat} frustumCulled={false} renderOrder={R + 3} />
        <points geometry={dustGeo} material={dustMat} frustumCulled={false} renderOrder={R + 5} />
        <points geometry={youngGeo} material={youngMat} frustumCulled={false} renderOrder={R + 6} />
        <group ref={pattern}>
          {showField ? <ArmField spec={spec} theme={theme} fade={fade} features={effective} lightModel={lightModel} /> : null}
          {effective.dust ? <DustField spec={spec} theme={theme} fade={fade} features={effective} lightModel={lightModel} /> : null}
          {glow ? <GlowSprites spec={spec} theme={theme} fade={fade} features={effective} lightModel={lightModel} reducedMotion={reducedMotion} /> : null}
          {children}
        </group>
      </group>
    </group>
  );
}

interface PartProps {
  spec: GalaxySpec;
  theme: StageTheme;
  fade: number;
  features: GalaxyFeatures;
  lightModel: DitherMode;
}

/** The luminous disc surface under the points: arms, young ridge, spurs, bar, zodiacal glow. One quad. */
function ArmField({ spec, theme, fade, features, lightModel }: PartProps) {
  const geometry = useMemo(() => discQuad(1.25), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FIELD_VERT,
        fragmentShader: ARM_FIELD_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uLight: STAGE_UNIFORMS.uLight,
          uFade: { value: 1 },
          uSpin: { value: spec.spinDir },
          uCoreSize: { value: spec.coreSize },
          uAsym: { value: spec.armAsymmetry },
          uSeed: { value: (spec.seed % 1000) * 0.37 },
          uSigmaIn: { value: spec.armSigmaIn },
          uSigmaOut: { value: spec.armSigmaOut },
          uArmStart: { value: armStart(spec) },
          ...armUniforms(spec),
          ...spurUniforms(spec, spec.spurs),
          ...featureUniforms(),
          uOld: { value: new THREE.Color() },
          uEnv: { value: new THREE.Color() },
          uYoung: { value: new THREE.Color() },
          uBar: { value: new THREE.Color() },
          uAmbient: { value: new THREE.Color() },
        },
      }),
    [spec],
  );
  useEffect(() => {
    const P = spec.palette;
    const dark = theme === "dark";
    const old = mix(P.core, P.arm, 0.4);
    const env = mix(P.haze, P.arm, 0.45);
    const bar = mix(P.core, "#f0a070", 0.5);
    (material.uniforms.uOld.value as THREE.Color).set(dark ? old : inkify(old, 0.34));
    (material.uniforms.uEnv.value as THREE.Color).set(dark ? env : inkify(env, 0.42));
    (material.uniforms.uYoung.value as THREE.Color).set(dark ? P.tip : inkify(P.tip, 0.3));
    (material.uniforms.uBar.value as THREE.Color).set(dark ? bar : inkify(bar, 0.4));
    (material.uniforms.uAmbient.value as THREE.Color).set(dark ? P.core : inkify(P.core, 0.46));
    applySkyBlend(material, theme);
  }, [material, spec, theme]);
  useEffect(() => applyFeatures(material, features, lightModel), [material, features, lightModel]);
  useEffect(() => setFade(material, fade), [material, fade]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={GALAXY_RENDER_ORDER + 1} />;
}

/** Dark lanes and feathers as one normal-blended quad: a shadow over the old light. */
function DustField({ spec, theme, fade, features, lightModel }: PartProps) {
  const geometry = useMemo(() => discQuad(1.15), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FIELD_VERT,
        fragmentShader: DUST_FIELD_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        uniforms: {
          uLight: STAGE_UNIFORMS.uLight,
          uFade: { value: 1 },
          uSpin: { value: spec.spinDir },
          uCoreSize: { value: spec.coreSize },
          uDustFade: { value: 0.8 },
          uSeed: { value: (spec.seed % 1000) * 0.37 },
          uSigmaIn: { value: spec.armSigmaIn },
          uSigmaOut: { value: spec.armSigmaOut },
          uArmStart: { value: armStart(spec) },
          ...armUniforms(spec),
          ...spurUniforms(spec, spec.dustSpurs),
          ...featureUniforms(),
          uDust: { value: new THREE.Color() },
        },
      }),
    [spec],
  );
  useEffect(() => {
    const dark = theme === "dark";
    (material.uniforms.uDust.value as THREE.Color).set(dark ? spec.palette.dust : mix(inkify(spec.palette.dust, 0.3), SKY.light, 0.5));
    material.uniforms.uDustFade.value = dark ? 0.95 : 0.4;
  }, [material, spec, theme]);
  useEffect(() => applyFeatures(material, features, lightModel), [material, features, lightModel]);
  useEffect(() => setFade(material, fade), [material, fade]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={GALAXY_RENDER_ORDER + 4} />;
}

/** Bulge palette anchors, dim -> bright, for the shared light model (8 steps). */
export function bulgeAnchors(spec: GalaxySpec, theme: StageTheme): string[] {
  const P = spec.palette;
  return theme === "dark"
    ? [mix(P.core, SKY.dark, 0.78), mix(P.core, "#f0a060", 0.55), mix(P.core, "#ffd36a", 0.45), mix(P.core, "#fff6df", 0.5), "#fffaf0"]
    : ["#bfae8a", "#b0925a", "#8c6a34", "#5a4020", "#2a1a0c"];
}

/**
 * Bulge billboard in the view plane. Lab bands: cream -> gold -> faint orange
 * in three rings. Light model: a Sérsic profile through eight dithered palette
 * steps (see lib/light), so no ring is visible at hero or corner size.
 */
function Bulge({ spec, theme, fade, lightModel }: { spec: GalaxySpec; theme: StageTheme; fade: number; lightModel: DitherMode }) {
  // The Sérsic skirt needs room: 1.5 core sigma (the lab rings used 1.2).
  const half = spec.coreSize * 1.25;
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: BULGE_VERT,
        fragmentShader: BULGE_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uNucleusColor: { value: new THREE.Color() },
          uCream: { value: new THREE.Color() },
          uGold: { value: new THREE.Color() },
          uOrange: { value: new THREE.Color() },
          uFade: { value: 1 },
          uNucleus: { value: spec.nucleus * 0.8 },
          uRe: { value: spec.bulgeRe },
          uN: { value: spec.bulgeSersic },
          uGamma: { value: 1.3 },
          ...glowUniforms({ anchors: bulgeAnchors(spec, "dark"), steps: 8, alphaMax: 0.95, mode: DEFAULT_LIGHT_MODEL }),
        },
      }),
    [spec],
  );
  useEffect(() => {
    const P = spec.palette;
    const dark = theme === "dark";
    (material.uniforms.uNucleusColor.value as THREE.Color).set(dark ? "#fff6df" : "#4a3010");
    (material.uniforms.uCream.value as THREE.Color).set(dark ? mix(P.core, "#fff6df", 0.55) : "#b8924a");
    (material.uniforms.uGold.value as THREE.Color).set(dark ? mix(P.core, "#ffd36a", 0.55) : "#c9a35a");
    (material.uniforms.uOrange.value as THREE.Color).set(dark ? mix(P.core, "#f0a060", 0.6) : "#c3a878");
    setGlowRamp(material.uniforms as { uPal: { value: THREE.Color[] }; uSteps: { value: number } }, bulgeAnchors(spec, theme), 8);
    applySkyBlend(material, theme);
  }, [material, spec, theme]);
  useEffect(() => {
    material.uniforms.uDither.value = DITHER_MODE[lightModel];
  }, [material, lightModel]);
  useEffect(() => setFade(material, fade), [material, fade]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} frustumCulled={false} renderOrder={GALAXY_RENDER_ORDER + 2}>
      <planeGeometry args={[half * 2, half * 2]} />
    </mesh>
  );
}

/**
 * Core, companion, haze and giant HII complexes as one instanced draw of
 * flat quads in the disc plane. Instance matrices carry scale; the orbit
 * attribute carries the centre (globular glows orbit at their own speed,
 * everything else rides the pattern frame).
 */
function GlowSprites({ spec, theme, fade, features, lightModel, reducedMotion }: PartProps & { reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = 1 + (spec.companion ? 1 : 0) + spec.hazeCount + spec.hiiComplexes.length + spec.globulars.length;
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(2, 2);
    const colors = new Float32Array(count * 3);
    const params = new Float32Array(count * 4);
    const orbit = new Float32Array(count * 4);
    const c = new THREE.Color();
    const pat = patternSpeed(spec);
    let i = 0;
    const set = (hex: string, alpha: number, mottle: number, seed: number, kind: number, a: number, psi: number, omega: number, y: number) => {
      c.set(hex);
      colors.set([c.r, c.g, c.b], i * 3);
      params.set([alpha, mottle, seed, kind], i * 4);
      orbit.set([a, psi, omega, y], i * 4);
      i++;
    };
    set(spec.palette.core, 0.55, 0, 0, 0, 0, 0, pat, 0);
    if (spec.companion) {
      const psi = armAngle(spec, Math.min(spec.companionRadius, 1), spec.companionArm);
      set(spec.palette.companion, 0.5, 0, 1, 2, spec.companionRadius, psi, pat, 0);
    }
    for (let h = 0; h < spec.hazeCount; h++) {
      const a = 0.42 + 0.3 * h + (spec.seed % 7) * 0.012;
      const psi = armAngle(spec, a, (h + 1) % spec.arms) + spec.spinDir * 0.08;
      set(spec.palette.haze, 0.17, 1, 2 + h + spec.seed * 0.001, 1, a, psi, pat, 0);
    }
    spec.hiiComplexes.forEach((hc, n) => {
      const psi = armRidgeAngle(spec, hc.a, hc.arm) + spec.spinDir * 0.12;
      set(n % 2 === 0 ? spec.palette.bead : spec.palette.beadAlt, 0.6, 0, 5 + n + spec.seed * 0.002, 3, hc.a, psi, pat, 0);
    });
    // Globular glows orbit with their clumps (0.35 x the flat curve), out of the plane.
    spec.globulars.forEach((gc, n) => {
      set(spec.palette.core, 0.3, 0, 9 + n, 4, gc.a, gc.psi, omegaAt(spec, gc.a) * 0.35, gc.y);
    });
    g.setAttribute("iColor", new THREE.InstancedBufferAttribute(colors, 3));
    g.setAttribute("iParams", new THREE.InstancedBufferAttribute(params, 4));
    g.setAttribute("iOrbit", new THREE.InstancedBufferAttribute(orbit, 4));
    return g;
  }, [spec, count]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uLight: STAGE_UNIFORMS.uLight,
          uTime: STAGE_UNIFORMS.uTime,
          uPattern: { value: patternSpeed(spec) },
          uMotion: { value: 1 },
          uFade: { value: 1 },
          ...featureUniforms(),
        },
      }),
    [spec],
  );

  useEffect(() => applySkyBlend(material, theme), [material, theme]);
  useEffect(() => applyFeatures(material, features, lightModel), [material, features, lightModel]);
  useEffect(() => setFade(material, fade), [material, fade]);
  useEffect(() => {
    material.uniforms.uMotion.value = reducedMotion ? 0 : 1;
  }, [material, reducedMotion]);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const zero = new THREE.Vector3();
    const size = (index: number, s: number) => {
      mat.compose(zero, flat, new THREE.Vector3(s, s, 1));
      m.setMatrixAt(index, mat);
    };
    let i = 0;
    size(i++, Math.max(0.12, spec.coreSize * 1.35));
    if (spec.companion) size(i++, 0.085);
    for (let h = 0; h < spec.hazeCount; h++) size(i++, 0.2 + 0.06 * h);
    for (const hc of spec.hiiComplexes) size(i++, hc.size);
    for (const gc of spec.globulars) size(i++, gc.size * 1.3);
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

  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} renderOrder={GALAXY_RENDER_ORDER + 1} />;
}

/** Background galaxy smudges and the comet, well behind the disc so a camera drift parallaxes them. */
function FarLayer({ spec, theme, fade, features, lightModel, cameraDistance }: PartProps & { cameraDistance: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = spec.backgroundGalaxies.length + 1;
  const depth = useMemo(() => spec.backgroundGalaxies.reduce((s, g) => s + g.depth, 0) / Math.max(1, spec.backgroundGalaxies.length), [spec]);
  const scaleAtDepth = 1 + depth / cameraDistance;
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(2, 2);
    const colors = new Float32Array(count * 3);
    const params = new Float32Array(count * 4);
    const path = new Float32Array(count * 4);
    const c = new THREE.Color();
    spec.backgroundGalaxies.forEach((bg, i) => {
      c.set(bg.warm ? "#c9b48e" : "#93a6c8");
      colors.set([c.r, c.g, c.b], i * 3);
      params.set([0.42, 0, i, bg.ratio], i * 4);
    });
    const ci = count - 1;
    c.set("#dff4ff");
    colors.set([c.r, c.g, c.b], ci * 3);
    params.set([0.9, 1, 0, 0], ci * 4);
    const [x0, y0, x1, y1] = spec.cometPath;
    path.set([x0 * scaleAtDepth, y0 * scaleAtDepth, x1 * scaleAtDepth, y1 * scaleAtDepth], ci * 4);
    g.setAttribute("iColor", new THREE.InstancedBufferAttribute(colors, 3));
    g.setAttribute("iParams", new THREE.InstancedBufferAttribute(params, 4));
    g.setAttribute("iPath", new THREE.InstancedBufferAttribute(path, 4));
    return g;
  }, [spec, count, scaleAtDepth]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FAR_VERT,
        fragmentShader: FAR_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uLight: STAGE_UNIFORMS.uLight,
          uTime: STAGE_UNIFORMS.uTime,
          uFade: { value: 1 },
          uCometPeriod: { value: spec.cometPeriodS },
          uCometLen: { value: 0.42 * scaleAtDepth },
          uCometWidth: { value: 0.012 * scaleAtDepth },
          ...featureUniforms(),
        },
      }),
    [spec, scaleAtDepth],
  );
  useEffect(() => applySkyBlend(material, theme), [material, theme]);
  useEffect(() => applyFeatures(material, features, lightModel), [material, features, lightModel]);
  useEffect(() => setFade(material, fade), [material, fade]);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spec.backgroundGalaxies.forEach((bg, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), bg.tilt);
      mat.compose(new THREE.Vector3(bg.x * scaleAtDepth, bg.y * scaleAtDepth, 0), q, new THREE.Vector3(bg.size * scaleAtDepth, bg.size * bg.ratio * scaleAtDepth, 1));
      m.setMatrixAt(i, mat);
    });
    mat.identity();
    m.setMatrixAt(count - 1, mat);
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
  }, [spec, count, scaleAtDepth]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <instancedMesh ref={mesh} args={[geometry, material, count]} position={[0, 0, -depth]} frustumCulled={false} renderOrder={GALAXY_RENDER_ORDER} />;
}
