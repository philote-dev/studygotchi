"use client";

import { useEffect, useMemo, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { applyPose, type GravityFrame } from "../lib/frame";
import { gravityClock } from "../lib/clock";
import { GRAVITY_UNIFORMS } from "../lib/uniforms";
import { GravityLensPass, SkyPixelPass } from "./lens-pass";

/**
 * SkyPixelPass (RenderPixelatedPass, sky layer) -> GravityLensPass (N lenses +
 * object overlay + flash) -> OutputPass. Three passes at rest. Pixel size is a
 * CSS value; the device cell follows dpr so the grain is 2 CSS px everywhere.
 */
export function GravityComposer({ frame }: { frame: RefObject<GravityFrame> }) {
  const { gl, scene, camera, size, viewport } = useThree();

  const bundle = useMemo(() => {
    const composer = new EffectComposer(gl);
    const sky = new SkyPixelPass(2, scene, camera);
    const lens = new GravityLensPass(scene, camera);
    const output = new OutputPass();
    composer.addPass(sky);
    composer.addPass(lens);
    composer.addPass(output);
    return { composer, sky, lens, output };
  }, [gl, scene, camera]);

  useEffect(() => {
    bundle.composer.setPixelRatio(viewport.dpr);
    bundle.composer.setSize(size.width, size.height);
  }, [bundle, size.height, size.width, viewport.dpr]);

  useEffect(
    () => () => {
      bundle.sky.dispose();
      bundle.lens.dispose();
      bundle.output.dispose();
      bundle.composer.dispose();
    },
    [bundle],
  );

  // The clock advances first so every exhibit reads the same time this frame.
  useFrame((_, delta) => {
    gravityClock.advance(delta);
    GRAVITY_UNIFORMS.uTime.value = gravityClock.seconds;
  }, -10);

  // Camera pose is applied before the exhibits run (priority 0) so their lens
  // projections use this frame's camera; anything driving the camera writes
  // `frame.cam` at priority -6 or earlier.
  useFrame(() => {
    const f = frame.current;
    if (f) applyPose(camera, f.cam);
  }, -5);

  useFrame((_, delta) => {
    const f = frame.current;
    if (!f) return;
    const px = Math.max(1, Math.round(f.pixel * viewport.dpr));
    bundle.sky.setPixelSize(px);
    bundle.lens.setPixelSize(px);
    GRAVITY_UNIFORMS.uRes.value.copy(bundle.lens.resolution);
    GRAVITY_UNIFORMS.uLight.value = f.theme === "light" ? 1 : 0;
    bundle.lens.apply(f, viewport.dpr, size.width, size.height);
    bundle.composer.render(delta);
  }, 1);

  return null;
}
