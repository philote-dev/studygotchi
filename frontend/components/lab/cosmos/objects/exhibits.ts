import { ASTEROID_RING_EXHIBIT } from "./AsteroidRing";
import { BINARY_EXHIBIT } from "./BinaryStar";
import { COMET_EXHIBIT } from "./Comet";
import { DARK_NEBULA_EXHIBIT } from "./DarkNebula";
import { EMISSION_NEBULA_EXHIBIT } from "./EmissionNebula";
import { GAS_GIANT_EXHIBIT } from "./GasGiant";
import { SMUDGES_EXHIBIT } from "./LensedSmudges";
import { PLANETARY_NEBULA_EXHIBIT } from "./PlanetaryNebula";
import { PROTO_DISC_EXHIBIT } from "./ProtoDisc";
import { PULSAR_EXHIBIT } from "./Pulsar";
import { ROGUE_PLANET_EXHIBIT } from "./RoguePlanet";
import { SATELLITES_EXHIBIT } from "./Satellites";
import { CLUSTER_EXHIBIT } from "./StarCluster";
import { SUPERNOVA_EXHIBIT } from "./SupernovaRemnant";
import type { AnyExhibit } from "./lib/types";

/** Gallery order: the first eight are the priority set, the rest are the background / dressing set. */
export const EXHIBITS: readonly AnyExhibit[] = [
  EMISSION_NEBULA_EXHIBIT,
  PLANETARY_NEBULA_EXHIBIT,
  SUPERNOVA_EXHIBIT,
  PULSAR_EXHIBIT,
  COMET_EXHIBIT,
  GAS_GIANT_EXHIBIT,
  BINARY_EXHIBIT,
  CLUSTER_EXHIBIT,
  PROTO_DISC_EXHIBIT,
  DARK_NEBULA_EXHIBIT,
  ASTEROID_RING_EXHIBIT,
  ROGUE_PLANET_EXHIBIT,
  SATELLITES_EXHIBIT,
  SMUDGES_EXHIBIT,
];

export const EXHIBIT_IDS: readonly string[] = EXHIBITS.map((e) => e.id);

export function exhibitById(id: string): AnyExhibit | undefined {
  return EXHIBITS.find((e) => e.id === id);
}
