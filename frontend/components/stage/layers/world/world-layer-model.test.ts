import { describe, expect, it } from "vitest";
import { cloudDeckAt } from "@/lib/stage/hop";
import { RUNG_L } from "@/lib/stage/rungs";
import {
  ICE_TOWN_STAGE_GRAIN,
  OWN_CANVAS_BIOMES,
  STAGE_WORLD_BIOMES,
  planetFromWorldFadeAt,
  stageHostsBiome,
  worldPassFadeAt,
} from "./world-layer-model";

describe("world layer model (S4-1, permanent since gate 4)", () => {
  it("hosts ice-town through the stage unconditionally; every other developed biome keeps its own canvas", () => {
    expect([...STAGE_WORLD_BIOMES]).toEqual(["ice-town"]);
    expect(stageHostsBiome("ice-town")).toBe(true);
    for (const biome of OWN_CANVAS_BIOMES) expect(stageHostsBiome(biome)).toBe(false);
    expect(stageHostsBiome("island")).toBe(false);
    expect(OWN_CANVAS_BIOMES).toHaveLength(6);
  });

  it("carries the ice land's own 2 px grain with its edge strengths", () => {
    expect(ICE_TOWN_STAGE_GRAIN.pixelSize).toBe(2);
    expect(ICE_TOWN_STAGE_GRAIN.normalEdgeStrength).toBeGreaterThan(0);
    expect(ICE_TOWN_STAGE_GRAIN.depthEdgeStrength).toBeGreaterThan(0);
  });

  it("the world pass is fully visible at rest on the world rung and up to the cloud deck, gone by 0.68", () => {
    expect(worldPassFadeAt(RUNG_L.world)).toBe(1);
    expect(worldPassFadeAt(0.5)).toBe(1);
    expect(worldPassFadeAt(0.59)).toBeCloseTo(0.5, 5);
    expect(worldPassFadeAt(0.68)).toBe(0);
    expect(worldPassFadeAt(0.75)).toBe(0);
    expect(worldPassFadeAt(RUNG_L.planet)).toBe(0);
    expect(worldPassFadeAt(RUNG_L.galaxy)).toBe(0);
  });

  it("the planet pass does not render while L <= 0.5 and is whole from 0.68 up", () => {
    expect(planetFromWorldFadeAt(RUNG_L.world)).toBe(0);
    expect(planetFromWorldFadeAt(0.5)).toBe(0);
    expect(planetFromWorldFadeAt(0.59)).toBeCloseTo(0.5, 5);
    expect(planetFromWorldFadeAt(0.68)).toBe(1);
    expect(planetFromWorldFadeAt(RUNG_L.planet)).toBe(1);
    expect(planetFromWorldFadeAt(RUNG_L.constellation)).toBe(1);
    expect(planetFromWorldFadeAt(RUNG_L.galaxy)).toBe(1);
  });

  it("both swaps complete under the whole cloud deck (the mask covers every mixed frame)", () => {
    for (let L = 0; L <= 1; L += 0.005) {
      const w = worldPassFadeAt(L);
      const p = planetFromWorldFadeAt(L);
      const mixed = (w > 0 && w < 1) || (p > 0 && p < 1) || (w > 0 && p > 0);
      if (mixed) expect(cloudDeckAt(L), `L ${L.toFixed(3)}`).toBe(1);
    }
    expect(cloudDeckAt(0)).toBe(0);
    expect(cloudDeckAt(1)).toBe(0);
  });
});
