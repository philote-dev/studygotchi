import { describe, expect, it } from "vitest";
import { keepPublicAsset, PUBLIC_ASSET_TRACKS } from "../scripts/public-assets-manifest.mjs";
import { AUDIO_BASE, sfxFile, SFX_NAMES, usedBgmTracks, VOICE_SPECIES, voiceFile } from "./audio/catalog";

/** `/assets/foo/bar` → `foo/bar`, the path the build script sees under the assets tree. */
function rel(url: string): string {
  return url.replace(/^\/assets\//, "");
}

describe("public assets manifest (what Vercel serves under /assets)", () => {
  it("keeps every music bed the app can play, and nothing else from the 150 MB tracks folder", () => {
    for (const track of usedBgmTracks()) {
      expect(keepPublicAsset(rel(track.file)), track.id).toBe(true);
      expect(PUBLIC_ASSET_TRACKS).toContain(track.id);
    }
    expect(keepPublicAsset("audio/music/tracks/8bit-bossa.mp3")).toBe(false);
    expect(keepPublicAsset("audio/music/tracks/headscratcher.mp3")).toBe(false);
    expect(keepPublicAsset("audio/music/CREDITS.md")).toBe(true);
  });

  it("keeps every sound effect and every voice", () => {
    for (const name of SFX_NAMES) expect(keepPublicAsset(rel(sfxFile(name))), name).toBe(true);
    for (const species of VOICE_SPECIES) expect(keepPublicAsset(rel(voiceFile(species, "a"))), species).toBe(true);
    expect(keepPublicAsset(rel(`${AUDIO_BASE}/sfx/manifest.json`))).toBe(true);
  });

  it("keeps the creature models the roster and guest pack load, not the raw generation folders", () => {
    expect(keepPublicAsset("creatures/animated/bean-ice-1.glb")).toBe(true);
    expect(keepPublicAsset("creatures/animated/manifest.json")).toBe(true);
    expect(keepPublicAsset("creatures/cc0/kenney-cube-pets/animal-cat.glb")).toBe(true);
    expect(keepPublicAsset("creatures/cc0/gobkit/goblin.glb")).toBe(true);
    expect(keepPublicAsset("creatures/tripo-cleaned/textured/fox.glb")).toBe(true);
    expect(keepPublicAsset("creatures/animated/_input_snapshot/x.glb")).toBe(false);
    expect(keepPublicAsset("creatures/tripo/raw.glb")).toBe(false);
    expect(keepPublicAsset("creatures/generated/x.glb")).toBe(false);
    expect(keepPublicAsset("creatures/tripo-cleaned/handoff/notes.md")).toBe(false);
    expect(keepPublicAsset("creatures/cc0/contact-sheet.png")).toBe(false);
  });

  it("lets a copier recurse into every directory on the way to a kept file", () => {
    for (const dir of ["audio", "audio/music", "audio/music/tracks", "creatures", "creatures/animated", "creatures/cc0", "creatures/tripo-cleaned"]) {
      expect(keepPublicAsset(dir), dir).toBe(true);
    }
    expect(keepPublicAsset("creatures/tripo")).toBe(false);
    expect(keepPublicAsset("landmarks")).toBe(false);
  });

  it("drops design-only trees and the retired spiral (S5-3; the SVG export went on 2026-10-13)", () => {
    expect(keepPublicAsset("space/studygotchi-spiral.svg")).toBe(false);
    expect(keepPublicAsset("space")).toBe(false);
    expect(keepPublicAsset("landmarks/anything.glb")).toBe(false);
    expect(keepPublicAsset("growth/anything.png")).toBe(false);
    expect(keepPublicAsset("biomes/anything.json")).toBe(false);
    expect(keepPublicAsset("QA.md")).toBe(false);
  });
});
