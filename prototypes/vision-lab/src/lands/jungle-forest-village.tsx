import { CrownCityScene } from './jungle-forest-village/crown-city'
import { FallsLagoonScene } from './jungle-forest-village/falls-lagoon'
import { ForestSettlementScene } from './jungle-forest-village/forest-settlement'
import type { Direction, LandVision } from './types'

/**
 * Jungle Forest Village: an inhabited vertical village in layered canopy above waterfall, lagoon,
 * bridges and ruins. Three blockouts with different dynamics, all wood, rope and tree:
 *   A  vertical   Crown City          decks at three heights in six giant trees, a rope loop above the clearing
 *   B  water-led  Falls and Lagoon    the 18 m fall, a chain of pools, stilt hall and docks on the lagoon
 *   C  sprawling  Forest Settlement   a wide ground village of trunk towers and galleries under giant trunks
 */
const crownCity: Direction = {
  id: 'a',
  name: 'Crown City',
  lineage:
    'Reference 01’s inhabited decks at several heights and 02’s exaggerated trunk-and-deck silhouettes, scaled to a whole village: Lothlórien dynamics without the elf architecture. Differs from a treehouse pack by being one connected loop above one clearing.',
  pitch:
    'Six giant trees stand around the Firefly clearing and the village lives in them: decks at 6, 11.5 and 18 m ring each trunk with rails, ladders and pods under warm windows, and a rope loop at the middle height joins all six above the clearing so you can walk the whole village without touching the ground. The Mother Tree to the north-west is the civic hub with four decks and the widest platform, reached by two spoke bridges. The river comes over the 18 m escarpment right beside the north-east tree, so the fall drops past its decks into the lagoon where the stilt hall, docks, canoes and reed beds of the Lagoon Quarter sit; the 27 m rope bridge crosses the river at the lip and the Falls Terraces homes sit at the top of the cliff and by the plunge pool in the spray. The ground is for farms, dye racks and the waterwheel of the Riverworks to the south-east, and for the Ruin Commons’ root gate and vine court to the south-west. The Root-Crown Shrine stands on a rock spur of the cliff, looking down on all of it.',
  strengths: [
    'The clearest answer to “inhabited vertical village”: three deck heights, ladders, a rope loop and pods read at every pose, including from the deck level.',
    'Growth bands map to heights: ground life first, low decks, the loop, then the high decks and spokes.',
    'The fall landing next to the decks gives the hero and walk poses water, height and village in one frame.',
    'Cheap: six trees carry most of the content; the forest sea does the rest.',
  ],
  risks: [
    'Decks hide the ground under the loop from the overview; the clearing has to stay open and lit.',
    'Rope spans of 35 m are long for a village; the full build may want intermediate posts or shorter hops.',
    'The Mother Tree sits outside the loop; the walk route needs the two spokes to feel like one circuit.',
  ],
  Scene: CrownCityScene,
  poses: [
    { id: 'hero', position: [88, 32, 106], target: [-12, 12, -22], fov: 38 },
    { id: 'walk', position: [25, 13.3, 29], target: [-44, 17, -20], fov: 50 },
    { id: 'overview', position: [20, 196, 250], target: [0, 6, -4], fov: 36 },
    { id: 'reverse', position: [-20, 72, -190], target: [0, 10, 20], fov: 34 },
  ],
}

const fallsLagoon: Direction = {
  id: 'b',
  name: 'Falls and Lagoon',
  lineage:
    'Reference 01’s lagoon-and-stream as the broad negative space with bamboo, reeds and rope spans, and 05’s bridge and river logic with a landmark on its own promontory. Differs from both by making the water the route: fall, pools, lagoon, outflow.',
  pitch:
    'The water is the spine. The river comes over the 18 m escarpment as one white fall with the 27 m rope bridge across its lip, drops through a chain of three pools stepping down between treehouse banks, and opens into the lagoon, where the long stilt hall, eight stilt houses, dock fingers, canoes and reed beds of the Lagoon Quarter stand in the shallows. Treehouses with single decks line both banks of the pools; the Great Canopy Village is the Mother Tree and two neighbours on the lagoon’s west shore with bridges between their decks. The Falls Terraces homes and shrine sit at the cliff top beside the lip with a stair down to the plunge pool. At the lagoon’s far edge the Ruin Commons stands half in the water: the root gate on the shore, a broken colonnade wading out, the vine court behind. Downstream the Riverworks wheel turns at the outflow beside the farm plots, and the Root-Crown Shrine stands on a rock knob that juts into the lagoon with water on three sides.',
  strengths: [
    'Water in every frame: fall, pools, lagoon and outflow read at 48 px as the biome’s own identity against Forest and Swamp.',
    'The walk pose from the dock looks up the whole spine to the fall; depth comes free.',
    'Stilt life, reeds and canoes give ground-level life that the vertical direction lacks.',
    'Progress has a natural order downstream: fall bridge, pools, docks, hall, outflow wheel.',
  ],
  risks: [
    'Less canopy verticality than A: the treehouses are single-deck, so the “village in the crowns” read depends on the west-shore cluster.',
    'A long lagoon pushes the Ruin Commons to the far edge, where it is small from the front camera.',
    'The three pool steps need authored banks in the full build; the heightfield only approximates the weirs.',
  ],
  Scene: FallsLagoonScene,
  poses: [
    { id: 'hero', position: [118, 54, 162], target: [26, 4, -40], fov: 36 },
    { id: 'walk', position: [14, 2.8, 41], target: [22, 12, -100], fov: 46 },
    { id: 'overview', position: [30, 206, 256], target: [26, 0, -10], fov: 36 },
    { id: 'reverse', position: [0, 66, -200], target: [36, 0, 10], fov: 34 },
  ],
}

const forestSettlement: Direction = {
  id: 'c',
  name: 'Forest Settlement',
  lineage:
    'Reference 04’s settlement scale: tall trunk towers, elevated galleries, smoke and a readable civic core under giant trees, with 05’s land-shaped districts and broad clearings. Differs from 04 by staying wood-and-thatch, open, and spread across clearings rather than wall-to-wall.',
  pitch:
    'An expansive village on the ground and in the lower canopy under giant trunks. The civic core is four trunk towers wrapped around living trees, three and four floors of wall rings and jewel roofs with smoke rising, joined by covered galleries at the second floor and to the Mother Tree’s wide civic deck; a root-road ring and a market of huts fill the ground between them. Around the core, clusters of houses with chimneys sit in and between broad clearings: farm plots and dye racks in the Sunbreak and Firefly clearings for the Riverworks, whose wheel turns on the river to the east; the Ruin Commons to the south-west with its root gate, vine court, market canopies and archive; the Lagoon Quarter’s stilt hall and docks on the lagoon at the east side; the Falls Terraces at the cliff top beside the 18 m fall in the north with the 27 m bridge at the lip. Ten giant trunks rise through everything to a canopy ceiling far above the roofs; root trails and local loops tie it together, and the Root-Crown Shrine stands on a knob at the lagoon’s mouth.',
  strengths: [
    'Reads as a civilisation: towers, galleries, smoke, a market ring and five districts in one glance.',
    'Most ground life of the three: residents, carts of farms, dye cloth, chimneys; the most to grow per band.',
    'Towers wrapped around trunks keep the hero wood-and-tree while giving the skyline real height.',
    'Clearings make the districts legible from the overview without any district reading as a kit lineup.',
  ],
  risks: [
    'Easiest of the three to drift towards 04’s orange wall-to-wall density; the clearings must stay broad.',
    'The ground-level village hides under the canopy ceiling from a 36° overview unless the giant trunks stay sparse.',
    'Most props per band to author (towers, galleries, 40 huts, smoke).',
  ],
  Scene: ForestSettlementScene,
  poses: [
    { id: 'hero', position: [130, 62, 160], target: [0, 12, -6], fov: 34 },
    { id: 'walk', position: [3, 10.9, 14.2], target: [-2, 14, -40], fov: 50 },
    { id: 'overview', position: [24, 204, 256], target: [0, 4, -6], fov: 36 },
    { id: 'reverse', position: [-10, 70, -196], target: [6, 8, 20], fov: 34 },
  ],
}

export const jungleForestVillage: LandVision = {
  id: 'jungle-forest-village',
  name: 'Jungle Forest Village',
  story: 'An inhabited vertical village fills layered canopy above waterfall, lagoon, bridges and ruins.',
  directions: [crownCity, fallsLagoon, forestSettlement],
}
