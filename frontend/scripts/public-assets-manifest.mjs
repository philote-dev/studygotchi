/**
 * What the deployed site serves under /assets. The repo's assets tree is ~410 MB; the app
 * loads about 80 MB of it. This is the allow-list the build script copies, and the test in
 * lib/public-assets-manifest.test.ts checks it against the audio catalog and the roster.
 *
 * Plain .mjs (no TypeScript) so `node scripts/dereference-public-assets.mjs` runs anywhere.
 */

/** Music beds the app can actually play: lib/audio/catalog.ts `usedBgmTracks()`. */
export const PUBLIC_ASSET_TRACKS = [
  "cutie-pie",
  "information-astral-bossa",
  "ukulele-forest-loop",
  "cozy-puzzle-1",
  "snow-globe",
  "lobby-time",
  "bassa-island",
  "wallpaper",
  "sleepy",
  "forest-ambience",
];

/** Whole folders that ship as-is (all small). */
const KEEP_DIRS = [
  "audio/sfx",
  "audio/voices",
  "creatures/cc0/gobkit",
  "creatures/cc0/kenney-cube-pets",
  "creatures/cc0/polypizza",
  "creatures/tripo-cleaned/textured",
];

/** Single files that ship. */
const KEEP_FILES = new Set([
  "audio/manifest.js",
  "audio/music/CREDITS.md",
  "audio/music/catalog.json",
  "audio/music/manifest.js",
  "creatures/animated/manifest.json",
  "creatures/cc0/LEDGER.md",
  "creatures/tripo-cleaned/LEDGER.md",
  "creatures/tripo-cleaned/index.json",
]);

const TRACK_FILE = /^audio\/music\/tracks\/([^/]+)\.mp3$/;
/** Rigged creature models at the top of creatures/animated only; `_input_snapshot` and `motion` stay home. */
const ANIMATED_GLB = /^creatures\/animated\/[^/]+\.glb$/;

/**
 * Decide whether one path (relative to the assets root, forward slashes) is served.
 * Directories return true when anything under them could be kept, so a copier can recurse.
 */
export function keepPublicAsset(relPath) {
  const p = relPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!p) return true;
  if (KEEP_FILES.has(p)) return true;
  if (KEEP_DIRS.some((dir) => p === dir || p.startsWith(`${dir}/`))) return true;
  const track = TRACK_FILE.exec(p);
  if (track) return PUBLIC_ASSET_TRACKS.includes(track[1]);
  if (ANIMATED_GLB.test(p)) return true;
  // Directories on the way to something kept (the dir itself, or an ancestor of one).
  const kept = [...KEEP_DIRS, ...KEEP_FILES, "audio/music/tracks", "creatures/animated"];
  return kept.some((path) => path === p || path.startsWith(`${p}/`));
}
