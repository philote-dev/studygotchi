/**
 * Seeded-per-student placement of the far sky.
 *
 * Pure and deterministic: the same seed (and viewport aspect) gives the same
 * sky on every machine and every mount. Positions are viewport fractions
 * (u right, v down, 0..1); sizes are fractions of the viewport height, so the
 * renderer can map them onto a plane at any depth. Nothing here touches
 * three.js, so it runs in vitest.
 *
 * Rung `backdrop` (S1): one far galaxy hint plus 3 to 5 far objects, all kept
 * out of the chrome safe areas (header + toolbar band, the left panel column
 * where the course navigator, flag, docks and concept rail live, the zoom
 * controls bottom-centre, the sound chip bottom-right).
 *
 * The objects hug the edges of the sky frame (the viewport minus the header
 * band and the left column): each one picks a side, weighted towards the
 * right edge, then the bottom, then under the header, rarely beside the
 * column, and sits in an edge band 0.08 to 0.22 viewport heights inside that
 * edge, so the middle of the screen stays clear for the planet and the
 * constellation. At most one object may fall back into the middle when no
 * band has room for it. Later rungs (planet, constellation) will add their
 * own slots behind the same seed.
 */
import { clamp, mulberry32, pick, range, seedFromText, type Rng } from "./rng";

export type PlacementRung = "backdrop";

export type BackdropKind = "nebula" | "planetary" | "cluster" | "smudges";

/** Frame edge an object hugs; `centre` is the rare fallback into the middle. */
export type EdgeSide = "right" | "bottom" | "top" | "left";
export type ObjectEdge = EdgeSide | "centre";

export interface SafeArea {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlacedObject {
  id: string;
  kind: BackdropKind;
  rung: PlacementRung;
  /** Centre, viewport fractions. */
  u: number;
  v: number;
  /** Box height as a fraction of the viewport height. */
  size: number;
  /** Box width / height in screen terms. */
  aspect: number;
  rotation: number;
  /** 0 = nearest backdrop depth, 1 = farthest. */
  depth: number;
  seed: number;
  variant: string;
  /** Which frame edge the centre sits in the band of (`centre` for the fallback). */
  edge: ObjectEdge;
}

export interface GalaxyHint {
  u: number;
  v: number;
  /** Disc diameter as a fraction of the viewport height. */
  size: number;
  /** Angle between the disc normal and the view axis (0 face-on). */
  tilt: number;
  roll: number;
  depth: number;
  seed: number;
}

export interface SkyPlacement {
  seed: number;
  rung: PlacementRung;
  aspect: number;
  galaxy: GalaxyHint;
  objects: PlacedObject[];
  safeAreas: SafeArea[];
}

export interface PlacementOptions {
  /** Viewport width / height; bucket it before calling so resizes do not reshuffle. */
  aspect?: number;
  rung?: PlacementRung;
}

/** Seed for a student: hash of the id, `sandbox` when there is none. */
export function seedFromStudent(studentId: string | null | undefined): number {
  const id = studentId?.trim();
  return seedFromText(id && id.length > 0 ? id : "sandbox");
}

/** Round the viewport aspect to a tenth so small resizes keep the same sky. */
export function bucketAspect(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1.6;
  return clamp(Math.round((width / height) * 10) / 10, 0.5, 3.2);
}

/** Bottom of the header + toolbar band and right edge of the left panel column, viewport fractions. */
const HEADER_BOTTOM = 0.13;
const LEFT_COLUMN_RIGHT = 0.3;

/**
 * Chrome the far sky must stay out from under, as viewport fractions with
 * margins generous enough for 1280 to 1920 px wide windows (see product.css:
 * header 56 px, knowledge toolbar to ~100 px, left column 24 + 340 + 24 px,
 * zoom controls bottom-centre, sound chip and account bottom-right).
 */
export const BACKDROP_SAFE_AREAS: readonly SafeArea[] = [
  { id: "header", x0: 0, y0: 0, x1: 1, y1: HEADER_BOTTOM },
  { id: "left-column", x0: 0, y0: 0.06, x1: LEFT_COLUMN_RIGHT, y1: 1 },
  { id: "bottom-centre", x0: 0.42, y0: 0.9, x1: 0.58, y1: 1 },
  { id: "bottom-right", x0: 0.86, y0: 0.9, x1: 1, y1: 1 },
];

/**
 * The sky frame the far objects hug: the viewport minus the header band and
 * the left column. Its right and bottom edges are the screen's own.
 */
export const BACKDROP_FRAME: Readonly<Box> = { x0: LEFT_COLUMN_RIGHT, y0: HEADER_BOTTOM, x1: 1, y1: 1 };

/**
 * How often an object heads for each frame edge, and its band: a centre sits
 * this far inside that edge, in viewport heights (see `edgeDistance`). The
 * header already takes the top 13 %, so the top band stays tighter under it;
 * the left band (beside the column) only takes what clears the column, so in
 * practice small objects.
 */
export const EDGE_SIDES: readonly { side: EdgeSide; weight: number; band: readonly [number, number] }[] = [
  { side: "right", weight: 0.4, band: [0.08, 0.22] },
  { side: "bottom", weight: 0.3, band: [0.08, 0.22] },
  { side: "top", weight: 0.2, band: [0.08, 0.16] },
  { side: "left", weight: 0.1, band: [0.08, 0.22] },
];

export const BACKDROP_LIMITS = {
  minObjects: 3,
  maxObjects: 5,
  /** Objects may bleed past the viewport edge by this much (fraction), so a nebula can crop at the frame. */
  bleed: 0.08,
  /** Keep this much clear of a safe area (fraction). */
  margin: 0.01,
  /** A centre farther than this from every frame edge is in the central band; at most `maxCentral` per sky. */
  central: 0.25,
  maxCentral: 1,
  /** Each object already on a side scales that side's weight by this, so a sky does not pile up on one edge. */
  sideRepeat: 0.5,
  /** Band attempts per object, then central attempts if the bands had no room. */
  attempts: 48,
  centralAttempts: 16,
} as const;

interface KindSpec {
  kind: BackdropKind;
  size: readonly [number, number];
  aspect: readonly [number, number];
  depth: number;
  variants: readonly string[];
  spin: boolean;
}

const KINDS: readonly KindSpec[] = [
  { kind: "nebula", size: [0.2, 0.28], aspect: [1.1, 1.5], depth: 0.9, variants: ["orion", "carina"], spin: true },
  { kind: "cluster", size: [0.1, 0.14], aspect: [1, 1], depth: 0.5, variants: ["open"], spin: false },
  { kind: "planetary", size: [0.07, 0.1], aspect: [1, 1], depth: 0.6, variants: ["ring", "cat", "butterfly"], spin: true },
  { kind: "smudges", size: [0.16, 0.22], aspect: [1.2, 1.6], depth: 1, variants: ["field"], spin: true },
];

/** Screen box of an object: height `size`, width `size * aspect / viewportAspect`. */
export function objectBox(o: Pick<PlacedObject, "u" | "v" | "size" | "aspect">, viewportAspect: number): Box {
  const h = o.size;
  const w = (o.size * o.aspect) / viewportAspect;
  return { x0: o.u - w / 2, y0: o.v - h / 2, x1: o.u + w / 2, y1: o.v + h / 2 };
}

export function galaxyBox(g: Pick<GalaxyHint, "u" | "v" | "size">, viewportAspect: number): Box {
  return objectBox({ u: g.u, v: g.v, size: g.size, aspect: 1 }, viewportAspect);
}

export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  return a.x0 < b.x1 + margin && a.x1 > b.x0 - margin && a.y0 < b.y1 + margin && a.y1 > b.y0 - margin;
}

/**
 * Distance from a centre to the nearest edge of the sky frame, in viewport
 * heights: horizontal gaps are scaled by the aspect so a band is the same
 * width on screen whichever side it hugs. Negative outside the frame.
 */
export function edgeDistance(u: number, v: number, aspect: number): number {
  const f = BACKDROP_FRAME;
  return Math.min((u - f.x0) * aspect, (f.x1 - u) * aspect, v - f.y0, f.y1 - v);
}

function insideViewport(b: Box, bleed: number): boolean {
  return b.x0 >= -bleed && b.y0 >= -bleed && b.x1 <= 1 + bleed && b.y1 <= 1 + bleed;
}

function clearOfChrome(b: Box, safe: readonly SafeArea[], margin: number): boolean {
  return !safe.some((s) => boxesOverlap(b, s, margin));
}

/** Screen-space distance between two centres, in viewport-height units. */
function centreDistance(a: { u: number; v: number }, b: { u: number; v: number }, aspect: number): number {
  return Math.hypot((a.u - b.u) * aspect, a.v - b.v);
}

type EdgeSideSpec = (typeof EDGE_SIDES)[number];

/** Weighted side pick; sides already holding objects weigh less (`sideRepeat` per object). */
function pickSide(rng: Rng, counts: Readonly<Record<EdgeSide, number>>): EdgeSideSpec {
  const weights = EDGE_SIDES.map((s) => s.weight * Math.pow(BACKDROP_LIMITS.sideRepeat, counts[s.side]));
  let roll = rng() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return EDGE_SIDES[i];
  }
  return EDGE_SIDES[EDGE_SIDES.length - 1];
}

/**
 * A centre in the edge band of `side`. Along the edge the box (half extents
 * `hw`, `hh` in viewport fractions) is kept inside the bled viewport; the
 * chrome and spacing rules are checked by the caller.
 */
function bandCentre(rng: Rng, { side, band }: EdgeSideSpec, aspect: number, hw: number, hh: number): { u: number; v: number } {
  const f = BACKDROP_FRAME;
  const bleed = BACKDROP_LIMITS.bleed;
  const inset = range(rng, band[0], band[1]);
  switch (side) {
    case "right":
      return { u: f.x1 - inset / aspect, v: range(rng, f.y0 + hh, f.y1 + bleed - hh) };
    case "left":
      return { u: f.x0 + inset / aspect, v: range(rng, f.y0 + hh, f.y1 + bleed - hh) };
    case "bottom":
      return { u: range(rng, f.x0 + hw, f.x1 + bleed - hw), v: f.y1 - inset };
    case "top":
      return { u: range(rng, f.x0 + hw, f.x1 + bleed - hw), v: f.y0 + inset };
  }
}

/** A centre in the central band (farther than `central` from every frame edge). */
function centralCentre(rng: Rng, aspect: number): { u: number; v: number } {
  const f = BACKDROP_FRAME;
  const c = BACKDROP_LIMITS.central;
  return { u: range(rng, f.x0 + c / aspect, f.x1 - c / aspect), v: range(rng, f.y0 + c, f.y1 - c) };
}

export function placeBackdrop(seed: number, options: PlacementOptions = {}): SkyPlacement {
  const aspect = options.aspect ?? 1.6;
  const rung: PlacementRung = options.rung ?? "backdrop";
  const safe = BACKDROP_SAFE_AREAS;
  const rng: Rng = mulberry32((seed ^ 0x5ba1) >>> 0);

  // Galaxy hint: in the window left of the planet and under the header, where both pages show sky.
  const galaxy: GalaxyHint = {
    u: range(rng, 0.37, 0.45),
    v: range(rng, 0.23, 0.31),
    size: range(rng, 0.13, 0.17),
    tilt: range(rng, 0.5, 1.0),
    roll: range(rng, -0.6, 0.6),
    depth: 0.95,
    seed: (seed ^ 0x9a1a) >>> 0,
  };
  // The ranges above keep the hint clear; nudge if a wide aspect ever pushes the box into a safe area.
  for (let guard = 0; guard < 8 && !clearOfChrome(galaxyBox(galaxy, aspect), safe, BACKDROP_LIMITS.margin); guard++) {
    galaxy.u += 0.01;
    galaxy.v += 0.01;
  }

  const objects: PlacedObject[] = [];
  const wanted: KindSpec[] = [...KINDS];
  // Sometimes a second smudge field: 3 to 5 objects, never more.
  if (rng() < 0.45) wanted.push(KINDS[3]);
  const taken: { u: number; v: number; r: number }[] = [{ u: galaxy.u, v: galaxy.v, r: galaxy.size * 0.6 }];
  const sideCounts: Record<EdgeSide, number> = { right: 0, bottom: 0, top: 0, left: 0 };
  let central = 0;

  wanted.forEach((spec, index) => {
    const size = range(rng, spec.size[0], spec.size[1]);
    const objAspect = range(rng, spec.aspect[0], spec.aspect[1]);
    const rotation = spec.spin ? range(rng, -Math.PI, Math.PI) : 0;
    const variant = pick(rng, spec.variants);
    const objSeed = (seed ^ (0x1d2b + index * 0x9e37)) >>> 0;
    const hh = size / 2;
    const hw = (size * objAspect) / aspect / 2;
    const r = Math.max(hh, hw) * 0.85;
    const fits = (c: { u: number; v: number }): boolean => {
      const box = objectBox({ u: c.u, v: c.v, size, aspect: objAspect }, aspect);
      if (!insideViewport(box, BACKDROP_LIMITS.bleed)) return false;
      if (!clearOfChrome(box, safe, BACKDROP_LIMITS.margin)) return false;
      return !taken.some((t) => centreDistance(t, c, aspect) < t.r + r);
    };

    let placed: { u: number; v: number; edge: ObjectEdge } | null = null;
    for (let attempt = 0; attempt < BACKDROP_LIMITS.attempts && !placed; attempt++) {
      const side = pickSide(rng, sideCounts);
      const c = bandCentre(rng, side, aspect, hw, hh);
      if (fits(c)) placed = { ...c, edge: side.side };
    }
    if (!placed && central < BACKDROP_LIMITS.maxCentral) {
      for (let attempt = 0; attempt < BACKDROP_LIMITS.centralAttempts && !placed; attempt++) {
        const c = centralCentre(rng, aspect);
        if (fits(c)) placed = { ...c, edge: "centre" };
      }
    }
    if (!placed) return;
    if (placed.edge === "centre") central++;
    else sideCounts[placed.edge]++;
    objects.push({
      id: `${spec.kind}-${index}`,
      kind: spec.kind,
      rung,
      u: placed.u,
      v: placed.v,
      size,
      aspect: objAspect,
      rotation,
      depth: spec.depth,
      seed: objSeed,
      variant,
      edge: placed.edge,
    });
    taken.push({ u: placed.u, v: placed.v, r });
  });

  return { seed: seed >>> 0, rung, aspect, galaxy, objects: objects.slice(0, BACKDROP_LIMITS.maxObjects), safeAreas: [...safe] };
}
