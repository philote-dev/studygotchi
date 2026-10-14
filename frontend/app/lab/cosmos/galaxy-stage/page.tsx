import { LabNav } from "@/components/lab/gallery/LabNav";
import { DITHER_MODE, type DitherMode } from "@/lib/light";
import { GALAXY_HERO_SIZE } from "@/components/stage/layers/galaxy/galaxy-layer-model";
import { GalaxyStagePreview, type GalaxyStageInitial } from "./GalaxyStagePreview";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function num(v: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = v === undefined || v === "" ? Number.NaN : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/**
 * Dev lab, not product UI: the stage's `GalaxyLayer` alone on its own
 * transparent stage canvas (same composer, camera and uniforms as the
 * product stage) with a fake course list, to prove S3-1 before the director
 * wires the layer into the registry.
 *
 *   /lab/cosmos/galaxy-stage?seed=whirlpool&theme=dark            six courses, Bayer 8, fade 1
 *   /lab/cosmos/galaxy-stage?theme=light&fade=0.5                  light sky, half fade
 *   /lab/cosmos/galaxy-stage?light=ign&courses=12&current=18.06    IGN grain, the full term, ring on 18.06
 *   /lab/cosmos/galaxy-stage?t=20000&chrome=0                      frozen frame, no chrome (captures)
 *   /lab/cosmos/galaxy-stage?backing=1                             opaque sky backing: the lab canvas's linear composite
 */
export default async function GalaxyStagePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const light = first(params.light);
  const courses = first(params.courses);
  const t = first(params.t);
  const initial: GalaxyStageInitial = {
    seed: first(params.seed) ?? "whirlpool",
    theme: first(params.theme) === "light" ? "light" : "dark",
    fade: num(first(params.fade), 1, 0, 1),
    size: num(first(params.size), GALAXY_HERO_SIZE, 0.1, 1.2),
    lightModel: light !== undefined && light in DITHER_MODE ? (light as DitherMode) : "bayer8",
    courses: courses === "3" ? 3 : courses === "12" ? 12 : 6,
    current: first(params.current) ?? null,
    chrome: first(params.chrome) !== "0",
    t: t !== undefined && t !== "" && Number.isFinite(Number(t)) ? Number(t) : null,
    backing: first(params.backing) === "1",
  };
  return (
    <>
      <LabNav theme={initial.theme} />
      <GalaxyStagePreview initial={initial} />
    </>
  );
}
