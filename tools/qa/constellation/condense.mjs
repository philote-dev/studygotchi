/**
 * T-4 condensation captures of the twin: stills at fixed `condense` values, one
 * `enter` still, and a short video of condense 0 -> 1 -> 0 driven every frame.
 *
 *   node tools/qa/constellation/condense.mjs [--out /tmp/stage-t4] [--theme dark] [--steps 0,0.25,0.5,0.75,1] [--enter 0.5] [--seconds 6]
 *
 * Loads /knowledge?qa=1 like capture.mjs (settled layout, fit camera, frozen
 * clock), then drives `window.__constellation.twin.setCondense / setEnter`. Stills are the
 * isolated `.sg-twin` element over the page background; the video is the full viewport.
 */
import { createRequire } from 'node:module'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FROZEN_MS, VIEWPORT } from './states.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const { chromium } = createRequire(resolve(repo, 'prototypes/marker-lab/package.json'))('playwright')

const args = process.argv.slice(2)
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const baseUrl = value('url', process.env.CONSTELLATION_URL ?? 'http://localhost:3000')
const out = resolve(value('out', '/tmp/stage-t4'))
const theme = value('theme', 'dark')
const steps = value('steps', '0,0.25,0.5,0.75,1').split(',').map(Number)
const enter = Number(value('enter', '0.5'))
const seconds = Number(value('seconds', '6'))

async function twoFrames(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))))
}

async function isolate(page, hide) {
  await page.evaluate((hide) => {
    const root = document.querySelector('.sg-twin')
    let node = root
    while (node && node.parentElement && node !== document.body) {
      for (const sibling of node.parentElement.children) if (sibling !== node) sibling.toggleAttribute('data-parity-hidden', hide)
      node = node.parentElement
    }
    for (const element of document.querySelectorAll('nextjs-portal, [data-nextjs-toast]')) element.toggleAttribute('data-parity-hidden', hide)
    if (!document.getElementById('parity-capture-style')) {
      const style = document.createElement('style')
      style.id = 'parity-capture-style'
      style.textContent = '[data-parity-hidden]{visibility:hidden !important}'
      document.head.appendChild(style)
    }
  }, hide)
}

async function open(context) {
  const page = await context.newPage()
  page.on('pageerror', (error) => console.error('page error:', error.message))
  await page.goto(`${baseUrl}/knowledge?qa=1`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__constellation?.renderer === 'twin', null, { timeout: 60_000 })
  await page.waitForSelector('.sg-twin[data-ready="1"]', { timeout: 60_000 })
  await page.evaluate(() => window.__constellation.whenQuiet(3000))
  await page.evaluate(() => window.__constellation.relayout())
  await page.waitForFunction(() => window.__constellation.settled(), null, { timeout: 15_000 })
  await page.evaluate(() => window.__constellation.whenSettled(1500))
  await page.evaluate(async () => {
    const css = getComputedStyle(document.documentElement)
    for (const face of [css.getPropertyValue('--font-display'), css.getPropertyValue('--font-ui')]) for (const w of [500, 600, 700]) await document.fonts.load(`${w} 13px ${face.trim()}`).catch(() => {})
    await document.fonts.ready
  })
  await page.waitForTimeout(1400)
  await page.evaluate((frozen) => {
    window.__constellation.freezeTime(frozen)
    window.__constellation.fit(0)
  }, FROZEN_MS)
  await twoFrames(page)
  return page
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--font-render-hinting=none', '--disable-lcd-text'] })
try {
  // Stills
  {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: theme })
    await context.addInitScript((wanted) => localStorage.setItem('studygotchi:space-theme', wanted), theme)
    const page = await open(context)
    const info = await page.evaluate(() => window.__constellation.twin.getCondense())
    console.log(`anchor ${info.anchor.x.toFixed(1)},${info.anchor.y.toFixed(1)} radius ${info.anchor.radius.toFixed(1)} px`)
    for (const t of steps) {
      await page.evaluate((t) => window.__constellation.twin.setCondense(t), t)
      await twoFrames(page)
      await isolate(page, true)
      await twoFrames(page)
      const file = join(out, `condense-${String(t).replace('.', '_')}-${theme}.png`)
      await page.locator('.sg-twin').screenshot({ path: file, animations: 'disabled' })
      await isolate(page, false)
      console.log(`wrote ${file}`)
    }
    await page.evaluate(() => window.__constellation.twin.setCondense(0))
    await page.evaluate((e) => window.__constellation.twin.setEnter(e), enter)
    await twoFrames(page)
    await isolate(page, true)
    await twoFrames(page)
    const enterFile = join(out, `enter-${String(enter).replace('.', '_')}-${theme}.png`)
    await page.locator('.sg-twin').screenshot({ path: enterFile, animations: 'disabled' })
    console.log(`wrote ${enterFile}`)
    await context.close()
  }
  // Video: condense 0 -> 1 -> 0 over `seconds`, smoothstep in time, set every frame.
  {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: theme, recordVideo: { dir: out, size: VIEWPORT } })
    await context.addInitScript((wanted) => localStorage.setItem('studygotchi:space-theme', wanted), theme)
    const page = await open(context)
    await page.evaluate(
      ({ seconds }) =>
        new Promise((done) => {
          const api = window.__constellation
          const t0 = performance.now()
          const step = (now) => {
            const u = Math.min(1, (now - t0) / (seconds * 1000))
            const tri = u < 0.5 ? u * 2 : 2 - u * 2
            const s = tri * tri * (3 - 2 * tri)
            api.twin.setCondense(s)
            if (u < 1) requestAnimationFrame(step)
            else done(undefined)
          }
          requestAnimationFrame(step)
        }),
      { seconds },
    )
    await page.waitForTimeout(300)
    const video = page.video()
    await context.close()
    const path = await video.path()
    const target = join(out, `condense-0-1-0-${seconds}s-${theme}.webm`)
    await rename(path, target)
    console.log(`wrote ${target}`)
  }
} finally {
  await browser.close()
}
console.log((await readdir(out)).join('\n'))
