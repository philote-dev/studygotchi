"use client";

import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { ChevronRight, Volume2, VolumeX } from "lucide-react";
import { FULL_CREDITS_HREF, usedBgmTracks } from "@/lib/audio/catalog";
import { emit } from "@/lib/audio/events";
import { useAudio } from "./AudioProvider";
import {
  INITIAL_CHROME_STATE,
  browserStorage,
  chipLine,
  chromeReducer,
  readPillPreference,
  writePillPreference,
} from "./audio-chrome-state";
import type { Bus } from "@/lib/audio/runtime";

const BUSES: { bus: Bus; label: string; hint: string }[] = [
  { bus: "music", label: "Music", hint: "The bed under the world" },
  { bus: "sfx", label: "Sounds", hint: "Taps, sprouts, landings" },
  { bus: "voice", label: "Voices", hint: "Creatures saying their names" },
];

/** How long the mute / collapse actions linger after the pointer slips off the pill. */
const HOT_GRACE_MS = 250;

export function AudioChrome({ variant = "paper" }: { variant?: "paper" | "ink" }) {
  const { state, nowPlaying, setGain, toggleMuted, unlock } = useAudio();
  const [chrome, dispatch] = useReducer(chromeReducer, INITIAL_CHROME_STATE);
  const [restored, setRestored] = useState(false);
  const [booted, setBooted] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const hotTimer = useRef<number | null>(null);
  const titleId = useId();
  const pillId = useId();
  const credits = usedBgmTracks();
  const { expanded, open, hot } = chrome;

  // The server renders the pill tucked away; the remembered choice lands after hydration, and
  // transitions stay off until the frame after it has been painted so a restored pill does not
  // replay its pop-out on every load.
  useEffect(() => {
    dispatch({ type: "restore", preference: readPillPreference(browserStorage()) });
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setBooted(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [restored]);

  const clearHotTimer = useCallback(() => {
    if (hotTimer.current !== null) {
      window.clearTimeout(hotTimer.current);
      hotTimer.current = null;
    }
  }, []);

  const warm = useCallback(() => {
    clearHotTimer();
    dispatch({ type: "hot", hot: true });
  }, [clearHotTimer]);

  const cool = useCallback(() => {
    clearHotTimer();
    hotTimer.current = window.setTimeout(() => {
      hotTimer.current = null;
      dispatch({ type: "hot", hot: false });
    }, HOT_GRACE_MS);
  }, [clearHotTimer]);

  useEffect(() => clearHotTimer, [clearHotTimer]);

  const togglePill = useCallback(() => {
    emit({ type: "ui", kind: "tap" });
    void unlock();
    clearHotTimer();
    dispatch({ type: "toggle-pill" });
    writePillPreference(browserStorage(), expanded ? "collapsed" : "expanded");
  }, [clearHotTimer, expanded, unlock]);

  const collapse = useCallback(() => {
    emit({ type: "ui", kind: "tap" });
    clearHotTimer();
    dispatch({ type: "collapse" });
    writePillPreference(browserStorage(), "collapsed");
    // The actions disappear with the pill, so keyboard focus comes home to the ♪ button.
    toggle.current?.focus({ preventScroll: true });
  }, [clearHotTimer]);

  useEffect(() => {
    if (!open && !expanded) return;
    const onDoc = (event: MouseEvent) => {
      if (open && root.current && !root.current.contains(event.target as Node)) dispatch({ type: "close-panel" });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (open) {
        dispatch({ type: "close-panel" });
        return;
      }
      // Escape while the pill has focus tucks it away; elsewhere on the page it is not ours.
      if (expanded && root.current?.contains(document.activeElement)) collapse();
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, expanded, collapse]);

  const muted = state.muted;
  const line = chipLine(nowPlaying, state.unlocked, muted);

  return (
    <div
      ref={root}
      className={`audio-chrome audio-chrome--${variant}`}
      data-expanded={expanded ? "true" : "false"}
      data-hot={hot ? "true" : "false"}
      data-booted={booted ? "" : undefined}
    >
      <div className="audio-chrome-pop" inert={!expanded}>
        <div
          ref={pill}
          id={pillId}
          className="audio-chrome-pill"
          onPointerEnter={warm}
          onPointerLeave={cool}
          onFocus={warm}
          onBlur={(event) => {
            if (!pill.current?.contains(event.relatedTarget as Node | null)) cool();
          }}
        >
          <button
            type="button"
            className="audio-chrome-chip"
            aria-expanded={open}
            aria-controls={titleId}
            onClick={() => {
              emit({ type: "ui", kind: "tap" });
              void unlock();
              dispatch({ type: "toggle-panel" });
            }}
          >
            <span className="audio-chrome-mark" aria-hidden>
              ♪
            </span>
            <span className="audio-chrome-line">{line}</span>
          </button>

          <div className="audio-chrome-actions">
            <div className="audio-chrome-actions-row">
              <button
                type="button"
                className="audio-chrome-action audio-chrome-mute"
                aria-pressed={muted}
                aria-label={muted ? "Unmute" : "Mute"}
                title={muted ? "Unmute" : "Mute"}
                onClick={() => {
                  void unlock();
                  toggleMuted();
                }}
              >
                {muted ? (
                  <VolumeX size={13} strokeWidth={2.1} aria-hidden />
                ) : (
                  <Volume2 size={13} strokeWidth={2.1} aria-hidden />
                )}
              </button>
              <button
                type="button"
                className="audio-chrome-action audio-chrome-collapse"
                aria-label="Collapse music"
                title="Collapse"
                onClick={collapse}
              >
                <ChevronRight size={14} strokeWidth={2.1} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>

      <button
        ref={toggle}
        type="button"
        className="audio-chrome-toggle"
        aria-label="Music"
        aria-expanded={expanded}
        aria-controls={pillId}
        title={line}
        data-locked={state.unlocked ? undefined : "true"}
        data-muted={muted ? "true" : undefined}
        onClick={togglePill}
      >
        <span className="audio-chrome-mark" aria-hidden>
          ♪
        </span>
      </button>

      {open ? (
        <div className="audio-chrome-panel sg-enter" id={titleId} role="dialog" aria-label="Sound">
          <header className="audio-chrome-head">
            <p className="audio-chrome-kicker">Now playing</p>
            {nowPlaying ? (
              <p className="audio-chrome-credit">
                <a href={nowPlaying.source} target="_blank" rel="noreferrer">
                  {nowPlaying.credit}
                </a>
              </p>
            ) : (
              <p className="audio-chrome-credit">Nothing on the music bus yet. A tap on the world starts it.</p>
            )}
          </header>

          <ul className="audio-chrome-mix">
            {BUSES.map(({ bus, label, hint }) => (
              <li key={bus}>
                <label>
                  <span>
                    {label}
                    <small>{hint}</small>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={state.gains[bus]}
                    aria-valuetext={`${Math.round(state.gains[bus] * 100)} percent`}
                    onChange={(e) => setGain(bus, Number(e.target.value))}
                  />
                </label>
              </li>
            ))}
          </ul>

          <section className="audio-chrome-thanks" aria-label="Music credits">
            <h2>Thanks</h2>
            <ul>
              {credits.map((track) => (
                <li key={track.id}>
                  <a href={track.source} target="_blank" rel="noreferrer">
                    {track.title}
                  </a>
                  <span>
                    {track.artist} · {track.license}
                  </span>
                </li>
              ))}
            </ul>
            <a className="audio-chrome-full" href={FULL_CREDITS_HREF} target="_blank" rel="noreferrer">
              Full credits
            </a>
          </section>
        </div>
      ) : null}
    </div>
  );
}
