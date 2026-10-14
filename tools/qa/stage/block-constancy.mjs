/**
 * Pixel-look measurements for the stage captures (pure, PNG in / numbers out).
 * Ported from the S2 pixel harness (/tmp/stage-pixel/capture.mjs) so the
 * pixelation guarantee has a home in the repo. PNGs go through
 * `../constellation/png.mjs` (node zlib), no dependencies.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "../constellation/png.mjs";

export function readPng(file) {
  return decodePng(readFileSync(file));
}

/**
 * Fraction of aligned `cell` x `cell` blocks (device px) inside `box` whose
 * pixels are all the same colour (within `tol` per channel). A pass drawn at
 * a grain of `cell` device px per cell and nearest-upscaled scores ~100 %;
 * anything rendered at device resolution (text, anti-aliased edges, a
 * bilinear upscale) scores far lower. The box is snapped to the cell grid.
 */
export function blockConstancy(img, box, cell = 2, tol = 1) {
  const { width, data } = img;
  let blocks = 0;
  let constant = 0;
  let nonBg = 0;
  const x0 = Math.floor(box.x / cell) * cell;
  const y0 = Math.floor(box.y / cell) * cell;
  for (let y = y0; y + cell <= box.y + box.h; y += cell) {
    for (let x = x0; x + cell <= box.x + box.w; x += cell) {
      let ok = true;
      const i0 = (y * width + x) * 4;
      let lum = 0;
      for (let dy = 0; dy < cell && ok; dy++) {
        for (let dx = 0; dx < cell; dx++) {
          const i = ((y + dy) * width + (x + dx)) * 4;
          lum += data[i] + data[i + 1] + data[i + 2];
          if (Math.abs(data[i] - data[i0]) > tol || Math.abs(data[i + 1] - data[i0 + 1]) > tol || Math.abs(data[i + 2] - data[i0 + 2]) > tol) {
            ok = false;
            break;
          }
        }
      }
      blocks++;
      if (ok) constant++;
      if (lum / (cell * cell) > 60) nonBg++;
    }
  }
  return { blocks, constant, pct: blocks ? +((100 * constant) / blocks).toFixed(2) : 0, nonBgBlocks: nonBg };
}

/** Bounding box of pixels brighter than the sky inside `box` (the planet itself), or null. */
export function brightBox(img, box, thr = 70) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i] + img.data[i + 1] + img.data[i + 2] > thr * 3) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** The middle half of a box (keeps the measurement off the limb and the chrome). */
export function innerBox(box) {
  return { x: box.x + (box.w >> 2), y: box.y + (box.h >> 2), w: box.w >> 1, h: box.h >> 1 };
}

/** Nearest-neighbour crop + upscale, written to `outFile`. */
export function crop(img, box, scale, outFile) {
  const w = box.w * scale;
  const h = box.h * scale;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = box.x + Math.floor(x / scale);
      const sy = box.y + Math.floor(y / scale);
      const si = (sy * img.width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = 255;
    }
  }
  writeFileSync(outFile, encodePng({ width: w, height: h, data: out }));
  return outFile;
}

/**
 * Per-pixel diff of two images of the same size: the share of pixels whose
 * largest channel difference exceeds 8 (`pct`) and 40 (`strongPct`), plus a
 * heat map (faded source, changed pixels in orange / red) when `outFile` is given.
 */
export function diff(a, b, outFile = null) {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const out = outFile ? new Uint8Array(w * h * 4) : null;
  let changed = 0;
  let strong = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      const d = Math.max(Math.abs(a.data[ia] - b.data[ib]), Math.abs(a.data[ia + 1] - b.data[ib + 1]), Math.abs(a.data[ia + 2] - b.data[ib + 2]));
      if (d > 8) changed++;
      if (d > 40) strong++;
      if (out) {
        const io = (y * w + x) * 4;
        const lum = 0.3 * a.data[ia] + 0.59 * a.data[ia + 1] + 0.11 * a.data[ia + 2];
        const faded = 128 + lum * 0.5;
        out[io] = out[io + 1] = out[io + 2] = faded;
        out[io + 3] = 255;
        if (d > 8) {
          out[io] = 255;
          out[io + 1] = d > 40 ? 40 : 160;
          out[io + 2] = 40;
        }
      }
    }
  }
  if (out) writeFileSync(outFile, encodePng({ width: w, height: h, data: out }));
  return { pct: +((100 * changed) / (w * h)).toFixed(3), strongPct: +((100 * strong) / (w * h)).toFixed(3), sameSize: a.width === b.width && a.height === b.height };
}
