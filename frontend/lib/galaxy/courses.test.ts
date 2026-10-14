import { describe, expect, it } from "vitest";
import type { CourseSummary } from "@/lib/identity";
import { beadLabel, conceptCountFromStats, galaxyCoursesFromSummaries, masteryFromStats } from "./courses";
import { generateGalaxyLayout, normaliseCourses } from "./layout";

const SANDBOX: CourseSummary[] = [
  { id: "c-8223", name: "Classical Mechanics II", code: "8.223", term: "Spring 2026" },
  { id: "c-61400", name: "Computability and Complexity Theory", code: "6.1400", term: "Spring 2026" },
  { id: "c-61210", name: "Introduction to Algorithms", code: "6.1210", term: "Spring 2026" },
  { id: "c-1806", name: "Linear Algebra", code: "18.06", term: "Spring 2026" },
  { id: "c-1803", name: "Differential Equations", code: "18.03", term: "Spring 2026" },
  { id: "c-8022", name: "Physics II: Electricity and Magnetism", code: "8.022", term: "Spring 2026" },
  { id: "c-16c20", name: "Numerical Methods and Computation", code: "16.C20", term: "Spring 2026" },
];

const STATS: Record<string, { reached: number; total: number }> = {
  "c-8223": { reached: 20, total: 64 },
  "c-61400": { reached: 40, total: 50 },
  "c-61210": { reached: 10, total: 120 },
  "c-1806": { reached: 70, total: 70 },
};

describe("galaxy course mapping", () => {
  it("maps the identity's courses to GalaxyCourse: code, title, size from stats, mastery, world, recency", () => {
    const opened: Record<string, number> = { "c-1806": 200, "c-8223": 300 };
    const courses = galaxyCoursesFromSummaries(SANDBOX, {
      stats: (id) => STATS[id],
      lastOpenedAt: (id) => opened[id] ?? null,
    });
    expect(courses).toHaveLength(7);
    expect(courses[0]).toEqual({
      id: "c-8223",
      code: "8.223",
      title: "Classical Mechanics II",
      subject: null,
      conceptCount: 64,
      mastery: 20 / 64,
      hasWorld: true,
      archived: false,
      lastOpenedAt: 300,
    });
    // Unknown stats: the smallest bead, no world yet, mastery 0.
    const unknown = courses.find((c) => c.id === "c-1803")!;
    expect(unknown.conceptCount).toBe(1);
    expect(unknown.mastery).toBe(0);
    expect(unknown.hasWorld).toBe(false);
    expect(unknown.lastOpenedAt).toBeNull();
    // The caller can widen hasWorld (the sandbox gives every course a biome).
    expect(galaxyCoursesFromSummaries(SANDBOX, { hasWorld: () => true }).every((c) => c.hasWorld)).toBe(true);
  });

  it("subjects come from the code prefix through the layout's normaliser; a code-less course uses its name", () => {
    const courses = galaxyCoursesFromSummaries([...SANDBOX, { id: "x", name: "Studio", code: null, term: null }]);
    const norm = normaliseCourses(courses, null);
    expect(norm.find((c) => c.id === "c-8223")!.subject).toBe("8");
    expect(norm.find((c) => c.id === "c-16c20")!.subject).toBe("16");
    expect(norm.find((c) => c.id === "c-61400")!.subject).toBe("6");
    expect(norm.find((c) => c.id === "x")!.subject).toBe("STUDIO");
    expect(beadLabel(courses.find((c) => c.id === "x")!)).toBe("Studio");
    expect(beadLabel(courses[0])).toBe("8.223");
  });

  it("recency picks the current bead when no id is given; an explicit current id wins; duplicates collapse", () => {
    const opened: Record<string, number> = { "c-1806": 200, "c-8223": 300 };
    const courses = galaxyCoursesFromSummaries([...SANDBOX, SANDBOX[0]], { stats: (id) => STATS[id], lastOpenedAt: (id) => opened[id] ?? null });
    expect(courses).toHaveLength(7);
    expect(generateGalaxyLayout({ courses, seed: 7 }).current?.courseId).toBe("c-8223");
    expect(generateGalaxyLayout({ courses, currentCourseId: "c-61210", seed: 7 }).current?.courseId).toBe("c-61210");
    const layout = generateGalaxyLayout({ courses, currentCourseId: "c-61210", seed: 7 });
    expect(layout.beads).toHaveLength(7);
    expect(layout.globulars).toHaveLength(0);
  });

  it("stats helpers clamp and tolerate garbage", () => {
    expect(masteryFromStats(null)).toBe(0);
    expect(masteryFromStats({ reached: 5, total: 0 })).toBe(0);
    expect(masteryFromStats({ reached: 9, total: 4 })).toBe(1);
    expect(masteryFromStats({ reached: Number.NaN, total: 4 })).toBe(0);
    expect(conceptCountFromStats(undefined)).toBe(1);
    expect(conceptCountFromStats({ reached: 0, total: 12.4 })).toBe(12);
  });
});
