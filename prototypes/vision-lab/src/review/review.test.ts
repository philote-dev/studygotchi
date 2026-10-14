import { describe, expect, it } from 'vitest'
import { LANDS, POSE_IDS } from '../lands'
import { HARNESS } from './harness'
import {
  ENFORCEMENTS,
  allShotUrls,
  countBy,
  decidedCount,
  harnessCounts,
  harnessTabLabel,
  isReviewView,
  liveUrl,
  modeFromSearch,
  parsePicks,
  poseFilterFromSearch,
  posesFor,
  reviewSearch,
  serialisePicks,
  setPick,
  shortName,
  shotUrl,
  summarisePicks,
  tabFromSearch,
} from './review'

describe('review page helpers', () => {
  it('names a shot the way publish-shots.mjs does', () => {
    expect(shotUrl('ice-town', 'a', 'hero', 'day')).toBe('/review/shots/ice-town-a-hero-day.png')
    expect(shotUrl('frontier-town', 'c', 'reverse', 'night')).toBe('/review/shots/frontier-town-c-reverse-night.png')
  })

  it('enumerates 144 distinct frames for six lands', () => {
    const urls = allShotUrls(LANDS)
    expect(urls).toHaveLength(6 * 3 * 4 * 2)
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls.every((url) => /^\/review\/shots\/[a-z-]+-[abc]-(hero|walk|overview|reverse)-(day|night)\.png$/.test(url))).toBe(true)
  })

  it('links into the live lab with the hero pose, the free camera and the night flag', () => {
    expect(liveUrl('ice-town', 'b', 'hero', false)).toBe('/?land=ice-town&dir=b&pose=hero')
    expect(liveUrl('ice-town', 'b', 'hero', true)).toBe('/?land=ice-town&dir=b&pose=hero&night=1')
    expect(liveUrl('coastal-ruins', 'c', 'free', false)).toBe('/?land=coastal-ruins&dir=c&pose=free')
  })

  it('expands the pose filter', () => {
    expect(posesFor('all')).toEqual(POSE_IDS)
    expect(posesFor('walk')).toEqual(['walk'])
  })

  it('routes on view=review and reads the tab, mode and pose filter back from the URL', () => {
    expect(isReviewView('?view=review')).toBe(true)
    expect(isReviewView('?view=review&tab=harness&night=1')).toBe(true)
    expect(isReviewView('?land=ice-town&dir=a')).toBe(false)
    expect(isReviewView('')).toBe(false)
    expect(tabFromSearch('?view=review&tab=harness')).toBe('harness')
    expect(tabFromSearch('?view=review&tab=bogus')).toBe('options')
    expect(modeFromSearch('?view=review&night=1')).toBe('night')
    expect(modeFromSearch('?view=review')).toBe('day')
    expect(poseFilterFromSearch('?view=review&pose=overview')).toBe('overview')
    expect(poseFilterFromSearch('?view=review&pose=free')).toBe('all')
  })

  it('round-trips the review URL and omits defaults', () => {
    expect(reviewSearch('options', 'day', 'all')).toBe('?view=review')
    const search = reviewSearch('harness', 'night', 'walk')
    expect(search).toBe('?view=review&tab=harness&night=1&pose=walk')
    expect(tabFromSearch(search)).toBe('harness')
    expect(modeFromSearch(search)).toBe('night')
    expect(poseFilterFromSearch(search)).toBe('walk')
  })

  it('gives every land a distinct one-word short name', () => {
    const names = LANDS.map(shortName)
    expect(names).toEqual(['Ice', 'Medieval', 'Coastal', 'Jungle', 'Nordic', 'Frontier'])
    expect(new Set(names).size).toBe(LANDS.length)
  })
})

describe('picks', () => {
  it('summarises in menu order with undecided lands named', () => {
    const summary = summarisePicks({ 'ice-town': 'b', 'coastal-ruins': 'a' }, LANDS)
    expect(summary).toBe('Ice: B · Medieval: undecided · Coastal: A · Jungle: undecided · Nordic: undecided · Frontier: undecided')
    expect(decidedCount({ 'ice-town': 'b', 'coastal-ruins': 'a' }, LANDS)).toBe(2)
    expect(decidedCount({}, LANDS)).toBe(0)
  })

  it('sets and clears a pick without mutating the previous record', () => {
    const start = { 'ice-town': 'a' } as const
    const picked = setPick(start, 'frontier-town', 'c')
    expect(picked).toEqual({ 'ice-town': 'a', 'frontier-town': 'c' })
    expect(start).toEqual({ 'ice-town': 'a' })
    expect(setPick(picked, 'ice-town', 'undecided')).toEqual({ 'frontier-town': 'c' })
  })

  it('survives a round trip through storage and drops garbage', () => {
    const picks = { 'ice-town': 'b', 'nordic-volcanic-highlands': 'c' } as const
    expect(parsePicks(serialisePicks(picks))).toEqual(picks)
    expect(parsePicks(null)).toEqual({})
    expect(parsePicks('')).toEqual({})
    expect(parsePicks('not json')).toEqual({})
    expect(parsePicks('[1,2]')).toEqual({})
    expect(parsePicks('{"mars":"a","ice-town":"z","coastal-ruins":"b","frontier-town":7}')).toEqual({ 'coastal-ruins': 'b' })
  })
})

describe('harness', () => {
  it('has unique section ids and a summary per section', () => {
    const ids = HARNESS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const section of HARNESS) {
      expect(section.title.trim().length, section.id).toBeGreaterThan(0)
      expect(section.summary.trim().length, section.id).toBeGreaterThan(0)
      expect(section.rules.length, section.id).toBeGreaterThan(0)
    }
  })

  it('gives every rule a statement, a source and a valid enforcement level', () => {
    for (const section of HARNESS) {
      for (const rule of section.rules) {
        expect(rule.rule.trim().length, `${section.id}: ${rule.rule}`).toBeGreaterThan(0)
        expect(rule.source.trim().length, `${section.id}: ${rule.rule}`).toBeGreaterThan(0)
        expect(ENFORCEMENTS, `${section.id}: ${rule.rule}`).toContain(rule.how)
      }
    }
  })

  it('counts rules per enforcement level and the counts add up', () => {
    const total = HARNESS.reduce((sum, section) => sum + section.rules.length, 0)
    const counts = harnessCounts(HARNESS)
    expect(counts.test + counts.review + counts.brief).toBe(total)
    expect(countBy(HARNESS, 'test')).toBe(counts.test)
    expect(countBy([{ id: 'x', title: 'x', summary: 'x', rules: [{ rule: 'r', how: 'review', source: 's' }] }], 'review')).toBe(1)
    expect(countBy([], 'brief')).toBe(0)
    expect(harnessTabLabel(HARNESS)).toBe(`Harness · ${counts.test} tested / ${counts.review} review / ${counts.brief} brief`)
  })
})
