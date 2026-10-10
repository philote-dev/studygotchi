import { describe, expect, it } from "vitest";
import type { BgmTrack } from "@/lib/audio/catalog";
import {
  INITIAL_CHROME_STATE,
  PILL_STORAGE_KEY,
  chipLine,
  chromeReducer,
  parsePillPreference,
  pillPreference,
  readPillPreference,
  writePillPreference,
  type ChromeAction,
  type ChromeState,
  type PillStorage,
} from "./audio-chrome-state";

const track = { id: "t", title: "Drift", artist: "Nia", credit: "", source: "", license: "CC BY" } as unknown as BgmTrack;

function run(actions: ChromeAction[], from: ChromeState = INITIAL_CHROME_STATE): ChromeState {
  return actions.reduce(chromeReducer, from);
}

function memoryStorage(seed: Record<string, string> = {}): PillStorage & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("chromeReducer", () => {
  it("starts tucked away with nothing open", () => {
    expect(INITIAL_CHROME_STATE).toEqual({ expanded: false, open: false, hot: false });
  });

  it("pops out on the ♪ button and tucks back in on the next press", () => {
    const out = run([{ type: "toggle-pill" }]);
    expect(out.expanded).toBe(true);
    expect(run([{ type: "toggle-pill" }], out).expanded).toBe(false);
  });

  it("collapsing also closes the panel and drops the hover actions", () => {
    const busy = run([{ type: "toggle-pill" }, { type: "toggle-panel" }, { type: "hot", hot: true }]);
    expect(busy).toEqual({ expanded: true, open: true, hot: true });
    expect(run([{ type: "collapse" }], busy)).toEqual(INITIAL_CHROME_STATE);
    expect(run([{ type: "toggle-pill" }], busy)).toEqual(INITIAL_CHROME_STATE);
  });

  it("collapse on an already tucked pill returns the same state object", () => {
    expect(chromeReducer(INITIAL_CHROME_STATE, { type: "collapse" })).toBe(INITIAL_CHROME_STATE);
  });

  it("hover actions can only be hot while the pill is out", () => {
    expect(run([{ type: "hot", hot: true }]).hot).toBe(false);
    const out = run([{ type: "toggle-pill" }, { type: "hot", hot: true }]);
    expect(out.hot).toBe(true);
    expect(run([{ type: "hot", hot: false }], out).hot).toBe(false);
  });

  it("the panel toggles without touching the pill", () => {
    const out = run([{ type: "toggle-pill" }, { type: "toggle-panel" }]);
    expect(out).toEqual({ expanded: true, open: true, hot: false });
    expect(run([{ type: "close-panel" }], out)).toEqual({ expanded: true, open: false, hot: false });
    expect(chromeReducer(INITIAL_CHROME_STATE, { type: "close-panel" })).toBe(INITIAL_CHROME_STATE);
  });

  it("restores the remembered preference without disturbing the rest", () => {
    expect(run([{ type: "restore", preference: "expanded" }]).expanded).toBe(true);
    const out = run([{ type: "toggle-pill" }, { type: "toggle-panel" }]);
    expect(run([{ type: "restore", preference: "collapsed" }], out)).toEqual({ expanded: false, open: true, hot: false });
  });

  it("maps state back to the stored preference", () => {
    expect(pillPreference(INITIAL_CHROME_STATE)).toBe("collapsed");
    expect(pillPreference(run([{ type: "toggle-pill" }]))).toBe("expanded");
  });
});

describe("pill preference storage", () => {
  it("defaults to collapsed for anything but the exact expanded token", () => {
    expect(parsePillPreference("expanded")).toBe("expanded");
    expect(parsePillPreference("collapsed")).toBe("collapsed");
    expect(parsePillPreference("open")).toBe("collapsed");
    expect(parsePillPreference(null)).toBe("collapsed");
    expect(parsePillPreference(undefined)).toBe("collapsed");
  });

  it("round-trips through storage under sg.audio.pill", () => {
    const storage = memoryStorage();
    expect(readPillPreference(storage)).toBe("collapsed");
    writePillPreference(storage, "expanded");
    expect(storage.data[PILL_STORAGE_KEY]).toBe("expanded");
    expect(PILL_STORAGE_KEY).toBe("sg.audio.pill");
    expect(readPillPreference(storage)).toBe("expanded");
  });

  it("treats a missing or throwing storage as collapsed and swallows write errors", () => {
    expect(readPillPreference(null)).toBe("collapsed");
    expect(readPillPreference(undefined)).toBe("collapsed");
    const hostile: PillStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readPillPreference(hostile)).toBe("collapsed");
    expect(() => writePillPreference(hostile, "expanded")).not.toThrow();
    expect(() => writePillPreference(null, "expanded")).not.toThrow();
  });
});

describe("chipLine", () => {
  it("names the track and artist once the music is on", () => {
    expect(chipLine(track, true, false)).toBe("Drift · Nia");
  });

  it("explains silence: locked, quiet, muted", () => {
    expect(chipLine(null, false, false)).toBe("Tap anywhere to start the music");
    expect(chipLine(null, true, false)).toBe("Quiet for now");
    expect(chipLine(track, true, true)).toBe("Muted · Drift");
    expect(chipLine(null, true, true)).toBe("Muted");
  });

  it("muted wins over locked", () => {
    expect(chipLine(null, false, true)).toBe("Muted");
  });
});
