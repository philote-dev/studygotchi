"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { createLayout } from "@/lib/forceLayout";
import { constellationBridge } from "@/lib/graph/twin/bridge";
import { buildGraphModel } from "@/lib/graphModel";
import { selectCourse } from "@/lib/identity";
import { markCourseOpened, setActiveCourse } from "@/lib/stage/active-course";
import type { StageDirector } from "@/lib/stage/director";
import { rungSearch } from "@/lib/stage/hop";
import { useStore } from "@/lib/store";
import { createHopRuntime, type HopRuntime } from "./hop-runtime";

/**
 * Settle the current course's constellation layout in the Worker (cached by
 * hash) before the knowledge page needs it, so the twin's first frame has
 * positions. The same `settle` the 2D canvas runs: its later identical model
 * is a cache hit and applies at once.
 */
export function warmConstellationLayout(graph: Parameters<typeof buildGraphModel>[0], resources: Parameters<typeof buildGraphModel>[1]): void {
  if (!graph) return;
  const model = buildGraphModel(graph, resources);
  if (model.nodes.length === 0) return;
  const layouts = constellationBridge.layouts;
  const hash = layouts.hashOf(model);
  if (layouts.cache.get(hash) || layouts.pending.has(hash)) return;
  const was = layouts.defer;
  layouts.defer = true;
  try {
    layouts.settle(createLayout(model), model);
  } finally {
    layouts.defer = was;
  }
}

/**
 * Snapshot the leaving page's chrome: a static clone of every `selector` match
 * appended to the shell (the chrome is positioned against the page, which
 * fills the shell, so the clone lands in the same box), inert, carrying the
 * same class so the driver's per-frame chrome fade reaches it. Next's layout
 * `children` cannot be held (they resolve to the current route), so the chrome
 * that must fade on the spring after its page is gone fades as this snapshot.
 */
export function ghostChrome(selector: string): () => void {
  const shell = document.querySelector<HTMLElement>(".sg-shell");
  const clones: HTMLElement[] = [];
  if (shell) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.hasAttribute("data-hop-ghost")) continue;
      const clone = el.cloneNode(true) as HTMLElement;
      clone.setAttribute("data-hop-ghost", "");
      clone.setAttribute("aria-hidden", "true");
      clone.setAttribute("inert", "");
      clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      shell.appendChild(clone);
      clones.push(clone);
    }
  }
  return () => {
    for (const c of clones) c.remove();
  };
}

/** The hop runtime for `director` with the product's side effects (router, identity, recency). */
export function useHopRuntime(director: StageDirector, reducedMotion: boolean): HopRuntime {
  const router = useRouter();
  const { graph, resources } = useStore();
  const latest = useRef({ graph, resources });
  latest.current = { graph, resources };

  const runtime = useMemo(
    () =>
      createHopRuntime(director, {
        push: (href) => router.push(href),
        replaceSearch: (search) => {
          const url = `${window.location.pathname}${search}`;
          if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(window.history.state, "", url);
        },
        lockCourse: (courseId) => {
          selectCourse(courseId);
          setActiveCourse(courseId);
        },
        markRecent: (courseId) => markCourseOpened(courseId),
        prefetchRoute: (href) => router.prefetch(href),
        warmLayout: () => warmConstellationLayout(latest.current.graph.data, latest.current.resources),
        ghost: ghostChrome,
      }),
    [director, router],
  );

  // Reduced motion is the only behaviour switch: hops become 200 ms crossfades of the rest poses.
  useEffect(() => {
    director.setReducedMotion(reducedMotion);
  }, [director, reducedMotion]);

  // URL mirror on arrival (`?rung=` at rest, dropped on the planet and the world: the land has
  // its own `?land=`), so a reload lands on the same rung.
  useEffect(() => director.onRest((rung) => runtime.effects.replaceSearch(rungSearch(window.location.search, rung))), [director, runtime]);

  return runtime;
}
