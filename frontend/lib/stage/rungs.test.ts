import { describe, expect, it } from "vitest";
import { RUNGS, RUNG_L, activeRung, clampL, nextRungForInformation, rungAt, rungForCourses, stepRung } from "./rungs";

describe("rung readout", () => {
  it("maps the four stops to world 0, planet 1, constellation 2, galaxy 3", () => {
    expect(RUNGS).toEqual(["world", "planet", "constellation", "galaxy"]);
    expect(RUNG_L).toEqual({ world: 0, planet: 1, constellation: 2, galaxy: 3 });
    expect(rungAt(0)).toBe("world");
    expect(rungAt(1.4)).toBe("planet");
    expect(rungAt(1.6)).toBe("constellation");
    expect(rungAt(3)).toBe("galaxy");
    expect(rungAt(7)).toBe("galaxy");
    expect(rungAt(-2)).toBe("world");
    expect(clampL(Number.NaN)).toBe(0);
    expect(clampL(3.5)).toBe(3);
  });

  it("steps along the ladder and clamps at both ends", () => {
    expect(stepRung("planet", 1)).toBe("constellation");
    expect(stepRung("planet", -1)).toBe("world");
    expect(stepRung("world", -1)).toBe("world");
    expect(stepRung("galaxy", 1)).toBe("galaxy");
  });

  it("holds the previous rung inside the hysteresis band and walks several rungs on a long hop", () => {
    expect(activeRung(1.55, "planet")).toBe("planet");
    expect(activeRung(1.6, "planet")).toBe("constellation");
    expect(activeRung(1.45, "constellation")).toBe("constellation");
    expect(activeRung(1.4, "constellation")).toBe("planet");
    expect(activeRung(3, "world")).toBe("galaxy");
    expect(activeRung(2, "constellation")).toBe("constellation");
  });
});

describe("Information: the ladder keyed to the active course", () => {
  it("climbs planet -> constellation -> galaxy and then stays on the galaxy", () => {
    const a = nextRungForInformation("planet", true);
    const b = nextRungForInformation(a, true);
    const c = nextRungForInformation(b, true);
    expect([a, b, c]).toEqual(["constellation", "galaxy", "galaxy"]);
  });

  it("goes nowhere from a planet with no course to open", () => {
    expect(nextRungForInformation("planet", false)).toBe("planet");
  });

  it("rises from a world straight to the constellation (the merged rise)", () => {
    expect(nextRungForInformation("world", true)).toBe("constellation");
  });
});

describe("Courses: always the planet", () => {
  it("lands on the planet locked on the constellation's course", () => {
    expect(rungForCourses("constellation", "c2")).toEqual({ rung: "planet", courseId: "c2" });
  });

  it("lands on the planet on the most recent course from the galaxy, or the default when there is none", () => {
    expect(rungForCourses("galaxy", "c1")).toEqual({ rung: "planet", courseId: "c1" });
    expect(rungForCourses("galaxy", null)).toEqual({ rung: "planet", courseId: null });
  });

  it("rises from a world to the planet on that world's course", () => {
    expect(rungForCourses("world", "c3")).toEqual({ rung: "planet", courseId: "c3" });
  });

  it("is a no-op move on the planet itself", () => {
    expect(rungForCourses("planet", "c1").rung).toBe("planet");
  });
});
