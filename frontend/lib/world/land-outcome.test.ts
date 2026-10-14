import { describe, expect, it } from "vitest";
import { mockWorldForCourse } from "@/lib/api";
import { describeChanges, type WorldChange } from "./adapter";
import { DEMO_COURSES } from "./demo-courses";
import {
  CONFETTI_COUNT,
  CONFETTI_DURATION_S,
  buildConfettiPieces,
  confettiBurstMs,
  landOutcome,
} from "./land-outcome";
import type { WorldResponse } from "./types";

const change = (kind: WorldChange["kind"], concept_id = `c-${kind}`): WorldChange => ({ concept_id, kind });

describe("landOutcome", () => {
  it("storms on a resident going weak and heals on a recovery or a mastery", () => {
    expect(landOutcome([change("explode")])).toBe("fail");
    expect(landOutcome([change("recover")])).toBe("pass");
    expect(landOutcome([change("master")])).toBe("pass");
  });

  it("is not news when only spots changed", () => {
    expect(landOutcome([])).toBeNull();
    expect(landOutcome([change("sprout"), change("grow"), change("landmark"), change("upgrade"), change("hatch"), change("fade")])).toBeNull();
  });

  it("lets a failure outrank a pass in the same payload", () => {
    expect(landOutcome([change("recover", "a"), change("explode", "b")])).toBe("fail");
    expect(landOutcome([change("master", "a"), change("recover", "b")])).toBe("pass");
  });

  it("plays the catastrophe from a real explode change in the mock payload, then heals on recover", () => {
    const before = mockWorldForCourse(DEMO_COURSES[0].id);
    const hatched = before.regions.find((region) => region.creature_state !== "unhatched" && region.creature_state !== "weak");
    expect(hatched).toBeDefined();
    const weak: WorldResponse = {
      ...before,
      regions: before.regions.map((region) =>
        region.concept_id === hatched!.concept_id ? { ...region, creature_state: "weak" as const } : region,
      ),
    };
    expect(landOutcome(describeChanges(before, weak))).toBe("fail");
    expect(landOutcome(describeChanges(weak, before))).toBe("pass");
    // The first paint is not a change, so arriving on a land never storms.
    expect(landOutcome(describeChanges(null, weak))).toBeNull();
  });
});

describe("confetti", () => {
  it("fills the screen with a long burst", () => {
    const pieces = buildConfettiPieces();
    expect(CONFETTI_COUNT).toBeGreaterThanOrEqual(200);
    expect(CONFETTI_DURATION_S).toBeGreaterThanOrEqual(4);
    expect(pieces).toHaveLength(CONFETTI_COUNT);
    expect(Math.min(...pieces.map((piece) => piece.left))).toBeLessThan(5);
    expect(Math.max(...pieces.map((piece) => piece.left))).toBeGreaterThan(90);
    expect(Math.max(...pieces.map((piece) => piece.duration))).toBeGreaterThan(4);
  });

  it("knows when the last piece has landed", () => {
    const ms = confettiBurstMs();
    const longest = Math.max(...buildConfettiPieces().map((piece) => piece.delay + piece.duration));
    expect(ms).toBeGreaterThan(longest * 1000);
    expect(ms).toBeLessThan((longest + 1) * 1000);
  });
});
