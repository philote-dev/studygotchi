import { ObjectsGallery, type GalleryInitial } from "@/components/lab/cosmos/objects/ObjectsGallery";
import { LabNav } from "@/components/lab/gallery/LabNav";
import type { Params } from "@/components/lab/cosmos/objects/lib/types";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function numberOr(v: string | undefined, fallback: number): number {
  return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback;
}

/**
 * Dev lab, not product UI: the space objects gallery (nebulae, remnants,
 * pulsars, comets, planets, binaries, clusters). Not linked from the product
 * nav and outside the auth matcher.
 *
 *   /lab/cosmos/objects?seed=orion&theme=dark
 *   /lab/cosmos/objects?focus=comet&chrome=0                      (one object large + 96 / 32 px previews)
 *   /lab/cosmos/objects?view=tiny                                 (every object at 32 / 48 / 96 px)
 *   /lab/cosmos/objects?focus=supernova&t=5000&beat=400&chrome=0  (frozen 400 ms into the supernova beat)
 *   /lab/cosmos/objects?focus=cluster&p.kind=globular            (any `p.<key>=` overrides a knob of the focused object)
 *   /lab/cosmos/objects?focus=comet&explain=1&speed=0.25          (labelled walkthrough overlay; comet and binary)
 *   /lab/cosmos/objects?focus=comet&explain=1&p.phase0=0.75&p.dir=1&t=7500   (perihelion at t = period / 4 with phase0 = 0.75)
 */
export default async function CosmosObjectsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const focus = first(sp.focus) ?? null;
  const t = first(sp.t);
  const beat = first(sp.beat);
  const frozenMs = t !== undefined && t !== "" && Number.isFinite(Number(t)) ? Number(t) : null;
  const params: Record<string, Params> = {};
  if (focus) {
    const p: Params = {};
    for (const [key, value] of Object.entries(sp)) {
      if (!key.startsWith("p.")) continue;
      const v = first(value);
      if (v === undefined) continue;
      p[key.slice(2)] = v !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
    }
    if (beat !== undefined && frozenMs !== null && Number.isFinite(Number(beat))) {
      p.beatAt = (frozenMs - Number(beat)) / 1000;
      p.stage = "remnant";
    }
    if (Object.keys(p).length) params[focus] = p;
  }
  const initial: GalleryInitial = {
    seed: first(sp.seed) ?? "orion",
    theme: first(sp.theme) === "light" ? "light" : "dark",
    focus,
    view: first(sp.view) === "tiny" ? "tiny" : first(sp.view) === "scale" ? "scale" : "grid",
    chrome: first(sp.chrome) !== "0",
    frozenMs,
    cute: numberOr(first(sp.cute), 0.5),
    intensity: numberOr(first(sp.intensity), 1),
    speed: numberOr(first(sp.speed), 1),
    cell: numberOr(first(sp.cell), 2),
    explain: first(sp.explain) === "1",
    params,
  };
  return (
    <>
      <LabNav />
      <ObjectsGallery initial={initial} />
    </>
  );
}
