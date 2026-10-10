/**
 * One motion language for StudyGotchi stage hops.
 *
 * Direction
 *   Earth (globe, biome stage) leaves Information to the RIGHT
 *   (`sg-planet-to-galaxy`). The constellation claims the frame from the LEFT
 *   (`sg-galaxy-arrive` / inverse `sg-galaxy-leave`). Side chrome (Classes,
 *   flag, land rail) uses the complementary `sg-to-left`.
 *
 *   Courses → Information already sent the planet right. User asked for
 *   “off to the right”; that is the one language. Planet → Information and
 *   biome → Information share it. Do not fork a left-exit for earth itself.
 *
 * Durations (existing tokens only — no third scale)
 *   aperture 720ms  stage hop, camera rise, planet leave
 *   view     250ms  short chrome fades that start on the same beat
 *   snap     100ms  prefers-reduced-motion
 *
 * Camera
 *   Dive in and rise out are inverses on the globe itself. Biome → planet
 *   is that in-world hop — not a page-level rise. Biome → Information is
 *   rise (aperture) then the shared planet-leave (aperture). Information →
 *   biome is not a hop; Courses from Information lands on the globe.
 *
 * Clock
 *   Sky objects sample `skyClockMs()` / `spiralSpinAngle` from a clock that
 *   was already running. Never remount at diskSpin = 0.
 *
 * Beat
 *   Chrome, globe, spiral, and constellation start on the same beat. No
 *   per-widget wake timeouts.
 */

import { landParamFromSearch } from "./world/earth-nav";

export const STAGE_MS = {
  aperture: 720,
  view: 250,
  snap: 100,
} as const;

export type ProductStage = "landing" | "planet" | "biome" | "information";
export type LeavePhase = "rise" | "leave" | "done";

export function productStage(
  pathname: string,
  search?: string | URLSearchParams | null,
): ProductStage {
  if (/^\/knowledge(\/|$)/.test(pathname)) return "information";
  if (/^\/(earth|world)(\/|$)/.test(pathname)) {
    return landParamFromSearch(search) ? "biome" : "planet";
  }
  return "landing";
}

export function productStageFromHref(href: string): ProductStage {
  const url = new URL(href, "http://studygotchi.local");
  return productStage(url.pathname, url.search);
}

export function needsBiomeRise(
  from: ProductStage,
  to: ProductStage,
  reduced: boolean,
): boolean {
  if (reduced) return false;
  return from === "biome" && to === "information";
}

export function leaveDurationMs(
  from: ProductStage,
  to: ProductStage,
  reduced: boolean,
): number {
  if (reduced) return STAGE_MS.snap;
  if (from === "biome" && to === "information") return STAGE_MS.aperture * 2;
  return STAGE_MS.aperture;
}

export function leavePhaseAt(
  elapsedMs: number,
  from: ProductStage,
  to: ProductStage,
  reduced: boolean,
): LeavePhase {
  const total = leaveDurationMs(from, to, reduced);
  if (elapsedMs >= total) return "done";
  if (needsBiomeRise(from, to, reduced) && elapsedMs < STAGE_MS.aperture) return "rise";
  return "leave";
}
