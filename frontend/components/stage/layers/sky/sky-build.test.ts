import { describe, expect, it } from "vitest";
import { placeBackdrop, seedFromStudent } from "@/lib/stage/placement";
import { SKY_TOKEN_FALLBACK, parseCssColor } from "./sky-palette";
import {
  buildFarGalaxy,
  buildSky,
  galaxyStarPosition,
  generateFarGalaxySpec,
  SKY_DRAW_CALLS,
  SKY_POINT_BUDGET,
  STAR_LAYERS,
  starCount,
  type SkyBuildInput,
} from "./sky-build";

function input(seed: number, theme: "dark" | "light" = "dark", width = 1440, height = 900): SkyBuildInput {
  return { seed, theme, width, height, fovDeg: 40, tokens: SKY_TOKEN_FALLBACK[theme], placement: placeBackdrop(seed, { aspect: width / height }) };
}

describe("buildSky", () => {
  it("stays inside the S1 budget at common viewports", () => {
    for (const [w, h] of [
      [1280, 720],
      [1440, 900],
      [1920, 1200],
      [2560, 1440],
    ]) {
      for (const seed of [seedFromStudent("sandbox"), seedFromStudent("a"), seedFromStudent("b")]) {
        const sky = buildSky(input(seed, "dark", w, h));
        expect(sky.stats.points).toBeLessThanOrEqual(SKY_POINT_BUDGET);
        expect(sky.stats.draws).toBe(SKY_DRAW_CALLS);
        expect(SKY_DRAW_CALLS).toBeLessThanOrEqual(6);
        expect(sky.stats.quads).toBeLessThanOrEqual(24);
        expect(sky.quads.count).toBe(sky.stats.quads);
        expect(sky.points.count).toBe(sky.stats.stars + sky.stats.objectPoints);
      }
    }
  });

  it("is deterministic for a seed and differs across seeds", () => {
    const a = buildSky(input(seedFromStudent("student-1")));
    const b = buildSky(input(seedFromStudent("student-1")));
    const c = buildSky(input(seedFromStudent("student-2")));
    expect(Array.from(a.points.position)).toEqual(Array.from(b.points.position));
    expect(Array.from(a.quads.matrices)).toEqual(Array.from(b.quads.matrices));
    expect(Array.from(a.points.position)).not.toEqual(Array.from(c.points.position));
  });

  it("lays stars over three depths with the near layer drifting fastest", () => {
    const sky = buildSky(input(seedFromStudent("sandbox")));
    const drifts = new Set(Array.from(sky.points.drift.subarray(0, sky.stats.stars)));
    expect(drifts.size).toBe(3);
    const nearest = Math.min(...STAR_LAYERS.map((l) => l.distance));
    for (let i = 0; i < sky.stats.stars; i++) {
      const z = -sky.points.position[i * 3 + 2];
      const drift = sky.points.drift[i];
      if (z < nearest * 1.1) expect(drift).toBe(1);
    }
    // Object sparkles never drift.
    for (let i = sky.stats.stars; i < sky.points.count; i++) expect(sky.points.drift[i]).toBe(0);
    // Grid-snapped one-cell points: sizes are 1 or 3 only.
    for (let i = 0; i < sky.points.count; i++) expect([1, 3]).toContain(sky.points.size[i]);
  });

  it("scales the star count with the viewport inside bounds", () => {
    expect(starCount(1440, 900)).toBeGreaterThan(600);
    expect(starCount(1440, 900)).toBeLessThan(900);
    expect(starCount(320, 200)).toBe(300);
    expect(starCount(5000, 3000)).toBe(1800);
  });

  it("uses the light-theme ink for stars when the theme is light", () => {
    const dark = buildSky(input(seedFromStudent("sandbox"), "dark"));
    const light = buildSky(input(seedFromStudent("sandbox"), "light"));
    const lum = (b: Float32Array, i: number) => b[i * 3] + b[i * 3 + 1] + b[i * 3 + 2];
    // Mid-layer stars: bright on dark, ink on light.
    const mid = Math.round(dark.stats.stars * STAR_LAYERS[0].share) + 3;
    expect(lum(dark.points.color, mid)).toBeGreaterThan(lum(light.points.color, mid));
  });
});

describe("far galaxy", () => {
  it("arms trail the spin: the log-spiral coefficient has the opposite sign to the spin", () => {
    for (let s = 0; s < 50; s++) {
      const spec = generateFarGalaxySpec(seedFromStudent(`g${s}`));
      expect(Math.sign(spec.b)).toBe(-spec.spinDir);
      expect([2, 3]).toContain(spec.arms);
      expect(spec.eccentricity).toBeGreaterThan(0);
      expect(spec.eccentricity).toBeLessThan(0.5);
    }
  });

  it("keeps every orbit within a (1 +- e) and the pattern turning at the pattern period", () => {
    const spec = generateFarGalaxySpec(seedFromStudent("sandbox"));
    const g = buildFarGalaxy(spec);
    for (let i = 0; i < g.count; i += 7) {
      const orbit = [g.orbit[i * 4], g.orbit[i * 4 + 1], g.orbit[i * 4 + 2], g.orbit[i * 4 + 3]] as const;
      const e = orbit[1] * spec.eccentricity;
      for (const t of [0, 13.7, 48, 200]) {
        const p = galaxyStarPosition(spec, orbit, t);
        expect(p.r).toBeGreaterThanOrEqual(orbit[0] * (1 - e) - 1e-6);
        expect(p.r).toBeLessThanOrEqual(orbit[0] * (1 + e) + 1e-6);
      }
    }
    // One full pattern turn later, a star on a circular orbit (bulge) has moved by omega * T, not the pattern.
    const bulgeIndex = g.count - 1;
    const bulgeOrbit = [g.orbit[bulgeIndex * 4], 0, g.orbit[bulgeIndex * 4 + 2], 0] as const;
    const p0 = galaxyStarPosition(spec, bulgeOrbit, 0);
    const p1 = galaxyStarPosition(spec, bulgeOrbit, spec.patternPeriodS);
    expect(Math.hypot(p0.x, p0.z)).toBeCloseTo(Math.hypot(p1.x, p1.z), 6);
  });
});

describe("parseCssColor", () => {
  it("reads rgb, rgba and hex", () => {
    expect(parseCssColor("rgb(255, 246, 223)")).toEqual([1, 246 / 255, 223 / 255, 1]);
    expect(parseCssColor("rgba(23, 21, 29, 0.42)")?.[3]).toBeCloseTo(0.42);
    expect(parseCssColor("#080716")).toEqual([8 / 255, 7 / 255, 22 / 255, 1]);
    expect(parseCssColor("transparent")).toBeNull();
  });
});
