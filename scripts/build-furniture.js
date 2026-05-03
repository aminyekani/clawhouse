#!/usr/bin/env node
// Furniture sprite sheet: desk tile + monitor + 3 decor pieces.
// Output: pixel-office/public/furniture.png
//
// Sheet (32 wide):
//   y=0..15    32x16 desk tile — oak (default), tileable, has 2 legs per tile
//   y=16..39   32x24 monitor
//   y=40..71   32x32 window-wide (generic sky, fallback)
//   y=72..103  32x32 window-tall (unused, narrow 3-pane)
//   y=104..135 32x32 door
//   y=136..167 32x32 window-eagle      (mountains + grass)
//   y=168..199 32x32 window-market     (city highrise night)
//   y=200..231 32x32 window-sage       (zen garden / bamboo dawn)
//   y=232..263 32x32 window-senku      (starfield + planet)
//   y=264..295 32x32 window-shikamaru  (dusk clouds + hills)
//   y=296..327 32x32 window-l          (rainy city night)
//   y=328..399 32x72 chair (mesh-back office chair w/ pedestal + 5-leg star)
//   y=400..415 32x16 floor plank tile (warm oak)
//   y=416..431 32x16 floor plank tile (pale ash)
//   y=432..447 32x16 floor plank tile (cherry)
//   y=448..463 32x16 floor plank tile (graphite)
//   y=464..479 32x16 desk tile — steel + glass (hairpin legs)
//   y=480..495 32x16 desk tile — walnut exec (chunky dark legs)
//   y=496..511 32x16 desk tile — white modern (chrome cylinder legs)
// Sheet total: 32 x 512

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

const OUTLINE = hex('#1d1622');

// ---------- Painters ----------

// Desk tile (32x16, tileable) — desktop + apron only. Legs are drawn via CSS
// ::before/::after pseudo-elements so they appear at the actual desk endpoints
// rather than repeating through every tile.
//
// Layout within tile:
//   y=0..7   desktop surface (top edge, highlight, surface, transition, apron)
//   y=8..15  transparent (legs are CSS)
function paintDeskTilePalette(c, ox, oy, p) {
  c.hline(ox, oy + 0, 32, OUTLINE);                          // top edge
  c.hline(ox, oy + 1, 32, p.highlight);                      // light top
  c.hline(ox, oy + 2, 32, p.surface);                        // surface
  c.hline(ox, oy + 3, 32, OUTLINE);                          // top->apron transition
  for (let yy = 4; yy <= 6; yy++) c.hline(ox, oy + yy, 32, p.apron); // apron face
  c.hline(ox, oy + 7, 32, p.apronDark);                      // apron bottom shadow
  if (p.grain) {
    c.rect(ox + 5,  oy + 2, 6, 1, p.grain);
    c.rect(ox + 19, oy + 2, 4, 1, p.grain);
  }
  // y=8..15 intentionally left transparent — legs are CSS
}
const DESK_PALETTES = {
  oak: {
    highlight: hex('#c89867'), surface: hex('#a07449'),
    apron: hex('#7a532e'),     apronDark: hex('#5b3c1f'),
    grain: hex('#4a2e15'),
    leg: hex('#7a532e'), legH: hex('#a07449'), legD: hex('#4a2e15'),
    legShape: 'block', shadow: hex('#241a0e'),
  },
  steel: {
    highlight: hex('#cdd5e8'), surface: hex('#9aa3bf'),
    apron: hex('#3a4156'),     apronDark: hex('#1f2533'),
    grain: null,
    leg: hex('#1a1d2a'), legH: hex('#3a4156'), legD: hex('#0d0f17'),
    legShape: 'hairpin', shadow: hex('#0c0e16'),
  },
  walnut: {
    highlight: hex('#8a5638'), surface: hex('#5e3520'),
    apron: hex('#3e2114'),     apronDark: hex('#26140a'),
    grain: hex('#1a0d06'),
    leg: hex('#3e2114'), legH: hex('#5e3520'), legD: hex('#1a0d06'),
    legShape: 'block', shadow: hex('#0e0703'),
  },
  white: {
    highlight: hex('#ffffff'), surface: hex('#e8ecf4'),
    apron: hex('#c4cad6'),     apronDark: hex('#9aa1b3'),
    grain: null,
    leg: hex('#cdd2dc'), legH: hex('#ffffff'), legD: hex('#7d8395'),
    legShape: 'cylinder', shadow: hex('#5a607080'),
  },
};
function paintDeskTile(c, ox, oy)        { paintDeskTilePalette(c, ox, oy, DESK_PALETTES.oak); }
function paintDeskTileSteel(c, ox, oy)   { paintDeskTilePalette(c, ox, oy, DESK_PALETTES.steel); }
function paintDeskTileWalnut(c, ox, oy)  { paintDeskTilePalette(c, ox, oy, DESK_PALETTES.walnut); }
function paintDeskTileWhite(c, ox, oy)   { paintDeskTilePalette(c, ox, oy, DESK_PALETTES.white); }

// Monitor (32x24) — bezel + screen with scanlines + stand.
function paintMonitor(c, ox, oy) {
  const bezel    = hex('#1c2129');
  const bezelD   = hex('#0c0f15');
  const screenBg = hex('#0d1c2a');
  const glow     = hex('#1d3d5a');
  const scan     = hex('#2a4f72');
  const stand    = hex('#2a2f3a');
  const standD   = hex('#15181f');
  const power    = hex('#3ee27e');

  c.rect(ox, oy, 32, 16, bezel);
  c.outlineRect(ox, oy, 32, 16, OUTLINE);
  c.hline(ox + 1, oy + 14, 30, bezelD);
  c.rect(ox + 3, oy + 2, 26, 11, screenBg);
  c.outlineRect(ox + 3, oy + 2, 26, 11, OUTLINE);
  c.rect(ox + 4, oy + 3, 24, 9, screenBg);
  for (let yy = 4; yy <= 11; yy += 2) c.hline(ox + 4, oy + yy, 24, scan);
  c.rect(ox + 5, oy + 4, 6, 3, glow);
  c.rect(ox + 27, oy + 14, 1, 1, power);

  c.rect(ox + 14, oy + 16, 4, 4, stand);
  c.outlineRect(ox + 14, oy + 16, 4, 4, OUTLINE);
  c.rect(ox + 6, oy + 20, 20, 4, stand);
  c.outlineRect(ox + 6, oy + 20, 20, 4, OUTLINE);
  c.hline(ox + 7, oy + 22, 18, standD);
}

// Decor: 4-pane window (32x24 painted inside a 32x32 cell at y=4..27).
function paintWindowWide(c, ox, oy) {
  const frame    = hex('#7c5b3c');
  const frameH   = hex('#a67d52');
  const frameD   = hex('#5a3f25');
  const sky      = hex('#9fdcff');
  const skyD     = hex('#5fa8d8');
  const cloud    = hex('#ecf6ff');
  const sill     = hex('#3a2818');

  const x = ox, y = oy + 4;
  // outer frame
  c.rect(x, y, 32, 24, frame);
  c.outlineRect(x, y, 32, 24, OUTLINE);
  // sill (thicker bottom)
  c.rect(x - 1, y + 22, 34, 4, frame);
  c.outlineRect(x - 1, y + 22, 34, 4, OUTLINE);
  c.hline(x, y + 25, 32, sill);
  c.hline(x, y + 23, 32, frameH);
  // glass area inset 3px
  c.rect(x + 3, y + 3, 26, 17, sky);
  c.outlineRect(x + 3, y + 3, 26, 17, OUTLINE);
  // sky gradient (lower half darker)
  c.rect(x + 4, y + 12, 24, 7, skyD);
  // clouds
  c.rect(x + 6, y + 6, 5, 2, cloud);
  c.rect(x + 8, y + 5, 4, 2, cloud);
  c.rect(x + 18, y + 8, 6, 2, cloud);
  // cross divider (one vertical, one horizontal)
  c.vline(x + 15, y + 3, 17, frameD);
  c.vline(x + 16, y + 3, 17, frame);
  c.hline(x + 3, y + 11, 26, frameD);
  c.hline(x + 3, y + 12, 26, frame);
}

// Decor: tall narrow window (18x30 painted inside 32x32 cell, x-centered, y=1..30).
function paintWindowTall(c, ox, oy) {
  const frame    = hex('#5a4a6a');
  const frameH   = hex('#7e6a92');
  const frameD   = hex('#3a2c4f');
  const sky      = hex('#7d9fc5');
  const skyD     = hex('#4d6c95');
  const sill     = hex('#2a1f3a');

  const w = 18, h = 30;
  const x = ox + Math.floor((32 - w) / 2);  // 7
  const y = oy + 1;
  // frame
  c.rect(x, y, w, h, frame);
  c.outlineRect(x, y, w, h, OUTLINE);
  c.hline(x, y + 1, w, frameH);
  // sill (slightly wider)
  c.rect(x - 1, y + h - 3, w + 2, 3, frame);
  c.outlineRect(x - 1, y + h - 3, w + 2, 3, OUTLINE);
  c.hline(x, y + h - 1, w, sill);
  // glass inset 3px
  c.rect(x + 3, y + 3, w - 6, h - 9, sky);
  c.outlineRect(x + 3, y + 3, w - 6, h - 9, OUTLINE);
  // sky shading
  c.rect(x + 4, y + 12, w - 8, h - 19, skyD);
  // 2 vertical mullions creating 3 panes
  c.vline(x + 7,  y + 3, h - 9, frameD);
  c.vline(x + 8,  y + 3, h - 9, frame);
  c.vline(x + 11, y + 3, h - 9, frameD);
  c.vline(x + 12, y + 3, h - 9, frame);
  // top arch detail
  c.hline(x + 3, y + 5, w - 6, frameD);
  c.hline(x + 3, y + 6, w - 6, frame);
}

// Decor: solid door (18x30 painted inside 32x32 cell, x-centered, y=2..31).
function paintDoor(c, ox, oy) {
  const wood     = hex('#6e4423');
  const woodH    = hex('#8d5a30');
  const woodD    = hex('#4a2c14');
  const panelD   = hex('#3a210e');
  const knob     = hex('#d4a64a');
  const knobD    = hex('#8a6a23');
  const frame    = hex('#3d2814');

  const w = 18, h = 30;
  const x = ox + Math.floor((32 - w) / 2);  // 7
  const y = oy + 2;
  // door frame (darker rim)
  c.rect(x - 1, y - 1, w + 2, h + 2, frame);
  c.outlineRect(x - 1, y - 1, w + 2, h + 2, OUTLINE);
  // door body
  c.rect(x, y, w, h, wood);
  c.outlineRect(x, y, w, h, OUTLINE);
  // top highlight
  c.hline(x + 1, y + 1, w - 2, woodH);
  c.vline(x + 1, y + 1, h - 2, woodH);
  // bottom + right shadow
  c.hline(x + 1, y + h - 2, w - 2, woodD);
  c.vline(x + w - 2, y + 1, h - 2, woodD);
  // upper panel
  c.outlineRect(x + 3, y + 3, w - 6, 10, panelD);
  c.hline(x + 4, y + 4, w - 8, woodD);
  // lower panel
  c.outlineRect(x + 3, y + 16, w - 6, 11, panelD);
  c.hline(x + 4, y + 17, w - 8, woodD);
  // doorknob (right side, mid-height)
  c.rect(x + w - 4, y + 14, 2, 2, knob);
  c.outlineRect(x + w - 4, y + 14, 2, 2, OUTLINE);
  c.px(x + w - 4, y + 14, knobD);
}

// Decor: Eagle's window — mountain peaks + grass (32x32, frame matches window-wide).
function paintWindowEagle(c, ox, oy) {
  const frame  = hex('#6a7a8a');  // steel-blue frame (commander's room)
  const frameH = hex('#8ea0b0');
  const frameD = hex('#4a5a6a');
  const sill   = hex('#2a3340');
  const skyTop = hex('#5ba3d0');  // deep blue sky
  const skyMid = hex('#78bce0');
  const skyHrz = hex('#aad8f0');  // horizon haze
  const mtnFar = hex('#5c6e82');  // far ridge (lighter, hazy)
  const mtnMid = hex('#3d5165');  // mid mountain
  const mtnNear= hex('#2a3f52');  // near foreground ridge
  const snow   = hex('#ddeeff');
  const snowD  = hex('#b8d0e8');
  const grass  = hex('#4a9042');
  const grassD = hex('#2f6b2b');
  const grassH = hex('#6ab85e');

  const x = ox, y = oy + 4;

  // Frame (same shape as window-wide)
  c.rect(x, y, 32, 24, frame);
  c.outlineRect(x, y, 32, 24, OUTLINE);
  c.rect(x - 1, y + 22, 34, 4, frame);
  c.outlineRect(x - 1, y + 22, 34, 4, OUTLINE);
  c.hline(x, y + 25, 32, sill);
  c.hline(x, y + 23, 32, frameH);

  // Glass
  c.rect(x + 3, y + 3, 26, 17, skyTop);
  c.outlineRect(x + 3, y + 3, 26, 17, OUTLINE);
  c.rect(x + 4, y + 4, 24, 4, skyTop);
  c.rect(x + 4, y + 8, 24, 3, skyMid);
  c.rect(x + 4, y + 11, 24, 2, skyHrz);  // horizon haze

  // Far ridge (subtle, low, hazy)
  for (let i = 0; i < 26; i++) {
    const h = 2 + Math.round(Math.sin(i * 0.45) * 1.2 + Math.sin(i * 0.9) * 0.8);
    c.vline(x + 3 + i, y + 12 - h, h, mtnFar);
  }

  // Mid mountain — left peak
  for (let r = 0; r < 6; r++) {
    const w = Math.max(1, 11 - r * 2);
    c.hline(x + 4 + r, y + 15 - r, w, mtnMid);
  }
  // Mid mountain — right peak
  for (let r = 0; r < 5; r++) {
    const w = Math.max(1, 9 - r * 2);
    c.hline(x + 18 + r, y + 15 - r, w, mtnMid);
  }

  // Center main peak (tallest, dark)
  for (let r = 0; r < 9; r++) {
    const w = Math.max(1, 16 - r * 2);
    c.hline(x + 3 + r + 4, y + 16 - r, w, mtnNear);
  }
  // Snow cap center
  c.px(x + 15, y + 7, snow);
  c.hline(x + 14, y + 8, 3, snow);
  c.hline(x + 13, y + 9, 5, snow);
  c.hline(x + 13, y + 10, 5, snowD);
  // Snow cap left mid
  c.px(x + 9, y + 10, snow);
  c.hline(x + 8, y + 11, 3, snowD);

  // Grass strip
  c.rect(x + 4, y + 16, 24, 3, grass);
  c.hline(x + 4, y + 16, 24, grassH);
  c.hline(x + 4, y + 18, 24, grassD);

  // Cross dividers
  c.vline(x + 15, y + 3, 17, frameD);
  c.vline(x + 16, y + 3, 17, frame);
  c.hline(x + 3, y + 11, 26, frameD);
  c.hline(x + 3, y + 12, 26, frame);
}

// Shared helpers for the per-agent window scenes.
function paintWindowShell(c, ox, oy, frame, frameH, sill) {
  const x = ox, y = oy + 4;
  c.rect(x, y, 32, 24, frame);
  c.outlineRect(x, y, 32, 24, OUTLINE);
  c.rect(x - 1, y + 22, 34, 4, frame);
  c.outlineRect(x - 1, y + 22, 34, 4, OUTLINE);
  c.hline(x, y + 25, 32, sill);
  c.hline(x, y + 23, 32, frameH);
}
function paintWindowDividers(c, ox, oy, frame, frameD) {
  const x = ox, y = oy + 4;
  c.vline(x + 15, y + 3, 17, frameD);
  c.vline(x + 16, y + 3, 17, frame);
  c.hline(x + 3, y + 11, 26, frameD);
  c.hline(x + 3, y + 12, 26, frame);
}

// MarketHunting — city skyline at night, lit windows in skyscrapers.
function paintWindowMarket(c, ox, oy) {
  const frame  = hex('#3a3f4a');
  const frameH = hex('#5a5f6a');
  const frameD = hex('#1a1f24');
  const sill   = hex('#0a0e1a');
  const skyTop = hex('#1a2342');
  const skyMid = hex('#2a3a5a');
  const skyHrz = hex('#3a5078');
  const bldg   = hex('#0e131e');
  const bldg2  = hex('#1a2030');
  const win1   = hex('#ffd44a');
  const win2   = hex('#62d0ff');
  const moon   = hex('#f0f4ff');

  paintWindowShell(c, ox, oy, frame, frameH, sill);
  const x = ox, y = oy + 4;
  c.rect(x + 3, y + 3, 26, 17, skyTop);
  c.outlineRect(x + 3, y + 3, 26, 17, OUTLINE);
  c.rect(x + 4, y + 7, 24, 4, skyMid);
  c.rect(x + 4, y + 11, 24, 2, skyHrz);
  // Moon (top-right of glass)
  c.rect(x + 23, y + 5, 2, 2, moon);
  c.px(x + 24, y + 5, hex('#c8d0e0'));
  // Skyline
  const buildings = [
    { x: 4,  h: 8,  col: bldg2 },
    { x: 7,  h: 12, col: bldg  },
    { x: 11, h: 6,  col: bldg2 },
    { x: 14, h: 14, col: bldg  },
    { x: 18, h: 9,  col: bldg2 },
    { x: 21, h: 11, col: bldg  },
    { x: 25, h: 7,  col: bldg2 },
  ];
  buildings.forEach(b => c.rect(x + b.x, y + 19 - b.h, 3, b.h, b.col));
  // Lit windows
  [[8,10,win1],[8,13,win2],[9,11,win1],
   [15,7,win1],[15,10,win2],[16,9,win1],[15,13,win1],[16,16,win2],
   [22,11,win1],[23,13,win2],[22,15,win1]].forEach(([px, py, col]) => c.px(x + px, y + py, col));
  paintWindowDividers(c, ox, oy, frame, frameD);
}

// Sage — zen garden at dawn, bamboo + cherry blossoms.
function paintWindowSage(c, ox, oy) {
  const frame  = hex('#7c5b3c');
  const frameH = hex('#a67d52');
  const frameD = hex('#5a3f25');
  const sill   = hex('#3a2818');
  const skyTop = hex('#ffd8a8');
  const skyMid = hex('#ffe8c8');
  const ground = hex('#d4b888');
  const groundD= hex('#a08858');
  const bamboo = hex('#5a8a3a');
  const bambooD= hex('#3d6a25');
  const blossom= hex('#ffb0c8');
  const blossomD= hex('#ff8aa8');
  const trunkD = hex('#3a2818');

  paintWindowShell(c, ox, oy, frame, frameH, sill);
  const x = ox, y = oy + 4;
  c.rect(x + 3, y + 3, 26, 17, skyTop);
  c.outlineRect(x + 3, y + 3, 26, 17, OUTLINE);
  c.rect(x + 4, y + 8, 24, 6, skyMid);
  c.rect(x + 4, y + 14, 24, 5, ground);
  c.hline(x + 4, y + 14, 24, groundD);
  // Bamboo
  [6, 11, 22].forEach(bx => {
    c.vline(x + bx, y + 4, 14, bambooD);
    c.vline(x + bx + 1, y + 4, 14, bamboo);
    for (let s = 0; s < 4; s++) c.hline(x + bx, y + 6 + s * 3, 2, trunkD);
  });
  // Cherry blossoms
  [{ bx: 16, by: 7 }, { bx: 19, by: 5 }, { bx: 14, by: 10 }, { bx: 25, by: 8 }].forEach(p => {
    c.rect(x + p.bx, y + p.by, 2, 2, blossom);
    c.px(x + p.bx, y + p.by, blossomD);
  });
  paintWindowDividers(c, ox, oy, frame, frameD);
}

// Senku — starfield with planet + rings.
function paintWindowSenku(c, ox, oy) {
  const frame  = hex('#4a5a78');
  const frameH = hex('#6a7a98');
  const frameD = hex('#2a3a58');
  const sill   = hex('#1a2030');
  const skyTop = hex('#0a0e22');
  const skyMid = hex('#15203a');
  const star1  = hex('#ffffff');
  const star2  = hex('#a0c8ff');
  const planet = hex('#a878ff');
  const planetD= hex('#683da8');
  const ring   = hex('#d0a878');
  const ringD  = hex('#a07848');

  paintWindowShell(c, ox, oy, frame, frameH, sill);
  const x = ox, y = oy + 4;
  c.rect(x + 3, y + 3, 26, 17, skyTop);
  c.outlineRect(x + 3, y + 3, 26, 17, OUTLINE);
  c.rect(x + 4, y + 12, 24, 7, skyMid);
  // Stars
  [[6,5,star1],[9,4,star2],[11,7,star1],[13,5,star2],[25,6,star2],[27,5,star1],
   [7,11,star2],[12,13,star1],[10,16,star2],[25,14,star1],[6,17,star1]].forEach(([sx,sy,col]) => c.px(x+sx, y+sy, col));
  // Planet
  c.rect(x + 17, y + 6, 6, 5, planet);
  c.outlineRect(x + 17, y + 6, 6, 5, OUTLINE);
  c.rect(x + 21, y + 7, 1, 3, planetD);
  c.px(x + 22, y + 8, planetD);
  // Ring (horizontal)
  c.hline(x + 15, y + 8, 10, ring);
  c.px(x + 14, y + 8, ringD);
  c.px(x + 25, y + 8, ringD);
  paintWindowDividers(c, ox, oy, frame, frameD);
}

// Shikamaru — dusk clouds and rolling hills (lazy "cloud-watching" view).
function paintWindowShikamaru(c, ox, oy) {
  const frame  = hex('#5a4a6a');
  const frameH = hex('#7e6a92');
  const frameD = hex('#3a2c4f');
  const sill   = hex('#2a1f3a');
  const skyTop = hex('#7c5a8a');
  const skyMid = hex('#e89878');
  const skyBot = hex('#ffb878');
  const cloud  = hex('#ffd0c0');
  const cloudD = hex('#c89878');
  const hill   = hex('#3a2848');
  const hillH  = hex('#5a3868');

  paintWindowShell(c, ox, oy, frame, frameH, sill);
  const x = ox, y = oy + 4;
  c.rect(x + 3, y + 3, 26, 17, skyTop);
  c.outlineRect(x + 3, y + 3, 26, 17, OUTLINE);
  c.rect(x + 4, y + 7, 24, 4, skyMid);
  c.rect(x + 4, y + 11, 24, 4, skyBot);
  // Clouds
  c.rect(x + 6, y + 5, 6, 2, cloud);
  c.rect(x + 5, y + 6, 8, 1, cloudD);
  c.rect(x + 18, y + 8, 7, 2, cloud);
  c.rect(x + 17, y + 9, 9, 1, cloudD);
  c.rect(x + 9, y + 10, 5, 1, cloud);
  // Hills
  for (let i = 0; i < 26; i++) {
    const h = 2 + Math.round(Math.sin(i * 0.5) * 1.5 + Math.sin(i * 1.2) * 0.8);
    const hh = Math.max(1, h);
    c.vline(x + 3 + i, y + 19 - hh, hh, hill);
  }
  c.hline(x + 4, y + 16, 24, hillH);
  paintWindowDividers(c, ox, oy, frame, frameD);
}

// L — rainy night cityscape (audit bunker view).
function paintWindowL(c, ox, oy) {
  const frame  = hex('#3a3a4a');
  const frameH = hex('#5a5a6a');
  const frameD = hex('#1a1a2a');
  const sill   = hex('#0a0a14');
  const skyTop = hex('#101422');
  const skyMid = hex('#1a1f30');
  const rain   = hex('#5a7088');
  const rainH  = hex('#8aa0b8');
  const bldg   = hex('#0a0e1a');
  const win    = hex('#5a8aa8');

  paintWindowShell(c, ox, oy, frame, frameH, sill);
  const x = ox, y = oy + 4;
  c.rect(x + 3, y + 3, 26, 17, skyTop);
  c.outlineRect(x + 3, y + 3, 26, 17, OUTLINE);
  c.rect(x + 4, y + 11, 24, 8, skyMid);
  // Rain droplets (small diagonal streaks)
  const drops = [
    [5, 4], [9, 3], [14, 5], [18, 4], [22, 3], [26, 5],
    [6, 9], [11, 8], [16, 10], [20, 9], [24, 8],
    [4, 14], [8, 13], [13, 15], [17, 14], [21, 13], [25, 15],
  ];
  drops.forEach(([dx, dy]) => {
    c.px(x + dx, y + dy, rain);
    c.px(x + dx + 1, y + dy + 1, rainH);
  });
  // Skyline silhouette
  const bldgs = [
    { x: 4, h: 4 }, { x: 7, h: 6 }, { x: 11, h: 3 },
    { x: 14, h: 7 }, { x: 18, h: 5 }, { x: 21, h: 8 }, { x: 25, h: 4 },
  ];
  bldgs.forEach(b => c.rect(x + b.x, y + 19 - b.h, 3, b.h, bldg));
  // One lit window on the tallest tower
  c.px(x + 22, y + 14, win);
  paintWindowDividers(c, ox, oy, frame, frameD);
}

// Office chair (32x72) — BACK VIEW. Camera is behind the seated character
// looking over the chair toward the monitor. We see the rear of the backrest
// panel (no seat cushion — it's hidden in front of the backrest from this
// angle), the armrest tops poking out at the sides, and the pedestal/base.
// Rows 0..7 are intentionally transparent so the character's head pokes
// above the backrest top.
function paintChair(c, ox, oy) {
  const back    = hex('#3a4258');     // backrest body
  const backH   = hex('#5d6680');     // top edge highlight
  const backD   = hex('#1c2030');     // seam + panel divisions
  const arm     = hex('#4a5266');
  const armH    = hex('#6a7388');
  const armD    = hex('#22273a');
  const post    = hex('#525a72');     // pedestal / base
  const postH   = hex('#7a8398');
  const postD   = hex('#262c3d');
  const wheel   = hex('#1f2433');
  const wheelH  = hex('#525a72');

  // ---- Backrest top bow (slight outward curve at the very top edge) ----
  // Lowered to expose the full top half of the seated character's head from
  // behind. Bottom of backrest stays at y=42 so armrests/tilt block don't
  // shift; the panel just gets shorter.
  c.rect(ox + 5, oy + 22, 22, 2, back);
  c.outlineRect(ox + 5, oy + 22, 22, 2, OUTLINE);
  c.px(ox + 5,  oy + 22, [0, 0, 0, 0]);
  c.px(ox + 26, oy + 22, [0, 0, 0, 0]);

  // ---- Main backrest panel (shorter: y=24..41, height 18) ----
  c.rect(ox + 4, oy + 24, 24, 18, back);
  c.outlineRect(ox + 4, oy + 24, 24, 18, OUTLINE);
  c.hline(ox + 5, oy + 25, 22, backH);              // top edge highlight
  // Center vertical stitch seam
  c.vline(ox + 15, oy + 26, 14, backD);
  c.vline(ox + 16, oy + 26, 14, backD);
  // Single lumbar panel division (mid-panel)
  c.hline(ox + 5, oy + 33, 22, backD);
  // Subtle side shading
  c.vline(ox + 5,  oy + 26, 14, backD);
  c.vline(ox + 26, oy + 26, 14, backD);

  // ---- Armrest tops (poke out at the sides, just below backrest) ----
  c.rect(ox + 0, oy + 38, 4, 6, arm);
  c.outlineRect(ox + 0, oy + 38, 4, 6, OUTLINE);
  c.hline(ox + 1, oy + 39, 2, armH);
  c.hline(ox + 1, oy + 42, 2, armD);
  c.rect(ox + 28, oy + 38, 4, 6, arm);
  c.outlineRect(ox + 28, oy + 38, 4, 6, OUTLINE);
  c.hline(ox + 29, oy + 39, 2, armH);
  c.hline(ox + 29, oy + 42, 2, armD);

  // ---- Tilt mechanism block (visible under backrest, between arms) ----
  c.rect(ox + 11, oy + 44, 10, 4, post);
  c.outlineRect(ox + 11, oy + 44, 10, 4, OUTLINE);
  c.hline(ox + 12, oy + 45, 8, postH);

  // ---- Pedestal post ----
  c.rect(ox + 13, oy + 48, 6, 6, post);
  c.outlineRect(ox + 13, oy + 48, 6, 6, OUTLINE);
  c.vline(ox + 14, oy + 49, 4, postH);
  c.vline(ox + 17, oy + 49, 4, postD);

  // ---- Star base hub ----
  c.rect(ox + 12, oy + 54, 8, 4, post);
  c.outlineRect(ox + 12, oy + 54, 8, 4, OUTLINE);
  c.hline(ox + 13, oy + 55, 6, postH);

  // ---- 5-leg star ----
  c.rect(ox + 4, oy + 58, 9, 3, post);
  c.outlineRect(ox + 4, oy + 58, 9, 3, OUTLINE);
  c.hline(ox + 5, oy + 59, 7, postH);
  c.rect(ox + 19, oy + 58, 9, 3, post);
  c.outlineRect(ox + 19, oy + 58, 9, 3, OUTLINE);
  c.hline(ox + 20, oy + 59, 7, postH);
  c.rect(ox + 13, oy + 60, 6, 3, post);
  c.outlineRect(ox + 13, oy + 60, 6, 3, OUTLINE);

  // ---- Casters ----
  c.rect(ox + 3, oy + 61, 4, 3, wheel);
  c.outlineRect(ox + 3, oy + 61, 4, 3, OUTLINE);
  c.px(ox + 4, oy + 62, wheelH);
  c.rect(ox + 25, oy + 61, 4, 3, wheel);
  c.outlineRect(ox + 25, oy + 61, 4, 3, OUTLINE);
  c.px(ox + 27, oy + 62, wheelH);
  c.rect(ox + 13, oy + 63, 6, 2, wheel);
  c.outlineRect(ox + 13, oy + 63, 6, 2, OUTLINE);

  // ---- Floor shadow (narrower to match smaller footprint) ----
  c.hline(ox + 4, oy + 67, 24, [0, 0, 0, 90]);
}

// Floor plank tile (32x16, tiles horizontally — seamless wood).
function paintFloorTilePalette(c, ox, oy, p) {
  // top highlight stripe
  c.hline(ox, oy, 32, p.surfaceH);
  // body
  for (let yy = 1; yy <= 12; yy++) c.hline(ox, oy + yy, 32, p.surface);
  // grain marks (asymmetric so adjacent tiles read as different planks)
  c.hline(ox + 3,  oy + 3, 7, p.grain);
  c.hline(ox + 22, oy + 5, 5, p.grain);
  c.hline(ox + 12, oy + 8, 8, p.grain);
  c.hline(ox + 5,  oy + 10, 4, p.grain);
  // bottom shading
  c.hline(ox, oy + 13, 32, p.surfaceM);
  c.hline(ox, oy + 14, 32, p.surfaceD);
  // plank seam between rows
  c.hline(ox, oy + 15, 32, p.seam);
  // vertical board ends — break the strip into two planks at x=15..16
  c.vline(ox + 15, oy + 1, 14, p.seam);
  c.vline(ox + 16, oy + 1, 14, p.surfaceM);
}
const FLOOR_PALETTES = {
  warmOak: {
    surface:  hex('#7a532e'), surfaceH: hex('#a07449'), surfaceD: hex('#5b3c1f'),
    surfaceM: hex('#6a4524'), grain:    hex('#4a2e15'), seam:     hex('#1a1208'),
  },
  paleAsh: {
    surface:  hex('#a8855a'), surfaceH: hex('#cba87a'), surfaceD: hex('#7a5e3a'),
    surfaceM: hex('#8c6d45'), grain:    hex('#6a4f30'), seam:     hex('#3a2818'),
  },
  cherry: {
    surface:  hex('#7a3a2a'), surfaceH: hex('#a85540'), surfaceD: hex('#5a2618'),
    surfaceM: hex('#6a2f20'), grain:    hex('#421810'), seam:     hex('#1a0a06'),
  },
  graphite: {
    surface:  hex('#3f3a3a'), surfaceH: hex('#5a5454'), surfaceD: hex('#2a2626'),
    surfaceM: hex('#332f2f'), grain:    hex('#1c1a1a'), seam:     hex('#0d0c0c'),
  },
};
function paintFloorTile(c, ox, oy)         { paintFloorTilePalette(c, ox, oy, FLOOR_PALETTES.warmOak); }
function paintFloorTilePale(c, ox, oy)     { paintFloorTilePalette(c, ox, oy, FLOOR_PALETTES.paleAsh); }
function paintFloorTileCherry(c, ox, oy)   { paintFloorTilePalette(c, ox, oy, FLOOR_PALETTES.cherry); }
function paintFloorTileGraphite(c, ox, oy) { paintFloorTilePalette(c, ox, oy, FLOOR_PALETTES.graphite); }

// ---------- Build ----------

function build() {
  const W = 32;
  const H = 512;
  const c = new Canvas(W, H);

  paintDeskTile(c, 0, 0);
  paintMonitor(c, 0, 16);
  paintWindowWide(c, 0, 40);
  paintWindowTall(c, 0, 72);
  paintDoor(c, 0, 104);
  paintWindowEagle(c, 0, 136);
  paintWindowMarket(c, 0, 168);
  paintWindowSage(c, 0, 200);
  paintWindowSenku(c, 0, 232);
  paintWindowShikamaru(c, 0, 264);
  paintWindowL(c, 0, 296);
  paintChair(c, 0, 328);
  paintFloorTile(c, 0, 400);
  paintFloorTilePale(c, 0, 416);
  paintFloorTileCherry(c, 0, 432);
  paintFloorTileGraphite(c, 0, 448);
  paintDeskTileSteel(c, 0, 464);
  paintDeskTileWalnut(c, 0, 480);
  paintDeskTileWhite(c, 0, 496);

  return { png: encodePNG(W, H, c.buf), W, H };
}

const { png, W, H } = build();
const outPath = path.join(__dirname, '..', 'public', 'furniture.png');
fs.writeFileSync(outPath, png);
fs.writeFileSync(
  path.join(__dirname, '..', 'public', 'furniture.json'),
  JSON.stringify({
    desk:             { x: 0, y: 0,   w: 32, h: 16, tileable: true },
    monitor:          { x: 0, y: 16,  w: 32, h: 24 },
    windowWide:       { x: 0, y: 40,  w: 32, h: 32 },
    windowTall:       { x: 0, y: 72,  w: 32, h: 32 },
    door:             { x: 0, y: 104, w: 32, h: 32 },
    windowEagle:      { x: 0, y: 136, w: 32, h: 32 },
    windowMarket:     { x: 0, y: 168, w: 32, h: 32 },
    windowSage:       { x: 0, y: 200, w: 32, h: 32 },
    windowSenku:      { x: 0, y: 232, w: 32, h: 32 },
    windowShikamaru:  { x: 0, y: 264, w: 32, h: 32 },
    windowL:          { x: 0, y: 296, w: 32, h: 32 },
    chair:            { x: 0, y: 328, w: 32, h: 72 },
    floorTile:        { x: 0, y: 400, w: 32, h: 16, tileable: true },
    floorTilePale:    { x: 0, y: 416, w: 32, h: 16, tileable: true },
    floorTileCherry:  { x: 0, y: 432, w: 32, h: 16, tileable: true },
    floorTileGraphite:{ x: 0, y: 448, w: 32, h: 16, tileable: true },
    deskSteel:        { x: 0, y: 464, w: 32, h: 16, tileable: true },
    deskWalnut:       { x: 0, y: 480, w: 32, h: 16, tileable: true },
    deskWhite:        { x: 0, y: 496, w: 32, h: 16, tileable: true },
    sheet:       { w: W, h: H },
  }, null, 2),
);
console.log(`Wrote ${png.length} bytes -> ${outPath}`);
console.log(`Sheet: ${W}x${H}`);
