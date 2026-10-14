"use client";

/**
 * Each course's graph for the blobs: the SETTLED CONSTELLATION LAYOUT of the
 * course when it is known, a deterministic seeded stand-in with the same
 * node count until then.
 *
 * Sources, in order:
 *   1. The constellation bridge: the 2D canvas's own layout of the identity's
 *      course while /knowledge is mounted (exactly what the twin draws).
 *   2. The layout service (`lib/graph/worker`): the course's knowledge graph
 *      (`seededKnowledgeGraph`, the pipeline copy the store itself seeds from)
 *      built into the product's `GraphModel` and settled by hash: a cache hit
 *      applies at once, otherwise the Worker settles it (the same request the
 *      hop's `warmConstellationLayout` makes) and the positions land later.
 *   3. `standInGraph(courseId, conceptCount)` meanwhile, and for courses with
 *      no graph at all.
 *
 * A real graph replaces a stand-in as a NEW map entry; `CourseBlobs`
 * crossfades the two over `BLOB_SWAP_MS`. Real graphs are keyed by layout
 * hash so the same positions never re-enter the map as a new object.
 */
import { useEffect, useMemo, useState } from "react";
import { seededKnowledgeGraph } from "@/lib/api";
import { createLayout, type Layout } from "@/lib/forceLayout";
import { blobGraphFromPositions, standInGraph, type BlobGraph, type BlobGraphLink, type BlobGraphNode } from "@/lib/galaxy/blobs";
import type { GalaxyCourse } from "@/lib/galaxy/layout";
import { constellationBridge } from "@/lib/graph/twin/bridge";
import { buildGraphModel, type GraphModel } from "@/lib/graphModel";

/** The cluster a concept belongs to for the lobes: its broader sky name first (the twin's label families), then its cluster. */
export function conceptClusterId(node: GraphModel["nodes"][number]): string | null {
  if (node.kind !== "concept") return null;
  const c = node.concept;
  if (c.constellation) return `family:${c.constellation}`;
  return c.cluster_id ?? c.cluster ?? null;
}

/** A blob graph from a positioned layout and the model it was built from (pure; the bridge and the service both give these). */
export function blobGraphFromLayout(courseId: string, layout: Pick<Layout, "nodes">, model: Pick<GraphModel, "links">, origin = "real"): BlobGraph {
  const nodes: BlobGraphNode[] = layout.nodes.map((n) => ({
    id: n.id,
    kind: n.node.kind,
    x: n.x,
    y: n.y,
    weight: Math.min(1, Math.max(0, n.node.weight)),
    clusterId: conceptClusterId(n.node),
    mastery: n.node.kind === "concept" ? n.node.concept.mastery : null,
  }));
  const links: BlobGraphLink[] = model.links.map((l) => ({ id: l.id, source: l.source, target: l.target, kind: l.kind, directed: l.directed, type: l.type }));
  return blobGraphFromPositions(courseId, nodes, links, origin);
}

interface RealEntry {
  hash: string;
  graph: BlobGraph;
}

/**
 * Graphs for the galaxy's courses, by course id: real where known, stand-ins
 * elsewhere, swapping to real as settles land. Stable: an entry only changes
 * object identity when its positions change.
 */
export function useCourseGraphs(courses: readonly GalaxyCourse[], currentCourseId: string | null): ReadonlyMap<string, BlobGraph> {
  const [real, setReal] = useState<ReadonlyMap<string, RealEntry>>(() => new Map());
  const ids = useMemo(() => courses.map((c) => c.id).join("|"), [courses]);

  // Source 2: the layout service, per course with a knowledge graph.
  useEffect(() => {
    const layouts = constellationBridge.layouts;
    const wanted = new Map<string, { hash: string; layout: Layout; model: GraphModel }>();
    for (const course of courses) {
      const graph = seededKnowledgeGraph(course.id);
      if (!graph) continue;
      const model = buildGraphModel(graph, []);
      if (model.nodes.length === 0) continue;
      const hash = layouts.hashOf(model);
      wanted.set(course.id, { hash, layout: createLayout(model), model });
    }
    const land = (courseId: string, hash: string, layout: Layout, model: GraphModel) => {
      setReal((prev) => {
        const have = prev.get(courseId);
        if (have && have.hash === hash) return prev;
        const next = new Map(prev);
        next.set(courseId, { hash, graph: blobGraphFromLayout(courseId, layout, model) });
        return next;
      });
    };
    // Cache hits apply now (synchronously, no Worker round trip); the rest go to the Worker.
    const was = layouts.defer;
    layouts.defer = true;
    try {
      for (const [courseId, w] of wanted) {
        const outcome = layouts.settle(w.layout, w.model);
        if (outcome.path !== "worker") land(courseId, w.hash, w.layout, w.model);
      }
    } finally {
      layouts.defer = was;
    }
    const off = layouts.onSettled((layout, hash) => {
      for (const [courseId, w] of wanted) if (w.hash === hash && w.layout === layout) land(courseId, hash, layout, w.model);
    });
    return off;
    // The course list by id is what matters; stats changes (mastery, counts) do not re-settle anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // Source 1: the constellation bridge for the current course while a 2D canvas is mounted and settled.
  useEffect(() => {
    if (!currentCourseId) return;
    return constellationBridge.subscribe((state) => {
      if (!state || constellationBridge.layouts.isPending(state.layout)) return;
      if (state.layout.nodes.length === 0) return;
      const hash = `bridge:${constellationBridge.layouts.hashOf(state.model)}`;
      setReal((prev) => {
        const have = prev.get(currentCourseId);
        if (have && have.hash === hash) return prev;
        const next = new Map(prev);
        next.set(currentCourseId, { hash, graph: blobGraphFromLayout(currentCourseId, state.layout, state.model) });
        return next;
      });
    });
  }, [currentCourseId]);

  // Stand-ins are cached by (course, node count): the same object every render, so a stats refresh or a
  // course-list change never reads as a graph swap.
  const [standIns] = useState(() => new Map<string, BlobGraph>());
  return useMemo(() => {
    const out = new Map<string, BlobGraph>();
    for (const course of courses) {
      const entry = real.get(course.id);
      if (entry) {
        out.set(course.id, entry.graph);
        continue;
      }
      const count = Math.max(1, Math.round(course.conceptCount));
      const key = `${course.id}:${count}`;
      let g = standIns.get(key);
      if (!g) standIns.set(key, (g = standInGraph(course.id, count)));
      out.set(course.id, g);
    }
    return out;
  }, [courses, real, standIns]);
}
