/**
 * Vercel fails after `next build` when `public/assets` is a symlink to
 * `../../assets` (`Cannot copy '../../assets' to a subdirectory of itself`),
 * and the whole assets tree (~410 MB) is far past what we want to upload.
 * Put a real directory holding only the runtime files (public-assets-manifest.mjs,
 * ~80 MB) at public/assets before the build.
 *
 * Runs when VERCEL or FORCE_DEREF_ASSETS is set. The ship procedure runs it with
 * FORCE_DEREF_ASSETS=1 inside the git-archive export before `vercel --prod`, because
 * on Vercel itself `../../assets` does not exist.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keepPublicAsset } from "./public-assets-manifest.mjs";

const dest = resolve(dirname(fileURLToPath(import.meta.url)), "../public/assets");

function resolveSource() {
  try {
    if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
      return realpathSync(dest);
    }
  } catch {
    /* broken or missing symlink */
  }
  const candidates = [
    resolve(dirname(dest), "../../assets"),
    resolve(process.cwd(), "../assets"),
    resolve(process.cwd(), "assets"),
    "/vercel/assets",
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** Copy only the files the manifest allows, recursing into directories that may hold some. */
function materialize(source) {
  mkdirSync(dest, { recursive: true });
  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const from = join(dir, entry.name);
      const rel = relative(source, from).split("\\").join("/");
      if (!keepPublicAsset(rel)) continue;
      const stat = statSync(from); // follows symlinks inside the tree
      if (stat.isDirectory()) {
        walk(from);
        continue;
      }
      const to = join(dest, rel);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to, { dereference: true });
      files += 1;
      bytes += stat.size;
    }
  };
  walk(source);
  return { files, mb: (bytes / 1e6).toFixed(1) };
}

if (!process.env.VERCEL && !process.env.FORCE_DEREF_ASSETS) {
  console.log("skip public/assets dereference (not on Vercel)");
  process.exit(0);
}

const source = resolveSource();

if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
  unlinkSync(dest);
} else if (existsSync(dest) && !lstatSync(dest).isSymbolicLink()) {
  console.log("public/assets is already a real directory");
  process.exit(0);
}

if (!source) {
  mkdirSync(dest, { recursive: true });
  console.warn("Could not resolve assets source; left an empty public/assets directory");
  process.exit(0);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}

const { files, mb } = materialize(source);
console.log(`materialized public/assets from ${source}: ${files} files, ${mb} MB`);
