"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SPRITE_VERT } from "../blackhole/blackhole-shaders";
import { STAR_FRAG, STAR_VERT } from "../field/star-shaders";
import { gravityClock } from "../lib/clock";
import { easeInCubic, easeOutCubic, lerp, span } from "../lib/easing";
import { Beat, Swell, setColor, useObjectLayer, vec3, type GravityObjectBase } from "../lib/exhibit";
import { HERO_POSE, projectCircle, worldRadiusForPx, type CameraPose } from "../lib/frame";
import { GRAVITY_UNIFORMS } from "../lib/uniforms";
import { WORMHOLE } from "../palettes";
import { INNER_SKY_BG, InnerSky } from "./inner-sky";
import { MOUTH_FRAG, WORM, WORM_EXTENT } from "./wormhole-shaders";

export type WormholeState = "open" | "closed";

export interface WormholeProps extends GravityObjectBase {
  /** Seed of the star field seen through the mouth. */
  innerSeed: number;
  /** `closed`: the door is shut (rim only, dusk fill). */
  state: WormholeState;
  /** 0..1 twist of the inner image toward the centre. */
  swirl: number;
  /** Increment to play the traverse beat (1400 ms). */
  traverseCount: number;
  /** Called once at the white-out: the parent swaps outer and inner seeds. */
  onTraverse?: () => void;
}

export const TRAVERSE = { dollyS: 0.76, whiteInS: 0.64, swapS: 0.76, whiteHoldS: 0.86, whiteOutS: 1.1, totalS: 1.4 } as const;
const SPARKLE_PERIODS = [7.1, 9.7, 12.3, 5.9, 8.3, 10.9] as const;
const SPARKLES = SPARKLE_PERIODS.length;

type MutablePose = { position: [number, number, number]; target: [number, number, number]; fov: number };

/**
 * Wormhole. Budget: 2 draws (mouth quad, 6 rim sparkles) + 1 small
 * render-to-texture pass (420 inner stars, one draw, square target sized to
 * the mouth in cells, max 256^2). One lens slot (pull) with rim swirl.
 */
export function Wormhole(props: WormholeProps) {
  const { size: sizePx, seed, innerSeed, theme, intensity, position, lensSlot, lensStrength, frame, onHover, state, swirl, traverseCount, onTraverse } = props;
  const { camera, size, gl } = useThree();
  const group = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const sparkles = useRef<THREE.Points>(null);
  const swell = useRef(new Swell());
  const traverse = useRef(new Beat());
  const swapped = useRef(true);
  const lastTraverse = useRef(traverseCount);
  const worldPos = useMemo(() => vec3(position), [position]);
  const pal = WORMHOLE[theme];
  const pose = useRef<MutablePose>({ position: [0, 0, 3.3], target: [0, 0, 0], fov: 40 });

  // Inner sky target: one texel per screen cell at the hero distance (2 px cells), 32..256.
  const innerCells = useMemo(() => Math.min(256, Math.max(32, Math.ceil(((2 * sizePx) / 2) * 1.15 / 8) * 8)), [sizePx]);
  const inner = useMemo(() => new InnerSky(innerCells, INNER_SKY_BG[theme]), [innerCells, theme]);
  useEffect(() => inner.setSeed(innerSeed), [inner, innerSeed]);
  useEffect(() => () => inner.dispose(), [inner]);

  const mouthMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SPRITE_VERT,
        fragmentShader: MOUTH_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tInner: { value: null },
          uInnerRes: { value: new THREE.Vector2(64, 64) },
          uTime: GRAVITY_UNIFORMS.uTime,
          uCellsPerR: { value: 18 },
          uSwirl: { value: 0.5 },
          uOpen: { value: 1 },
          uBarrel: { value: 1.6 },
          uAlpha: { value: 1 },
          uRimFlash: { value: 0 },
          uRimOuter: { value: new THREE.Color() },
          uRimMid: { value: new THREE.Color() },
          uRimInner: { value: new THREE.Color() },
          uTint: { value: new THREE.Color() },
          uShut: { value: new THREE.Color() },
        },
      }),
    [],
  );
  const sparkleGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARKLES * 3), 3));
    const col = new Float32Array(SPARKLES * 3);
    const c = new THREE.Color();
    for (let i = 0; i < SPARKLES; i++) {
      c.set(i % 2 === 0 ? pal.sparkle : pal.sparkleAlt);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(SPARKLES).map((_, i) => (i % 3 === 0 ? 3 : 1)), 1));
    g.setAttribute("phase", new THREE.BufferAttribute(new Float32Array(SPARKLES).map((_, i) => i / SPARKLES), 1));
    g.setAttribute("shape", new THREE.BufferAttribute(new Float32Array(SPARKLES).map((_, i) => (i % 3 === 0 ? 1 : 0)), 1));
    return g;
  }, [pal]);
  const sparkleMat = useMemo(
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

  useObjectLayer(group);

  useEffect(() => {
    const u = mouthMat.uniforms;
    setColor(u.uRimOuter, pal.rimOuter);
    setColor(u.uRimMid, pal.rimMid);
    setColor(u.uRimInner, pal.rimInner);
    setColor(u.uTint, pal.innerTint);
    setColor(u.uShut, INNER_SKY_BG[theme]);
  }, [mouthMat, pal, theme]);

  useEffect(
    () => () => {
      mouthMat.dispose();
      sparkleGeo.dispose();
      sparkleMat.dispose();
    },
    [mouthMat, sparkleGeo, sparkleMat],
  );

  useEffect(() => {
    if (traverseCount === lastTraverse.current) return;
    lastTraverse.current = traverseCount;
    traverse.current.start();
    swapped.current = false;
  }, [traverseCount]);

  // Camera for the traverse beat, written before the composer applies the pose (-5) and before any exhibit projects (0).
  useFrame(() => {
    const f = frame.current;
    if (!f) return;
    const e = traverse.current.elapsed();
    if (e < 0 || e >= TRAVERSE.totalS) return;
    const p = pose.current;
    const [wx, wy] = position;
    if (e < TRAVERSE.swapS) {
      // Dolly into the mouth: ease-in, fov widens a little for speed.
      const k = easeInCubic(e / TRAVERSE.dollyS);
      p.position = [lerp(HERO_POSE.position[0], wx, k), lerp(HERO_POSE.position[1], wy, k), lerp(HERO_POSE.position[2], 0.42, k)];
      p.target = [lerp(0, wx, k), lerp(0, wy, k), 0];
      p.fov = lerp(40, 54, k);
    } else {
      // Emerge: pull back out from just behind the mouth to the hero pose, ease-out.
      const k = easeOutCubic(span(e, TRAVERSE.whiteHoldS, TRAVERSE.totalS));
      p.position = [lerp(wx, HERO_POSE.position[0], k), lerp(wy, HERO_POSE.position[1], k), lerp(1.25, HERO_POSE.position[2], k)];
      p.target = [lerp(wx, 0, k), lerp(wy, 0, k), 0];
      p.fov = lerp(48, 40, k);
    }
    f.cam = p as CameraPose;
    if (!swapped.current && e >= TRAVERSE.swapS) {
      swapped.current = true;
      onTraverse?.();
    }
  }, -6);

  // Inner sky to its target before the composer runs.
  useFrame(() => {
    inner.render(gl, gravityClock.seconds);
  }, -1);

  useFrame(() => {
    const f = frame.current;
    const g = group.current;
    const m = mouth.current;
    if (!f || !g || !m) return;
    const t = gravityClock.seconds;
    const R = worldRadiusForPx(camera, sizePx, HERO_POSE.position[2], size.height);
    const sw = swell.current.update();
    const e = traverse.current.elapsed();
    const traversing = e >= 0 && e < TRAVERSE.totalS;
    const dolly = traversing ? span(e, 0, TRAVERSE.dollyS) : 0;
    let flash = 0;
    if (traversing) {
      if (e < TRAVERSE.whiteHoldS) flash = span(e, TRAVERSE.whiteInS, TRAVERSE.swapS);
      else flash = 1 - span(e, TRAVERSE.whiteHoldS, TRAVERSE.whiteOutS);
    }

    g.position.copy(worldPos);
    m.scale.setScalar(R * sw * WORM_EXTENT);

    const lens = f.lenses[lensSlot];
    const aspect = size.width / size.height;
    const rUv = projectCircle(camera, worldPos, R * sw, aspect, lens.center);
    const px = rUv * size.height;
    const cellsPerR = Math.max(4, px / f.pixel);
    const open = state === "open" ? 1 : 0;

    const u = mouthMat.uniforms;
    u.tInner.value = inner.target.texture;
    (u.uInnerRes.value as THREE.Vector2).set(inner.target.width, inner.target.height);
    u.uCellsPerR.value = cellsPerR;
    u.uSwirl.value = swirl * (1 + 3 * dolly);
    u.uOpen.value = open;
    u.uBarrel.value = lerp(1.6, 1.0, dolly);
    u.uRimFlash.value = traversing && e < 0.1 ? 1 - e / 0.1 : 0;

    const sp = sparkles.current;
    if (sp) {
      sp.scale.setScalar(R * sw);
      const pos = sp.geometry.getAttribute("position") as THREE.BufferAttribute;
      const n = Math.round(SPARKLES * Math.min(1, intensity * 1.2) * Math.min(1, px / 20));
      sp.geometry.setDrawRange(0, n);
      for (let i = 0; i < SPARKLES; i++) {
        const ang = i * 1.05 + ((Math.PI * 2 * t) / SPARKLE_PERIODS[i]) * (i % 2 ? 1 : -1);
        const rr = WORM.halo + 0.09 + 0.05 * Math.sin(t / 3 + i);
        pos.setXYZ(i, Math.cos(ang) * rr, Math.sin(ang) * rr, 0.002);
      }
      pos.needsUpdate = true;
    }

    // Pull lens with rim swirl; eases off as the camera dives in (the mouth fills the screen anyway).
    lens.thetaE = rUv * 0.9 * lensStrength * (swell.current.on ? 1.25 : 1);
    lens.inner = rUv * WORM.edge;
    lens.sign = 1;
    lens.ring = 0.35 * intensity * open;
    lens.swirl = 0.35 * swirl * open;
    lens.strength = (1 - dolly) * (0.5 + 0.5 * open);
    lens.maxCells = Math.max(f.maxCells, Math.round((px * 0.5) / f.pixel));
    if (flash > 0) {
      f.flash = Math.max(f.flash, flash);
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
      <mesh ref={mouth} material={mouthMat} renderOrder={6} frustumCulled={false} onPointerOver={() => hover(true)} onPointerOut={() => hover(false)}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <points ref={sparkles} geometry={sparkleGeo} material={sparkleMat} frustumCulled={false} renderOrder={7} />
    </group>
  );
}
