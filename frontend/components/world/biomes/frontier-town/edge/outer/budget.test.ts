import { describe, expect, it } from 'vitest'
import { createOuterDesert } from './desert'
import { buildOuterMeshes, propGeometry, triangleCount } from './mesh'
import { RINGS } from './plate'
import { HOODOO_SPEC, SCATTER, hoodooField, scatterProps } from './scatter'
import { buildMast, buildMesaTown, buildMission, buildTrain, buildTrestle } from './structures'
import { vista } from './vistas'
import { type DressingKind, buildPlaces, dressingGeometry, laneRibbons } from './beyond-build'
import { cartLanes, cattle, fenceRails, graves, milestones, planLanes, smokeSources, trees } from './places'
import { PUFFS } from '../motion'

/** What the outer world adds to the frame, so the budget is a number and not a feeling. */
describe('outer world budget', () => {
  it('stays within ~160k triangles and ~25 draw calls', () => {
    const desert = createOuterDesert(7)
    const rings = buildOuterMeshes(desert, RINGS)
    const ringTris = triangleCount(rings)
    let propTris = 0
    let propDraws = 0
    for (const spec of SCATTER) {
      const items = scatterProps(desert, spec)
      const geo = propGeometry(spec.kind)
      propTris += (items.length * geo.geometry.getAttribute('position').count) / 3
      propDraws += 1
      geo.geometry.dispose()
    }
    const hoodoos = hoodooField(desert)
    const hoodooGeo = propGeometry('hoodoo')
    propTris += (hoodoos.length * hoodooGeo.geometry.getAttribute('position').count) / 3
    propDraws += 1
    hoodooGeo.geometry.dispose()
    expect(hoodoos.length).toBeLessThanOrEqual(HOODOO_SPEC.count)
    const structures = [
      buildMesaTown(false).geometry,
      buildMission(false).geometry,
      buildMast(vista('west').height, false).geometry,
      buildTrain(false).geometry,
      buildTrestle(desert, desert.trestle, false).geometry,
    ]
    const structureTris = structures.reduce((sum, g) => sum + g.getAttribute('position').count / 3, 0)
    structures.forEach((g) => g.dispose())
    // Plate (1) + ring quadrants + instanced prop kinds + merged vistas + their four lamps.
    const draws = 1 + rings.length + propDraws + structures.length + 4
    const total = ringTris + propTris + structureTris + 2
    // Measured at seed 7: rings ≈ 44k tris / 12 draws, props ≈ 106k / 4, vistas ≈ 5.4k / 9 → ≈ 155k tris, 26 draws.
    expect(ringTris).toBeLessThan(60000)
    expect(total).toBeLessThan(160000)
    expect(draws).toBeLessThanOrEqual(26)
  })

  it('populates the beyond within +45k triangles and +20 draw calls', () => {
    const desert = createOuterDesert(7)
    const places = buildPlaces(desert, false)
    places.geometry.dispose()
    const { lanes } = planLanes(desert.places, desert.windows)
    const tris = (kind: DressingKind) => {
      const geo = dressingGeometry(kind, false)
      const n = geo.getAttribute('position').count / 3
      geo.dispose()
      return n
    }
    const counts: Record<DressingKind, number> = {
      fence: fenceRails(desert.places).length,
      cattle: cattle(desert.places, 7).length,
      tree: trees(desert.places, 7).length,
      grave: graves(desert.places, 7).length,
      milestone: milestones(lanes).length,
      lane: laneRibbons(desert, lanes).length,
      light: desert.places.length,
      smoke: smokeSources(desert.places).length * PUFFS,
      cart: cartLanes(lanes).length,
      wheel: desert.places.filter((p) => p.kind === 'ranch').length,
      raft: 1,
    }
    let instanced = 0
    for (const kind of Object.keys(counts) as DressingKind[]) instanced += counts[kind] * tris(kind)
    const total = places.triangles + instanced
    const draws = 1 + Object.keys(counts).length
    // Measured at seed 7: places ≈ 9k tris in 1 draw, dressing ≈ 15k in 11 draws.
    expect(places.triangles).toBeGreaterThan(3000)
    expect(total).toBeLessThan(45000)
    expect(draws).toBeLessThanOrEqual(20)
  })
})
