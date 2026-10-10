import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { toonMaterial, toonMaterialCount } from './materials'

describe('shared toon materials', () => {
  it('returns one material instance per distinct surface tuple', () => {
    const before = toonMaterialCount()
    const a = toonMaterial({ color: '#c8524a' })
    const b = toonMaterial({ color: '#c8524a' })
    const c = toonMaterial({ color: '#c8524a', emissive: '#c8524a', emissiveIntensity: 1.6 })
    const d = toonMaterial({ color: '#c8524a', transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    expect(a).toBe(b)
    expect(c).not.toBe(a)
    expect(d).not.toBe(a)
    expect(toonMaterialCount() - before).toBe(3)
  })

  it('bakes the requested look into the shared material', () => {
    const material = toonMaterial({ color: '#5f9ea8', emissive: '#ffe9a8', emissiveIntensity: 1.2 })
    expect(material.color.getHexString()).toBe('5f9ea8')
    expect(material.emissive.getHexString()).toBe('ffe9a8')
    expect(material.emissiveIntensity).toBe(1.2)
    expect(material.gradientMap).not.toBeNull()
  })
})
