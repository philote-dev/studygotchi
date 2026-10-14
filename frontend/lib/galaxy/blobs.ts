/**
 * Course blobs: every course at galaxy altitude is a THREE-DIMENSIONAL star
 * cluster built from its real concept positions (the clusters lab's version
 * C, decided 2026-10-13; the lab's `blob-mapping.ts` moved here).
 *
 * Mapping (pure, seeded, vitest-able; no three.js):
 *   1. The 2D layout position of each concept (the settled d3 layout the
 *      constellation draws) is normalised by the graph's half extent to the
 *      unit disc: (u, v) in [-1, 1].
 *   2. The radius is remapped through a truncated PLUMMER profile so the core
 *      is dense and the rim sparse (a globular's light profile, Omega Centauri
 *      in refs 23 / 25). A settled d3 layout is roughly uniform in area, so its
 *      cumulative count within radius r is ~r^2; the projected Plummer
 *      cumulative mass is R^2 / (R^2 + a^2). Equating the two (truncated at
 *      R = 1) gives R(r) = a * sqrt(g / (1 - g)), g = r^2 / (1 + a^2). The angle
 *      is kept, so the topic clusters stay as sectors of the ball.
 *   3. Depth: each 2D topic cluster becomes a LOBE at its own seeded depth
 *      (z_c in [-0.75, 0.75] of the depth semi-axis, spread evenly in a seeded
 *      order so lobes never pile up on one side), plus a per-node Gaussian
 *      jitter; the whole thing is clamped inside the ellipsoid
 *      x^2 + y^2 + (z / depth)^2 <= 1.
 *   4. A seeded tumble axis and period (90 .. 180 s per turn, signed) per course;
 *      the shader rotates the local positions about the axis, so depth reads in
 *      motion without a per-frame CPU rebuild.
 *
 * Units: local positions are in disc units relative to the blob centre
 * (radius = bead radius * blobScale); the shader adds the centre, the tumble
 * and the condense collapse from per-course uniforms indexed by `aCourse`.
 *
 * Graph sources (the product): the course's settled constellation layout when
 * it is known (`blobGraphFromPositions`), else a deterministic seeded
 * STAND-IN with the same node count (`standInGraph`) that the renderer
 * crossfades to the real one when it arrives (`outgoing` graphs carry
 * `aGen = 0`, the renderer ramps `uSwap` 0 -> 1 over `BLOB_SWAP_MS`).
 */
import type { CourseBead, Vec3 } from "./layout";
import { gaussian, mulberry32, type Rng } from "@/lib/stage/rng";

/** Most courses a blob draw addresses in one call (uniform array size in the shader). */
export const MAX_BLOB_COURSES = 16;
/** Crossfade from a stand-in to the real layout, ms (no pop). */
export const BLOB_SWAP_MS = 300;

/** The product's blob tuning (the lab's sliders' resting values). */
export const BLOB_DEFAULTS = {
  /** Blob radius / bead radius. */
  blobScale: 1.4,
  /** Plummer scale radius `a` in blob radii. */
  core: 0.35,
  /** Depth semi-axis / blob radius. */
  depth: 0.6,
  /** The bead glow's radius as a fraction of the bead radius: the blob's core glow. */
  coreGlow: 0.6,
  /** How much the far third of a blob dims. */
  depthDim: 0.5,
  /** Concepts below this weight are not drawn (0 = every concept). */
  nodeWeight: 0,
  /** Backbone threads per course (0 = none in the product). */
  threads: 0,
  /** Seed for lobe depths, jitter and tumble, independent of the galaxy seed. */
  seed: 0x5eed,
} as const;

// ---------------------------------------------------------------------------
// Graph shape

export interface BlobGraphNode {
  id: string;
  kind: "concept" | "resource";
  x: number;
  y: number;
  /** 0 .. 1 (importance / familiarity): size step and brightness. */
  weight: number;
  clusterId?: string | null;
  mastery?: number | null;
}

export interface BlobGraphCluster {
  id: string;
  count: number;
}

export interface BlobGraphLink {
  id: string;
  source: string;
  target: string;
  kind: "concept" | "resource";
  directed: boolean;
  type: string;
}

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  /** Half of the larger extent (layout units): the radius the graph is scaled by to fit a blob. */
  halfExtent: number;
}

/** One course's constellation as positioned nodes, plus the frame it is judged in. */
export interface BlobGraph {
  courseId: string;
  nodes: readonly BlobGraphNode[];
  links: readonly BlobGraphLink[];
  clusters: readonly BlobGraphCluster[];
  bounds: GraphBounds;
  /** "real" = the settled constellation layout; "stand-in" = seeded placeholder; labs may add their own. */
  origin?: string;
}

export function boundsOf(nodes: readonly { x: number; y: number }[]): GraphBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, halfExtent: 1 };
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, halfExtent: Math.max(1, (maxX - minX) / 2, (maxY - minY) / 2) };
}

/** Clusters (id, member count) from the concept nodes' `clusterId`. */
export function clustersOf(nodes: readonly BlobGraphNode[]): BlobGraphCluster[] {
  const counts = new Map<string, number>();
  for (const n of nodes) if (n.kind === "concept" && n.clusterId) counts.set(n.clusterId, (counts.get(n.clusterId) ?? 0) + 1);
  return [...counts.entries()].map(([id, count]) => ({ id, count }));
}

/** The frame a graph is judged in: its CONCEPTS' bounds (files hang off the rim and are never drawn; they must not push the concepts off-centre). */
export function conceptBounds(nodes: readonly BlobGraphNode[]): GraphBounds {
  const concepts = nodes.filter((n) => n.kind === "concept");
  return boundsOf(concepts.length ? concepts : nodes);
}

/** A blob graph from positioned nodes (the settled constellation layout of a course). */
export function blobGraphFromPositions(courseId: string, nodes: readonly BlobGraphNode[], links: readonly BlobGraphLink[] = [], origin = "real"): BlobGraph {
  return { courseId, nodes, links, clusters: clustersOf(nodes), bounds: conceptBounds(nodes), origin };
}

/**
 * The deterministic stand-in for a course whose layout is not known yet: the
 * same node count, 3 .. 8 topic families on a seeded ring inside the unit
 * disc, Gaussian members, no links. Seeded by course id so it is the same on
 * every machine, and cheap (no simulation), so it never costs a frame.
 */
export function standInGraph(courseId: string, nodeCount: number, seed: number = BLOB_DEFAULTS.seed): BlobGraph {
  const rng = courseRng(seed ^ 0x57a0d, courseId);
  const total = Math.max(1, Math.round(nodeCount));
  const k = Math.min(8, Math.max(total < 6 ? 1 : 3, Math.round(3 + total / 28)));
  const nodes: BlobGraphNode[] = [];
  // The biggest family near the centre, the rest on a jittered ring (radius 0.5 .. 0.75 of the unit disc) in a
  // seeded order, so the stand-in fills its disc like a settled layout does (no hole in the middle).
  const phase = rng() * Math.PI * 2;
  const centroids: { x: number; y: number }[] = [{ x: (rng() - 0.5) * 0.2, y: (rng() - 0.5) * 0.2 }];
  for (let f = 1; f < k; f++) {
    const t = phase + ((f - 1) / (k - 1)) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const r = 0.5 + rng() * 0.25;
    centroids.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
  }
  // Zipf-ish family sizes, like the real course (one family dominates).
  const weights = centroids.map((_, i) => 1 / Math.pow(i + 1, 0.55) + rng() * 0.15);
  const sum = weights.reduce((a, b) => a + b, 0);
  const sizes = weights.map((w) => Math.max(1, Math.round((w / sum) * total)));
  while (sizes.reduce((a, b) => a + b, 0) > total) sizes[sizes.indexOf(Math.max(...sizes))] -= 1;
  while (sizes.reduce((a, b) => a + b, 0) < total) sizes[sizes.indexOf(Math.min(...sizes))] += 1;
  sizes.forEach((size, f) => {
    const c = centroids[f];
    const spread = 0.16 + 0.1 * Math.sqrt(size / Math.max(1, total)) * 2;
    for (let i = 0; i < size; i++) {
      const x = c.x + gaussian(rng) * spread;
      const y = c.y + gaussian(rng) * spread;
      const weight = Math.round((0.3 + 0.7 * Math.pow(rng(), 0.6)) * 10) / 10;
      nodes.push({ id: `${courseId}:s${f}-${i}`, kind: "concept", x, y, weight, clusterId: `${courseId}:f${f}`, mastery: 0.5 });
    }
  });
  return { courseId, nodes, links: [], clusters: clustersOf(nodes), bounds: conceptBounds(nodes), origin: "stand-in" };
}

// ---------------------------------------------------------------------------
// Placement / params / buffers

export interface BlobPlacement {
  courseId: string;
  /** Blob centre in the galaxy's pattern frame (disc units; y is up, out of the disc plane). */
  position: Vec3;
  /** Blob radius in disc units (`beadRadiusFor(concepts) * blobScale`). */
  radius: number;
  /** 0 = the full blob, 1 = collapsed into its core glow. */
  condense: number;
  current: boolean;
}

export interface BlobParams {
  /** Plummer scale radius `a` in blob radii (0.2 sharp core .. 0.6 soft); 0.35 is the default. */
  core: number;
  /** Depth semi-axis as a fraction of the blob radius (0.4 flat .. 1.0 a ball). */
  depth: number;
  /** Concepts below this weight (0 .. 1) are not drawn; files never are (the twin's cluster layer). */
  nodeWeight: number;
  /** Seed for the lobe depths, the jitter and the tumble (independent of the galaxy seed). */
  seed: number;
  /** Backbone threads per course drawn as faint lines at galaxy altitude; 0 draws none. */
  threads: number;
}

export const DEFAULT_BLOB_PARAMS: BlobParams = { core: BLOB_DEFAULTS.core, depth: BLOB_DEFAULTS.depth, nodeWeight: BLOB_DEFAULTS.nodeWeight, seed: BLOB_DEFAULTS.seed, threads: BLOB_DEFAULTS.threads };

export interface BlobCourse {
  courseId: string;
  /** Dense index, the `aCourse` attribute. */
  index: number;
  position: Vec3;
  radius: number;
  /** Unit tumble axis. */
  axis: Vec3;
  /** Signed angular speed, rad/s (one turn per 90 .. 180 s). */
  omega: number;
  condense: number;
  current: boolean;
  nodes: number;
  /** Nodes written with alpha > 0 (the current graph; an outgoing graph's are not counted). */
  visible: number;
  threads: number;
  /** Mean normalised radius of the visible nodes (density check; ~0.45 for a Plummer a = 0.35). */
  meanRadius: number;
  /** True when an outgoing graph is written too (crossfade in progress). */
  swapping: boolean;
  origin: string;
}

export interface BlobPointBuffers {
  count: number;
  /** Local offset from the blob centre, disc units. */
  local: Float32Array;
  course: Float32Array;
  /** Concept weight 0 .. 1 (size step). */
  weight: Float32Array;
  /** Base alpha 0 .. 1 (0 hides files and LOD'd nodes). */
  alpha: Float32Array;
  /** Normalised radius inside the ellipsoid, 0 centre .. 1 rim (colour ramp). */
  radius: Float32Array;
  /** 1 = the course's current graph, 0 = an outgoing graph fading out (`uSwap`). */
  gen: Float32Array;
}

export interface BlobThreadBuffers {
  /** Segments written (two vertices each). */
  count: number;
  local: Float32Array;
  course: Float32Array;
}

export interface BlobBudget {
  /** One point draw plus one line draw when any thread is written. */
  draws: number;
  courses: number;
  points: number;
  visiblePoints: number;
  threads: number;
}

export interface BlobBuffers {
  points: BlobPointBuffers;
  threads: BlobThreadBuffers;
  courses: BlobCourse[];
  budget: BlobBudget;
}

// ---------------------------------------------------------------------------
// Density profile

/**
 * Truncated Plummer remap of a uniform-in-area radius `r` (0 .. 1) to the
 * radius `R` (0 .. 1) at which a Plummer sphere of scale radius `a` holds the
 * same cumulative projected mass. Monotone, R(0) = 0, R(1) = 1, and R(r) < r
 * inside: the core gathers, the rim thins.
 */
export function plummerRadius(r: number, a: number): number {
  const rr = Math.min(1, Math.max(0, r));
  const aa = Math.max(1e-3, a);
  const g = (rr * rr) / (1 + aa * aa);
  if (g >= 1) return 1;
  return Math.min(1, aa * Math.sqrt(g / (1 - g)));
}

/** The surface density ratio core / rim a Plummer sphere of scale `a` shows: (1 + 1/a^2)^2. */
export function plummerContrast(a: number): number {
  const q = 1 + 1 / (a * a);
  return q * q;
}

/** Cells per disc unit on screen for a disc at `distance` (disc radii) under a vertical fov, with `cellsHigh` cells over the viewport height. */
export function cellsPerUnitAt(distance: number, fovDeg: number, cellsHigh: number): number {
  return cellsHigh / 2 / (distance * Math.tan((fovDeg * Math.PI) / 360));
}

// ---------------------------------------------------------------------------
// Seeded per-course things

export function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function courseRng(seed: number, courseId: string): Rng {
  return mulberry32((seed ^ hashText(courseId)) >>> 0);
}

/** Seeded tumble: a unit axis away from the view axis (so depth actually changes) and one turn per 90 .. 180 s, either way. */
export function tumbleFor(rng: Rng): { axis: Vec3; omega: number } {
  // Axis: mostly in the disc plane with a tilt, so the lobes swing through the depth direction.
  const yaw = rng() * Math.PI * 2;
  const tilt = (rng() - 0.5) * 0.9;
  const axis: Vec3 = [Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt)];
  const period = 90 + rng() * 90;
  const sign = rng() < 0.5 ? 1 : -1;
  return { axis, omega: (sign * Math.PI * 2) / period };
}

/**
 * Depth of each topic cluster, in units of the depth semi-axis: evenly spread
 * in [-0.75, 0.75] (so no two lobes share a depth) in a seeded order; the graph's
 * biggest cluster is kept nearest the mid-plane so the core stays dense.
 */
export function clusterDepths(graph: Pick<BlobGraph, "clusters">, rng: Rng): Map<string, number> {
  const clusters = [...graph.clusters].sort((p, q) => q.count - p.count || (p.id < q.id ? -1 : 1));
  const n = clusters.length;
  const out = new Map<string, number>();
  if (n === 0) return out;
  if (n === 1) {
    out.set(clusters[0].id, 0);
    return out;
  }
  // Slots from the middle outward, alternating sides, in a seeded order of the remaining clusters.
  const slots: number[] = [];
  for (let i = 0; i < n; i++) slots.push(-0.75 + (1.5 * i) / (n - 1));
  slots.sort((p, q) => Math.abs(p) - Math.abs(q) || p - q);
  out.set(clusters[0].id, slots[0]);
  const rest = clusters.slice(1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  rest.forEach((c, i) => out.set(c.id, slots[i + 1]));
  return out;
}

// ---------------------------------------------------------------------------
// Threads: the few backbone edges still drawn at galaxy altitude

/** The constellation's backbone score of a link (`lib/space-field` `edgeBackboneScore`, repeated here so the galaxy has no sky dependency). */
export function threadScore(link: Pick<BlobGraphLink, "kind" | "directed" | "type">, a: Pick<BlobGraphNode, "weight">, b: Pick<BlobGraphNode, "weight">): number {
  const lo = Math.min(a.weight, b.weight);
  const hi = Math.max(a.weight, b.weight);
  let score = hi * 0.55 + lo * 0.45;
  if (link.directed || /PREREQUISITE|BUILDS_ON/i.test(link.type)) score += 0.22;
  if (link.kind === "resource") score -= 0.4;
  return score;
}

/**
 * The `n` strongest edges of a graph by the backbone score, preferring edges
 * that BRIDGE two topic clusters (the course's spine), then the strongest
 * in-cluster ones. Deterministic (ties by id).
 */
export function pickThreads(graph: Pick<BlobGraph, "nodes" | "links">, n: number): BlobGraphLink[] {
  if (n <= 0) return [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const scored: { link: BlobGraphLink; score: number; bridge: number }[] = [];
  for (const l of graph.links) {
    const a = byId.get(l.source);
    const b = byId.get(l.target);
    if (!a || !b || a.kind !== "concept" || b.kind !== "concept") continue;
    const ca = a.clusterId;
    const cb = b.clusterId;
    scored.push({ link: l, score: threadScore(l, a, b), bridge: ca && cb && ca !== cb ? 1 : 0 });
  }
  scored.sort((p, q) => q.bridge - p.bridge || q.score - p.score || (p.link.id < q.link.id ? -1 : 1));
  return scored.slice(0, n).map((s) => s.link);
}

// ---------------------------------------------------------------------------
// The buffers

export interface BlobBuildInput {
  /** Each course's graph to draw (the real layout or its stand-in). */
  graphs: ReadonlyMap<string, BlobGraph>;
  placements: readonly BlobPlacement[];
  params: BlobParams;
  /** Graphs still fading out while their course's new graph fades in (written with `gen = 0`). */
  outgoing?: ReadonlyMap<string, BlobGraph>;
}

interface Written {
  local: Map<string, Vec3>;
  visible: number;
  radiusSum: number;
}

export function buildBlobBuffers(input: BlobBuildInput): BlobBuffers;
/** @deprecated positional form kept for the lab's call sites. */
export function buildBlobBuffers(graphs: ReadonlyMap<string, BlobGraph>, placements: readonly BlobPlacement[], params: BlobParams, outgoing?: ReadonlyMap<string, BlobGraph>): BlobBuffers;
export function buildBlobBuffers(a: BlobBuildInput | ReadonlyMap<string, BlobGraph>, placements?: readonly BlobPlacement[], params?: BlobParams, outgoing?: ReadonlyMap<string, BlobGraph>): BlobBuffers {
  const input: BlobBuildInput = a instanceof Map ? { graphs: a, placements: placements!, params: params!, outgoing } : (a as BlobBuildInput);
  const { graphs } = input;
  const list = input.placements.filter((p) => graphs.has(p.courseId)).slice(0, MAX_BLOB_COURSES);
  let nodeTotal = 0;
  for (const p of list) {
    nodeTotal += graphs.get(p.courseId)!.nodes.length;
    nodeTotal += input.outgoing?.get(p.courseId)?.nodes.length ?? 0;
  }
  const threadsPer = Math.max(0, Math.floor(input.params.threads));
  const threadTotal = threadsPer * list.length;
  const points: BlobPointBuffers = {
    count: 0,
    local: new Float32Array(nodeTotal * 3),
    course: new Float32Array(nodeTotal),
    weight: new Float32Array(nodeTotal),
    alpha: new Float32Array(nodeTotal),
    radius: new Float32Array(nodeTotal),
    gen: new Float32Array(nodeTotal),
  };
  const threads: BlobThreadBuffers = {
    count: 0,
    local: new Float32Array(threadTotal * 2 * 3),
    course: new Float32Array(threadTotal * 2),
  };
  const courses: BlobCourse[] = [];
  const a0 = Math.min(0.6, Math.max(0.2, input.params.core));
  const depth = Math.min(1, Math.max(0.3, input.params.depth));
  let ni = 0;
  let ti = 0;
  let visibleTotal = 0;

  /** Write one graph's nodes for course `index` at `R`; the rng continues across the course's graphs so the lobes stay seeded per course. */
  const writeGraph = (g: BlobGraph, index: number, R: number, gen: 0 | 1, rng: Rng): Written => {
    const lobe = clusterDepths(g, rng);
    const local = new Map<string, Vec3>();
    let visible = 0;
    let radiusSum = 0;
    for (const n of g.nodes) {
      // 1. Normalise the 2D layout to the unit disc (Y up on screen, like the constellation).
      const u = (n.x - g.bounds.cx) / g.bounds.halfExtent;
      const v = -(n.y - g.bounds.cy) / g.bounds.halfExtent;
      const r2dRaw = Math.hypot(u, v);
      // 2. Plummer remap of the radius, angle kept (a corner node past the unit circle lands on the rim).
      const rr = plummerRadius(Math.min(1, r2dRaw), a0);
      const k = r2dRaw > 1e-6 ? rr / r2dRaw : 0;
      const x = u * k;
      const y = v * k;
      // 3. Depth: the cluster's lobe plus a jitter that shrinks toward the rim (a lens, not a drum).
      const lobeZ = n.clusterId ? (lobe.get(n.clusterId) ?? 0) : 0;
      const envelope = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      let z = (lobeZ * 0.8 + gaussian(rng) * 0.22) * envelope;
      z = Math.max(-envelope, Math.min(envelope, z));
      const rNorm = Math.min(1, Math.sqrt(x * x + y * y + z * z));
      // The face lies in the disc plane like the bead quads (layout x -> disc x, layout up -> disc -z); the lobes
      // stack along the disc normal (pattern-frame y), which leans toward the camera.
      const pos: Vec3 = [x * R, z * depth * R, -y * R];
      local.set(n.id, pos);
      const hidden = n.kind !== "concept" || n.weight < input.params.nodeWeight;
      // Brightness by weight in two steps + mastery warmth, capped under 1 so thirty additive core stars do not
      // blow to flat white. The innermost tenth leaves the light to the core glow quad (the marker).
      const coreEase = 0.6 + 0.4 * Math.min(1, Math.max(0, (rNorm - 0.1) / 0.3));
      const alpha = hidden ? 0 : (n.weight >= 0.65 ? 0.85 : 0.55) * (0.75 + 0.25 * (n.mastery ?? 0.5)) * coreEase;
      points.local[ni * 3] = pos[0];
      points.local[ni * 3 + 1] = pos[1];
      points.local[ni * 3 + 2] = pos[2];
      points.course[ni] = index;
      points.weight[ni] = n.weight;
      points.alpha[ni] = alpha;
      points.radius[ni] = rNorm;
      points.gen[ni] = gen;
      if (!hidden) {
        visible += 1;
        radiusSum += rNorm;
      }
      ni += 1;
    }
    return { local, visible, radiusSum };
  };

  list.forEach((p, index) => {
    const g = graphs.get(p.courseId)!;
    const rng = courseRng(input.params.seed, p.courseId);
    const { axis, omega } = tumbleFor(rng);
    const R = p.radius;
    const out = input.outgoing?.get(p.courseId);
    // The outgoing graph first (its lobes keep the depths they had: same rng state as when it was current).
    if (out) {
      const tumbleRng = courseRng(input.params.seed, p.courseId);
      tumbleFor(tumbleRng);
      writeGraph(out, index, R, 0, tumbleRng);
    }
    const w = writeGraph(g, index, R, 1, rng);
    let written = 0;
    for (const l of pickThreads(g, threadsPer)) {
      const pa = w.local.get(l.source);
      const pb = w.local.get(l.target);
      if (!pa || !pb) continue;
      threads.local.set(pa, ti * 6);
      threads.local.set(pb, ti * 6 + 3);
      threads.course[ti * 2] = index;
      threads.course[ti * 2 + 1] = index;
      ti += 1;
      written += 1;
    }
    visibleTotal += w.visible;
    courses.push({
      courseId: p.courseId,
      index,
      position: p.position,
      radius: R,
      axis,
      omega,
      condense: Math.min(1, Math.max(0, p.condense)),
      current: p.current,
      nodes: g.nodes.length,
      visible: w.visible,
      threads: written,
      meanRadius: w.visible ? w.radiusSum / w.visible : 0,
      swapping: !!out,
      origin: g.origin ?? "real",
    });
  });
  points.count = ni;
  threads.count = ti;
  return {
    points,
    threads,
    courses,
    budget: { draws: (ni > 0 ? 1 : 0) + (ti > 0 ? 1 : 0), courses: courses.length, points: ni, visiblePoints: visibleTotal, threads: ti },
  };
}

/** Rodrigues rotation of `p` about unit `axis` by `angle` (the shader's `rotateAxis`, for tests and CPU hit-testing). */
export function rotateAxis(p: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = axis[0] * p[0] + axis[1] * p[1] + axis[2] * p[2];
  const cx = axis[1] * p[2] - axis[2] * p[1];
  const cy = axis[2] * p[0] - axis[0] * p[2];
  const cz = axis[0] * p[1] - axis[1] * p[0];
  return [p[0] * c + cx * s + axis[0] * d * (1 - c), p[1] * c + cy * s + axis[1] * d * (1 - c), p[2] * c + cz * s + axis[2] * d * (1 - c)];
}

/** Blob placements from a bead list: the bead frame is the blob frame, radius scaled by `blobScale`. */
export function placementsFromBeads(beads: readonly CourseBead[], blobScale: number, condenseOf: (b: CourseBead) => number): BlobPlacement[] {
  return beads.map((b) => ({ courseId: b.courseId, position: b.position, radius: b.radius * blobScale, condense: condenseOf(b), current: b.kind === "current" }));
}

/** Crossfade weight 0 .. 1 for a swap that started at `startedAt` (ms), read at `now`: smoothstep over `BLOB_SWAP_MS`. */
export function swapMixAt(startedAt: number, now: number, durationMs = BLOB_SWAP_MS): number {
  const t = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
  return t * t * (3 - 2 * t);
}
