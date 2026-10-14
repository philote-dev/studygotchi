/**
 * Hover flags for the course blobs: where a flag goes and how its leader runs,
 * in SCREEN space (CSS px of the stage box, y down). Pure and deterministic, no
 * DOM, so the direction rule, the fallback and the collision avoidance are
 * vitest-able. (The clusters lab's `flag-layout.ts`, moved here 2026-10-13;
 * the renderer is `components/stage/layers/galaxy/CourseFlags.tsx`.)
 *
 * The reference is the knowledge-map top view in Philote's inka repo
 * (`ManifoldTopView.svelte`): every label is pushed RADIALLY OUTWARD from the
 * blob centre to just past the rim and tied to its summit with a 1 px leader
 * that meets the label box on its near edge. Here the "blob centre" is the
 * galaxy centre, so a flag defaults to the ANTI-RADIAL direction (away from the
 * bulge), quantised to 30 degree sectors so it rests still while the pattern
 * turns slowly, with a little hysteresis at the sector edges.
 *
 * Fallback: when the default sector would put the flag outside the stage, over
 * a chrome safe area, over the bulge, over another blob or over a flag already
 * placed (priority order: the current course first, then the hovered one,
 * then by distance from the centre, far first), the sectors are tried in
 * 30 degree steps alternating to either side (+30, -30, +60, -60 ... 180) and
 * the first free one wins. When none is free the least-bad one (smallest
 * overlap) is taken and the box is clamped into the stage.
 *
 * Leader: from the core glow's edge, a radial run of `radial` px, then a short
 * horizontal shelf of `shelf` px toward the flag, ending at the flag's near
 * corner (bottom corner when the flag points up, top corner when it points
 * down, the near edge's middle when it points sideways). Every coordinate is
 * snapped to the stage's pixel cell so the 1-cell stroke stays crisp and the
 * flag moves in whole cells as the blob orbits (no sub-pixel shimmer).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface FlagAnchor {
  courseId: string;
  /** Blob centre on screen. */
  x: number;
  y: number;
  /** Blob radius on screen (the sparse rim). */
  r: number;
  /** Core glow radius on screen: the leader starts at its edge. */
  glowR: number;
  /** Flag box size; measured from the DOM by the caller. */
  w: number;
  h: number;
  /** Larger places first (the current course, then the hovered one). */
  priority: number;
}

export interface FlagLayoutInput {
  anchors: readonly FlagAnchor[];
  /** Galaxy centre on screen (the anti-radial reference). */
  centre: Point;
  /** The bulge as a screen circle; flags never cover it. */
  bulge: Circle;
  /** The stage box in its own coordinates (0, 0, width, height). */
  viewport: Rect;
  /** Chrome safe areas (panels) in stage coordinates. */
  obstacles?: readonly Rect[];
  /** Previous sector per course for hysteresis; omit for a cold solve. */
  prev?: ReadonlyMap<string, FlagSectorState>;
  /** Pixel cell in CSS px (the stage's 2 px cell). */
  cell?: number;
  leader?: Partial<LeaderSpec>;
}

export interface LeaderSpec {
  /** Gap between the glow edge and the leader's start, px. */
  gap: number;
  /** Radial run, px. */
  radial: number;
  /** Horizontal shelf toward the flag, px. */
  shelf: number;
  /** Stage inset flags must respect, px. */
  inset: number;
  /** Clearance between a flag and a blob / the bulge / another flag, px. */
  pad: number;
  /** Radial run multipliers tried in order when no sector is free at the previous length (a longer leader before clamping). */
  reach: readonly number[];
}

export const LEADER: LeaderSpec = { gap: 4, radial: 28, shelf: 12, inset: 8, pad: 6, reach: [1, 1.75, 2.5, 3.25] };

export const SECTORS = 12;
export const SECTOR_RAD = (Math.PI * 2) / SECTORS;
/** A sector only changes when the anti-radial angle has left it by this much (degrees past the 15 degree edge). */
export const HYSTERESIS_DEG = 6;
/** Frames a different free sector must persist before a placed flag moves to it. */
export const SETTLE_FRAMES = 12;

export interface FlagSectorState {
  /** Sector in use, 0 .. 11 (sector k points at k * 30 degrees, screen space, y down). */
  dir: number;
  /** A better sector seen on recent frames, adopted once it has persisted `SETTLE_FRAMES`. */
  pendingDir: number;
  pendingFrames: number;
}

export interface PlacedFlag {
  courseId: string;
  /** Sector in use. */
  dir: number;
  /** The anti-radial default sector this frame. */
  defaultDir: number;
  /** True when `dir` is not the anti-radial default. */
  fallback: boolean;
  /** Radial run multiplier in use (1 = the standard leader; longer when every sector was blocked at the shorter length). */
  reach: number;
  /** No free sector: the least-bad one was taken and the box clamped. */
  clamped: boolean;
  /** Leader polyline, snapped: glow edge -> elbow -> the flag's near corner. */
  start: Point;
  elbow: Point;
  end: Point;
  /** Flag box, snapped. */
  rect: Rect;
  /** The flag's horizontal side relative to the leader end: +1 extends right, -1 left. */
  sx: 1 | -1;
  /** Vertical side: -1 the flag sits above the shelf, +1 below, 0 centred on it. */
  sy: -1 | 0 | 1;
  state: FlagSectorState;
}

export function snap(v: number, cell: number): number {
  return Math.round(v / cell) * cell;
}

export function sectorAngle(dir: number): number {
  return (((dir % SECTORS) + SECTORS) % SECTORS) * SECTOR_RAD;
}

/** Signed smallest difference a - b in radians, in (-pi, pi]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d <= -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return d;
}

/** The anti-radial sector of an anchor: the one whose centre is nearest the ray from the galaxy centre through it. */
export function antiRadialSector(anchor: Point, centre: Point): number {
  const dx = anchor.x - centre.x;
  const dy = anchor.y - centre.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return 0;
  const theta = Math.atan2(dy, dx);
  return ((Math.round(theta / SECTOR_RAD) % SECTORS) + SECTORS) % SECTORS;
}

/**
 * The default sector with hysteresis: keep the previous sector while the
 * anti-radial angle is still within (15 + HYSTERESIS) degrees of its centre.
 */
export function defaultSector(anchor: Point, centre: Point, prevDir: number | undefined): number {
  const fresh = antiRadialSector(anchor, centre);
  if (prevDir === undefined) return fresh;
  const theta = Math.atan2(anchor.y - centre.y, anchor.x - centre.x);
  const limit = SECTOR_RAD / 2 + (HYSTERESIS_DEG * Math.PI) / 180;
  return Math.abs(angleDiff(theta, sectorAngle(prevDir))) <= limit ? ((prevDir % SECTORS) + SECTORS) % SECTORS : fresh;
}

/** Sectors to try from a default: 0, +1, -1, +2, -2, ... +6 (the opposite side last). */
export function sectorCandidates(defaultDir: number): number[] {
  const out = [defaultDir];
  for (let k = 1; k < SECTORS / 2; k++) out.push(defaultDir + k, defaultDir - k);
  out.push(defaultDir + SECTORS / 2);
  return out.map((d) => ((d % SECTORS) + SECTORS) % SECTORS);
}

export interface FlagGeometry {
  start: Point;
  elbow: Point;
  end: Point;
  rect: Rect;
  sx: 1 | -1;
  sy: -1 | 0 | 1;
}

/** Leader and box for an anchor in a sector, snapped to the cell; `reach` scales the radial run. */
export function flagGeometry(anchor: FlagAnchor, dir: number, viewport: Rect, cell: number, leader: LeaderSpec, reach = 1): FlagGeometry {
  const a = sectorAngle(dir);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const r0 = anchor.glowR + leader.gap;
  const start = { x: anchor.x + ux * r0, y: anchor.y + uy * r0 };
  const elbow = { x: start.x + ux * leader.radial * reach, y: start.y + uy * leader.radial * reach };
  // Horizontal side: with the leader, or toward the roomier half when it is vertical.
  const sx: 1 | -1 = Math.abs(ux) < 1e-6 ? (anchor.x < viewport.x + viewport.w / 2 ? 1 : -1) : ux > 0 ? 1 : -1;
  const sy: -1 | 0 | 1 = Math.abs(uy) < 1e-6 ? 0 : uy < 0 ? -1 : 1;
  const end = { x: elbow.x + sx * leader.shelf, y: elbow.y };
  const s = (p: Point): Point => ({ x: snap(p.x, cell), y: snap(p.y, cell) });
  const S = s(start);
  const E = s(elbow);
  const N = { x: snap(end.x, cell), y: E.y };
  const w = snap(anchor.w, cell);
  const h = snap(anchor.h, cell);
  const rect: Rect = {
    x: sx > 0 ? N.x : N.x - w,
    y: sy < 0 ? N.y - h : sy > 0 ? N.y : N.y - snap(h / 2, cell),
    w,
    h,
  };
  return { start: S, elbow: E, end: N, rect, sx, sy };
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

/** Overlap area of two rects (0 when apart). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function rectCircleOverlap(r: Rect, c: Circle, pad = 0): boolean {
  const cx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const cy = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return Math.hypot(c.x - cx, c.y - cy) < c.r + pad;
}

/** Area of the rect outside the viewport (after the inset). */
export function outsideArea(r: Rect, viewport: Rect, inset: number): number {
  const inner: Rect = { x: viewport.x + inset, y: viewport.y + inset, w: viewport.w - 2 * inset, h: viewport.h - 2 * inset };
  return r.w * r.h - overlapArea(r, inner);
}

export function segmentCircleHit(p: Point, q: Point, c: Circle): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / l2));
  return Math.hypot(p.x + dx * t - c.x, p.y + dy * t - c.y) < c.r;
}

interface Scored {
  dir: number;
  reach: number;
  geometry: FlagGeometry;
  penalty: number;
}

/**
 * Penalty of a candidate: 0 when free. Otherwise tiered so the least-bad pick
 * never trades a hard rule for a soft one: leaving the stage or covering the
 * bulge is worst, then covering a blob or the chrome, then overlapping another
 * flag (by area), then a leader crossing a blob.
 */
export const PENALTY = { stage: 1e8, bulge: 1e7, blob: 1e6, chrome: 1e6, leader: 1e3 } as const;

export function scoreCandidate(g: FlagGeometry, self: FlagAnchor, input: FlagLayoutInput, placedRects: readonly Rect[], leader: LeaderSpec): number {
  let penalty = 0;
  const outside = outsideArea(g.rect, input.viewport, leader.inset);
  if (outside > 0) penalty += PENALTY.stage + outside;
  for (const o of input.obstacles ?? []) {
    if (rectsOverlap(g.rect, o, leader.pad)) penalty += PENALTY.chrome + overlapArea(g.rect, o);
  }
  const bulge: Circle = { ...input.bulge, r: input.bulge.r + leader.pad };
  if (rectCircleOverlap(g.rect, bulge)) penalty += PENALTY.bulge;
  for (const o of input.anchors) {
    if (o.courseId === self.courseId) continue;
    const c: Circle = { x: o.x, y: o.y, r: o.r + leader.pad };
    if (rectCircleOverlap(g.rect, c)) penalty += PENALTY.blob;
    // A 1-cell leader may cross a blob's sparse rim, not its core glow.
    const core: Circle = { x: o.x, y: o.y, r: o.glowR * 1.6 };
    if (segmentCircleHit(g.start, g.elbow, core) || segmentCircleHit(g.elbow, g.end, core)) penalty += PENALTY.leader;
  }
  for (const r of placedRects) {
    const a = overlapArea(g.rect, r);
    if (a > 0 || rectsOverlap(g.rect, r, leader.pad)) penalty += a + 1;
  }
  return penalty;
}

function clampRect(r: Rect, viewport: Rect, inset: number, cell: number): Rect {
  const x = Math.min(Math.max(r.x, viewport.x + inset), viewport.x + viewport.w - inset - r.w);
  const y = Math.min(Math.max(r.y, viewport.y + inset), viewport.y + viewport.h - inset - r.h);
  return { ...r, x: snap(x, cell), y: snap(y, cell) };
}

/** Where the leader meets a clamped box: the nearest point of the box to the elbow, on the cell grid. */
function nearestOnRect(p: Point, r: Rect, cell: number): Point {
  return { x: snap(Math.max(r.x, Math.min(p.x, r.x + r.w)), cell), y: snap(Math.max(r.y, Math.min(p.y, r.y + r.h)), cell) };
}

/**
 * Place every flag. Deterministic for equal input (the anchors are sorted by
 * priority then distance from the centre then id before the greedy pass).
 */
export function layoutFlags(input: FlagLayoutInput): PlacedFlag[] {
  const cell = input.cell ?? 2;
  const leader = { ...LEADER, ...input.leader };
  const order = [...input.anchors].sort((p, q) => {
    if (q.priority !== p.priority) return q.priority - p.priority;
    const dp = Math.hypot(p.x - input.centre.x, p.y - input.centre.y);
    const dq = Math.hypot(q.x - input.centre.x, q.y - input.centre.y);
    if (Math.abs(dq - dp) > 1e-6) return dq - dp;
    return p.courseId < q.courseId ? -1 : 1;
  });
  const placedRects: Rect[] = [];
  const out: PlacedFlag[] = [];
  for (const anchor of order) {
    const prev = input.prev?.get(anchor.courseId);
    const defaultDir = defaultSector(anchor, input.centre, prev?.dir);
    const candidates = sectorCandidates(defaultDir);
    // Every sector at the standard leader first, then the same sweep with a longer leader, then longer still.
    const scored: Scored[] = [];
    for (const reach of leader.reach) {
      for (const dir of candidates) {
        const geometry = flagGeometry(anchor, dir, input.viewport, cell, leader, reach);
        scored.push({ dir, reach, geometry, penalty: scoreCandidate(geometry, anchor, input, placedRects, leader) });
      }
    }
    const free = scored.filter((s) => s.penalty === 0);
    let pick: Scored;
    let clamped = false;
    let state: FlagSectorState;
    if (free.length === 0) {
      // Least-bad. Soft penalties (a leader across a rim, flags touching) are accepted as they are; a hard one
      // (off the stage, over the bulge, a blob or the chrome) means every sector failed: clamp the box into the stage.
      pick = scored.reduce((best, s) => (s.penalty < best.penalty ? s : best), scored[0]);
      clamped = pick.penalty >= PENALTY.blob;
      state = { dir: pick.dir, pendingDir: pick.dir, pendingFrames: 0 };
    } else {
      const bestFree = free[0]; // nearest the default in the candidate order, shortest leader
      const prevFree = prev ? free.find((s) => s.dir === prev.dir) : undefined;
      if (!prev || !prevFree) {
        // Cold start, or the sector in use is blocked: move at once to the nearest free one.
        pick = bestFree;
        state = { dir: pick.dir, pendingDir: pick.dir, pendingFrames: 0 };
      } else if (bestFree.dir === prev.dir) {
        pick = prevFree;
        state = { dir: prev.dir, pendingDir: prev.dir, pendingFrames: 0 };
      } else {
        // A sector nearer the default has come free: adopt it once it has persisted.
        const frames = prev.pendingDir === bestFree.dir ? prev.pendingFrames + 1 : 1;
        if (frames >= SETTLE_FRAMES) {
          pick = bestFree;
          state = { dir: bestFree.dir, pendingDir: bestFree.dir, pendingFrames: 0 };
        } else {
          pick = prevFree;
          state = { dir: prev.dir, pendingDir: bestFree.dir, pendingFrames: frames };
        }
      }
    }
    let { rect, end } = pick.geometry;
    if (clamped) {
      rect = clampRect(rect, input.viewport, leader.inset, cell);
      end = nearestOnRect(pick.geometry.elbow, rect, cell);
    }
    placedRects.push(rect);
    out.push({
      courseId: anchor.courseId,
      dir: pick.dir,
      defaultDir,
      fallback: pick.dir !== defaultDir,
      reach: pick.reach,
      clamped,
      start: pick.geometry.start,
      elbow: pick.geometry.elbow,
      end,
      rect,
      sx: pick.geometry.sx,
      sy: pick.geometry.sy,
      state,
    });
  }
  return out;
}

/** SVG path for a leader: glow edge -> elbow -> near corner; the shelf is dropped when it has no length. */
export function leaderPath(f: Pick<PlacedFlag, "start" | "elbow" | "end">): string {
  const shelf = f.elbow.x !== f.end.x || f.elbow.y !== f.end.y;
  return `M${f.start.x} ${f.start.y}L${f.elbow.x} ${f.elbow.y}${shelf ? `L${f.end.x} ${f.end.y}` : ""}`;
}
