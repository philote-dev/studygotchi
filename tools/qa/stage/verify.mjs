/**
 * Stage verification: the persistent stage canvas as the only globe path (S2-2, gate 1,
 * 2026-10-13) and, since gates 2-4 the same day, the only path for every hop, checked
 * headless against the dev server.
 *
 *   node tools/qa/stage/verify.mjs                     # everything -> tools/qa/out/stage
 *   node tools/qa/stage/verify.mjs --only grain,diff    # a subset: grain, diff, inert, interact, dive
 *   node tools/qa/stage/verify.mjs --baseline /tmp/stage-s2   # folder with earth-on-dark-rest.png (+ -reduced-rest, noise-*)
 *
 * Checks (each writes its PNGs and a line into report.json; exit 1 when one fails):
 *   grain     the PIXELATION GUARANTEE: on default /earth the globe region is 2x2-device-px
 *             block constant at dpr 1 (>= 99 %) and 4x4 at dpr 2 (>= 99 %); 4x crops of the
 *             limb are written for eyes. One WebGL canvas (the stage), no globe canvas of its own.
 *   diff      default /earth against the S2 preview capture (the `?stage=planet` run that was
 *             approved): differing-pixel % for the live page and for the reduced-motion page,
 *             next to the noise floor of two identical captures when the baseline folder has them.
 *   inert     every former stage flag (`?stage=planet`, `nosky`, `twin`, `nogalaxy`, `hop=0`,
 *             `world`, ...) changes nothing: same DOM shape, reduced-motion screenshots within
 *             the noise floor of the default (there is no flag system any more).
 *   interact  wheel on the globe, wait for the settle, click a landmark (hover scan), the flag
 *             panel follows and stays visible.
 *   dive      the Land button runs the cloud dive on the director (planet -> world: the land
 *             route at the press, the deck whole over every frame where the globe and the land
 *             pass overlap, a hold inside the deck only while the land is not ready, rest on
 *             the world with the land open and the stage still running), then "The planet"
 *             runs the rise back (the same invariant, the route following under the deck, rest
 *             on the planet with the flag back).
 *
 * Headless Playwright only (SwiftShader, deterministic; the creative-tooling rule): no window
 * ever opens. Playwright is resolved from prototypes/marker-lab like the other QA scripts.
 * Needs the Next dev server on http://localhost:3000 (--url / STAGE_URL to override); never
 * starts one.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { blockConstancy, brightBox, crop, diff, innerBox, readPng } from "./block-constancy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");
const { chromium } = createRequire(resolve(repo, "prototypes/marker-lab/package.json"))("playwright");

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const BASE = value("url", process.env.STAGE_URL ?? "http://localhost:3000");
const OUT = resolve(value("out", join(repo, "tools/qa/out/stage")));
const BASELINE = value("baseline", "/tmp/stage-s2");
const only = value("only", "grain,diff,inert,interact,dive").split(",");
const want = (s) => only.includes(s);
const VIEWPORT = { width: 1440, height: 900 };
const MIN_BLOCK_PCT = 99;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { generatedAt: new Date().toISOString(), base: BASE, checks: {} };
let failed = false;
function record(name, ok, data) {
  report.checks[name] = { ok, ...data };
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(data)}`);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--font-render-hinting=none", "--disable-lcd-text"],
});

async function open(path, { theme = "dark", dpr = 1, reduced = false, settle = 5000 } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: dpr, colorScheme: theme, reducedMotion: reduced ? "reduce" : "no-preference" });
  await context.addInitScript((t) => localStorage.setItem("studygotchi:space-theme", t), theme);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".course-globe-stage", { timeout: 30000 });
  await page.waitForSelector("html[data-stage-ready='true']", { timeout: 30000 });
  // Arrive (720 ms), terrain atlas, the settle onto the active course, the page slide-in.
  await sleep(settle);
  return { context, page, errors };
}

/** What the page is made of: one stage canvas, no globe canvas, the host, the flag. */
function shape(page) {
  return page.evaluate(() => {
    const host = document.querySelector(".course-globe-stage");
    const stage = document.querySelector(".sg-stage canvas");
    const r = host?.getBoundingClientRect();
    return {
      canvases: document.querySelectorAll("canvas").length,
      stageCanvases: document.querySelectorAll(".sg-stage canvas").length,
      globeCanvases: document.querySelectorAll(".course-globe-stage canvas").length,
      stageBacking: stage ? { w: stage.width, h: stage.height, cssW: stage.clientWidth, cssH: stage.clientHeight } : null,
      stageZ: getComputedStyle(document.querySelector(".sg-stage")).zIndex,
      host: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
      flag: document.querySelector(".landmark-flag h2")?.textContent ?? null,
      flagVisible: (() => {
        const el = document.querySelector(".landmark-flag");
        if (!el) return false;
        const s = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && parseFloat(s.opacity) > 0.5 && b.width > 0 && b.height > 0;
      })(),
      stageDisplay: getComputedStyle(document.querySelector(".sg-stage")).display,
      land: !!document.querySelector(".biome-land-stage"),
      landHost: document.querySelector("[data-land-mount]")?.getAttribute("data-stage") ?? null,
      hop: window.__stageHop ? { sample: window.__stageHop.sample(), flight: window.__stageHop.flight() } : null,
    };
  });
}

async function hostBox(page, dpr) {
  return page.evaluate((dpr) => {
    const r = document.querySelector(".course-globe-stage")?.getBoundingClientRect();
    return r ? { x: Math.round(r.x * dpr), y: Math.round(r.y * dpr), w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) } : null;
  }, dpr);
}

/** The globe's pixels: the bright box inside the host, measured on its middle half. */
function globeRegion(img, box) {
  const planet = brightBox(img, box);
  return { planet, inner: planet ? innerBox(planet) : box };
}

async function grain() {
  for (const dpr of [1, 2]) {
    const cell = 2 * dpr;
    const { context, page, errors } = await open("/earth", { dpr, reduced: true });
    const file = `${OUT}/earth-default-dark-dpr${dpr}.png`;
    await page.screenshot({ path: file });
    const s = await shape(page);
    const img = readPng(file);
    const box = await hostBox(page, dpr);
    const { planet, inner } = globeRegion(img, box);
    const bc = blockConstancy(img, inner, cell);
    const bcHalf = cell > 2 ? blockConstancy(img, inner, cell / 2) : null;
    // The limb at 4x: where a soft edge or an off-grid cell would show.
    const limb = planet ? { x: planet.x + planet.w - 48 * dpr, y: planet.y + (planet.h >> 1) - 24 * dpr, w: 48 * dpr, h: 48 * dpr } : inner;
    crop(img, limb, 4, `${OUT}/globe-limb-4x-dpr${dpr}.png`);
    const ok = bc.pct >= MIN_BLOCK_PCT && s.globeCanvases === 0 && s.stageCanvases === 1 && bc.nonBgBlocks > bc.blocks * 0.3;
    record(`grain-dpr${dpr}`, ok, { cell, blockPct: bc.pct, blocks: bc.blocks, nonBgBlocks: bc.nonBgBlocks, halfCellPct: bcHalf?.pct ?? null, planet, inner, shape: s, errors: errors.slice(0, 4) });
    await context.close();
  }
}

async function diffAgainstBaseline() {
  const live = `${OUT}/earth-default-dark-dpr1-live.png`;
  const reduced = `${OUT}/earth-default-dark-dpr1-reduced.png`;
  {
    const { context, page } = await open("/earth", { dpr: 1 });
    await page.screenshot({ path: live });
    await context.close();
  }
  {
    const { context, page } = await open("/earth", { dpr: 1, reduced: true });
    await page.screenshot({ path: reduced });
    await context.close();
  }
  const out = {};
  const pairs = [
    ["live", live, join(BASELINE, "earth-on-dark-rest.png")],
    ["reduced", reduced, join(BASELINE, "earth-on-dark-reduced-rest.png")],
  ];
  for (const [name, a, b] of pairs) {
    if (!existsSync(b)) {
      out[name] = { baseline: b, missing: true };
      continue;
    }
    out[name] = { baseline: b, ...diff(readPng(a), readPng(b), `${OUT}/diff-${name}-vs-s2.png`) };
  }
  const n1 = join(BASELINE, "noise-off-dark-reduced-1.png");
  const n2 = join(BASELINE, "noise-off-dark-reduced-2.png");
  if (existsSync(n1) && existsSync(n2)) out.noiseFloorReduced = diff(readPng(n1), readPng(n2));
  // Two captures of the live page a few seconds apart: the page's own motion (ships, walkers, twinkle).
  {
    const { context, page } = await open("/earth", { dpr: 1 });
    const t1 = `${OUT}/earth-default-dark-dpr1-live-t1.png`;
    const t2 = `${OUT}/earth-default-dark-dpr1-live-t2.png`;
    await page.screenshot({ path: t1 });
    await sleep(3000);
    await page.screenshot({ path: t2 });
    out.noiseFloorLive = diff(readPng(t1), readPng(t2));
    await context.close();
  }
  // Informational unless the reduced-motion pair is available: then it must sit near its noise floor.
  const ok = !out.reduced || out.reduced.missing || out.reduced.pct <= Math.max(2, (out.noiseFloorReduced?.pct ?? 0) * 3 + 1);
  record("diff-vs-s2-preview", ok, out);
}

async function inert() {
  const ref = `${OUT}/earth-default-dark-dpr1-reduced.png`;
  if (!existsSync(ref)) {
    const { context, page } = await open("/earth", { dpr: 1, reduced: true });
    await page.screenshot({ path: ref });
    await context.close();
  }
  const refShape = await (async () => {
    const { context, page } = await open("/earth", { dpr: 1, reduced: true });
    const s = await shape(page);
    await context.close();
    return s;
  })();
  const out = {};
  let ok = true;
  for (const q of ["stage=planet", "stage=noplanet,nosky,planet=0", "stage=planet=1&sky=0", "stage=twin,galaxy,world,hop", "stage=notwin,nogalaxy,noworld,nohop&stage=twin=0"]) {
    const { context, page, errors } = await open(`/earth?${q}`, { dpr: 1, reduced: true });
    const file = `${OUT}/earth-${q.replace(/[^a-z0-9]+/gi, "-")}.png`;
    await page.screenshot({ path: file });
    const s = await shape(page);
    const d = diff(readPng(file), readPng(ref));
    const same = s.canvases === refShape.canvases && s.globeCanvases === 0 && s.stageCanvases === 1 && s.stageZ === refShape.stageZ && !!s.host;
    out[q] = { shapeSame: same, diffPct: d.pct, strongPct: d.strongPct, errors: errors.slice(0, 3) };
    if (!same || d.pct > 2) ok = false;
    await context.close();
  }
  record("inert-params", ok, { ref: refShape, ...out });
}

/** Scan the globe for hoverable towns through the host's data-globe-hover. */
async function scanTowns(page) {
  const found = new Map();
  for (let y = 120; y < 880; y += 28) {
    for (let x = 440; x < 1430; x += 28) {
      await page.mouse.move(x, y);
      const id = await page.evaluate(() => document.querySelector(".course-globe-stage")?.dataset.globeHover || "");
      if (id && !found.has(id)) found.set(id, { courseId: id, x, y });
    }
  }
  await page.mouse.move(200, 450);
  return [...found.values()];
}

async function interact() {
  const { context, page, errors } = await open("/earth", { dpr: 1 });
  const before = await shape(page);
  // Spin by wheel over the globe, then let the settle scheduler land it on the facing course.
  await page.mouse.move(1000, 520);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(90, 0);
    await sleep(40);
  }
  await sleep(3200);
  const afterWheel = await shape(page);
  await page.screenshot({ path: `${OUT}/interact-after-wheel.png` });
  // Pick: hover scan for towns, click one whose course is not the active one; the flag follows.
  const towns = await scanTowns(page);
  let picked = null;
  for (const t of towns) {
    await page.mouse.move(t.x, t.y);
    await sleep(80);
    const hover = await page.evaluate(() => document.querySelector(".course-globe-stage")?.dataset.globeHover || "");
    if (hover !== t.courseId) continue;
    const flagBefore = (await shape(page)).flag;
    await page.mouse.down();
    await sleep(40);
    await page.mouse.up();
    await sleep(2200);
    const now = await shape(page);
    if (now.flag !== flagBefore && !now.land) {
      picked = { ...t, flagBefore, flagAfter: now.flag };
      break;
    }
    if (now.land) break;
  }
  await page.mouse.move(1380, 60);
  await sleep(500);
  const end = await shape(page);
  await page.screenshot({ path: `${OUT}/interact-after-pick.png` });
  const ok = afterWheel.flagVisible && end.flagVisible && !!end.flag && towns.length > 0 && (picked !== null || towns.length === 1);
  record("interact", ok, { before: { flag: before.flag }, afterWheel: { flag: afterWheel.flag, flagVisible: afterWheel.flagVisible, courseChanged: afterWheel.flag !== before.flag }, towns: towns.length, picked, end: { flag: end.flag, flagVisible: end.flagVisible, land: end.land }, errors: errors.slice(0, 4) });
  await context.close();
}

/**
 * Sample the hop every animation frame until the director rests: the invariant is that no frame
 * shows the globe and the land together in the clear (`min(planetFade, worldFade) > 0` only
 * under the whole deck), and the hold (if any) happens inside the deck.
 */
function sampleHop(page, maxMs) {
  return page.evaluate(
    (maxMs) =>
      new Promise((done) => {
        const hop = window.__stageHop;
        const rows = [];
        const t0 = performance.now();
        let started = false;
        const tick = () => {
          const s = hop.sample();
          const st = hop.state();
          const now = performance.now() - t0;
          // The press lands a frame or two after the sampler starts: wait for the flight to begin.
          if (!started) {
            if (s.moving) started = true;
            else if (now > 3000) return done(rows);
            else return requestAnimationFrame(tick);
          }
          rows.push({ t: Math.round(now), L: s.L, held: s.held, planet: st.planetFade, world: st.worldFade, clouds: st.world.clouds, ready: hop.ready("world") });
          if (!s.moving || now > maxMs) done(rows);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    maxMs,
  );
}

/**
 * `heldMs` is the director's park (first to last held frame); `holdMs` is the in-deck hold proper
 * on a dive: from the deck closing over the lens to the land reporting ready (0 when the land was
 * ready before the deck closed); `inDeckMs` the whole time the deck was whole.
 */
function hopInvariant(rows) {
  const overlapClear = rows.filter((r) => Math.min(r.planet, r.world) > 0.001 && r.clouds < 0.999);
  const held = rows.filter((r) => r.held);
  const heldOutsideDeck = held.filter((r) => r.clouds < 0.999);
  const deckEnter = rows.find((r) => r.clouds >= 0.999)?.t ?? null;
  const deckExit = [...rows].reverse().find((r) => r.clouds >= 0.999)?.t ?? null;
  const readyAt = rows.find((r) => r.ready)?.t ?? null;
  return {
    frames: rows.length,
    ms: rows.at(-1)?.t ?? 0,
    overlapClear: overlapClear.length,
    heldFrames: held.length,
    heldMs: held.length ? held.at(-1).t - held[0].t : 0,
    holdMs: deckEnter !== null && readyAt !== null ? Math.max(0, readyAt - deckEnter) : null,
    inDeckMs: deckEnter !== null && deckExit !== null ? deckExit - deckEnter : null,
    heldOutsideDeck: heldOutsideDeck.length,
    minL: Math.min(...rows.map((r) => r.L)),
    maxL: Math.max(...rows.map((r) => r.L)),
  };
}

async function dive() {
  const { context, page, errors } = await open("/earth", { dpr: 1 });
  const before = await shape(page);
  const landButton = page.locator("button:has-text('Land')").first();
  if (!(await landButton.count())) {
    record("dive-rise", false, { reason: "no Land button", buttons: await page.locator("button").allTextContents() });
    await context.close();
    return;
  }
  // Warm the land like a hover would (the flag's pointer enter), then press Land and sample the hop.
  await landButton.hover();
  await sleep(1500);
  const sampling = sampleHop(page, 40000);
  await landButton.click();
  const diveRows = await sampling;
  await sleep(300);
  const mid = await page.evaluate(() => window.__stageHop.flight());
  await page.screenshot({ path: `${OUT}/dive-landed.png` });
  const landed = await shape(page);
  const diveStats = hopInvariant(diveRows);
  writeFileSync(`${OUT}/dive-samples.json`, JSON.stringify(diveRows));
  // The rise: "The planet" from the land rail.
  const leave = page.locator("button:has-text('The planet'), button:has-text('Back to the planet'), button:has-text('Planet')").first();
  let riseStats = null;
  let after = null;
  if (await leave.count()) {
    const risingSample = sampleHop(page, 20000);
    await leave.click();
    const riseRows = await risingSample;
    riseStats = hopInvariant(riseRows);
    writeFileSync(`${OUT}/rise-samples.json`, JSON.stringify(riseRows));
    await sleep(2500);
    after = await shape(page);
    await page.screenshot({ path: `${OUT}/rise-landed.png` });
  }
  // The second visit (warm): the land's build is cached, so the dive should barely hold.
  let warmStats = null;
  let warmLanded = null;
  const landAgain = page.locator("button:has-text('Land')").first();
  if (after && (await landAgain.count())) {
    const sampling = sampleHop(page, 40000);
    await landAgain.click();
    const warmRows = await sampling;
    warmStats = hopInvariant(warmRows);
    writeFileSync(`${OUT}/dive-warm-samples.json`, JSON.stringify(warmRows));
    await sleep(300);
    warmLanded = await shape(page);
    await page.screenshot({ path: `${OUT}/dive-warm-landed.png` });
  }
  const ok =
    landed.land &&
    landed.landHost === "true" &&
    landed.stageDisplay !== "none" &&
    landed.hop?.sample.rung === "world" &&
    !landed.hop?.sample.moving &&
    mid === null &&
    diveStats.overlapClear === 0 &&
    diveStats.heldOutsideDeck === 0 &&
    diveStats.minL === 0 &&
    riseStats !== null &&
    riseStats.overlapClear === 0 &&
    after !== null &&
    !after.land &&
    after.flagVisible &&
    after.hop?.sample.rung === "planet" &&
    after.globeCanvases === 0 &&
    warmStats !== null &&
    warmStats.overlapClear === 0 &&
    warmStats.heldOutsideDeck === 0 &&
    warmStats.minL === 0 &&
    warmLanded?.land === true &&
    warmLanded.hop?.sample.rung === "world";
  record("dive-rise", ok, {
    before: { flag: before.flag, land: before.land, rung: before.hop?.sample.rung },
    dive: diveStats,
    landed: { land: landed.land, landHost: landed.landHost, stageDisplay: landed.stageDisplay, rung: landed.hop?.sample.rung, moving: landed.hop?.sample.moving, flight: mid },
    rise: riseStats,
    after: after ? { flag: after.flag, flagVisible: after.flagVisible, land: after.land, rung: after.hop?.sample.rung } : null,
    warm: warmStats,
    warmLanded: warmLanded ? { land: warmLanded.land, rung: warmLanded.hop?.sample.rung, moving: warmLanded.hop?.sample.moving } : null,
    errors: errors.slice(0, 4),
  });
  await context.close();
}

try {
  if (want("grain")) await grain();
  if (want("diff")) await diffAgainstBaseline();
  if (want("inert")) await inert();
  if (want("interact")) await interact();
  if (want("dive")) await dive();
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(`report: ${OUT}/report.json`);
}
process.exit(failed ? 1 : 0);
