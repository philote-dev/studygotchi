import { describe, expect, it } from "vitest";
import { STATIONS as frontier } from "./frontier-town/camera/stations";
import { STATIONS as coastal } from "./coastal-ruins/camera/stations";
import { STATIONS as jungle } from "./jungle-forest-village/camera/stations";
import { STATIONS as meadow } from "./medieval-meadow-kingdom/camera/stations";
import { STATIONS as nordic } from "./nordic-volcanic-highlands/camera/stations";
import { STATIONS as ice } from "./ice-town/camera/stations";

// The five sandbox biomes keep the diorama contract from frontend-biome-integration-handoff.md.
const DIORAMA_BIOMES = { frontier, coastal, jungle, meadow, nordic };

describe("local biome camera contract", () => {
  it.each(Object.entries(DIORAMA_BIOMES))(
    "%s stays south/front with the required pitch and yaw",
    (_name, stations) => {
      for (const station of Object.values(stations)) {
        expect(station.pitchDeg).toBeGreaterThanOrEqual(34);
        expect(station.pitchDeg).toBeLessThanOrEqual(40);
        expect(Math.abs(station.azimuthDeg)).toBeLessThanOrEqual(35);
      }
    },
  );

  // Ice (the shipped biome) uses the lab stations: SHIP-HANDOFF §6/§7, Philote 2026-10-10.
  it("ice uses the lab stations (pitch 18–36°, FOV 26, free azimuth)", () => {
    expect(ice.arrival.pitchDeg).toBe(30);
    expect(ice.overview.pitchDeg).toBe(36);
    expect(ice.district.pitchDeg).toBe(30);
    expect(ice.resident.pitchDeg).toBe(18);
    for (const station of Object.values(ice)) expect(station.fov).toBe(26);
  });
});
