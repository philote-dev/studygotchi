import { describe, expect, it } from 'vitest'
import { createOuterWorld } from '../outer/outer-world'
import { barrierPlan } from './geography'
import { BARRIER_COLOURS, Batch, buildEnclosure, buildVista, place, prism } from './build'

const SEED = 7
const world = createOuterWorld(SEED)
const plan = barrierPlan(world, SEED)

function finite(array: ArrayLike<number>): boolean {
  for (let i = 0; i < array.length; i++) if (!Number.isFinite(array[i])) return false
  return true
}

describe('barriers: build', () => {
  it('merges the whole enclosure into one coloured buffer under 30k triangles', () => {
    const geometry = buildEnclosure(plan, SEED, false)
    const triangles = geometry.getAttribute('position').count / 3
    expect(triangles).toBeGreaterThan(4000)
    expect(triangles).toBeLessThan(30_000)
    expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count)
    expect(finite(geometry.getAttribute('position').array)).toBe(true)
    expect(geometry.boundingSphere).not.toBeNull()
    geometry.dispose()
  })

  it('builds every vista with its own geometry, the geyser field with three vents', () => {
    for (const vista of plan.vistas) {
      const built = buildVista(vista, false, SEED)
      const count = built.geometry.getAttribute('position').count
      expect(count, vista.kind).toBeGreaterThan(30)
      expect(count / 3, vista.kind).toBeLessThan(4000)
      expect(finite(built.geometry.getAttribute('position').array)).toBe(true)
      if (vista.kind === 'geysers') {
        expect(built.vents).toHaveLength(3)
        for (const [x, y, z] of built.vents!) {
          expect(Math.hypot(x - vista.x, z - vista.z)).toBeLessThan(40)
          expect(y).toBeGreaterThan(vista.seatY)
        }
      } else expect(built.vents).toBeUndefined()
      built.geometry.dispose()
    }
  })

  it('shades facets by the key light and bakes haze toward the sky colour', () => {
    const unlit = new Batch(false, BARRIER_COLOURS.day.sky, 0)
    unlit.tris(prism({ sides: 6, rx: 2, rz: 2, taper: 1, y0: 0, y1: 10, jitter: 0, rng: () => 0.5 }), place(0, 0, 0), '#ffffff')
    const geometry = unlit.build()
    const colours = geometry.getAttribute('color').array as Float32Array
    const steps = new Set<number>()
    for (let i = 0; i < colours.length; i += 3) steps.add(Math.round(colours[i] * 100) / 100)
    expect(steps.size).toBeGreaterThanOrEqual(2)
    const hazed = new Batch(false, '#000000', 0.5)
    hazed.tris(prism({ sides: 6, rx: 2, rz: 2, taper: 1, y0: 0, y1: 10, jitter: 0, rng: () => 0.5 }), place(0, 0, 0), '#ffffff', 'none')
    const dark = hazed.build().getAttribute('color').array as Float32Array
    expect(dark[0]).toBeCloseTo(0.5, 6)
    geometry.dispose()
  })

  it('recolours for night without changing the geometry', () => {
    const day = buildEnclosure(plan, SEED, false)
    const night = buildEnclosure(plan, SEED, true)
    expect(night.getAttribute('position').count).toBe(day.getAttribute('position').count)
    const d = day.getAttribute('color').array as Float32Array
    const n = night.getAttribute('color').array as Float32Array
    let darker = 0
    for (let i = 0; i < d.length; i += 3) if (n[i] + n[i + 1] + n[i + 2] < d[i] + d[i + 1] + d[i + 2]) darker++
    expect(darker / (d.length / 3)).toBeGreaterThan(0.95)
    day.dispose()
    night.dispose()
  })
})
