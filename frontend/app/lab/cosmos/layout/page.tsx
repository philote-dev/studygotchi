import { LayoutLab, type LayoutLabInitial } from "@/components/lab/cosmos/layout/LayoutLab";
import { LabNav } from "@/components/lab/gallery/LabNav";
import type { CourseSetSize } from "@/components/lab/cosmos/layout/fake-courses";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Dev lab, not product UI: the outermost zone of the scale ladder as a
 * navigable map. Not linked from the product nav and outside the auth matcher.
 *
 *   /lab/cosmos/layout?seed=hurt&theme=dark&courses=12
 *   /lab/cosmos/layout?guides=1&orbit=1&chrome=0        (orbit video capture)
 *   /lab/cosmos/layout?select=18.06                    (pre-selected bead)
 */
export default async function CosmosLayoutPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const courses = Number(first(params.courses) ?? 12);
  const orbit = first(params.orbit);
  const cell = Number(first(params.cell) ?? 2);
  const initial: LayoutLabInitial = {
    seed: first(params.seed) ?? "hurt",
    theme: first(params.theme) === "light" ? "light" : "dark",
    size: ([3, 6, 12] as const).includes(courses as CourseSetSize) ? (courses as CourseSetSize) : 12,
    guides: first(params.guides) === "1",
    orbit: orbit === undefined || orbit === "" ? 0 : orbit === "1" ? 0.5 : Number.isFinite(Number(orbit)) ? Number(orbit) : 0,
    chrome: first(params.chrome) !== "0",
    cell: Number.isFinite(cell) && cell >= 1 && cell <= 4 ? Math.round(cell) : 2,
    select: first(params.select) ?? null,
  };
  return (
    <>
      <LabNav />
      <LayoutLab initial={initial} />
    </>
  );
}
