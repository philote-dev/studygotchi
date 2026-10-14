/**
 * Minimal PNG codec on node's zlib: enough for screenshots (8-bit grey / RGB /
 * RGBA, with or without alpha, non-interlaced, every scanline filter) and for
 * writing diff heat maps. No dependency so `tools/` stays install-free.
 *
 *   decodePng(buffer) -> { width, height, data: Uint8Array /* RGBA *\/ }
 *   encodePng({ width, height, data }, { filter = 0, rgb = false }) -> Buffer
 */
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

export function decodePng(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG (bad PNG signature)')
  let offset = 8
  let header = null
  const idat = []
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      }
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!header) throw new Error('PNG has no IHDR chunk')
  if (header.depth !== 8) throw new Error(`Unsupported PNG bit depth ${header.depth} (8 only)`)
  if (header.interlace !== 0) throw new Error('Interlaced PNGs are not supported')
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType]
  if (!channels) throw new Error(`Unsupported PNG colour type ${header.colorType} (grey, RGB, grey+alpha, RGBA only)`)

  const { width, height } = header
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length < (stride + 1) * height) throw new Error('PNG image data is truncated')
  const unfiltered = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    const prev = dst - stride
    for (let i = 0; i < stride; i += 1) {
      const x = raw[src + i]
      const a = i >= channels ? unfiltered[dst + i - channels] : 0
      const b = y > 0 ? unfiltered[prev + i] : 0
      const c = y > 0 && i >= channels ? unfiltered[prev + i - channels] : 0
      let value
      switch (filter) {
        case 0: value = x; break
        case 1: value = x + a; break
        case 2: value = x + b; break
        case 3: value = x + ((a + b) >> 1); break
        case 4: value = x + paeth(a, b, c); break
        default: throw new Error(`Unknown PNG filter type ${filter} on row ${y}`)
      }
      unfiltered[dst + i] = value & 255
    }
  }

  const data = new Uint8Array(width * height * 4)
  for (let p = 0, s = 0; p < width * height; p += 1, s += channels) {
    const d = p * 4
    if (channels === 1) {
      data[d] = data[d + 1] = data[d + 2] = unfiltered[s]
      data[d + 3] = 255
    } else if (channels === 2) {
      data[d] = data[d + 1] = data[d + 2] = unfiltered[s]
      data[d + 3] = unfiltered[s + 1]
    } else if (channels === 3) {
      data[d] = unfiltered[s]
      data[d + 1] = unfiltered[s + 1]
      data[d + 2] = unfiltered[s + 2]
      data[d + 3] = 255
    } else {
      data[d] = unfiltered[s]
      data[d + 1] = unfiltered[s + 1]
      data[d + 2] = unfiltered[s + 2]
      data[d + 3] = unfiltered[s + 3]
    }
  }
  return { width, height, data }
}

function chunk(type, body) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length, 0)
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed), 0)
  return Buffer.concat([length, typed, crc])
}

export function encodePng({ width, height, data }, { filter = 0, rgb = false } = {}) {
  const channels = rgb ? 3 : 4
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  const line = new Uint8Array(stride)
  const prevLine = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const s = (y * width + x) * 4
      const d = x * channels
      line[d] = data[s]
      line[d + 1] = data[s + 1]
      line[d + 2] = data[s + 2]
      if (!rgb) line[d + 3] = data[s + 3]
    }
    const row = y * (stride + 1)
    raw[row] = filter
    for (let i = 0; i < stride; i += 1) {
      const x = line[i]
      const a = i >= channels ? line[i - channels] : 0
      const b = y > 0 ? prevLine[i] : 0
      const c = y > 0 && i >= channels ? prevLine[i - channels] : 0
      let value
      switch (filter) {
        case 0: value = x; break
        case 1: value = x - a; break
        case 2: value = x - b; break
        case 3: value = x - ((a + b) >> 1); break
        case 4: value = x - paeth(a, b, c); break
        default: throw new Error(`Unknown PNG filter type ${filter}`)
      }
      raw[row + 1 + i] = value & 255
    }
    prevLine.set(line)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = rgb ? 2 : 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
