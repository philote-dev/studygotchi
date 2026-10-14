"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useMemo, type ReactNode } from "react";
import { AudioChrome } from "@/components/audio/AudioChrome";
import { HopProvider } from "@/components/stage/hop/HopProvider";
import { PlanetStandIn } from "@/components/stage/hop/PlanetStandIn";
import { useHopRuntime } from "@/components/stage/hop/useHopRuntime";
import { StageCanvas } from "@/components/stage/StageCanvas";
import { StageSlotsProvider } from "@/components/stage/StageSlots";
import { useStageParams } from "@/components/stage/useStageParams";
import { createDirector } from "@/lib/stage/director";
import { restRungForRoute } from "@/lib/stage/params";
import { useReducedMotion } from "./useSpaceAttribute";
import { ProductHeader } from "./ProductHeader";
import "@/components/stage/hop/hop.css";

/**
 * The room both product pages sit in: one sky, one header, one page at a time,
 * locked to the viewport. World and Space swap inside it; the sky, the header
 * and the sound chip never remount.
 *
 * The sky is the persistent StageCanvas: the WebGL sky (S1, approved
 * 2026-10-11), the globe slotted in by the earth page (S2-2, gate 1,
 * 2026-10-13), the land slotted in by the ice-town page (S4-1), the galaxy
 * rung (S3, gate 3) and the hop runtime (S2-3 .. S4-3, gates 2-4) are all
 * permanent since 2026-10-13: the two pills, a landmark click and the land
 * rail drive the stage's altitude director, which is created here so the
 * header, the pages and the stage share it. `prefers-reduced-motion` is the
 * only behaviour switch (hops become 200 ms crossfades of the rest poses).
 */
export function ProductShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const params = useStageParams();
  const reducedMotion = useReducedMotion();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The director rests on the route's rung at mount (a cold /knowledge load is the constellation);
  // after that only hops move it, so the first values are the ones that count.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const director = useMemo(() => createDirector(restRungForRoute(pathname ?? "/", `?${searchParams.toString()}`)), []);
  const runtime = useHopRuntime(director, reducedMotion);
  return (
    <StageSlotsProvider>
      <HopProvider runtime={runtime}>
        <div className="sg-shell">
          <StageCanvas perf={params.perf} rung={params.rung} director={director} hop={runtime} />
          <div className="sg-page">{children}</div>
          <PlanetStandIn />
          <ProductHeader />
          <div className="sg-sound">
            <AudioChrome />
          </div>
        </div>
      </HopProvider>
    </StageSlotsProvider>
  );
}
