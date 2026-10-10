import { describe, expect, it } from "vitest";
import {
  CAMERA_LIMITS,
  STATIONS,
  clampDioramaPitch,
  clampDioramaYaw,
  clampDolly,
  defaultOverride,
  poseFor,
} from "./stations";

describe("meadow camera clamps", () => {
  it("keeps a preferred heading and refuses side-void yaw", () => {
    expect(STATIONS.overview.azimuthDeg).toBe(CAMERA_LIMITS.preferredHeadingDeg);
    expect(clampDioramaYaw(-90)).toBe(-CAMERA_LIMITS.yawDeg);
    expect(clampDioramaYaw(90)).toBe(CAMERA_LIMITS.yawDeg);
    expect(clampDioramaYaw(8)).toBe(8);
  });

  it("keeps pitch and zoom inside the local-biome contract", () => {
    expect(CAMERA_LIMITS.pitchMinDeg).toBe(34);
    expect(CAMERA_LIMITS.pitchMaxDeg).toBe(40);
    expect(CAMERA_LIMITS.yawDeg).toBe(35);
    for (const station of Object.values(STATIONS)) {
      expect(station.pitchDeg).toBeGreaterThanOrEqual(34);
      expect(station.pitchDeg).toBeLessThanOrEqual(40);
      expect(Math.abs(station.azimuthDeg)).toBeLessThanOrEqual(35);
    }
    expect(clampDioramaPitch(4)).toBe(CAMERA_LIMITS.pitchMinDeg);
    expect(clampDioramaPitch(80)).toBe(CAMERA_LIMITS.pitchMaxDeg);
    expect(clampDolly(0.1)).toBe(CAMERA_LIMITS.minDolly);
    expect(clampDolly(4)).toBe(CAMERA_LIMITS.maxDolly);
  });

  it("frames the land from the south, not straight down", () => {
    const pose = poseFor(
      STATIONS.overview,
      defaultOverride(STATIONS.overview),
      { center: [0, 0, 0], chord: 184 },
      16 / 9,
    );
    expect(pose.position[2]).toBeGreaterThan(80);
    expect(pose.position[1]).toBeGreaterThan(16);
    expect(pose.position[1]).toBeLessThan(pose.position[2]);
  });
});
