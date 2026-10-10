/**
 * Marker review capture harness.
 *
 *   node scripts/capture.mjs --markers ice-town,ink-world   # a subset
 *   node scripts/capture.mjs --all                          # every roster row
 *   node scripts/capture.mjs --all --sheet                  # + composed 96/48 px contact sheets
 *   node scripts/capture.mjs --all --out /tmp/marker-shots  # output directory (default)
 *
 * Needs the lab dev server (default http://127.0.0.1:5182). Writes, per marker:
 *   <id>-512-day.png, <id>-512-night.png   construction view
 *   <id>-96-day.png,  <id>-96-night.png    globe-scale read
 *   <id>-48-day.png,  <id>-48-night.png    far-zoom read
 *   <id>-sizes-day.png                     all three side by side
 * and, with --sheet, sheet-96-day.png, sheet-96-night.png, sheet-48-day.png.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback
}

const baseUrl = process.env.MARKER_LAB_URL ?? 'http://127.0.0.1:5182'
const output = resolve(value('out', '/tmp/marker-shots'))
const props = value('props', '4')
const creature = flag('creature') ? '1' : '0'

const ROSTER = [
  'ice-town',
  'ink-world',
  'celestial-garden',
  'heavy-industry',
  'future-utopia',
  'harbor-town',
  'academy-town',
  'wildwest',
  'volcanic',
  'egyptian-desert',
  'alpine',
  'swamp',
  'jungle',
  'forest',
  'city',
  'whimsical-land',
  'fractal-recursion',
]

const requested = flag('all') ? ROSTER : (value('markers', '') || 'ice-town').split(',').map((entry) => entry.trim()).filter(Boolean)
const unknown = requested.filter((id) => !ROSTER.includes(id))
if (unknown.length) {
  console.error(`Unknown marker id(s): ${unknown.join(', ')}`)
  process.exit(1)
}

async function readyPage(page, query, attempt = 0) {
  try {
    await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'networkidle' })
    await page.locator('html[data-render-ready="true"]').waitFor({ state: 'attached', timeout: 20_000 })
    await page.evaluate(() => document.fonts.ready)
    // Two extra animation frames so the pixel pass has settled after ready.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  } catch (error) {
    if (attempt >= 1) throw error
    // Another builder may have saved a half-written file; let Vite recover.
    await page.waitForTimeout(5_000)
    return readyPage(page, query, attempt + 1)
  }
}

async function captureCell(page, size, path) {
  await page.locator(`.marker-viewport-frame[data-marker-cell="${size}"]`).first().screenshot({ path })
}

async function captureMarker(page, id) {
  for (const night of [0, 1]) {
    const tod = night ? 'night' : 'day'
    await readyPage(page, `mode=review&marker=${id}&props=${props}&creature=${creature}&night=${night}`)
    await captureCell(page, 512, `${output}/${id}-512-${tod}.png`)
    await captureCell(page, 96, `${output}/${id}-96-${tod}.png`)
    await captureCell(page, 48, `${output}/${id}-48-${tod}.png`)
    if (!night) {
      await page.locator('.bouquet-review-grid').screenshot({ path: `${output}/${id}-review-day.png` })
    }
  }
  await readyPage(page, `mode=views&marker=${id}&props=${props}&creature=${creature}&night=0`)
  await page.locator('.size-views').screenshot({ path: `${output}/${id}-sizes-day.png` })
}

async function composeSheet(page, ids, size, tod) {
  const cells = await Promise.all(
    ids.map(async (id) => {
      const png = await readFile(`${output}/${id}-${size}-${tod}.png`)
      return `<figure><img src="data:image/png;base64,${png.toString('base64')}" width="${size}" height="${size}"><figcaption>${id}</figcaption></figure>`
    }),
  )
  const cell = size + 24
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:16px;background:#e8e2f2;font:700 9px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#342d45}
    main{display:grid;grid-template-columns:repeat(${size >= 96 ? 6 : 9},${cell}px);gap:14px}
    figure{margin:0;display:grid;gap:4px;justify-items:center}
    img{image-rendering:pixelated;border:1px solid rgba(52,45,69,.45);box-shadow:3px 3px 0 rgba(52,45,69,.22)}
    figcaption{max-width:${cell}px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    h1{margin:0 0 12px;font-size:11px}
  </style></head><body><h1>${ids.length} markers · ${size} px · ${tod}</h1><main>${cells.join('')}</main></body></html>`
  const file = `${output}/sheet-${size}-${tod}.html`
  await writeFile(file, html)
  await page.goto(`file://${file}`)
  await page.locator('body').screenshot({ path: `${output}/sheet-${size}-${tod}.png` })
}

await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
})

try {
  for (const id of requested) {
    await captureMarker(page, id)
    console.log(`captured ${id}`)
  }
  if (flag('sheet')) {
    await composeSheet(page, requested, 96, 'day')
    await composeSheet(page, requested, 96, 'night')
    await composeSheet(page, requested, 48, 'day')
    console.log(`composed contact sheets for ${requested.length} markers`)
  }
} finally {
  await browser.close()
}

console.log(`Captured ${requested.length} marker(s) to ${output}`)
