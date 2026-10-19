// A small PNG encoder and decoder on node:zlib. Images are 8-bit RGBA, row-major, top row first.
// The encoder writes colour type 6 with a per-row filter chosen by the minimum-sum heuristic; the
// decoder reads every non-interlaced PNG with bit depth 8 or less (grey, RGB, palette with tRNS,
// grey with alpha, RGBA) and 16-bit images by keeping the high byte.
import { deflateSync, inflateSync } from 'node:zlib';

export interface Image {
  width: number;
  height: number;
  /** RGBA bytes, `width * height * 4`. */
  data: Uint8Array;
}

export const createImage = (width: number, height: number): Image => ({
  width,
  height,
  data: new Uint8Array(width * height * 4),
});

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Encodes an RGBA image as a PNG file. */
export const encodePng = (img: Image): Uint8Array => {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = data[row + i]!;
        const a = i >= 4 ? data[row + i - 4]! : 0;
        const b = y > 0 ? data[row - stride + i]! : 0;
        const c = i >= 4 && y > 0 ? data[row - stride + i - 4]! : 0;
        const v =
          f === 0
            ? x
            : f === 1
              ? x - a
              : f === 2
                ? x - b
                : f === 3
                  ? x - ((a + b) >> 1)
                  : x - paeth(a, b, c);
        trial[i] = v & 0xff;
        sum += (v & 0xff) < 128 ? v & 0xff : 256 - (v & 0xff);
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
        raw.set(trial, y * (stride + 1) + 1);
      }
    }
    raw[y * (stride + 1)] = best;
  }
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decodes a non-interlaced PNG file into RGBA. */
export const decodePng = (file: Uint8Array): Image => {
  for (let i = 0; i < 8; i++) {
    if (file[i] !== SIGNATURE[i]) throw new Error('png: bad signature');
  }
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let palette: Uint8Array = new Uint8Array(0);
  let alpha: Uint8Array = new Uint8Array(0);
  const idat: Uint8Array[] = [];
  for (let at = 8; at < file.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = body[8]!;
      colour = body[9]!;
      if (body[12] !== 0) throw new Error('png: interlaced images are not supported');
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') alpha = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = CHANNELS[colour];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error('png: unsupported format');
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of idat) {
    joined.set(p, at);
    at += p.length;
  }
  const raw = inflateSync(joined);
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= bpp ? rows[dst + i - bpp]! : 0;
      const b = y > 0 ? rows[dst - stride + i]! : 0;
      const c = i >= bpp && y > 0 ? rows[dst - stride + i - bpp]! : 0;
      const p =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? (a + b) >> 1
                : paeth(a, b, c);
      rows[dst + i] = (x + p) & 0xff;
    }
  }
  const img = createImage(width, height);
  const out = img.data;
  const sample = (y: number, n: number): number => {
    if (depth === 8) return rows[y * stride + n]!;
    if (depth === 16) return rows[y * stride + n * 2]!;
    const bit = n * depth;
    return (rows[y * stride + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const scale = (v: number): number => (depth < 8 ? Math.round((v * 255) / ((1 << depth) - 1)) : v);
  const transparentGrey = alpha.length >= 2 ? (alpha[0]! << 8) | alpha[1]! : -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const n = x * channels;
      if (colour === 3) {
        const i = sample(y, n);
        out[o] = palette[i * 3] ?? 0;
        out[o + 1] = palette[i * 3 + 1] ?? 0;
        out[o + 2] = palette[i * 3 + 2] ?? 0;
        out[o + 3] = alpha[i] ?? 255;
      } else if (colour === 0 || colour === 4) {
        const g = sample(y, n);
        out[o] = out[o + 1] = out[o + 2] = scale(g);
        out[o + 3] =
          colour === 4 ? sample(y, n + 1) : depth <= 8 && g === transparentGrey ? 0 : 255;
      } else {
        out[o] = sample(y, n);
        out[o + 1] = sample(y, n + 1);
        out[o + 2] = sample(y, n + 2);
        out[o + 3] = colour === 6 ? sample(y, n + 3) : 255;
      }
    }
  }
  return img;
};
