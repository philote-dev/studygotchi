import { useCallback, useEffect, useState } from 'react'
import { DIRECTION_IDS, LANDS, type Direction, type DirectionId, type LandId, type LandVision, type PoseId } from '../lands'
import { HARNESS, type Enforcement, type HarnessRule, type HarnessSection } from './harness'
import {
  ENFORCEMENTS,
  MODES,
  PICKS_KEY,
  POSE_FILTERS,
  decidedCount,
  harnessCounts,
  harnessTabLabel,
  liveUrl,
  modeFromSearch,
  parsePicks,
  pickParts,
  poseFilterFromSearch,
  posesFor,
  reviewSearch,
  serialisePicks,
  setPick,
  shotName,
  shotUrl,
  tabFromSearch,
  type Mode,
  type Picks,
  type PoseFilter,
  type Tab,
} from './review'
import '../app.css'
import './review.css'

const LEGEND: Record<Enforcement, string> = {
  test: 'a vitest or Playwright check fails when the rule is broken',
  review: 'a human or agent review lens with a filed note; it catches, it does not block',
  brief: 'words in a brief, sheet or charter; followed by convention only',
}

const FRAME_COUNT = LANDS.length * 3 * 4 * 2

function readPicks(): Picks {
  try {
    return parsePicks(window.localStorage.getItem(PICKS_KEY))
  } catch {
    return {}
  }
}

function writePicks(picks: Picks) {
  try {
    window.localStorage.setItem(PICKS_KEY, serialisePicks(picks))
  } catch {
    // Storage can be unavailable (private mode, quota); the picks then live for the session only.
  }
}

/**
 * Review page: every direction of every land side by side (Options), and the harness we build
 * against (Harness). Mounted by main.tsx on `?view=review`.
 */
export function ReviewPage() {
  const [tab, setTab] = useState<Tab>(() => tabFromSearch(window.location.search))
  const [mode, setMode] = useState<Mode>(() => modeFromSearch(window.location.search))
  const [filter, setFilter] = useState<PoseFilter>(() => poseFilterFromSearch(window.location.search))
  const [picks, setPicks] = useState<Picks>(readPicks)

  useEffect(() => {
    window.history.replaceState(window.history.state, '', reviewSearch(tab, mode, filter) + window.location.hash)
  }, [tab, mode, filter])

  useEffect(() => {
    writePicks(picks)
  }, [picks])

  useEffect(() => {
    document.title = tab === 'options' ? 'StudyGotchi vision review · options' : 'StudyGotchi vision review · harness'
  }, [tab])

  const pick = useCallback((land: LandId, dir: DirectionId | 'undecided') => setPicks((current) => setPick(current, land, dir)), [])

  return (
    <main className="vision-lab review" data-tab={tab}>
      <header className="vision-header review-header">
        <div>
          <span className="kicker">StudyGotchi · vision lab · review</span>
          <h1>{tab === 'options' ? 'Every option, side by side' : 'The harness we build against'}</h1>
          <p className="story">
            {tab === 'options'
              ? `${LANDS.length} lands × 3 directions × 4 poses, day and night, from identical cameras. Pick one direction per land; picks stay in this browser.`
              : 'Every principle and check, with where it lives and how hard it is enforced. Tested rules fail a build; review rules file a note; brief rules are convention.'}
          </p>
        </div>
        <nav className="review-nav" aria-label="Review">
          <div className="segmented" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'options'} aria-controls="review-options" onClick={() => setTab('options')}>
              Options · {LANDS.length} lands / {FRAME_COUNT} frames
            </button>
            <button type="button" role="tab" aria-selected={tab === 'harness'} aria-controls="review-harness" onClick={() => setTab('harness')}>
              {harnessTabLabel(HARNESS)}
            </button>
          </div>
          <a className="back-link" href={mode === 'night' ? '/?night=1' : '/'}>
            ← back to the lab
          </a>
        </nav>
      </header>

      {tab === 'options' ? (
        <div id="review-options" role="tabpanel" className="review-panel">
          <OptionsTab mode={mode} filter={filter} picks={picks} onMode={setMode} onFilter={setFilter} onPick={pick} />
        </div>
      ) : (
        <div id="review-harness" role="tabpanel" className="review-panel">
          <HarnessTab />
        </div>
      )}
    </main>
  )
}

interface OptionsTabProps {
  mode: Mode
  filter: PoseFilter
  picks: Picks
  onMode: (mode: Mode) => void
  onFilter: (filter: PoseFilter) => void
  onPick: (land: LandId, dir: DirectionId | 'undecided') => void
}

function OptionsTab({ mode, filter, picks, onMode, onFilter, onPick }: OptionsTabProps) {
  const poses = posesFor(filter)
  const parts = pickParts(picks, LANDS)
  return (
    <>
      <div className="review-toolbar" data-mode={mode}>
        <div className="segmented" role="group" aria-label="Lighting">
          {MODES.map((entry) => (
            <button key={entry} type="button" aria-pressed={mode === entry} onClick={() => onMode(entry)}>
              {entry}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Pose">
          {POSE_FILTERS.map((entry) => (
            <button key={entry} type="button" aria-pressed={filter === entry} onClick={() => onFilter(entry)}>
              {entry}
            </button>
          ))}
        </div>
        <p className="picks-summary" aria-live="polite">
          <span className="kicker">
            Your picks · {decidedCount(picks, LANDS)}/{LANDS.length}
          </span>
          <span className="picks-line">
            {parts.map((part, index) => (
              <span key={part.id} className="picks-part" data-decided={part.decided}>
                {index > 0 ? ' · ' : ''}
                <a href={`#${part.id}`}>{part.label}</a>: <strong>{part.pick}</strong>
              </span>
            ))}
          </span>
        </p>
      </div>

      {LANDS.map((land, index) => (
        <LandSection key={land.id} land={land} index={index} mode={mode} poses={poses} pick={picks[land.id]} onPick={onPick} />
      ))}
    </>
  )
}

interface LandSectionProps {
  land: LandVision
  index: number
  mode: Mode
  poses: readonly PoseId[]
  pick: DirectionId | undefined
  onPick: (land: LandId, dir: DirectionId | 'undecided') => void
}

function LandSection({ land, index, mode, poses, pick, onPick }: LandSectionProps) {
  const options: (DirectionId | 'undecided')[] = [...DIRECTION_IDS, 'undecided']
  const current = pick ?? 'undecided'
  return (
    <section className="land" id={land.id} aria-labelledby={`${land.id}-title`}>
      <header className="land-header">
        <div>
          <span className="kicker">
            {index + 1} / {LANDS.length} · {land.id}
          </span>
          <h2 id={`${land.id}-title`}>{land.name}</h2>
          <p className="story">{land.story}</p>
        </div>
        <div className="pick" role="radiogroup" aria-label={`Your pick for ${land.name}`}>
          <span className="kicker">Your pick</span>
          {options.map((option) => (
            <label key={option} data-checked={current === option}>
              <input type="radio" name={`pick-${land.id}`} value={option} checked={current === option} onChange={() => onPick(land.id, option)} />
              <span>{option === 'undecided' ? 'undecided' : option.toUpperCase()}</span>
            </label>
          ))}
        </div>
      </header>
      <div className="directions">
        {land.directions.map((direction) => (
          <DirectionColumn key={direction.id} land={land} direction={direction} mode={mode} poses={poses} picked={pick === direction.id} />
        ))}
      </div>
    </section>
  )
}

interface DirectionColumnProps {
  land: LandVision
  direction: Direction
  mode: Mode
  poses: readonly PoseId[]
  picked: boolean
}

function DirectionColumn({ land, direction, mode, poses, picked }: DirectionColumnProps) {
  const night = mode === 'night'
  const letter = direction.id.toUpperCase()
  return (
    <article className="direction" data-picked={picked || undefined} aria-label={`${letter} · ${direction.name}`}>
      <h3>
        <span className="dir-id">{letter}</span>
        {direction.name}
      </h3>
      <p className="lineage">{direction.lineage}</p>
      <p className="pitch">{direction.pitch}</p>
      <details className="notes">
        <summary>
          {direction.strengths.length} strengths · {direction.risks.length} risks
        </summary>
        <h4>Strengths</h4>
        <ul>
          {direction.strengths.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <h4>Risks</h4>
        <ul>
          {direction.risks.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <div className="frames">
        {poses.map((pose) => {
          const url = shotUrl(land.id, direction.id, pose, mode)
          return (
            <figure className="frame" key={url}>
              <Shot src={url} name={shotName(land.id, direction.id, pose, mode)} alt={`${land.name} ${letter} · ${pose} · ${mode}`} />
              <figcaption>
                <span className="kicker">{pose}</span>
                <span className="kicker muted">
                  {letter} · {mode}
                </span>
              </figcaption>
            </figure>
          )
        })}
      </div>
      <p className="direction-links">
        <a href={liveUrl(land.id, direction.id, 'hero', night)}>open live →</a>
        <a href={liveUrl(land.id, direction.id, 'free', night)}>free camera →</a>
      </p>
    </article>
  )
}

/** A captured frame in a fixed 16:9 box; a missing capture shows a placeholder, never a broken icon. */
function Shot({ src, name, alt }: { src: string; name: string; alt: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) {
    return (
      <div className="shot shot-missing" role="img" aria-label={`${alt}: not captured`}>
        <span className="kicker">not captured</span>
        <code>{name}</code>
      </div>
    )
  }
  return (
    <a className="shot" href={src} target="_blank" rel="noreferrer" title="Open the full-size frame">
      <img src={src} alt={alt} width={1238} height={696} loading="lazy" decoding="async" onError={() => setMissing(true)} />
    </a>
  )
}

function HarnessTab() {
  const counts = harnessCounts(HARNESS)
  return (
    <>
      <div className="review-toolbar harness-legend" aria-label="Enforcement levels">
        {ENFORCEMENTS.map((how) => (
          <div className="legend-item" key={how}>
            <span className="tag" data-how={how}>
              {how}
            </span>
            <span>
              <strong>{counts[how]}</strong> · {LEGEND[how]}
            </span>
          </div>
        ))}
      </div>
      {HARNESS.map((section) => (
        <HarnessSectionView key={section.id} section={section} />
      ))}
    </>
  )
}

function HarnessSectionView({ section }: { section: HarnessSection }) {
  const counts = harnessCounts([section])
  return (
    <section className="harness-section" id={section.id} aria-labelledby={`${section.id}-title`}>
      <header>
        <span className="kicker">
          {section.id} · {section.rules.length} rules · {counts.test} tested / {counts.review} review / {counts.brief} brief
        </span>
        <h2 id={`${section.id}-title`}>{section.title}</h2>
        <p className="story">{section.summary}</p>
      </header>
      <ol className="rules">
        {section.rules.map((rule) => (
          <RuleRow key={rule.rule} rule={rule} />
        ))}
      </ol>
    </section>
  )
}

function RuleRow({ rule }: { rule: HarnessRule }) {
  return (
    <li className="rule" data-how={rule.how}>
      <span className="tag" data-how={rule.how}>
        {rule.how}
      </span>
      <p>{rule.rule}</p>
      <code className="source">{rule.source}</code>
    </li>
  )
}
