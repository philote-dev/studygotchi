/**
 * Copy captured frames into the lab's review gallery (`public/review/shots/`, gitignored).
 *
 *   node scripts/publish-shots.mjs /tmp/vision/ice-town /tmp/vision/medieval ...
 *
 * Only per-shot frames are published (`<land>-<dir>-<pose>-<mode>.png`); contact sheets stay
 * where the capture wrote them. Frames are checked for the full 16:9 stage so a cropped capture
 * from an older harness cannot sneak into the gallery.
 */
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FRAME = /^(?<land>[a-z-]+)-(?<dir>[abc])-(?<pose>hero|walk|overview|reverse)-(?<mode>day|night)\.png$/
const MIN_ASPECT = 1.7
const MAX_ASPECT = 1.85

export const SHOTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/review/shots')

/** Reads width/height from a PNG header (IHDR is always the first chunk). */
function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export async function publishShots(sourceDir, dest = SHOTS_DIR) {
  await mkdir(dest, { recursive: true })
  const published = []
  const skipped = []
  for (const name of await readdir(sourceDir)) {
    if (!FRAME.test(name)) continue
    const path = join(sourceDir, name)
    const size = pngSize(await readFile(path))
    const aspect = size ? size.width / size.height : 0
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
      skipped.push(`${name} (${size ? `${size.width}×${size.height}` : 'not a png'})`)
      continue
    }
    await copyFile(path, join(dest, name))
    published.push(name)
  }
  return { published, skipped }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const dirs = process.argv.slice(2)
  if (dirs.length === 0) {
    console.error('usage: node scripts/publish-shots.mjs <capture dir> [...]')
    process.exit(1)
  }
  for (const dir of dirs) {
    const { published, skipped } = await publishShots(resolve(dir))
    console.log(`${dir}: published ${published.length}` + (skipped.length ? `, skipped ${skipped.length} cropped/invalid: ${skipped.join(', ')}` : ''))
  }
}
