import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { treeSwayPose } from './storm-weather'

interface StormWindValue {
  intensityRef: { current: number }
  reducedMotion: boolean
}

const StormWindContext = createContext<StormWindValue>({
  intensityRef: { current: 0 },
  reducedMotion: false,
})

export function useStormWind(): StormWindValue {
  return useContext(StormWindContext)
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  return reduced
}

/** Eases gale intensity so trees and streaks do not pop on/off. Lives inside the Canvas. */
export function StormWindProvider({
  storm,
  reducedMotion,
  children,
}: {
  storm: boolean
  reducedMotion: boolean
  children: ReactNode
}) {
  const intensityRef = useRef(storm ? 1 : 0)
  const value = useMemo<StormWindValue>(() => ({ intensityRef, reducedMotion }), [reducedMotion])

  useFrame((_, delta) => {
    const target = storm ? 1 : 0
    intensityRef.current += (target - intensityRef.current) * Math.min(1, delta * 3.4)
    if (Math.abs(target - intensityRef.current) < 0.01) intensityRef.current = target
  })

  return <StormWindContext.Provider value={value}>{children}</StormWindContext.Provider>
}

export function WindSway({ seed, children }: { seed: number; children: ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const { intensityRef, reducedMotion } = useStormWind()

  useFrame(({ clock }) => {
    if (!group.current) return
    const pose = treeSwayPose(clock.elapsedTime, intensityRef.current, seed, reducedMotion)
    group.current.rotation.x = pose.pitch
    group.current.rotation.z = pose.roll
  })

  return <group ref={group}>{children}</group>
}
