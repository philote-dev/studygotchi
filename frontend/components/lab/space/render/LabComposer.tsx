"use client";

import { useEffect, useMemo, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { applyLayers, applyPose, labClock, useLabRegistry, type LabFrame } from "../lib/lab-frame";
import { LAB_UNIFORMS } from "../lib/lab-uniforms";
import { CurtainPass } from "./curtain-pass";
import { LayerPixelPass } from "./layer-pixel-pass";
import { LabPostShader } from "./post-shader";

/** Camera-space effects (streaks, cloud puffs) live in this registry layer and are composited over everything by the curtain pass. */
export const FX_LAYER = "fx";

/**
 * RenderPixelatedPass (x2, dissolvable) -> snapshot curtain + FX overlay ->
 * lens + flash -> OutputPass. Pixel size is a director value in CSS px; the
 * device cell follows dpr so the grain is resolution independent (2 CSS px
 * on every screen).
 */
export function LabComposer({ frame }: { frame: RefObject<LabFrame> }) {
  const { gl, scene, camera, size, viewport } = useThree();
  const registry = useLabRegistry();

  const bundle = useMemo(() => {
    const composer = new EffectComposer(gl);
    const layers = new LayerPixelPass(scene, camera);
    const curtain = new CurtainPass();
    const post = new ShaderPass(LabPostShader);
    const output = new OutputPass();
    composer.addPass(layers);
    composer.addPass(curtain);
    composer.addPass(post);
    composer.addPass(output);
    return { composer, layers, curtain, post, output, clearColor: new THREE.Color() };
  }, [gl, scene, camera]);

  useEffect(() => {
    bundle.composer.setPixelRatio(viewport.dpr);
    bundle.composer.setSize(size.width, size.height);
  }, [bundle, size.height, size.width, viewport.dpr]);

  useEffect(
    () => () => {
      bundle.layers.dispose();
      bundle.curtain.dispose();
      bundle.post.dispose();
      bundle.output.dispose();
      bundle.composer.dispose();
    },
    [bundle],
  );

  // The lab clock advances first so every scene reads the same time this frame.
  useFrame((_, delta) => {
    labClock.advance(delta);
    LAB_UNIFORMS.uTime.value = labClock.seconds;
  }, -10);

  useFrame((_, delta) => {
    const f = frame.current;
    if (!f) return;
    const px = Math.max(1, Math.round(f.pixel * viewport.dpr));
    bundle.layers.setPixelSize(px);
    LAB_UNIFORMS.uRes.value.copy(bundle.layers.resolution);
    LAB_UNIFORMS.uLight.value = f.theme === "light" ? 1 : 0;
    bundle.layers.mix = f.mix;
    bundle.layers.prepareA = () => {
      applyLayers(registry, f.layersA);
      applyPose(camera, f.camA);
    };
    bundle.layers.prepareB = () => {
      applyLayers(registry, f.layersB);
      applyPose(camera, f.camB);
    };
    // Readiness warm-up: render each requested layer once into the offscreen target.
    const warm = f.warm.splice(0, f.warm.length);
    bundle.layers.warmQueue = warm.map((name) => () => {
      applyLayers(registry, [name]);
      applyPose(camera, f.camB);
    });

    const curtain = bundle.curtain;
    curtain.capture = f.curtain.capture;
    f.curtain.capture = false;
    curtain.mix = f.curtain.mix;
    curtain.zoom = f.curtain.zoom;
    curtain.pixel = Math.max(1, Math.round(f.curtain.pixel * viewport.dpr));
    curtain.setFxSize(bundle.layers.resolution.x, bundle.layers.resolution.y);
    if (scene.background instanceof THREE.Color) curtain.bg.copy(scene.background);
    curtain.renderFx = registry.has(FX_LAYER)
      ? (renderer, target) => {
          const bg = scene.background;
          scene.background = null;
          applyLayers(registry, [FX_LAYER]);
          applyPose(camera, f.camA);
          const prevTarget = renderer.getRenderTarget();
          const prevColor = renderer.getClearColor(bundle.clearColor);
          const prevAlpha = renderer.getClearAlpha();
          renderer.setRenderTarget(target);
          renderer.setClearColor(0x000000, 0);
          renderer.clear();
          renderer.render(scene, camera);
          renderer.setClearColor(prevColor, prevAlpha);
          renderer.setRenderTarget(prevTarget);
          scene.background = bg;
        }
      : null;

    const u = bundle.post.uniforms;
    u.uRes.value.set(size.width * viewport.dpr, size.height * viewport.dpr);
    u.uPx.value = px;
    u.uLens.value = f.lens.active ? 1 : 0;
    (u.uCenter.value as THREE.Vector2).copy(f.lens.center);
    u.uThetaE.value = f.lens.thetaE;
    u.uDisc.value = f.lens.disc;
    u.uMaxCells.value = f.lens.maxCells;
    u.uFlash.value = f.flash;
    (u.uFlashColor.value as THREE.Color).copy(f.flashColor);
    bundle.composer.render(delta);
    for (const name of warm) f.warmed.add(name);
  }, 1);

  return null;
}
