"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mulberry32 } from "@/lib/stage/rng";
import { useStage } from "../StageContext";
import type { StageTheme } from "../lib/uniforms";
import type { HopRuntime } from "./hop-runtime";

const STREAK_COUNT = 360;
const STREAK_DEPTH = 70;

/**
 * Speed streaks for the hop (ported from the space lab's Stage v2 `Streaks`):
 * thin instanced boxes along the view axis in front of the stage camera, in
 * the pixel pass, whose count follows the streak density and whose length
 * follows the speed; recycled past the lens. A hole is kept in the middle of
 * the tunnel so the planet point and the bead stay readable. Always mounted
 * and compiled; zero instances at rest (no draw).
 */
export function HopStreaks({ runtime, theme }: { runtime: HopRuntime; theme: StageTheme }) {
  const { frame } = useStage();
  const mesh = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => {
    const rng = mulberry32(0x57e4);
    const off = () => {
      const v = (rng() - 0.5) * 2;
      return Math.sign(v || 1) * (0.22 + 0.78 * Math.abs(v));
    };
    return Array.from({ length: STREAK_COUNT }, () => ({ x: off(), y: off(), z: -2 - rng() * STREAK_DEPTH, w: 0.6 + rng() * 0.8 }));
  }, []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: theme === "dark" ? "#fff6df" : "#2a2740",
        transparent: true,
        // Thinner than the lab's: the stage camera does not travel, so the tunnel is drawn at a
        // fixed 40 deg fov; ink on paper reads heavier than light on dark, so lighter there.
        opacity: theme === "dark" ? 0.7 : 0.32,
        depthTest: false,
        depthWrite: false,
        blending: theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [theme],
  );
  useEffect(() => () => material.dispose(), [material]);
  // A new material (theme change) needs its program: ask the composer for a warm pass.
  useEffect(() => {
    const f = frame.current;
    if (f) f.warm = true;
  }, [frame, material]);
  const scratch = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  // The tunnel keeps its last heading through the moment the spring reverses, so a
  // retarget mid-flight never shows a frame of streaks standing still.
  const heading = useRef<1 | -1>(1);

  useFrame((_, delta) => {
    const im = mesh.current;
    if (!im) return;
    const { streaks, direction } = runtime.state.speed;
    const { density, speed } = streaks;
    if (direction !== 0) heading.current = direction;
    const shown = Math.floor(STREAK_COUNT * Math.min(1, Math.max(0, density)));
    im.count = shown;
    if (shown === 0) return;
    // Climbing (planet -> constellation -> galaxy): streaks rush past toward the viewer.
    // Descending (back toward the planet): they recede into the centre of the tunnel.
    const step = heading.current * speed * 18 * Math.min(delta, 0.1);
    const len = Math.min(4, Math.max(0.25, speed * 0.7));
    const { m, q, p, s } = scratch;
    for (let i = 0; i < shown; i++) {
      const sd = seeds[i];
      sd.z += step;
      if (sd.z > -1.5) sd.z -= STREAK_DEPTH;
      else if (sd.z < -2 - STREAK_DEPTH) sd.z += STREAK_DEPTH;
      const spread = -sd.z * 0.55;
      p.set(sd.x * spread, sd.y * spread, sd.z - len / 2);
      // One to two cells wide on screen whatever the depth; the length is the velocity cue.
      const w = 0.0018 * -sd.z * sd.w;
      s.set(w, w, len);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  }, -1);

  return (
    <instancedMesh ref={mesh} name="hop-streaks" args={[undefined, undefined, STREAK_COUNT]} material={material} frustumCulled={false} renderOrder={8}>
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}
