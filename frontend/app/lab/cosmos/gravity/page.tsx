import { GravityLab, type GravityBeat, type GravityLabInitial } from "@/components/lab/cosmos/gravity/GravityLab";
import { LabNav } from "@/components/lab/gallery/LabNav";
import type { GravityView } from "@/components/lab/cosmos/gravity/GravityScene";

const VIEWS: readonly GravityView[] = ["all", "blackhole", "whitehole", "wormhole"];
const BEATS: readonly GravityBeat[] = ["mastered", "feed", "birth", "traverse"];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function num(v: string | undefined): number | null {
  return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
}

/**
 * Dev lab, not product UI: black hole v2, white hole and wormhole on one
 * lensed star field. Not linked from the product nav and outside the auth matcher.
 *
 *   /lab/cosmos/gravity?view=all&seed=gargantua&theme=dark
 *   /lab/cosmos/gravity?view=blackhole&size=32&chrome=0           (tiny read)
 *   /lab/cosmos/gravity?view=whitehole&beat=birth&t=300&chrome=0  (frozen frame of a beat)
 */
export default async function GravityLabPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const viewParam = first(params.view);
  const beatParam = first(params.beat);
  const jets = first(params.jets);
  const cell = num(first(params.cell));
  const initial: GravityLabInitial = {
    view: VIEWS.includes(viewParam as GravityView) ? (viewParam as GravityView) : "all",
    seed: first(params.seed) ?? "gargantua",
    theme: first(params.theme) === "light" ? "light" : "dark",
    cell: cell !== null ? Math.min(4, Math.max(1, Math.round(cell))) : 2,
    size: num(first(params.size)),
    tilt: num(first(params.tilt)),
    feed: num(first(params.feed)),
    jets: jets === undefined ? null : jets === "1",
    lens: num(first(params.lens)),
    swirl: num(first(params.swirl)),
    intensity: num(first(params.intensity)),
    beat: BEATS.includes(beatParam as GravityBeat) ? (beatParam as GravityBeat) : null,
    t: num(first(params.t)),
    chrome: first(params.chrome) !== "0",
  };
  return (
    <>
      <LabNav />
      <GravityLab initial={initial} />
    </>
  );
}
