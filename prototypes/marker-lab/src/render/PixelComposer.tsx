import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js'

export const PIXEL_PROFILE = {
  pixelSize: 2,
  normalEdgeStrength: 0.2,
  depthEdgeStrength: 0.14,
} as const

export function PixelComposer() {
  const { gl, scene, camera, size } = useThree()
  const bundle = useMemo(() => {
    const composer = new EffectComposer(gl)
    const pixel = new RenderPixelatedPass(PIXEL_PROFILE.pixelSize, scene, camera, {
      normalEdgeStrength: PIXEL_PROFILE.normalEdgeStrength,
      depthEdgeStrength: PIXEL_PROFILE.depthEdgeStrength,
    })
    composer.addPass(pixel)
    composer.addPass(new OutputPass())
    return { composer, pixel }
  }, [camera, gl, scene])

  useEffect(() => {
    bundle.composer.setSize(size.width, size.height)
  }, [bundle.composer, size.height, size.width])

  useEffect(
    () => () => {
      bundle.pixel.dispose()
      bundle.composer.dispose()
    },
    [bundle],
  )

  useEffect(() => {
    // The pixel pass renders the scene twice (beauty + normals). Updating the shadow map by hand
    // once per frame stops the second pass from re-rendering every caster.
    gl.shadowMap.autoUpdate = false
    return () => {
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])

  useFrame((_, delta) => {
    gl.shadowMap.needsUpdate = true
    bundle.composer.render(delta)
  }, 1)
  return null
}
