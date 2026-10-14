/**
 * Constellation self-regression capture: every state of `/knowledge` in light and dark,
 * at dpr 1 and 2, driven through the development controller `window.__constellation`
 * (the WebGL twin's, frontend/components/stage/layers/constellation/twin-dev-api.ts, with
 * the layout owner's half on the bridge; lib/graph/parity/dev-api.ts is the contract).
 *
 * Since gate 2 (2026-10-13) the twin is the one constellation renderer: the captures it
 * was first measured against (the Canvas2D baseline, 0.00 % noise floor, worst twin diff
 * 0.40 %) are gone with that renderer, and the twin's own approved captures are the
 * golden snapshots in tools/qa/out/constellation-twin. A run writes a candidate tree
 * beside them and compare.mjs diffs the two.
 *
 *   node tools/qa/constellation/capture.mjs                         # candidate -> tools/qa/out/constellation-twin/_run
 *   node tools/qa/constellation/capture.mjs --golden                # regenerate the golden tree (an intended visual change)
 *   node tools/qa/constellation/capture.mjs --courses 8.223,6.1400 --themes dark --dpr 1 --states hover,route
 *   node tools/qa/constellation/capture.mjs --out /tmp/x --target .sg-twin --query condense=0
 *
 * Needs the Next dev server (default http://localhost:3000, override with --url or
 * CONSTELLATION_URL) in mock mode (NEXT_PUBLIC_USE_MOCK_DATA, the default), so the
 * fixture course graphs from demo-data/two-course-pipeline load without a backend.
 * Headless SwiftShader only (deterministic; the creative-tooling rule): no window opens.
 *
 * Writes, per course / theme: <state>.png (`.sg-twin`: the twin's canvas and DOM labels
 * alone over the page background: the regression target), <state>.page.png (full
 * viewport with the toolbar, docks, tooltip and panel, for humans; the backdrop is not
 * frozen so it is not diffed), <state>.json (getLayout(): camera, node positions, ids,
 * clusters, hovered / selected / route / weak ids, ui state). dpr 2 files carry an @2x
 * suffix. manifest.json summarises anchors and cameras per state.
 *
 * Playwright is resolved from prototypes/marker-lab like tools/edge-lab/capture.mjs.
 */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_COURSES, DPRS, FROZEN_MS, POP_PHASE, STATES, STATE_IDS, THEMES, VIEWPORT, stateStem } from './states.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const { chromium } = createRequire(resolve(repo, 'prototypes/marker-lab/package.json'))('playwright')

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

const baseUrl = value('url', process.env.CONSTELLATION_URL ?? 'http://localhost:3000')
export const GOLDEN = join(repo, 'tools/qa/out/constellation-twin')
/** `--golden` writes the golden tree itself; a plain run writes the candidate beside it. */
const golden = flag('golden')
const output = resolve(value('out', golden ? GOLDEN : join(GOLDEN, '_run')))
const courses = list('courses', DEFAULT_COURSES)
const themes = list('themes', THEMES)
const dprs = list('dpr', DPRS.map(String)).map(Number)
const stateIds = list('states', STATE_IDS)
/** The element that is screenshotted and whose ancestors' other children are hidden. */
const target = value('target', '.sg-twin')
/** Extra selectors that stay visible during the isolated shot (e.g. the twin's stage canvas and label layer). */
const keep = list('keep', [])
/** Extra query string appended to the page URL (e.g. `--query condense=0` to pin the T-4 curve explicitly). */
const extraQuery = value('query', '')

for (const id of stateIds) if (!STATE_IDS.includes(id)) throw new Error(`Unknown state ${id}; known: ${STATE_IDS.join(', ')}`)
for (const theme of themes) if (!THEMES.includes(theme)) throw new Error(`Unknown theme ${theme}`)
const states = STATES.filter((state) => stateIds.includes(state.id))

const SETTLE_TWEEN_MS = 700 // covers the 380 / 420 ms camera tweens and the 40 ms lens debounce

async function waitForAnimations(page, timeout = 2500) {
  await page
    .waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished' || animation.playState === 'idle'), null, { timeout })
    .catch(() => {})
}

function samePositions(a, b) {
  const byId = new Map(b.map((node) => [node.id, node]))
  return a.every((node) => {
    const other = byId.get(node.id)
    return other && Math.abs(other.x - node.x) < 1e-9 && Math.abs(other.y - node.y) < 1e-9
  })
}

async function twoFrames(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))))
}

/**
 * Hide every DOM sibling on the path from the target up to <body> (except `--keep` matches and their
 * containers): the constellation over the page background only. The target's own subtree stays.
 */
async function isolateCanvas(page, hidden) {
  await page.evaluate(
    ({ hide, target, keep }) => {
      const mark = (element, on) => {
        if (on) element.setAttribute('data-parity-hidden', '1')
        else element.removeAttribute('data-parity-hidden')
      }
      const kept = keep.flatMap((selector) => [...document.querySelectorAll(selector)])
      const spared = (element) => kept.some((k) => element === k || element.contains(k))
      const root = document.querySelector(target)
      if (!root) throw new Error(`capture target not found: ${target}`)
      let node = root
      while (node && node.parentElement && node !== document.body) {
        for (const sibling of node.parentElement.children) if (sibling !== node && !spared(sibling)) mark(sibling, hide)
        node = node.parentElement
      }
      for (const element of document.querySelectorAll('nextjs-portal, [data-nextjs-toast]')) mark(element, hide)
      if (!document.getElementById('parity-capture-style')) {
        const style = document.createElement('style')
        style.id = 'parity-capture-style'
        style.textContent = '[data-parity-hidden]{visibility:hidden !important}'
        document.head.appendChild(style)
      }
    },
    { hide: hidden, target, keep },
  )
}

async function openKnowledge(page, course) {
  await page.goto(`${baseUrl}/knowledge?qa=1${extraQuery ? `&${extraQuery}` : ''}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__constellation?.renderer === 'twin', null, { timeout: 60_000 })
  await waitForAnimations(page)
  await page.waitForTimeout(300)
  // The twin has drawn at least one frame from the layout and sized itself to the page's box.
  await page.waitForSelector('.sg-twin[data-ready="1"]', { timeout: 60_000 })
  await twoFrames(page)
  const size = await page.evaluate(() => window.__constellation.getLayout().size)
  if (size.w !== VIEWPORT.width || size.h !== VIEWPORT.height) throw new Error(`twin measured ${size.w}x${size.h}, expected ${VIEWPORT.width}x${VIEWPORT.height}`)
  const switched = await page.evaluate((code) => {
    const api = window.__constellation
    const current = api.getLayout().course
    if (current.code === code || current.id === code) return true
    return api.setCourse(code)
  }, course)
  if (!switched) throw new Error(`Course ${course} is not in the identity's course list`)
  // Data arrives asynchronously (seeded graph, mock graph, resources, identity, Clerk); wait until it
  // is quiet, then reseed + settle synchronously so the layout never depends on how far a reheat got.
  // A late arrival after relayout() starts another reheat (the fixture's duplicate link ids make
  // every rebuild take the syncLayout path): detect it by positions moving and relayout again.
  let snapshot = null
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.evaluate(() => window.__constellation.whenQuiet(3000))
    await page.evaluate(() => window.__constellation.relayout())
    // The fresh layout settles in the layout Worker (T-4b): wait for it to land before reading the
    // positions the settled snapshot is compared against.
    await page.waitForFunction(() => window.__constellation.settled(), null, { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(300)
    const fresh = await page.evaluate(() => window.__constellation.getLayout())
    snapshot = await page.evaluate(() => window.__constellation.whenSettled(2500))
    if (fresh.nodes.length === snapshot.nodes.length && samePositions(fresh.nodes, snapshot.nodes)) break
    console.log(`  ${course}: the layout moved after relayout (attempt ${attempt}); settling again`)
    snapshot = null
  }
  if (!snapshot) throw new Error(`${course}: the layout kept reheating after six attempts`)
  if (snapshot.course.code !== course && snapshot.course.id !== course) throw new Error(`Expected course ${course}, got ${snapshot.course.code}`)
  // The DOM labels only use fonts that are already loaded: make sure the label faces are.
  // Every state repaints under the frozen clock before its capture.
  await page.evaluate(async () => {
    const css = getComputedStyle(document.documentElement)
    const faces = [css.getPropertyValue('--font-display'), css.getPropertyValue('--font-ui')].map((face) => face.trim()).filter(Boolean)
    for (const face of faces) for (const weight of [500, 600, 700]) await document.fonts.load(`${weight} 13px ${face}`).catch(() => {})
    await document.fonts.ready
  })
  await waitForAnimations(page)
  await page.waitForTimeout(SETTLE_TWEEN_MS * 2) // the post-relayout fit(900) tween
  await page.evaluate((frozen) => window.__constellation.freezeTime(frozen), FROZEN_MS)
  return snapshot
}

async function resetState(page) {
  await page.evaluate(() => {
    const api = window.__constellation
    api.hover(null)
    api.select(null)
    api.setRouteArriving(false)
    api.toggleFiles(false)
    api.setLens('all')
  })
  await page.waitForTimeout(SETTLE_TWEEN_MS)
}

async function runSteps(page, steps, anchors) {
  for (const step of steps) {
    await page.evaluate(
      ({ step, anchors, popPhase }) => {
        const api = window.__constellation
        if (step.fit) api.fit(0)
        if (step.camera) {
          const id = anchors[step.camera.at]
          const node = api.getLayout().nodes.find((n) => n.id === id)
          if (!node) throw new Error(`anchor ${step.camera.at} (${id}) not in layout`)
          api.setCamera({ x: node.x, y: node.y, k: step.camera.k })
        }
        if (step.hover) {
          if (!api.hover(anchors[step.hover])) throw new Error(`hover anchor ${step.hover} missing`)
        }
        if (step.select) api.select(anchors[step.select])
        if (step.lens) api.setLens(step.lens)
        if (step.files !== undefined) api.toggleFiles(step.files)
        if (step.route) api.setRouteArriving(true, { route: anchors.route, arriving: anchors.arriving, phase: popPhase })
      },
      { step, anchors, popPhase: POP_PHASE },
    )
    // Lens and dock clicks schedule a fit tween; a later `fit` step then lands on the same camera.
    await page.waitForTimeout(SETTLE_TWEEN_MS)
  }
}

async function captureState(page, dir, stem, state, anchors, course, theme, dpr, settledNodes) {
  await resetState(page)
  await runSteps(page, state.steps, anchors)
  await waitForAnimations(page)
  await page.evaluate(() => window.__constellation.setCamera(window.__constellation.getCamera())) // one last repaint under the frozen clock
  await twoFrames(page)
  const check = await page.evaluate(() => ({ settled: window.__constellation.settled(), nodes: window.__constellation.getLayout().nodes }))
  if (!check.settled || !samePositions(settledNodes, check.nodes)) {
    throw new Error(`${course} ${theme} @${dpr}x ${state.id}: the layout moved since it settled (a late reheat); rerun`)
  }

  await isolateCanvas(page, true)
  await twoFrames(page)
  // The twin redraws from the controller's snapshot on its own frame loop; give it one more frame to upload.
  await twoFrames(page)
  await page.locator(target).first().screenshot({ path: join(dir, `${stem}.png`), animations: 'disabled', caret: 'hide' })
  await isolateCanvas(page, false)
  await twoFrames(page)
  await page.screenshot({ path: join(dir, `${stem}.page.png`), animations: 'disabled', caret: 'hide' })

  const layout = await page.evaluate(() => {
    const api = window.__constellation
    const pressed = (selector) => document.querySelector(selector)?.getAttribute('aria-pressed') === 'true'
    const lens = ['all', 'mine', 'weak'].find((id) => pressed(`button[data-lens="${id}"]`)) ?? null
    return { ...api.getLayout(), ui: { lens, filesOpen: pressed('button[data-dock="files"]'), tooltip: Boolean(document.querySelector('.sg-tooltip')) } }
  })
  const record = { state: state.id, title: state.title, steps: state.steps, course, theme, dpr, viewport: VIEWPORT, anchors, ...layout }
  await writeFile(join(dir, `${stem}.json`), JSON.stringify(record, null, 1))
  return record
}

await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--font-render-hinting=none', '--disable-lcd-text'],
})
const manifest = {
  version: 2,
  generatedAt: new Date().toISOString(),
  baseUrl,
  renderer: 'twin',
  golden,
  target,
  viewport: VIEWPORT,
  dprs,
  themes,
  frozenMs: FROZEN_MS,
  popPhase: POP_PHASE,
  states: states.map(({ id, title, steps }) => ({ id, title, steps })),
  courses: {},
}
const startedAt = Date.now()
try {
  for (const course of courses) {
    for (const dpr of dprs) {
      for (const theme of themes) {
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: dpr, colorScheme: theme, reducedMotion: 'no-preference' })
        await context.addInitScript((wanted) => {
          localStorage.setItem('studygotchi:space-theme', wanted)
        }, theme)
        const page = await context.newPage()
        page.on('pageerror', (error) => console.error(`page error (${course} ${theme} @${dpr}x):`, error.message))
        try {
          const snapshot = await openKnowledge(page, course)
          const anchors = await page.evaluate(() => window.__constellation.anchors())
          const dir = join(output, course, theme)
          await mkdir(dir, { recursive: true })
          const entry = (manifest.courses[course] ??= {
            id: snapshot.course.id,
            name: snapshot.course.name,
            graphHash: snapshot.graphHash,
            nodes: snapshot.nodes.length,
            links: snapshot.links.length,
            clusters: snapshot.clusters.map((cluster) => ({ id: cluster.id, label: cluster.label, count: cluster.count })),
            anchors,
            states: {},
          })
          for (const state of states) {
            const stem = stateStem(state.id, dpr)
            const record = await captureState(page, dir, stem, state, anchors, course, theme, dpr, snapshot.nodes)
            const summary = {
              camera: record.camera,
              labelLayer: record.labelLayer,
              hovered: record.hovered,
              selected: record.selected,
              routeIds: record.routeIds,
              arrivingIds: record.arrivingIds,
              weakTraceIds: record.weakTraceIds,
              lens: record.ui.lens,
              filesOpen: record.ui.filesOpen,
            }
            // Every theme and dpr must land on the same camera and ids; otherwise the baseline is not one layout.
            const previous = entry.states[state.id]
            if (previous && JSON.stringify(previous) !== JSON.stringify(summary)) {
              throw new Error(`${course} ${state.id}: ${theme} @${dpr}x differs from the first capture of this state\n${JSON.stringify(previous)}\n${JSON.stringify(summary)}`)
            }
            entry.states[state.id] = summary
            console.log(`captured ${course} ${theme} @${dpr}x ${state.id}  (k ${record.camera.k.toFixed(4)}, ${Math.round((Date.now() - startedAt) / 1000)} s)`)
          }
        } finally {
          await context.close()
        }
      }
    }
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 1))
  console.log(`wrote ${courses.length} course(s) × ${themes.length} theme(s) × ${dprs.length} dpr × ${states.length} state(s) to ${output} in ${Math.round((Date.now() - startedAt) / 1000)} s`)
} finally {
  await browser.close()
}
