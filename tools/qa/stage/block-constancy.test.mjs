import assert from "node:assert/strict";
import test from "node:test";
import { blockConstancy, brightBox, diff, innerBox } from "./block-constancy.mjs";

/** A `w` x `h` RGBA image filled by `at(x, y) -> [r, g, b]`. */
function image(w, h, at) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const cellsOf = (cell) => (x, y) => {
  const v = ((Math.floor(x / cell) * 31 + Math.floor(y / cell) * 17) % 7) * 30 + 40;
  return [v, v + 10, v + 20];
};

test("a picture drawn in 2 px cells is 100 % 2x2-constant and ~50 % 4x4-constant", () => {
  const img = image(64, 64, cellsOf(2));
  const box = { x: 0, y: 0, w: 64, h: 64 };
  assert.equal(blockConstancy(img, box, 2).pct, 100);
  assert.ok(blockConstancy(img, box, 4).pct < 60);
});

test("a picture drawn in 4 px cells is 100 % constant at 4 and at 2 (dpr 2 blocks contain the dpr 1 ones)", () => {
  const img = image(64, 64, cellsOf(4));
  const box = { x: 0, y: 0, w: 64, h: 64 };
  assert.equal(blockConstancy(img, box, 4).pct, 100);
  assert.equal(blockConstancy(img, box, 2).pct, 100);
});

test("per-pixel noise scores near 0 and a misaligned box snaps to the grid", () => {
  const img = image(64, 64, (x, y) => [(x * 7 + y * 13) % 256, (x * 3) % 256, (y * 5) % 256]);
  assert.ok(blockConstancy(img, { x: 0, y: 0, w: 64, h: 64 }, 2).pct < 5);
  const cells = image(64, 64, cellsOf(2));
  assert.equal(blockConstancy(cells, { x: 3, y: 5, w: 40, h: 40 }, 2).pct, 100);
});

test("brightBox finds the planet and innerBox keeps the middle half", () => {
  const img = image(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 12 && y < 28 ? [200, 200, 200] : [8, 7, 22]));
  assert.deepEqual(brightBox(img, { x: 0, y: 0, w: 40, h: 40 }), { x: 10, y: 12, w: 20, h: 16 });
  assert.deepEqual(innerBox({ x: 10, y: 12, w: 20, h: 16 }), { x: 15, y: 16, w: 10, h: 8 });
  assert.equal(brightBox(img, { x: 0, y: 0, w: 5, h: 5 }), null);
});

test("diff counts changed and strongly changed pixels", () => {
  const a = image(10, 10, () => [100, 100, 100]);
  const b = image(10, 10, (x) => (x < 2 ? [100, 100, 100] : x < 6 ? [112, 100, 100] : [200, 100, 100]));
  const d = diff(a, b);
  assert.equal(d.pct, 80);
  assert.equal(d.strongPct, 40);
  assert.equal(d.sameSize, true);
  assert.equal(diff(a, a).pct, 0);
});
