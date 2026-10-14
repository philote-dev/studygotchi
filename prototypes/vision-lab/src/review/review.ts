/**
 * Pure helpers for the review page (no React, no DOM), so they can be unit-tested and reused by
 * the capture scripts if needed.
 */
import { DIRECTION_IDS, LAND_IDS, POSE_IDS, type DirectionId, type LandId, type LandVision, type PoseId } from '../lands/types'
import { INITIAL_STATE, searchFromState } from '../state'
import type { Enforcement, HarnessSection } from './harness'

export type Mode = 'day' | 'night'
export const MODES: readonly Mode[] = ['day', 'night']

export type PoseFilter = 'all' | PoseId
export const POSE_FILTERS: readonly PoseFilter[] = ['all', ...POSE_IDS]

export type Tab = 'options' | 'harness'

/** A decided pick per land; a land missing from the record is "undecided". */
export type Picks = Partial<Record<LandId, DirectionId>>
export const PICKS_KEY = 'sg.vision.picks'

export const ENFORCEMENTS: readonly Enforcement[] = ['test', 'review', 'brief']

/** Captured frames are published by scripts/publish-shots.mjs under this prefix. */
export const SHOTS_PREFIX = '/review/shots'

export function shotName(land: LandId, dir: DirectionId, pose: PoseId, mode: Mode): string {
  return `${land}-${dir}-${pose}-${mode}.png`
}

export function shotUrl(land: LandId, dir: DirectionId, pose: PoseId, mode: Mode): string {
  return `${SHOTS_PREFIX}/${shotName(land, dir, pose, mode)}`
}

/** Every frame the gallery can show: lands × directions × poses × modes (144 for six lands). */
export function allShotUrls(lands: readonly LandVision[]): string[] {
  const urls: string[] = []
  for (const land of lands) {
    for (const direction of land.directions) {
      for (const pose of POSE_IDS) {
        for (const mode of MODES) urls.push(shotUrl(land.id, direction.id, pose, mode))
      }
    }
  }
  return urls
}

/** Link into the live lab; `free` opens the orbit camera from the hero pose. */
export function liveUrl(land: LandId, dir: DirectionId, pose: PoseId | 'free', night: boolean): string {
  return `/${searchFromState({ land, direction: dir, pose: pose === 'free' ? null : pose, night, seed: INITIAL_STATE.seed })}`
}

export function posesFor(filter: PoseFilter): readonly PoseId[] {
  return filter === 'all' ? POSE_IDS : [filter]
}

export function isReviewView(search: string): boolean {
  return new URLSearchParams(search).get('view') === 'review'
}

export function tabFromSearch(search: string): Tab {
  return new URLSearchParams(search).get('tab') === 'harness' ? 'harness' : 'options'
}

export function modeFromSearch(search: string): Mode {
  return new URLSearchParams(search).get('night') === '1' ? 'night' : 'day'
}

export function poseFilterFromSearch(search: string): PoseFilter {
  const pose = new URLSearchParams(search).get('pose')
  return (POSE_IDS as readonly string[]).includes(pose ?? '') ? (pose as PoseId) : 'all'
}

/** The review page's URL: `?view=review` plus only the non-default knobs. */
export function reviewSearch(tab: Tab, mode: Mode, filter: PoseFilter): string {
  const params = new URLSearchParams({ view: 'review' })
  if (tab !== 'options') params.set('tab', tab)
  if (mode === 'night') params.set('night', '1')
  if (filter !== 'all') params.set('pose', filter)
  return `?${params.toString()}`
}

/** "Ice / Chilly Town" → "Ice", "Medieval Meadow Kingdom" → "Medieval": the first word names the land. */
export function shortName(land: Pick<LandVision, 'name'>): string {
  return land.name.split(/[\s/]+/)[0] ?? land.name
}

/** Reads picks back from storage, dropping anything that is not a known land → direction pair. */
export function parsePicks(raw: string | null | undefined): Picks {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const picks: Picks = {}
  for (const [land, dir] of Object.entries(parsed as Record<string, unknown>)) {
    if ((LAND_IDS as readonly string[]).includes(land) && (DIRECTION_IDS as readonly string[]).includes(String(dir))) {
      picks[land as LandId] = dir as DirectionId
    }
  }
  return picks
}

export function serialisePicks(picks: Picks): string {
  return JSON.stringify(picks)
}

export function setPick(picks: Picks, land: LandId, dir: DirectionId | 'undecided'): Picks {
  const next = { ...picks }
  if (dir === 'undecided') delete next[land]
  else next[land] = dir
  return next
}

export interface PickPart {
  id: LandId
  label: string
  /** "A" / "B" / "C" or "undecided". */
  pick: string
  decided: boolean
}

/** The toolbar summary, one part per land in menu order. */
export function pickParts(picks: Picks, lands: readonly LandVision[]): PickPart[] {
  return lands.map((land) => {
    const pick = picks[land.id]
    return { id: land.id, label: shortName(land), pick: pick ? pick.toUpperCase() : 'undecided', decided: pick !== undefined }
  })
}

/** One line for the toolbar, in menu order: "Ice: B · Medieval: undecided · …". */
export function summarisePicks(picks: Picks, lands: readonly LandVision[]): string {
  return pickParts(picks, lands)
    .map((part) => `${part.label}: ${part.pick}`)
    .join(' · ')
}

export function decidedCount(picks: Picks, lands: readonly LandVision[]): number {
  return lands.filter((land) => picks[land.id] !== undefined).length
}

export function countBy(sections: readonly HarnessSection[], how: Enforcement): number {
  let count = 0
  for (const section of sections) for (const rule of section.rules) if (rule.how === how) count += 1
  return count
}

export function harnessCounts(sections: readonly HarnessSection[]): Record<Enforcement, number> {
  return { test: countBy(sections, 'test'), review: countBy(sections, 'review'), brief: countBy(sections, 'brief') }
}

export function harnessTabLabel(sections: readonly HarnessSection[]): string {
  const counts = harnessCounts(sections)
  return `Harness · ${counts.test} tested / ${counts.review} review / ${counts.brief} brief`
}
