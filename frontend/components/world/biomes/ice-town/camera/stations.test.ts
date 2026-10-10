import { describe, expect, it } from "vitest";
import { ICE_TOWN_LAYOUT } from "../layout/biome-layout";
import {
  ICE_CAMERA_BOX,
  ICE_CAMERA_LIMITS,
  ICE_LOOK_AT,
  ICE_LOOK_BOX,
  ICE_OVERVIEW_CHORD,
  clampCameraPosition,
  clampLookTarget,
  districtStationAzimuth,
  fitDistance,
  poseFor,
  STATIONS,
  defaultOverride,
} from "./stations";

describe("ice camera stations (lab contract, SHIP-HANDOFF §6)", () => {
  it("pins the lab station table: pitches 30 / 36 / 30 / 18, fit 0.7 / 0.7 / 0.75, resident 9 m, FOV 26", () => {
    // Same numbers as prototypes/biome-lab/src/camera/stations.ts (azimuths / lifts stay the product's).
    expect(STATIONS.arrival).toMatchObject({ pitchDeg: 30, fov: 26, fitWidth: 0.7 });
    expect(STATIONS.overview).toMatchObject({ pitchDeg: 36, fov: 26, fitWidth: 0.7 });
    expect(STATIONS.district).toMatchObject({ pitchDeg: 30, fov: 26, fitWidth: 0.75 });
    expect(STATIONS.resident).toMatchObject({ pitchDeg: 18, fov: 26, distance: 9 });
    expect(STATIONS.resident.fitWidth).toBeUndefined();
  });

  it("frees the azimuth and keeps the lab polar range", () => {
    // 180 → BoundedIceCamera passes ±Infinity to CameraControls: no ±35° yaw clamp.
    expect(ICE_CAMERA_LIMITS.yawDeg).toBe(180);
    expect(ICE_CAMERA_LIMITS.southOnly).toBe(false);
    // Lab CameraRig polar clamp 0.35–1.25 rad ≙ pitch 18–70°; every station pitch is reachable.
    expect(ICE_CAMERA_LIMITS.pitchMinDeg).toBe(18);
    expect(ICE_CAMERA_LIMITS.pitchMaxDeg).toBe(70);
    for (const station of Object.values(STATIONS)) {
      expect(station.pitchDeg).toBeGreaterThanOrEqual(ICE_CAMERA_LIMITS.pitchMinDeg);
      expect(station.pitchDeg).toBeLessThanOrEqual(ICE_CAMERA_LIMITS.pitchMaxDeg);
    }
    expect(ICE_CAMERA_LIMITS.minDistance).toBeGreaterThanOrEqual(80);
    expect(ICE_CAMERA_LIMITS.maxDistance).toBeGreaterThanOrEqual(260);
    expect(ICE_CAMERA_LIMITS.maxDistance).toBeLessThanOrEqual(400);
  });

  it("uses the layout's per-district stationAzimuth for the district station", () => {
    const byId = Object.fromEntries(ICE_TOWN_LAYOUT.districts.map((district) => [district.id, district]));
    expect(districtStationAzimuth(byId.harbour)).toBe(72);
    expect(districtStationAzimuth(byId.forest)).toBe(66);
    expect(districtStationAzimuth(byId.town)).toBe(STATIONS.district.azimuthDeg);
    expect(districtStationAzimuth(null)).toBe(STATIONS.district.azimuthDeg);
  });

  it("fits the overview pose inside the camera box without a distance clamp", () => {
    const pose = poseFor(
      STATIONS.overview,
      defaultOverride(STATIONS.overview),
      { center: ICE_LOOK_AT, chord: ICE_OVERVIEW_CHORD },
      16 / 10,
    );
    const distance = fitDistance(ICE_OVERVIEW_CHORD, STATIONS.overview.fitWidth!, STATIONS.overview.fov, 16 / 10);
    expect(distance).toBeLessThanOrEqual(ICE_CAMERA_LIMITS.maxDistance);
    expect(pose.position[2]).toBeGreaterThan(ICE_LOOK_AT[2] + 40);
    expect(pose.position[1]).toBeGreaterThan(36);
    expect(pose.position[1]).toBeLessThanOrEqual(ICE_CAMERA_BOX.max[1]);
    expect(pose.position[2]).toBeLessThanOrEqual(ICE_CAMERA_BOX.max[2]);
  });

  it("lets the look-at reach mountain camp and research island", () => {
    const town = clampLookTarget(...ICE_LOOK_AT);
    expect(town).toEqual(ICE_LOOK_AT);
    const pines = clampLookTarget(31, 2.4, -45);
    expect(pines[2]).toBe(-45);
    expect(pines[2]).toBeGreaterThan(ICE_LOOK_BOX.min[2]);
    const camp = clampLookTarget(-86, 2.4, 1);
    expect(camp[0]).toBe(-86);
    const island = clampLookTarget(92, 2.4, 68);
    expect(island[0]).toBe(92);
    const left = clampCameraPosition(-150, 64, 160, town[2]);
    expect(left[0]).toBeLessThan(-120);
    const right = clampCameraPosition(190, 64, 160, town[2]);
    expect(right[0]).toBeGreaterThan(160);
    // Free azimuth: an oblique district pose north of the town look-at is kept as posed.
    const oblique = clampCameraPosition(118, 56, 15, -22, ICE_CAMERA_BOX, ICE_CAMERA_LIMITS.southOnly);
    expect(oblique).toEqual([118, 56, 15]);
  });
});
