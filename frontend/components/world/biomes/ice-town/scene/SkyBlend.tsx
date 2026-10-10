import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { blendProgress, easeInOutCubic, lerp, type SkyGrade } from './sky-blend'

/**
 * Background, fog, hemisphere and key light for the ice land, crossfaded over 1.2 s whenever the
 * target grade (day / night / storm) changes. Owns `scene.background` and `scene.fog` so the
 * colours can be mutated per frame instead of re-created per render.
 */
export function SkyBlend({ grade, instant }: { grade: SkyGrade; instant: boolean }) {
  const scene = useThree((state) => state.scene)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const sun = useRef<THREE.DirectionalLight>(null)

  const live = useMemo(
    () => ({
      sky: new THREE.Color(grade.sky),
      fog: new THREE.Fog(grade.sky, grade.fogNear, grade.fogFar),
      hemiSky: new THREE.Color(grade.hemiSky),
      hemiGround: new THREE.Color(grade.hemiGround),
      hemiIntensity: grade.hemiIntensity,
      sunColor: new THREE.Color(grade.sunColor),
      sunIntensity: grade.sunIntensity,
      sunPosition: new THREE.Vector3(...grade.sunPosition),
    }),
    // Created once; mutated per frame below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const blend = useRef<{ t: number; from: typeof live | null; to: SkyGrade }>({ t: 1, from: null, to: grade })
  const scratch = useMemo(() => ({ a: new THREE.Color(), b: new THREE.Color(), v: new THREE.Vector3() }), [])

  useEffect(() => {
    scene.background = live.sky
    scene.fog = live.fog
    return () => {
      if (scene.background === live.sky) scene.background = null
      if (scene.fog === live.fog) scene.fog = null
    }
  }, [live, scene])

  useEffect(() => {
    blend.current = {
      t: 0,
      from: {
        sky: live.sky.clone(),
        fog: new THREE.Fog(live.fog.color.clone(), live.fog.near, live.fog.far),
        hemiSky: live.hemiSky.clone(),
        hemiGround: live.hemiGround.clone(),
        hemiIntensity: live.hemiIntensity,
        sunColor: live.sunColor.clone(),
        sunIntensity: live.sunIntensity,
        sunPosition: live.sunPosition.clone(),
      },
      to: grade,
    }
  }, [grade, live])

  useFrame((_, delta) => {
    const b = blend.current
    if (b.t >= 1 && b.from === null) return
    b.t = blendProgress(b.t, delta, instant)
    const k = easeInOutCubic(b.t)
    const from = b.from ?? live
    const to = b.to

    live.sky.copy(from.sky).lerp(scratch.a.set(to.sky), k)
    live.fog.color.copy(live.sky)
    live.fog.near = lerp(from.fog.near, to.fogNear, k)
    live.fog.far = lerp(from.fog.far, to.fogFar, k)
    live.hemiSky.copy(from.hemiSky).lerp(scratch.a.set(to.hemiSky), k)
    live.hemiGround.copy(from.hemiGround).lerp(scratch.b.set(to.hemiGround), k)
    live.hemiIntensity = lerp(from.hemiIntensity, to.hemiIntensity, k)
    live.sunColor.copy(from.sunColor).lerp(scratch.a.set(to.sunColor), k)
    live.sunIntensity = lerp(from.sunIntensity, to.sunIntensity, k)
    live.sunPosition.copy(from.sunPosition).lerp(scratch.v.set(...to.sunPosition), k)

    if (hemi.current) {
      hemi.current.color.copy(live.hemiSky)
      hemi.current.groundColor.copy(live.hemiGround)
      hemi.current.intensity = live.hemiIntensity
    }
    if (sun.current) {
      sun.current.color.copy(live.sunColor)
      sun.current.intensity = live.sunIntensity
      sun.current.position.copy(live.sunPosition)
    }
    if (b.t >= 1) b.from = null
  })

  return (
    <>
      <hemisphereLight ref={hemi} args={[grade.hemiSky, grade.hemiGround, grade.hemiIntensity]} />
      <directionalLight
        ref={sun}
        position={grade.sunPosition}
        intensity={grade.sunIntensity}
        color={grade.sunColor}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={10}
        shadow-camera-far={360}
        shadow-camera-left={-110}
        shadow-camera-right={110}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
        shadow-bias={-0.0008}
      />
    </>
  )
}
