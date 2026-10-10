import { describe, expect, it } from "vitest";
import { DEMO_HERO_CODE } from "./world/demo-courses";
import {
  STAGE_MS,
  leaveDurationMs,
  leavePhaseAt,
  needsBiomeRise,
  productStage,
  productStageFromHref,
} from "./stage-motion";

describe("one motion language for stage hops", () => {
  it("maps real routes onto landing, planet, biome, and information", () => {
    expect(productStage("/")).toBe("landing");
    expect(productStage("/earth")).toBe("planet");
    expect(productStage("/earth", "")).toBe("planet");
    expect(productStage("/earth", `land=${DEMO_HERO_CODE}`)).toBe("biome");
    expect(productStage("/knowledge")).toBe("information");
    expect(productStageFromHref("/knowledge?concept=abc")).toBe("information");
    expect(productStageFromHref( `/earth?land=${DEMO_HERO_CODE}`)).toBe("biome");
  });

  it("rises out of a biome before the planet leaves right for Information", () => {
    expect(needsBiomeRise("biome", "information", false)).toBe(true);
    expect(leaveDurationMs("biome", "information", false)).toBe(STAGE_MS.aperture * 2);
    expect(leavePhaseAt(0, "biome", "information", false)).toBe("rise");
    expect(leavePhaseAt(STAGE_MS.aperture - 1, "biome", "information", false)).toBe("rise");
    expect(leavePhaseAt(STAGE_MS.aperture, "biome", "information", false)).toBe("leave");
    expect(leavePhaseAt(STAGE_MS.aperture * 2, "biome", "information", false)).toBe("done");
  });

  it("sends planet → Information on a single leave beat, no extra rise", () => {
    expect(needsBiomeRise("planet", "information", false)).toBe(false);
    expect(leaveDurationMs("planet", "information", false)).toBe(STAGE_MS.aperture);
    expect(leavePhaseAt(0, "planet", "information", false)).toBe("leave");
    expect(leavePhaseAt(STAGE_MS.aperture, "planet", "information", false)).toBe("done");
  });

  it("treats Information → Courses as the inverse leave, not a different movie", () => {
    expect(leaveDurationMs("information", "planet", false)).toBe(STAGE_MS.aperture);
    expect(leavePhaseAt(0, "information", "planet", false)).toBe("leave");
    expect(productStageFromHref("/earth")).toBe("planet");
  });

  it("does not treat biome → planet as a page-level rise; Information hops stay leave-only the other way", () => {
    expect(needsBiomeRise("biome", "planet", false)).toBe(false);
    expect(leaveDurationMs("biome", "planet", false)).toBe(STAGE_MS.aperture);
    expect(leavePhaseAt(0, "biome", "planet", false)).toBe("leave");
    expect(needsBiomeRise("information", "biome", false)).toBe(false);
    expect(leaveDurationMs("information", "biome", false)).toBe(STAGE_MS.aperture);
  });

  it("snaps every hop when motion is reduced", () => {
    expect(leaveDurationMs("biome", "information", true)).toBe(STAGE_MS.snap);
    expect(needsBiomeRise("biome", "information", true)).toBe(false);
    expect(leavePhaseAt(0, "biome", "information", true)).toBe("leave");
  });
});
