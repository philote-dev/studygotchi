import { describe, expect, it } from "vitest";
import { STATIONS as frontier } from "./frontier-town/camera/stations";
import { STATIONS as coastal } from "./coastal-ruins/camera/stations";
import { STATIONS as jungle } from "./jungle-forest-village/camera/stations";
import { STATIONS as meadow } from "./medieval-meadow-kingdom/camera/stations";
import { STATIONS as nordic } from "./nordic-volcanic-highlands/camera/stations";
import { STATIONS as ice } from "./ice-town/camera/stations";

const BIOMES = { ice, frontier, coastal, jungle, meadow, nordic };

describe("local biome camera contract", () => {
  it.each(Object.entries(BIOMES))(
    "%s stays south/front with the required pitch and yaw",
    (_name, stations) => {
      for (const station of Object.values(stations)) {
        expect(station.pitchDeg).toBeGreaterThanOrEqual(34);
        expect(station.pitchDeg).toBeLessThanOrEqual(40);
        expect(Math.abs(station.azimuthDeg)).toBeLessThanOrEqual(35);
      }
    },
  );
});
