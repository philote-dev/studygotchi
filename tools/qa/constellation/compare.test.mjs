import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { diffImages } from './diff.mjs'
import { compareTrees, resolveSelf } from './compare.mjs'
import { encodePng } from './png.mjs'

function solid(width, height, rgba) {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i += 1) data.set(rgba, i * 4)
  return { width, height, data }
}

function withBlock(image, x0, y0, w, h, rgba) {
  const copy = { ...image, data: new Uint8Array(image.data) }
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) copy.data.set(rgba, (y * image.width + x) * 4)
  return copy
}

const base = solid(100, 100, [20, 24, 40, 255])
const tenPercent = withBlock(base, 0, 0, 100, 10, [255, 240, 220, 255])

test('identical images differ by 0', () => {
  const result = diffImages(base, base)
  assert.equal(result.ratio, 0)
  assert.equal(result.differing, 0)
  assert.equal(result.total, 10_000)
})

test('a 10 % block changed reads as ratio 0.1 and paints the heat map', () => {
  const result = diffImages(base, tenPercent)
  assert.equal(result.differing, 1000)
  assert.ok(Math.abs(result.ratio - 0.1) < 1e-9)
  // Heat map: a changed pixel is red (brighter with distance), an unchanged one is a faint grey.
  assert.equal(result.diff.data[0], 255)
  assert.ok(result.diff.data[1] < 64 && result.diff.data[2] < 64)
  const quiet = (50 * 100 + 50) * 4
  assert.ok(result.diff.data[quiet] > 200 && result.diff.data[quiet] === result.diff.data[quiet + 1])
})

test('a sub-threshold tint does not count, a visible one does', () => {
  const tint = withBlock(base, 0, 0, 100, 10, [22, 26, 42, 255])
  assert.equal(diffImages(base, tint).differing, 0)
  assert.equal(diffImages(base, tint, { threshold: 0 }).differing, 1000)
})

test('a size mismatch is a total difference', () => {
  const result = diffImages(base, solid(50, 100, [20, 24, 40, 255]))
  assert.equal(result.ratio, 1)
  assert.match(result.note, /size/)
})

async function fixtureTrees() {
  const root = await mkdtemp(join(tmpdir(), 'parity-'))
  const baseline = join(root, 'baseline')
  const candidate = join(root, 'candidate')
  for (const dir of [baseline, candidate]) await mkdir(join(dir, '8.223', 'dark'), { recursive: true })
  await writeFile(join(baseline, '8.223', 'dark', 'zoomed-out.png'), encodePng(base))
  await writeFile(join(candidate, '8.223', 'dark', 'zoomed-out.png'), encodePng(base))
  await writeFile(join(baseline, '8.223', 'dark', 'hover.png'), encodePng(base))
  await writeFile(join(candidate, '8.223', 'dark', 'hover.png'), encodePng(tenPercent))
  await writeFile(join(baseline, '8.223', 'dark', 'zoomed-out.page.png'), encodePng(base))
  await writeFile(join(baseline, '8.223', 'dark', 'zoomed-out.json'), '{}')
  // A nested run folder must not be treated as a state.
  await mkdir(join(baseline, '_run2', '8.223', 'dark'), { recursive: true })
  await writeFile(join(baseline, '_run2', '8.223', 'dark', 'zoomed-out.png'), encodePng(base))
  return { root, baseline, candidate }
}

test('compareTrees walks the baseline, diffs every state and fails above the threshold', async () => {
  const { root, baseline, candidate } = await fixtureTrees()
  const report = join(root, 'report', 'report.html')
  const strict = await compareTrees({ baseline, candidate, threshold: 0.005, report })
  assert.deepEqual(strict.rows.map((row) => row.key).sort(), ['8.223/dark/hover', '8.223/dark/zoomed-out'])
  const hover = strict.rows.find((row) => row.key === '8.223/dark/hover')
  assert.ok(Math.abs(hover.ratio - 0.1) < 1e-9)
  assert.equal(hover.pass, false)
  assert.equal(strict.failed, true)
  assert.ok(Math.abs(strict.worst - 0.1) < 1e-9)
  const html = await readFile(report, 'utf8')
  assert.match(html, /8\.223\/dark\/hover/)
  assert.match(html, /10\.00/)
  assert.ok((await stat(join(root, 'report', 'diff', '8.223', 'dark', 'hover.diff.png'))).size > 0)

  const lenient = await compareTrees({ baseline, candidate, threshold: 0.1, report })
  assert.equal(lenient.failed, false)
})

test('a missing candidate image fails the row', async () => {
  const { root, baseline, candidate } = await fixtureTrees()
  await writeFile(join(baseline, '8.223', 'dark', 'selected.png'), encodePng(base))
  const result = await compareTrees({ baseline, candidate, threshold: 0.5, report: join(root, 'r.html') })
  const missing = result.rows.find((row) => row.key === '8.223/dark/selected')
  assert.equal(missing.pass, false)
  assert.match(missing.note, /missing/)
  assert.equal(result.failed, true)
})

test('--self points at the second run inside the baseline folder', () => {
  const resolved = resolveSelf('/x/constellation-2d')
  assert.equal(resolved.candidate, '/x/constellation-2d/_run2')
  assert.equal(resolved.report, '/x/constellation-2d/_self/report.html')
})
