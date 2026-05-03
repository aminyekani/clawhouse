#!/usr/bin/env node
// Per-agent desk monitor sheet — shared bezel/stand (matches MarketHunting trading-chart
// style), agent-specific screen content. 1 column x 9 rows of 32x32.
// Output: pixel-office/public/monitors.png
//
// Row order (must match SPRITE_ROWS in index.html):
//   0 main | 1 markethunting | 2 sage | 3 senku | 4 shikamaru
//   5 tyrion | 6 harvey | 7 l | 8 d

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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
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
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 255];
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

const OUTLINE = hex('#0a0e1a');
const SIZE = 32;
// First 9 rows: per-agent monitors (rows 0..8 match SPRITE_ROWS).
// Extra row 9 = MarketHunting secondary monitor (P&L line + volume bars).
const AGENTS = ['main', 'markethunting', 'sage', 'senku', 'shikamaru', 'tyrion', 'harvey', 'l', 'd', 'ephraim', 'house', 'markethunting2'];

// ---------- Shared bezel + stand (matches paintTradingChart in build-props.js) ----------
// Screen interior: x+4..x+27 inclusive, y+6..y+21 inclusive  =>  24 wide x 16 tall.
function paintBezel(c, ox, oy) {
  const bezel  = hex('#1c2129');
  const bezelD = hex('#0c0f15');
  const stand  = hex('#2a2f3a');
  const power  = hex('#3ee27e');
  // bezel
  c.rect(ox+2, oy+4, 28, 20, bezel);
  c.outlineRect(ox+2, oy+4, 28, 20, OUTLINE);
  c.hline(ox+3, oy+22, 26, bezelD);
  // tiny power LED
  c.px(ox+27, oy+22, power);
  // stand neck
  c.rect(ox+14, oy+24, 4, 4, stand);
  c.outlineRect(ox+14, oy+24, 4, 4, OUTLINE);
  // base
  c.rect(ox+10, oy+27, 12, 2, stand);
  c.outlineRect(ox+10, oy+27, 12, 2, OUTLINE);
}

// ---------- Per-agent screens (24x16 area starting at ox+4, oy+6) ----------

// Eagle — radar with target blip
function paintRadar(c, sx, sy) {
  const bg   = hex('#0a1c2a');
  const grid = hex('#1d3a52');
  const ring = hex('#3a6680');
  const sweep= hex('#56b8e8');
  const dot  = hex('#ff5050');
  c.rect(sx, sy, 24, 16, bg);
  c.hline(sx, sy+8, 24, grid);          // horizontal axis
  c.vline(sx+12, sy, 16, grid);         // vertical axis
  c.outlineRect(sx+8, sy+5, 9, 7, ring); // inner ring
  c.outlineRect(sx+3, sy+1, 19, 14, ring); // outer ring
  // diagonal sweep
  for (let i = 0; i < 9; i++) c.px(sx+12+i, sy+8-Math.floor(i*0.6), sweep);
  // target blip (top-right quadrant)
  c.rect(sx+18, sy+4, 2, 2, dot);
  c.px(sx+19, sy+5, hex('#ffb0b0'));
}

// MarketHunting — green candlestick chart (mirrors paintTradingChart)
function paintCandles(c, sx, sy) {
  const screen = hex('#0a1a14');
  const grid   = hex('#143b2a');
  const green  = hex('#3ee27e');
  const greenD = hex('#1f8a4a');
  const red    = hex('#e85b5b');
  const redD   = hex('#8b3838');
  c.rect(sx, sy, 24, 16, screen);
  for (let x = sx+2; x < sx+24; x += 4) c.vline(x, sy+1, 14, grid);
  for (let y = sy+3; y < sy+16; y += 3) c.hline(sx+1, y, 22, grid);
  // candles (rising trend)
  const candles = [
    { x:  1, t: 11, b: 14, up: false },
    { x:  4, t:  8, b: 12, up: true  },
    { x:  7, t:  6, b: 10, up: true  },
    { x: 10, t:  7, b:  9, up: false },
    { x: 13, t:  4, b:  8, up: true  },
    { x: 16, t:  2, b:  6, up: true  },
    { x: 19, t:  3, b:  5, up: true  },
  ];
  candles.forEach(k => {
    const col  = k.up ? green : red;
    const cold = k.up ? greenD : redD;
    c.vline(sx + k.x + 1, sy + k.t - 1, k.b - k.t + 3, cold);
    c.rect(sx + k.x, sy + k.t, 3, k.b - k.t + 1, col);
  });
}

// Sage — flowing prose lines (text scroll)
function paintTextScroll(c, sx, sy) {
  const screen = hex('#1a2a25');
  const text1  = hex('#cfe8d8');
  const text2  = hex('#7fb59c');
  const accent = hex('#f0c97a');
  c.rect(sx, sy, 24, 16, screen);
  // lines of "text" — alternating lengths, top header line in accent
  c.hline(sx+2, sy+1, 16, accent);    // title bar
  c.hline(sx+2, sy+3, 20, text1);
  c.hline(sx+2, sy+5, 16, text2);
  c.hline(sx+2, sy+7, 19, text1);
  c.hline(sx+2, sy+9, 14, text2);
  c.hline(sx+2, sy+11, 21, text1);
  c.hline(sx+2, sy+13, 12, text2);
}

// Senku — molecular structure (atoms + bonds)
function paintMolecule(c, sx, sy) {
  const screen = hex('#0d1822');
  const bond   = hex('#5a7a9a');
  const atomC  = hex('#ffffff'); // carbon
  const atomO  = hex('#ff6464'); // oxygen
  const atomN  = hex('#64a0ff'); // nitrogen
  const atomH  = hex('#7fffb0'); // bonus
  c.rect(sx, sy, 24, 16, screen);
  // backbone bonds
  // hexagon-ish layout
  const atoms = [
    { x: 5,  y: 4,  c: atomC },
    { x: 11, y: 2,  c: atomO },
    { x: 17, y: 4,  c: atomC },
    { x: 19, y: 10, c: atomN },
    { x: 13, y: 12, c: atomC },
    { x: 7,  y: 10, c: atomC },
    { x: 3,  y: 13, c: atomH },
    { x: 21, y: 13, c: atomH },
  ];
  // bonds (lines between sequential atoms, ring)
  const ringIdx = [0,1,2,3,4,5,0];
  for (let i = 0; i < ringIdx.length - 1; i++) {
    const a = atoms[ringIdx[i]], b = atoms[ringIdx[i+1]];
    drawLine(c, sx + a.x, sy + a.y, sx + b.x, sy + b.y, bond);
  }
  // outer pendants
  drawLine(c, sx + atoms[5].x, sy + atoms[5].y, sx + atoms[6].x, sy + atoms[6].y, bond);
  drawLine(c, sx + atoms[3].x, sy + atoms[3].y, sx + atoms[7].x, sy + atoms[7].y, bond);
  // atoms (circles → 3x3 squares)
  atoms.forEach(a => {
    c.rect(sx + a.x - 1, sy + a.y - 1, 3, 3, a.c);
    c.outlineRect(sx + a.x - 1, sy + a.y - 1, 3, 3, OUTLINE);
  });
}

// Shikamaru — shogi/go board overlay
function paintShogi(c, sx, sy) {
  const screen = hex('#1a1530');
  const grid   = hex('#5a4f8c');
  const piece1 = hex('#e8dcb5');
  const piece2 = hex('#3a2a1a');
  c.rect(sx, sy, 24, 16, screen);
  // 7x5 grid lines
  for (let i = 0; i <= 7; i++) c.vline(sx+1+i*3, sy+1, 14, grid);
  for (let j = 0; j <= 5; j++) c.hline(sx+1, sy+1+j*3-(j>5?1:0), 22, grid);
  // pieces (alternating)
  const pieces = [[1,1,1],[3,2,2],[5,1,1],[2,3,2],[4,4,1],[6,3,2]];
  pieces.forEach(([gx, gy, side]) => {
    const px = sx + 1 + gx * 3 - 1;
    const py = sy + 1 + gy * 3 - 1;
    const col = side === 1 ? piece1 : piece2;
    c.rect(px, py, 3, 2, col);
    c.outlineRect(px, py, 3, 2, OUTLINE);
  });
}

// Tyrion — ledger / treasury balances
function paintLedgerScreen(c, sx, sy) {
  const screen = hex('#1a1208');
  const gold   = hex('#d4a64a');
  const ink    = hex('#e8dcb5');
  const cell   = hex('#3a2818');
  c.rect(sx, sy, 24, 16, screen);
  // header bar
  c.hline(sx+1, sy+1, 22, gold);
  // 4 rows of "ledger entries": label + bar
  for (let r = 0; r < 4; r++) {
    const ry = sy + 3 + r * 3;
    c.hline(sx+2, ry, 5, ink);                     // label
    c.hline(sx+9, ry, 12, cell);                   // bar bg
    const fill = [11, 8, 13, 6][r];
    c.hline(sx+9, ry, fill, gold);                 // bar fill (varies)
  }
}

// Harvey — case docs / paper stack
function paintCaseDocs(c, sx, sy) {
  const screen = hex('#1d1825');
  const paper  = hex('#ecdcca');
  const paperS = hex('#b9a685');
  const ink    = hex('#3a2a1a');
  const stamp  = hex('#b8454a');
  c.rect(sx, sy, 24, 16, screen);
  // Paper 1 (back)
  c.rect(sx+3, sy+2, 14, 11, paper);
  c.outlineRect(sx+3, sy+2, 14, 11, OUTLINE);
  c.hline(sx+4, sy+3, 12, ink);
  c.hline(sx+4, sy+5, 10, paperS);
  c.hline(sx+4, sy+7, 11, paperS);
  c.hline(sx+4, sy+9, 9, paperS);
  // Paper 2 (front)
  c.rect(sx+8, sy+5, 13, 9, paper);
  c.outlineRect(sx+8, sy+5, 13, 9, OUTLINE);
  c.hline(sx+9, sy+6, 11, ink);
  c.hline(sx+9, sy+8, 10, paperS);
  c.hline(sx+9, sy+10, 8, paperS);
  // red stamp
  c.rect(sx+14, sy+11, 5, 2, stamp);
  c.outlineRect(sx+14, sy+11, 5, 2, OUTLINE);
}

// L — spreadsheet / audit tables
function paintSpreadsheet(c, sx, sy) {
  const screen = hex('#0e1422');
  const grid   = hex('#2a3a52');
  const cell   = hex('#1a2438');
  const hi     = hex('#4ae0a8');
  const text   = hex('#9ab8d8');
  c.rect(sx, sy, 24, 16, screen);
  // grid lines
  for (let i = 0; i <= 4; i++) c.vline(sx+i*5, sy, 16, grid);
  for (let j = 0; j <= 5; j++) c.hline(sx, sy+j*3, 24, grid);
  // header row (top)
  c.rect(sx+1, sy+1, 23, 2, cell);
  c.hline(sx+1, sy+1, 23, text);
  // sample data dashes
  for (let r = 1; r < 5; r++) {
    for (let col = 0; col < 4; col++) {
      const cx = sx + col*5 + 1;
      const cy = sy + r*3 + 1;
      c.hline(cx, cy, 3, text);
    }
  }
  // highlighted cell (audit hit)
  c.rect(sx+11, sy+7, 4, 2, hi);
}

// MarketHunting secondary — P&L line chart + volume histogram
function paintOrderFlow(c, sx, sy) {
  const screen   = hex('#0a1a14');
  const grid     = hex('#143b2a');
  const line     = hex('#62d0ff');
  const lineHi   = hex('#bfeaff');
  const green    = hex('#3ee27e');
  const red      = hex('#e85b5b');
  const divider  = hex('#1f4a35');
  c.rect(sx, sy, 24, 16, screen);
  // grid
  for (let x = sx+2; x < sx+24; x += 4) c.vline(x, sy+1, 14, grid);
  c.hline(sx+1, sy+8, 22, divider);
  // P&L line in upper half (y range 0..7)
  const yvals = [5,4,5,3,4,2,3,4,2,1,3,2,4,3,2,1,3,2,1,3,2,1,2,1];
  for (let x = 0; x < 24 - 1; x++) {
    drawLine(c, sx+x, sy+yvals[x], sx+x+1, sy+yvals[x+1], line);
  }
  // shimmer dot at end
  c.px(sx+23, sy+yvals[23], lineHi);
  // volume bars in lower half (y range 9..15)
  const vols = [3,5,4,2,6,5,3,7,4,2,5,6,3,4,5,2,6,4,3,5,7,5,4,6];
  const ups  = [false,true,true,false,true,true,false,true,true,false,true,true,
                false,false,true,false,true,true,false,true,true,true,false,true];
  for (let x = 0; x < 24; x++) {
    const v = Math.min(vols[x], 6);
    const col = ups[x] ? green : red;
    c.vline(sx+x, sy+15-v+1, v, col);
  }
}

// D — audio waveform / VU meters
function paintWaveform(c, sx, sy) {
  const screen = hex('#1a0e22');
  const grid   = hex('#3a2052');
  const wave   = hex('#ff8ccd');
  const waveD  = hex('#a04080');
  const peak   = hex('#ffe07a');
  c.rect(sx, sy, 24, 16, screen);
  // center axis
  c.hline(sx, sy+8, 24, grid);
  // waveform — sine-ish
  for (let x = 0; x < 24; x++) {
    const ph = Math.sin((x / 24) * Math.PI * 4);
    const amp = Math.round(ph * 5);
    if (amp >= 0) {
      c.vline(sx + x, sy + 8 - amp, amp + 1, wave);
    } else {
      c.vline(sx + x, sy + 8, -amp + 1, waveD);
    }
  }
  // peak ticks at top
  for (let i = 2; i < 24; i += 4) c.px(sx + i, sy + 1, peak);
}

// Ephraim — training plan readout: stacked weekly bars (volume) + RPE dots
function paintTrainingPlan(c, sx, sy) {
  const screen = hex('#0f1614');
  const grid   = hex('#1f3328');
  const bar    = hex('#3ec27e');
  const barHi  = hex('#7df9d0');
  const rpe    = hex('#f0c060');
  const rpeHi  = hex('#fff0b0');
  const text   = hex('#9ad8b8');
  c.rect(sx, sy, 24, 16, screen);
  // top header strip (week label)
  c.hline(sx, sy, 24, grid);
  c.hline(sx+1, sy+1, 22, text);
  // 7 vertical day-bars (volume blocks), heights 1..6
  const heights = [3, 4, 0, 5, 2, 6, 1];
  for (let d = 0; d < 7; d++) {
    const bx = sx + 1 + d * 3;
    const h  = heights[d];
    if (h === 0) continue;
    c.vline(bx, sy + 14 - h, h, bar);
    c.px(bx + 1, sy + 14 - h, barHi);
  }
  // RPE row across the top of the chart area (one dot per day, height encodes RPE)
  const rpes = [6, 7, 0, 8, 5, 9, 4];
  for (let d = 0; d < 7; d++) {
    if (rpes[d] === 0) continue;
    const bx = sx + 1 + d * 3;
    const ry = sy + 12 - Math.max(0, rpes[d] - 4);
    c.px(bx, ry, rpe);
    if (rpes[d] >= 8) c.px(bx, ry - 1, rpeHi);
  }
  // baseline
  c.hline(sx, sy + 15, 24, grid);
}

// House — patient monitor: ECG trace + vitals (HR / SpO2) readouts
function paintMedicalChart(c, sx, sy) {
  const screen = hex('#0a1620');
  const grid   = hex('#163048');
  const ecg    = hex('#3ee27e');     // green ECG trace
  const ecgHi  = hex('#a9ffce');
  const cyan   = hex('#7fdcff');     // SpO2 wave
  const cyanHi = hex('#d9f6ff');
  const red    = hex('#ff6464');     // HR / alert color
  const amber  = hex('#f0c97a');
  const text   = hex('#cfe8ff');
  c.rect(sx, sy, 24, 16, screen);
  // grid (dot pattern)
  for (let x = sx + 1; x < sx + 24; x += 4) c.vline(x, sy + 1, 14, grid);
  for (let y = sy + 3; y < sy + 16; y += 3) c.hline(sx + 1, y, 22, grid);

  // Top vitals strip (HR, SpO2 numeric labels)
  // "HR" pip + value pip + "SpO2" pip + value pip — schematic only at this scale
  c.px(sx + 1, sy + 1, red);                // HR indicator dot
  c.hline(sx + 3, sy + 1, 4, text);         // "HR" digits placeholder
  c.px(sx + 13, sy + 1, cyan);              // SpO2 indicator dot
  c.hline(sx + 15, sy + 1, 6, text);        // SpO2 digits placeholder

  // ECG trace baseline (rows 5..8) — flat line interrupted by a QRS spike
  const baseY = sy + 7;
  c.hline(sx + 1, baseY, 22, ecg);
  // P wave (small bump)
  c.px(sx + 5,  baseY - 1, ecg);
  // QRS complex — sharp downstroke then big upstroke then return
  c.px(sx + 8,  baseY + 1, ecg);
  c.px(sx + 9,  baseY - 2, ecgHi);
  c.px(sx + 9,  baseY - 3, ecgHi);
  c.px(sx + 9,  baseY - 4, ecgHi);
  c.px(sx + 10, baseY - 1, ecg);
  c.px(sx + 11, baseY + 2, ecg);
  c.px(sx + 12, baseY + 1, ecg);
  // T wave (rounded bump)
  c.px(sx + 15, baseY - 1, ecg);
  c.px(sx + 16, baseY - 2, ecg);
  c.px(sx + 17, baseY - 1, ecg);

  // SpO2 plethysmograph trace lower (rows 11..13) — gentler sine-ish wave
  const baseY2 = sy + 12;
  c.hline(sx + 1, baseY2, 22, cyan);
  c.px(sx + 4,  baseY2 - 1, cyan);
  c.px(sx + 5,  baseY2 - 2, cyanHi);
  c.px(sx + 6,  baseY2 - 1, cyan);
  c.px(sx + 12, baseY2 - 1, cyan);
  c.px(sx + 13, baseY2 - 2, cyanHi);
  c.px(sx + 14, baseY2 - 1, cyan);
  c.px(sx + 20, baseY2 - 1, cyan);

  // Bottom alarm strip — a subtle amber "VENT/RR" bar
  c.hline(sx + 1, sy + 14, 6, amber);
}

// ---------- Helpers ----------

function drawLine(c, x0, y0, x1, y1, color) {
  // Bresenham
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  while (true) {
    c.px(x, y, color);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

const SCREENS = {
  main:           paintRadar,
  markethunting:  paintCandles,
  sage:           paintTextScroll,
  senku:          paintMolecule,
  shikamaru:      paintShogi,
  tyrion:         paintLedgerScreen,
  harvey:         paintCaseDocs,
  l:              paintSpreadsheet,
  d:              paintWaveform,
  markethunting2: paintOrderFlow,
  ephraim:        paintTrainingPlan,
  house:          paintMedicalChart,
};

// ---------- Build ----------

function build() {
  const W = SIZE;
  const H = SIZE * AGENTS.length;
  const c = new Canvas(W, H);
  AGENTS.forEach((id, row) => {
    const oy = row * SIZE;
    paintBezel(c, 0, oy);
    SCREENS[id](c, 4, oy + 6);
  });
  return { png: encodePNG(W, H, c.buf), W, H };
}

const { png, W, H } = build();
const outPath = path.join(__dirname, '..', 'public', 'monitors.png');
fs.writeFileSync(outPath, png);
fs.writeFileSync(
  path.join(__dirname, '..', 'public', 'monitors.json'),
  JSON.stringify({ cellWidth: SIZE, cellHeight: SIZE, rows: AGENTS, sheetWidth: W, sheetHeight: H }, null, 2),
);
console.log(`Wrote ${png.length} bytes -> ${outPath}`);
console.log(`Sheet: ${W}x${H}, ${AGENTS.length} monitors`);
