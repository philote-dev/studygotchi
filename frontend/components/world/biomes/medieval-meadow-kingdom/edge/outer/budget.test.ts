import { describe, expect, it } from 'vitest'
import type * as THREE from 'three'
import { generateKingdom } from '../../layout/biome-layout'
import { buildFarMill, buildVista } from '../barriers/vistas'
import { canopyGeometry, copseGeometry, crossGeometry, hayGeometry, hedgeGeometry, lollipopGeometry, treeGeometry, trunkGeometry } from '../outer'
import { createOuterBuild, runOuterBuild } from './build'
import { createOuterWorld } from './outer-world'

const layout = generateKingdom(7)
const world = createOuterWorld(layout, 7)

function tris(geo: THREE.BufferGeometry): number {
  return geo.index ? geo.index.count / 3 : geo.getAttribute('position').count / 3
}

/** The outer world's whole triangle budget, counted from the built geometry and the instance lists. */
export function outerTriangleReport(w = world) {
  const build = createOuterBuild(w)
  const times = runOuterBuild(build)
  const b = build.built
  const perRing = { ring1: 0, ring2: 0, ring3: 0 }
  for (const m of b.rings) perRing[`ring${m.ring as 1 | 2 | 3}`] += m.triangles
  const ribbons = b.ribbons ? [...b.ribbons.banks, ...b.ribbons.waters, ...b.ribbons.tracks].reduce((s, g) => s + tris(g), 0) : 0
  const unit = {
    tree: tris(treeGeometry()),
    lollipop: tris(lollipopGeometry()),
    cross: tris(crossGeometry()),
    canopy: tris(canopyGeometry()),
    trunk: tris(trunkGeometry()),
    copse: tris(copseGeometry()),
    hedge: tris(hedgeGeometry()),
    hay: tris(hayGeometry()),
  }
  const counts = {
    l0: b.lone?.l0.length ?? 0,
    l1: b.lone?.l1.length ?? 0,
    l2: b.lone?.l2.length ?? 0,
    woods: b.woods.length,
    trunks: b.woods.filter((c) => c.trunk).length,
    copses: b.copses?.length ?? 0,
    hedges: b.hedges?.length ?? 0,
    hay: b.hay?.length ?? 0,
  }
  const parts = {
    ...perRing,
    decals: b.decals?.triangles ?? 0,
    ribbons,
    hedges: counts.hedges * unit.hedge,
    treesL0: counts.l0 * unit.tree,
    treesL1: counts.l1 * unit.lollipop,
    treesL2: counts.l2 * unit.cross,
    woods: counts.woods * unit.canopy + counts.trunks * unit.trunk,
    copses: counts.copses * unit.copse,
    hay: counts.hay * unit.hay,
    vistas: w.plan.vistas.reduce((s, v) => s + tris(buildVista(v, { night: false }, 0.2, w.seed).geometry), 0),
    mill: tris(buildFarMill({ night: false }, 0.1)),
  }
  const total = Object.values(parts).reduce((s, n) => s + n, 0)
  return { parts, total, unit, counts, times, steps: build.steps.map((s) => s.label) }
}

describe('endless meadow: budget', () => {
  const report = outerTriangleReport()

  it('keeps the whole outer world at or under 120k triangles, counted from the built geometry', () => {
    expect(report.total).toBeLessThanOrEqual(120_000)
    expect(report.total).toBeGreaterThan(60_000)
    // Rings: 10 / 30 / 60 m cells.
    expect(report.parts.ring1).toBeGreaterThan(15_000)
    expect(report.parts.ring1).toBeLessThan(25_000)
    expect(report.parts.ring2).toBeLessThan(12_000)
    expect(report.parts.ring3).toBeLessThan(6_000)
    // The three tree LODs are 50 / 16 / 4 triangles; woods canopies 20 (+8 trunk), copses one merged piece.
    expect(report.unit).toEqual({ tree: 50, lollipop: 16, cross: 4, canopy: 20, trunk: 8, copse: 84, hedge: 10, hay: 24 })
    expect(report.parts.treesL0).toBeLessThan(25_000)
    expect(report.parts.woods).toBeLessThan(25_000)
    expect(report.parts.hedges).toBeLessThan(25_000)
  })

  it('builds in many small steps, nearest ring first: no step emits more than a fifth of the budget', () => {
    expect(report.steps.slice(0, 4)).toEqual(['ring1-q0', 'ring1-q1', 'ring1-q2', 'ring1-q3'])
    expect(report.steps.length).toBeGreaterThan(10)
    // Deterministic stand-in for the wall clock: the triangles (instances × their unit) each step adds.
    const work = stepWork(world, report.unit)
    expect(work.map((w) => w.label)).toEqual(report.steps)
    expect(work.reduce((s, w) => s + w.triangles, 0)).toBe(report.total - report.parts.vistas - report.parts.mill)
    const heaviest = work.reduce((a, b) => (b.triangles > a.triangles ? b : a))
    expect(heaviest.triangles, `heaviest step ${heaviest.label} adds ${heaviest.triangles} triangles`).toBeLessThanOrEqual(24_000)
    // Ring 1 is cut into four equal quadrants; the woods scan is cut into at least three z-bands.
    const ring1 = work.filter((w) => w.label.startsWith('ring1')).map((w) => w.triangles)
    expect(ring1).toHaveLength(4)
    expect(new Set(ring1).size).toBe(1)
    expect(work.filter((w) => w.label.startsWith('woods')).length).toBeGreaterThanOrEqual(3)
  })

  // Wall-clock smoke, local only: the best of three builds per step stays well under a frame's worth of
  // work. A single timing flaked under machine load (81–142 ms for a 3 ms step), hence the minimum.
  it.skipIf(process.env.CI)('takes under 60 ms per step (best of three builds)', () => {
    const runs = [report.times, runOuterBuild(createOuterBuild(world)), runOuterBuild(createOuterBuild(world))]
    const best = report.steps.map((_, i) => Math.min(...runs.map((r) => r[i])))
    const slowest = Math.max(...best)
    expect(slowest, `slowest step ${report.steps[best.indexOf(slowest)]} took ${slowest.toFixed(0)} ms`).toBeLessThan(60)
  })
})

/** Triangles each build step adds, counted from what it emits (ring meshes, decals, ribbons, instances × unit). */
function stepWork(w: ReturnType<typeof createOuterWorld>, unit: ReturnType<typeof outerTriangleReport>['unit']) {
  const build = createOuterBuild(w)
  const b = build.built
  const tally = () =>
    b.rings.reduce((s, m) => s + m.triangles, 0) +
    (b.decals?.triangles ?? 0) +
    (b.ribbons ? [...b.ribbons.banks, ...b.ribbons.waters, ...b.ribbons.tracks].reduce((s, g) => s + tris(g), 0) : 0) +
    (b.hedges?.length ?? 0) * unit.hedge +
    b.woods.length * unit.canopy +
    b.woods.filter((c) => c.trunk).length * unit.trunk +
    (b.copses?.length ?? 0) * unit.copse +
    (b.lone ? b.lone.l0.length * unit.tree + b.lone.l1.length * unit.lollipop + b.lone.l2.length * unit.cross : 0) +
    (b.hay?.length ?? 0) * unit.hay
  const out: Array<{ label: string; triangles: number }> = []
  let before = 0
  while (build.next < build.steps.length) {
    const step = build.steps[build.next++]
    step.run()
    const after = tally()
    out.push({ label: step.label, triangles: after - before })
    before = after
  }
  return out
}
