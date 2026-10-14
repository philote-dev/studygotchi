"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { galaxyHandoffAt, LAND_CHROME_SELECTOR, PLANET_CHROME_SELECTOR, planetFromWorldFadeAt, planetPoseAt, pullbackSlope, reducedHopAt, speedAt, twinCurvesAt, worldPassFadeAt, worldRiseAt } from "@/lib/stage/hop";
import { planetPassFadeAt } from "../layers/galaxy/galaxy-rung-model";
import { useStage } from "../StageContext";
import type { HopRuntime } from "./hop-runtime";

function clearChrome(selector: string = PLANET_CHROME_SELECTOR): void {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    el.style.opacity = "";
    el.style.pointerEvents = "";
  }
}

/** Opacity only (GPU), pointer events off while faded; the inline style is cleared once back at 1 so the page is untouched at rest. */
function fadeChrome(selector: string, opacity: number, last: { current: number }): void {
  if (opacity < 1) {
    const value = opacity.toFixed(3);
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.style.opacity !== value) el.style.opacity = value;
      if (el.style.pointerEvents !== "none") el.style.pointerEvents = "none";
    }
  } else if (last.current < 1) clearChrome(selector);
  last.current = opacity;
}

/**
 * Inside the stage canvas, after the director's step (-5) and before every
 * layer (0): turns the director's `L` and `v` into the shared hop state the
 * layers read this frame (planet pose, twin curves, world segment, galaxy
 * hand-off, the two pass fades, speed dressing), writes the integer cell size
 * and the cloud deck into the composer frame, fades the planet chrome (the
 * live one and its ghost) and the land chrome, and ticks the runtime
 * (deferred route, ghost removal, the dive's readiness hold). Pure reads of
 * the director; no React state.
 *
 * Reduced motion: the director tweens `L` over `REDUCED_HOP_MS` and this
 * reads it as `reducedHopAt`, a crossfade of the two rest poses: the planet
 * stays at the seat, the land at its station, the graph whole (enter 1,
 * condense 0, blobs whole); no clouds, no streaks, no grain ramp.
 */
export function HopDriver({ runtime }: { runtime: HopRuntime }) {
  const { frame } = useStage();
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const lastChrome = useRef(1);
  const lastLandChrome = useRef(1);

  // Probe surface: the stage renderer's program list (the "0 compiles per hop" check names its culprits).
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    runtime.programs = () => {
      const out: string[] = [];
      const seen = new Set<THREE.Material>();
      const visit = (root: THREE.Object3D, tag: string) =>
        root.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
            if (seen.has(mat)) continue;
            seen.add(mat);
            const program = (gl.properties.get(mat) as { currentProgram?: { id: number } }).currentProgram;
            out.push(`${tag}/${o.name || o.type}/${mat.type}#${program?.id ?? "-"}`);
          }
        });
      visit(scene, "stage");
      const planet = frame.current?.planet;
      if (planet) visit(planet.scene, "planet");
      for (const p of gl.info.programs ?? []) out.push(`program/${p.name}#${p.id}:${String(p.cacheKey).slice(0, 60)}`);
      return out;
    };
    return () => {
      runtime.programs = null;
    };
  }, [runtime, gl, scene, frame]);

  // Unmount: restore whatever chrome we touched and hand the composer its own fades back.
  useEffect(
    () => () => {
      clearChrome(PLANET_CHROME_SELECTOR);
      clearChrome(LAND_CHROME_SELECTOR);
      const f = frame.current;
      if (f) {
        f.clouds = 0;
        f.planetFade = null;
        f.worldFade = null;
      }
    },
    [frame],
  );
  // Keep the hidden planet pass warm (late-loading globe materials compile before the way down).
  useEffect(() => {
    const f = frame.current;
    if (f) f.keepWarm = true;
    return () => {
      const cur = frame.current;
      if (cur) cur.keepWarm = false;
    };
  }, [frame]);

  useFrame(() => {
    const s = runtime.director.sample();
    const st = runtime.state;
    st.L = s.L;
    st.v = s.v;
    st.moving = s.moving;
    st.width = size.width;
    st.height = size.height;
    const seat = st.seat ?? runtime.defaultSeat(size.width, size.height);
    st.slope = pullbackSlope(seat.radiusPx, 2);
    const flight = runtime.flight;
    if (runtime.director.reducedMotion) {
      // The crossfade: every layer at its rest pose, opacities from the tween.
      const from = flight?.from ?? s.rung;
      const to = flight?.to ?? s.rung;
      const r = reducedHopAt(s.L, from, to, runtime.director.readiness.get("world"));
      st.pose = { ...planetPoseAt(1, seat, 2), chrome: r.planet, opacity: r.planet };
      st.twin = { enter: 1, condense: 0, opacity: r.twin, chrome: r.twin };
      st.world = { L: s.L, rise: 0, clouds: 0, world: r.world, planet: r.planet, landChrome: r.world, approach: 1 };
      st.galaxy = { ...galaxyHandoffAt(s.L), condense: 0, blob: 0 };
      st.planetFade = r.planet;
      st.worldFade = r.world;
      st.speed = { rate: 0, streaks: { density: 0, speed: 0 }, pixel: 2, direction: 0 };
    } else {
      st.pose = planetPoseAt(s.L, seat, 2);
      st.twin = twinCurvesAt(s.L);
      st.world = worldRiseAt(s.L);
      st.galaxy = galaxyHandoffAt(s.L);
      // The planet pass: gone where the galaxy is whole, and under the deck while inside the world.
      st.planetFade = planetPassFadeAt(s.L) * planetFromWorldFadeAt(s.L);
      st.worldFade = worldPassFadeAt(s.L);
      st.speed = speedAt(s.L, s.v, st.slope, st.speed.pixel);
    }
    st.planetAnchor = { x: st.pose.cx * size.width, y: st.pose.cy * size.height, radius: Math.max(2, st.pose.radiusPx) };
    const f = frame.current;
    if (f) {
      // The stage grain (every pixel-path pass: sky, planet, world, clouds); the native path never ramps.
      f.pixel = st.speed.pixel;
      // The cloud deck (the world <-> planet mask) and how fast it streams past the lens.
      f.clouds = st.world.clouds;
      f.cloudFlow = s.v;
      f.planetFade = st.planetFade;
      f.worldFade = st.worldFade;
    }
    // Planet chrome (navigator, flag) and the land chrome (rail, place card): written every frame
    // while away from their rung so a page that mounts mid-hop arrives already faded; both whole at
    // their rest stop (`landChrome` is 1 at L 0, the only altitude a land rests at).
    fadeChrome(PLANET_CHROME_SELECTOR, st.pose.chrome, lastChrome);
    fadeChrome(LAND_CHROME_SELECTOR, st.world.landChrome, lastLandChrome);
    runtime.tick();
  }, -4);

  return null;
}
