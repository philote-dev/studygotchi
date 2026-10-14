/**
 * Where the course blobs go (the clusters lab's `blob-placement.ts`, moved
 * here 2026-10-13 with the version C decision). Three modes, all emitting
 * positions in the layout generator's bead frame (the galaxy's pattern
 * frame, disc units, y up out of the disc plane), so `CourseBeads` (the
 * blob anchors) and `CourseBlobs` read the same `GalaxyLayout`. `mixed` is
 * the product default; `arms` and `halo` stay as revertable options.
 *
 *   arms   the ridge placement from `./layout` (y = 0), untouched.
 *   halo   every course floats off the disc plane, in the inter-arm volume
 *          (midway between two arm ridges at its radius) or just outside the
 *          rim, 0.10 .. 0.32 R above or below the plane, alternating sides,
 *          never under the bulge. True 3D positions: they parallax against the
 *          disc and orbit with the pattern.
 *   mixed  the anchored courses (the current one and the ones with a world)
 *          keep their arm; the rest hover near their home arm, just off it on
 *          the inter-arm side and off the plane, so the subject grouping
 *          survives while the arms stay legible.
 *
 * The layout generator's no-overlap rule is kept with the BLOB radii (bead
 * radius * blobScale + the bead margin), in 3D. Pure and seeded.
 */
import { armTheta, LAYOUT, type ArmSpine, type CourseBead, type GalaxyLayout, type GalaxyShape, type Vec3 } from "./layout";
import { mulberry32, range, type Rng } from "@/lib/stage/rng";

export type BlobPlacementMode = "arms" | "halo" | "mixed";
export const BLOB_PLACEMENT_MODES: readonly BlobPlacementMode[] = ["arms", "halo", "mixed"];
/** The product's placement (Philote, 2026-10-13). */
export const DEFAULT_BLOB_PLACEMENT: BlobPlacementMode = "mixed";

export const HALO = {
  aMin: 0.38,
  aMax: 1.08,
  /** |y| band, disc units. */
  yMin: 0.1,
  yMax: 0.32,
  /** Disc-plane clearance from the bulge centre, in bulge sigmas (plus the blob radius). */
  bulgeClear: 1.8,
  attempts: 40,
  /** Mixed mode: how far off the home arm (radians at the bead's radius) and how far along it the course may drift. */
  mixedOff: [0.3, 0.55] as const,
  mixedAlong: 0.12,
} as const;

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Angle midway between arm `k` and the next arm at radius `a` (the inter-arm gap). */
export function interArmTheta(shape: GalaxyShape, arms: readonly ArmSpine[], k: number, a: number): number {
  const main = arms.filter((arm) => arm.kind !== "spur");
  const arm = main[k % main.length];
  const next = main[(k + 1) % main.length];
  const t0 = armTheta(shape, arm, Math.max(a, arm.aStart));
  let t1 = armTheta(shape, next, Math.max(a, next.aStart));
  // Take the gap on the spin side of arm k, wrapped to (0, 2 pi).
  const TAU = Math.PI * 2;
  let gap = (((t1 - t0) % TAU) + TAU) % TAU;
  if (main.length === 1) gap = Math.PI;
  t1 = t0 + gap;
  return (t0 + t1) / 2;
}

/** Clear of every placed blob (3D, blob radii + the bead margin) and of the bulge (disc-plane). */
export function haloClear(p: Vec3, r: number, placed: readonly { position: Vec3; radius: number }[], bulgeSigma: number): boolean {
  if (Math.hypot(p[0], p[2]) < bulgeSigma * HALO.bulgeClear + r) return false;
  for (const o of placed) if (dist(p, o.position) < r + o.radius + LAYOUT.beadMargin) return false;
  return true;
}

interface Placed {
  position: Vec3;
  radius: number;
}

function sampleHalo(rng: Rng, layout: GalaxyLayout, bead: CourseBead, r: number, placed: readonly Placed[], side: 1 | -1, nearHome: boolean): { position: Vec3; a: number; theta: number } {
  const { shape, arms } = layout;
  const main = arms.filter((arm) => arm.kind !== "spur");
  let best: { position: Vec3; a: number; theta: number } | null = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < HALO.attempts; attempt++) {
    let a: number;
    let theta: number;
    if (nearHome) {
      const arm = arms[bead.arm] ?? main[0];
      a = Math.min(HALO.aMax, Math.max(HALO.aMin, bead.a + range(rng, -HALO.mixedAlong, HALO.mixedAlong)));
      const off = range(rng, HALO.mixedOff[0], HALO.mixedOff[1]) * (attempt % 2 === 0 ? 1 : -1);
      theta = armTheta(shape, arm, Math.max(a, arm.aStart)) + off;
    } else {
      a = range(rng, HALO.aMin, HALO.aMax);
      const k = Math.floor(rng() * main.length);
      theta = interArmTheta(shape, arms, k, a) + range(rng, -0.25, 0.25);
    }
    // Later attempts widen the band so a crowded galaxy still finds room.
    const widen = attempt / HALO.attempts;
    const y = side * range(rng, HALO.yMin, HALO.yMax + 0.12 * widen);
    const p: Vec3 = [a * Math.cos(theta), y, a * Math.sin(theta)];
    if (haloClear(p, r, placed, shape.bulgeSigma)) return { position: p, a, theta };
    let minD = Infinity;
    for (const o of placed) minD = Math.min(minD, dist(p, o.position) - o.radius - r);
    minD = Math.min(minD, Math.hypot(p[0], p[2]) - shape.bulgeSigma * HALO.bulgeClear - r);
    if (minD > bestScore) {
      bestScore = minD;
      best = { position: p, a, theta };
    }
  }
  return best!;
}

/**
 * Re-place the layout's beads for a blob placement mode. `blobScale` is the
 * blob / bead radius ratio the no-overlap rule must honour. The returned
 * layout keeps everything else (slots, deep field, arms) as it was.
 */
export function placeBlobs(layout: GalaxyLayout, mode: BlobPlacementMode, seed: number, blobScale: number): GalaxyLayout {
  if (mode === "arms") return layout;
  const rng = mulberry32((seed ^ 0xb10b) >>> 0);
  const anchored = (b: CourseBead) => mode === "mixed" && (b.kind === "current" || b.hasWorld);
  const placed: Placed[] = layout.beads.filter(anchored).map((b) => ({ position: b.position, radius: b.radius * blobScale }));
  // Biggest first, like the generator, so the small ones fill the gaps; sides alternate for balance.
  const floating = layout.beads.filter((b) => !anchored(b)).sort((p, q) => q.radius - p.radius || (p.courseId < q.courseId ? -1 : 1));
  const moved = new Map<string, CourseBead>();
  floating.forEach((b, i) => {
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const r = b.radius * blobScale;
    const s = sampleHalo(rng, layout, b, r, placed, side, mode === "mixed");
    placed.push({ position: s.position, radius: r });
    moved.set(b.courseId, { ...b, a: s.a, theta: s.theta, position: s.position, labelDir: [Math.cos(s.theta), Math.sin(s.theta)] });
  });
  const beads = layout.beads.map((b) => moved.get(b.courseId) ?? b);
  const current = beads.find((b) => b.kind === "current") ?? null;
  return {
    ...layout,
    beads,
    current,
    focal: current ? { position: current.position, radius: Math.max(0.26, current.radius * 3.2), courseId: current.courseId } : layout.focal,
  };
}

/** Pairs of beads whose blobs (radius * blobScale) overlap by more than the margin allows; empty when the rule holds. */
export function blobOverlaps(layout: GalaxyLayout, blobScale: number): [string, string][] {
  const out: [string, string][] = [];
  const beads = layout.beads;
  for (let i = 0; i < beads.length; i++) {
    for (let j = i + 1; j < beads.length; j++) {
      const need = (beads[i].radius + beads[j].radius) * blobScale + LAYOUT.beadMargin;
      if (dist(beads[i].position, beads[j].position) < need - 1e-9) out.push([beads[i].courseId, beads[j].courseId]);
    }
  }
  return out;
}
