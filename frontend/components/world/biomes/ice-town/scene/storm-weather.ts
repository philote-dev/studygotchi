/** Directional gale: +X with a slight +Z so streaks read as one wind, not a swirl. */
export const STORM_WIND = { x: 1, z: 0.28 } as const

export const HAIL_COUNT = 240
export const WIND_STREAK_COUNT = 18
export const STORM_STREAK_OPACITY_CAP = 0.46

export function treeSwayPose(
  time: number,
  intensity: number,
  seed: number,
  reducedMotion: boolean,
): { pitch: number; roll: number } {
  if (reducedMotion || intensity <= 0) return { pitch: 0, roll: 0 }
  const gust = 0.62 + 0.38 * Math.sin(time * 2.35 + seed * 1.7)
  const lean = 0.24 * intensity * (0.72 + 0.28 * Math.max(0, gust))
  const shudder = 0.032 * intensity * Math.sin(time * 17.5 + seed * 6.1)
  return {
    pitch: lean + shudder,
    roll: lean * 0.85 + shudder * 0.4,
  }
}

export function hailFallSpeed(intensity: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  return 14 + intensity * 8
}

export function hailAfterImpact(
  y: number,
  vy: number,
  groundY: number,
): { y: number; vy: number; bounced: boolean; settled: boolean } {
  if (y > groundY) return { y, vy, bounced: false, settled: false }
  const bounce = -vy * 0.38
  if (bounce < 4) return { y: groundY, vy: 0, bounced: true, settled: true }
  return { y: groundY + 0.02, vy: bounce, bounced: true, settled: false }
}

export function windGustSpeed(
  time: number,
  base: number,
  intensity: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || intensity <= 0) return 0
  const gust = 1.15 + 0.55 * Math.max(0, Math.sin(time * 1.9))
  return base * (1.35 + intensity * 0.95) * gust
}

export function stormStreakOpacity(time: number, index: number, intensity: number): number {
  if (intensity <= 0) return 0
  const pulse = 0.22 + 0.2 * Math.max(0, Math.sin(time * 1.35 + index * 0.7))
  const layer = (index % 3) * 0.035
  return Math.min(STORM_STREAK_OPACITY_CAP, (pulse + layer) * intensity)
}

export function stormGrade(intensity: number): {
  sky: string
  fogNear: number
  fogFar: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  sunColor: string
  sunIntensity: number
} {
  const k = Math.min(1, Math.max(0, intensity))
  return {
    sky: "#2f3f56",
    fogNear: 150,
    fogFar: 520,
    hemiSky: "#6a82a0",
    hemiGround: "#2a2436",
    hemiIntensity: 0.38 * (0.55 + 0.45 * k),
    sunColor: "#c4d4e8",
    sunIntensity: 0.72 + 0.2 * k,
  }
}
