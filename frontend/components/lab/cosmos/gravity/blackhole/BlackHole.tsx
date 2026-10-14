"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { STAR_FRAG, STAR_VERT } from "../field/star-shaders";
import { gravityClock } from "../lib/clock";
import { backOut, easeInOutQuad, easeOutQuad } from "../lib/easing";
import { Beat, Swell, setColor, useObjectLayer, vec3, type GravityObjectBase } from "../lib/exhibit";
import { HERO_POSE, projectCircle, worldRadiusForPx } from "../lib/frame";
import { mulberry32 } from "../lib/rng";
import { GRAVITY_UNIFORMS } from "../lib/uniforms";
import { BLACK_HOLE } from "../palettes";
import { BH, DISC_FRAG, FEED_FRAG, FEED_VERT, JET_FRAG, MAX_BEADS, SPRITE_VERT } from "./blackhole-shaders";

export type BlackHoleState = "idle" | "feeding";

export interface BlackHoleProps extends GravityObjectBase {
  state: BlackHoleState;
  /** 0 face-on donut .. 1 edge-on Interstellar silhouette (reduced automatically below ~56 px). */
  tilt: number;
  /** Disc spin period at the outer edge, seconds. */
  spinPeriodS: number;
  /** 3..5 orbiting knots (Sgr A* has three). */
  beadCount: number;
  /** 0..1 density of in-falling streams; `state: "feeding"` forces at least 0.7. */
  feed: number;
  jets: boolean;
  /** Increment to play the "cluster mastered" beat: 80 ms hit-stop, ring flash, sprinkles, evaporate. */
  masteredCount: number;
  /** Increment to play a short feed burst. */
  feedBurstCount: number;
}

/** Sgr A* knots: incommensurate periods (seconds), so the pattern never repeats. */
export const BEAD_PERIODS = [5.3, 7.9, 11.7, 9.1, 6.7] as const;
export const MASTERED = { hitStopS: 0.08, flashS: 0.09, evaporateS: 0.6, returnAfterS: 1.5, returnS: 0.32 } as const;
export const FEED_BURST_S = 0.45;
const FEED_POINTS = 96;
const SPRINKLES = 14;

/**
 * Black hole v2.
 * Budget: 1 draw at rest (disc quad), +1 when feed > 0 (<= 96 points),
 * +1 with jets on, +1 during beats (14 sprinkles). Writes one lens slot.
 */
export function BlackHole(props: BlackHoleProps) {
  const { size: sizePx, seed, theme, intensity, position, lensSlot, lensStrength, frame, onHover } = props;
  const { state, tilt, spinPeriodS, beadCount, feed, jets, masteredCount, feedBurstCount } = props;
  const { camera, size } = useThree();
  const group = useRef<THREE.Group>(null);
  const disc = useRef<THREE.Mesh>(null);
  const jetMesh = useRef<THREE.Mesh>(null);
  const feedPts = useRef<THREE.Points>(null);
  const sprinklePts = useRef<THREE.Points>(null);
  const swell = useRef(new Swell());
  const mastered = useRef(new Beat());
  const burst = useRef(new Beat());
  const lastMastered = useRef(masteredCount);
  const lastBurst = useRef(feedBurstCount);
  const worldPos = useMemo(() => vec3(position), [position]);
  const pal = BLACK_HOLE[theme];

  const discMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SPRITE_VERT,
        fragmentShader: DISC_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uTime: GRAVITY_UNIFORMS.uTime,
          uLight: GRAVITY_UNIFORMS.uLight,
          uSpin: { value: 110 },
          uCellsPerR: { value: 18 },
          uTilt: { value: 0 },
          uRingFlash: { value: 0 },
          uAlpha: { value: 1 },
          uFeed: { value: 0 },
          uBeadCount: { value: 3 },
          uBeads: { value: new Array(MAX_BEADS).fill(0) },
          uGold: { value: new THREE.Color() },
          uAmber: { value: new THREE.Color() },
          uEdge: { value: new THREE.Color() },
          uDim: { value: new THREE.Color() },
          uRim: { value: new THREE.Color() },
          uFlashColor: { value: new THREE.Color() },
        },
      }),
    [],
  );
  const jetMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SPRITE_VERT,
        fragmentShader: JET_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uTime: GRAVITY_UNIFORMS.uTime, uCellsPerR: { value: 18 }, uJet: { value: 0 }, uJetColor: { value: new THREE.Color() } },
      }),
    [],
  );
  const feedGeo = useMemo(() => {
    const rng = mulberry32(seed ^ 0xfeed);
    const pos = new Float32Array(FEED_POINTS * 3);
    const col = new Float32Array(FEED_POINTS * 3);
    const phase = new Float32Array(FEED_POINTS);
    const angle = new Float32Array(FEED_POINTS);
    const speed = new Float32Array(FEED_POINTS);
    const c = new THREE.Color();
    const lanes = 3;
    for (let i = 0; i < FEED_POINTS; i++) {
      const lane = i % lanes;
      const k = Math.floor(i / lanes);
      phase[i] = (k / (FEED_POINTS / lanes) + rng() * 0.05) % 1;
      angle[i] = (lane / lanes) * Math.PI * 2 + 0.7 + (rng() - 0.5) * 0.5;
      speed[i] = 0.85 + rng() * 0.3;
      c.set(rng() < 0.7 ? pal.feed : pal.gold);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    g.setAttribute("aAngle", new THREE.BufferAttribute(angle, 1));
    g.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
    g.setDrawRange(0, 0);
    return g;
  }, [seed, pal]);
  const feedMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FEED_VERT,
        fragmentShader: FEED_FRAG,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uTime: GRAVITY_UNIFORMS.uTime, uRes: GRAVITY_UNIFORMS.uRes, uLight: GRAVITY_UNIFORMS.uLight, uTilt: { value: 0 }, uPeriod: { value: 6 }, uBurst: { value: 0 } },
      }),
    [],
  );
  const sprinkleGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPRINKLES * 3), 3));
    const col = new Float32Array(SPRINKLES * 3);
    const c = new THREE.Color();
    for (let i = 0; i < SPRINKLES; i++) {
      c.set(i % 3 === 0 ? pal.gold : i % 3 === 1 ? pal.amber : pal.flash);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(SPRINKLES).map((_, i) => (i % 4 === 0 ? 3 : 1)), 1));
    g.setAttribute("phase", new THREE.BufferAttribute(new Float32Array(SPRINKLES), 1));
    g.setAttribute("shape", new THREE.BufferAttribute(new Float32Array(SPRINKLES).map((_, i) => (i % 4 === 0 ? 1 : 0)), 1));
    g.setDrawRange(0, 0);
    return g;
  }, [pal]);
  const sprinkleMat = useMemo(
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
  const velocities = useMemo(() => {
    const v: THREE.Vector2[] = [];
    for (let i = 0; i < SPRINKLES; i++) {
      const ang = (i / SPRINKLES) * Math.PI * 2 + 0.3;
      const spd = 1.6 + (i % 4) * 0.35;
      v.push(new THREE.Vector2(Math.cos(ang) * spd, Math.sin(ang) * spd));
    }
    return v;
  }, []);

  useObjectLayer(group);

  useEffect(() => {
    const u = discMat.uniforms;
    setColor(u.uGold, pal.gold);
    setColor(u.uAmber, pal.amber);
    setColor(u.uEdge, pal.edge);
    setColor(u.uDim, pal.dim);
    setColor(u.uRim, pal.rim);
    setColor(u.uFlashColor, pal.flash);
    setColor(jetMat.uniforms.uJetColor, pal.jet);
    feedMat.blending = theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending;
    feedMat.needsUpdate = true;
  }, [discMat, jetMat, feedMat, pal, theme]);

  useEffect(() => {
    discMat.uniforms.uSpin.value = spinPeriodS;
  }, [discMat, spinPeriodS]);

  useEffect(
    () => () => {
      discMat.dispose();
      jetMat.dispose();
      feedGeo.dispose();
      feedMat.dispose();
      sprinkleGeo.dispose();
      sprinkleMat.dispose();
    },
    [discMat, jetMat, feedGeo, feedMat, sprinkleGeo, sprinkleMat],
  );

  useEffect(() => {
    if (masteredCount === lastMastered.current) return;
    lastMastered.current = masteredCount;
    mastered.current.start();
    gravityClock.stop(MASTERED.hitStopS);
  }, [masteredCount]);

  useEffect(() => {
    if (feedBurstCount === lastBurst.current) return;
    lastBurst.current = feedBurstCount;
    burst.current.start();
  }, [feedBurstCount]);

  useFrame(() => {
    const f = frame.current;
    const g = group.current;
    const m = disc.current;
    if (!f || !g || !m) return;
    const t = gravityClock.seconds;
    const R = worldRadiusForPx(camera, sizePx, HERO_POSE.position[2], size.height);
    const sw = swell.current.update();

    // Mastered beat on wall time (the lab clock is in hit-stop for its first 80 ms).
    let evap = 1;
    let ringFlash = 0;
    let visible = true;
    const mb = mastered.current;
    const e = mb.elapsed();
    if (e >= 0 && e < MASTERED.returnAfterS + MASTERED.returnS) {
      ringFlash = e < MASTERED.flashS ? 1 : 0;
      if (e < MASTERED.evaporateS) evap = 1 - easeInOutQuad(e / MASTERED.evaporateS);
      else if (e < MASTERED.returnAfterS) {
        evap = 0;
        visible = false;
      } else evap = backOut((e - MASTERED.returnAfterS) / MASTERED.returnS);
    }
    // Feed burst: a short puff of sprinkles and a brightness lift.
    const be = burst.current.elapsed();
    const bursting = be >= 0 && be < FEED_BURST_S;
    const burstK = bursting ? 1 - be / FEED_BURST_S : 0;

    // Sprinkles serve both beats: fly out from the ring, fade with life^2.
    const sp = sprinklePts.current;
    if (sp) {
      const pos = sp.geometry.getAttribute("position") as THREE.BufferAttribute;
      const beatLife = e >= 0 && e < MASTERED.evaporateS ? e / MASTERED.evaporateS : bursting ? be / FEED_BURST_S : -1;
      const spread = e >= 0 && e < MASTERED.evaporateS ? 1 : 0.45;
      sp.geometry.setDrawRange(0, beatLife >= 0 ? SPRINKLES : 0);
      sprinkleMat.uniforms.uFade.value = beatLife >= 0 ? 1 - beatLife * beatLife : 0;
      if (beatLife >= 0) {
        for (let i = 0; i < SPRINKLES; i++) {
          const v = velocities[i];
          const k = easeOutQuad(beatLife) * spread;
          pos.setXYZ(i, (BH.beadR * Math.cos(i) + v.x * k) * R, (BH.beadR * Math.sin(i) + v.y * k) * R, 0.002);
        }
        pos.needsUpdate = true;
      }
    }

    const scale = Math.max(0.0001, sw * evap);
    m.visible = visible && scale > 0.002;
    g.position.copy(worldPos);
    m.scale.setScalar(R * scale * 1.05);

    // Projected size this frame (the camera may be dollying), in CSS px.
    const lens = f.lenses[lensSlot];
    const aspect = size.width / size.height;
    const rUv = projectCircle(camera, worldPos, R * scale, aspect, lens.center);
    const px = rUv * size.height;
    const cellsPerR = Math.max(4, px / f.pixel);
    // Below ~56 px the silhouette flattens back toward the donut so it still reads at 24 to 48 px.
    const tiltEff = tilt * THREE.MathUtils.smoothstep(px, 18, 56);
    // Streams thin out below ~64 px so a tiny hole is a clean donut, not a donut in confetti.
    const feedEff = Math.min(1, (state === "feeding" ? Math.max(feed, 0.7) : feed) * intensity) * THREE.MathUtils.smoothstep(px, 20, 64);

    const u = discMat.uniforms;
    u.uCellsPerR.value = cellsPerR;
    u.uTilt.value = tiltEff;
    u.uRingFlash.value = Math.max(ringFlash, burstK * 0.5);
    u.uFeed.value = feedEff * 0.6 + burstK * 0.6;
    u.uBeadCount.value = Math.min(MAX_BEADS, Math.max(0, Math.round(beadCount)));
    const beads = u.uBeads.value as number[];
    for (let i = 0; i < MAX_BEADS; i++) beads[i] = 0.4 + i * 1.3 + (Math.PI * 2 * t) / BEAD_PERIODS[i];

    const jm = jetMesh.current;
    if (jm) {
      jm.visible = jets && m.visible;
      jm.scale.setScalar(R * scale);
      jetMat.uniforms.uCellsPerR.value = cellsPerR;
      jetMat.uniforms.uJet.value = jets ? tiltEff * (0.6 + 0.4 * intensity) : 0;
    }
    const fp = feedPts.current;
    if (fp) {
      fp.scale.setScalar(R * scale);
      fp.visible = m.visible && feedEff > 0.01;
      fp.geometry.setDrawRange(0, Math.round(feedEff * FEED_POINTS));
      feedMat.uniforms.uTilt.value = tiltEff;
      feedMat.uniforms.uPeriod.value = bursting ? 3.2 : 6.5;
      feedMat.uniforms.uBurst.value = burstK;
    }
    if (sp) sp.scale.setScalar(1);

    // Lens slot: Einstein radius 0.8 R (x1.3 while hovered), no warp inside the photon ring,
    // cap grows with the hole so a 240 px hole bends as visibly as a 32 px one.
    lens.thetaE = rUv * 0.8 * lensStrength * (swell.current.on ? 1.3 : 1);
    lens.inner = rUv * BH.ringIn;
    lens.sign = 1;
    lens.ring = 0.55 * intensity;
    lens.swirl = 0;
    lens.strength = m.visible ? 1 : 0;
    lens.maxCells = Math.max(f.maxCells, Math.round((px * 0.65) / f.pixel));
    f.flash = Math.max(f.flash, ringFlash * 0.025);
  });

  const hover = (on: boolean) => {
    if (swell.current.on === on) return;
    swell.current.set(on);
    onHover?.(on);
  };

  return (
    <group ref={group}>
      <mesh ref={jetMesh} material={jetMat} renderOrder={4} frustumCulled={false} visible={false}>
        <planeGeometry args={[1, 3.6]} />
      </mesh>
      <points ref={feedPts} geometry={feedGeo} material={feedMat} frustumCulled={false} renderOrder={5} />
      <mesh ref={disc} material={discMat} renderOrder={6} frustumCulled={false} onPointerOver={() => hover(true)} onPointerOut={() => hover(false)}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <points ref={sprinklePts} geometry={sprinkleGeo} material={sprinkleMat} frustumCulled={false} renderOrder={7} />
    </group>
  );
}
