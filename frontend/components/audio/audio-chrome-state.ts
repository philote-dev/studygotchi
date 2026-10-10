import type { BgmTrack } from "@/lib/audio/catalog";

/** Where the pill remembers whether it was left popped out. Default collapsed. */
export const PILL_STORAGE_KEY = "sg.audio.pill";

export type PillPreference = "expanded" | "collapsed";

export function parsePillPreference(value: unknown): PillPreference {
  return value === "expanded" ? "expanded" : "collapsed";
}

/** Storage-shaped so the helpers can be exercised without a DOM. */
export interface PillStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `window.localStorage`, or null where merely touching it throws. */
export function browserStorage(): PillStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readPillPreference(storage: PillStorage | null | undefined): PillPreference {
  try {
    return parsePillPreference(storage?.getItem(PILL_STORAGE_KEY));
  } catch {
    return "collapsed";
  }
}

export function writePillPreference(storage: PillStorage | null | undefined, preference: PillPreference): void {
  try {
    storage?.setItem(PILL_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable in privacy-restricted browsing contexts; the in-memory choice still applies.
  }
}

/** The one line the pill shows: what is playing, or why nothing is. */
export function chipLine(track: BgmTrack | null, unlocked: boolean, muted: boolean): string {
  if (muted) return track ? `Muted · ${track.title}` : "Muted";
  if (!unlocked) return "Tap anywhere to start the music";
  if (!track) return "Quiet for now";
  return `${track.title} · ${track.artist}`;
}

export interface ChromeState {
  /** The pill is popped out to the left of the ♪ button. */
  expanded: boolean;
  /** The mixer + credits panel is open. */
  open: boolean;
  /** The pointer or keyboard focus is on the pill, so the mute / collapse actions show. */
  hot: boolean;
}

export type ChromeAction =
  | { type: "restore"; preference: PillPreference }
  | { type: "toggle-pill" }
  | { type: "collapse" }
  | { type: "toggle-panel" }
  | { type: "close-panel" }
  | { type: "hot"; hot: boolean };

export const INITIAL_CHROME_STATE: ChromeState = { expanded: false, open: false, hot: false };

export function chromeReducer(state: ChromeState, action: ChromeAction): ChromeState {
  switch (action.type) {
    case "restore":
      return { ...state, expanded: action.preference === "expanded" };
    case "toggle-pill":
      return state.expanded ? collapsed(state) : { ...state, expanded: true };
    case "collapse":
      return collapsed(state);
    case "toggle-panel":
      return { ...state, open: !state.open };
    case "close-panel":
      return state.open ? { ...state, open: false } : state;
    case "hot":
      // The actions live on the pill, so they cannot be hot while it is tucked away.
      return { ...state, hot: action.hot && state.expanded };
    default:
      return state;
  }
}

/** Tucking the pill away also closes the panel and drops the hover actions with it. */
function collapsed(state: ChromeState): ChromeState {
  return state.expanded || state.open || state.hot ? { expanded: false, open: false, hot: false } : state;
}

export function pillPreference(state: ChromeState): PillPreference {
  return state.expanded ? "expanded" : "collapsed";
}
