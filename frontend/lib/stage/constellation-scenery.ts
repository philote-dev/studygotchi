/**
 * Seeded scenery for the constellation rung (S2-5): two to four of the far
 * sky's object kinds (nebula, planetary shell, open cluster, lensed smudges)
 * around the graph, never under it, its labels or the page's panels. Pure and
 * deterministic: same student seed, same viewport aspect, same graph box ->
 * same scenery.
 *
 * The graph is fitted to ~92 % of the limiting axis of the viewport, so the
 * free room is the frame's outer bands: objects hug the viewport edges (right,
 * bottom, top under the header, left beside the docks), may bleed off the
 * edge like the backdrop's, and are smaller and farther than the backdrop's
 * so they read as scenery beyond the sky, not as part of the graph. The
 * renderer (`components/stage/layers/constellation/ConstellationScenery.tsx`)
 * draws them with the sky layer's own object recipes and fades them with the
 * altitude model's constellation band (`clusterStars`). Nothing carries
 * meaning (Philote, 2026-10-11: scenery first).
 */
import { BACKDROP_SAFE_AREAS, boxesOverlap, objectBox, type BackdropKind, type Box, type EdgeSide, type ObjectEdge, type PlacedObject, type SafeArea } from "./placement";
import { mulberry32, pick, range, type Rng } from "./rng";

export type ConstellationPlacementRung = "constellation";

export interface ConstellationSceneryInput {
  seed: number;
  /** Viewport width / height (bucket it first with `bucketAspect`). */
  aspect: number;
  /** The graph's screen box, viewport fractions (labels included); the default is the fit's envelope. */
  graphBox?: Box;
  /** Extra boxes to stay clear of (panels, docks); the chrome safe areas are always included. */
  keepOut?: readonly Box[];
}

export interface ConstellationSceneryObject extends Omit<PlacedObject, "rung"> {
  rung: ConstellationPlacementRung;
}

export interface ConstellationScenery {
  seed: number;
  rung: ConstellationPlacementRung;
  aspect: number;
  graphBox: Box;
  objects: ConstellationSceneryObject[];
  rejected: { kind: BackdropKind; reason: "graph" | "chrome" | "scenery" | "viewport" }[];
}

/**
 * Where the fitted graph can reach: `fitTarget` pads the node bounds by 60 px
 * and fills 92 % of the limiting axis, labels overhang a little; the box
 * leaves the outer 5 % horizontally and 7 % vertically.
 */
export const CONSTELLATION_GRAPH_BOX: Readonly<Box> = { x0: 0.06, y0: 0.16, x1: 0.94, y1: 0.86 };

export const CONSTELLATION_SCENERY_LIMITS = {
  minObjects: 2,
  maxObjects: 4,
  /** Objects may bleed past the viewport edge by this much (fraction). */
  bleed: 0.1,
  /** Clearance kept from the graph box, chrome and other objects (viewport fraction). */
  margin: 0.012,
  /** Shrink steps (x 0.8) before a candidate is dropped. */
  shrinkSteps: 3,
  attempts: 40,
  /** Each object already on a side scales that side's weight by this. */
  sideRepeat: 0.45,
} as const;

interface KindSpec {
  kind: BackdropKind;
  /** Box height as a fraction of the viewport height: smaller than the backdrop's. */
  size: readonly [number, number];
  aspect: readonly [number, number];
  /** Farther than the backdrop's objects (0 near .. 1 far). */
  depth: number;
  variants: readonly string[];
  spin: boolean;
}

export const CONSTELLATION_SCENERY_KINDS: readonly KindSpec[] = [
  { kind: "nebula", size: [0.12, 0.17], aspect: [1.1, 1.5], depth: 0.95, variants: ["orion", "carina"], spin: true },
  { kind: "planetary", size: [0.05, 0.08], aspect: [1, 1], depth: 0.85, variants: ["ring", "cat", "butterfly"], spin: true },
  { kind: "cluster", size: [0.07, 0.1], aspect: [1, 1], depth: 0.8, variants: ["open"], spin: false },
  { kind: "smudges", size: [0.1, 0.14], aspect: [1.2, 1.6], depth: 1, variants: ["field"], spin: true },
];

/** Edge bands around the whole viewport, in viewport heights inside the edge; the header band is chrome. */
const SIDES: readonly { side: EdgeSide; weight: number; band: readonly [number, number] }[] = [
  { side: "right", weight: 0.35, band: [0.03, 0.12] },
  { side: "bottom", weight: 0.3, band: [0.03, 0.1] },
  { side: "top", weight: 0.2, band: [0.14, 0.2] },
  { side: "left", weight: 0.15, band: [0.03, 0.12] },
];

function pickSide(rng: Rng, counts: Readonly<Record<EdgeSide, number>>) {
  const weights = SIDES.map((s) => s.weight * Math.pow(CONSTELLATION_SCENERY_LIMITS.sideRepeat, counts[s.side]));
  let roll = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return SIDES[i];
  }
  return SIDES[SIDES.length - 1];
}

function bandCentre(rng: Rng, spec: (typeof SIDES)[number], aspect: number, hw: number, hh: number): { u: number; v: number } {
  const bleed = CONSTELLATION_SCENERY_LIMITS.bleed;
  const inset = range(rng, spec.band[0], spec.band[1]);
  switch (spec.side) {
    case "right":
      return { u: 1 - inset / aspect, v: range(rng, hh - bleed, 1 + bleed - hh) };
    case "left":
      return { u: inset / aspect, v: range(rng, hh - bleed, 1 + bleed - hh) };
    case "bottom":
      return { u: range(rng, hw - bleed, 1 + bleed - hw), v: 1 - inset };
    case "top":
      return { u: range(rng, hw - bleed, 1 + bleed - hw), v: inset };
  }
}

function insideViewport(b: Box, bleed: number): boolean {
  return b.x0 >= -bleed && b.y0 >= -bleed && b.x1 <= 1 + bleed && b.y1 <= 1 + bleed;
}

export function placeConstellationScenery(input: ConstellationSceneryInput): ConstellationScenery {
  const L = CONSTELLATION_SCENERY_LIMITS;
  const aspect = input.aspect;
  const graphBox: Box = input.graphBox ?? CONSTELLATION_GRAPH_BOX;
  const chrome: readonly (SafeArea | Box)[] = [...BACKDROP_SAFE_AREAS, ...(input.keepOut ?? [])];
  const rng: Rng = mulberry32((input.seed ^ 0x2c57) >>> 0);
  const objects: ConstellationSceneryObject[] = [];
  const rejected: ConstellationScenery["rejected"] = [];
  const sideCounts: Record<EdgeSide, number> = { right: 0, bottom: 0, top: 0, left: 0 };

  const roll = rng();
  const target = roll < 0.3 ? 2 : roll < 0.75 ? 3 : 4;
  // A nebula first (reads best), then the small kinds in a seeded order; every kind is tried
  // until the target count is placed (a second cluster / shell when a big one found no room).
  const small = CONSTELLATION_SCENERY_KINDS.slice(1).sort(() => rng() - 0.5);
  const order: KindSpec[] = [CONSTELLATION_SCENERY_KINDS[0], ...small, ...small];

  order.forEach((spec, index) => {
    if (objects.length >= Math.max(L.minObjects, target)) return;
    let size = range(rng, spec.size[0], spec.size[1]);
    const objAspect = range(rng, spec.aspect[0], spec.aspect[1]);
    const rotation = spec.spin ? range(rng, -Math.PI, Math.PI) : 0;
    const variant = pick(rng, spec.variants);
    const seed = (input.seed ^ (0x7a11 + index * 0x9e37)) >>> 0;
    let reason: ConstellationScenery["rejected"][number]["reason"] = "graph";
    let placed: { u: number; v: number; edge: ObjectEdge; size: number } | null = null;
    for (let shrink = 0; shrink <= L.shrinkSteps && !placed; shrink++, size *= 0.8) {
      const hh = size / 2;
      const hw = (size * objAspect) / aspect / 2;
      for (let attempt = 0; attempt < L.attempts && !placed; attempt++) {
        const side = pickSide(rng, sideCounts);
        const c = bandCentre(rng, side, aspect, hw, hh);
        const box = objectBox({ u: c.u, v: c.v, size, aspect: objAspect }, aspect);
        if (!insideViewport(box, L.bleed)) {
          reason = "viewport";
          continue;
        }
        if (boxesOverlap(box, graphBox, L.margin)) {
          reason = "graph";
          continue;
        }
        if (chrome.some((area) => boxesOverlap(box, area, L.margin))) {
          reason = "chrome";
          continue;
        }
        if (objects.some((o) => boxesOverlap(box, objectBox(o, aspect), L.margin))) {
          reason = "scenery";
          continue;
        }
        placed = { ...c, edge: side.side, size };
      }
    }
    if (!placed) {
      rejected.push({ kind: spec.kind, reason });
      return;
    }
    sideCounts[placed.edge as EdgeSide]++;
    objects.push({ id: `${spec.kind}-${index}`, kind: spec.kind, rung: "constellation", u: placed.u, v: placed.v, size: placed.size, aspect: objAspect, rotation, depth: spec.depth, seed, variant, edge: placed.edge });
  });

  return { seed: input.seed >>> 0, rung: "constellation", aspect, graphBox, objects: objects.slice(0, L.maxObjects), rejected };
}

/** The builder's `PlacedObject`s (rung "backdrop" is only the record shape the sky builder reads). */
export function constellationSceneryAsPlaced(scenery: ConstellationScenery): PlacedObject[] {
  return scenery.objects.map((o) => ({ ...o, rung: "backdrop" }));
}
