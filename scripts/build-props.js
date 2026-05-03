#!/usr/bin/env node
// Per-agent foreground prop sprite sheet.
// Output: pixel-office/public/props.png
// Layout: 1 column x 9 rows of 32x32 sprites.
// Order matches AGENTS in build-sprites.js so SPRITE_ROWS works for both.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// ---------- PNG encoder ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Canvas ----------

function hex(s) {
  const h = s.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
}
function shade(c, mul) {
  return [Math.max(0, Math.min(255, Math.round(c[0] * mul))),
          Math.max(0, Math.min(255, Math.round(c[1] * mul))),
          Math.max(0, Math.min(255, Math.round(c[2] * mul))),
          c[3]];
}

class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.buf = Buffer.alloc(w * h * 4); }
  px(x, y, c) {
    if (!c) return;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.buf[i] = c[0]; this.buf[i+1] = c[1]; this.buf[i+2] = c[2]; this.buf[i+3] = c[3] != null ? c[3] : 255;
  }
  rect(x, y, w, h, c) { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.px(x+xx, y+yy, c); }
  hline(x, y, w, c) { for (let i = 0; i < w; i++) this.px(x+i, y, c); }
  vline(x, y, h, c) { for (let i = 0; i < h; i++) this.px(x, y+i, c); }
  outlineRect(x, y, w, h, c) {
    this.hline(x, y, w, c); this.hline(x, y+h-1, w, c);
    this.vline(x, y, h, c); this.vline(x+w-1, y, h, c);
  }
}

// ---------- Painters ----------

const OUTLINE = [10, 14, 26, 255];
const SIZE = 32;

const AGENTS = ['main', 'markethunting', 'sage', 'senku', 'shikamaru', 'tyrion', 'harvey', 'l', 'd', 'ephraim', 'house', 'markethunting2'];

function paint(c, ox, oy, agentId) {
  switch (agentId) {
    case 'main':           paintWarMap(c, ox, oy); break;
    case 'markethunting':  paintTradingChart(c, ox, oy); break;
    case 'sage':           paintKettle(c, ox, oy); break;
    case 'senku':          paintFlaskRack(c, ox, oy); break;
    case 'shikamaru':      paintShogiBoard(c, ox, oy); break;
    case 'tyrion':         paintLedgerWine(c, ox, oy); break;
    case 'harvey':         paintFilingCabinet(c, ox, oy); break;
    case 'l':              paintCandyPile(c, ox, oy); break;
    case 'd':              paintCondenserMic(c, ox, oy); break;
    case 'ephraim':        paintGymRack(c, ox, oy); break;
    case 'house':          paintXrayViewer(c, ox, oy); break;
    case 'markethunting2': paintTradingChart(c, ox, oy); break;
  }
}

// ----- Ephraim: wall-mounted gym rack — pull-up bar (top) + 2-tier dumbbell shelf (below) -----
// 32x32 layout:
//   y=1..7    pull-up bar mounted on wall brackets, with knurled grip tape sections
//   y=10..30  steel rack backboard with 2 shelves of dumbbells
//     shelf 1 (y≈14..20):  large dumbbells — red plates, blue plates
//     shelf 2 (y≈22..29):  smaller dumbbells — black plates
function paintGymRack(c, ox, oy) {
  const metal   = hex('#7a7e8a');
  const metalH  = hex('#a8acb8');
  const metalD  = hex('#3a3e48');
  const bracket = hex('#2a2e38');
  const bar     = hex('#1d2230');
  const barH    = hex('#3a3f4e');
  const grip    = hex('#5a3818');
  const gripD   = hex('#3a2410');
  const handle  = hex('#15182a');
  const handleH = hex('#3a3f4e');
  const plateR  = hex('#c93838');   // red plates
  const plateRD = hex('#7a1d1d');
  const plateB  = hex('#3a4a8c');   // blue plates
  const plateBD = hex('#1f2a55');
  const plateK  = hex('#1d2230');   // black plates
  const plateKH = hex('#3a3f4e');
  const screw   = hex('#d8d8d8');

  // === Pull-up bar (top) ===
  // Wall brackets (left + right): tall, dark, bolted to wall
  c.rect(ox + 3, oy + 1, 3, 6, bracket);
  c.outlineRect(ox + 3, oy + 1, 3, 6, OUTLINE);
  c.px(ox + 4, oy + 2, screw);
  c.px(ox + 4, oy + 5, screw);
  c.rect(ox + 26, oy + 1, 3, 6, bracket);
  c.outlineRect(ox + 26, oy + 1, 3, 6, OUTLINE);
  c.px(ox + 27, oy + 2, screw);
  c.px(ox + 27, oy + 5, screw);
  // Horizontal bar (between brackets)
  c.rect(ox + 5, oy + 2, 22, 3, bar);
  c.outlineRect(ox + 5, oy + 2, 22, 3, OUTLINE);
  c.hline(ox + 6, oy + 2, 20, barH);
  // Two grip-tape sections (knurled chalk grips)
  c.rect(ox + 9, oy + 2, 4, 3, grip);
  c.outlineRect(ox + 9, oy + 2, 4, 3, OUTLINE);
  c.hline(ox + 9, oy + 3, 4, gripD);
  c.rect(ox + 19, oy + 2, 4, 3, grip);
  c.outlineRect(ox + 19, oy + 2, 4, 3, OUTLINE);
  c.hline(ox + 19, oy + 3, 4, gripD);

  // === Dumbbell rack (lower) ===
  // Backboard / mounting plate
  c.rect(ox + 2, oy + 11, 28, 19, metal);
  c.outlineRect(ox + 2, oy + 11, 28, 19, OUTLINE);
  c.hline(ox + 3, oy + 12, 26, metalH);
  c.hline(ox + 3, oy + 28, 26, metalD);
  // Bolts at the four corners
  c.px(ox + 4,  oy + 12, screw);
  c.px(ox + 27, oy + 12, screw);
  c.px(ox + 4,  oy + 28, screw);
  c.px(ox + 27, oy + 28, screw);
  // Shelf divider
  c.hline(ox + 3, oy + 21, 26, metalD);

  // --- Shelf 1: large dumbbells ---
  // Left dumbbell — red plates
  paintDumbbellLarge(c, ox + 3,  oy + 14, plateR, plateRD, handle, handleH);
  // Right dumbbell — blue plates
  paintDumbbellLarge(c, ox + 17, oy + 14, plateB, plateBD, handle, handleH);

  // --- Shelf 2: smaller dumbbells ---
  paintDumbbellSmall(c, ox + 4,  oy + 23, plateK, plateKH, handle);
  paintDumbbellSmall(c, ox + 18, oy + 23, plateK, plateKH, handle);
}

// Helper: 12x6 dumbbell with chunky weight plates and a knurled handle.
function paintDumbbellLarge(c, ox, oy, plate, plateD, handle, handleH) {
  // Left plate (chunky, 3x6)
  c.rect(ox + 0, oy + 0, 3, 6, plate);
  c.outlineRect(ox + 0, oy + 0, 3, 6, OUTLINE);
  c.vline(ox + 0, oy + 1, 4, plateD);
  // Right plate
  c.rect(ox + 9, oy + 0, 3, 6, plate);
  c.outlineRect(ox + 9, oy + 0, 3, 6, OUTLINE);
  c.vline(ox + 11, oy + 1, 4, plateD);
  // Handle between plates
  c.rect(ox + 3, oy + 2, 6, 2, handle);
  c.outlineRect(ox + 3, oy + 2, 6, 2, OUTLINE);
  c.hline(ox + 3, oy + 2, 6, handleH);
}

// Helper: 10x4 mini dumbbell — round plates, slimmer handle.
function paintDumbbellSmall(c, ox, oy, plate, plateH, handle) {
  // Left plate (compact, 2x4)
  c.rect(ox + 0, oy + 0, 2, 4, plate);
  c.outlineRect(ox + 0, oy + 0, 2, 4, OUTLINE);
  c.px(ox + 0, oy + 1, plateH);
  // Right plate
  c.rect(ox + 8, oy + 0, 2, 4, plate);
  c.outlineRect(ox + 8, oy + 0, 2, 4, OUTLINE);
  c.px(ox + 9, oy + 1, plateH);
  // Handle
  c.rect(ox + 2, oy + 1, 6, 2, handle);
  c.outlineRect(ox + 2, oy + 1, 6, 2, OUTLINE);
}

// ----- House: wall-mounted X-ray viewer light box with skull silhouette + clipboard hung beside -----
// 32x32 layout:
//   Left (x≈3..23): glowing X-ray light box with skull X-ray pinned to it
//   Right (x≈25..29): small clipboard with chart paper, hung from a peg
function paintXrayViewer(c, ox, oy) {
  const frame   = hex('#cfd6dc');     // light medical bezel
  const frameD  = hex('#7e8590');
  const frameH  = hex('#ecf0f4');
  const glow    = hex('#dff3ff');     // light box glow (cool white)
  const glowH   = hex('#ffffff');
  const film    = hex('#1f3140');     // x-ray film background (dark blue-black)
  const filmH   = hex('#2c4658');
  const bone    = hex('#dee5ee');     // bone luminance
  const boneD   = hex('#9aa6b4');
  const screw   = hex('#3a3f48');
  const cord    = hex('#1d2230');
  const clipMet = hex('#aab2bd');
  const clipBoa = hex('#8c6a3d');     // clipboard wood
  const clipBoaD= hex('#5e4423');
  const paper   = hex('#f1ecdb');
  const ink     = hex('#243140');
  const red     = hex('#c92a2a');

  // Power cord drooping from top of light box
  c.vline(ox + 4, oy + 0, 3, cord);
  c.px(ox + 5, oy + 2, cord);

  // Light box outer frame
  c.rect(ox + 2, oy + 3, 22, 26, frame);
  c.outlineRect(ox + 2, oy + 3, 22, 26, OUTLINE);
  c.hline(ox + 3, oy + 4, 20, frameH);   // top inner highlight
  c.vline(ox + 3, oy + 5, 23, frameH);   // left inner highlight
  c.hline(ox + 3, oy + 27, 20, frameD);  // bottom shadow
  c.vline(ox + 22, oy + 5, 22, frameD);  // right shadow
  // Mounting screws at the four corners
  c.px(ox + 4,  oy + 5,  screw);
  c.px(ox + 21, oy + 5,  screw);
  c.px(ox + 4,  oy + 26, screw);
  c.px(ox + 21, oy + 26, screw);

  // Glowing light surface (back-lit panel)
  c.rect(ox + 5, oy + 6, 16, 20, glow);
  c.hline(ox + 6, oy + 6, 14, glowH);     // top highlight band
  c.hline(ox + 6, oy + 7, 14, glowH);

  // X-ray film clipped to the panel
  c.rect(ox + 6, oy + 7, 14, 18, film);
  c.outlineRect(ox + 6, oy + 7, 14, 18, OUTLINE);
  c.hline(ox + 7, oy + 8, 12, filmH);     // subtle film tone band
  // Tiny clips holding the film at the top
  c.px(ox + 9,  oy + 7, clipMet);
  c.px(ox + 16, oy + 7, clipMet);

  // Skull silhouette (cranium + jaw + eye/nasal cavities) — read as "x-ray" instantly
  // Cranium dome
  c.rect(ox + 9,  oy + 10, 8, 6, bone);
  c.px(ox + 8,   oy + 11,    bone);
  c.px(ox + 17,  oy + 11,    bone);
  c.px(ox + 8,   oy + 12,    bone);
  c.px(ox + 17,  oy + 12,    bone);
  c.px(ox + 9,   oy + 9,     bone);
  c.px(ox + 16,  oy + 9,     bone);
  // Cranium edge shading
  c.hline(ox + 9, oy + 15, 8, boneD);
  // Eye sockets (dark holes)
  c.rect(ox + 10, oy + 12, 2, 2, film);
  c.rect(ox + 14, oy + 12, 2, 2, film);
  // Nasal cavity
  c.px(ox + 12, oy + 14, film);
  c.px(ox + 13, oy + 14, film);
  c.px(ox + 12, oy + 15, film);
  // Cheekbones / jaw
  c.rect(ox + 9,  oy + 17, 8, 1, bone);
  c.rect(ox + 10, oy + 18, 6, 2, bone);
  c.hline(ox + 10, oy + 19, 6, boneD);
  // Teeth row (tiny vertical bone pips)
  c.px(ox + 11, oy + 20, bone);
  c.px(ox + 12, oy + 20, bone);
  c.px(ox + 13, oy + 20, bone);
  c.px(ox + 14, oy + 20, bone);
  // Top of spine peeking below
  c.rect(ox + 12, oy + 21, 2, 3, bone);
  c.px(ox + 12, oy + 23, boneD);
  c.px(ox + 13, oy + 23, boneD);

  // === Clipboard hung beside the light box (right side) ===
  // Peg / hook
  c.px(ox + 27, oy + 4, screw);
  c.vline(ox + 27, oy + 5, 1, screw);
  // Clipboard body
  c.rect(ox + 25, oy + 6, 5, 16, clipBoa);
  c.outlineRect(ox + 25, oy + 6, 5, 16, OUTLINE);
  c.vline(ox + 29, oy + 7, 14, clipBoaD);
  // Metal clip at top
  c.rect(ox + 26, oy + 5, 3, 2, clipMet);
  c.outlineRect(ox + 26, oy + 5, 3, 2, OUTLINE);
  // Paper
  c.rect(ox + 26, oy + 8, 3, 12, paper);
  c.outlineRect(ox + 26, oy + 8, 3, 12, OUTLINE);
  // Chart lines on paper (notes / vitals)
  c.hline(ox + 26, oy + 10, 3, ink);
  c.hline(ox + 26, oy + 12, 3, ink);
  c.hline(ox + 26, oy + 14, 3, ink);
  c.hline(ox + 26, oy + 16, 3, ink);
  // A red flag / urgent mark on the chart
  c.px(ox + 28, oy + 18, red);
  c.px(ox + 27, oy + 19, red);
}

// ----- Eagle: war map on a cork/wood board with red pins -----
function paintWarMap(c, ox, oy) {
  const cork = hex('#a47148');
  const corkD = hex('#7e5430');
  const paper = hex('#e8dcb5');
  const paperD = hex('#bca878');
  const ink = hex('#1d2238');
  const red = hex('#e84a4a');
  // board
  c.rect(ox+2, oy+3, 28, 26, cork);
  // wood texture stripes
  for (let y = oy+5; y < oy+28; y += 4) c.hline(ox+3, y, 26, corkD);
  c.outlineRect(ox+2, oy+3, 28, 26, OUTLINE);
  // paper map
  c.rect(ox+5, oy+6, 22, 18, paper);
  c.outlineRect(ox+5, oy+6, 22, 18, OUTLINE);
  // continents
  c.rect(ox+7, oy+9, 6, 4, paperD);
  c.rect(ox+15, oy+8, 9, 5, paperD);
  c.rect(ox+10, oy+15, 12, 6, paperD);
  // routes
  c.hline(ox+8, oy+11, 14, ink);
  c.vline(ox+12, oy+11, 8, ink);
  c.vline(ox+20, oy+10, 9, ink);
  // red pins
  c.rect(ox+11, oy+10, 2, 2, red);
  c.rect(ox+19, oy+18, 2, 2, red);
  c.rect(ox+24, oy+12, 2, 2, red);
}

// ----- MarketHunting: monitor with green candlestick chart -----
function paintTradingChart(c, ox, oy) {
  const bezel = hex('#1c2129');
  const screen = hex('#0a1a14');
  const grid = hex('#143b2a');
  const green = hex('#3ee27e');
  const greenD = hex('#1f8a4a');
  const red = hex('#e85b5b');
  const stand = hex('#2a2f3a');
  // monitor body
  c.rect(ox+2, oy+4, 28, 20, bezel);
  c.outlineRect(ox+2, oy+4, 28, 20, OUTLINE);
  // screen
  c.rect(ox+4, oy+6, 24, 16, screen);
  // grid
  for (let x = ox+6; x < ox+28; x += 4) c.vline(x, oy+7, 14, grid);
  for (let y = oy+9; y < oy+22; y += 3) c.hline(ox+5, y, 22, grid);
  // candlesticks (rising trend)
  const candles = [
    { x:  6, top: 17, bot: 20, dir: 'red' },
    { x:  9, top: 14, bot: 18, dir: 'green' },
    { x: 12, top: 12, bot: 16, dir: 'green' },
    { x: 15, top: 13, bot: 15, dir: 'red' },
    { x: 18, top: 10, bot: 14, dir: 'green' },
    { x: 21, top:  8, bot: 12, dir: 'green' },
    { x: 24, top:  9, bot: 11, dir: 'green' },
  ];
  candles.forEach(k => {
    const col = k.dir === 'green' ? green : red;
    const colD = k.dir === 'green' ? greenD : shade(red, 0.6);
    c.vline(ox + k.x + 1, oy + k.top - 1, k.bot - k.top + 3, colD);
    c.rect(ox + k.x, oy + k.top, 3, k.bot - k.top + 1, col);
  });
  // stand + base
  c.rect(ox+14, oy+24, 4, 4, stand);
  c.rect(ox+10, oy+27, 12, 2, stand);
  c.outlineRect(ox+10, oy+27, 12, 2, OUTLINE);
}

// ----- Sage: kettle with steam -----
function paintKettle(c, ox, oy) {
  const body = hex('#3d6c8a');
  const bodyD = hex('#274c66');
  const metal = hex('#cdd8e0');
  const wood = hex('#7c5438');
  const steam = [240, 240, 255, 200];
  // body (round-ish rectangle)
  c.rect(ox+8, oy+15, 16, 10, body);
  c.rect(ox+9, oy+13, 14, 2, body);
  c.rect(ox+10, oy+25, 12, 1, body);
  c.outlineRect(ox+8, oy+15, 16, 10, OUTLINE);
  c.outlineRect(ox+9, oy+13, 14, 2, OUTLINE);
  c.hline(ox+10, oy+26, 12, OUTLINE);
  // shading
  c.vline(ox+22, oy+15, 10, bodyD);
  c.vline(ox+23, oy+15, 10, bodyD);
  // spout
  c.rect(ox+24, oy+13, 5, 3, body);
  c.outlineRect(ox+24, oy+13, 5, 3, OUTLINE);
  c.rect(ox+27, oy+11, 2, 2, body);
  c.outlineRect(ox+27, oy+11, 2, 2, OUTLINE);
  // lid
  c.rect(ox+12, oy+10, 8, 3, body);
  c.outlineRect(ox+12, oy+10, 8, 3, OUTLINE);
  c.rect(ox+15, oy+8, 2, 2, metal);
  c.outlineRect(ox+15, oy+8, 2, 2, OUTLINE);
  // handle
  c.rect(ox+11, oy+6, 10, 2, wood);
  c.vline(ox+11, oy+7, 4, wood);
  c.vline(ox+20, oy+7, 4, wood);
  c.outlineRect(ox+11, oy+6, 10, 2, OUTLINE);
  // steam puffs (static — animated via CSS later)
  c.rect(ox+13, oy+3, 2, 2, steam);
  c.rect(ox+18, oy+1, 2, 2, steam);
  c.rect(ox+22, oy+4, 2, 2, steam);
}

// ----- Senku: 3 flasks in a wooden rack with bubbles -----
function paintFlaskRack(c, ox, oy) {
  const wood = hex('#7c5438');
  const woodD = hex('#5a3c25');
  const liquidA = hex('#7df0a0');
  const liquidB = hex('#7ad7ff');
  const liquidC = hex('#ffb863');
  const glass = hex('#dff4ff');
  // rack base
  c.rect(ox+2, oy+24, 28, 4, wood);
  c.outlineRect(ox+2, oy+24, 28, 4, OUTLINE);
  c.hline(ox+3, oy+25, 26, woodD);
  // rack top rail (with holes)
  c.rect(ox+2, oy+13, 28, 3, wood);
  c.outlineRect(ox+2, oy+13, 28, 3, OUTLINE);
  // verticals
  c.rect(ox+2, oy+13, 2, 12, wood);
  c.rect(ox+28, oy+13, 2, 12, wood);
  // 3 flasks: positions 7, 15, 23 (centered)
  const flasks = [
    { x: 7,  liquid: liquidA },
    { x: 15, liquid: liquidB },
    { x: 23, liquid: liquidC },
  ];
  flasks.forEach(f => {
    // neck
    c.rect(ox+f.x+1, oy+10, 2, 4, glass);
    // body (triangle-ish via stacked rects)
    c.rect(ox+f.x-1, oy+18, 6, 5, glass);
    c.rect(ox+f.x,   oy+16, 4, 2, glass);
    // liquid
    c.rect(ox+f.x-1, oy+20, 6, 3, f.liquid);
    c.rect(ox+f.x,   oy+19, 4, 1, f.liquid);
    // outlines
    c.outlineRect(ox+f.x+1, oy+10, 2, 4, OUTLINE);
    c.outlineRect(ox+f.x-1, oy+18, 6, 5, OUTLINE);
    c.outlineRect(ox+f.x,   oy+16, 4, 2, OUTLINE);
    // stopper
    c.rect(ox+f.x, oy+8, 4, 2, hex('#caa07a'));
    c.outlineRect(ox+f.x, oy+8, 4, 2, OUTLINE);
    // bubble
    c.rect(ox+f.x+1, oy+18, 1, 1, [255,255,255,200]);
  });
}

// ----- Shikamaru: shogi board on a low table -----
function paintShogiBoard(c, ox, oy) {
  const board = hex('#d8b780');
  const boardD = hex('#a37e4b');
  const grid = hex('#3a2a1a');
  const piece = hex('#c2924b');
  const pieceK = hex('#403122');
  // table legs
  c.rect(ox+5, oy+22, 3, 8, hex('#5b3d24'));
  c.rect(ox+24, oy+22, 3, 8, hex('#5b3d24'));
  c.outlineRect(ox+5, oy+22, 3, 8, OUTLINE);
  c.outlineRect(ox+24, oy+22, 3, 8, OUTLINE);
  // board top
  c.rect(ox+2, oy+8, 28, 16, board);
  c.outlineRect(ox+2, oy+8, 28, 16, OUTLINE);
  // bottom shadow
  c.hline(ox+3, oy+22, 26, boardD);
  c.hline(ox+3, oy+23, 26, boardD);
  // grid lines
  for (let x = ox+6; x <= ox+26; x += 4) c.vline(x, oy+10, 12, grid);
  for (let y = oy+12; y <= oy+22; y += 4) c.hline(ox+4, y, 24, grid);
  // pieces
  [[8,11],[12,11],[20,15],[16,19],[24,19]].forEach(([px, py]) => {
    c.rect(ox+px, oy+py, 4, 3, piece);
    c.outlineRect(ox+px, oy+py, 4, 3, OUTLINE);
    c.rect(ox+px+1, oy+py+1, 2, 1, pieceK);
  });
}

// ----- Tyrion: stack of ledgers + wine bottle + goblet -----
function paintLedgerWine(c, ox, oy) {
  const r = hex('#7a1f2c');
  const g = hex('#3f6b3a');
  const b = hex('#3a4a8c');
  const pages = hex('#e8dcb5');
  const gold = hex('#d4a64a');
  const bottle = hex('#1f3a25');
  const cork = hex('#a07050');
  const goblet = hex('#caa54a');
  // ledger 1 (bottom, red)
  c.rect(ox+3, oy+22, 14, 6, r);
  c.outlineRect(ox+3, oy+22, 14, 6, OUTLINE);
  c.hline(ox+4, oy+23, 12, gold);
  c.rect(ox+4, oy+25, 12, 1, pages);
  // ledger 2 (middle, green)
  c.rect(ox+5, oy+16, 13, 6, g);
  c.outlineRect(ox+5, oy+16, 13, 6, OUTLINE);
  c.hline(ox+6, oy+17, 11, gold);
  c.rect(ox+6, oy+19, 11, 1, pages);
  // ledger 3 (top, blue)
  c.rect(ox+4, oy+10, 12, 6, b);
  c.outlineRect(ox+4, oy+10, 12, 6, OUTLINE);
  c.hline(ox+5, oy+11, 10, gold);
  c.rect(ox+5, oy+13, 10, 1, pages);
  // wine bottle on right
  c.rect(ox+22, oy+8, 4, 14, bottle);
  c.rect(ox+23, oy+5, 2, 4, bottle);
  c.outlineRect(ox+22, oy+8, 4, 14, OUTLINE);
  c.outlineRect(ox+23, oy+5, 2, 4, OUTLINE);
  c.rect(ox+23, oy+3, 2, 2, cork);
  c.outlineRect(ox+23, oy+3, 2, 2, OUTLINE);
  // label
  c.rect(ox+22, oy+13, 4, 4, hex('#e8dcb5'));
  c.outlineRect(ox+22, oy+13, 4, 4, OUTLINE);
  c.hline(ox+23, oy+15, 2, OUTLINE);
  // goblet
  c.rect(ox+19, oy+22, 4, 4, goblet);
  c.outlineRect(ox+19, oy+22, 4, 4, OUTLINE);
  c.rect(ox+20, oy+26, 2, 2, goblet);
  c.rect(ox+19, oy+28, 4, 1, goblet);
  c.outlineRect(ox+19, oy+28, 4, 1, OUTLINE);
  // wine in goblet
  c.rect(ox+20, oy+23, 2, 2, r);
}

// ----- Harvey: tall filing cabinet with 3 drawers -----
function paintFilingCabinet(c, ox, oy) {
  const body = hex('#7a7e8a');
  const bodyD = hex('#52555f');
  const handle = hex('#1d2230');
  const label = hex('#ecd58a');
  // body
  c.rect(ox+6, oy+3, 20, 26, body);
  c.outlineRect(ox+6, oy+3, 20, 26, OUTLINE);
  // top
  c.rect(ox+5, oy+2, 22, 2, bodyD);
  c.outlineRect(ox+5, oy+2, 22, 2, OUTLINE);
  // drawers (3)
  for (let i = 0; i < 3; i++) {
    const yy = oy + 4 + i * 8;
    c.outlineRect(ox+7, yy, 18, 8, OUTLINE);
    // shading
    c.hline(ox+8, yy+7, 16, bodyD);
    // handle
    c.rect(ox+13, yy+3, 6, 2, handle);
    c.outlineRect(ox+13, yy+3, 6, 2, OUTLINE);
    // label slot
    c.rect(ox+9, yy+1, 5, 2, label);
    c.outlineRect(ox+9, yy+1, 5, 2, OUTLINE);
  }
  // base
  c.rect(ox+5, oy+28, 22, 2, bodyD);
  c.outlineRect(ox+5, oy+28, 22, 2, OUTLINE);
}

// ----- L: pile of candy/sweets on the floor -----
function paintCandyPile(c, ox, oy) {
  const stickColor = hex('#e8dcb5');
  const lollyR = hex('#ff7eb1');
  const lollyB = hex('#7adcff');
  const lollyG = hex('#a6e873');
  const wrap1 = hex('#ffd57a');
  const wrap2 = hex('#ffaa42');
  // floor shadow
  c.rect(ox+2, oy+26, 28, 3, [0,0,0,80]);
  // wrapped candies (twist on ends)
  // candy 1
  c.rect(ox+4, oy+22, 8, 5, wrap1);
  c.outlineRect(ox+4, oy+22, 8, 5, OUTLINE);
  c.rect(ox+2, oy+23, 2, 3, wrap1);
  c.rect(ox+12, oy+23, 2, 3, wrap1);
  // stripe
  c.vline(ox+7, oy+23, 3, wrap2);
  c.vline(ox+9, oy+23, 3, wrap2);
  // candy 2
  c.rect(ox+18, oy+24, 8, 4, hex('#a085ff'));
  c.outlineRect(ox+18, oy+24, 8, 4, OUTLINE);
  c.rect(ox+16, oy+25, 2, 2, hex('#a085ff'));
  c.rect(ox+26, oy+25, 2, 2, hex('#a085ff'));
  // lollipop 1 (red)
  c.rect(ox+10, oy+12, 8, 8, lollyR);
  c.outlineRect(ox+10, oy+12, 8, 8, OUTLINE);
  c.rect(ox+12, oy+14, 2, 2, [255,255,255,200]);
  c.rect(ox+13, oy+20, 2, 6, stickColor);
  c.outlineRect(ox+13, oy+20, 2, 6, OUTLINE);
  // lollipop 2 (blue, smaller, behind)
  c.rect(ox+19, oy+14, 6, 6, lollyB);
  c.outlineRect(ox+19, oy+14, 6, 6, OUTLINE);
  c.rect(ox+21, oy+15, 1, 1, [255,255,255,220]);
  c.rect(ox+21, oy+20, 2, 5, stickColor);
  c.outlineRect(ox+21, oy+20, 2, 5, OUTLINE);
  // lollipop 3 (green, top-left)
  c.rect(ox+3, oy+15, 5, 5, lollyG);
  c.outlineRect(ox+3, oy+15, 5, 5, OUTLINE);
  c.rect(ox+5, oy+20, 1, 4, stickColor);
}

// ----- D: condenser mic with pop filter on a stand -----
function paintCondenserMic(c, ox, oy) {
  const mic = hex('#dadde3');
  const micD = hex('#888c97');
  const grill = hex('#3a3f4a');
  const stand = hex('#1d2230');
  const filter = hex('#1f1730');
  const filterMesh = hex('#3a2a52');
  // base
  c.rect(ox+10, oy+27, 12, 2, stand);
  c.outlineRect(ox+10, oy+27, 12, 2, OUTLINE);
  // pole
  c.rect(ox+15, oy+12, 2, 15, stand);
  c.outlineRect(ox+15, oy+12, 2, 15, OUTLINE);
  // arm to mic
  c.rect(ox+13, oy+10, 8, 2, stand);
  c.outlineRect(ox+13, oy+10, 8, 2, OUTLINE);
  // mic body (vertical capsule)
  c.rect(ox+18, oy+5, 8, 10, mic);
  c.outlineRect(ox+18, oy+5, 8, 10, OUTLINE);
  // mic shading
  c.vline(ox+24, oy+6, 8, micD);
  // grill detail (horizontal stripes)
  for (let y = oy+6; y < oy+13; y += 2) c.hline(ox+19, y, 6, grill);
  // pop filter (circle to the left of mic)
  c.rect(ox+5, oy+5, 9, 9, filter);
  c.outlineRect(ox+5, oy+5, 9, 9, OUTLINE);
  // mesh dots
  for (let y = oy+6; y < oy+13; y++) {
    for (let x = ox+6; x < ox+13; x++) {
      if ((x + y) % 2 === 0) c.px(x, y, filterMesh);
    }
  }
  // filter neck
  c.rect(ox+13, oy+8, 2, 2, stand);
  c.outlineRect(ox+13, oy+8, 2, 2, OUTLINE);
}

// ---------- Build ----------

function build() {
  const W = SIZE;
  const H = SIZE * AGENTS.length;
  const c = new Canvas(W, H);
  AGENTS.forEach((id, row) => paint(c, 0, row * SIZE, id));
  return { png: encodePNG(W, H, c.buf), W, H };
}

const { png, W, H } = build();
const outPath = path.join(__dirname, '..', 'public', 'props.png');
fs.writeFileSync(outPath, png);
fs.writeFileSync(
  path.join(__dirname, '..', 'public', 'props.json'),
  JSON.stringify({ propWidth: SIZE, propHeight: SIZE, rows: AGENTS, sheetWidth: W, sheetHeight: H }, null, 2),
);
console.log(`Wrote ${png.length} bytes -> ${outPath}`);
console.log(`Sheet: ${W}x${H}, ${AGENTS.length} props`);
