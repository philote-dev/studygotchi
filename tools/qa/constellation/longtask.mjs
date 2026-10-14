/**
 * Main-thread long tasks while /knowledge mounts (T-4b readout).
 *
 *   node tools/qa/constellation/longtask.mjs [--url http://localhost:3000] [--runs 3]
 *
 * Two scenarios (the twin is the one renderer since gate 2, 2026-10-13; the 2D canvas's
 * synchronous settle went with it):
 *   twin-cold   fresh browser context (empty sessionStorage): the layout settles in the Worker
 *   twin-warm   second load in the same context: positions come from the sessionStorage cache
 *
 * Reports the longest `longtask` entry (ms), the count of tasks over 50 ms and the sum, from a
 * PerformanceObserver installed before any script runs, between navigation and the settled layout.
 * Playwright from prototypes/marker-lab, like capture.mjs. Dependency-free otherwise.
 */
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const { chromium } = createRequire(resolve(repo, 'prototypes/marker-lab/package.json'))('playwright')

const args = process.argv.slice(2)
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const baseUrl = value('url', process.env.CONSTELLATION_URL ?? 'http://localhost:3000')
const runs = Number(value('runs', '3'))
/** --gpu: the real GPU through the new headless mode (no window; WebGL shader compiles are main-thread tasks too; under SwiftShader they dominate). */
const gpu = args.includes('--gpu')

const OBSERVER = `
  window.__longtasks = [];
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longtasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
  } catch {}
`

async function measure(page) {
  await page.evaluate(() => { window.__longtasks = [] }).catch(() => {})
  await page.goto(`${baseUrl}/knowledge?qa=1`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(window.__constellation), null, { timeout: 60_000 })
  await page.waitForFunction(() => window.__constellation.settled() && window.__constellation.getLayout().nodes.length > 0, null, { timeout: 60_000 })
  await page.waitForTimeout(1500)
  return page.evaluate(() => {
    const tasks = window.__longtasks ?? []
    const longest = tasks.reduce((m, t) => Math.max(m, t.duration), 0)
    const history = window.__constellationBridge?.layouts.history ?? []
    const settles = history.map((h) => `${h.path}${h.path === 'sync' ? ` ${h.ms.toFixed(0)}ms` : h.workerMs !== undefined ? ` (worker ${h.workerMs}ms)` : ''}`)
    return { longest, count: tasks.length, total: tasks.reduce((s, t) => s + t.duration, 0), renderer: window.__constellation.renderer, settles }
  })
}

const browser = await chromium.launch(
  gpu
    ? { channel: 'chromium', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] }
    : { headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
)
const rows = []
try {
  for (let run = 1; run <= runs; run += 1) {
    const contextTwin = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await contextTwin.addInitScript(OBSERVER)
    const pageTwin = await contextTwin.newPage()
    rows.push({ run, scenario: 'twin-cold', ...(await measure(pageTwin)) })
    rows.push({ run, scenario: 'twin-warm', ...(await measure(pageTwin)) })
    await contextTwin.close()
  }
} finally {
  await browser.close()
}

const byScenario = new Map()
for (const row of rows) (byScenario.get(row.scenario) ?? byScenario.set(row.scenario, []).get(row.scenario)).push(row)
console.log(`gl: ${gpu ? 'real GPU (headless, Metal)' : 'SwiftShader (headless)'}`)
console.log('scenario    renderer  longest(ms) median-of-runs   tasks>50ms (per run)   total(ms)        settle path (first run)')
for (const [scenario, list] of byScenario) {
  const longest = list.map((r) => r.longest).sort((a, b) => a - b)
  const median = longest[Math.floor(longest.length / 2)]
  console.log(`${scenario.padEnd(11)} ${list[0].renderer.padEnd(9)} ${median.toFixed(0).padStart(11)}   ${longest.map((l) => l.toFixed(0)).join(' / ').padEnd(16)} ${list.map((r) => r.count).join(' / ').padEnd(22)} ${list.map((r) => r.total.toFixed(0)).join(' / ').padEnd(16)} ${list[0].settles.join(', ')}`)
}
