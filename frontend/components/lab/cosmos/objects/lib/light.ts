"use client";

import { useEffect, useMemo } from "react";
import { DITHER_MODE, GLSL_LIGHT, glowRamp, glowUniforms, MAX_GLOW_STEPS, setGlowRamp, type DitherMode } from "../../shared/light/glow.glsl";
import type { ObjectTheme } from "./types";

/**
 * Adapter for the shared light module (`shared/light`, read-only import):
 * Sérsic / exponential / Gaussian profiles dithered into a few palette steps
 * in pixel-cell space. Every soft object here (coma, tails, stream, glares,
 * halos) goes through `glowSprite` so they read as smooth light, not dots or
 * hard rings. On the light sky the ramp is swapped for ink anchors.
 */
export { DITHER_MODE, GLSL_LIGHT, glowRamp, glowUniforms, MAX_GLOW_STEPS, setGlowRamp };
export type { DitherMode };

export interface GlowSpec {
  /** Dim -> bright anchors on the dark sky. */
  dark: readonly string[];
  /** Dim -> bright anchors on the light sky (ink on paper). */
  light: readonly string[];
  steps: number;
  alphaMax: number;
  mode?: DitherMode;
}

/** Themed glow uniforms with a stable identity; the ramp is rewritten in place on theme change. */
export function useGlowUniforms(spec: GlowSpec, theme: ObjectTheme) {
  const uniforms = useMemo(
    () => glowUniforms({ anchors: spec.dark, steps: spec.steps, alphaMax: spec.alphaMax, mode: spec.mode ?? "bayer8" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec.steps, spec.mode],
  );
  useEffect(() => {
    setGlowRamp(uniforms, theme === "light" ? spec.light : spec.dark, spec.steps);
    uniforms.uAlphaMax.value = spec.alphaMax;
  }, [uniforms, theme, spec.dark, spec.light, spec.steps, spec.alphaMax]);
  return uniforms;
}

/** A second (or third) palette in the same material: `uPal<Name>`, `uSteps<Name>`, `uAlphaMax<Name>`. */
export function namedGlowUniforms(name: string, anchors: readonly string[], steps: number, alphaMax: number) {
  return {
    [`uPal${name}`]: { value: glowRamp(anchors, steps) },
    [`uSteps${name}`]: { value: Math.min(MAX_GLOW_STEPS, Math.max(1, Math.round(steps))) },
    [`uAlphaMax${name}`]: { value: alphaMax },
  } as Record<string, { value: unknown }>;
}

export function setNamedGlowRamp(uniforms: Record<string, { value: unknown }>, name: string, anchors: readonly string[], steps: number): void {
  const pal = uniforms[`uPal${name}`] as { value: import("three").Color[] };
  const st = uniforms[`uSteps${name}`] as { value: number };
  setGlowRamp({ uPal: pal, uSteps: st }, anchors, steps);
}

/** GLSL: one cell of the pixel pass in object-box units (the quad spans `sizePx`; the box is 2 units). */
export const GLSL_CELL = /* glsl */ `
uniform float uSizePx;
float cellBox() { return 4.0 / max(uSizePx, 8.0); }
`;
