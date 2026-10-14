"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SPRITE_VERT } from "../blackhole/blackhole-shaders";
import { gravityClock } from "../lib/clock";
import { backOut } from "../lib/easing";
import { Beat, Swell, setColor, useObjectLayer, vec3, type GravityObjectBase } from "../lib/exhibit";
import { HERO_POSE, projectCircle, worldRadiusForPx } from "../lib/frame";
import { mulberry32 } from "../lib/rng";
import { GRAVITY_UNIFORMS } from "../lib/uniforms";
import { WHITE_HOLE } from "../palettes";
import { CORE_FRAG, FOUNTAIN_FRAG, FOUNTAIN_VERT, WH_EXTENT } from "./whitehole-shaders";

export type WhiteHoleState = "alive" | "dormant";

export interface WhiteHoleProps extends GravityObjectBase {
  /** `dormant` is a dim core with no fountain or rays (before anything has entered). */
  state: WhiteHoleState;
  /** Breathing period, 3..5 s. */
  pulsePeriodS: number;
  /** Increment to play the birth beat: expand from nothing with a ring shock, 900 ms. */
  birthCount: number;
}

export const BIRTH = { totalS: 0.9, growS: 0.5, flashS: 0.12 } as const;
const FOUNTAIN_POINTS = 160;

/**
 * White hole. Budget: 2 draws (core quad, fountain points <= 160), one lens
 * slot with sign -1 (inverted lens) and a faint compressed-star ring at 1.15 R.
 */
export function WhiteHole(props: WhiteHoleProps) {
  const { size: sizePx, seed, theme, intensity, position, lensSlot, lensStrength, frame, onHover, state, pulsePeriodS, birthCount } = props;
  const { camera, size } = useThree();
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const fountain = useRef<THREE.Points>(null);
  const swell = useRef(new Swell());
  const birth = useRef(new Beat());
  const birthAtLab = useRef(-1e6);
  const lastBirth = useRef(birthCount);
  const worldPos = useMemo(() => vec3(position), [position]);
  const pal = WHITE_HOLE[theme];

  const coreMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SPRITE_VERT,
        fragmentShader: CORE_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uTime: GRAVITY_UNIFORMS.uTime,
          uCellsPerR: { value: 18 },
          uPulse: { value: 4 },
          uAlpha: { value: 1 },
          uIntensity: { value: 1 },
          uState: { value: 1 },
          uBirth: { value: -1 },
          uRingFlash: { value: 0 },
          uSeed: { value: 0 },
          uCore: { value: new THREE.Color() },
          uBand1: { value: new THREE.Color() },
          uBand2: { value: new THREE.Color() },
          uBand3: { value: new THREE.Color() },
          uRay: { value: new THREE.Color() },
          uShock: { value: new THREE.Color() },
        },
      }),
    [],
  );
  const fountainGeo = useMemo(() => {
    const rng = mulberry32(seed ^ 0x0f0f);
    const pos = new Float32Array(FOUNTAIN_POINTS * 3);
    const col = new Float32Array(FOUNTAIN_POINTS * 3);
    const phase = new Float32Array(FOUNTAIN_POINTS);
    const angle = new Float32Array(FOUNTAIN_POINTS);
    const speed = new Float32Array(FOUNTAIN_POINTS);
    const curl = new Float32Array(FOUNTAIN_POINTS);
    const psize = new Float32Array(FOUNTAIN_POINTS);
    const c = new THREE.Color();
    for (let i = 0; i < FOUNTAIN_POINTS; i++) {
      phase[i] = rng();
      angle[i] = rng() * Math.PI * 2;
      speed[i] = 0.7 + rng() * 0.6;
      curl[i] = (rng() - 0.5) * 1.6;
      psize[i] = i % 5 === 0 ? 3 : 1;
      c.set(rng() < 0.65 ? pal.particle : pal.particleAlt);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    g.setAttribute("aAngle", new THREE.BufferAttribute(angle, 1));
    g.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
    g.setAttribute("aCurl", new THREE.BufferAttribute(curl, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(psize, 1));
    return g;
  }, [seed, pal]);
  const fountainMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FOUNTAIN_VERT,
        fragmentShader: FOUNTAIN_FRAG,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uTime: GRAVITY_UNIFORMS.uTime, uRes: GRAVITY_UNIFORMS.uRes, uLight: GRAVITY_UNIFORMS.uLight, uPeriod: { value: 3.4 }, uBirthAt: { value: -1e6 } },
      }),
    [],
  );

  useObjectLayer(group);

  useEffect(() => {
    const u = coreMat.uniforms;
    setColor(u.uCore, pal.core);
    setColor(u.uBand1, pal.band1);
    setColor(u.uBand2, pal.band2);
    setColor(u.uBand3, pal.band3);
    setColor(u.uRay, pal.ray);
    setColor(u.uShock, pal.shock);
    fountainMat.blending = theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending;
    fountainMat.needsUpdate = true;
  }, [coreMat, fountainMat, pal, theme]);

  useEffect(
    () => () => {
      coreMat.dispose();
      fountainGeo.dispose();
      fountainMat.dispose();
    },
    [coreMat, fountainGeo, fountainMat],
  );

  useEffect(() => {
    if (birthCount === lastBirth.current) return;
    lastBirth.current = birthCount;
    birth.current.start();
    birthAtLab.current = gravityClock.frozenAt !== null ? 0 : gravityClock.seconds;
  }, [birthCount]);

  useFrame(() => {
    const f = frame.current;
    const g = group.current;
    const m = core.current;
    if (!f || !g || !m) return;
    const R = worldRadiusForPx(camera, sizePx, HERO_POSE.position[2], size.height);
    const sw = swell.current.update();

    // Birth: scale 0 -> 1 with a back-out over 500 ms, shock ring over 900 ms, a brief flash.
    const e = birth.current.elapsed();
    let grow = 1;
    let shock = -1;
    let flash = 0;
    if (e >= 0 && e < BIRTH.totalS) {
      grow = backOut(e / BIRTH.growS);
      shock = e / BIRTH.totalS;
      flash = e < BIRTH.flashS ? 1 - e / BIRTH.flashS : 0;
    }
    const alive = state === "alive" ? 1 : 0;
    const scale = Math.max(0.0001, sw * grow);
    g.position.copy(worldPos);
    m.scale.setScalar(R * scale * WH_EXTENT);
    m.visible = scale > 0.002;

    const lens = f.lenses[lensSlot];
    const aspect = size.width / size.height;
    const rUv = projectCircle(camera, worldPos, R * scale, aspect, lens.center);
    const px = rUv * size.height;
    const cellsPerR = Math.max(4, px / f.pixel);

    const u = coreMat.uniforms;
    u.uCellsPerR.value = cellsPerR;
    u.uSeed.value = (seed % 1000) * 0.37;
    u.uPulse.value = pulsePeriodS;
    u.uIntensity.value = intensity;
    u.uState.value = alive;
    u.uBirth.value = shock;
    u.uRingFlash.value = flash * 0.6;

    const fp = fountain.current;
    if (fp) {
      fp.scale.setScalar(R * scale);
      const n = alive ? Math.round(intensity * FOUNTAIN_POINTS * Math.min(1, px / 24)) : 0;
      fp.geometry.setDrawRange(0, n);
      fp.visible = n > 0 && m.visible;
      fountainMat.uniforms.uBirthAt.value = birthAtLab.current;
    }

    // Inverted lens: the sky samples outward, so stars bunch tangentially into a dense ring and streak
    // radially; the Einstein-ring band sits just outside the core edge.
    lens.thetaE = rUv * 1.15 * lensStrength * (swell.current.on ? 1.25 : 1) * (0.4 + 0.6 * alive);
    lens.inner = rUv * 0.95;
    lens.sign = -1;
    lens.ring = 0.45 * intensity * alive;
    lens.swirl = 0;
    lens.strength = m.visible ? grow : 0;
    lens.maxCells = Math.max(f.maxCells * 0.75, Math.round((px * 0.45) / f.pixel));
    if (flash > 0) {
      f.flash = Math.max(f.flash, flash * 0.08);
      f.flashColor.set(pal.flash);
    }
  });

  const hover = (on: boolean) => {
    if (swell.current.on === on) return;
    swell.current.set(on, 1.05);
    onHover?.(on);
  };

  return (
    <group ref={group}>
      <points ref={fountain} geometry={fountainGeo} material={fountainMat} frustumCulled={false} renderOrder={5} />
      <mesh ref={core} material={coreMat} renderOrder={6} frustumCulled={false} onPointerOver={() => hover(true)} onPointerOut={() => hover(false)}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </group>
  );
}
