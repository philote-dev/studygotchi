"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";
import { COSMOS_UNIFORMS, cosmosClock } from "../lib/uniforms";

export interface CosmosComposerProps {
  /** Pixel-pass cell in CSS px (device cell follows dpr, so 2 CSS px everywhere). */
  pixel?: number;
  speed?: number;
  /** Freeze the cosmos clock at this many ms (captures). */
  frozenMs?: number | null;
  /** Written to `<html data-cosmos-ready>` after a dozen frames; capture scripts wait for it. */
  readyKey?: string;
}

/** RenderPixelatedPass -> OutputPass, no edge lines, no bloom. One composer for the whole gallery. */
export function CosmosComposer({ pixel = 2, speed = 1, frozenMs = null, readyKey = "" }: CosmosComposerProps) {
  const { gl, scene, camera, size, viewport } = useThree();
  const frames = useRef(0);

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
    const px = Math.max(1, Math.round(pixel * viewport.dpr));
    bundle.composer.setPixelRatio(viewport.dpr);
    bundle.composer.setSize(size.width, size.height);
    bundle.pass.setPixelSize(px);
    COSMOS_UNIFORMS.uRes.value.set(Math.floor((size.width * viewport.dpr) / px), Math.floor((size.height * viewport.dpr) / px));
  }, [bundle, pixel, size.height, size.width, viewport.dpr]);

  useEffect(() => {
    cosmosClock.speed = speed;
  }, [speed]);

  useEffect(() => {
    cosmosClock.frozenAt = frozenMs === null ? null : frozenMs / 1000;
    return () => {
      cosmosClock.frozenAt = null;
    };
  }, [frozenMs]);

  useEffect(() => {
    frames.current = 0;
    document.documentElement.dataset.cosmosReady = "false";
  }, [readyKey]);

  useEffect(
    () => () => {
      bundle.pass.dispose();
      bundle.output.dispose();
      bundle.composer.dispose();
    },
    [bundle],
  );

  useFrame((_, delta) => {
    cosmosClock.advance(delta);
    COSMOS_UNIFORMS.uTime.value = cosmosClock.seconds;
    bundle.composer.render(delta);
    if (frames.current < 12) {
      frames.current++;
      if (frames.current === 12) document.documentElement.dataset.cosmosReady = "true";
    }
  }, 1);

  return null;
}
