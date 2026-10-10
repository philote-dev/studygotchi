import { describe, expect, it } from "vitest";
import { creatureMeta, creatureUrl } from "@/lib/world/roster";
import { CREATURE_DISPLAY_HEIGHT } from "@/lib/world/creature-scale";
import { ICE_TOWN_LAYOUT, creatureViewportFraction, districtChord } from "../layout/biome-layout";
import { STATIONS, districtStationAzimuth } from "../camera/stations";
import { ICE_CAST, ICE_LAND_SCALE } from "./OurWalkers";
import { WALKER_DISTRICTS } from "./parade";

describe("ice walkers", () => {
  it("keeps a buddy at or above 6 % of the viewport at the polished district stations", () => {
    // Mirrors CameraRig.iceSubject: chord measured from the district's stationAzimuth (lab
    // contract), clamp 72 (48 for the station island), pull-south on forest / glacier.
    const height = CREATURE_DISPLAY_HEIGHT * ICE_LAND_SCALE;
    expect(height).toBeLessThan(4.5);
    for (const id of ["harbour", "town", "lake", "forest", "glacier", "station"]) {
      const district = ICE_TOWN_LAYOUT.districts.find((entry) => entry.id === id)!;
      const pull = id === "forest" || id === "glacier" ? 22 : 0;
      const chord = Math.min(id === "station" ? 48 : 72, districtChord(district, districtStationAzimuth(district)) + pull * 0.4);
      const fraction = creatureViewportFraction(height, chord, STATIONS.district.fitWidth ?? 0.75, 16 / 10, STATIONS.district.pitchDeg);
      expect(fraction, id).toBeGreaterThanOrEqual(0.06);
    }
  });

  it("places our roster and guest bodies, not stock hats", () => {
    expect(ICE_CAST).toHaveLength(9);
    expect(ICE_CAST.map((member) => member.id)).toEqual(
      expect.arrayContaining(["blob-ice-2", "tripo-creature-18", "gobkit-minion-c02", "kenney-penguin"]),
    );
    expect(ICE_CAST.map((member) => member.district)).toEqual([...WALKER_DISTRICTS]);
    for (const member of ICE_CAST) {
      expect(creatureMeta(member.id)).toBeTruthy();
      expect(creatureUrl(member.id)).toMatch(/^\/assets\/creatures\//);
    }
  });
});
