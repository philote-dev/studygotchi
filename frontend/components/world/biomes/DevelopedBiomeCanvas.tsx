"use client";

import dynamic from "next/dynamic";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { useEffect, useState } from "react";
import type { IceDemoState } from "@/lib/world/demo-theater";
import type { CanvasWorld } from "@/lib/world/types";
import { BiomeConceptLayer } from "./BiomeConceptLayer";
import type { LocalBiomeId } from "./types";

const FrontierMount = dynamic(() => import("./frontier-town/Mount").then((mod) => mod.FrontierMount), { ssr: false });
const CoastalMount = dynamic(() => import("./coastal-ruins/Mount").then((mod) => mod.CoastalMount), { ssr: false });
const JungleMount = dynamic(() => import("./jungle-forest-village/Mount").then((mod) => mod.JungleMount), { ssr: false });
const MeadowMount = dynamic(() => import("./medieval-meadow-kingdom/Mount").then((mod) => mod.MeadowMount), { ssr: false });
const NordicMount = dynamic(() => import("./nordic-volcanic-highlands/Mount").then((mod) => mod.NordicMount), { ssr: false });
const IceTownMount = dynamic(() => import("./ice-town/Mount").then((mod) => mod.IceTownMount), { ssr: false });

export function DevelopedBiomeCanvas({
  visual,
  progress,
  focusDistrict,
  iceDemo,
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
  iceDemo?: IceDemoState;
  onFocusDistrict?: (id: string | null) => void;
  world?: CanvasWorld | null;
  selectedId?: string | null;
  hoveredId?: string | null;
  changedIds?: ReadonlySet<string>;
  onSelect?(conceptId: string | null): void;
  onHover?(conceptId: string | null): void;
}) {
  const [dpr, setDpr] = useState<[number, number]>([1, 1.5]);
  const [frameloop, setFrameloop] = useState<"always" | "demand">("always");

  useEffect(() => {
    const onVis = () => setFrameloop(document.hidden ? "demand" : "always");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div className="absolute inset-0 min-h-0 min-w-0" data-land-mount={visual}>
      <Canvas
        dpr={dpr}
        frameloop={frameloop}
        camera={{ position: [18, 78, 188], fov: 36, near: 0.5, far: 3000 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
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
        {visual === "ice-town" ? (
          <IceTownMount
            progress={progress}
            focusDistrict={focusDistrict}
            iceDemo={iceDemo}
            onFocusDistrict={onFocusDistrict}
          />
        ) : null}
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
