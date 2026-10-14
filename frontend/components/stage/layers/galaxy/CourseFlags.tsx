"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { layoutFlags, leaderPath, type FlagAnchor, type FlagSectorState, type PlacedFlag, type Point, type Rect } from "@/lib/galaxy/flags";
import "./course-flags.css";

/** One blob's screen footprint this frame (CSS px inside the stage box). */
export interface FlagFrameAnchor {
  courseId: string;
  x: number;
  y: number;
  /** Blob radius on screen. */
  r: number;
  /** Core glow radius on screen. */
  glowR: number;
}

/** What the projector publishes every frame. */
export interface FlagFrame {
  anchors: readonly FlagFrameAnchor[];
  /** Galaxy centre on screen. */
  centre: Point;
  /** Bulge radius on screen (conservative: the projected disc circle at `BULGE_KEEP_OUT_SIGMAS`). */
  bulgeR: number;
  width: number;
  height: number;
}

/** Bulge radius for the flags' keep-out, in bulge sigmas (the bright core). */
export const BULGE_KEEP_OUT_SIGMAS = 1.6;
/** The exit fade of a flag, ms; the card is unmounted after it (`.sg-flag[data-phase="out"]`). */
export const FLAG_EXIT_MS = 120;
/** Enter offset of the card along the leader, px (the flag slides out from the blob side). */
const ENTER_SLIDE = 6;
/** Fallback box before the first measurement (the next frame corrects it). */
const GUESS = { w: 152, h: 66 };

type FlagListener = (frame: FlagFrame) => void;

export interface FlagBus {
  publish(frame: FlagFrame): void;
  subscribe(listener: FlagListener): () => void;
  readonly last: FlagFrame | null;
}

/** Per-frame channel from the canvas (projection) to the DOM overlay (layout), no React state in the loop. */
export function createFlagBus(): FlagBus {
  let last: FlagFrame | null = null;
  const listeners = new Set<FlagListener>();
  return {
    publish(frame) {
      last = frame;
      for (const l of listeners) l(frame);
    },
    subscribe(listener) {
      listeners.add(listener);
      if (last) listener(last);
      return () => {
        listeners.delete(listener);
      };
    },
    get last() {
      return last;
    },
  };
}

export type FlagPhase = "in" | "out";

export interface FlagEntry {
  courseId: string;
  code: string;
  title: string;
  concepts: number;
  /** 0 .. 1 */
  mastery: number;
  current: boolean;
  hovered: boolean;
  /** Tab + title only (a lab's resting flags); the hovered and current ones carry the stats and "Open". */
  compact: boolean;
  phase: FlagPhase;
}

/** The course facts a flag shows. */
export interface FlagCourse {
  id: string;
  code: string;
  title: string;
  concepts: number;
  mastery: number;
}

export interface CourseFlagsProps {
  entries: readonly FlagEntry[];
  bus: FlagBus;
  /** Stage pixel cell in CSS px. */
  cell: number;
  /** Chrome safe areas in stage coordinates, read every frame. */
  obstacles: () => Rect[];
  onOpen: (courseId: string) => void;
  /** The pointer is over a flag: keep it (and its hover) alive while the user reaches for "Open". */
  onPin: (courseId: string | null) => void;
}

/** The last solve, for captures and probes (`window.__galaxyFlags`); no React, no cost beyond a reference. */
let lastSolve: { input: Omit<FlagLayoutInputPlain, "prev">; placed: PlacedFlag[] } | null = null;
type FlagLayoutInputPlain = Parameters<typeof layoutFlags>[0];
export function lastFlagSolve() {
  return lastSolve;
}

/**
 * The flag cards' lifecycle: a course that stops being shown fades out for
 * `FLAG_EXIT_MS` before its card is unmounted; one that comes back during the
 * fade is simply flipped back in (the transition retargets from where it is).
 */
export function useFlagEntries(shown: readonly string[], courses: readonly FlagCourse[], currentId: string | null, hovered: string | null, compactRest = false): FlagEntry[] {
  const [phases, setPhases] = useState<ReadonlyMap<string, FlagPhase>>(() => new Map(shown.map((id) => [id, "in" as const])));
  const timers = useRef(new Map<string, number>());
  const key = shown.join("|");
  useEffect(() => {
    const want = new Set(shown);
    setPhases((prev) => {
      const next = new Map(prev);
      for (const id of want) {
        next.set(id, "in");
        const t = timers.current.get(id);
        if (t !== undefined) {
          window.clearTimeout(t);
          timers.current.delete(id);
        }
      }
      for (const [id, phase] of prev) {
        if (want.has(id) || phase === "out") continue;
        next.set(id, "out");
        timers.current.set(
          id,
          window.setTimeout(() => {
            timers.current.delete(id);
            setPhases((p) => {
              if (p.get(id) !== "out") return p;
              const m = new Map(p);
              m.delete(id);
              return m;
            });
          }, FLAG_EXIT_MS),
        );
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) window.clearTimeout(t);
      map.clear();
    };
  }, []);
  return useMemo(() => {
    const out: FlagEntry[] = [];
    for (const [id, phase] of phases) {
      const c = courses.find((x) => x.id === id);
      if (!c) continue;
      const current = c.id === currentId;
      out.push({ courseId: id, code: c.code, title: c.title, concepts: c.concepts, mastery: c.mastery, current, hovered: id === hovered, compact: compactRest && !current && id !== hovered, phase });
    }
    return out;
  }, [phases, courses, currentId, hovered, compactRest]);
}

/**
 * The flags: a DOM card per course (the product's sheet / ink / mono-tab
 * language, see `LandmarkFlag`) and an SVG leader per card, both re-laid out
 * every frame from the projector's bus and written straight to the DOM. React
 * only mounts and unmounts cards (and flips their phase for the exit fade).
 */
export function CourseFlags({ entries, bus, cell, obstacles, onOpen, onPin }: CourseFlagsProps) {
  const cards = useRef(new Map<string, HTMLDivElement>());
  const leaders = useRef(new Map<string, SVGPathElement>());
  const ticks = useRef(new Map<string, SVGRectElement>());
  const sizes = useRef(new Map<string, { w: number; h: number }>());
  const states = useRef(new Map<string, FlagSectorState>());
  const live = useRef(entries);
  live.current = entries;
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;

  // Measure cards as they mount and resize (fonts, content), never per frame.
  const ro = useRef<ResizeObserver | null>(null);
  const observer = (): ResizeObserver | null => {
    if (typeof ResizeObserver === "undefined") return null;
    if (!ro.current) {
      ro.current = new ResizeObserver((records) => {
        for (const r of records) {
          const el = r.target as HTMLElement;
          const id = el.dataset.course;
          if (id) sizes.current.set(id, { w: el.offsetWidth, h: el.offsetHeight });
        }
      });
    }
    return ro.current;
  };
  useEffect(
    () => () => {
      ro.current?.disconnect();
      ro.current = null;
    },
    [],
  );

  useEffect(() => {
    return bus.subscribe((frame) => {
      const entries = live.current;
      const byId = new Map(frame.anchors.map((a) => [a.courseId, a]));
      // Cards on their way out stay where they were (no re-solve under a fading flag).
      const active = entries.filter((e) => e.phase === "in" && byId.has(e.courseId));
      const anchors: FlagAnchor[] = active.map((e) => {
        const a = byId.get(e.courseId)!;
        const size = sizes.current.get(e.courseId) ?? GUESS;
        return { courseId: e.courseId, x: a.x, y: a.y, r: a.r, glowR: a.glowR, w: size.w, h: size.h, priority: e.hovered ? 3 : e.current ? 2 : 0 };
      });
      const input = {
        anchors,
        centre: frame.centre,
        bulge: { x: frame.centre.x, y: frame.centre.y, r: frame.bulgeR },
        viewport: { x: 0, y: 0, w: frame.width, h: frame.height },
        obstacles: obstaclesRef.current(),
        prev: states.current,
        cell,
      };
      const placed = layoutFlags(input);
      const { prev: _prev, ...plain } = input;
      void _prev;
      lastSolve = { input: plain, placed };
      const seen = new Set<string>();
      for (const f of placed) {
        seen.add(f.courseId);
        states.current.set(f.courseId, f.state);
        const card = cards.current.get(f.courseId);
        if (card) {
          card.style.transform = `translate3d(${f.rect.x}px, ${f.rect.y}px, 0)`;
          card.style.setProperty("--fl-dx", `${-f.sx * ENTER_SLIDE}px`);
          card.style.setProperty("--fl-dy", `${-f.sy * ENTER_SLIDE}px`);
          card.dataset.dir = String(f.dir);
          card.dataset.fallback = f.fallback ? "1" : "0";
          card.dataset.clamped = f.clamped ? "1" : "0";
          card.dataset.reach = f.reach.toFixed(2);
          card.dataset.placed = "1";
        }
        leaders.current.get(f.courseId)?.setAttribute("d", leaderPath(f));
        const tick = ticks.current.get(f.courseId);
        if (tick) {
          tick.setAttribute("x", String(f.start.x - cell));
          tick.setAttribute("y", String(f.start.y - cell));
        }
      }
      for (const id of [...states.current.keys()]) if (!seen.has(id) && !entries.some((e) => e.courseId === id)) states.current.delete(id);
    });
  }, [bus, cell]);

  const register = (id: string) => (el: HTMLDivElement | null) => {
    if (el) {
      cards.current.set(id, el);
      sizes.current.set(id, { w: el.offsetWidth, h: el.offsetHeight });
      observer()?.observe(el);
    } else {
      const prev = cards.current.get(id);
      if (prev) observer()?.unobserve(prev);
      cards.current.delete(id);
      sizes.current.delete(id);
    }
  };

  return (
    <div className="sg-flags" aria-live="polite">
      <svg className="sg-flags__leaders" aria-hidden="true" shapeRendering="crispEdges">
        {entries.map((e) => (
          <g key={e.courseId} data-phase={e.phase} data-current={e.current ? "1" : "0"} className="sg-flags__leader">
            <path
              ref={(el) => {
                if (el) leaders.current.set(e.courseId, el);
                else leaders.current.delete(e.courseId);
              }}
              d=""
              fill="none"
              strokeWidth={cell}
            />
            <rect
              ref={(el) => {
                if (el) ticks.current.set(e.courseId, el);
                else ticks.current.delete(e.courseId);
              }}
              width={cell * 2}
              height={cell * 2}
              x={-100}
              y={-100}
            />
          </g>
        ))}
      </svg>
      {entries.map((e) => (
        <div
          key={e.courseId}
          ref={register(e.courseId)}
          className="sg-flag"
          data-course={e.courseId}
          data-phase={e.phase}
          data-current={e.current ? "1" : "0"}
          data-hovered={e.hovered ? "1" : "0"}
          data-compact={e.compact ? "1" : "0"}
          style={{ transform: "translate3d(-9999px, -9999px, 0)" } as CSSProperties}
          onPointerEnter={() => onPin(e.courseId)}
          onPointerLeave={() => onPin(null)}
        >
          <div className="sg-flag__card">
            <div className="sg-flag__head">
              <span className="sg-flag__tab">{e.code}</span>
              {e.current ? <span className="sg-flag__here">here</span> : null}
              <button type="button" className="sg-flag__open" onClick={() => onOpen(e.courseId)} tabIndex={e.phase === "in" ? 0 : -1}>
                Open
              </button>
            </div>
            <h3 className="sg-flag__title">{e.title}</h3>
            <p className="sg-flag__stat">
              {e.concepts} concepts · {Math.round(e.mastery * 100)}% mastery
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
