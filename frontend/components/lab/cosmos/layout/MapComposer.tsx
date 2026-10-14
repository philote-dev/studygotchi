"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";
import { MAP_UNIFORMS, type MapTheme } from "./uniforms";

/**
 * RenderPixelatedPass -> OutputPass. A reduced local copy of the space lab's
 * composer: no lens, no dissolve. Pixel size is given in CSS px and follows
 * dpr so the grain is the same on every screen. Edge lines are off: a sky.
 */
export function MapComposer({ theme, pixel, timeScale = 1 }: { theme: MapTheme; pixel: number; timeScale?: number }) {
  const { gl, scene, camera, size, viewport } = useThree();

  const bundle = useMemo(() => {
    const composer = new EffectComposer(gl);
    const pass = new RenderPixelatedPass(2, scene, camera, { normalEdgeStrength: 0, depthEdgeStrength: 0 });
    pass.normalEdgeStrength = 0;
    pass.depthEdgeStrength = 0;
    const output = new OutputPass();
    composer.addPass(pass);
    composer.addPass(output);
    return { composer, pass, output };
  }, [gl, scene, camera]);

  useEffect(() => {
    bundle.composer.setPixelRatio(viewport.dpr);
    bundle.composer.setSize(size.width, size.height);
  }, [bundle, size.height, size.width, viewport.dpr]);

  useEffect(
    () => () => {
      bundle.pass.dispose();
      bundle.output.dispose();
      bundle.composer.dispose();
    },
    [bundle],
  );

  useFrame((_, delta) => {
    MAP_UNIFORMS.uTime.value += Math.min(delta, 0.1) * timeScale;
    MAP_UNIFORMS.uLight.value = theme === "light" ? 1 : 0;
    const px = Math.max(1, Math.round(pixel * viewport.dpr));
    if (bundle.pass.pixelSize !== px) bundle.pass.setPixelSize(px);
    MAP_UNIFORMS.uRes.value.set(Math.max(1, Math.floor((size.width * viewport.dpr) / px)), Math.max(1, Math.floor((size.height * viewport.dpr) / px)));
    bundle.composer.render(delta);
  }, 1);

  return null;
}
