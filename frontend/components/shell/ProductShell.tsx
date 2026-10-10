"use client";

import { Suspense, type ReactNode } from "react";
import { AudioChrome } from "@/components/audio/AudioChrome";
import { productStageFromHref } from "@/lib/stage-motion";
import { ProductHeader } from "./ProductHeader";
import { ShellNavProvider, useShellNav } from "./shell-nav";
import { SpaceField } from "./SpaceField";

function ShellPage({ children }: { children: ReactNode }) {
  const { leavingTo, leavePhase } = useShellNav();
  return (
    <div
      className="sg-page"
      data-leaving={leavingTo ? "" : undefined}
      data-leave-phase={leavePhase ?? undefined}
      data-leave-to={leavingTo ? productStageFromHref(leavingTo) : undefined}
    >
      {children}
    </div>
  );
}

/**
 * The room both product pages sit in: one sky, one header, one page at a time,
 * locked to the viewport. World and Space swap inside it; the sky, the header
 * and the sound chip never remount.
 */
export function ProductShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ShellNavProvider>
        <div className="sg-shell">
          <SpaceField />
          <ShellPage>{children}</ShellPage>
          <ProductHeader />
          <div className="sg-sound">
            <AudioChrome />
          </div>
        </div>
      </ShellNavProvider>
    </Suspense>
  );
}
