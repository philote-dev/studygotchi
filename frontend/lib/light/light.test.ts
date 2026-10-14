import { describe, expect, it } from "vitest";
import { bayer, bSersic, DEFAULT_DITHER_MODE, DITHER_MODE, DITHER_MODES, ditherQuantize, expDisc, gaussianBand, glowRamp, glowUniforms, GLSL_LIGHT, ign, MAX_GLOW_STEPS, sersic } from "./glow.glsl";
import * as light from "./index";

describe("module surface", () => {
  it("declares in GLSL every function the materials call, with the TS mirrors alongside", () => {
    for (const fn of ["bSersic", "sersic", "expDisc", "gaussianBand", "bayer", "ign", "ditherThreshold", "ditherQuantize", "glowSprite", "glowRamp"]) {
      expect(GLSL_LIGHT).toMatch(new RegExp(`\\b${fn}\\(`));
    }
    // The four-argument quantiser (value, steps, cell, mode), not the stage uniforms' reduced one.
    expect(GLSL_LIGHT).toContain("float ditherQuantize(float v, float steps, vec2 cell, float mode)");
    expect(light.GLSL_LIGHT).toBe(GLSL_LIGHT);
    expect(light.glowUniforms).toBe(glowUniforms);
    expect(light.ditherQuantize).toBe(ditherQuantize);
    expect(DEFAULT_DITHER_MODE).toBe("bayer8");
    expect(DITHER_MODE[DEFAULT_DITHER_MODE]).toBe(2);
  });
});

describe("light profiles", () => {
  it("normalise to 1 at the centre and decrease monotonically", () => {
    for (const f of [(r: number) => sersic(r, 0.4, 4), (r: number) => sersic(r, 0.4, 1), (r: number) => expDisc(r, 0.3), (r: number) => gaussianBand(r, 0.2)]) {
      expect(f(0)).toBeCloseTo(1, 9);
      let prev = f(0);
      for (let r = 0.01; r <= 3; r += 0.01) {
        const v = f(r);
        expect(v).toBeLessThanOrEqual(prev + 1e-12);
        expect(v).toBeGreaterThan(0);
        prev = v;
      }
    }
  });

  it("uses the Ciotti & Bertin b_n (7.67 for de Vaucouleurs, 1.68 for the exponential)", () => {
    expect(bSersic(4)).toBeCloseTo(7.669, 2);
    expect(bSersic(1)).toBeCloseTo(1.678, 2);
    // Half the light of the n = 1 profile is inside re: I(re) = I(0) e^-b1.
    expect(sersic(0.4, 0.4, 1)).toBeCloseTo(Math.exp(-bSersic(1)), 9);
    // Sérsic n = 1 with h = re / b1 is the exponential disc.
    expect(sersic(0.7, 0.4, 1)).toBeCloseTo(expDisc(0.7, 0.4 / bSersic(1)), 9);
    // Higher n is more centrally concentrated with a longer tail.
    expect(sersic(0.05, 0.4, 4)).toBeLessThan(sersic(0.05, 0.4, 1));
    expect(sersic(5, 0.4, 4)).toBeGreaterThan(sersic(5, 0.4, 1));
  });
});

describe("ordered dither", () => {
  it("reproduces the canonical Bayer 2x2 and 4x4 matrices", () => {
    const m2 = [
      [0, 2],
      [3, 1],
    ];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) expect(bayer(x, y, 2)).toBeCloseTo((m2[y][x] + 0.5) / 4, 12);
    const m4 = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(bayer(x, y, 4)).toBeCloseTo((m4[y][x] + 0.5) / 16, 12);
  });

  it("thresholds of an n x n tile are a permutation of (i + 0.5) / n^2 and tile the plane", () => {
    for (const n of [2, 4, 8] as const) {
      const seen = new Set<number>();
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) seen.add(Math.round(bayer(x, y, n) * n * n - 0.5));
      expect(seen.size).toBe(n * n);
      expect(bayer(3, 5, n)).toBe(bayer(3 + n, 5 - n, n));
    }
    for (let i = 0; i < 64; i++) {
      const v = ign(i * 7, i * 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("preserves the mean: averaging the dithered value over a tile returns the input", () => {
    for (const mode of DITHER_MODES) {
      if (mode === "bands") continue;
      const size = mode === "ign" ? 64 : 8;
      for (const steps of [3, 6, 8]) {
        for (const v of [0.08, 0.3, 0.5, 0.77, 0.95]) {
          let sum = 0;
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) sum += ditherQuantize(v, steps, x, y, mode);
          const mean = sum / (size * size);
          // Bayer is exact to half a sub-level of its tile (16 or 64 thresholds); IGN is a noise, allow more.
          const thresholds = mode === "bayer4" ? 16 : 64;
          expect(Math.abs(mean - v)).toBeLessThan(mode === "ign" ? 0.04 : 0.5 / (steps * thresholds) + 1e-9);
        }
      }
    }
    // Plain bands round to the nearest step.
    expect(ditherQuantize(0.34, 4, 0, 0, "bands")).toBeCloseTo(0.25, 12);
    expect(ditherQuantize(0.4, 4, 0, 0, "bands")).toBeCloseTo(0.5, 12);
  });

  it("outputs only k / steps levels and never exceeds 1", () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        for (const v of [0, 0.2, 0.61, 1, 1.4]) {
          const q = ditherQuantize(v, 5, x, y, "bayer8");
          expect(q).toBeLessThanOrEqual(1);
          expect(Math.abs(q * 5 - Math.round(q * 5))).toBeLessThan(1e-9);
        }
      }
    }
  });
});

describe("glow ramps", () => {
  it("interpolates anchors into N steps and pads to the uniform size", () => {
    const ramp = glowRamp(["#000000", "#ff0000", "#ffffff"], 5);
    expect(ramp.length).toBe(MAX_GLOW_STEPS);
    expect(ramp[0].getHexString()).toBe("000000");
    expect(ramp[2].getHexString()).toBe("ff0000");
    expect(ramp[4].getHexString()).toBe("ffffff");
    expect(ramp[7].getHexString()).toBe("ffffff");
    const u = glowUniforms({ anchors: ["#102030", "#ffffff"], steps: 12, alphaMax: 0.8, mode: "bayer8" });
    expect(u.uSteps.value).toBe(MAX_GLOW_STEPS);
    expect(u.uDither.value).toBe(2);
    expect(u.uAlphaMax.value).toBe(0.8);
  });
});
