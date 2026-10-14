"use client";

import { WorldPage } from "@/components/world/WorldPage";
import { visualForGlobeBiome } from "@/components/world/biomes/types";
import type { GlobeBiome } from "@/components/world/globe/globe-types";
import { rosterBiome } from "@/lib/world/globe-courses";
import type { WorldResponse } from "@/lib/world/types";

/**
 * A freshly mounted land after the globe unloads. The key on this tree is the
 * course id so each dive gets its own scene, instead of morphing the planet
 * in place. The ice land renders through the persistent stage, whose cloud
 * dive brings the camera down onto it (gate 4, 2026-10-13); the other
 * developed biomes keep their own canvas (`OWN_CANVAS_BIOMES`) and dissolve in.
 */
export function BiomeLand({
  courseId,
  biome,
  focusDistrict,
  onFocusDistrict,
  onWorld,
  hoveredId,
  onHover,
}: {
  courseId: string;
  biome: GlobeBiome;
  focusDistrict?: string | null;
  onFocusDistrict?: (id: string | null) => void;
  onWorld?: (world: WorldResponse | null) => void;
  hoveredId?: string | null;
  onHover?: (conceptId: string | null) => void;
}) {
  return (
    <div
      className="biome-land-stage"
      data-biome={biome}
      data-visual={visualForGlobeBiome(biome)}
    >
      <WorldPage
        courseId={courseId}
        visual={visualForGlobeBiome(biome)}
        landBiome={rosterBiome(biome)}
        onWorld={onWorld}
        hoveredId={hoveredId}
        onHover={onHover}
        focusDistrict={focusDistrict}
        onFocusDistrict={onFocusDistrict}
      />
    </div>
  );
}
