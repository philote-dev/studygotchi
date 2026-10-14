/**
 * Pure helpers behind `GalaxyLayer`: framing, budgets and the bead instance
 * list. No three.js objects, so they run in vitest; the components turn the
 * instance list into one InstancedMesh.
 */
import { type GalaxyFeatures, galaxyDrawCalls, totalGalaxyPoints, type GalaxyBuffers, DRAW_CALL_BUDGET, POINT_BUDGET } from "@/lib/galaxy/points";
import type { GalaxyLayout, Vec3 } from "@/lib/galaxy/layout";
import type { CoursePalette } from "@/lib/galaxy/palettes";

export const STAGE_FOV_DEG = 40;
/** Camera distance (disc radii) the lab hero was tuned at; the far layer's parallax scale is relative to it. */
export const HERO_CAMERA_DISTANCE = 3.3;
/** The galaxy draws after the sky layer (sky uses -1..1) whatever order the layers mount in. */
export const GALAXY_RENDER_ORDER = 10;

/** Disc diameter as a fraction of the viewport height at `distance` (disc radius 1, vertical fov). */
export function galaxySizeAt(distance: number, fovDeg = STAGE_FOV_DEG): number {
  return 1 / (distance * Math.tan((fovDeg * Math.PI) / 360));
}

/** Camera distance (disc radii) that shows the disc at `size` of the viewport height. */
export function galaxyDistance(size: number, fovDeg = STAGE_FOV_DEG): number {
  const s = Math.max(0.02, Math.min(4, size));
  return 1 / (s * Math.tan((fovDeg * Math.PI) / 360));
}

/** The lab hero framing (camera 3.3 disc radii away, fov 40): 0.83 of the viewport height. */
export const GALAXY_HERO_SIZE = galaxySizeAt(HERO_CAMERA_DISTANCE);

/** The layer draws nothing below this fade (the root group is hidden; programs stay compiled). */
export function galaxyLayerVisible(fade: number): boolean {
  return Number.isFinite(fade) && fade > 0.002;
}

export interface GalaxyLayerBudget {
  drawCalls: number;
  drawCallBudget: number;
  points: number;
  pointBudget: number;
  beadInstances: number;
  /** Blob draws (one point draw, plus one line draw when threads are on) and the stars they carry. */
  blobDraws: number;
  blobPoints: number;
}

/** Galaxy draws + one instanced draw for every course anchor (glow, core, ring, globular) + the blob draws. */
export function galaxyLayerBudget(features: GalaxyFeatures, buffers: GalaxyBuffers, layout: GalaxyLayout, blobs: { draws: number; points: number } = { draws: layout.beads.length > 0 ? 1 : 0, points: 0 }): GalaxyLayerBudget {
  const instances = beadInstanceCount(layout);
  return {
    drawCalls: galaxyDrawCalls(features) + (instances > 0 ? 1 : 0) + blobs.draws,
    drawCallBudget: DRAW_CALL_BUDGET,
    points: totalGalaxyPoints(buffers),
    pointBudget: POINT_BUDGET,
    beadInstances: instances,
    blobDraws: blobs.draws,
    blobPoints: blobs.points,
  };
}

/** The anchor sizes the blob rendering gives the bead quads (see `beadInstances`). */
export interface BeadAnchorScale {
  /** Blob radius / bead radius; the ring hugs the blob's rim. */
  blobScale: number;
  /** The glow's radius as a fraction of the bead radius: the blob's core glow. */
  coreGlow: number;
}

/** The product's anchor scale: `lib/galaxy/blobs` `BLOB_DEFAULTS`. */
export const BEAD_ANCHOR: BeadAnchorScale = { blobScale: 1.4, coreGlow: 0.6 };

/** The ring quad's half-size over the bead radius when the ring hugs the blob (ring at 0.82 of the quad -> the blob rim x 1.08). */
export function ringScaleFor(anchor: BeadAnchorScale): number {
  return anchor.blobScale * 1.08;
}

/**
 * The growth the bead shader applies to the current course's quads with the hop's condense (0 full blob, 1 the
 * blob collapsed into its core): the glow back to the whole bead (the twin's landing disc), the ring back to the
 * bead ring. Returned as (glow, ring) multipliers at condense 1.
 */
export function beadGrowAt(anchor: BeadAnchorScale): { glow: number; ring: number } {
  return { glow: 1 / anchor.coreGlow, ring: 1.3 / ringScaleFor(anchor) };
}

/** Per-course blob colour for a theme: the bead glow rule (current: warm + gold; others: cool -> warm by mastery). */
export function blobColors(layout: GalaxyLayout, palette: CoursePalette): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of layout.beads) out.set(b.courseId, b.kind === "current" ? mixHex(palette.beadWarm, palette.youAreHere, 0.5) : mixHex(palette.beadCool, palette.beadWarm, b.warmth));
  return out;
}

export const BEAD_MODE = { glow: 0, core: 1, planet: 2, ring: 3, globular: 4 } as const;

export interface BeadInstance {
  /** Disc-plane position in the pattern frame (beads) or halo position (globulars). */
  position: Vec3;
  /** Half-size of the quad in disc units. */
  size: number;
  color: string;
  alpha: number;
  mode: number;
  /** Mode-specific: core radius (1), ring thickness (3) in quad units. */
  p0: number;
  phase: number;
  /** Which course a click on this instance means. */
  courseId: string;
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** Course id -> dense index (order of first appearance), the `iCourse` attribute the hover ring keys on. */
export function courseIndexOf(instances: readonly Pick<BeadInstance, "courseId">[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const q of instances) if (!map.has(q.courseId)) map.set(q.courseId, map.size);
  return map;
}

export function beadInstanceCount(layout: GalaxyLayout): number {
  return layout.beads.length * 2 + (layout.current ? 1 : 0) + layout.globulars.length * 2;
}

/**
 * The blob ANCHORS: a core glow + core per active course (the glow at
 * `coreGlow` of the bead radius: the dense centre of the course's blob), the
 * ring on the current one hugging its blob's rim, glow + core per archived
 * course in the halo. Glows come first so the anchor lookup finds them.
 */
export function beadInstances(layout: GalaxyLayout, palette: CoursePalette, anchor: BeadAnchorScale = BEAD_ANCHOR): BeadInstance[] {
  const out: BeadInstance[] = [];
  const colors = blobColors(layout, palette);
  for (const b of layout.beads) {
    const current = b.kind === "current";
    // Soft: the glow sits on the arm's own light, so it stays translucent and never blows to white.
    out.push({ position: b.position, size: b.radius * anchor.coreGlow, color: colors.get(b.courseId)!, alpha: current ? 0.6 : 0.36 + 0.22 * b.warmth, mode: BEAD_MODE.glow, p0: 0, phase: b.a, courseId: b.courseId });
  }
  for (const b of layout.beads) {
    const lift: Vec3 = [b.position[0], b.position[1] + 0.001, b.position[2]];
    if (b.hasWorld) out.push({ position: lift, size: b.radius * 0.34, color: palette.beadWorldCore, alpha: 1, mode: BEAD_MODE.planet, p0: 0, phase: 0, courseId: b.courseId });
    else out.push({ position: lift, size: b.radius * 0.22, color: palette.beadCore, alpha: 0.95, mode: BEAD_MODE.core, p0: 1, phase: 0, courseId: b.courseId });
  }
  if (layout.current) {
    const b = layout.current;
    out.push({ position: b.position, size: b.radius * ringScaleFor(anchor), color: palette.youAreHere, alpha: 0.95, mode: BEAD_MODE.ring, p0: 0.07, phase: 0.2, courseId: b.courseId });
  }
  for (const g of layout.globulars) {
    out.push({ position: g.position, size: g.radius * 1.1, color: palette.globularGlow, alpha: 0.35, mode: BEAD_MODE.globular, p0: 0, phase: 0, courseId: g.courseId });
    out.push({ position: g.position, size: g.radius * 0.25, color: palette.globularCore, alpha: 0.7, mode: BEAD_MODE.core, p0: 1, phase: 0, courseId: g.courseId });
  }
  return out;
}
