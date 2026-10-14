import { concat } from './citadel'
import { HeightField, drapedQuadPositions, ribbonPositions } from './heightfield'
import { archBridge, carts, cathedral, hall, keep, lanterns, openingsNear, patchwork, roundTower, scatterTrees, stalls, streetHouses, wallRing, wobblyPolygon, yawFromDir } from './kit'
import { budgetFor, LAND_CELLS, LAND_SIZE, moverTriangles, type Classifier, type Mover, type Plan } from './plan'
import { houseLayers, treeLayers, type House, type InstancedLayer, type Item, type Tree } from './plan-types'
import { alongPolyline, fbm, lerp, mulberry32, nightTone, pointInPolygon, polygonSignedDistance, polylineDistance, range, resample, smoothPolyline, smoothstep, type Vec2 } from './rng'

/**
 * Direction C — Market Kingdom. A walled market city on a low rise in a vast patchwork of fields
 * and orchards; the river bends past it under a bridge to a mill village; an abbey sits on a knoll
 * to the west; a tournament field with striped pavilions lies outside the south gate; and three
 * castles answer the city from the surrounding hills, the Crown Castle on the tallest.
 */

const WATER_Y = -1.2
const CITY: Vec2 = [10, 8]
const CITY_R = 48
const RIVER: Vec2[] = smoothPolyline([
  [-172, -34],
  [-128, -10],
  [-90, 22],
  [-60, 48],
  [-32, 78],
  [-4, 108],
  [26, 134],
  [60, 158],
  [96, 172],
])

interface Hill {
  centre: Vec2
  radius: number
  height: number
  /** Plateau height for the castle court (height is clamped here). */
  top: number
}

const HILLS: Record<'crown' | 'west' | 'east' | 'abbey' | 'mill', Hill> = {
  crown: { centre: [108, -118], radius: 70, height: 48, top: 36 },
  west: { centre: [-124, -98], radius: 60, height: 38, top: 28 },
  east: { centre: [140, 44], radius: 50, height: 30, top: 21 },
  abbey: { centre: [-86, 66], radius: 30, height: 10, top: 7.5 },
  mill: { centre: [78, 70], radius: 22, height: 5, top: 4.5 },
}

function dome(hill: Hill, x: number, z: number): number {
  const d = Math.hypot(x - hill.centre[0], z - hill.centre[1]) / hill.radius
  if (d >= 1) return 0
  const h = hill.height * Math.pow(1 - d * d, 1.15)
  return Math.min(h, hill.top)
}

function marketHeight(x: number, z: number, seed: number): number {
  const plain = 3.2 * fbm(x, z, seed, 95, 2) + 0.4
  const rise = Math.min(7, 9.5 * Math.max(0, 1 - Math.pow(Math.hypot(x - CITY[0], z - CITY[1]) / 92, 2)))
  const rim = 12 * smoothstep(0.78, 1.08, Math.max(Math.abs(x), Math.abs(z)) / 170) * (0.6 + 0.4 * fbm(x + 400, z, seed + 3, 48, 2))
  let h = Math.max(plain, plain * 0.4 + rise, rim)
  for (const hill of Object.values(HILLS)) h = Math.max(h, dome(hill, x, z) + plain * 0.3)
  const riverD = polylineDistance(RIVER, x, z)
  const bed = -2.6 + 1.2 * fbm(x, z, seed + 5, 40, 2)
  const channel = lerp(bed, h, smoothstep(0, 9, riverD))
  const banks = h - 1.2 * (1 - smoothstep(7, 20, riverD))
  return Math.min(h, channel, banks)
}

const DAY = {
  meadow: '#9fcf75',
  meadowLight: '#b9dc83',
  slope: '#7fae5f',
  cliff: '#8b8f78',
  cobble: '#b7ad99',
  court: '#cfc6ae',
  wet: '#6f9c66',
  bed: '#3f7f86',
}
const NIGHT = {
  meadow: '#3f5a46',
  meadowLight: '#4a6950',
  slope: '#35503c',
  cliff: '#4a4e48',
  cobble: '#55504c',
  court: '#6a655d',
  wet: '#3a5a46',
  bed: '#1e3a44',
}
const STONE = '#d8cfb6'
const PALE = '#e9e2d1'
const SLATE = '#475463'
const TIMBER = '#6b4a3a'
const ROAD = '#d8c49a'
const ROAD_NIGHT = '#6a5f50'
const WALLS = ['#e2d6bd', '#d9c9a8', '#cdb48f', '#e6dfcf', '#b99a7a']
const ROOFS = ['#d9765c', '#c96f45', '#b85c6b', '#8c5a4a', '#475463']
const FIELDS: readonly (readonly [string, number])[] = [
  ['#e6c45a', 3],
  ['#b9dc83', 3],
  ['#9fcf75', 2.5],
  ['#cfa86a', 1.5],
  ['#86b865', 1.5],
  ['#ead98a', 1.2],
  ['#c9b36a', 1],
]

export function buildMarketPlan(seed: number): Plan {
  const rng = mulberry32(seed * 15485863 + 41)
  const hf = new HeightField(LAND_SIZE, LAND_CELLS, (x, z) => marketHeight(x, z, seed))
  const riverDistance = (x: number, z: number) => polylineDistance(RIVER, x, z)
  const cityWall = wobblyPolygon(CITY, CITY_R, 12, rng, 0.09)
  const inCity = (x: number, z: number) => pointInPolygon(cityWall, x, z)
  const castleCourts = {
    crown: wobblyPolygon(HILLS.crown.centre, 24, 9, rng, 0.1),
    west: wobblyPolygon(HILLS.west.centre, 16, 8, rng, 0.12),
    east: wobblyPolygon(HILLS.east.centre, 12, 7, rng, 0.12),
  }
  const inCourt = (x: number, z: number) => Object.values(castleCourts).some((poly) => pointInPolygon(poly, x, z))
  const classify: Classifier = (x, z, y, ny) => {
    if (y < WATER_Y + 0.3) return 'bed'
    if (y < 1 && riverDistance(x, z) < 16) return 'wet'
    if (ny < 0.6) return 'cliff'
    if (inCity(x, z)) return 'cobble'
    if (inCourt(x, z)) return 'court'
    if (ny < 0.86) return 'slope'
    return fbm(x + 40, z - 70, seed + 9, 26, 2) > 0.53 ? 'meadowLight' : 'meadow'
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
  const wallBoxes: Item[] = []
  const towerBodies: Item[] = []
  const towerCaps: Item[] = []
  const boxes: Item[] = []
  const banners: Item[] = []

  /* ---------------------------------------------------------------- the city: gates, wall, square, cathedral, streets */
  const gateDirs: Record<'south' | 'north' | 'east' | 'west', Vec2> = { south: [0.08, 1], north: [0.3, -1], east: [1, 0.15], west: [-1, 0.25] }
  const gates = {} as Record<keyof typeof gateDirs, Vec2>
  for (const [name, dir] of Object.entries(gateDirs) as [keyof typeof gateDirs, Vec2][]) {
    const len = Math.hypot(dir[0], dir[1])
    let lo = 0
    let hi = 80
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2
      if (pointInPolygon(cityWall, CITY[0] + (dir[0] / len) * mid, CITY[1] + (dir[1] / len) * mid)) lo = mid
      else hi = mid
    }
    gates[name] = [CITY[0] + (dir[0] / len) * lo, CITY[1] + (dir[1] / len) * lo]
  }
  const wallPath = resample([...cityWall, cityWall[0]], 9)
  const cityRing = wallRing(wallPath, {
    floorY: (x, z) => hf.heightAt(x, z),
    height: 7.5,
    thickness: 2.4,
    towerEvery: 4,
    towerRadius: 3,
    towerHeight: 11.5,
    capHeight: 4,
    wallColor: STONE,
    capColor: SLATE,
    closed: false,
    sink: 2,
    openings: openingsNear(wallPath, Object.values(gates), 5.5, false),
  })
  wallBoxes.push(...cityRing.walls)
  towerBodies.push(...cityRing.towers)
  towerCaps.push(...cityRing.caps)
  for (const [name, gate] of Object.entries(gates) as [keyof typeof gateDirs, Vec2][]) {
    const dir = gateDirs[name]
    const len = Math.hypot(dir[0], dir[1])
    const nx = -dir[1] / len
    const nz = dir[0] / len
    const y = hf.heightAt(gate[0], gate[1])
    for (const side of [-1, 1]) {
      const tower = roundTower([gate[0] + nx * side * 5, y - 1.5, gate[1] + nz * side * 5], 3.4, 15.5, STONE, SLATE, 4.5)
      towerBodies.push(tower.body)
      towerCaps.push(tower.cap)
      banners.push({ p: [gate[0] + nx * side * 5, y + 15.5, gate[1] + nz * side * 5], ry: yawFromDir(nx, nz), s: [1.4, 3.4, 0.2], color: side > 0 ? '#b85c6b' : '#e6c45a' })
    }
    boxes.push({ p: [gate[0], y + 6, gate[1]], ry: yawFromDir(nx, nz), s: [9.5, 4.5, 4.5], color: STONE })
    marks[`${name}Gate`] = [gate[0], y, gate[1]]
  }
  // the market square and the guild hall
  const square: Vec2 = [CITY[0] - 4, CITY[1] + 10]
  const squareY = hf.heightAt(...square)
  draped.push({ id: 'plaza', positions: drapedQuadPositions(hf, [{ centre: square, half: [17, 12], yaw: 0.08 }], 0.26, 4), day: '#d9d2c4', night: '#5e5a56' })
  const market = stalls(rng, hf, [square[0] + 3, square[1] + 1], 0.08, 5, 3, 4.4, ['#c96f45', '#e6c45a', '#b85c6b', '#e8a13a', '#5a6675'])
  houses.push(hall([square[0] - 20, squareY - 0.4, square[1] - 2], Math.PI / 2 + 0.08, 16, 9, 9, '#d9c9a8', '#c96f45'))
  const belfry = roundTower([square[0] - 20, squareY - 0.5, square[1] + 9], 3, 22, PALE, '#b85c6b', 6)
  boxes.push({ p: [square[0] + 2, squareY, square[1] - 8], s: [1.6, 5, 1.6], color: PALE })
  marks.market = [square[0], squareY, square[1]]
  // cathedral east of the square
  const cathSite: Vec2 = [CITY[0] + 16, CITY[1] - 10]
  const cath = cathedral([cathSite[0], hf.heightAt(...cathSite) - 0.4, cathSite[1]], 0.2, 1, '#f1ece1', '#4e5a6b')
  marks.cathedralSpire = [cath.cones6[0].p[0], hf.heightAt(...cathSite) + 13 * 1.5 + 18, cath.cones6[0].p[2]]
  // streets: four radials from the gates to the square, one ring street, houses on all of them
  const streets: Vec2[][] = []
  const radial = (gate: Vec2, inward: Vec2, straight: boolean) => {
    const start: Vec2 = [gate[0] + inward[0] * 2, gate[1] + inward[1] * 2]
    const bend = straight ? 0 : 4
    const points = smoothPolyline([start, [lerp(start[0], square[0], 0.5) + range(rng, -bend, bend), lerp(start[1], square[1], 0.5) + range(rng, -bend, bend)], square])
    return resample(points, 2.4)
  }
  for (const [name, gate] of Object.entries(gates) as [keyof typeof gateDirs, Vec2][]) {
    const dir = gateDirs[name]
    const len = Math.hypot(dir[0], dir[1])
    streets.push(radial(gate, [-dir[0] / len, -dir[1] / len], name === 'south'))
  }
  marks.mainStreet = [lerp(gates.south[0], square[0], 0.25), hf.heightAt(lerp(gates.south[0], square[0], 0.25), lerp(gates.south[1], square[1], 0.25)), lerp(gates.south[1], square[1], 0.25)]
  const ringStreet = resample([...wobblyPolygon(CITY, CITY_R * 0.62, 14, rng, 0.06), wobblyPolygon(CITY, CITY_R * 0.62, 14, rng, 0.06)[0]], 2.4)
  streets.push(ringStreet)
  const streetDistance = (x: number, z: number) => {
    let best = Number.POSITIVE_INFINITY
    for (const street of streets) best = Math.min(best, polylineDistance(street, x, z))
    return best
  }
  const innerMask = (x: number, z: number) => {
    if (polygonSignedDistance(cityWall, x, z) > -4.5) return false
    // a house must not stand in a crossing street
    if (streetDistance(x, z) < 4.3) return false
    if (Math.abs(x - square[0]) < 19 && Math.abs(z - square[1]) < 14) return false
    if (Math.hypot(x - cathSite[0], z - cathSite[1]) < 17) return false
    return true
  }
  const citySize = { w: [4.6, 6.8] as const, d: [4, 5.2] as const, h: [3.4, 5.6] as const }
  for (const street of streets) {
    roads.push(ribbonPositions(hf, street, 3.6, 0.28))
    addLanterns(lanterns(hf, street, 12, 2.6, 1.9))
    houses.push(...streetHouses({ rng, hf, path: street, spacing: 6.6, setback: 4.9, mask: innerMask, size: citySize, walls: WALLS, roofs: ROOFS, gap: 0.08, jitter: 0.1 }))
  }
  // second row behind the ring street, facing the wall walk
  houses.push(...streetHouses({ rng, hf, path: ringStreet, spacing: 7.5, setback: 11, sides: [1], mask: innerMask, size: citySize, walls: WALLS, roofs: ROOFS, gap: 0.2, jitter: 0.2 }))

  /* ---------------------------------------------------------------- roads out of the gates */
  const bridgeAt = (t: number) => {
    const { point, tangent } = alongPolyline(RIVER, t)
    const nx = -tangent[1]
    const nz = tangent[0]
    return { a: [point[0] - nx * 13, point[1] - nz * 13] as Vec2, b: [point[0] + nx * 13, point[1] + nz * 13] as Vec2, point }
  }
  const westBridge = bridgeAt(0.42)
  const southBridge = bridgeAt(0.6)
  const bridges = { decks: [] as Item[], arches: [] as Item[], piers: [] as Item[], parapets: [] as Item[] }
  for (const bridge of [westBridge, southBridge]) {
    const deckY = Math.max(hf.heightAt(...bridge.a), hf.heightAt(...bridge.b)) + 0.6
    const parts = archBridge({ a: bridge.a, b: bridge.b, deckY, waterY: WATER_Y, width: 5.5, span: 7, stone: '#c8bda4', deckColor: ROAD })
    bridges.decks.push(...parts.decks)
    bridges.arches.push(...parts.arches)
    bridges.piers.push(...parts.piers)
    bridges.parapets.push(...parts.parapets)
  }
  const nearSide = (bridge: ReturnType<typeof bridgeAt>, toward: Vec2) => (Math.hypot(bridge.a[0] - toward[0], bridge.a[1] - toward[1]) < Math.hypot(bridge.b[0] - toward[0], bridge.b[1] - toward[1]) ? [bridge.a, bridge.b] : [bridge.b, bridge.a])
  const [westNear, westFar] = nearSide(westBridge, gates.west)
  const [southNear, southFar] = nearSide(southBridge, gates.south)
  const crownRoad = resample(smoothPolyline([gates.north, [40, -40], [70, -78], [HILLS.crown.centre[0] - 14, HILLS.crown.centre[1] + 24], HILLS.crown.centre]), 3)
  const westRoad = resample(smoothPolyline([gates.west, [-30, 18], westNear]), 3)
  const abbeyRoad = resample(smoothPolyline([westFar, [-74, 50], [HILLS.abbey.centre[0] + 6, HILLS.abbey.centre[1] - 6]]), 3)
  const westmarkRoad = resample(smoothPolyline([westFar, [-96, 10], [-116, -40], [HILLS.west.centre[0] + 4, HILLS.west.centre[1] + 20], HILLS.west.centre]), 3)
  const southRoad = resample(smoothPolyline([gates.south, [16, 60], [20, 90], southNear]), 3)
  const farSouth = resample(smoothPolyline([southFar, [40, 150], [50, 169]]), 3)
  const eastRoad = resample(smoothPolyline([gates.east, [86, 28], [HILLS.east.centre[0] - 12, HILLS.east.centre[1] + 6], HILLS.east.centre]), 3)
  const millRoad = resample(smoothPolyline([[86, 28], [HILLS.mill.centre[0] - 4, HILLS.mill.centre[1] - 8], [120, 120], [150, 169]]), 3)
  const northWest = resample(smoothPolyline([[40, -40], [0, -80], [-40, -120], [-70, -169]]), 3)
  const farEast = resample(smoothPolyline([[86, 28], [130, 10], [169, -8]]), 3)
  const outer = [crownRoad, westRoad, abbeyRoad, westmarkRoad, southRoad, farSouth, eastRoad, millRoad, northWest, farEast]
  for (const road of outer) roads.push(ribbonPositions(hf, road, 4, 0.28))
  const lanes = [...outer, ...streets]
  const roadDistance = (x: number, z: number) => {
    let best = Number.POSITIVE_INFINITY
    for (const lane of lanes) best = Math.min(best, polylineDistance(lane, x, z))
    return best
  }

  /* ---------------------------------------------------------------- three castles */
  const castle = (court: Vec2[], hill: Hill, keepW: number, keepH: number, towerH: number, label: string) => {
    const floor = hill.top
    const ring = resample([...court, court[0]], 8)
    const wall = wallRing(ring, { floorY: () => floor, height: 6, thickness: 2.2, towerEvery: 3, towerRadius: 2.8, towerHeight: towerH, capHeight: 4, wallColor: STONE, capColor: SLATE, closed: false, sink: 6 })
    wallBoxes.push(...wall.walls)
    towerBodies.push(...wall.towers)
    towerCaps.push(...wall.caps)
    const donjon = keep([hill.centre[0] + 2, floor - 0.3, hill.centre[1] - 3], keepW, keepH, 0.25, PALE, SLATE)
    boxes.push(...donjon.boxes)
    towerBodies.push(...donjon.cyls)
    towerCaps.push(...donjon.cones)
    houses.push(hall([hill.centre[0] - keepW * 0.9, floor - 0.3, hill.centre[1] + keepW * 0.6], 0.4, keepW * 1.1, keepW * 0.55, keepW * 0.5, STONE, SLATE))
    banners.push({ p: [hill.centre[0] + 2, floor + keepH + 3, hill.centre[1] - 3], ry: 0.25, s: [1.6, 3.6, 0.2], color: '#b85c6b' })
    marks[label] = [hill.centre[0], floor + keepH, hill.centre[1]]
    return donjon.windows
  }
  const castleWindows = [
    ...castle(castleCourts.crown, HILLS.crown, 14, 22, 12, 'crownCastle'),
    ...castle(castleCourts.west, HILLS.west, 10, 15, 9, 'westmark'),
    ...castle(castleCourts.east, HILLS.east, 8, 13, 8, 'eastmark'),
  ]

  /* ---------------------------------------------------------------- abbey on its knoll */
  const abbeyY = HILLS.abbey.top
  const abbey = cathedral([HILLS.abbey.centre[0], abbeyY - 0.4, HILLS.abbey.centre[1] - 2], -0.3, 0.6, PALE, '#5a6675')
  boxes.push({ p: [HILLS.abbey.centre[0] - 4, abbeyY - 0.4, HILLS.abbey.centre[1] + 9], ry: -0.3, s: [18, 4.2, 5], color: PALE })
  boxes.push({ p: [HILLS.abbey.centre[0] + 9, abbeyY - 0.4, HILLS.abbey.centre[1] + 6], ry: -0.3 + Math.PI / 2, s: [12, 4.2, 5], color: PALE })
  marks.abbey = [HILLS.abbey.centre[0], abbeyY + 20, HILLS.abbey.centre[1]]

  /* ---------------------------------------------------------------- mill village on the river bend */
  const millSpot = alongPolyline(RIVER, 0.5)
  const millSide: Vec2 = [millSpot.point[0] + millSpot.tangent[1] * 12, millSpot.point[1] - millSpot.tangent[0] * 12]
  const millYaw = yawFromDir(millSpot.tangent[0], millSpot.tangent[1])
  houses.push(hall([millSide[0], hf.heightAt(...millSide) - 0.4, millSide[1]], millYaw, 10, 7, 6, TIMBER, '#8c5a4a'))
  const wheelAt: Vec2 = [millSpot.point[0] + millSpot.tangent[1] * 7.2, millSpot.point[1] - millSpot.tangent[0] * 7.2]
  const movers: Mover[] = [{ kind: 'wheel', p: [wheelAt[0], WATER_Y + 1.2, wheelAt[1]], radius: 3.4, yaw: millYaw, color: '#5a4030' }]
  const millLane = resample(smoothPolyline([millSide, [millSide[0] + 14, millSide[1] + 8], [millSide[0] + 30, millSide[1] + 14]]), 2.5)
  roads.push(ribbonPositions(hf, millLane, 3.2, 0.26))
  houses.push(...streetHouses({ rng, hf, path: millLane, spacing: 8.5, setback: 4.8, gap: 0.25, size: { w: [5, 7], d: [4, 5], h: [2.8, 4] }, mask: (x, z) => riverDistance(x, z) > 11 && hf.heightAt(x, z) > 0.8, walls: [TIMBER, '#8a6a4a', '#b99a7a'], roofs: ['#8c5a4a', '#6b4a3a', '#a86a58'], sink: 0.8 }))
  marks.mill = [millSide[0], 0, millSide[1]]

  /* ---------------------------------------------------------------- tournament field outside the south gate */
  const tilt: Vec2 = [gates.south[0] + 26, gates.south[1] + 30]
  const tiltYaw = 0.15
  const stripes: Item[] = []
  const stripeQuads: { centre: Vec2; half: Vec2; yaw: number }[] = []
  for (let i = -3; i <= 3; i++) {
    const lx = i * 5.6
    const c = Math.cos(tiltYaw)
    const s = Math.sin(tiltYaw)
    stripeQuads.push({ centre: [tilt[0] + lx * c, tilt[1] + lx * s], half: [2.6, 13], yaw: tiltYaw })
  }
  draped.push({ id: 'tilt-a', positions: drapedQuadPositions(hf, stripeQuads.filter((_, i) => i % 2 === 0), 0.24, 4), day: '#ead98a', night: nightTone('#ead98a') })
  draped.push({ id: 'tilt-b', positions: drapedQuadPositions(hf, stripeQuads.filter((_, i) => i % 2 === 1), 0.24, 4), day: '#d9765c', night: nightTone('#d9765c') })
  stripes.push({ p: [tilt[0], hf.heightAt(...tilt), tilt[1]], ry: tiltYaw + Math.PI / 2, s: [24, 1.2, 0.5], color: '#d9d2c4' })
  const pavilions: Item[] = []
  const pavilionColors = ['#b85c6b', '#e6c45a', '#c96f45', '#5a6675', '#e8a13a', '#d9765c']
  for (let i = 0; i < 6; i++) {
    const lx = (i - 2.5) * 7
    const lz = 18 + (i % 2) * 4
    const c = Math.cos(tiltYaw)
    const s = Math.sin(tiltYaw)
    const x = tilt[0] + lx * c - lz * s
    const z = tilt[1] + lx * s + lz * c
    const y = hf.heightAt(x, z)
    pavilions.push({ p: [x, y - 0.2, z], s: [6.5, 5.2, 6.5], color: pavilionColors[i] })
    banners.push({ p: [x, y + 5, z], ry: tiltYaw, s: [1, 2.2, 0.2], color: pavilionColors[(i + 2) % 6] })
  }
  boxes.push({ p: [tilt[0] - 10 * Math.sin(tiltYaw) - 16 * Math.cos(tiltYaw), hf.heightAt(...tilt) - 0.2, tilt[1] + 10 * Math.cos(tiltYaw) - 16 * Math.sin(tiltYaw)], ry: tiltYaw, s: [10, 3.2, 3], color: TIMBER })
  marks.tournament = [tilt[0], hf.heightAt(...tilt), tilt[1]]

  /* ---------------------------------------------------------------- farm common: windmill, barn, hamlets */
  const windmillAt: Vec2 = [HILLS.mill.centre[0], HILLS.mill.centre[1] - 2]
  const windmillBase = hf.heightAt(...windmillAt)
  const windmill = roundTower([windmillAt[0], windmillBase - 0.3, windmillAt[1]], 3.3, 11, '#d9c9a8', '#8c5a4a', 4)
  const sails: Mover = { kind: 'sails', p: [windmillAt[0] + Math.sin(0.6) * 3.6, windmillBase + 11, windmillAt[1] + Math.cos(0.6) * 3.6], radius: 7.5, yaw: 0.6, color: '#e9e2d1' }
  movers.push(sails)
  houses.push(hall([windmillAt[0] - 14, hf.heightAt(windmillAt[0] - 14, windmillAt[1] + 10) - 0.4, windmillAt[1] + 10], 0.3, 14, 7, 5, TIMBER, '#8c5a4a'))
  houses.push(...streetHouses({ rng, hf, path: millRoad.slice(2, Math.floor(millRoad.length * 0.6)), spacing: 16, setback: 7, gap: 0.45, size: { w: [5, 7.5], d: [4, 5.4], h: [3, 4.6] }, mask: (x, z) => riverDistance(x, z) > 12 && hf.heightAt(x, z) > 0.8, walls: WALLS, roofs: ['#8c5a4a', '#c96f45', '#d9765c'] }))
  houses.push(...streetHouses({ rng, hf, path: northWest.slice(3, Math.floor(northWest.length * 0.7)), spacing: 18, setback: 7, gap: 0.5, size: { w: [5, 7.5], d: [4, 5.4], h: [3, 4.6] }, mask: (x, z) => hf.heightAt(x, z) > 0.8 && hf.heightAt(x, z) < 12, walls: WALLS, roofs: ['#8c5a4a', '#c96f45', '#d9765c'] }))
  marks.windmill = [windmillAt[0], windmillBase + 11, windmillAt[1]]

  /* ---------------------------------------------------------------- forest hamlet below Westmark */
  const hamletPath = resample(smoothPolyline([[-96, -36], [-104, -52], [-98, -70], [-86, -84]]), 2.5)
  roads.push(ribbonPositions(hf, hamletPath, 3.2, 0.26))
  houses.push(...streetHouses({ rng, hf, path: hamletPath, spacing: 10, setback: 5.5, gap: 0.3, size: { w: [5, 7], d: [4, 5], h: [2.8, 4] }, walls: [TIMBER, '#8a6a4a', '#b99a7a'], roofs: ['#8c5a4a', '#6b4a3a', '#a86a58'], sink: 0.9 }))
  marks.hamlet = [-98, hf.heightAt(-98, -60), -60]

  /* ---------------------------------------------------------------- the patchwork */
  const farmMask = (x: number, z: number) => {
    const y = hf.heightAt(x, z)
    if (y < 0.5 || y > 26) return false
    if (hf.slopeAt(x, z) > 0.45) return false
    if (riverDistance(x, z) < 13) return false
    if (Math.abs(x) > 166 || Math.abs(z) > 166) return false
    if (polygonSignedDistance(cityWall, x, z) < 9) return false
    if (inCourt(x, z) || Math.hypot(x - HILLS.abbey.centre[0], z - HILLS.abbey.centre[1]) < 22) return false
    if (Math.hypot(x - tilt[0], z - tilt[1]) < 34) return false
    if (Math.hypot(x - HILLS.crown.centre[0], z - HILLS.crown.centre[1]) < 34) return false
    if (Math.hypot(x - HILLS.west.centre[0], z - HILLS.west.centre[1]) < 28) return false
    if (Math.hypot(x - HILLS.east.centre[0], z - HILLS.east.centre[1]) < 20) return false
    return true
  }
  const farm = patchwork({ rng, yaw: 0.3, cell: [19, 24], extent: 180, mask: farmMask, palette: FIELDS, skipChance: 0.07, orchardChance: 0.12, hedgeChance: 0.8, avoid: (x, z) => roadDistance(x, z) < 3.4 || riverDistance(x, z) < 11, hf })
  for (const [color, quads] of farm.fields) draped.push({ id: `field-${color}`, positions: drapedQuadPositions(hf, quads, 0.22, 5.5), day: color, night: nightTone(color) })

  /* ---------------------------------------------------------------- trees */
  const forest: Tree[] = scatterTrees({
    rng,
    count: 220,
    box: [-168, -168, 168, 168],
    spacing: 5,
    hf,
    kind: (x, z) => (hf.heightAt(x, z) > 18 ? 'cone' : 'round'),
    colors: ['#4f7d4a', '#5f9a55', '#3f6b40', '#6d9c58'],
    mask: (x, z) => {
      const y = hf.heightAt(x, z)
      if (y < 0.8 || inCity(x, z) || inCourt(x, z) || roadDistance(x, z) < 4) return false
      const westWoods = Math.hypot(x - HILLS.west.centre[0], z - HILLS.west.centre[1]) < 70 && !farmMask(x, z)
      const crownWoods = Math.hypot(x - HILLS.crown.centre[0], z - HILLS.crown.centre[1]) < 62 && Math.hypot(x - HILLS.crown.centre[0], z - HILLS.crown.centre[1]) > 30
      const rim = Math.max(Math.abs(x), Math.abs(z)) > 140 && !farmMask(x, z)
      return (westWoods || crownWoods || rim) && fbm(x, z, seed + 21, 36, 2) > 0.42
    },
  })
  const copses: Tree[] = scatterTrees({
    rng,
    count: 130,
    box: [-168, -168, 168, 168],
    spacing: 6,
    hf,
    kind: 'round',
    colors: ['#4f7d4a', '#5f9a55', '#6d9c58'],
    radius: [1.8, 3],
    mask: (x, z) => {
      const y = hf.heightAt(x, z)
      if (y < 0.5 || inCity(x, z) || inCourt(x, z) || roadDistance(x, z) < 4.5) return false
      const rd = riverDistance(x, z)
      const willow = rd > 9 && rd < 15 && fbm(x, z, seed + 25, 20, 2) > 0.48
      const meadowCopse = !farmMask(x, z) && Math.hypot(x - tilt[0], z - tilt[1]) > 36 && fbm(x, z, seed + 23, 30, 2) > 0.58
      return willow || meadowCopse
    },
  })

  /* ---------------------------------------------------------------- carts */
  const cartSet = carts(rng, hf, [[gates.south[0] + 1, gates.south[1] + 14], [gates.west[0] - 12, gates.west[1] + 3], [southNear[0] - 2, southNear[1] - 10], [gates.north[0] + 6, gates.north[1] - 16]], (p) => (Math.abs(p[0] - gates.west[0]) < 15 ? 0 : yawFromDir(0, 1)))

  /* ---------------------------------------------------------------- layers */
  layers.push(
    { id: 'walls', geometry: 'box', items: [...wallBoxes, ...boxes, ...bridges.decks, ...bridges.piers, ...bridges.parapets, ...cartSet.beds, ...cartSet.wheels, ...market.posts, ...cath.boxes, ...abbey.boxes, ...stripes], color: STONE },
    { id: 'towers', geometry: 'cyl8', items: [...towerBodies, belfry.body, windmill.body, ...cath.cyls, ...abbey.cyls], color: STONE },
    { id: 'caps', geometry: 'cone6', items: [...towerCaps, belfry.cap, windmill.cap, ...cath.cones6, ...abbey.cones6, ...pavilions], color: SLATE },
    { id: 'roofs', geometry: 'prism', items: [...cath.prisms, ...abbey.prisms, ...market.canopies], color: SLATE },
    { id: 'spires', geometry: 'cone4', items: [...cath.cones4, ...abbey.cones4], color: SLATE },
    { id: 'arches', geometry: 'arch', items: bridges.arches, color: '#c8bda4' },
    { id: 'banners', geometry: 'box', items: banners, color: '#b85c6b', castShadow: false },
    { id: 'hedges', geometry: 'box', items: farm.hedges, color: '#4f7d4a' },
    ...houseLayers('houses', houses),
    ...treeLayers('forest', [...forest, ...copses, ...farm.orchards], '#5a4030'),
    { id: 'lantern-posts', geometry: 'box', items: postItems, color: '#4a3a30', castShadow: false },
    { id: 'lanterns', geometry: 'box', items: lanternItems, color: '#ffd27a', glow: true, castShadow: false },
    { id: 'windows', geometry: 'plane', items: [...cath.windows, ...abbey.windows, ...castleWindows], color: '#ffe9a8', glow: true, castShadow: false },
  )
  draped.unshift({ id: 'roads', positions: concat(roads), day: ROAD, night: ROAD_NIGHT })

  return {
    label: 'medieval-c-market',
    ground: { hf, classify, day: DAY, night: NIGHT },
    water: { y: WATER_Y, day: '#5faeb6', night: '#274e60' },
    draped,
    layers,
    movers,
    budget: budgetFor(hf, draped, layers, moverTriangles(movers) + 2),
    marks,
  }
}
