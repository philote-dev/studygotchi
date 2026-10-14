/**
 * Seeded near-field scenery for the planet rung: two moons on tilted orbits
 * around the globe and a station in a synchronous slot beside it (the lab's
 * `Planet2` moons and station, placed for the product globe's seat).
 *
 * Pure and deterministic: the same student seed and seat give the same sky.
 * The placement works in the seated camera's view so it can keep the moons'
 * visible arcs and the station clear of the chrome (`BACKDROP_SAFE_AREAS`:
 * header, the left column with the course navigator and the flag panel, the
 * bottom controls), of the globe's face and of the active landmark seat (the
 * town every settle rotates to). The seat leaves only a strip of sky beside
 * the globe, so the orbits are chosen for the longest clean visible arc and
 * `sceneryFade` hides a moon wherever its path would still cross a keep-out
 * (the renderer multiplies it into the moon's opacity each frame). Nothing
 * here touches three.js.
 */
import { BACKDROP_SAFE_AREAS, type Box } from "./placement";
import { mulberry32, pick, range, type Rng } from "./rng";
import { add, cross, dot, norm, scale, sub, type Vec3 } from "./geometry";

export interface PlanetSceneryInput {
  seed: number;
  /** The seated camera (the globe's `seatedCameraPosition`) and its vertical fov. */
  eye: Vec3;
  lookAt: Vec3;
  fovDeg: number;
  /** Viewport width / height. */
  aspect: number;
  /** Globe centre and radius in world units. */
  globeCenter: Vec3;
  globeRadius: number;
  /** Unit direction (world space, from the globe centre) of the active landmark seat. */
  landmarkDir: Vec3;
  /**
   * Extra screen boxes to stay clear of (viewport fractions): the far sky's
   * galaxy hint and objects, so the near-field scenery never stacks on the
   * far dressing. Treated exactly like the chrome safe areas.
   */
  keepOut?: readonly Box[];
}

export interface MoonSpec {
  id: string;
  /** World-space orbit basis: position = centre + orbitRadius * (cos a * e1 + sin a * e2). */
  e1: Vec3;
  e2: Vec3;
  orbitRadius: number;
  /** Moon radius (world units). */
  radius: number;
  periodS: number;
  phase: number;
  direction: 1 | -1;
  color: string;
  /** Fraction of the orbit that shows on screen clear of every keep-out (readout, tests). */
  visible: number;
  /** Fraction of the orbit that shows on screen but inside a keep-out (hidden by `sceneryFade`). */
  hidden: number;
}

export interface StationSpec {
  position: Vec3;
  /** World units per lab unit (the lab station is ~0.7 lab units wide). */
  scale: number;
  bobAmplitude: number;
  bobPeriodS: number;
  spinRadS: number;
  /** Viewport fractions (u right, v down) and apparent half-size (viewport-height units). */
  screen: { u: number; v: number; half: number };
  /** Rules the slot breaks; 0 when clean. */
  violations: number;
}

export interface SceneryView {
  aspect: number;
  /** Active landmark seat on screen and the keep-out radius around it (viewport-height units). */
  seat: { u: number; v: number; radius: number };
  /** Globe centre on screen, its apparent radius (viewport-height units) and its camera depth. */
  globe: { u: number; v: number; radius: number; depth: number };
  /** Chrome safe areas plus the caller's extra keep-out boxes. */
  safeAreas: readonly Box[];
}

export interface PlanetScenery {
  seed: number;
  view: SceneryView;
  moons: MoonSpec[];
  station: StationSpec;
}

/* ------------------------------------------------------------------ */
/* Camera frame                                                        */
/* ------------------------------------------------------------------ */

export interface CameraFrame {
  eye: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
  tanHalf: number;
  aspect: number;
}

const UP: Vec3 = [0, 1, 0];

/** The frame three's `lookAt` builds: z back toward the eye, x right, y up. */
export function cameraFrame(eye: Vec3, lookAt: Vec3, fovDeg: number, aspect: number): CameraFrame {
  const z = norm(sub(eye, lookAt));
  let x = cross(UP, z);
  if (Math.hypot(x[0], x[1], x[2]) < 1e-6) x = [1, 0, 0];
  x = norm(x);
  const y = cross(z, x);
  return { eye, x, y, z, tanHalf: Math.tan((fovDeg * Math.PI) / 360), aspect };
}

/** World -> camera space (x right, y up, -z forward). */
export function toCamera(f: CameraFrame, p: Vec3): Vec3 {
  const d = sub(p, f.eye);
  return [dot(d, f.x), dot(d, f.y), dot(d, f.z)];
}

/** Camera space -> world. */
export function toWorld(f: CameraFrame, c: Vec3): Vec3 {
  return add(f.eye, add(add(scale(f.x, c[0]), scale(f.y, c[1])), scale(f.z, c[2])));
}

/** Camera-space direction -> world-space direction (rotation only). */
export function toWorldDir(f: CameraFrame, c: Vec3): Vec3 {
  return norm(add(add(scale(f.x, c[0]), scale(f.y, c[1])), scale(f.z, c[2])));
}

export interface Projected {
  u: number;
  v: number;
  /** Distance in front of the camera (positive). */
  depth: number;
}

/** Camera-space point -> viewport fractions (u right, v down); null behind the camera. */
export function projectCamera(f: CameraFrame, c: Vec3): Projected | null {
  const depth = -c[2];
  if (depth <= 1e-6) return null;
  const ndcX = c[0] / depth / (f.tanHalf * f.aspect);
  const ndcY = c[1] / depth / f.tanHalf;
  return { u: (ndcX + 1) / 2, v: (1 - ndcY) / 2, depth };
}

/** Viewport fractions at a camera-space depth -> camera-space point. */
export function unprojectCamera(f: CameraFrame, u: number, v: number, depth: number): Vec3 {
  const ndcX = u * 2 - 1;
  const ndcY = 1 - v * 2;
  return [ndcX * depth * f.tanHalf * f.aspect, ndcY * depth * f.tanHalf, -depth];
}

/** Apparent radius (viewport-height units) of a world radius at a camera depth. */
export function apparentRadius(f: CameraFrame, worldRadius: number, depth: number): number {
  return worldRadius / (depth * f.tanHalf) / 2;
}

/* ------------------------------------------------------------------ */
/* Keep-outs                                                           */
/* ------------------------------------------------------------------ */

export const PLANET_SCENERY_LIMITS = {
  /** Keep-out radius around the active landmark seat (viewport-height units). */
  seatRadius: 0.16,
  /** Margin outside the globe's apparent disc that moons in front of it must keep. */
  globeMargin: 0.02,
  /** Clearance over which `sceneryFade` ramps from hidden to shown (viewport-height units). */
  fadeWidth: 0.04,
  /** Minimum fraction of an orbit that must show clean. */
  minVisible: 0.08,
  samples: 96,
  attempts: 72,
} as const;

/** Screen box of a disc of radius `r` (height units) centred at (u, v). */
export function discBox(u: number, v: number, r: number, aspect: number): Box {
  return { x0: u - r / aspect, y0: v - r, x1: u + r / aspect, y1: v + r };
}

function heightDistance(a: { u: number; v: number }, b: { u: number; v: number }, aspect: number): number {
  return Math.hypot((a.u - b.u) * aspect, a.v - b.v);
}

/** Gap between two boxes in viewport-height units; negative (the penetration) when they overlap. */
export function boxClearance(a: Box, b: Box, aspect: number): number {
  const dx = Math.max(b.x0 - a.x1, a.x0 - b.x1) * aspect;
  const dy = Math.max(b.y0 - a.y1, a.y0 - b.y1);
  if (dx < 0 && dy < 0) return Math.max(dx, dy);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

/**
 * Clearance (viewport-height units, positive = clear) of a disc of apparent
 * radius `r` at (u, v) from every keep-out: the chrome safe areas, the active
 * landmark seat and, for an object in front of the globe, the globe's face.
 */
export function sceneryClearance(view: SceneryView, u: number, v: number, r: number, inFront: boolean): number {
  const box = discBox(u, v, r, view.aspect);
  let c = Infinity;
  for (const s of view.safeAreas) c = Math.min(c, boxClearance(box, s, view.aspect));
  c = Math.min(c, heightDistance({ u, v }, view.seat, view.aspect) - (view.seat.radius + r));
  if (inFront) c = Math.min(c, heightDistance({ u, v }, view.globe, view.aspect) - (view.globe.radius + PLANET_SCENERY_LIMITS.globeMargin + r));
  return c;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 0 inside a keep-out, 1 once `fadeWidth` clear of every one; the renderer multiplies this into the opacity. */
export function sceneryFade(view: SceneryView, u: number, v: number, r: number, inFront: boolean): number {
  return smoothstep(0, PLANET_SCENERY_LIMITS.fadeWidth, sceneryClearance(view, u, v, r, inFront));
}

function onScreen(b: Box): boolean {
  return b.x1 > 0 && b.x0 < 1 && b.y1 > 0 && b.y0 < 1;
}

/** Is a projected point hidden behind the globe (farther than its centre and inside its disc)? */
function occluded(view: SceneryView, p: Projected): boolean {
  return p.depth > view.globe.depth && heightDistance(p, view.globe, view.aspect) < view.globe.radius;
}

/* ------------------------------------------------------------------ */
/* Moons                                                               */
/* ------------------------------------------------------------------ */

interface MoonKind {
  id: string;
  /** Orbit radius range in globe radii. */
  orbit: readonly [number, number];
  /** Moon radius in globe radii. */
  radius: number;
  periodS: number;
  /** Orbit-plane tilt off the view plane (radians). */
  tilt: readonly [number, number];
  colors: readonly string[];
}

const MOON_KINDS: readonly MoonKind[] = [
  { id: "moon-a", orbit: [1.45, 1.85], radius: 0.072, periodS: 50, tilt: [0.1, 0.9], colors: ["#c6baec", "#b8e0a8", "#8ad7ea"] },
  { id: "moon-b", orbit: [1.3, 1.65], radius: 0.05, periodS: 36, tilt: [0.1, 0.9], colors: ["#e9a6c9", "#ffd36a", "#f6ac3d"] },
];

interface Placement {
  frame: CameraFrame;
  globeCam: Vec3;
  globeRadius: number;
  view: SceneryView;
}

interface MoonCandidate {
  e1c: Vec3;
  e2c: Vec3;
  orbitRadius: number;
  phase: number;
  direction: 1 | -1;
  visible: number;
  hidden: number;
}

function orbitBasis(tilt: number, roll: number): { e1c: Vec3; e2c: Vec3 } {
  // Start facing the camera (a circle on screen), tilt about the screen x axis so the orbit gains
  // depth (the +y half comes toward the camera), then roll the whole plane about the view axis.
  const e1: Vec3 = [1, 0, 0];
  const e2: Vec3 = [0, Math.cos(tilt), Math.sin(tilt)];
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const rollV = (v: Vec3): Vec3 => [v[0] * cr - v[1] * sr, v[0] * sr + v[1] * cr, v[2]];
  return { e1c: rollV(e1), e2c: rollV(e2) };
}

function evaluateMoon(p: Placement, cand: Omit<MoonCandidate, "visible" | "hidden">, radius: number): MoonCandidate {
  const n = PLANET_SCENERY_LIMITS.samples;
  let visible = 0;
  let hidden = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = add(p.globeCam, scale(add(scale(cand.e1c, Math.cos(a)), scale(cand.e2c, Math.sin(a))), cand.orbitRadius));
    const pr = projectCamera(p.frame, c);
    if (!pr || occluded(p.view, pr)) continue;
    const r = apparentRadius(p.frame, radius, pr.depth);
    if (!onScreen(discBox(pr.u, pr.v, r, p.view.aspect))) continue;
    if (sceneryClearance(p.view, pr.u, pr.v, r, pr.depth < p.view.globe.depth) >= 0) visible++;
    else hidden++;
  }
  return { ...cand, visible: visible / n, hidden: hidden / n };
}

function placeMoon(p: Placement, rng: Rng, kind: MoonKind, colorIndex: number): MoonSpec {
  const radius = kind.radius * p.globeRadius;
  let best: MoonCandidate | null = null;
  for (let attempt = 0; attempt < PLANET_SCENERY_LIMITS.attempts; attempt++) {
    const orbitRadius = range(rng, kind.orbit[0], kind.orbit[1]) * p.globeRadius;
    const tilt = range(rng, kind.tilt[0], kind.tilt[1]) * (rng() < 0.5 ? 1 : -1);
    const roll = range(rng, -Math.PI, Math.PI);
    const phase = range(rng, 0, Math.PI * 2);
    const direction: 1 | -1 = rng() < 0.5 ? 1 : -1;
    const { e1c, e2c } = orbitBasis(tilt, roll);
    const cand = evaluateMoon(p, { e1c, e2c, orbitRadius, phase, direction }, radius);
    // The longest clean arc wins; among equals, the one that hides the least.
    if (!best || cand.visible > best.visible || (cand.visible === best.visible && cand.hidden < best.hidden)) best = cand;
    if (best.visible >= 0.2 && best.hidden <= 0.1) break;
  }
  const chosen = best!;
  return {
    id: kind.id,
    e1: toWorldDir(p.frame, chosen.e1c),
    e2: toWorldDir(p.frame, chosen.e2c),
    orbitRadius: chosen.orbitRadius,
    radius,
    periodS: kind.periodS,
    phase: chosen.phase,
    direction: chosen.direction,
    color: kind.colors[colorIndex % kind.colors.length],
    visible: chosen.visible,
    hidden: chosen.hidden,
  };
}

/** World position of a moon at time `t` (seconds). */
export function moonPosition(moon: MoonSpec, globeCenter: Vec3, t: number): Vec3 {
  const a = moon.phase + (moon.direction * Math.PI * 2 * t) / moon.periodS;
  return add(globeCenter, scale(add(scale(moon.e1, Math.cos(a)), scale(moon.e2, Math.sin(a))), moon.orbitRadius));
}

/* ------------------------------------------------------------------ */
/* Station                                                             */
/* ------------------------------------------------------------------ */

/** Station: the lab object is ~0.7 lab units wide; this many globe radii per lab unit (~55 px wide at 900 px). */
const STATION_SCALE_PER_RADIUS = 0.09;
/** Station sits this far outside the globe's apparent disc (viewport-height units). */
const STATION_RING_GAP = 0.06;

function placeStation(p: Placement, rng: Rng): StationSpec {
  const view = p.view;
  const scaleW = p.globeRadius * STATION_SCALE_PER_RADIUS;
  const half = apparentRadius(p.frame, 0.7 * scaleW, view.globe.depth);
  let best: { u: number; v: number; clearance: number } | null = null;
  for (let attempt = 0; attempt < PLANET_SCENERY_LIMITS.attempts; attempt++) {
    // Around the globe's disc on the sky side (up and left of the globe, where the chrome is not).
    const angle = range(rng, Math.PI * 0.55, Math.PI * 1.45);
    const ring = view.globe.radius + STATION_RING_GAP + half + range(rng, 0, 0.08);
    const u = view.globe.u + (Math.cos(angle) * ring) / view.aspect;
    const v = view.globe.v - Math.sin(angle) * ring;
    const box = discBox(u, v, half, view.aspect);
    if (box.x0 < 0 || box.y0 < 0 || box.x1 > 1 || box.y1 > 1) continue;
    const clearance = sceneryClearance(view, u, v, half, true);
    if (!best || clearance > best.clearance) best = { u, v, clearance };
    if (best.clearance >= PLANET_SCENERY_LIMITS.fadeWidth) break;
  }
  // Fallback slot: high and to the left of the globe.
  const slot = best ?? { u: Math.max(0.36, view.globe.u - (view.globe.radius * 0.9) / view.aspect), v: Math.max(0.2, view.globe.v - view.globe.radius * 0.8), clearance: -1 };
  const cam = unprojectCamera(p.frame, slot.u, slot.v, view.globe.depth);
  return {
    position: toWorld(p.frame, cam),
    scale: scaleW,
    bobAmplitude: p.globeRadius * 0.016,
    bobPeriodS: 3.1 * Math.PI * 2,
    spinRadS: 0.35,
    screen: { u: slot.u, v: slot.v, half },
    violations: slot.clearance < 0 ? 1 : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export function placePlanetScenery(input: PlanetSceneryInput): PlanetScenery {
  const aspect = input.aspect > 0 ? input.aspect : 1.6;
  const frame = cameraFrame(input.eye, input.lookAt, input.fovDeg, aspect);
  const globeCam = toCamera(frame, input.globeCenter);
  const g = projectCamera(frame, globeCam) ?? { u: 0.74, v: 0.58, depth: 1 };
  const globe = { u: g.u, v: g.v, depth: g.depth, radius: apparentRadius(frame, input.globeRadius, g.depth) };
  const pinWorld = add(input.globeCenter, scale(norm(input.landmarkDir), input.globeRadius + 0.45));
  const pin = projectCamera(frame, toCamera(frame, pinWorld)) ?? g;
  const safeAreas: Box[] = [...BACKDROP_SAFE_AREAS.map((s) => ({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 })), ...(input.keepOut ?? [])];
  const view: SceneryView = { aspect, seat: { u: pin.u, v: pin.v, radius: PLANET_SCENERY_LIMITS.seatRadius }, globe, safeAreas };
  const placement: Placement = { frame, globeCam, globeRadius: input.globeRadius, view };

  const rng = mulberry32((input.seed ^ 0x3a7e) >>> 0);
  const moons = MOON_KINDS.map((kind) => placeMoon(placement, rng, kind, pick(rng, [0, 1, 2])));
  const station = placeStation(placement, rng);
  return { seed: input.seed >>> 0, view, moons, station };
}
