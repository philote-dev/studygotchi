import { Suspense } from "react";
import { ConstellationPage } from "@/components/constellation/ConstellationPage";
import { ConstellationTwinMount } from "@/components/stage/layers/constellation/TwinMount";

export default function KnowledgePage() {
  return (
    // No fallback: the constellation blooms out of the planet point on the spring, and the workspace
    // shows its own "Charting your sky…" status while the graph loads.
    <Suspense fallback={null}>
      {/* The WebGL twin, the one constellation renderer (gate 2): before the page in the DOM so it sits under the chrome. */}
      <ConstellationTwinMount />
      <ConstellationPage />
    </Suspense>
  );
}
