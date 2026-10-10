/** Day/night (and storm) sky blend: bible §6 asks for a 1.2 s crossfade of sky, fog and key light. */
export const DAY_NIGHT_SECONDS = 1.2

export interface SkyGrade {
  sky: string
  fogNear: number
  fogFar: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  sunColor: string
  sunIntensity: number
  sunPosition: [number, number, number]
}

/** Advance a 0..1 blend clock; `instant` (reduced motion) completes in one step. */
export function blendProgress(t: number, deltaSeconds: number, instant = false, seconds = DAY_NIGHT_SECONDS): number {
  if (instant || seconds <= 0) return 1
  return Math.min(1, t + Math.max(0, deltaSeconds) / seconds)
}

export function easeInOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t))
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

/** The scene's sky for a day/night/storm state. Storm wins; night otherwise; else day. */
export function skyGradeFor(
  night: boolean,
  storm: { sky: string; fogNear: number; fogFar: number; hemiSky: string; hemiGround: string; hemiIntensity: number; sunColor: string; sunIntensity: number } | null,
  palette: { sky: string; skyNight: string },
): SkyGrade {
  if (storm) {
    return { ...storm, sunPosition: [-70, 38, 18] }
  }
  if (night) {
    return {
      sky: palette.skyNight,
      fogNear: 220,
      fogFar: 640,
      hemiSky: '#8aa0c0',
      hemiGround: '#3a3550',
      hemiIntensity: 0.7,
      sunColor: '#8fa3d8',
      sunIntensity: 1.1,
      sunPosition: [-40, 60, 30],
    }
  }
  return {
    sky: palette.sky,
    fogNear: 220,
    fogFar: 640,
    hemiSky: '#dff4ff',
    hemiGround: '#9e8fae',
    hemiIntensity: 0.45,
    sunColor: '#fff3e0',
    sunIntensity: 2.0,
    sunPosition: [60, 90, 70],
  }
}
