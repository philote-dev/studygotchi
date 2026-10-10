/**
 * Edge lab capture harness: every technique from the same fixed camera poses, day and night.
 *
 *   node tools/edge-lab/capture.mjs                         # all techniques + baseline, all poses
 *   node tools/edge-lab/capture.mjs --edge sea,cloudsea      # a subset (use `none` for the baseline)
 *   node tools/edge-lab/capture.mjs --poses south-out,zoom-max
 *   node tools/edge-lab/capture.mjs --out /tmp/edge-shots    # default
 *
 * Needs the Next dev server (default http://localhost:3000) with the ice land at ?land=8.223.
 * Writes <edge>-<pose>-<day|night>.png per shot, then composes:
 *   pose-<pose>-<day|night>.png   one row per pose: baseline + six techniques side by side
 *   technique-<edge>.png          one sheet per technique: all poses, day over night
 * Resolves Playwright from prototypes/marker-lab so the frontend package stays untouched.
 */
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const { chromium } = createRequire(resolve(repo, 'prototypes/marker-lab/package.json'))('playwright')

const args = process.argv.slice(2)
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback
}
const list = (name, all) => {
  const raw = value(name, '')
  return raw ? raw.split(',').map((entry) => entry.trim()).filter(Boolean) : all
}

const baseUrl = process.env.EDGE_LAB_URL ?? 'http://localhost:3000'
const land = value('land', '8.223')
const output = resolve(value('out', '/tmp/edge-shots'))
const EDGES = ['none', 'endless', 'parallax', 'curvature', 'barriers', 'sea', 'cloudsea']
const POSES = ['overview', 'north-out', 'east-out', 'south-out', 'west-out', 'low-horizon', 'zoom-max']
const edges = list('edge', EDGES)
const poses = list('poses', POSES)
const modes = list('modes', ['day', 'night'])

for (const edge of edges) if (!EDGES.includes(edge)) throw new Error(`Unknown edge technique ${edge}`)
for (const pose of poses) if (!POSES.includes(pose)) throw new Error(`Unknown pose ${pose}`)

async function waitReady(page, timeout = 30_000) {
  await page.waitForFunction(() => document.documentElement.dataset.edgeReady === 'true', null, { timeout })
  // Let the pixel pass settle and any lazy GLBs land.
  await page.waitForTimeout(700)
}

async function setTheme(page, mode) {
  await page.evaluate((wanted) => {
    const radio = [...document.querySelectorAll('input[type=radio]')].find((input) => input.value === wanted)
    radio?.click()
  }, mode === 'night' ? 'dark' : 'light')
  await page.waitForTimeout(1600) // 1.2 s sky crossfade
}

async function setLab(page, edge, pose) {
  await page.evaluate(
    ({ edge, pose }) => {
      const url = new URL(window.location.href)
      url.searchParams.set('edge', edge)
      url.searchParams.set('pose', pose)
      window.history.replaceState(window.history.state, '', url)
      document.documentElement.dataset.edgeReady = 'false'
      window.dispatchEvent(new CustomEvent('ice-edge-lab'))
    },
    { edge, pose },
  )
}

/** Hide every DOM sibling on the path from the land mount up to <body>, plus the lab panel and dev tools. */
async function isolateCanvas(page, hidden) {
  await page.evaluate((hide) => {
    const mark = (element, on) => {
      if (on) element.setAttribute('data-edge-hidden', '1')
      else element.removeAttribute('data-edge-hidden')
    }
    const mount = document.querySelector('[data-land-mount="ice-town"]')
    if (!mount) return
    let node = mount
    while (node && node.parentElement && node !== document.body) {
      for (const sibling of node.parentElement.children) if (sibling !== node) mark(sibling, hide)
      node = node.parentElement
    }
    for (const element of document.querySelectorAll('[data-edge-lab-panel], nextjs-portal')) mark(element, hide)
    let style = document.getElementById('edge-capture-style')
    if (!style) {
      style = document.createElement('style')
      style.id = 'edge-capture-style'
      style.textContent = '[data-edge-hidden]{visibility:hidden !important}'
      document.head.appendChild(style)
    }
  }, hidden)
}

async function canvasShot(page, path) {
  await isolateCanvas(page, true)
  await page.waitForTimeout(80)
  const canvas = page.locator('[data-land-mount="ice-town"] canvas').first()
  await canvas.screenshot({ path })
  await isolateCanvas(page, false)
}

async function compose(page, title, rows, columns, cellWidth, file) {
  // rows: [{ label, cells: [{ label, file }] }]
  const html = [`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:16px;background:#e8e2f2;font:700 10px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#342d45}
    h1{margin:0 0 10px;font-size:12px}
    table{border-collapse:separate;border-spacing:8px}
    th{font-weight:800;text-align:left;vertical-align:bottom;max-width:${cellWidth}px}
    td{vertical-align:top}
    img{display:block;width:${cellWidth}px;border:1px solid rgba(52,45,69,.45);box-shadow:3px 3px 0 rgba(52,45,69,.22)}
    .row{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap}
  </style></head><body><h1>${title}</h1><table><thead><tr><th></th>`]
  for (const column of columns) html.push(`<th>${column}</th>`)
  html.push('</tr></thead><tbody>')
  for (const row of rows) {
    html.push(`<tr><th class="row">${row.label}</th>`)
    for (const cell of row.cells) {
      if (!cell) {
        html.push('<td></td>')
        continue
      }
      const png = await readFile(cell).catch(() => null)
      html.push(png ? `<td><img src="data:image/png;base64,${png.toString('base64')}"></td>` : '<td>missing</td>')
    }
    html.push('</tr>')
  }
  html.push('</tbody></table></body></html>')
  const htmlFile = file.replace(/\.png$/, '.html')
  await writeFile(htmlFile, html.join(''))
  await page.goto(`file://${htmlFile}`)
  await page.locator('body').screenshot({ path: file })
}

await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => console.error('page error:', error.message))

try {
  await page.goto(`${baseUrl}/earth?land=${encodeURIComponent(land)}&edge=${edges[0]}&pose=${poses[0]}`, { waitUntil: 'networkidle' })
  await waitReady(page, 60_000)
  for (const mode of modes) {
    await setTheme(page, mode)
    for (const edge of edges) {
      for (const pose of poses) {
        await setLab(page, edge, pose)
        await waitReady(page)
        await canvasShot(page, `${output}/${edge}-${pose}-${mode}.png`)
        console.log(`captured ${edge} ${pose} ${mode}`)
      }
    }
  }

  for (const pose of poses) {
    for (const mode of modes) {
      await compose(
        page,
        `${pose} · ${mode} · baseline + techniques`,
        [{ label: pose, cells: edges.map((edge) => `${output}/${edge}-${pose}-${mode}.png`) }],
        edges,
        360,
        `${output}/pose-${pose}-${mode}.png`,
      )
    }
  }
  for (const edge of edges) {
    await compose(
      page,
      `${edge} · all poses`,
      modes.map((mode) => ({ label: mode, cells: poses.map((pose) => `${output}/${edge}-${pose}-${mode}.png`) })),
      poses,
      300,
      `${output}/technique-${edge}.png`,
    )
  }
  console.log(`composed sheets for ${edges.length} technique(s) × ${poses.length} pose(s) in ${output}`)
} finally {
  await browser.close()
}
