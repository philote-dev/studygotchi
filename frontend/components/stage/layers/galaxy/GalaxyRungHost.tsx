"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type { Rect } from "@/lib/galaxy/flags";
import { onStageEvent, openCourseConstellation } from "@/lib/stage/events";
import { useHop } from "../../hop/HopProvider";
import { CourseFlags, lastFlagSolve, useFlagEntries } from "./CourseFlags";
import type { GalaxyRungController } from "./galaxy-rung-controller";
import { shownFlags } from "./galaxy-rung-model";
import "./galaxy-rung.css";

export interface GalaxyRungHostProps {
  controller: GalaxyRungController;
}

/** CSS px per stage cell (the composer's 2 px pixel pass at rest). */
export const FLAG_CELL_PX = 2;

/** Chrome the flags keep clear of: the header's three groups (brand, the two pills, the account chip), not the full-width bar. */
const FLAG_OBSTACLE_SELECTOR = ".sg-header-lead, .sg-nav, .sg-header-trail";

declare global {
  interface Window {
    /** Development only: the galaxy flags' last solve and each blob's client position, for captures. */
    __galaxyFlags?: { solve(): ReturnType<typeof lastFlagSolve>; screenPositionOf(courseId: string): { x: number; y: number } | null };
  }
}

/**
 * The galaxy rung's DOM half, mounted by `StageCanvas` outside the stage's
 * stacking context: a full-viewport pointer surface that is only live while
 * the rung is (over the page, under the header, so the two pills keep
 * working), the course FLAG the R3F side projects every frame (sticky: the
 * blob most recently hovered, the current course's until one is), and the
 * product response to `stage:open-course-constellation`: the bead-click hop
 * into that course's constellation (recency, lock and the route together).
 */
export function GalaxyRungHost({ controller }: GalaxyRungHostProps) {
  const hop = useHop();
  const host = useRef<HTMLDivElement>(null);
  useSyncExternalStore(controller.subscribe, controller.version, controller.version);
  const { active, hover, pinned, sticky, courses, currentCourseId, currentFlag } = controller;

  // A blob (or a flag's "Open") goes through hop.ts: recency, lock, the director request and the
  // condense anchor stay consistent.
  useEffect(() => onStageEvent("stage:open-course-constellation", (event) => hop.beadClick(event.courseId)), [hop]);

  // A readiness mark for captures / probes: the rung is live and takes input.
  useEffect(() => {
    document.documentElement.dataset.galaxyRung = active ? "true" : "false";
    return () => {
      delete document.documentElement.dataset.galaxyRung;
    };
  }, [active]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__galaxyFlags = {
      solve: lastFlagSolve,
      screenPositionOf(courseId) {
        const a = controller.flags.last?.anchors.find((x) => x.courseId === courseId);
        const el = host.current;
        if (!a || !el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + a.x, y: r.top + a.y };
      },
    };
    return () => {
      delete window.__galaxyFlags;
    };
  }, [controller]);

  const point = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      controller.pointer = point(e);
    },
    [controller],
  );
  const onPointerLeave = useCallback(() => {
    controller.pointer = null;
  }, [controller]);
  const onClick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Clicks on a flag card are the card's own ("Open"); the surface only picks blobs.
      if ((e.target as HTMLElement).closest(".sg-flag")) return;
      const p = point(e);
      controller.pointer = p;
      const hit = controller.pickAt?.(p.x, p.y);
      if (hit) openCourseConstellation(hit.courseId);
    },
    [controller],
  );
  const onPin = useCallback((courseId: string | null) => controller.setPinned(courseId), [controller]);
  const onOpen = useCallback((courseId: string) => openCourseConstellation(courseId), []);

  // Chrome safe areas in host coordinates, read per frame by the flag solver.
  const obstacles = useCallback((): Rect[] => {
    const el = host.current;
    if (!el) return [];
    const h = el.getBoundingClientRect();
    const out: Rect[] = [];
    for (const node of document.querySelectorAll<HTMLElement>(FLAG_OBSTACLE_SELECTOR)) {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({ x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height });
    }
    return out;
  }, []);

  // Which flag is up: the sticky one (the blob most recently hovered, kept after the pointer leaves;
  // the current course's until anything is hovered), plus a pinned card's for the instant it differs.
  const hoveredId = active ? (hover?.courseId ?? pinned) : null;
  const shown = useMemo(() => shownFlags({ active, currentFlag, currentCourseId, sticky, pinned: active ? pinned : null }), [active, currentFlag, currentCourseId, sticky, pinned]);
  // The sticky card reads as the hovered one (stats and "Open"), whether or not the pointer is still on its blob.
  const entries = useFlagEntries(shown, courses, currentCourseId, sticky ?? hoveredId);

  return (
    <div
      ref={host}
      className="sg-galaxy-input"
      data-active={active ? "true" : undefined}
      data-hover={hover ? "true" : undefined}
      data-hover-course={hover?.courseId}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
      aria-hidden
    >
      <CourseFlags entries={entries} bus={controller.flags} cell={FLAG_CELL_PX} obstacles={obstacles} onOpen={onOpen} onPin={onPin} />
    </div>
  );
}
