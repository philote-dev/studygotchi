import { MesaCrownScene } from './frontier-town/mesa-crown'
import { RoundhousePlainScene } from './frontier-town/roundhouse-plain'
import { TrestleGorgeScene } from './frontier-town/trestle-gorge'
import type { LandVision } from './types'

export const frontierTown: LandVision = {
  id: 'frontier-town',
  name: 'Frontier Town',
  story: 'A red-rock frontier: mesas, a rail line, a main street of false fronts, canyons and washes.',
  directions: [
    {
      id: 'a',
      name: 'Mesa Crown',
      lineage: 'Acoma Sky City and Minas Tirith stacked on a Monument Valley mesa; Hollow Knight verticality; Ilios cliff edges.',
      pitch:
        'The whole town rides one stratified mesa fifty metres above the canyon floor. Main Street runs the mesa spine from the lift plaza to the mission bell tower on the prow; false fronts, a water tower and pueblo terraces make the skyline you remember from the railhead below. Characters arrive by the aerial lift up the sheer prow or the five switchbacks carved into the talus apron, and walk past saloons with the canyon dropping away at the end of every alley. Districts: town on the crown, railhead and lift base at the foot, mine against the north-east flank, ranch on the west bench, dig in the wash bend, reserve beyond the rail with the lookout rise.',
      strengths: [
        'One silhouette: the mesa with the bell tower and water tower reads at every distance, including 48 px.',
        'Real verticality with gameplay meaning: arriving by lift or switchbacks is the dive from the globe.',
        'Strata bands run through the whole land, so the cliff, the bench and the far buttes feel like one geology.',
        'Every district is visible from the crown and the crown from every district.',
      ],
      risks: [
        'Street-level camera on the crown needs a shifted datum (street at y = 10) and careful clipping at the rim.',
        'The canyon floor districts are far from the main street, so progress there reads small from the walk camera.',
        'Lift and switchbacks need real animation and collision work to deliver the arrival fantasy.',
      ],
      Scene: MesaCrownScene,
      poses: [
        { id: 'hero', position: [84, 50, 158], target: [-10, 2, -10], fov: 34 },
        { id: 'walk', position: [36, 11.9, 12], target: [-42, 24, -42], fov: 46 },
        { id: 'overview', position: [46, 236, 300], target: [0, -18, -8], fov: 36 },
        { id: 'reverse', position: [120, 64, -186], target: [-28, -12, 8], fov: 34 },
      ],
    },
    {
      id: 'b',
      name: 'Trestle Gorge',
      lineage: 'Ilios Well cliff stacking and Mesa Verde alcoves; Red Dead’s Bacchus trestle; Hollow Knight stairs down a wall.',
      pitch:
        'A river has cut a forty-metre gorge through the plain and the town clings to its west wall: Main Street runs along the rim with saloons cantilevered over the drop, three terraces of adobe step down to a mill at the water, and a tall timber trestle carries the railway across the gap to the depot on the far rim. The ranch creek falls into the gorge as a slot waterfall; the mine chute drops ore from the east rim to barges; the dig sits in a cliff alcove. Characters walk the rim boardwalk with the bridge framed at the end of the street and the river glinting below.',
      strengths: [
        'Edge-led composition: every view has a drop, water and a span in it.',
        'The trestle is a true hero silhouette and a train crossing it is the land’s signature event.',
        'Districts stack vertically inside one view, so progress in any of them is visible from the rim.',
      ],
      risks: [
        'Camera clipping into the gorge walls when the walk camera turns toward the drop.',
        'The gorge divides the land; crossing is only by the bridge, which complicates resident paths.',
        'Water, waterfall and the terrace stairs are the most expensive pieces to take to full fidelity.',
      ],
      Scene: TrestleGorgeScene,
      poses: [
        { id: 'hero', position: [12, 18, 166], target: [-8, -24, -72], fov: 34 },
        { id: 'walk', position: [-54, 2.2, 14], target: [-28, 3, -76], fov: 46 },
        { id: 'overview', position: [70, 236, 300], target: [0, -12, -10], fov: 36 },
        { id: 'reverse', position: [150, 54, -186], target: [-30, -10, 10], fov: 34 },
      ],
    },
    {
      id: 'c',
      name: 'Roundhouse Plain',
      lineage: 'Red Dead’s Saint Denis civic scale on an Armadillo plain; Cheyenne and Promontory railheads; Taos Pueblo on the far mesa.',
      pitch:
        'A rail-boom civilisation spread across the plain: a double-track main line, a brick-red roundhouse fanned around its turntable, three water towers, a coal tipple and a grain elevator make an industrial skyline where the other directions have rock. Main Street runs south from the depot plaza through a true grid of false fronts to the mission; the ranch grid of fields, corrals and wind pumps fills the south-west; saguaro dunes and the lookout rise lie east; a pueblo steps up the far mesa that closes the north. A train is always moving somewhere in the frame.',
      strengths: [
        'Civilisation at scale: the grid, the roundhouse and the far pueblo give the sense of a whole country, not a set.',
        'Flat ground keeps the fixed south camera, collision and resident walking simple.',
        'The most room for growth bands: every district has empty lots that fill visibly.',
      ],
      risks: [
        'Least verticality of the three; the drama depends on silhouettes and the far mesa rather than relief.',
        'A wide plain can read as empty at 0 % progress unless the rail infrastructure is there from the start.',
        'Many small buildings mean the highest instancing and draw-call discipline of the three.',
      ],
      Scene: RoundhousePlainScene,
      poses: [
        { id: 'hero', position: [168, 46, 176], target: [-6, 8, -30], fov: 34 },
        { id: 'walk', position: [3, 2.2, 70], target: [2, 9, -70], fov: 46 },
        { id: 'overview', position: [30, 244, 310], target: [0, 0, -10], fov: 36 },
        { id: 'reverse', position: [-186, 74, -128], target: [24, 4, 16], fov: 34 },
      ],
    },
  ],
}
