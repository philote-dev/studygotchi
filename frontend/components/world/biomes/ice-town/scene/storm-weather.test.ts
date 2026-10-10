import { describe, expect, it } from "vitest";
import {
  HAIL_COUNT,
  STORM_STREAK_OPACITY_CAP,
  WIND_STREAK_COUNT,
  hailAfterImpact,
  hailFallSpeed,
  stormGrade,
  stormStreakOpacity,
  treeSwayPose,
  windGustSpeed,
} from "./storm-weather";

describe("ice catastrophe tree sway", () => {
  it("keeps trees still when the gale is off", () => {
    const pose = treeSwayPose(1.4, 0, 3, false);
    expect(pose.pitch).toBe(0);
    expect(pose.roll).toBe(0);
  });

  it("freezes sway when motion is reduced", () => {
    const pose = treeSwayPose(1.4, 1, 3, true);
    expect(pose.pitch).toBe(0);
    expect(pose.roll).toBe(0);
  });

  it("leans pines hard enough to read as a gale", () => {
    const samples = [0.2, 0.55, 0.9, 1.35, 1.8].map((time) => treeSwayPose(time, 1, 2, false).pitch);
    const peak = Math.max(...samples.map(Math.abs));
    expect(peak).toBeGreaterThan(0.16);
    expect(peak).toBeLessThan(0.42);
  });

  it("does not swing neighboring trees in lockstep", () => {
    const a = treeSwayPose(0.8, 1, 1, false);
    const b = treeSwayPose(0.8, 1, 11, false);
    expect(a.pitch).not.toBeCloseTo(b.pitch, 3);
  });
});

describe("ice catastrophe hail", () => {
  it("stays denser than drizzle and thinner than a curtain", () => {
    expect(HAIL_COUNT).toBeGreaterThan(160);
    expect(HAIL_COUNT).toBeLessThan(320);
  });

  it("falls much faster than the calm snow", () => {
    expect(hailFallSpeed(1, false)).toBeGreaterThan(12);
    expect(hailFallSpeed(1, true)).toBe(0);
  });

  it("bounces once off the snow then settles so it can respawn", () => {
    const bounce = hailAfterImpact(0.4, -18, 1.5);
    expect(bounce.bounced).toBe(true);
    expect(bounce.settled).toBe(false);
    expect(bounce.y).toBeGreaterThanOrEqual(1.5);
    expect(bounce.vy).toBeGreaterThan(4);

    const settle = hailAfterImpact(1.4, -3, 1.5);
    expect(settle.settled).toBe(true);
    expect(settle.vy).toBe(0);
  });
});

describe("ice catastrophe wind", () => {
  it("keeps streak count readable, not a white sheet", () => {
    expect(WIND_STREAK_COUNT).toBeGreaterThan(12);
    expect(WIND_STREAK_COUNT).toBeLessThan(28);
  });

  it("drives a directional gale and freezes it for reduced motion", () => {
    expect(windGustSpeed(0.4, 8, 1, false)).toBeGreaterThan(16);
    expect(windGustSpeed(0.4, 8, 1, true)).toBe(0);
  });

  it("caps streak opacity so the town stays visible", () => {
    const samples = [0, 0.4, 1.1, 2.2].flatMap((time) =>
      [0, 1, 2, 5].map((index) => stormStreakOpacity(time, index, 1)),
    );
    expect(Math.max(...samples)).toBeLessThanOrEqual(STORM_STREAK_OPACITY_CAP);
    expect(Math.max(...samples)).toBeGreaterThan(0.28);
    expect(stormStreakOpacity(0.4, 0, 0)).toBe(0);
  });
});

describe("ice catastrophe grade", () => {
  it("keeps fog far enough that the mainland stays a picture", () => {
    const grade = stormGrade(1);
    expect(grade.fogNear).toBeGreaterThanOrEqual(140);
    expect(grade.fogFar).toBeGreaterThan(grade.fogNear + 250);
  });

  it("goes colder and meaner without whitening the sky", () => {
    const grade = stormGrade(1);
    expect(grade.sky.toLowerCase()).not.toBe("#ffffff");
    expect(grade.sky.toLowerCase()).not.toBe("#dbe2ee");
    expect(grade.sunIntensity).toBeGreaterThan(0.7);
    expect(grade.hemiIntensity).toBeLessThan(0.5);
  });
});
