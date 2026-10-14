/**
 * Vision lab capture: every direction of a land from the four cinematic poses, day and night,
 * plus a per-land comparison sheet (rows = poses, columns = A / B / C).
 *
 *   node scripts/capture.mjs --land ice-town            # one land
 *   node scripts/capture.mjs --all                      # every land
 *   node scripts/capture.mjs --land ice-town --dirs a,b --modes day
 *   node scripts/capture.mjs --out /tmp/vision-shots    # default
 *   node scripts/capture.mjs --all --publish            # also copy frames into public/review/shots
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { publishShots } from './publish-shots.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback
}
const list = (name, all) => {
  const raw = value(name, '')
  return raw ? raw.split(',').map((entry) => entry.trim()).filter(Boolean) : all
}

const baseUrl = process.env.VISION_LAB_URL ?? 'http://127.0.0.1:5183'
const output = resolve(value('out', '/tmp/vision-shots'))
const LANDS = ['ice-town', 'medieval-meadow-kingdom', 'coastal-ruins', 'jungle-forest-village', 'nordic-volcanic-highlands', 'frontier-town']
const POSES = ['hero', 'walk', 'overview', 'reverse']
const lands = flag('all') ? LANDS : [value('land', 'ice-town')]
const dirs = list('dirs', ['a', 'b', 'c'])
const poses = list('poses', POSES)
const modes = list('modes', ['day', 'night'])
for (const land of lands) if (!LANDS.includes(land)) throw new Error(`Unknown land ${land}`)

/** Readiness budget per pose; generous because the machine often runs many headless renderers at once. */
const READY_TIMEOUT_MS = Number(process.env.VISION_READY_TIMEOUT_MS ?? 120_000)

async function ready(page, query) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(`${baseUrl}/${query}`, { waitUntil: 'networkidle' })
      await page.locator('html[data-vision-ready="true"]').waitFor({ state: 'attached', timeout: READY_TIMEOUT_MS })
      await page.waitForTimeout(300)
      return
    } catch (error) {
      if (attempt >= 1) throw error
      console.warn(`retrying ${query}: ${error.message.split('\n')[0]}`)
    }
  }
}

/**
 * Screenshot by clip instead of `locator.screenshot()`: the locator form waits for the element to
 * be "stable" over two animation frames, which never settles when the render loop is starved.
 */
async function shoot(page, selector, path) {
  const box = await page.locator(selector).boundingBox({ timeout: READY_TIMEOUT_MS })
  if (!box) throw new Error(`${selector} has no bounding box`)
  // boundingBox() is viewport-relative; add the scroll offset so the clip is page-relative, and
  // take a full-page shot so a stage that extends below the fold is not cut by the viewport.
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
  const clip = {
    x: Math.round(box.x + scroll.x),
    y: Math.round(box.y + scroll.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  }
  await page.screenshot({ path, clip, fullPage: true, animations: 'disabled', caret: 'hide', timeout: READY_TIMEOUT_MS })
}

async function compose(page, land, mode) {
  const rows = []
  for (const pose of poses) {
    const cells = []
    for (const dir of dirs) {
      const png = await readFile(`${output}/${land}-${dir}-${pose}-${mode}.png`).catch(() => null)
      cells.push(png ? `<td><img src="data:image/png;base64,${png.toString('base64')}"></td>` : '<td>missing</td>')
    }
    rows.push(`<tr><th class="row">${pose}</th>${cells.join('')}</tr>`)
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:16px;background:#e8e2f2;font:700 10px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#342d45}
    h1{margin:0 0 10px;font-size:12px}
    table{border-collapse:separate;border-spacing:8px}
    th{text-align:left;vertical-align:bottom}
    img{display:block;width:420px;border:1px solid rgba(52,45,69,.45);box-shadow:3px 3px 0 rgba(52,45,69,.22)}
    .row{writing-mode:vertical-rl;transform:rotate(180deg)}
  </style></head><body><h1>${land} · ${mode} · directions ${dirs.join(' / ').toUpperCase()}</h1>
  <table><thead><tr><th></th>${dirs.map((dir) => `<th>${dir.toUpperCase()}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></body></html>`
  const file = `${output}/sheet-${land}-${mode}.html`
  await writeFile(file, html)
  await page.setViewportSize({ width: 140 + dirs.length * 436, height: 80 + poses.length * 266 })
  await page.goto(`file://${file}`)
  await shoot(page, 'table', `${output}/sheet-${land}-${mode}.png`)
  await page.setViewportSize({ width: 1280, height: 720 })
}

await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
page.on('pageerror', (error) => console.error('page error:', error.message))

try {
  for (const land of lands) {
    for (const mode of modes) {
      for (const dir of dirs) {
        for (const pose of poses) {
          await ready(page, `?land=${land}&dir=${dir}&pose=${pose}${mode === 'night' ? '&night=1' : ''}`)
          await shoot(page, '[data-vision-stage] canvas', `${output}/${land}-${dir}-${pose}-${mode}.png`)
          console.log(`captured ${land} ${dir} ${pose} ${mode}`)
        }
      }
      await compose(page, land, mode)
    }
  }
} finally {
  await browser.close()
}
console.log(`Captured ${lands.length} land(s) to ${output}`)
if (flag('publish')) {
  const { published, skipped } = await publishShots(output)
  console.log(`Published ${published.length} frame(s) to the review gallery` + (skipped.length ? `; skipped ${skipped.length}` : ''))
}
