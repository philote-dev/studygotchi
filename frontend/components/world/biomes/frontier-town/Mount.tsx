"use client";

import { useMemo, useState } from "react";
import { FRONTIER_LAYOUT as L } from "./layout/biome-layout";
import { defaultOverride } from "./camera/stations";
import { FrontierScene } from "./scene/FrontierScene";
import type { LabState } from "./state";
import { useLandArrival } from "../useLandArrival";
import { useReducedMotion, useSpaceAttribute } from "@/components/shell/useSpaceAttribute";
import { useEdgeLab } from "./edge/use-edge-lab";

export function FrontierMount({ progress }: { progress: number }) {
  const fraction = Math.min(1, Math.max(0, progress));
  const { onDiveEnd, station } = useLandArrival();
  const [focus, setFocus] = useState<string | null>(null);
  // Day / night follows the page colour scheme (bible §6), as the ice land does.
  const night = useSpaceAttribute() === "dark";
  const reducedMotion = useReducedMotion();
  // Edge lab (`?edge=none|outer`, `?pose=`): the outer world ships on; `none` is the slab as it was.
  const edgeLab = useEdgeLab();
  const state = useMemo<LabState>(
    () => ({
      progress: Object.fromEntries(L.districts.map((district) => [district.id, fraction])),
      residents: Math.max(8, 10),
      seed: 7,
      night,
      dust: true,
      train: true,
      wildlife: true,
      pixel: true,
      station,
      focusDistrict: focus,
      camera: defaultOverride(station),
      catastrophe: { districtId: null, phase: "calm" },
      edge: edgeLab.mode,
      pose: edgeLab.pose,
      customCamera: edgeLab.custom,
      reducedMotion,
    }),
    [edgeLab.custom, edgeLab.mode, edgeLab.pose, focus, fraction, night, reducedMotion, station],
  );
  return (
    <FrontierScene
      state={state}
      onPickDistrict={(id) => {
        setFocus(id);
        onDiveEnd();
      }}
    />
  );
}
