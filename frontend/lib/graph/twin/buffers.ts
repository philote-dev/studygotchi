/**
 * Render buffers for the WebGL twin, built from the 2D canvas's layout with the
 * 2D canvas's rules. Pure: typed arrays in, no GL. World positions stay in
 * world units (the orthographic camera from `camera.ts` maps them); every
 * radius, width and inset is in CSS px, exactly the numbers `KnowledgeCanvas`
 * hands to Canvas2D, so the shaders only divide by the zoom to place them.
 */

import { clipSpaceLabel, clusterLabelBudget, nodeLabelBudget, spaceLabelLayer } from "@/lib/constellationLabels";
import type { SpacePalette } from "@/lib/graphTheme";
import { screenFromWorld, worldFromScreen } from "./camera";
import { condenseGlyph } from "./condense";
import {
  alphaFor,
  dustStyle,
  edgeCurvePx,
  edgeStyle,
  focusSetFor,
  nodeStyle,
  parseColor,
  rayAngle,
  routeEdgeKeys,
  starProfile,
} from "./style";
import type { Camera2D, TwinDrawState, TwinLayout, TwinLink, TwinNode, TwinSize } from "./types";

// ---------------------------------------------------------------------------
// Dust

export interface DustBuffers {
  count: number;
  /** World x, y per cluster. */
  position: Float32Array;
  /** Gradient radius in CSS px. */
  radius: Float32Array;
  /** Tint rgb (0-1) and the centre alpha. */
  color: Float32Array;
}

export function buildDust(layout: TwinLayout, cam: Camera2D, palette: SpacePalette, fade = 1): DustBuffers {
  const n = fade <= 0 ? 0 : layout.clusters.length;
  const position = new Float32Array(n * 2);
  const radius = new Float32Array(n);
  const color = new Float32Array(n * 4);
  layout.clusters.slice(0, n).forEach((cluster, i) => {
    const style = dustStyle(cluster, cam.k, palette);
    const { r, g, b } = parseColor(style.tint);
    position[i * 2] = cluster.x;
    position[i * 2 + 1] = cluster.y;
    radius[i] = style.radius;
    color[i * 4] = r / 255;
    color[i * 4 + 1] = g / 255;
    color[i * 4 + 2] = b / 255;
    color[i * 4 + 3] = style.core * fade;
  });
  return { count: n, position, radius, color };
}

// ---------------------------------------------------------------------------
// Nodes

export interface NodeBuffers {
  /** One instance per layout node (hidden ones carry alpha 0). */
  count: number;
  position: Float32Array;
  /** Core disc radius, CSS px, pop scale applied. */
  core: Float32Array;
  /** Glow gradient radius, CSS px, active widening and pop scale applied. */
  glow: Float32Array;
  /** Ray half-length in CSS px (0 = no rays) and the ray angle. */
  rayLength: Float32Array;
  rayAngle: Float32Array;
  /** Star opacity (gradient centre) and the frame alpha (focus dim). */
  opacity: Float32Array;
  alpha: Float32Array;
  /** Rgb (0-1) of `palette.star`. */
  starColor: [number, number, number];
}

export function buildNodes(layout: TwinLayout, cam: Camera2D, state: TwinDrawState, palette: SpacePalette): NodeBuffers {
  const n = layout.nodes.length;
  const position = new Float32Array(n * 2);
  const core = new Float32Array(n);
  const glow = new Float32Array(n);
  const rayLength = new Float32Array(n);
  const angle = new Float32Array(n);
  const opacity = new Float32Array(n);
  const alpha = new Float32Array(n);
  const ctx = {
    zoom: cam.k,
    layer: spaceLabelLayer(cam.k),
    focusSet: focusSetFor(layout, state),
    selectedId: state.selectedId,
    routeSet: new Set(state.routeIds),
    arrivingAgeMs: state.arrivingAgeMs,
  };
  const blend = state.condense?.blend ?? 0;
  layout.nodes.forEach((node, i) => {
    const style = nodeStyle(node, ctx);
    position[i * 2] = node.x;
    position[i * 2 + 1] = node.y;
    let c = style.profile.core * style.scale;
    let g = style.profile.glow * (style.active ? 1.22 : 1) * style.scale;
    let ray = style.profile.rays ? style.profile.glow * 0.85 * style.scale : 0;
    if (blend > 0) ({ core: c, glow: g, rayLength: ray } = condenseGlyph(c, g, ray, blend));
    core[i] = c;
    glow[i] = g;
    rayLength[i] = ray;
    angle[i] = rayAngle(node.id);
    opacity[i] = style.profile.opacity;
    alpha[i] = style.hidden ? 0 : style.alpha;
  });
  const star = parseColor(palette.star);
  return { count: n, position, core, glow, rayLength, rayAngle: angle, opacity, alpha, starColor: [star.r / 255, star.g / 255, star.b / 255] };
}

// ---------------------------------------------------------------------------
// Edges

/** Samples per quadratic edge (segments + 1). */
export const EDGE_SAMPLES = 13;
export const EDGE_VERTS = EDGE_SAMPLES * 2;
export const EDGE_INDICES = (EDGE_SAMPLES - 1) * 6;

export interface EdgeBuffers {
  /** Edges drawn as solid strokes this frame (packed first). */
  count: number;
  /** Buffer capacity in edges (= links in the layout). */
  capacity: number;
  /** World x, y, 0 per vertex. */
  position: Float32Array;
  /** Unit normal (screen direction == world direction) per vertex. */
  normal: Float32Array;
  /** −1 / +1: which side of the centreline. */
  side: Float32Array;
  /** Half stroke width in CSS px. */
  half: Float32Array;
  /** Straight rgba (0-1), alpha already multiplied by the frame alpha. */
  color: Float32Array;
  /** Arc length in CSS px from the edge start (for dash phases). */
  along: Float32Array;
  index: Uint32Array;
  /** Links marked as weak traces this frame (drawn dashed by the weak pass; T-3). */
  weak: number;
}

export function allocEdgeBuffers(capacity: number): EdgeBuffers {
  const index = new Uint32Array(capacity * EDGE_INDICES);
  for (let e = 0; e < capacity; e += 1) {
    const base = e * EDGE_VERTS;
    for (let s = 0; s < EDGE_SAMPLES - 1; s += 1) {
      const o = e * EDGE_INDICES + s * 6;
      const a = base + s * 2;
      index[o] = a;
      index[o + 1] = a + 1;
      index[o + 2] = a + 2;
      index[o + 3] = a + 1;
      index[o + 4] = a + 3;
      index[o + 5] = a + 2;
    }
  }
  return {
    count: 0,
    capacity,
    position: new Float32Array(capacity * EDGE_VERTS * 3),
    normal: new Float32Array(capacity * EDGE_VERTS * 2),
    side: new Float32Array(capacity * EDGE_VERTS),
    half: new Float32Array(capacity * EDGE_VERTS),
    color: new Float32Array(capacity * EDGE_VERTS * 4),
    along: new Float32Array(capacity * EDGE_VERTS),
    index,
    weak: 0,
  };
}

/**
 * Fill `out` (from `allocEdgeBuffers(layout.links.length)`) with this frame's
 * solid edges. Geometry follows the 2D canvas: endpoints inset by `core + 1` px
 * along the chord, a quadratic bow of `edgeCurvePx` px, computed in screen px
 * and converted back to world units so the world-space camera draws it.
 */
export function buildEdges(
  layout: TwinLayout,
  cam: Camera2D,
  size: TwinSize,
  state: TwinDrawState,
  palette: SpacePalette,
  out: EdgeBuffers,
  nodeIndex: ReadonlyMap<string, TwinNode> = new Map(layout.nodes.map((n) => [n.id, n])),
): EdgeBuffers {
  if (out.capacity < layout.links.length) throw new Error(`edge buffers hold ${out.capacity} edges, layout has ${layout.links.length}`);
  const ctx = {
    zoom: cam.k,
    focusSet: focusSetFor(layout, state),
    routeEdges: routeEdgeKeys(state.routeIds),
    weakTraces: new Set(state.weakTraceIds),
    palette,
  };
  const toWorld = (x: number, y: number) => worldFromScreen(cam, size, x, y);
  const fade = state.condense?.edges ?? 1;
  let drawn = 0;
  let weak = 0;
  for (const link of layout.links) {
    const a = nodeIndex.get(link.source);
    const b = nodeIndex.get(link.target);
    if (!a || !b) continue;
    const style = edgeStyle(link, a, b, ctx);
    if (style.weak) weak += 1;
    if (!style.keep || fade <= 0) continue;
    const rgba = parseColor(style.color);
    writeStrip(out, drawn, edgeCurve(link, a, b, cam, size), style.width / 2, rgba, rgba.a * style.alpha * fade, toWorld);
    drawn += 1;
  }
  out.count = drawn;
  out.weak = weak;
  return out;
}

/**
 * The weak-trace pass (KnowledgeCanvas `weakDraw`): every link the weak lens
 * lists, kept or not, as a 2.4 px stroke in `palette.live` at
 * `max(0.78, 0.62 + pulse·0.38)`; the mesh draws it dashed `[5, 9]` with
 * `lineDashOffset = −now / 86`. Fill `out` from `allocEdgeBuffers(links)`.
 */
export function buildWeakEdges(
  layout: TwinLayout,
  cam: Camera2D,
  size: TwinSize,
  state: TwinDrawState,
  palette: SpacePalette,
  pulse: number,
  out: EdgeBuffers,
  nodeIndex: ReadonlyMap<string, TwinNode> = new Map(layout.nodes.map((n) => [n.id, n])),
): EdgeBuffers {
  const traces = new Set(state.weakTraceIds);
  const live = parseColor(palette.live);
  const alpha = Math.max(0.78, 0.62 + pulse * 0.38) * (state.condense?.edges ?? 1);
  const toWorld = (x: number, y: number) => worldFromScreen(cam, size, x, y);
  let drawn = 0;
  if (traces.size > 0 && alpha > 0) {
    for (const link of layout.links) {
      if (!traces.has(link.id)) continue;
      const a = nodeIndex.get(link.source);
      const b = nodeIndex.get(link.target);
      if (!a || !b) continue;
      writeStrip(out, drawn, edgeCurve(link, a, b, cam, size), 1.2, live, live.a * alpha, toWorld);
      drawn += 1;
    }
  }
  out.count = drawn;
  out.weak = drawn;
  return out;
}

/** `lineDashOffset` of the weak traces at draw clock `now` (ms). */
export function weakDashOffset(now: number): number {
  return -(now / 86);
}

export const WEAK_DASH: readonly [number, number] = [5, 9];

interface Quadratic {
  ax: number;
  ay: number;
  cx: number;
  cy: number;
  bx: number;
  by: number;
  angle: number;
}

/** The 2D canvas's edge path in screen px: endpoints inset by `core + 1`, mid-point bowed by `edgeCurvePx`. */
function edgeCurve(link: TwinLink, a: TwinNode, b: TwinNode, cam: Camera2D, size: TwinSize): Quadratic {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const aProfile = starProfile(a.id, a.radius, a.kind, cam.k);
  const bProfile = starProfile(b.id, b.radius, b.kind, cam.k);
  const sa = screenFromWorld(cam, size, a.x, a.y);
  const sb = screenFromWorld(cam, size, b.x, b.y);
  const ax = sa.sx + Math.cos(angle) * (aProfile.core + 1);
  const ay = sa.sy + Math.sin(angle) * (aProfile.core + 1);
  const bx = sb.sx - Math.cos(angle) * (bProfile.core + 1);
  const by = sb.sy - Math.sin(angle) * (bProfile.core + 1);
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const curve = edgeCurvePx(link.id, cam.k);
  return { ax, ay, cx: mx - Math.sin(angle) * curve, cy: my + Math.cos(angle) * curve, bx, by, angle };
}

/** Sample the quadratic into strip slot `slot` of `out` (world positions, px widths, straight rgba). */
function writeStrip(
  out: EdgeBuffers,
  slot: number,
  q: Quadratic,
  half: number,
  rgba: { r: number; g: number; b: number },
  alpha: number,
  toWorld: (x: number, y: number) => { x: number; y: number },
): void {
  const r = rgba.r / 255;
  const g = rgba.g / 255;
  const bl = rgba.b / 255;
  let along = 0;
  let px = q.ax;
  let py = q.ay;
  for (let s = 0; s < EDGE_SAMPLES; s += 1) {
    const t = s / (EDGE_SAMPLES - 1);
    const u = 1 - t;
    const x = u * u * q.ax + 2 * u * t * q.cx + t * t * q.bx;
    const y = u * u * q.ay + 2 * u * t * q.cy + t * t * q.by;
    let tx = 2 * u * (q.cx - q.ax) + 2 * t * (q.bx - q.cx);
    let ty = 2 * u * (q.cy - q.ay) + 2 * t * (q.by - q.cy);
    const len = Math.hypot(tx, ty);
    if (len > 1e-9) {
      tx /= len;
      ty /= len;
    } else {
      tx = Math.cos(q.angle);
      ty = Math.sin(q.angle);
    }
    if (s > 0) along += Math.hypot(x - px, y - py);
    px = x;
    py = y;
    const world = toWorld(x, y);
    for (let side = 0; side < 2; side += 1) {
      const v = slot * EDGE_VERTS + s * 2 + side;
      out.position[v * 3] = world.x;
      out.position[v * 3 + 1] = world.y;
      out.position[v * 3 + 2] = 0;
      out.normal[v * 2] = -ty;
      out.normal[v * 2 + 1] = tx;
      out.side[v] = side === 0 ? -1 : 1;
      out.half[v] = half;
      out.color[v * 4] = r;
      out.color[v * 4 + 1] = g;
      out.color[v * 4 + 2] = bl;
      out.color[v * 4 + 3] = alpha;
      out.along[v] = along;
    }
  }
}

// ---------------------------------------------------------------------------
// Labels

export interface TwinLabel {
  kind: "cluster" | "node";
  id: string;
  text: string;
  /** Anchor in CSS px: `textAlign` left or center, `textBaseline` middle. */
  x: number;
  y: number;
  align: "left" | "center";
  size: number;
  weight: number;
  face: "display" | "ui";
  /** The CSS font shorthand the 2D canvas measured and painted with. */
  font: string;
  color: string;
  alpha: number;
  /** Measured text width in CSS px. */
  width: number;
  /** The collision box the 2D canvas recorded (`paintLabel`). */
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface LabelFaces {
  display: string;
  ui: string;
}

export interface LabelPlacement {
  labels: TwinLabel[];
  /** The 2D canvas's cluster-label hit boxes (box padded by 10 / 8), for T-3. */
  clusterBoxes: { x0: number; y0: number; x1: number; y1: number; memberIds: string[] }[];
}

/**
 * The label pass of the 2D draw loop: cluster names in the cluster layer, then
 * node names by forced / weight order, each skipped when it collides with one
 * already placed (unless forced). `measure(text, font)` is `ctx.measureText`.
 */
export function placeLabels(
  layout: TwinLayout & { clusterMembers?: ReadonlyMap<string, readonly string[]> },
  cam: Camera2D,
  size: TwinSize,
  state: TwinDrawState,
  palette: SpacePalette,
  faces: LabelFaces,
  measure: (text: string, font: string) => number,
): LabelPlacement {
  const { w, h } = size;
  const layer = spaceLabelLayer(cam.k);
  const clusterFade = state.condense?.clusterLabels ?? 1;
  const nodeFade = state.condense?.nodeLabels ?? 1;
  const focusSet = focusSetFor(layout, state);
  const routeSet = new Set(state.routeIds);
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const labels: TwinLabel[] = [];
  const clusterBoxes: LabelPlacement["clusterBoxes"] = [];

  const paint = (
    kind: TwinLabel["kind"],
    id: string,
    text: string,
    labelX: number,
    labelY: number,
    labelSize: number,
    weight: number,
    face: "display" | "ui",
    fill: string,
    align: "left" | "center",
    alpha: number,
    forced: boolean,
  ): TwinLabel | null => {
    const font = `${weight} ${labelSize}px ${face === "display" ? faces.display : faces.ui}`;
    const tw = measure(text, font);
    const left = align === "center" ? labelX - tw / 2 : labelX;
    const box = { x0: left - 3, y0: labelY - labelSize / 2 - 2, x1: left + tw + 3, y1: labelY + labelSize / 2 + 2 };
    const collides = placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
    if (collides && !forced) return null;
    placed.push(box);
    const label: TwinLabel = { kind, id, text, x: labelX, y: labelY, align, size: labelSize, weight, face, font, color: fill, alpha, width: tw, box };
    labels.push(label);
    return label;
  };

  if (layer === "clusters" && clusterFade > 0) {
    for (const cluster of layout.clusters) {
      const { sx, sy } = screenFromWorld(cam, size, cluster.x, cluster.y);
      if (sx < -80 || sy < -40 || sx > w + 80 || sy > h + 40) continue;
      const labelSize = cam.k > 0.55 ? 13 : 12;
      const label = paint(
        "cluster",
        cluster.id,
        clipSpaceLabel(cluster.label, clusterLabelBudget(cam.k)),
        sx,
        sy - 18,
        labelSize,
        700,
        "display",
        palette.labelStrong,
        "center",
        clusterFade,
        false,
      );
      if (label) {
        clusterBoxes.push({
          x0: label.box.x0 - 10,
          y0: label.box.y0 - 8,
          x1: label.box.x1 + 10,
          y1: label.box.y1 + 8,
          memberIds: [...(layout.clusterMembers?.get(cluster.id) ?? [])],
        });
      }
    }
  }

  interface Candidate {
    node: TwinNode;
    forced: boolean;
    text: string;
    size: number;
    sx: number;
    sy: number;
  }
  const candidates: Candidate[] = [];
  const labelThreshold = cam.k > 1.6 ? -1 : cam.k > 1.15 ? 0.35 : 0.62;
  for (const node of nodeFade > 0 ? layout.nodes : []) {
    const forced = state.selectedId === node.id || state.hoveredId === node.id || routeSet.has(node.id);
    if (layer === "clusters" && !forced) continue;
    if (!forced && node.kind === "resource" && cam.k < 1.25) continue;
    if (!forced && node.weight < labelThreshold) continue;
    if (!forced && focusSet && !focusSet.has(node.id)) continue;
    const { sx, sy } = screenFromWorld(cam, size, node.x, node.y);
    if (sx < -80 || sy < -80 || sx > w + 80 || sy > h + 80) continue;
    candidates.push({
      node,
      forced,
      text: clipSpaceLabel(node.label, nodeLabelBudget(cam.k, forced)),
      size: node.kind === "concept" ? 11.5 : 10.5,
      sx,
      sy,
    });
  }
  candidates.sort((a, b) => {
    if (a.forced !== b.forced) return a.forced ? -1 : 1;
    return b.node.weight - a.node.weight;
  });
  for (const c of candidates) {
    const profile = starProfile(c.node.id, c.node.radius, c.node.kind, cam.k);
    paint(
      "node",
      c.node.id,
      c.text,
      c.sx + profile.glow * 0.56 + 5,
      c.sy + 1,
      c.size,
      c.forced ? 600 : 500,
      "ui",
      c.forced ? palette.labelStrong : c.node.kind === "concept" ? palette.label : palette.labelDim,
      "left",
      alphaFor(c.node.id, focusSet) * nodeFade,
      c.forced,
    );
  }

  return { labels, clusterBoxes };
}
