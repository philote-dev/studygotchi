import { CosmosGalaxyLab, type AbLayout, type AbSize, type CosmosGalaxyInitial } from "@/components/lab/cosmos/galaxy/CosmosGalaxyLab";
import { LabNav } from "@/components/lab/gallery/LabNav";
import { featuresFromParam } from "@/lib/galaxy/points";
import { DITHER_MODE, type DitherMode } from "@/components/lab/cosmos/shared/light/glow.glsl";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Dev lab, not product UI: the lab galaxy (A) next to the polished fork (B),
 * same seed, same clock, one toggle per improvement.
 *
 *   /lab/cosmos/galaxy?seed=whirlpool&theme=dark                 A | B, everything on
 *   /lab/cosmos/galaxy?layout=b&on=core,dust&size=corner         B alone, two improvements, 112 px read
 *   /lab/cosmos/galaxy?layout=split&on=none&t=20000&chrome=0     frozen frame, no chrome (captures)
 *   /lab/cosmos/galaxy?light=bands                               the lab's hard bands instead of the dithered light model
 */
export default async function CosmosGalaxyPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const layout = first(params.layout);
  const size = first(params.size);
  const t = first(params.t);
  const cell = first(params.cell);
  const light = first(params.light);
  const initial: CosmosGalaxyInitial = {
    seed: first(params.seed) ?? "whirlpool",
    theme: first(params.theme) === "light" ? "light" : "dark",
    layout: layout === "a" || layout === "b" ? (layout as AbLayout) : "split",
    size: size === "corner" ? ("corner" as AbSize) : "hero",
    features: featuresFromParam(first(params.on)),
    lightModel: light !== undefined && light in DITHER_MODE ? (light as DitherMode) : "bayer8",
    chrome: first(params.chrome) !== "0",
    t: t !== undefined && t !== "" && Number.isFinite(Number(t)) ? Number(t) : null,
    cell: cell !== undefined && Number.isFinite(Number(cell)) ? Math.min(4, Math.max(1, Number(cell))) : 2,
  };
  return (
    <>
      <LabNav />
      <CosmosGalaxyLab initial={initial} />
    </>
  );
}
