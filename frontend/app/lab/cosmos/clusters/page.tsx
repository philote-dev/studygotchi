import { LabNav } from "@/components/lab/gallery/LabNav";
import { ClustersLab, type ClustersLabInitial } from "@/components/lab/cosmos/clusters/ClustersLab";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function num(v: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = v === undefined || v === "" ? Number.NaN : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/**
 * Dev lab, not product UI: the tuning surface for the product's galaxy
 * clusters (version C, decided 2026-10-13): `GalaxyLayer` itself with this
 * lab's placement tabs, blob sliders and flag modes, the settled synthetic
 * course graphs as its graph source (the product settles the real ones). Not
 * linked from the product nav and outside the auth matcher.
 *
 *   /lab/cosmos/clusters?theme=dark&seed=whirlpool                 eight courses at L 3.0, mixed placement, hover flags
 *   /lab/cosmos/clusters?placement=arms                             the generator's ridge placement (revert option)
 *   /lab/cosmos/clusters?placement=halo                             every blob off the disc plane
 *   /lab/cosmos/clusters?flags=all&courses=12                        a flag on every course (the collision rule)
 *   /lab/cosmos/clusters?flags=current                              the current course's flag stays up
 *   /lab/cosmos/clusters?hover=18.06&t=20000&chrome=0               frozen frame with 18.06's flag up (captures)
 *   /lab/cosmos/clusters?condense=0.5                               current blob halfway into its core glow
 *   /lab/cosmos/clusters?blob=1.4&core=0.35&depth=0.6&threads=3     blob scale, Plummer core, depth, threads
 *   /lab/cosmos/clusters?focus=current&beadPx=150&box=480           the current blob centred, its bead 150 px wide, in a 480 px box
 *   /lab/cosmos/clusters?box=112&disc=1                             the 112 px corner (disc fills the box)
 *   /lab/cosmos/clusters?standins=1                                 every course as its seeded stand-in (the product's first frame)
 */
export default async function CosmosClustersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const t = first(params.t);
  const placement = first(params.placement);
  const flags = first(params.flags);
  const hover = first(params.hover);
  const beadPx = first(params.beadPx);
  const box = first(params.box);
  const disc = first(params.disc);
  const initial: ClustersLabInitial = {
    theme: first(params.theme) === "light" ? "light" : "dark",
    seed: first(params.seed) ?? "whirlpool",
    L: num(first(params.L), 3, 2.6, 3.2),
    condense: num(first(params.condense), 0, 0, 1),
    nodeWeight: num(first(params.nodes), 0, 0, 1),
    courses: first(params.courses) === "12" ? 12 : 8,
    chrome: first(params.chrome) !== "0",
    t: t !== undefined && t !== "" && Number.isFinite(Number(t)) ? Number(t) : null,
    placement: placement === "halo" ? "halo" : placement === "arms" ? "arms" : "mixed",
    blobScale: num(first(params.blob), 1.4, 1, 1.8),
    blobCore: num(first(params.core), 0.35, 0.2, 0.6),
    blobDepth: num(first(params.depth), 0.6, 0.3, 1),
    threads: Math.round(num(first(params.threads), 0, 0, 5)),
    coreGlow: num(first(params.coreGlow), 0.6, 0.3, 1),
    depthDim: num(first(params.farDim), 0.5, 0, 0.7),
    flags: flags === "all" ? "all" : flags === "current" ? "current" : "hover",
    hover: hover && hover !== "" ? hover : null,
    focus: first(params.focus) === "current" ? "current" : null,
    beadPx: beadPx !== undefined && Number.isFinite(Number(beadPx)) && Number(beadPx) > 0 ? Number(beadPx) : null,
    box: box !== undefined && Number.isFinite(Number(box)) && Number(box) > 0 ? Math.round(Number(box)) : null,
    disc: disc !== undefined && Number.isFinite(Number(disc)) && Number(disc) > 0 ? Math.min(4, Number(disc)) : null,
    standIns: first(params.standins) === "1",
  };
  return (
    <>
      <LabNav theme={initial.theme} />
      <ClustersLab initial={initial} />
    </>
  );
}
