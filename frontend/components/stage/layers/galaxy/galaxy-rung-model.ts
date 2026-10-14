/**
 * Pure rules behind `GalaxyRung` (S3-2 / S3-4): the altitude band that fades
 * the galaxy layer in, when the rung takes pointer input, which course flags
 * are up, the planet pass's fade above its rung, and the `?rung=` dev
 * parameter. No three.js, no React: vitest runs it as is.
 */
import { altitudeAt } from "@/lib/stage/altitude";
import type { DirectorSample } from "@/lib/stage/director";

/**
 * Galaxy layer opacity at altitude `L`: the altitude model's `galaxy` band
 * (0 below L 2.3, rising once the camera is clear of the disc plane, full by
 * 2.78 and so at the galaxy stop, 3). Below the constellation it is exactly 0,
 * so the layer draws nothing on the planet.
 */
export function galaxyRungFade(L: number): number {
  return altitudeAt(L).galaxy;
}

/** The beads' own band (they appear a little before the ring: `altitudeAt().beads`). */
export function galaxyBeadsFade(L: number): number {
  return altitudeAt(L).beads;
}

/** Below this fade the layer is hidden outright (no draws); programs stay compiled. */
export const GALAXY_HIDE_BELOW = 0.002;
/** The rung takes pointer input (hover, click) once it is this visible and the galaxy is the nearest stop. */
export const GALAXY_INTERACTIVE_ABOVE = 0.5;

export function galaxyRungInteractive(sample: Pick<DirectorSample, "L" | "rung">): boolean {
  return sample.rung === "galaxy" && galaxyRungFade(sample.L) > GALAXY_INTERACTIVE_ABOVE;
}

/**
 * The planet pass at the galaxy, until S2-3's pull-back owns the planet's
 * altitude look: the complement of the galaxy band, so the globe is untouched
 * everywhere the galaxy is not drawn (the planet, and the constellation stop
 * nothing else moves the director away from yet) and gone where the galaxy
 * is full. Nothing changes below L 2.3.
 */
export function planetPassFadeAt(L: number): number {
  return 1 - galaxyRungFade(L);
}

/**
 * The sticky flag (Philote, 2026-10-13, gate 3: "make it so that the flag
 * stays on the one I most recently hovered over"). One flag is up at a time
 * at the galaxy rung: at rest it is the current course's; hovering a blob
 * moves it there and it STAYS there after the pointer leaves, until another
 * blob is hovered or the rung is left (`active` false), at which point the
 * memory resets so a return shows the current course again.
 *
 * `stickyFlagNext` is the state machine's step: given the remembered course
 * and this frame's facts, the course to remember. `shownFlags` then names
 * the flag(s) up: the sticky one (the current course when nothing was
 * hovered yet), plus a pinned card's course while the pointer is on the card
 * (the user reaching for "Open" on a flag that is not the sticky one, which
 * only happens for the instant the sticky moves). Ordered sticky first (it
 * places first in the solver too).
 */
export function stickyFlagNext(input: { active: boolean; sticky: string | null; hoveredId: string | null }): string | null {
  if (!input.active) return null;
  return input.hoveredId ?? input.sticky;
}

export function shownFlags(input: { active: boolean; currentFlag: boolean; currentCourseId: string | null; sticky: string | null; pinned: string | null }): string[] {
  if (!input.active) return [];
  const ids: string[] = [];
  const rest = input.currentFlag ? input.currentCourseId : null;
  const lead = input.sticky ?? rest;
  if (lead) ids.push(lead);
  if (input.pinned && !ids.includes(input.pinned)) ids.push(input.pinned);
  return ids;
}

export { stageRungFromSearch } from "@/lib/stage/params";
