"use client";

import dynamic from "next/dynamic";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { useContext, useEffect, useState } from "react";
import { HopContext } from "@/components/stage/hop/HopProvider";
import { stageHostsBiome } from "@/components/stage/layers/world/world-layer-model";
import { useStageCover } from "@/components/stage/StageSlots";
import type { StageDirector } from "@/lib/stage/director";
import type { CanvasWorld } from "@/lib/world/types";
import { BiomeConceptLayer } from "./BiomeConceptLayer";
import type { CatastropheEvent } from "./ice-town/scene/catastrophe-sequence";
import type { LocalBiomeId } from "./types";

const FrontierMount = dynamic(() => import("./frontier-town/Mount").then((mod) => mod.FrontierMount), { ssr: false });
const CoastalMount = dynamic(() => import("./coastal-ruins/Mount").then((mod) => mod.CoastalMount), { ssr: false });
const JungleMount = dynamic(() => import("./jungle-forest-village/Mount").then((mod) => mod.JungleMount), { ssr: false });
const MeadowMount = dynamic(() => import("./medieval-meadow-kingdom/Mount").then((mod) => mod.MeadowMount), { ssr: false });
const NordicMount = dynamic(() => import("./nordic-volcanic-highlands/Mount").then((mod) => mod.NordicMount), { ssr: false });
// The stage-hosted land (ice-town, S4-1; permanent since gate 4): loads the ice-town scene with it.
const DevelopedBiomeStageHost = dynamic(() => import("./DevelopedBiomeStageHost").then((mod) => mod.DevelopedBiomeStageHost), { ssr: false });

/**
 * A land with its own canvas (`OWN_CANVAS_BIOMES`) stands in for the stage's
 * world layer toward the director: it is the world rung while mounted (a
 * teleport on mount and back to the planet on unmount at rest, as
 * `WorldLayer` does) and a ready world layer at once (the cloud dive's hold
 * waits for `readiness.world`; this canvas has nothing to compile under the
 * deck), and it covers the stage so the stage pauses while the director
 * rests behind it. Outside the product shell (a shared-world visit, a design
 * page) there is no director and nothing to do.
 */
function useOwnCanvasLand(director: StageDirector | null): void {
  useStageCover(director !== null);
  useEffect(() => {
    if (!director) return;
    director.readiness.set("world", true);
    if (!director.sample().moving) director.teleport("world");
    return () => {
      director.readiness.set("world", false);
      const s = director.sample();
      if (!s.moving && s.rung === "world") director.teleport("planet");
    };
  }, [director]);
}

export function DevelopedBiomeCanvas({
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
  /** The latest result that landed on the course (`landOutcome`); the ice town storms on `fail` and heals on `pass`. */
  result?: CatastropheEvent;
  onFocusDistrict?: (id: string | null) => void;
  world?: CanvasWorld | null;
  selectedId?: string | null;
  hoveredId?: string | null;
  changedIds?: ReadonlySet<string>;
  onSelect?(conceptId: string | null): void;
  onHover?(conceptId: string | null): void;
}) {
  // The ice land renders as a layer of the persistent stage and no canvas is created here
  // (`STAGE_WORLD_BIOMES`); every other developed biome keeps its own canvas.
  if (stageHostsBiome(visual)) {
    return (
      <DevelopedBiomeStageHost
        visual={visual}
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
    );
  }
  return (
    <OwnCanvasLand
      visual={visual}
      progress={progress}
      world={world}
      selectedId={selectedId}
      hoveredId={hoveredId}
      changedIds={changedIds}
      onSelect={onSelect}
      onHover={onHover}
    />
  );
}

function OwnCanvasLand({
  visual,
  progress,
  world,
  selectedId,
  hoveredId,
  changedIds,
  onSelect,
  onHover,
}: Required<Pick<Parameters<typeof DevelopedBiomeCanvas>[0], "visual" | "progress" | "world" | "selectedId" | "hoveredId" | "onSelect" | "onHover">> &
  Pick<Parameters<typeof DevelopedBiomeCanvas>[0], "changedIds">) {
  const [dpr, setDpr] = useState<[number, number]>([1, 1.5]);
  const [frameloop, setFrameloop] = useState<"always" | "demand">("always");
  useOwnCanvasLand(useContext(HopContext)?.director ?? null);

  useEffect(() => {
    const onVis = () => setFrameloop(document.hidden ? "demand" : "always");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div
      className="absolute inset-0 min-h-0 min-w-0"
      data-land-mount={visual}
      role="application"
      aria-label="Course land. Drag to look around; pick a place from the Land panel; Escape returns to the overview."
    >
      <Canvas
        dpr={dpr}
        frameloop={frameloop}
        camera={{ position: [18, 78, 188], fov: 36, near: 0.5, far: 3000 }}
        // Every land runs the 2 px pixel pass, which draws through an offscreen target; MSAA on
        // the default framebuffer would only cost bandwidth (the globe canvas is set up the same).
        gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor("#dbe2ee");
          camera.lookAt(2, 2.4, 8);
          camera.updateMatrixWorld();
        }}
      >
        <PerformanceMonitor onDecline={() => setDpr([1, 1])} />
        {visual === "frontier-town" ? <FrontierMount progress={progress} /> : null}
        {visual === "coastal-ruins" ? <CoastalMount progress={progress} /> : null}
        {visual === "jungle-forest-village" ? <JungleMount progress={progress} /> : null}
        {visual === "medieval-meadow-kingdom" ? <MeadowMount progress={progress} /> : null}
        {visual === "nordic-volcanic-highlands" ? <NordicMount progress={progress} /> : null}
        <BiomeConceptLayer
          visual={visual}
          world={world}
          selectedId={selectedId}
          hoveredId={hoveredId}
          changedIds={changedIds}
          onSelect={onSelect}
          onHover={onHover}
        />
      </Canvas>
    </div>
  );
}
