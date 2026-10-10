"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  leaveDurationMs,
  leavePhaseAt,
  needsBiomeRise,
  productStage,
  productStageFromHref,
  STAGE_MS,
  type LeavePhase,
} from "@/lib/stage-motion";

interface ShellNav {
  /** True inside the product shell, where World and Space share a header and a sky. */
  available: boolean;
  /** The route being left for, while the exit animation plays. */
  leavingTo: string | null;
  /** Rise (biome → orbit) or the shared planet-leave. Null when idle. */
  leavePhase: Exclude<LeavePhase, "done"> | null;
  /** Navigate with an exit beat: pages read `leavingTo` and animate out first. */
  go(href: string): void;
}

const ShellNavContext = createContext<ShellNav>({
  available: false,
  leavingTo: null,
  leavePhase: null,
  go: () => {},
});

export function ShellNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const [leavePhase, setLeavePhase] = useState<Exclude<LeavePhase, "done"> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const riseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const here = searchParams.toString() ? `${pathname}?${searchParams}` : pathname;

  useEffect(() => {
    setLeavingTo(null);
    setLeavePhase(null);
  }, [here]);

  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      if (riseTimer.current) clearTimeout(riseTimer.current);
    },
    [],
  );

  const go = useCallback(
    (href: string) => {
      if (href === here || leavingTo) return;
      const from = productStage(pathname ?? "/", searchParams);
      const to = productStageFromHref(href);
      // Land ↔ globe stays an in-world dive/rise. Do not cart the stage off
      // with the Information leave CSS.
      if (from === "biome" && to === "planet") {
        router.push(href);
        return;
      }
      router.prefetch(href);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const first = leavePhaseAt(0, from, to, reduced);
      setLeavingTo(href);
      setLeavePhase(first === "done" ? "leave" : first);
      if (needsBiomeRise(from, to, reduced) && to === "information") {
        riseTimer.current = setTimeout(() => setLeavePhase("leave"), STAGE_MS.aperture);
      }
      leaveTimer.current = setTimeout(
        () => router.push(href),
        leaveDurationMs(from, to, reduced),
      );
    },
    [here, leavingTo, pathname, router, searchParams],
  );

  const value = useMemo(
    () => ({ available: true, leavingTo, leavePhase, go }),
    [leavingTo, leavePhase, go],
  );

  return <ShellNavContext.Provider value={value}>{children}</ShellNavContext.Provider>;
}

export function useShellNav(): ShellNav {
  return useContext(ShellNavContext);
}
