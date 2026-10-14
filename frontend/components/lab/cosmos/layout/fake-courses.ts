import type { LayoutCourse, LayoutFriend } from "./galaxy-layout";

/**
 * A plausible term for the lab: MIT-style numbers, seven subject areas, three
 * courses with worlds (the three biomes), three archived. Order matters: the
 * 3 / 6 / 12 controls take prefixes, so the first three already cover the
 * current course, a world course and a second subject.
 */
export const FAKE_COURSES: readonly LayoutCourse[] = [
  { id: "8.223", name: "8.223 Classical Mechanics II", subject: "physics", concepts: 64, mastery: 0.62, hasWorld: true, archived: false, current: true },
  { id: "18.06", name: "18.06 Linear Algebra", subject: "math", concepts: 52, mastery: 0.78, hasWorld: true, archived: false, current: false },
  { id: "21G.401", name: "21G.401 Korean I", subject: "language", concepts: 90, mastery: 0.41, hasWorld: false, archived: false, current: false },
  { id: "6.1010", name: "6.1010 Fundamentals of Programming", subject: "cs", concepts: 48, mastery: 0.86, hasWorld: true, archived: false, current: false },
  { id: "8.044", name: "8.044 Statistical Physics I", subject: "physics", concepts: 40, mastery: 0.33, hasWorld: false, archived: false, current: false },
  { id: "18.100A", name: "18.100A Real Analysis", subject: "math", concepts: 36, mastery: 0.55, hasWorld: false, archived: false, current: false },
  { id: "6.1210", name: "6.1210 Algorithms", subject: "cs", concepts: 44, mastery: 0.22, hasWorld: false, archived: false, current: false },
  { id: "21W.021", name: "21W.021 Writing and Experience", subject: "humanities", concepts: 18, mastery: 0.7, hasWorld: false, archived: false, current: false },
  { id: "14.01", name: "14.01 Microeconomics", subject: "economics", concepts: 30, mastery: 0.48, hasWorld: false, archived: false, current: false },
  { id: "7.012", name: "7.012 Introductory Biology", subject: "science", concepts: 58, mastery: 0.9, hasWorld: false, archived: true, current: false },
  { id: "5.111", name: "5.111 Principles of Chemical Science", subject: "science", concepts: 50, mastery: 0.83, hasWorld: false, archived: true, current: false },
  { id: "24.00", name: "24.00 Problems of Philosophy", subject: "humanities", concepts: 22, mastery: 0.95, hasWorld: false, archived: true, current: false },
];

export const FAKE_FRIENDS: readonly LayoutFriend[] = [
  { id: "mina", name: "Mina's galaxy" },
  { id: "theo", name: "Theo's galaxy" },
  { id: "yuki", name: "Yuki's galaxy" },
];

export type CourseSetSize = 3 | 6 | 12;

/** Prefix of the term plus a friend count that grows with it (1 / 2 / 3). */
export function courseSet(size: CourseSetSize): { courses: LayoutCourse[]; friends: LayoutFriend[] } {
  const courses = FAKE_COURSES.slice(0, size).map((c) => ({ ...c }));
  // The 6-course set still needs a halo: archive the last one so globulars appear at every size above 3.
  if (size === 6) courses[5] = { ...courses[5], archived: true };
  const friends = FAKE_FRIENDS.slice(0, size === 3 ? 1 : size === 6 ? 2 : 3).map((f) => ({ ...f }));
  return { courses, friends };
}
