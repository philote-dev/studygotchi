/**
 * Seeded scenery for the galaxy rung: three to five of the far sky's object
 * kinds (nebula, open cluster, planetary shell, lensed smudges) placed
 * between the course clusters, in the galaxy's PATTERN frame, so they ride
 * the arms with the beads and never drift into one.
 *
 * Pure and deterministic (same student seed + same layout + same view = same
 * scenery). Candidates are the layout generator's object slots
 * (`GalaxyLayout.slots`, already clear of every bead and of each other),
 * mapped to a sky kind; when fewer than three survive, seeded inter-arm
 * positions fill in. Every candidate must
 *   - keep `beadClearance` from every bead glow and from other scenery (disc units),
 *   - stay outside the bulge and inside the disc,
 *   - over a FULL pattern turn, never project under a chrome safe area
 *     (`BACKDROP_SAFE_AREAS`, the placement.ts convention) nor off screen:
 *     the pattern turns once every 48 s, so a position is only clean if its
 *     whole sweep is.
 * Nothing here carries meaning (Philote, 2026-10-11: scenery first).
 *
 * The renderer (`components/stage/layers/galaxy/GalaxyScenery.tsx`) feeds the
 * result through the sky layer's own object builder, so a nebula here is the
 * nebula the backdrop draws, at a different size and in the disc plane.
 */
import type { GalaxyLayout, SlotType, Vec3 } from "@/lib/galaxy/layout";
import { BACKDROP_SAFE_AREAS, type BackdropKind, type Box } from "./placement";
import { boxClearance, discBox } from "./planet-scenery";
import { mulberry32, pick, range, type Rng } from "./rng";

export type GalaxyPlacementRung = "galaxy";

/** How the galaxy sits in the stage camera's view (the layer's hero framing). */
export interface GalaxyView {
  /** Viewport width / height (bucket it first). */
  aspect: number;
  /** Stage camera vertical fov, degrees. */
  fovDeg: number;
  /** Disc diameter as a fraction of the viewport height (`GalaxyLayer` `size`). */
  size: number;
  /** `GalaxySpec.roll` and `.inclination` (the Galaxy's outer / inner group rotations). */
  roll: number;
  inclination: number;
}

export interface GalaxySceneryInput {
  seed: number;
  layout: GalaxyLayout;
  view: GalaxyView;
  /** Extra screen boxes (viewport fractions) to stay clear of over the sweep; chrome is always included. */
  keepOut?: readonly Box[];
}

export type SceneryRejection = "bead" | "scenery" | "chrome" | "viewport" | "disc";

export interface GalaxySceneryObject {
  id: string;
  kind: BackdropKind;
  rung: GalaxyPlacementRung;
  /** The layout slot it fills, or `gap` for a seeded inter-arm position. */
  slot: SlotType | "gap";
  /** Centre in the pattern frame (disc radius 1, y up). */
  position: Vec3;
  /** Box height in disc units and width / height. */
  size: number;
  aspect: number;
  /** Half of the larger box extent (disc units): the clearance radius. */
  radius: number;
  /** In-plane rotation (radians). */
  rotation: number;
  seed: number;
  variant: string;
  /** Minimum clearance from chrome / keep-outs over the sweep, viewport-height units (>= 0 when clean). */
  clearance: number;
}

export interface GalaxyScenery {
  seed: number;
  rung: GalaxyPlacementRung;
  view: GalaxyView;
  objects: GalaxySceneryObject[];
  rejected: { slot: SlotType | "gap"; kind: BackdropKind; reason: SceneryRejection }[];
}

export const GALAXY_SCENERY_LIMITS = {
  minObjects: 3,
  maxObjects: 5,
  /** Disc-unit gap kept from bead glows and from other scenery. */
  beadClearance: 0.03,
  /** Gap positions live in this radial band (inside it the sweep clears the chrome at the hero framing). */
  gapAMin: 0.38,
  gapAMax: 0.64,
  /** Outer limit for any object (the rim is the beads' and the halo's). */
  aMax: 0.95,
  /** Bulge keep-out: this many bulge sigmas, at least `bulgeMinA`. */
  bulgeSigmas: 2.2,
  bulgeMinA: 0.3,
  /** Screen margin kept from a safe area (viewport fraction), as placement.ts. */
  margin: 0.01,
  /** Pattern angles sampled over one turn for the chrome sweep. */
  sweepSamples: 36,
  /** Shrink steps (x 0.8) before a candidate is dropped. */
  shrinkSteps: 3,
  gapAttempts: 40,
} as const;

interface KindSpec {
  kind: BackdropKind;
  /** Box height, disc units. */
  size: readonly [number, number];
  aspect: readonly [number, number];
  variants: readonly string[];
  spin: boolean;
}

/**
 * Disc-unit box heights (disc radius 1 is ~370 px at the hero framing): a
 * nebula about a fifth of the radius, a shell a tenth. Smaller than this the
 * recipes stop reading (a smudge ring's sub-quads fall under a cell); the
 * placement shrinks a candidate up to three times (x 0.8) to fit it in.
 */
export const GALAXY_SCENERY_KINDS: Readonly<Record<BackdropKind, KindSpec>> = {
  nebula: { kind: "nebula", size: [0.17, 0.23], aspect: [1.1, 1.4], variants: ["orion", "carina"], spin: true },
  cluster: { kind: "cluster", size: [0.12, 0.16], aspect: [1, 1], variants: ["open"], spin: false },
  planetary: { kind: "planetary", size: [0.08, 0.11], aspect: [1, 1], variants: ["ring", "cat", "butterfly"], spin: true },
  smudges: { kind: "smudges", size: [0.15, 0.2], aspect: [1.1, 1.4], variants: ["field"], spin: true },
};

/** Which sky kind stands in for a layout slot; the comet moves and is left to the galaxy's own far layer. */
export const SLOT_KIND: Readonly<Record<SlotType, BackdropKind | null>> = {
  nebula: "nebula",
  "supernova-remnant": "nebula",
  blackhole: "smudges",
  "white-hole": "smudges",
  binary: "cluster",
  pulsar: "cluster",
  "ringed-giant": "planetary",
  comet: null,
};

/** Gap fillers cycle through the small kinds so a sky never gets two nebulae by accident. */
const GAP_KINDS: readonly BackdropKind[] = ["cluster", "planetary", "smudges", "cluster", "planetary"];

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Projection: pattern frame -> stage screen                           */
/* ------------------------------------------------------------------ */

/** Camera distance to the disc centre (disc radii) for the layer's `size` (see galaxy-layer-model). */
export function galaxyCameraDistance(view: Pick<GalaxyView, "size" | "fovDeg">): number {
  const s = Math.max(0.02, Math.min(4, view.size));
  return 1 / (s * Math.tan((view.fovDeg * Math.PI) / 360));
}

export interface ScreenPoint {
  u: number;
  v: number;
  /** Distance in front of the camera, disc radii. */
  depth: number;
  /** Viewport-height units per disc unit at this depth. */
  perUnit: number;
}

/**
 * Where a pattern-frame point lands on screen when the pattern has turned by
 * `patternAngle` (the Galaxy rotates its pattern group by -patternAngle about
 * Y, then tilts the disc by pi/2 - inclination about X, rolls about Z, and
 * sits `distance` in front of the camera on its axis).
 */
export function discToScreen(view: GalaxyView, p: Vec3, patternAngle = 0): ScreenPoint {
  const a = -patternAngle;
  const x0 = p[0] * Math.cos(a) + p[2] * Math.sin(a);
  const z0 = -p[0] * Math.sin(a) + p[2] * Math.cos(a);
  const y0 = p[1];
  const phi = Math.PI / 2 - view.inclination;
  const y1 = y0 * Math.cos(phi) - z0 * Math.sin(phi);
  const z1 = y0 * Math.sin(phi) + z0 * Math.cos(phi);
  const x2 = x0 * Math.cos(view.roll) - y1 * Math.sin(view.roll);
  const y2 = x0 * Math.sin(view.roll) + y1 * Math.cos(view.roll);
  const depth = Math.max(1e-3, galaxyCameraDistance(view) - z1);
  const tanHalf = Math.tan((view.fovDeg * Math.PI) / 360);
  const perUnit = 1 / (2 * depth * tanHalf);
  return { u: 0.5 + (x2 * perUnit) / view.aspect, v: 0.5 - y2 * perUnit, depth, perUnit };
}

/**
 * Minimum clearance (viewport-height units) of an object's screen disc from
 * every safe area over a full pattern turn; negative when some angle puts it
 * under chrome, -Infinity when some angle puts it off screen.
 */
export function sweepClearance(view: GalaxyView, position: Vec3, radius: number, safe: readonly Box[] = BACKDROP_SAFE_AREAS, samples = GALAXY_SCENERY_LIMITS.sweepSamples): number {
  let worst = Infinity;
  for (let i = 0; i < samples; i++) {
    const s = discToScreen(view, position, (i / samples) * TAU);
    const r = radius * s.perUnit;
    const box = discBox(s.u, s.v, r, view.aspect);
    if (box.x0 < 0 || box.y0 < 0 || box.x1 > 1 || box.y1 > 1) return -Infinity;
    for (const area of safe) worst = Math.min(worst, boxClearance(box, area, view.aspect) - GALAXY_SCENERY_LIMITS.margin);
  }
  return worst;
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

function dist2(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

interface Candidate {
  slot: SlotType | "gap";
  kind: BackdropKind;
  position: Vec3;
}

export function placeGalaxyScenery(input: GalaxySceneryInput): GalaxyScenery {
  const L = GALAXY_SCENERY_LIMITS;
  const view = input.view;
  const layout = input.layout;
  const rng: Rng = mulberry32((input.seed ^ 0x6a1a) >>> 0);
  const safe: Box[] = [...BACKDROP_SAFE_AREAS.map((s) => ({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 })), ...(input.keepOut ?? [])];
  const bulgeA = Math.max(L.bulgeMinA, layout.shape.bulgeSigma * L.bulgeSigmas);
  const objects: GalaxySceneryObject[] = [];
  const rejected: GalaxyScenery["rejected"] = [];

  /** A bead's keep-out radius: its glow, or the "you are here" ring (1.3 x the glow) on the current one. */
  const beadReach = (b: GalaxyLayout["beads"][number]) => (b.kind === "current" ? b.radius * 1.3 : b.radius);
  /** The bead a position sits too close to for an object of `radius`, if any. */
  const offendingBead = (p: Vec3, radius: number) => layout.beads.find((b) => dist2(p, b.position) < beadReach(b) + radius + L.beadClearance) ?? null;

  const tryPlace = (cand: Candidate, index: number): boolean => {
    const spec = GALAXY_SCENERY_KINDS[cand.kind];
    let flat: Vec3 = [cand.position[0], 0, cand.position[2]];
    let size = range(rng, spec.size[0], spec.size[1]);
    const aspect = range(rng, spec.aspect[0], spec.aspect[1]);
    const rotation = spec.spin ? range(rng, -Math.PI, Math.PI) : 0;
    const variant = pick(rng, spec.variants);
    const seed = (input.seed ^ (0x2c9d + index * 0x9e37)) >>> 0;
    let reason: SceneryRejection = "disc";
    for (let shrink = 0; shrink <= L.shrinkSteps; shrink++, size *= 0.8) {
      const radius = (Math.max(size, size * aspect) / 2) * 0.9;
      // A slot that hugs its bead (the layout's HII pocket sits half inside the biggest bead by design)
      // is pushed straight away from it until the glow is clear; the nudge is kept for the next sizes.
      const bead = offendingBead(flat, radius);
      if (bead) {
        const dx = flat[0] - bead.position[0];
        const dz = flat[2] - bead.position[2];
        const d = Math.hypot(dx, dz) || 1;
        const want = beadReach(bead) + radius + L.beadClearance + 1e-4;
        flat = [bead.position[0] + (dx / d) * want, 0, bead.position[2] + (dz / d) * want];
      }
      const a = Math.hypot(flat[0], flat[2]);
      if (a - radius < bulgeA || a + radius > L.aMax) {
        reason = "disc";
        continue;
      }
      if (offendingBead(flat, radius)) {
        reason = "bead";
        continue;
      }
      if (objects.some((o) => dist2(flat, o.position) < o.radius + radius + L.beadClearance)) {
        reason = "scenery";
        continue;
      }
      const clearance = sweepClearance(view, flat, radius, safe);
      if (!(clearance >= 0)) {
        reason = clearance === -Infinity ? "viewport" : "chrome";
        continue;
      }
      objects.push({ id: `${cand.kind}-${index}`, kind: cand.kind, rung: "galaxy", slot: cand.slot, position: flat, size, aspect, radius, rotation, seed, variant, clearance });
      return true;
    }
    rejected.push({ slot: cand.slot, kind: cand.kind, reason });
    return false;
  };

  // How many this sky wants: three, four or five (seeded), never more than the slots and gaps allow.
  const roll = rng();
  const target = roll < 0.4 ? 3 : roll < 0.8 ? 4 : 5;

  // 1. The layout's slots, in the generator's order (black hole, nebula, pulsar, ...).
  let index = 0;
  for (const slot of layout.slots) {
    if (objects.length >= L.maxObjects) break;
    const kind = SLOT_KIND[slot.type];
    if (!kind) continue;
    tryPlace({ slot: slot.type, kind, position: slot.position }, index++);
  }

  // 2. Seeded inter-arm gaps up to the target (a nebula first when the slots gave none: it reads best).
  let gaps = 0;
  for (let attempt = 0; attempt < L.gapAttempts && objects.length < Math.max(L.minObjects, target); attempt++) {
    const a = range(rng, L.gapAMin, L.gapAMax);
    const theta = rng() * TAU;
    const kind = gaps === 0 && !objects.some((o) => o.kind === "nebula") ? "nebula" : GAP_KINDS[gaps % GAP_KINDS.length];
    if (tryPlace({ slot: "gap", kind, position: [a * Math.cos(theta), 0, a * Math.sin(theta)] }, index++)) gaps++;
  }

  return { seed: input.seed >>> 0, rung: "galaxy", view, objects: objects.slice(0, L.maxObjects), rejected };
}
