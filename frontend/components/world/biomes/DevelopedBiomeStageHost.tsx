"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorldLayer } from "@/components/stage/layers/WorldLayer";
import { useStageSlot } from "@/components/stage/StageSlots";
import type { CanvasWorld } from "@/lib/world/types";
import type { CatastropheEvent } from "./ice-town/scene/catastrophe-sequence";
import type { LocalBiomeId } from "./types";

const EdgeLabPanel = dynamic(() => import("./ice-town/edge/EdgeLabPanel").then((mod) => mod.EdgeLabPanel), { ssr: false });

/**
 * S4-1: the land as a layer of the persistent stage (the `world` flag). The
 * page keeps the same `[data-land-mount]` host div with its `role="application"`
 * label, the hover attributes and the pointer input; the scene itself is handed
 * to the stage canvas through the `world` slot, where the stage composer draws
 * it inside this host's box, so the CSS arrival on the land stage still moves
 * the land. No WebGL canvas is created here.
 */
export function DevelopedBiomeStageHost({
  visual,
  progress,
  focusDistrict,
  result,
  onFocusDistrict,
  world = null,
  selectedId = null,
  hoveredId = null,
  changedIds,
  onSelect = () => undefined,
  onHover = () => undefined,
}: {
  visual: Exclude<LocalBiomeId, "ice-golden" | "island">;
  progress: number;
  focusDistrict?: string | null;
  result?: CatastropheEvent;
  onFocusDistrict?: (id: string | null) => void;
  world?: CanvasWorld | null;
  selectedId?: string | null;
  hoveredId?: string | null;
  changedIds?: ReadonlySet<string>;
  onSelect?(conceptId: string | null): void;
  onHover?(conceptId: string | null): void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const attachHost = useCallback((el: HTMLDivElement | null) => {
    hostRef.current = el;
    setHost(el);
  }, []);
  const [edgeLab, setEdgeLab] = useState(false);
  useEffect(() => {
    setEdgeLab(new URLSearchParams(window.location.search).has("edge"));
  }, []);

  useStageSlot(
    "world",
    host && visual === "ice-town" ? (
      <WorldLayer
        host={host}
        progress={progress}
        focusDistrict={focusDistrict}
        result={result}
        onFocusDistrict={onFocusDistrict}
        world={world}
        selectedId={selectedId}
        hoveredId={hoveredId}
        changedIds={changedIds}
        onSelect={onSelect}
        onHover={onHover}
      />
    ) : null,
  );

  return (
    <div
      ref={attachHost}
      className="absolute inset-0 min-h-0 min-w-0"
      data-land-mount={visual}
      data-stage="true"
      role="application"
      aria-label="Course land. Drag to look around; pick a place from the Land panel; Escape returns to the overview."
    >
      {edgeLab ? <EdgeLabPanel /> : null}
    </div>
  );
}
