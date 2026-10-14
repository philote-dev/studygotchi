import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodePng, encodePng } from './png.mjs'

function gradient(width, height, channels = 4) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      data[i] = (x * 7) & 255
      data[i + 1] = (y * 13) & 255
      data[i + 2] = ((x * y) ^ 0x5a) & 255
      data[i + 3] = channels === 4 ? (255 - ((x + y) & 63)) : 255
    }
  }
  return { width, height, data }
}

for (const filter of [0, 1, 2, 3, 4]) {
  test(`RGBA round trip survives filter type ${filter}`, () => {
    const image = gradient(37, 23)
    const decoded = decodePng(encodePng(image, { filter }))
    assert.equal(decoded.width, 37)
    assert.equal(decoded.height, 23)
    assert.deepEqual(Buffer.from(decoded.data), Buffer.from(image.data))
  })
}

test('RGB (no alpha) decodes to opaque RGBA', () => {
  const image = gradient(9, 5, 3)
  const decoded = decodePng(encodePng(image, { filter: 4, rgb: true }))
  assert.deepEqual(Buffer.from(decoded.data), Buffer.from(image.data))
})

test('a PNG with a bad signature is rejected', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all, really')), /PNG signature/)
})
