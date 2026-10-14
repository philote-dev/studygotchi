/**
 * Constellation regression report: pixel-diffs a candidate capture tree against the
 * twin's golden tree and writes an HTML sheet (golden | candidate | heat map | % differing).
 *
 *   node tools/qa/constellation/compare.mjs                   # tools/qa/out/constellation-twin/_run vs the golden tree
 *   node tools/qa/constellation/compare.mjs --candidate /tmp/x
 *   node tools/qa/constellation/compare.mjs --self            # golden run 1 vs run 2 (noise floor)
 *
 * Options
 *   --baseline <dir>        default tools/qa/out/constellation-twin (the golden twin captures)
 *   --candidate <dir>       the tree to judge (same layout: <course>/<theme>/<state>[@2x].png)
 *   --self                  candidate = <baseline>/_run2, report = <baseline>/_self/report.html
 *   --threshold 0.005       max share of differing pixels per image (0.5 %); exit 1 above it
 *   --pixel-threshold 0.1   pixelmatch colour threshold (0 = exact)
 *   --report <file>         default <candidate>/report.html; diff PNGs go to <report dir>/diff/
 *   --courses, --themes, --dpr, --states   comma lists to narrow the rows
 *   --include-page          also diff the *.page.png full-viewport shots (not deterministic: skipped by default)
 *
 * Exit code 1 when any row is above the threshold or missing in the candidate.
 * Dependency-free (png.mjs on zlib, diff.mjs).
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffImages } from './diff.mjs'
import { decodePng, encodePng } from './png.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(here, '..', '..', '..')
export const DEFAULT_BASELINE = join(REPO, 'tools', 'qa', 'out', 'constellation-twin')
export const DEFAULT_CANDIDATE = join(DEFAULT_BASELINE, '_run')

export function resolveSelf(baseline) {
  return { candidate: join(baseline, '_run2'), report: join(baseline, '_self', 'report.html') }
}

/** `<course>/<theme>/<state>[@2x].png` -> its parts; null for anything else. */
export function parseKey(rel) {
  const match = /^(?<course>[^/]+)\/(?<theme>[^/]+)\/(?<state>[^/@.]+)(?<scale>@2x)?(?<page>\.page)?\.png$/.exec(rel)
  if (!match) return null
  const { course, theme, state, scale, page } = match.groups
  return { course, theme, state, dpr: scale ? 2 : 1, page: Boolean(page) }
}

async function walkPngs(root, prefix = '') {
  const out = []
  let entries = []
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
      out.push(...(await walkPngs(root, rel)))
    } else if (entry.name.endsWith('.png') && !entry.name.endsWith('.diff.png')) out.push(rel)
  }
  return out.sort()
}

function percent(ratio) {
  return `${(ratio * 100).toFixed(2)} %`
}

async function readMeta(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

export async function compareTrees({
  baseline,
  candidate,
  threshold = 0.005,
  pixelThreshold = 0.1,
  report,
  includePage = false,
  only = {},
  log = () => {},
}) {
  if (!report) report = join(candidate, 'report.html')
  const reportDir = dirname(report)
  const rows = []
  for (const rel of await walkPngs(baseline)) {
    const key = parseKey(rel)
    if (!key) continue
    if (key.page && !includePage) continue
    if (only.courses?.length && !only.courses.includes(key.course)) continue
    if (only.themes?.length && !only.themes.includes(key.theme)) continue
    if (only.dpr?.length && !only.dpr.includes(key.dpr)) continue
    if (only.states?.length && !only.states.includes(key.state)) continue

    const baselinePath = join(baseline, rel)
    const candidatePath = join(candidate, rel)
    const diffPath = join(reportDir, 'diff', rel.replace(/\.png$/, '.diff.png'))
    const meta = await readMeta(baselinePath.replace(/(\.page)?\.png$/, '.json'))
    const row = { key: rel.replace(/\.png$/, ''), rel, ...key, baselinePath, candidatePath, diffPath, meta, ratio: 1, differing: 0, total: 0, pass: false, note: '' }
    let candidateBytes = null
    try {
      candidateBytes = await readFile(candidatePath)
    } catch {
      row.note = 'missing in candidate'
    }
    if (candidateBytes) {
      const a = decodePng(await readFile(baselinePath))
      const b = decodePng(candidateBytes)
      const result = diffImages(a, b, { threshold: pixelThreshold })
      row.ratio = result.ratio
      row.differing = result.differing
      row.total = result.total
      row.note = result.note ?? ''
      row.pass = result.ratio <= threshold
      await mkdir(dirname(diffPath), { recursive: true })
      await writeFile(diffPath, encodePng(result.diff))
    }
    rows.push(row)
    log(`${row.pass ? 'ok  ' : 'FAIL'} ${percent(row.ratio).padStart(9)} ${row.key}${row.note ? `  (${row.note})` : ''}`)
  }
  const worst = rows.reduce((max, row) => Math.max(max, row.ratio), 0)
  const mean = rows.length ? rows.reduce((sum, row) => sum + row.ratio, 0) / rows.length : 0
  const failed = rows.length === 0 || rows.some((row) => !row.pass)
  await mkdir(reportDir, { recursive: true })
  await writeFile(report, renderReport({ rows, baseline, candidate, threshold, pixelThreshold, worst, mean, failed, reportDir }))
  return { rows, worst, mean, failed, report }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function metaSummary(meta) {
  if (!meta) return ''
  const camera = meta.camera ? `camera x ${meta.camera.x.toFixed(2)} y ${meta.camera.y.toFixed(2)} k ${meta.camera.k.toFixed(4)}` : ''
  const bits = [camera]
  if (meta.hovered) bits.push(`hover ${meta.hovered}`)
  if (meta.selected) bits.push(`selected ${meta.selected}`)
  if (meta.routeIds?.length) bits.push(`route ${meta.routeIds.length} nodes`)
  if (meta.weakTraceIds?.length) bits.push(`weak traces ${meta.weakTraceIds.length}`)
  if (meta.ui?.lens) bits.push(`lens ${meta.ui.lens}`)
  if (meta.ui?.filesOpen) bits.push('files open')
  return bits.filter(Boolean).join(' · ')
}

export function renderReport({ rows, baseline, candidate, threshold, pixelThreshold, worst, mean, failed, reportDir }) {
  const rel = (path) => relative(reportDir, path).split('\\').join('/')
  const failing = rows.filter((row) => !row.pass).length
  const html = [`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Constellation parity</title><style>
  :root{color-scheme:light}
  body{margin:0;padding:20px 24px;background:#f1eef7;color:#241f33;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
  h1{margin:0 0 6px;font-size:16px;letter-spacing:.04em;text-transform:uppercase}
  .sum{display:flex;flex-wrap:wrap;gap:6px 22px;margin:0 0 18px;color:#4a4360}
  .sum b{color:#241f33}
  .verdict{display:inline-block;padding:2px 8px;border-radius:999px;font-weight:700}
  .pass{background:#d6f2dc;color:#145a2a}.fail{background:#f9d4d4;color:#8a1c1c}
  table{border-collapse:separate;border-spacing:0 10px;width:100%}
  th{text-align:left;font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6c6487;padding:0 8px}
  td{vertical-align:top;padding:0 8px;background:#fff;border-top:1px solid #e2dcee;border-bottom:1px solid #e2dcee}
  td:first-child{border-left:1px solid #e2dcee;border-radius:8px 0 0 8px;width:230px;padding:10px 12px}
  td:last-child{border-right:1px solid #e2dcee;border-radius:0 8px 8px 0}
  img{display:block;width:100%;max-width:460px;border:1px solid #cfc7df;background:#fff}
  .key{font-weight:700;word-break:break-all}
  .meta{margin-top:6px;color:#6c6487;font-size:11px;word-break:break-word}
  .ratio{font-size:20px;font-weight:700;margin:8px 0 2px}
  .note{color:#8a1c1c}
  a{color:inherit}
  </style></head><body>`]
  html.push(`<h1>Constellation parity ${failed ? '<span class="verdict fail">FAIL</span>' : '<span class="verdict pass">PASS</span>'}</h1>`)
  html.push(
    `<p class="sum"><span>baseline <b>${escapeHtml(rel(baseline))}</b></span><span>candidate <b>${escapeHtml(rel(candidate))}</b></span>` +
      `<span>threshold <b>${percent(threshold)}</b> per image</span><span>pixel threshold <b>${pixelThreshold}</b></span>` +
      `<span>rows <b>${rows.length}</b></span><span>failing <b>${failing}</b></span><span>worst <b>${percent(worst)}</b></span><span>mean <b>${percent(mean)}</b></span></p>`,
  )
  html.push('<table><thead><tr><th>state</th><th>baseline (2D)</th><th>candidate</th><th>diff (red = differs)</th></tr></thead><tbody>')
  for (const row of rows) {
    const cell = (path, alt) => (path ? `<a href="${escapeHtml(rel(path))}"><img loading="lazy" src="${escapeHtml(rel(path))}" alt="${escapeHtml(alt)}"></a>` : '<em>missing</em>')
    html.push(
      `<tr><td><div class="key">${escapeHtml(row.key)}</div>` +
        `<div class="ratio ${row.pass ? 'pass' : 'fail'}" style="background:none;display:block">${percent(row.ratio)}</div>` +
        `<div>${row.differing.toLocaleString('en-US')} / ${row.total.toLocaleString('en-US')} px · <span class="verdict ${row.pass ? 'pass' : 'fail'}">${row.pass ? 'pass' : 'FAIL'}</span></div>` +
        (row.note ? `<div class="note">${escapeHtml(row.note)}</div>` : '') +
        `<div class="meta">${escapeHtml(metaSummary(row.meta))}</div></td>` +
        `<td>${cell(row.baselinePath, 'baseline')}</td>` +
        `<td>${row.note === 'missing in candidate' ? '<em>missing</em>' : cell(row.candidatePath, 'candidate')}</td>` +
        `<td>${row.note === 'missing in candidate' ? '' : cell(row.diffPath, 'diff')}</td></tr>`,
    )
  }
  html.push('</tbody></table></body></html>')
  return html.join('\n')
}

function parseArgs(argv) {
  const flag = (name) => argv.includes(`--${name}`)
  const value = (name, fallback) => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
  }
  const list = (name) => {
    const raw = value(name, '')
    return raw ? raw.split(',').map((entry) => entry.trim()).filter(Boolean) : []
  }
  const baseline = resolve(value('baseline', DEFAULT_BASELINE))
  const self = flag('self')
  const selfPaths = resolveSelf(baseline)
  const candidateArg = value('candidate', self ? selfPaths.candidate : baseline === resolve(DEFAULT_BASELINE) ? DEFAULT_CANDIDATE : null)
  if (!candidateArg) throw new Error('compare.mjs needs --candidate <dir> or --self')
  return {
    baseline,
    candidate: resolve(candidateArg),
    report: resolve(value('report', self ? selfPaths.report : join(resolve(candidateArg), 'report.html'))),
    threshold: Number(value('threshold', '0.005')),
    pixelThreshold: Number(value('pixel-threshold', '0.1')),
    includePage: flag('include-page'),
    only: { courses: list('courses'), themes: list('themes'), states: list('states'), dpr: list('dpr').map(Number) },
  }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }
  const result = await compareTrees({ ...options, log: (line) => console.log(line) })
  console.log(
    `\n${result.rows.length} image(s), worst ${percent(result.worst)}, mean ${percent(result.mean)}, threshold ${percent(options.threshold)} -> ${result.failed ? 'FAIL' : 'PASS'}`,
  )
  console.log(`report: ${relative(process.cwd(), result.report)}`)
  process.exit(result.failed ? 1 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
