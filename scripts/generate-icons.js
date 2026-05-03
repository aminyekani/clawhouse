#!/usr/bin/env node
// One-shot generator for PWA / Apple-touch icons. Emits
// public/icon-180.png, icon-192.png, icon-512.png, icon-maskable-512.png.
// Hand-encodes PNG so we don't pull in a dep.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const BG = [0x21, 0x27, 0x44, 0xff];     // deep navy (matches office theme)
const WIN = [0x7d, 0xf9, 0xd0, 0xff];    // cyan window glow (matches accent)
const ROOF = [0xcd, 0xb7, 0xff, 0xff];   // lavender roof (h2 color)
const FRAME = [0x0d, 0x10, 0x20, 0xff];  // near-black frame

// 24×24 pixelart of a 4-window office building.
// Legend: . bg, # frame, R roof, W window, F facade
const ART = [
  '........................',
  '........................',
  '........................',
  '........RRRRRRRRRR......',
  '.......RRRRRRRRRRRR.....',
  '......RRRRRRRRRRRRRR....',
  '......##############....',
  '......#FFFFFFFFFFFF#....',
  '......#FWWFFFFFWWFF#....',
  '......#FWWFFFFFWWFF#....',
  '......#FFFFFFFFFFFF#....',
  '......#FWWFFFFFWWFF#....',
  '......#FWWFFFFFWWFF#....',
  '......#FFFFFFFFFFFF#....',
  '......#FWWFFFFFWWFF#....',
  '......#FWWFFFFFWWFF#....',
  '......#FFFFFFFFFFFF#....',
  '......#FFFFFWWFFFFF#....',
  '......#FFFFFWWFFFFF#....',
  '......##############....',
  '........................',
  '........................',
  '........................',
  '........................',
];
const PALETTE = { '.': BG, '#': FRAME, 'R': ROOF, 'W': WIN, 'F': [0x39, 0x41, 0x6f, 0xff] };

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function makePng(pixels, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < h; y++) {
    rows.push(Buffer.from([0]));
    rows.push(Buffer.from(pixels.slice(y * w * 4, (y + 1) * w * 4)));
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function renderIcon(targetSize, { padding = 0, maskable = false } = {}) {
  const grid = ART.length;
  const inner = targetSize - padding * 2;
  const scale = Math.floor(inner / grid);
  const renderedSize = scale * grid;
  const offset = Math.floor((targetSize - renderedSize) / 2);
  const pixels = Buffer.alloc(targetSize * targetSize * 4);
  // Fill background first (different for maskable to make a safe-zone bg)
  const bgFill = maskable ? BG : BG;
  for (let i = 0; i < targetSize * targetSize; i++) {
    pixels[i * 4 + 0] = bgFill[0];
    pixels[i * 4 + 1] = bgFill[1];
    pixels[i * 4 + 2] = bgFill[2];
    pixels[i * 4 + 3] = bgFill[3];
  }
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const ch = ART[gy][gx];
      const color = PALETTE[ch];
      if (!color || ch === '.') continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = offset + gx * scale + dx;
          const y = offset + gy * scale + dy;
          const idx = (y * targetSize + x) * 4;
          pixels[idx + 0] = color[0];
          pixels[idx + 1] = color[1];
          pixels[idx + 2] = color[2];
          pixels[idx + 3] = color[3];
        }
      }
    }
  }
  return makePng(pixels, targetSize, targetSize);
}

const outDir = path.resolve(__dirname, '..', 'public');
const targets = [
  { name: 'icon-180.png', size: 180 },                     // apple-touch-icon
  { name: 'icon-192.png', size: 192 },                     // PWA standard
  { name: 'icon-512.png', size: 512 },                     // PWA standard
  { name: 'icon-maskable-512.png', size: 512, maskable: true }, // safe-zone padded
];
for (const t of targets) {
  const buf = renderIcon(t.size, { padding: t.maskable ? 60 : 0, maskable: t.maskable });
  const out = path.join(outDir, t.name);
  fs.writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
}
