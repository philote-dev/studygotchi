import { beforeEach, describe, expect, it } from "vitest";
import { emitStageEvent, onStageEvent, openCourseConstellation, resetStageEvents, type StageEvent } from "./events";

describe("stage events", () => {
  beforeEach(() => resetStageEvents());

  it("delivers to typed listeners in subscription order and reports the count", () => {
    const seen: string[] = [];
    onStageEvent("stage:open-course-constellation", (e) => seen.push(`a:${e.courseId}:${e.source}`));
    onStageEvent("stage:open-course-constellation", (e) => seen.push(`b:${e.courseId}`));
    expect(openCourseConstellation("8.223")).toBe(2);
    expect(seen).toEqual(["a:8.223:bead-click", "b:8.223"]);
  });

  it("unsubscribes, and emitting with no listeners is a no-op", () => {
    const seen: StageEvent[] = [];
    const off = onStageEvent("stage:open-course-constellation", (e) => seen.push(e));
    off();
    expect(emitStageEvent({ type: "stage:open-course-constellation", courseId: "x", source: "bead-click" })).toBe(0);
    expect(seen).toEqual([]);
  });

  it("a listener removed mid-dispatch still gets this event; later ones do not", () => {
    const seen: string[] = [];
    const offB = onStageEvent("stage:open-course-constellation", () => {
      seen.push("a");
      offB();
    });
    onStageEvent("stage:open-course-constellation", () => seen.push("b"));
    openCourseConstellation("x");
    openCourseConstellation("y");
    expect(seen).toEqual(["a", "b", "b"]);
  });
});
