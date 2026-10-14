import { even } from "./lib/rng";

/** A placed exhibit: centre in CSS px from the stage centre (y up), width in px. */
export interface Tile {
  id: string;
  x: number;
  y: number;
  size: number;
}

export const TINY_SIZES = [32, 48, 96] as const;

/** Grid of equal square tiles, centred, every coordinate even so tiles sit on the 2 px cell grid. */
export function gridLayout(ids: readonly string[], width: number, height: number, pad = 12, gap = 14): Tile[] {
  const n = ids.length;
  if (n === 0 || width <= 0 || height <= 0) return [];
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt((n * width) / height))));
  const rows = Math.ceil(n / cols);
  const cell = Math.floor(Math.min((width - 2 * pad) / cols, (height - 2 * pad) / rows));
  const size = Math.max(16, even(cell - gap));
  const gridW = cols * cell;
  const gridH = rows * cell;
  return ids.map((id, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return { id, x: even(-gridW / 2 + cell * (c + 0.5)), y: even(gridH / 2 - cell * (r + 0.5)), size };
  });
}

/** Focus view: one large exhibit on the left, a 32 px and a 96 px preview beside it; the side panel owns the right `side` px. */
export function focusLayout(id: string, width: number, height: number, side = 320, pad = 24): { large: Tile; tiny: Tile; mid: Tile } {
  const avail = Math.max(120, width - side - 2 * pad - 140);
  const size = even(Math.max(96, Math.min(height - 2 * pad, avail)));
  const lx = even(-width / 2 + pad + size / 2);
  const large: Tile = { id, x: lx, y: 0, size };
  const px = even(lx + size / 2 + 80);
  const tiny: Tile = { id, x: px, y: even(size / 2 - 40), size: 32 };
  const mid: Tile = { id, x: px, y: even(size / 2 - 160), size: 96 };
  return { large, tiny, mid };
}

/** Tiny view: every exhibit at 32 / 48 / 96 px in three rows, so the small-scale read can be compared. */
export function tinyRowsLayout(ids: readonly string[], width: number, height: number): Tile[] {
  const n = ids.length;
  if (n === 0) return [];
  const colW = Math.floor((width - 40) / n);
  const rowH = Math.floor((height - 40) / TINY_SIZES.length);
  const tiles: Tile[] = [];
  TINY_SIZES.forEach((size, r) => {
    ids.forEach((id, c) => {
      tiles.push({ id, x: even(-width / 2 + 20 + colW * (c + 0.5)), y: even(height / 2 - 20 - rowH * (r + 0.5)), size });
    });
  });
  return tiles;
}

export interface ScaleRow {
  label: string;
  pxPerSu: number;
  /** Row centre y (px, y up). */
  y: number;
  ids: readonly string[];
}

/**
 * Relative-scale view: two rows drawn at one px-per-su each (see the scene-unit
 * convention in lib/types.ts). Row A = bodies (planets, comet, binary, pulsar,
 * discs) at a large scale; row B = structures (nebulae, remnant, clusters) at a
 * small scale, with the binary, comet and giant repeated as bridges. Tiles
 * never drop below 8 px so a dot still marks where a tiny body would be.
 */
export function scaleLayout(items: readonly { id: string; su: number }[], width: number, height: number, gap = 18): { tiles: Tile[]; rows: ScaleRow[] } {
  const bySu = new Map(items.map((i) => [i.id, i.su]));
  const isBody = (su: number) => su < 10;
  const bodies = items.filter((i) => isBody(i.su)).map((i) => i.id).concat(["binary"].filter((id) => bySu.has(id) && !isBody(bySu.get(id)!)));
  const structures = items.filter((i) => !isBody(i.su)).map((i) => i.id).concat(["comet", "giant"].filter((id) => bySu.has(id) && isBody(bySu.get(id)!)));
  const rowsIds = [bodies, structures].filter((r) => r.length);
  const rowH = height / Math.max(1, rowsIds.length);
  const rows: ScaleRow[] = [];
  const tiles: Tile[] = [];
  rowsIds.forEach((ids, r) => {
    const suSum = ids.reduce((s, id) => s + (bySu.get(id) ?? 1), 0);
    const avail = width - 120 - gap * (ids.length + 1);
    const cap = r === 0 ? 34 : 6;
    const pxPerSu = Math.max(0.5, Math.min(cap, avail / suSum, (rowH - 60) / Math.max(...ids.map((id) => bySu.get(id) ?? 1))));
    const sizes = ids.map((id) => Math.max(8, even((bySu.get(id) ?? 1) * pxPerSu)));
    const total = sizes.reduce((s, v) => s + v, 0) + gap * (ids.length - 1);
    let x = -total / 2;
    const y = even(height / 2 - rowH * (r + 0.5));
    ids.forEach((id, i) => {
      tiles.push({ id, x: even(x + sizes[i] / 2), y, size: sizes[i] });
      x += sizes[i] + gap;
    });
    rows.push({ label: r === 0 ? "bodies" : "structures", pxPerSu, y, ids });
  });
  return { tiles, rows };
}

/** CSS box for a tile inside a stage of the given size. */
export function tileBox(t: Tile, width: number, height: number): { left: number; top: number; width: number; height: number } {
  return { left: width / 2 + t.x - t.size / 2, top: height / 2 - t.y - t.size / 2, width: t.size, height: t.size };
}
