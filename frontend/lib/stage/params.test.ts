import { describe, expect, it } from "vitest";
import { restRungForRoute, STAGE_PARAMS_AT_REST, stageParamsFromSearch, stagePerfRequested, stageRungFromSearch } from "./params";

describe("stage URL parameters", () => {
  it("starts a cold load at rest on the route's rung: /knowledge the constellation, ?land= the world, else the planet", () => {
    expect(restRungForRoute("/knowledge", "")).toBe("constellation");
    expect(restRungForRoute("/knowledge", "?rung=galaxy")).toBe("galaxy");
    expect(restRungForRoute("/knowledge/x", "?stage=twin")).toBe("constellation");
    expect(restRungForRoute("/earth", "")).toBe("planet");
    expect(restRungForRoute("/earth", "?land=8.223")).toBe("world");
    expect(restRungForRoute("/earth", "?rung=constellation")).toBe("constellation");
    expect(restRungForRoute("/", "?rung=galaxy")).toBe("planet");
  });

  it("reads ?perf=1 and ?rung=<stop>", () => {
    expect(stagePerfRequested("?perf=1")).toBe(true);
    expect(stagePerfRequested("perf=1&rung=galaxy")).toBe(true);
    expect(stagePerfRequested("?perf=0")).toBe(false);
    expect(stagePerfRequested(null)).toBe(false);
    expect(stageRungFromSearch("?rung=galaxy")).toBe("galaxy");
    expect(stageRungFromSearch("rung=Planet")).toBe("planet");
    expect(stageRungFromSearch("?rung=world")).toBe("world");
    expect(stageRungFromSearch("?rung=moon")).toBeNull();
    expect(stageRungFromSearch(null)).toBeNull();
    expect(stageParamsFromSearch("?perf=1&rung=constellation")).toEqual({ perf: true, rung: "constellation" });
    expect(stageParamsFromSearch("")).toEqual(STAGE_PARAMS_AT_REST);
  });

  it("every former stage flag is inert (2026-10-13): ?stage= in any form changes nothing", () => {
    const rest = stageParamsFromSearch("");
    for (const q of [
      "?stage=twin",
      "?stage=galaxy,twin,world,hop",
      "?stage=notwin,nogalaxy,noworld,nohop",
      "?stage=twin=0&stage=galaxy=1",
      "?stage=nosky,sky=0,planet,noplanet,planet=0",
      "?stage=",
      "?stage=hop&stage=world",
    ]) {
      expect(stageParamsFromSearch(q), q).toEqual(rest);
    }
    // The two real parameters are read regardless of what rides along.
    expect(stageParamsFromSearch("?stage=nogalaxy&perf=1&rung=galaxy")).toEqual({ perf: true, rung: "galaxy" });
  });
});
