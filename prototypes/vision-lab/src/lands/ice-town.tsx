import { ARCHIPELAGO_POSES, ArchipelagoScene } from './ice-town/archipelago'
import { COAST_POSES, CoastScene } from './ice-town/expedition-coast'
import { FJORD_POSES, FjordScene } from './ice-town/fjord-village'
import type { LandVision } from './types'

/**
 * Ice / Chilly Town: three compositions of the same world (the references in
 * docs/design/world/refs: Penguin Isle plates, the snowy fishing village, the arctic research
 * slab, the ice arch, soft rounded snow mountains) at archipelago scale and density. Each houses
 * the six product districts (harbour, town, lake, pine town, glacier / camp, research island) and
 * the igloo → observatory → red-cap lighthouse landmark site, so course topics keep their regions.
 */
export const iceTown: LandVision = {
  id: 'ice-town',
  name: 'Ice / Chilly Town',
  story: 'A research town on an ice shelf: harbour, red-cap lighthouse, pine town, mountain camp, research island.',
  directions: [
    {
      id: 'a',
      name: 'Penguin Isle Archipelago',
      lineage:
        'Penguin Isle’s pale rounded plates at several heights, boardwalks and stairs between them, crystal spires, igloo camp, oversized lighthouse rock and balloon; scaled up so the town plate holds a whole fishing village.',
      pitch:
        'A cluster of pale ice plates at four heights floats in deep teal water: the harbour plate low with piers, boats and red stilt cabins on its rim; the town plate above it dense with cabins on winding lanes; the lake plate with the skating ring and a penguin circle on the ice; the pine plate in drifts of snow pines with forest cabins; the glacier plate highest with saturated blue crystal spires, pale ice pinnacles and the igloo camp; the research slab with the red station on stilts, mast, helipad and an icebreaker frozen into cracked ice. Plank bridges and short stairs join the plates, the oversized lighthouse stands on its own rock at the harbour, a whale surfaces between plates and a balloon drifts over the town. Soft rounded mountains close the north.',
      strengths: [
        'The closest match to the strongest reference: plates, crystals, lighthouse rock, igloo, camp, penguins, whale and balloon all have their place.',
        'Plates are the growth grammar for free: one plate per district, its height the course order, bridges appearing as topics connect.',
        'Penguin Isle’s “a lot going on at toy scale” reads from the overview: every plate has its own crowd.',
        'Water between plates keeps every district silhouetted against deep teal, so the land reads at 48 px.',
      ],
      risks: [
        'Plates read as a diorama from low angles; the product camera must keep a Penguin Isle pitch (35–45°) to see across the gaps.',
        'Bridges and stairs are authored joins; moving a district means re-authoring them.',
        'A dense town plate is the triangle hog; the cabin budget needs instancing in the product too.',
      ],
      Scene: ArchipelagoScene,
      poses: ARCHIPELAGO_POSES,
    },
    {
      id: 'b',
      name: 'Fjord Fishing Village',
      lineage:
        'The snowy fishing village’s red and blue cabins, winding lanes, church, lit plaza tree and stilt piers, placed on a bay under the winter-valley reference’s soft rounded mountains; the glowing frozen river and the ice arch with the lighthouse rock at the mouth.',
      pitch:
        'A bay runs north between gently rising shores under soft rounded snow mountains. The village fills the east shore in winding lanes of red, blue, orange and cream cabins with white trim, the red church on its knoll, the plaza with the lit tree and frozen fountain, stilt cabins at the waterline and long piers with boats; a smaller village mirrors it on the west shore. A frozen river comes down from the lake in the foothills through the pine town to the bay and glows at night. The head of the fjord is frozen and closed by a glacier wall with crystal spires and the camp above; at the mouth the ice arch stands beside the oversized lighthouse on its rock, and the research islet with its red modules sits in the bay.',
      strengths: [
        'The densest village of the three: lanes, piers and chimneys read as one living town from the hero and from inside a lane.',
        'Water, river and lake are one continuous system from the glacier to the mouth, which the product’s wet band and night glow can own.',
        'Soft mountains make a horizon at every pose, so the land never shows an edge.',
        'The walk shot is the fishing-village reference at eye height: cabins both sides, the bay and the piers below, the church ahead.',
      ],
      risks: [
        'Districts share one continuous shore; the product needs real lane logic for scatter or cabins will land on slopes and in the river.',
        'The glacier and the lighthouse are 230 m apart, so one overview cannot favour both; the arrival camera must choose the mouth.',
        'The most cabins of the three, so the most catastrophe-crack work: the whole bay is one plate.',
      ],
      Scene: FjordScene,
      poses: FJORD_POSES,
    },
    {
      id: 'c',
      name: 'Expedition Coast',
      lineage:
        'The arctic research slab (red modules on stilts, mast, helipad, icebreaker in cracked ice, whale tail) as the civic centre of a shore village; the ice arch and crystal cave references for the glacier end of the coast.',
      pitch:
        'A long snow coast faces a frozen sea cracked into dark leads. The squarish research slab sits just offshore, joined to the beach by two plank bridges: red modules on stilts along a raised walkway, the mast, the helipad, fuel tanks and vehicles, and the icebreaker frozen into the open lead beside it where a whale surfaces and seals haul out on the ice. A village of cabins runs along the shore on a coast lane and a back lane with piers out over the ice; the frozen lake with the skating ring lies inland; pine drifts climb the ridge behind to the pine-town lane; the glacier spills onto the western coast as a 24 m wall with the ice arch standing in front and a crystal cave glowing in its face; the lighthouse stands on the east point and soft rounded mountains close the horizon.',
      strengths: [
        'The most “research town” of the three: the slab, mast, icebreaker and leads are the land’s story made literal.',
        'Cracked ice is a built-in catastrophe language: leads widen, floes drift, the slab plate cracks exactly as the growth doc asks.',
        'Horizontal and calm, so the mast, the arch and the lighthouse are the only verticals and all three read against the sea.',
        'Simplest terrain of the three: one coast, one shelf, one glacier; ports to the current flat-plate scatter with the least work.',
      ],
      risks: [
        'Flat and wide is closest to today’s plate; it only beats it if the leads, the village density and the glacier are all built.',
        'A frozen sea hides the deep teal water that makes the other two read as ice at a glance; the open lead must stay large.',
        'The slab is the hero and the research district at once, so the district order (slab last) fights the composition (slab centre).',
      ],
      Scene: CoastScene,
      poses: COAST_POSES,
    },
  ],
}
