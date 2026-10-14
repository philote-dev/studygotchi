import { useMemo } from 'react'
import { buildCitadelPlan } from './medieval-meadow-kingdom/citadel'
import { buildLakePlan } from './medieval-meadow-kingdom/lake'
import { buildMarketPlan } from './medieval-meadow-kingdom/market'
import { PlanScene } from './medieval-meadow-kingdom/scene'
import type { BlockoutSceneProps, Direction, LandVision } from './types'

function CitadelScene({ night, seed }: BlockoutSceneProps) {
  const plan = useMemo(() => buildCitadelPlan(seed), [seed])
  return <PlanScene plan={plan} night={night} />
}

function LakeScene({ night, seed }: BlockoutSceneProps) {
  const plan = useMemo(() => buildLakePlan(seed), [seed])
  return <PlanScene plan={plan} night={night} />
}

function MarketScene({ night, seed }: BlockoutSceneProps) {
  const plan = useMemo(() => buildMarketPlan(seed), [seed])
  return <PlanScene plan={plan} night={night} />
}

const market: Direction = {
  id: 'c',
  name: 'Market Kingdom',
  lineage:
    "Carcassonne set in a Bruegel countryside, with the Overwatch Ruins / Eichenwalde castle-on-the-hill as horizon punctuation and Age of Empires wonder scale; differs by making the fields, not the walls, the composition.",
  pitch:
    'The patchwork is the picture. A walled market city sits on a low rise in the middle of a vast quilt of wheat, pasture, orchard and hedgerow; four gates throw roads across the fields to a river bridge, a mill village on the bend, an abbey on its knoll and a striped tournament field outside the south gate. Three castles answer the city from the surrounding hills, the Crown Castle on the tallest, so the horizon always has a silhouette wherever you look. Inside the walls, radial streets run from the gates to the market square under the cathedral spire and the belfry. Castle Court is the Crown Castle, Bridge Market is the city, the River Village is the mill bend, the Farm Common is the windmill rise, the Forest Hamlet shelters under Westmark.',
  strengths: [
    'The most expansive of the three: the eye travels across fields from castle to castle, the "huge civilisation map" feeling.',
    'Growth reads everywhere at once: fields fill in, hamlets appear, castles gain towers; every district is in view from the overview.',
    'The walk shot is a real street: houses on both sides, a gate behind you, a spire ahead.',
    'Closest to the current product layout (river, bridge market, farm common, castle headland), so the least disruptive to course mapping.',
  ],
  risks: [
    'The weakest single silhouette: no one object dominates, so the 48 px marker needs a deliberate hero (the Crown Castle or the spire).',
    'Patchwork and hedgerows are many small meshes; the field system needs instancing or texture tricks at full fidelity.',
    'Three castles plus a city plus an abbey is a lot of architecture to carry to stage-3 fidelity.',
  ],
  Scene: MarketScene,
  poses: [
    { id: 'hero', position: [-146, 62, 190], target: [24, 14, -34], fov: 34 },
    { id: 'walk', position: [12.8, 9.6, 51.7], target: [7, 20, -2], fov: 50 },
    { id: 'overview', position: [0, 262, 360], target: [0, 0, 0], fov: 36 },
    { id: 'reverse', position: [150, 86, -172], target: [0, 8, 30], fov: 36 },
  ],
}

const lake: Direction = {
  id: 'b',
  name: 'Lake Kingdom',
  lineage:
    "Ilios Well's plazas over blue water and Lake Bled's island church, with Mont-Saint-Michel's causeway approach and Sirmione's drawbridge; differs by being a kingdom of islands, not one rock.",
  pitch:
    'The land is a bowl and the bowl is full of water. Three islands carry the kingdom: the keep isle, ringed by a quay town inside its wall and stepping up through a bailey to a square donjon; the cathedral isle, whose spire answers the keep across a long bridge of arches; and the market isle, reached from the south shore by a causeway and tied to the keep by a drawbridge under twin towers. The lake drains south-east over a weir where the mills turn; the north shore is terraced into fields with the windmill above them; the forest hamlet keeps boats on the west shore. Every walk is over water, and the hero silhouette is two towers rising from a flat blue plane.',
  strengths: [
    'Water is the composition instrument: islands, causeways, reflections of light at night, boats as moving life.',
    'Districts are literally separate islands and shores, so topics read as places you cross water to reach.',
    'The flattest hero silhouette of the three is also the calmest: keep and spire over a mirror, hills closing the bowl behind.',
    'Cheapest to build to fidelity: most of the land is a water plane and gentle shore terrain.',
  ],
  risks: [
    'Verticality is modest (46 m keep against a 15 m isle); it relies on the two towers rather than terrain drama.',
    'Water needs a real shader (reflection, shore foam) to carry the postcard; a flat toon sheet undersells it.',
    'Progress bands have fewer terrain beats; growth must come from quays, bridges and islands filling in.',
  ],
  Scene: LakeScene,
  poses: [
    { id: 'hero', position: [104, 52, 190], target: [-16, 14, -24], fov: 36 },
    { id: 'walk', position: [-45.6, 4.3, 26.6], target: [-24, 17, -20], fov: 50 },
    { id: 'overview', position: [0, 262, 360], target: [0, 0, 0], fov: 36 },
    { id: 'reverse', position: [-126, 74, -156], target: [30, 4, 50], fov: 36 },
  ],
}

const citadel: Direction = {
  id: 'a',
  name: 'Citadel on the Crag',
  lineage: 'Minas Tirith by way of Mont-Saint-Michel and Rocamadour: one tall object read from across a plain; differs by the working river town at its foot and the fields that feed it.',
  pitch:
    'A limestone spur grows out of the northern hills and seven terraces of pale wall climb its south face, each gate offset from the last so the street zig-zags up ramps hung on the walls. The cathedral spire and the round keep crown the seventh tier; a stone prow splits the city down the middle. Castle Court is the citadel, the tiers are the guild quarters, the Bridge Market sits in the lower town between the Great Gate and a three-arch bridge, the mill turns on the river bank, the Farm Common is the patchwork across the water and the Forest Hamlet hides on the wooded west flank. Characters walk a street that is always climbing, with walls stacked overhead.',
  strengths: [
    'The strongest silhouette of the three: a 110 m stack of walls, towers and spire that reads at any distance and at 48 px.',
    'Verticality is the gameplay map: each tier is a district band, so course progress can light the city upward tier by tier.',
    'The walk shot is unmistakably inside a place: ramps, gate towers and parapets frame every view of the plain below.',
    'Day/night both work: stacked windows become a lit cone at night; by day the pale stone throws long tier shadows.',
  ],
  risks: [
    'Camera: the back of the crag hides the citadel from northern azimuths; the free orbit needs a yaw clamp or a lower back ridge.',
    'Cost: terraces, seven wall rings and dense tier housing make this the heaviest direction to bring to full fidelity.',
    'Progress bands: terraces are fixed terrain, so growth must come from buildings and lights rather than terrain tiers.',
  ],
  Scene: CitadelScene,
  poses: [
    { id: 'hero', position: [150, 52, 190], target: [-16, 34, -30], fov: 34 },
    { id: 'walk', position: [-3, 3, 71], target: [-10, 15, 14], fov: 50 },
    { id: 'overview', position: [0, 262, 360], target: [0, 0, 0], fov: 36 },
    { id: 'reverse', position: [-50, 118, -176], target: [-4, 22, 60], fov: 36 },
  ],
}

export const medievalMeadowKingdom: LandVision = {
  id: 'medieval-meadow-kingdom',
  name: 'Medieval Meadow Kingdom',
  story: 'A river kingdom of fields and stone: castle, cathedral town, mills, farms, the river that feeds them.',
  directions: [citadel, lake, market],
}
