import { concat } from './citadel'
import { HeightField, drapedQuadPositions, flatFanPositions, flatRibbonPositions, ribbonPositions } from './heightfield'
import { archBridge, carts, cathedral, hall, keep, lanterns, openingsNear, patchwork, roundTower, scatterTrees, stalls, streetHouses, wallRing, wobblyPolygon, yawFromDir } from './kit'
import { budgetFor, LAND_CELLS, LAND_SIZE, moverTriangles, type Classifier, type Mover, type Plan } from './plan'
import { houseLayers, treeLayers, type House, type InstancedLayer, type Item, type Tree } from './plan-types'
import { fbm, lerp, mulberry32, nightTone, polygonSignedDistance, polylineDistance, range, resample, smoothPolyline, smoothstep, type Vec2 } from './rng'

/**
 * Direction B — Lake Kingdom. A fortress-town on three islands in a lake basin: the keep isle
 * with its walled quay town and bailey, the cathedral isle, the market isle; causeways and a
 * drawbridge tie them together, mills sit on the weir where the lake drains south-east, and the
 * far north shore is terraced into fields. Water is the ground; every district is reached over it.
 */

const R = 175
/** The basin is stretched north-south so there is open water in front of the south causeway. */
const ZS = 1.12
const BASIN: Vec2 = [0, -6]
const BED = -5.5
const SHELF = 2.3
const LAKE_Y = 0
const TAIL_Y = -2.4
const OUTFLOW: Vec2[] = smoothPolyline([
  [56, 56],
  [80, 84],
  [98, 112],
  [116, 142],
  [132, 169],
])
const WEIR_T = 0.3

interface Tier {
  poly: Vec2[]
  height: number
  /** Horizontal width of the step down to the next level or the lake bed. */
  shore: number
}

interface Island {
  id: string
  centre: Vec2
  tiers: Tier[]
}

/** Normalised basin radius (1 at R). */
function basinD(x: number, z: number): number {
  return Math.hypot(x - BASIN[0], (z - BASIN[1]) / ZS) / R
}

function islandHeight(island: Island, x: number, z: number): number {
  let h = BED
  for (const tier of island.tiers) {
    const sd = polygonSignedDistance(tier.poly, x, z)
    const w = smoothstep(tier.shore, -0.6, sd)
    h = Math.max(h, lerp(BED, tier.height, w))
  }
  return h
}

function scaled(poly: readonly Vec2[], centre: Vec2, factor: number, shift: Vec2 = [0, 0]): Vec2[] {
  return poly.map(([x, z]) => [centre[0] + shift[0] + (x - centre[0]) * factor, centre[1] + shift[1] + (z - centre[1]) * factor])
}

function closedPath(poly: readonly Vec2[], step: number): Vec2[] {
  return resample([...poly, poly[0]], step)
}

/** Point where a ray from the centre leaves the polygon, pulled `inset` metres back inside. */
function edgePoint(poly: readonly Vec2[], centre: Vec2, dir: Vec2, inset = 0): Vec2 {
  const len = Math.hypot(dir[0], dir[1]) || 1
  const ux = dir[0] / len
  const uz = dir[1] / len
  let lo = 0
  let hi = 80
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (polygonSignedDistance(poly, centre[0] + ux * mid, centre[1] + uz * mid) < 0) lo = mid
    else hi = mid
  }
  return [centre[0] + ux * (lo - inset), centre[1] + uz * (lo - inset)]
}

/**
 * Walk from a point along a direction. `rise`: first ground at or above `height` after having
 * dipped below it (the far shore). `fall`: first ground below `height` (the water's edge).
 */
function marchTo(fn: (x: number, z: number) => number, from: Vec2, dir: Vec2, height: number, mode: 'rise' | 'fall', maxDistance = 140): Vec2 {
  const len = Math.hypot(dir[0], dir[1]) || 1
  const ux = dir[0] / len
  const uz = dir[1] / len
  let dipped = false
  for (let t = 0; t < maxDistance; t += 0.5) {
    const h = fn(from[0] + ux * t, from[1] + uz * t)
    if (mode === 'fall' && h < height) return [from[0] + ux * t, from[1] + uz * t]
    if (mode === 'rise') {
      if (h < height - 1) dipped = true
      if (dipped && h >= height) return [from[0] + ux * t, from[1] + uz * t]
    }
  }
  return [from[0] + ux * maxDistance, from[1] + uz * maxDistance]
}

const DAY = {
  meadow: '#9fcf75',
  meadowLight: '#b9dc83',
  slope: '#7fae5f',
  cliff: '#8b8f78',
  stone: '#cfc6ae',
  cobble: '#b7ad99',
  wet: '#6f9c66',
  bed: '#3b6f7a',
  shallows: '#4f93a0',
}
const NIGHT = {
  meadow: '#3f5a46',
  meadowLight: '#4a6950',
  slope: '#35503c',
  cliff: '#4a4e48',
  stone: '#6f6a62',
  cobble: '#55504c',
  wet: '#3a5a46',
  bed: '#1b3540',
  shallows: '#224451',
}
const STONE = '#e3dcc9'
const SLATE = '#475463'
const TIMBER = '#6b4a3a'
const ROAD = '#d8c49a'
const ROAD_NIGHT = '#6a5f50'
const WALLS = ['#e2d6bd', '#d9c9a8', '#cdb48f', '#e6dfcf']
const ROOFS = ['#d9765c', '#c96f45', '#b85c6b', '#475463', '#5a6675']
const FIELDS: readonly (readonly [string, number])[] = [
  ['#e6c45a', 3],
  ['#b9dc83', 3],
  ['#9fcf75', 2],
  ['#cfa86a', 1.5],
  ['#86b865', 1.5],
  ['#ead98a', 1],
]

export function buildLakePlan(seed: number): Plan {
  const rng = mulberry32(seed * 104729 + 29)
  const keepCentre: Vec2 = [-14, -16]
  const cathCentre: Vec2 = [62, 18]
  const marketCentre: Vec2 = [-60, 46]
  const keepOuter = wobblyPolygon(keepCentre, 38, 12, rng, 0.1)
  const baileyPoly = scaled(keepOuter, keepCentre, 0.64, [-3, -4])
  const courtPoly = scaled(keepOuter, keepCentre, 0.34, [-6, -8])
  const keepIsle: Island = {
    id: 'keep',
    centre: keepCentre,
    tiers: [
      { poly: keepOuter, height: 3, shore: 7 },
      { poly: baileyPoly, height: 8.5, shore: 3 },
      { poly: courtPoly, height: 15, shore: 2.5 },
    ],
  }
  const cathOuter = wobblyPolygon(cathCentre, 19, 10, rng, 0.12)
  const cathUpper = scaled(cathOuter, cathCentre, 0.62, [1, -1])
  const cathIsle: Island = {
    id: 'cathedral',
    centre: cathCentre,
    tiers: [
      { poly: cathOuter, height: 2.6, shore: 6 },
      { poly: cathUpper, height: 6.5, shore: 3 },
    ],
  }
  const marketOuter = wobblyPolygon(marketCentre, 25, 11, rng, 0.1)
  const marketIsle: Island = { id: 'market', centre: marketCentre, tiers: [{ poly: marketOuter, height: 2.6, shore: 6 }] }
  const islets: Island[] = [
    { id: 'islet-1', centre: [30, -72], tiers: [{ poly: wobblyPolygon([30, -72], 8, 7, rng, 0.2), height: 2, shore: 5 }] },
    { id: 'islet-2', centre: [-78, -14], tiers: [{ poly: wobblyPolygon([-78, -14], 6, 6, rng, 0.2), height: 1.6, shore: 4 }] },
  ]
  const islands = [keepIsle, cathIsle, marketIsle, ...islets]

  const outflowDistance = (x: number, z: number) => polylineDistance(OUTFLOW, x, z)
  const basin = (x: number, z: number): number => {
    const d = basinD(x, z)
    const wobble = (fbm(x, z, seed + 61, 70, 2) - 0.5) * 0.07
    const shelf = lerp(BED, SHELF, smoothstep(0.56 + wobble, 0.62 + wobble, d))
    const od = outflowDistance(x, z)
    const hills = 30 * Math.pow(smoothstep(0.67, 1.04, d), 1.3) * (0.55 + 0.45 * fbm(x, z, seed, 56, 3)) * smoothstep(8, 44, od)
    let h = shelf + hills + 1.4 * fbm(x + 90, z - 40, seed + 7, 30, 2) * smoothstep(0.62, 0.68, d)
    // north shore: field terraces in 3 m steps
    const terrace = smoothstep(-112, -128, z) * smoothstep(135, 95, Math.abs(x))
    if (terrace > 0 && h > 0) h = lerp(h, Math.floor(h / 2.5) * 2.5 + 0.4, terrace)
    // outflow: a channel cut from the lake to the land edge
    const channel = lerp(BED + 1.2, h, smoothstep(4, 11, od))
    if (d > 0.5) h = Math.min(h, channel)
    return h
  }
  const heightFn = (x: number, z: number): number => {
    let h = basin(x, z)
    for (const island of islands) h = Math.max(h, islandHeight(island, x, z))
    return h
  }
  const hf = new HeightField(LAND_SIZE, LAND_CELLS, heightFn)

  const onIsland = (x: number, z: number) => islands.some((island) => polygonSignedDistance(island.tiers[0].poly, x, z) < 0.5)
  const classify: Classifier = (x, z, y, ny) => {
    if (y < BED + 1.2) return 'bed'
    if (y < LAKE_Y - 0.2) return 'shallows'
    if (y < LAKE_Y + 0.7) return 'wet'
    const built = onIsland(x, z)
    if (ny < 0.6) return built ? 'stone' : 'cliff'
    if (built) return 'cobble'
    if (ny < 0.86) return 'slope'
    return fbm(x - 70, z + 20, seed + 9, 26, 2) > 0.53 ? 'meadowLight' : 'meadow'
  }

  const layers: InstancedLayer[] = []
  const draped: Plan['draped'] = []
  const houses: House[] = []
  const marks: Plan['marks'] = {}
  const roads: Float32Array[] = []
  const lanternItems: Item[] = []
  const postItems: Item[] = []
  const addLanterns = (set: { heads: Item[]; posts: Item[] }) => {
    lanternItems.push(...set.heads)
    postItems.push(...set.posts)
  }

  /* ---------------------------------------------------------------- water: lake sheet + tail race */
  const weirIndex = Math.floor((OUTFLOW.length - 1) * WEIR_T)
  const weir = { p: OUTFLOW[weirIndex], dir: [OUTFLOW[weirIndex + 1][0] - OUTFLOW[weirIndex][0], OUTFLOW[weirIndex + 1][1] - OUTFLOW[weirIndex][1]] as Vec2 }
  const weirRadius = basinD(weir.p[0], weir.p[1]) * R
  const outflowAngle = Math.atan2(weir.p[0] - BASIN[0], (weir.p[1] - BASIN[1]) / ZS)
  const lakeRing: Vec2[] = []
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    let delta = Math.abs(a - outflowAngle)
    delta = Math.min(delta, Math.PI * 2 - delta)
    const bulge = smoothstep(0.26, 0.06, delta)
    const r = lerp(0.665 * R, weirRadius - 1, bulge)
    lakeRing.push([BASIN[0] + Math.sin(a) * r, BASIN[1] + Math.cos(a) * r * ZS])
  }
  draped.push({ id: 'lake', positions: flatFanPositions(BASIN, lakeRing, LAKE_Y), day: '#5faeb6', night: '#274e60' })
  draped.push({ id: 'tail-race', positions: flatRibbonPositions(resample(OUTFLOW.slice(weirIndex), 3), 16, TAIL_Y), day: '#5faeb6', night: '#274e60' })

  /* ---------------------------------------------------------------- where the bridges land (gates go here) */
  const southDir: Vec2 = [0.12, 1]
  const marketSouth = edgePoint(marketOuter, marketCentre, southDir, 1)
  const southShore = marchTo(heightFn, marketSouth, southDir, 2.1, 'rise')
  const toKeep: Vec2 = [keepCentre[0] - marketCentre[0], keepCentre[1] - marketCentre[1]]
  const marketEast = edgePoint(marketOuter, marketCentre, toKeep, 1)
  const keepWest = edgePoint(keepOuter, keepCentre, [-toKeep[0], -toKeep[1]], 1)
  const toCath: Vec2 = [cathCentre[0] - keepCentre[0], cathCentre[1] - keepCentre[1]]
  const keepEast = edgePoint(keepOuter, keepCentre, toCath, 1)
  const cathWest = edgePoint(cathOuter, cathCentre, [-toCath[0], -toCath[1]], 1)
  const eastDir: Vec2 = [1, 0.3]
  const cathEast = edgePoint(cathOuter, cathCentre, eastDir, 1)
  const eastShore = marchTo(heightFn, cathEast, eastDir, 2.1, 'rise')
  const keepNorth = edgePoint(keepOuter, keepCentre, [0.15, -1], 1)
  const northShore = marchTo(heightFn, keepNorth, [0.15, -1], 2.1, 'rise')

  /* ---------------------------------------------------------------- keep isle: walls, bailey, keep */
  const wallBoxes: Item[] = []
  const towerBodies: Item[] = []
  const towerCaps: Item[] = []
  const quayRing = scaled(keepOuter, keepCentre, 0.93)
  const quayWall = wallRing(quayRing, { floorY: () => 3, height: 3.2, thickness: 1.8, towerEvery: 2, towerRadius: 2.4, towerHeight: 6, capHeight: 3, wallColor: DAY.stone, capColor: SLATE, closed: true, sink: 4, openings: openingsNear(quayRing, [keepWest, keepEast, keepNorth], 5.5) })
  const baileyWall = wallRing(scaled(keepOuter, keepCentre, 0.64 * 0.9, [-3, -4]), { floorY: () => 8.5, height: 3.6, thickness: 2, towerEvery: 2, towerRadius: 2.8, towerHeight: 8, capHeight: 3.6, wallColor: DAY.stone, capColor: SLATE, closed: true, sink: 7 })
  wallBoxes.push(...quayWall.walls, ...baileyWall.walls)
  towerBodies.push(...quayWall.towers, ...baileyWall.towers)
  towerCaps.push(...quayWall.caps, ...baileyWall.caps)
  const keepSite: Vec2 = [keepCentre[0] - 6, keepCentre[1] - 8]
  const donjon = keep([keepSite[0], 15 - 0.4, keepSite[1]], 13, 28, 0.3, STONE, SLATE)
  houses.push(hall([keepSite[0] + 16, 8.5 - 0.3, keepSite[1] + 10], 0.3, 19, 9, 8, STONE, SLATE))
  houses.push(hall([keepSite[0] - 11, 8.5 - 0.3, keepSite[1] + 12], -1.2, 11, 6, 6, STONE, '#b85c6b'))
  const chapelTower = roundTower([keepSite[0] - 16, 8.2, keepSite[1] + 12], 2.4, 15, STONE, SLATE, 4)
  marks.keep = [keepSite[0], 15 + 28, keepSite[1]]
  const quayRoad = closedPath(scaled(keepOuter, keepCentre, 0.76), 2.5)
  roads.push(ribbonPositions(hf, quayRoad, 3.4, 0.26))
  addLanterns(lanterns(hf, quayRoad, 12, 2.4, 1.5))
  const quaySize = { w: [4.6, 6.6] as const, d: [3.8, 4.8] as const, h: [3, 4.6] as const }
  houses.push(...streetHouses({ rng, hf, path: quayRoad, spacing: 6.8, setback: 4, sides: [1], size: quaySize, mask: (x, z) => polygonSignedDistance(keepOuter, x, z) < -3.2, walls: WALLS, roofs: ROOFS, gap: 0.1 }))
  houses.push(...streetHouses({ rng, hf, path: quayRoad, spacing: 7.5, setback: 4, sides: [-1], size: quaySize, mask: (x, z) => polygonSignedDistance(baileyPoly, x, z) > 1.5, walls: WALLS, roofs: ROOFS, gap: 0.3 }))

  /* ---------------------------------------------------------------- cathedral isle */
  const cath = cathedral([cathCentre[0] + 1, 6.5 - 0.3, cathCentre[1] - 2], 0.35, 0.88, '#f1ece1', '#4e5a6b')
  const cloister: Item[] = [
    { p: [cathCentre[0] - 7, 6.2, cathCentre[1] + 8], ry: 0.35, s: [12, 4.2, 4.5], color: STONE },
    { p: [cathCentre[0] + 8, 6.2, cathCentre[1] + 9], ry: 0.35, s: [12, 4.2, 4.5], color: STONE },
  ]
  houses.push(
    ...streetHouses({
      rng,
      hf,
      path: closedPath(scaled(cathOuter, cathCentre, 0.72), 2.5),
      spacing: 8.5,
      setback: 2,
      sides: [1],
      size: { w: [4.2, 5.8], d: [3.4, 4.2], h: [2.8, 4] },
      mask: (x, z) => polygonSignedDistance(cathUpper, x, z) > 1.2 && polygonSignedDistance(cathOuter, x, z) < -2,
      walls: WALLS,
      roofs: ROOFS,
      gap: 0.35,
    }),
  )
  marks.cathedralSpire = [cath.cones6[0].p[0], 6.5 + 13 * 0.8 * 1.5 + 14.4, cath.cones6[0].p[2]]

  /* ---------------------------------------------------------------- market isle */
  const square: Vec2 = [marketCentre[0] + 2, marketCentre[1] - 1]
  draped.push({ id: 'plaza', positions: drapedQuadPositions(hf, [{ centre: square, half: [12, 9], yaw: 0.2 }], 0.26, 4), day: '#d9d2c4', night: '#5e5a56' })
  const market = stalls(rng, hf, square, 0.2, 4, 3, 4.2, ['#c96f45', '#e6c45a', '#b85c6b', '#e8a13a'])
  houses.push(hall([square[0] - 15, 2.3, square[1] - 3], Math.PI / 2 + 0.2, 13, 8, 7.5, '#d9c9a8', '#c96f45'))
  const belfry = roundTower([square[0] - 14, 2.2, square[1] + 9], 2.6, 15, STONE, '#b85c6b', 5)
  const marketRing = closedPath(scaled(marketOuter, marketCentre, 0.78), 2.5)
  roads.push(ribbonPositions(hf, marketRing, 3.2, 0.26))
  addLanterns(lanterns(hf, marketRing, 12, 2.4, 1.5))
  houses.push(...streetHouses({ rng, hf, path: marketRing, spacing: 7.2, setback: 4.2, sides: [-1], size: { w: [4.8, 7], d: [4, 5], h: [3, 4.8] }, mask: (x, z) => Math.hypot(x - square[0], z - square[1]) > 14, walls: WALLS, roofs: ROOFS, gap: 0.18 }))
  const marketRingWall = scaled(marketOuter, marketCentre, 0.95)
  const marketWall = wallRing(marketRingWall, { floorY: () => 2.6, height: 2.4, thickness: 1.4, towerEvery: 3, towerRadius: 2, towerHeight: 4.5, capHeight: 2.4, wallColor: DAY.stone, capColor: SLATE, closed: true, sink: 3.5, openings: openingsNear(marketRingWall, [marketEast, marketSouth], 5) })
  wallBoxes.push(...marketWall.walls)
  towerBodies.push(...marketWall.towers)
  towerCaps.push(...marketWall.caps)
  marks.market = [square[0], 2.6, square[1]]

  /* ---------------------------------------------------------------- causeways, bridges, drawbridge */
  const bridges = { decks: [] as Item[], arches: [] as Item[], piers: [] as Item[], parapets: [] as Item[] }
  const link = (a: Vec2, b: Vec2, width: number, span: number, deckY = 2.4) => {
    const parts = archBridge({ a, b, deckY, waterY: LAKE_Y, width, span, stone: '#c8bda4', deckColor: ROAD })
    bridges.decks.push(...parts.decks)
    bridges.arches.push(...parts.arches)
    bridges.piers.push(...parts.piers)
    bridges.parapets.push(...parts.parapets)
    addLanterns(lanterns({ heightAt: () => deckY }, resample([a, b], 2), 10, 2.2, width / 2 - 0.8))
  }
  // south shore -> market isle: the long causeway (the walk pose)
  link(marketSouth, southShore, 6, 10)
  const southRoad = resample(smoothPolyline([southShore, [southShore[0] + 4, southShore[1] + 18], [southShore[0] + 2, southShore[1] + 46], [southShore[0] - 12, 169]]), 3)
  roads.push(ribbonPositions(hf, southRoad, 4, 0.28))
  marks.causeway = [(marketSouth[0] + southShore[0]) / 2, 2.4, (marketSouth[1] + southShore[1]) / 2]
  // market isle -> keep isle: drawbridge under twin towers
  link(marketEast, keepWest, 5, 8, 2.6)
  {
    const len = Math.hypot(toKeep[0], toKeep[1])
    const ux = toKeep[0] / len
    const uz = toKeep[1] / len
    for (const side of [-1, 1]) {
      const tower = roundTower([keepWest[0] - uz * side * 4.2 + ux * 2.5, 2, keepWest[1] + ux * side * 4.2 + uz * 2.5], 2.6, 12, DAY.stone, SLATE, 3.4)
      towerBodies.push(tower.body)
      towerCaps.push(tower.cap)
    }
  }
  marks.drawbridge = [(marketEast[0] + keepWest[0]) / 2, 2.6, (marketEast[1] + keepWest[1]) / 2]
  marks.marketEast = [marketEast[0], 2.6, marketEast[1]]
  marks.keepWest = [keepWest[0], 3, keepWest[1]]
  // keep isle -> cathedral isle: the long arched bridge
  link(keepEast, cathWest, 5, 9)
  // cathedral isle -> east shore
  link(cathEast, eastShore, 5, 10)
  const eastRoad = resample(smoothPolyline([eastShore, [eastShore[0] + 18, eastShore[1] + 4], [150, 22], [169, 12]]), 3)
  roads.push(ribbonPositions(hf, eastRoad, 4, 0.28))
  // keep isle north water gate and a ferry landing on the north shore
  const landing: Item[] = [
    { p: [northShore[0], SHELF - 0.6, northShore[1] + 6], ry: yawFromDir(0.15, -1), s: [12, 1, 3], color: TIMBER },
    { p: [keepNorth[0], 1.4, keepNorth[1] - 3], ry: yawFromDir(0.15, -1), s: [8, 1, 3], color: TIMBER },
  ]

  /* ---------------------------------------------------------------- weir and mills (River Village) */
  const weirLen = Math.hypot(weir.dir[0], weir.dir[1]) || 1
  const flow: Vec2 = [weir.dir[0] / weirLen, weir.dir[1] / weirLen]
  const across: Vec2 = [-flow[1], flow[0]]
  const weirYaw = yawFromDir(across[0], across[1])
  const weirBox: Item = { p: [weir.p[0], BED, weir.p[1]], ry: weirYaw, s: [28, LAKE_Y - BED + 0.8, 4], color: '#c8bda4' }
  const millA: Vec2 = [weir.p[0] + across[0] * 12 + flow[0] * 2, weir.p[1] + across[1] * 12 + flow[1] * 2]
  const millB: Vec2 = [weir.p[0] - across[0] * 12 + flow[0] * 2, weir.p[1] - across[1] * 12 + flow[1] * 2]
  houses.push(hall([millA[0], hf.heightAt(...millA) - 0.4, millA[1]], weirYaw, 10, 7, 6, TIMBER, '#8c5a4a'))
  houses.push(hall([millB[0], hf.heightAt(...millB) - 0.4, millB[1]], weirYaw, 9, 6.5, 5.5, TIMBER, '#6b4a3a'))
  const wheelAt: Vec2 = [weir.p[0] + across[0] * 6 + flow[0] * 4, weir.p[1] + across[1] * 6 + flow[1] * 4]
  const movers: Mover[] = [{ kind: 'wheel', p: [wheelAt[0], TAIL_Y + 1.2, wheelAt[1]], radius: 3.6, yaw: weirYaw, color: '#5a4030' }]
  const millLane = resample(smoothPolyline([millA, [millA[0] + 12, millA[1] + 16], [millA[0] + 20, millA[1] + 40], [millA[0] + 26, millA[1] + 70]]), 3)
  roads.push(ribbonPositions(hf, millLane, 3.4, 0.26))
  houses.push(...streetHouses({ rng, hf, path: millLane, spacing: 9, setback: 5, gap: 0.3, size: { w: [5, 7], d: [4, 5], h: [2.8, 4] }, mask: (x, z) => hf.heightAt(x, z) > 0.8 && outflowDistance(x, z) > 11, walls: [TIMBER, '#8a6a4a', '#b99a7a'], roofs: ['#8c5a4a', '#6b4a3a', '#a86a58'], sink: 0.8 }))
  marks.mill = [millA[0], 0, millA[1]]

  /* ---------------------------------------------------------------- lake life: boats */
  const boats: Item[] = []
  for (let i = 0; i < 16; i++) {
    const a = range(rng, 0, Math.PI * 2)
    const r = range(rng, 0.15, 0.58) * R
    const x = BASIN[0] + Math.sin(a) * r
    const z = BASIN[1] + Math.cos(a) * r * ZS
    if (hf.heightAt(x, z) > LAKE_Y - 1.5) continue
    boats.push({ p: [x, LAKE_Y - 0.2, z], ry: range(rng, 0, Math.PI), s: [4.2, 1.1, 1.7], color: i % 3 === 0 ? '#d9765c' : '#8a6a4a' })
  }

  /* ---------------------------------------------------------------- shore road around the lake */
  const shorePoints: Vec2[] = []
  const aStart = Math.atan2(southShore[0] - BASIN[0], (southShore[1] - BASIN[1]) / ZS)
  const aEnd = Math.atan2(eastShore[0] - BASIN[0], (eastShore[1] - BASIN[1]) / ZS) - Math.PI * 2
  for (let a = aStart; a > aEnd; a -= 0.1) {
    const r = 0.68 * R + 4 * fbm(a * 30, 0, seed + 41, 3, 1)
    shorePoints.push([BASIN[0] + Math.sin(a) * r, BASIN[1] + Math.cos(a) * r * ZS])
  }
  const shoreRoad = resample(smoothPolyline([southShore, ...shorePoints, eastShore], 3), 3)
  roads.push(ribbonPositions(hf, shoreRoad, 3.8, 0.28))
  const lanes = [shoreRoad, millLane, quayRoad, marketRing, southRoad, eastRoad]
  const roadDistance = (x: number, z: number) => {
    let best = Number.POSITIVE_INFINITY
    for (const lane of lanes) best = Math.min(best, polylineDistance(lane, x, z))
    return best
  }

  /* ---------------------------------------------------------------- north shore: terraced fields, windmill (Farm Common) */
  const farmMask = (x: number, z: number) => {
    const y = hf.heightAt(x, z)
    if (y < 0.9 || y > 22) return false
    // terraced fields are allowed to kink over a riser; only real hillsides are excluded
    if (hf.slopeAt(x, z) > 0.5) return false
    if (onIsland(x, z) || outflowDistance(x, z) < 14) return false
    if (Math.abs(x) > 166 || Math.abs(z) > 166) return false
    const north = z < -110 && Math.abs(x) < 132
    const east = x > 110 && z > -50 && z < 70
    const south = z > 108 && x < -20 && x > -120
    return north || east || south
  }
  const farm = patchwork({ rng, yaw: -0.18, cell: [17, 22], extent: 175, mask: farmMask, palette: FIELDS, skipChance: 0.14, orchardChance: 0.1, hedgeChance: 0.6, avoid: (x, z) => roadDistance(x, z) < 3.6, hf })
  for (const [color, quads] of farm.fields) draped.push({ id: `field-${color}`, positions: drapedQuadPositions(hf, quads, 0.22, 5), day: color, night: nightTone(color) })
  const millHill: Vec2 = [22, -140]
  const windmillBase = hf.heightAt(...millHill)
  const windmill = roundTower([millHill[0], windmillBase - 0.3, millHill[1]], 3.2, 10, '#d9c9a8', '#8c5a4a', 4)
  houses.push(hall([millHill[0] - 18, hf.heightAt(millHill[0] - 18, millHill[1] + 6) - 0.4, millHill[1] + 6], 0.2, 14, 7, 5, TIMBER, '#8c5a4a'))
  houses.push(...streetHouses({ rng, hf, path: shoreRoad.slice(Math.floor(shoreRoad.length * 0.42), Math.floor(shoreRoad.length * 0.68)), spacing: 18, setback: 7, gap: 0.5, mask: (x, z) => hf.heightAt(x, z) > 1.2 && !onIsland(x, z), size: { w: [5, 7.5], d: [4, 5.4], h: [3, 4.6] }, walls: WALLS, roofs: ['#8c5a4a', '#c96f45', '#d9765c'] }))
  marks.windmill = [millHill[0], windmillBase + 10, millHill[1]]

  /* ---------------------------------------------------------------- west shore: forest hamlet and landing */
  const westEdge = marchTo(heightFn, [-60, 10], [-1, 0.05], LAKE_Y + 1.2, 'rise')
  const hamletPath = resample(smoothPolyline([[westEdge[0] - 4, westEdge[1]], [westEdge[0] - 16, westEdge[1] + 14], [westEdge[0] - 30, westEdge[1] + 26], [westEdge[0] - 44, westEdge[1] + 44]]), 2.5)
  roads.push(ribbonPositions(hf, hamletPath, 3.2, 0.28))
  houses.push(...streetHouses({ rng, hf, path: hamletPath, spacing: 10, setback: 5.5, gap: 0.3, size: { w: [5, 7], d: [4, 5], h: [2.8, 4] }, mask: (x, z) => hf.heightAt(x, z) > 1, walls: [TIMBER, '#8a6a4a', '#b99a7a'], roofs: ['#8c5a4a', '#6b4a3a', '#a86a58'], sink: 0.9 }))
  landing.push({ p: [westEdge[0] + 3, SHELF - 0.8, westEdge[1]], ry: 0, s: [12, 1, 3], color: TIMBER })
  marks.hamlet = [westEdge[0] - 20, hf.heightAt(westEdge[0] - 20, westEdge[1] + 18), westEdge[1] + 18]

  /* ---------------------------------------------------------------- trees */
  const landMask = (x: number, z: number) => hf.heightAt(x, z) > 1.2 && roadDistance(x, z) > 4 && !onIsland(x, z) && outflowDistance(x, z) > 9
  const forest: Tree[] = scatterTrees({
    rng,
    count: 240,
    box: [-168, -168, -80, 168],
    spacing: 5,
    hf,
    kind: (x, z) => (hf.heightAt(x, z) > 14 ? 'cone' : 'round'),
    colors: ['#4f7d4a', '#5f9a55', '#3f6b40', '#6d9c58'],
    mask: (x, z) => landMask(x, z) && fbm(x, z, seed + 21, 40, 2) > 0.36,
  })
  const copses: Tree[] = scatterTrees({
    rng,
    count: 160,
    box: [-80, -168, 168, 168],
    spacing: 6,
    hf,
    kind: (x, z) => (hf.heightAt(x, z) > 16 ? 'cone' : 'round'),
    colors: ['#4f7d4a', '#5f9a55', '#6d9c58'],
    mask: (x, z) => landMask(x, z) && !farmMask(x, z) && fbm(x, z, seed + 23, 34, 2) > 0.52,
  })
  const isleTrees: Tree[] = scatterTrees({
    rng,
    count: 16,
    box: [-100, -70, 100, 80],
    spacing: 6,
    hf,
    kind: 'round',
    colors: ['#5f9a55', '#6d9c58'],
    radius: [1.6, 2.4],
    mask: (x, z) => onIsland(x, z) && polygonSignedDistance(baileyPoly, x, z) < -3 && polygonSignedDistance(courtPoly, x, z) > 3,
  })

  /* ---------------------------------------------------------------- carts */
  const cartSet = carts(rng, hf, [[southShore[0] + 4, southShore[1] + 12], [eastShore[0] + 10, eastShore[1] + 2]], () => yawFromDir(0, 1))

  /* ---------------------------------------------------------------- layers */
  layers.push(
    { id: 'walls', geometry: 'box', items: [...wallBoxes, weirBox, ...landing, ...cloister, ...bridges.decks, ...bridges.piers, ...bridges.parapets, ...cartSet.beds, ...cartSet.wheels, ...market.posts, ...donjon.boxes, ...cath.boxes], color: DAY.stone },
    { id: 'towers', geometry: 'cyl8', items: [...towerBodies, ...donjon.cyls, chapelTower.body, belfry.body, windmill.body, ...cath.cyls], color: DAY.stone },
    { id: 'caps', geometry: 'cone6', items: [...towerCaps, ...donjon.cones, chapelTower.cap, belfry.cap, windmill.cap, ...cath.cones6], color: SLATE },
    { id: 'roofs', geometry: 'prism', items: [...cath.prisms, ...market.canopies], color: SLATE },
    { id: 'spires', geometry: 'cone4', items: cath.cones4, color: SLATE },
    { id: 'arches', geometry: 'arch', items: bridges.arches, color: '#c8bda4' },
    { id: 'boats', geometry: 'box', items: boats, color: '#8a6a4a' },
    { id: 'hedges', geometry: 'box', items: farm.hedges, color: '#4f7d4a' },
    ...houseLayers('houses', houses),
    ...treeLayers('forest', [...forest, ...copses, ...isleTrees, ...farm.orchards], '#5a4030'),
    { id: 'lantern-posts', geometry: 'box', items: postItems, color: '#4a3a30', castShadow: false },
    { id: 'lanterns', geometry: 'box', items: lanternItems, color: '#ffd27a', glow: true, castShadow: false },
    { id: 'windows', geometry: 'plane', items: [...cath.windows, ...donjon.windows], color: '#ffe9a8', glow: true, castShadow: false },
  )
  draped.unshift({ id: 'roads', positions: concat(roads), day: ROAD, night: ROAD_NIGHT })

  return {
    label: 'medieval-b-lake',
    ground: { hf, classify, day: DAY, night: NIGHT },
    water: null,
    draped,
    layers,
    movers,
    budget: budgetFor(hf, draped, layers, moverTriangles(movers)),
    marks,
  }
}
