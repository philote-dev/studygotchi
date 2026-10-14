/**
 * Course graphs for the galaxy-altitude A/B (S3-3): the real settled 8.223
 * constellation from the 2D parity capture, plus plausible graphs for the
 * other fake courses, laid out by the SAME d3 code the product runs
 * (`lib/forceLayout` `createLayout` + `settle`), headlessly, in the browser or
 * in vitest. Pure: no three.js, no React.
 *
 * Why synthetic graphs and not a second real course: only 8.223 has a captured
 * settled layout in the repo (tools/qa/out/constellation-2d). The generator
 * below builds a concept graph with the shape the real one has (k topic
 * families, dense inside a family, a handful of prerequisite bridges between
 * families, a ring of resource nodes hanging off concepts) and lets d3 settle
 * it with the product's forces, so cluster spacing, blob sizes and edge lengths
 * come out of the same simulation as the real sky.
 */
import { createLayout, settle } from "@/lib/forceLayout";
import type { GraphModel, GraphModelLink, GraphModelNode } from "@/lib/graphModel";
import { mulberry32, type Rng } from "@/lib/stage/rng";
import type { TwinCluster, TwinLayout, TwinLink, TwinNode } from "@/lib/graph/twin/types";
import capture from "./data/8.223-zoomed-out.json";

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  /** Half of the larger extent (world units): the radius the graph is scaled by to fit a bead. */
  halfExtent: number;
}

/** One course's constellation as the twin draws it, plus the frame it is judged in. */
export interface CourseGraph extends TwinLayout {
  courseId: string;
  /** "real" = the parity capture of 8.223; "synthetic" = generated + settled here. */
  origin: "real" | "synthetic";
  bounds: GraphBounds;
  /** The 2D zoom (px per world unit) at which the twin's style rules are evaluated: the zoomed-out fit. */
  referenceZoom: number;
  /** node id -> cluster id (concepts only). */
  clusterOf: ReadonlyMap<string, string>;
}

/** The parity capture viewport the reference zoom is fitted to. */
export const REFERENCE_VIEWPORT = { w: 1440, h: 900 } as const;

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

/**
 * The zoomed-out zoom the 2D canvas lands on for a graph of these bounds: fit
 * the padded bounds to the reference viewport. For 8.223 the capture's own
 * camera is used instead (the same number within 15 %).
 */
export function fitZoom(b: GraphBounds, pad = 160): number {
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxY - b.minY + pad * 2;
  return Math.min(1, Math.max(0.12, Math.min(REFERENCE_VIEWPORT.w / w, REFERENCE_VIEWPORT.h / h)));
}

function adjacencyOf(links: readonly { source: string; target: string }[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let s = adjacency.get(a);
    if (!s) adjacency.set(a, (s = new Set()));
    s.add(b);
  };
  for (const l of links) {
    add(l.source, l.target);
    add(l.target, l.source);
  }
  return adjacency;
}

// ---------------------------------------------------------------------------
// The real course: 8.223 from the parity capture

interface CaptureNode {
  id: string;
  kind: "concept" | "resource";
  label: string;
  weight: number;
  radius: number;
  x: number;
  y: number;
  clusterId?: string;
  mastery?: number;
}

/** 8.223 Classical Mechanics II: 205 nodes, 343 links, 8 clusters, the settled positions of the 2D capture. */
export function realCourseGraph(courseId = "8.223"): CourseGraph {
  const nodes: TwinNode[] = (capture.nodes as CaptureNode[]).map((n) => ({ ...n }));
  const links: TwinLink[] = capture.links.map((l) => ({
    id: l.id,
    source: l.source,
    target: l.target,
    kind: l.kind as "concept" | "resource",
    // The capture does not carry the relation type; the backbone score treats these as undirected.
    directed: false,
    type: l.kind === "resource" ? "MENTIONS" : "RELATED",
  }));
  const clusters: TwinCluster[] = capture.clusters.map((c) => ({ id: c.id, label: c.label, x: c.x, y: c.y, count: c.count, mastery: c.mastery }));
  const clusterOf = new Map<string, string>();
  for (const n of capture.nodes as CaptureNode[]) if (n.clusterId) clusterOf.set(n.id, n.clusterId);
  const bounds = boundsOf(nodes);
  return { courseId, origin: "real", nodes, links, clusters, adjacency: adjacencyOf(links), bounds, referenceZoom: capture.camera.k, clusterOf };
}

// ---------------------------------------------------------------------------
// Synthetic courses: a plausible concept graph, settled by the product's d3 forces

const FAMILY_WORDS = ["Kinematics", "Fields", "Operators", "Series", "Spaces", "Proofs", "Grammar", "Verbs", "Types", "Recursion", "Markets", "Cells", "Bonds", "Ethics", "Waves", "Matrices", "Graphs", "Limits", "Particles", "Rhythm"];
const CONCEPT_WORDS = ["theorem", "lemma", "rule", "law", "form", "identity", "method", "model", "map", "flow", "norm", "basis", "mode", "phase", "state", "cycle", "bound", "chain", "frame", "order"];

export interface SyntheticGraphOptions {
  /** 60 .. 220 total nodes (concepts + resources). */
  nodeCount: number;
  /** Topic families (clusters). Defaults from the node count: 4 .. 9. */
  clusterCount?: number;
  /** Share of nodes that are resources (files hanging off concepts). */
  resourceShare?: number;
  /** Ticks for `settle`; the product's default is 420. */
  ticks?: number;
}

interface SynthNode {
  id: string;
  kind: "concept" | "resource";
  label: string;
  radius: number;
  weight: number;
  family: number;
  mastery: number;
}

/** Build the graph model the product's layout consumes (only the fields `createLayout` reads are real). */
export function synthGraphModel(seed: number, opts: SyntheticGraphOptions): { model: GraphModel; nodes: SynthNode[]; families: string[] } {
  const rng = mulberry32(seed >>> 0);
  const total = Math.max(8, Math.round(opts.nodeCount));
  const resourceShare = opts.resourceShare ?? 0.1;
  const resources = Math.round(total * resourceShare);
  const concepts = total - resources;
  const k = opts.clusterCount ?? Math.min(9, Math.max(4, Math.round(3 + concepts / 28)));
  const families = pickDistinct(rng, FAMILY_WORDS, k).map((w, i) => `${w} ${i + 1}`);

  // Family sizes: a Zipf-ish split so one family dominates, like the real course (37 / 33 / 32 / 23 ... 8).
  const weights = families.map((_, i) => 1 / Math.pow(i + 1, 0.55) + rng() * 0.15);
  const sum = weights.reduce((a, b) => a + b, 0);
  const sizes = weights.map((w) => Math.max(3, Math.round((w / sum) * concepts)));
  while (sizes.reduce((a, b) => a + b, 0) > concepts) sizes[sizes.indexOf(Math.max(...sizes))] -= 1;
  while (sizes.reduce((a, b) => a + b, 0) < concepts) sizes[sizes.indexOf(Math.min(...sizes))] += 1;

  const nodes: SynthNode[] = [];
  const byFamily: string[][] = families.map(() => []);
  sizes.forEach((size, f) => {
    for (let i = 0; i < size; i++) {
      const id = `${seed.toString(16)}-c${f}-${i}`;
      const weight = Math.round((0.3 + 0.7 * Math.pow(rng(), 0.6)) * 10) / 10;
      // 2D canvas concept radii run 18 .. 43 from familiarity.
      const radius = 18 + 25 * Math.pow(rng(), 1.4);
      nodes.push({ id, kind: "concept", label: `${pickOne(rng, CONCEPT_WORDS)} ${i + 1}`, radius, weight, family: f, mastery: Math.min(1, Math.max(0, 0.5 + 0.3 * gaussianish(rng))) });
      byFamily[f].push(id);
    }
  });

  const links: GraphModelLink[] = [];
  const seen = new Set<string>();
  const link = (a: string, b: string, kind: "concept" | "resource", type: string, directed: boolean) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ id: `${kind === "resource" ? "r" : "c"}:${a}->${b}`, source: a, target: b, kind, type, directed, origin: "course" });
  };
  // Inside a family: a spanning chain plus ~0.8 extra edges per node, a quarter of them prerequisites.
  byFamily.forEach((ids) => {
    for (let i = 1; i < ids.length; i++) {
      const j = Math.floor(rng() * i);
      const prereq = rng() < 0.3;
      link(ids[j], ids[i], "concept", prereq ? "PREREQUISITE_FOR" : "RELATED", prereq);
    }
    const extra = Math.round(ids.length * 0.8);
    for (let e = 0; e < extra; e++) {
      const a = ids[Math.floor(rng() * ids.length)];
      const b = ids[Math.floor(rng() * ids.length)];
      const prereq = rng() < 0.25;
      link(a, b, "concept", prereq ? "BUILDS_ON" : "RELATED", prereq);
    }
  });
  // Between families: one or two bridges per neighbouring pair (prerequisites, so they read as the backbone).
  for (let f = 0; f < families.length; f++) {
    for (let g = f + 1; g < families.length; g++) {
      const bridges = rng() < 0.55 ? 1 : rng() < 0.4 ? 2 : 0;
      for (let b = 0; b < bridges; b++) {
        link(pickOne(rng, byFamily[f]), pickOne(rng, byFamily[g]), "concept", "PREREQUISITE_FOR", true);
      }
    }
  }
  // Resources: each hangs off one to three concepts of one family.
  for (let r = 0; r < resources; r++) {
    const f = Math.floor(rng() * families.length);
    const id = `${seed.toString(16)}-r${r}`;
    nodes.push({ id, kind: "resource", label: `notes ${r + 1}.pdf`, radius: 14, weight: 0.3, family: f, mastery: 0.5 });
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) link(id, pickOne(rng, byFamily[f]), "resource", "MENTIONS", false);
  }

  const modelNodes = nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, radius: n.radius, weight: n.weight }) as unknown as GraphModelNode);
  const byId = new Map(modelNodes.map((n) => [n.id, n]));
  const adjacency = adjacencyOf(links);
  const incident = new Map<string, Set<string>>();
  for (const l of links) {
    (incident.get(l.source) ?? incident.set(l.source, new Set()).get(l.source)!).add(l.id);
    (incident.get(l.target) ?? incident.set(l.target, new Set()).get(l.target)!).add(l.id);
  }
  return { model: { nodes: modelNodes, links, byId, adjacency, incident }, nodes, families };
}

/**
 * Generate and settle one synthetic course with the product's layout
 * (`createLayout` seeds positions from the node ids, d3-force's default
 * random source is a fixed LCG, so the result is deterministic per seed).
 */
export function syntheticCourseGraph(courseId: string, seed: number, opts: SyntheticGraphOptions): CourseGraph {
  const { model, nodes: synth, families } = synthGraphModel(seed, opts);
  const layout = createLayout(model);
  settle(layout, opts.ticks ?? 420);
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const nodes: TwinNode[] = synth.map((n) => {
    const p = pos.get(n.id)!;
    return { id: n.id, kind: n.kind, label: n.label, weight: n.weight, radius: n.radius, x: p.x, y: p.y, cluster: families[n.family], clusterId: `${courseId}:f${n.family}`, mastery: n.mastery };
  });
  const links: TwinLink[] = model.links.map((l) => ({ id: l.id, source: l.source, target: l.target, kind: l.kind, directed: l.directed, type: l.type }));
  const clusters: TwinCluster[] = families.map((label, f) => {
    const members = nodes.filter((n) => n.kind === "concept" && n.clusterId === `${courseId}:f${f}`);
    const cx = members.reduce((s, n) => s + n.x, 0) / Math.max(1, members.length);
    const cy = members.reduce((s, n) => s + n.y, 0) / Math.max(1, members.length);
    const mastery = members.reduce((s, n) => s + (n.mastery ?? 0.5), 0) / Math.max(1, members.length);
    return { id: `${courseId}:f${f}`, label, x: cx, y: cy, count: members.length, mastery };
  });
  const clusterOf = new Map<string, string>();
  for (const n of nodes) if (n.kind === "concept" && n.clusterId) clusterOf.set(n.id, n.clusterId);
  const bounds = boundsOf(nodes);
  return { courseId, origin: "synthetic", nodes, links, clusters, adjacency: adjacencyOf(links), bounds, referenceZoom: fitZoom(bounds), clusterOf };
}

/** Node count for a fake course: its concept count plus files, inside the 60 .. 220 band. */
export function nodeCountFor(concepts: number, rng: Rng): number {
  // The fake list runs 18 .. 90 concepts; the real 8.223 has 64 concepts in the identity and 205 nodes in the graph (sub-concepts + files).
  const scale = 2.3 + rng() * 1.2;
  return Math.round(Math.min(220, Math.max(60, concepts * scale)));
}

export interface CourseSpec {
  id: string;
  concepts: number;
}

/**
 * Graphs for a course list: the real capture for `realId`, a settled
 * synthetic graph (seeded by course id and the galaxy seed) for everything
 * else. Cost: ~40 .. 120 ms per course on a laptop (420 d3 ticks); 11 courses
 * settle in well under two seconds, so the lab does this at mount.
 */
export function courseGraphsFor(courses: readonly CourseSpec[], seed: number, realId = "8.223"): Map<string, CourseGraph> {
  const out = new Map<string, CourseGraph>();
  for (const c of courses) {
    if (c.id === realId) {
      out.set(c.id, realCourseGraph(c.id));
      continue;
    }
    const courseSeed = (seed ^ hashText(c.id)) >>> 0;
    const rng = mulberry32(courseSeed);
    out.set(c.id, syntheticCourseGraph(c.id, courseSeed, { nodeCount: nodeCountFor(c.concepts, rng) }));
  }
  return out;
}

// ---------------------------------------------------------------------------

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickOne<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function pickDistinct<T>(rng: Rng, items: readonly T[], n: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/** Cheap symmetric noise in roughly [-1.5, 1.5] (sum of three uniforms). */
function gaussianish(rng: Rng): number {
  return rng() + rng() + rng() - 1.5;
}
