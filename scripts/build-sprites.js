#!/usr/bin/env node
// Deterministic pixel-art sprite sheet builder for Pixel Office.
// Pure Node (zlib + handcrafted PNG). No external deps.
//
// Output: pixel-office/public/sprites.png
// Layout: 16 columns x 9 rows of 32x48 sprites.
//   Columns: state group (active, idle, sip, away) x 4 frames each.
//   Rows:    one per agent in AGENTS order.

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
  px(x, y, color) {
    if (!color) return;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.buf[i] = color[0];
    this.buf[i + 1] = color[1];
    this.buf[i + 2] = color[2];
    this.buf[i + 3] = color[3] != null ? color[3] : 255;
  }
  rect(x, y, w, h, color) {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.px(x + xx, y + yy, color);
  }
  hline(x, y, w, color) { for (let i = 0; i < w; i++) this.px(x + i, y, color); }
  vline(x, y, h, color) { for (let i = 0; i < h; i++) this.px(x, y + i, color); }
  outlineRect(x, y, w, h, color) {
    this.hline(x, y, w, color);
    this.hline(x, y + h - 1, w, color);
    this.vline(x, y, h, color);
    this.vline(x + w - 1, y, h, color);
  }
}

// ---------- Agent specs ----------

const OUTLINE = [10, 14, 26, 255];

const AGENTS = [
  { id: 'main',           skin: '#f3c89c', hair: '#1a1f3a', hairStyle: 'plain',    outfit: '#3a4a8c', outfit2: '#7f93ff', accessory: 'cape',       drink: '#3a4a8c', face: 'stern' },
  { id: 'markethunting',  skin: '#e8b88a', hair: '#1f2920', hairStyle: 'slicked',  outfit: '#3aa873', outfit2: '#1f6b48', accessory: 'tie',        drink: '#0e3d27', face: 'focus' },
  { id: 'sage',           skin: '#dab48a', hair: '#3b2a1f', hairStyle: 'plain',    outfit: '#7bbf9a', outfit2: '#5b9a7d', accessory: 'hood',       drink: '#7c5438', face: 'kind' },
  { id: 'senku',          skin: '#f3c89c', hair: '#eef5ff', hairStyle: 'tallspiky', outfit: '#dde5f0', outfit2: '#77f6d8', accessory: 'goggles',    drink: '#80e6f5', face: 'sharp' },
  { id: 'shikamaru',      skin: '#e0bb8a', hair: '#181b2c', hairStyle: 'ponytail', outfit: '#3a4471', outfit2: '#6b76b1', accessory: 'vest',       drink: '#56527b', face: 'bored' },
  { id: 'tyrion',         skin: '#f3d3a4', hair: '#d4b074', hairStyle: 'plain',    outfit: '#a87e3f', outfit2: '#5e4022', accessory: 'goblet',     drink: '#7a1f2c', face: 'mismatched' },
  { id: 'harvey',         skin: '#e8c19a', hair: '#16101a', hairStyle: 'slicked',  outfit: '#1f1a26', outfit2: '#6f5fa3', accessory: 'tie',        drink: '#3a2c5e', face: 'smug' },
  { id: 'l',              skin: '#f5e7d3', hair: '#0d111f', hairStyle: 'messy',    outfit: '#dadde3', outfit2: '#8d96a6', accessory: 'none',       drink: '#f0e5b8', face: 'blank' },
  { id: 'd',              skin: '#e8b9a4', hair: '#221530', hairStyle: 'wavy',     outfit: '#b85aa6', outfit2: '#ff8ccd', accessory: 'headphones', drink: '#ff8ccd', face: 'cheerful' },
  { id: 'ephraim',        skin: '#c98e5a', hair: '#15100a', hairStyle: 'crewcut', outfit: '#1d2230', outfit2: '#e84a3a', accessory: 'athlete',    drink: '#cf8a40', face: 'coach' },
  { id: 'house',          skin: '#dcb59a', hair: '#7c7c7c', hairStyle: 'plain',    outfit: '#5a8aa3', outfit2: '#2c3445', accessory: 'tie',        drink: '#cfa55a', face: 'snark' },
];

const STATES = ['active', 'idle', 'sip', 'away', 'walk'];
const FRAMES_PER_STATE = 4;
const SPRITE_W = 32;
const SPRITE_H = 48;

// ---------- Sprite painter ----------

function drawSprite(c, ox, oy, agent, state, frame) {
  // The 'active' state is "sitting at the desk typing" — we always view it
  // from BEHIND (camera is over the chair, looking past the character at the
  // monitor). Dispatch to the back-view renderer; everything else stays
  // front-facing as before.
  if (state === 'active') {
    drawSpriteBack(c, ox, oy, agent, frame);
    return;
  }

  const skin = hex(agent.skin);
  const skinDark = shade(skin, 0.78);
  const hair = hex(agent.hair);
  const shirt = hex(agent.outfit);
  const shirtDark = shade(shirt, 0.78);
  const accent = hex(agent.outfit2);
  const drink = hex(agent.drink);
  const pants = [29, 36, 64, 255];
  const shoe = OUTLINE;

  let bob = 0;
  let dim = false;
  let pinLegs = false;
  let legDxL = 0;
  let legDxR = 0;

  if (state === 'idle') {
    // Upright + slow breath
    bob = [0, -1, -1, 0][frame];
  } else if (state === 'sip') {
    // Smooth cup raise/lower
    bob = [0, -1, -1, 0][frame];
  } else if (state === 'away') {
    // Deep slump on desk — head drops far below shoulders
    bob = [6, 6, 7, 6][frame];
    dim = true;
    pinLegs = true; // keep legs in their normal spot so the body folds, not slides
  } else if (state === 'walk') {
    // 4-frame walk cycle: contact, passing, contact, passing.
    // Body dips on passing frames (weight on single leg compresses stance).
    bob = [-1, 0, -1, 0][frame];
    // Legs alternate forward/back. Sprite faces viewer; "forward" is just an
    // x-shift to read as a stride. Positive = forward (out from body center).
    legDxL = [-2, 0, 2, 0][frame];
    legDxR = [2, 0, -2, 0][frame];
  }

  const cx = ox + 16;
  const baseY = oy + bob;
  const headY = baseY + 9;
  const headW = 12;

  // ---- Hair backing (drawn before head so head edges sit on top of hair sides) ----
  drawHairBack(c, cx, headY, hair, agent.hairStyle);

  // ---- Head ----
  c.rect(cx - 6, headY, headW, 12, skin);
  // chin shading
  c.hline(cx - 6, headY + 11, headW, skinDark);
  // outline
  c.outlineRect(cx - 7, headY - 1, headW + 2, 14, OUTLINE);

  // ---- Hair front (fringe on top of head) ----
  drawHairFront(c, cx, headY, hair, agent.hairStyle);

  // ---- Per-agent face (eyes + mouth + accents) ----
  drawFace(c, cx, headY, agent, state, frame);

  // ---- Head accessories (over hair) ----
  if (agent.accessory === 'headphones') {
    c.rect(cx - 9, headY + 1, 2, 7, accent);
    c.outlineRect(cx - 9, headY + 1, 2, 7, OUTLINE);
    c.rect(cx + 7, headY + 1, 2, 7, accent);
    c.outlineRect(cx + 7, headY + 1, 2, 7, OUTLINE);
    c.rect(cx - 6, headY - 3, 12, 2, accent);
    c.outlineRect(cx - 6, headY - 3, 12, 2, OUTLINE);
  } else if (agent.accessory === 'goggles') {
    c.rect(cx - 6, headY + 2, 12, 2, shade(accent, 0.6));
    c.rect(cx - 5, headY + 4, 4, 3, accent);
    c.rect(cx + 1, headY + 4, 4, 3, accent);
    c.outlineRect(cx - 5, headY + 4, 4, 3, OUTLINE);
    c.outlineRect(cx + 1, headY + 4, 4, 3, OUTLINE);
  } else if (agent.accessory === 'hood') {
    c.rect(cx - 9, headY - 3, 18, 5, accent);
    c.rect(cx - 8, headY + 2, 2, 6, accent);
    c.rect(cx + 6, headY + 2, 2, 6, accent);
    c.outlineRect(cx - 9, headY - 3, 18, 5, OUTLINE);
  }

  // ---- Per-agent extras (drawn after standard accessories) ----
  if (agent.id === 'main') {
    // Commander cap on top of hair
    const capColor = shade(hex(agent.outfit), 0.7);
    const visorColor = shade(hex(agent.outfit), 0.4);
    const gold = [240, 200, 80, 255];
    // crown
    c.rect(cx - 7, headY - 4, 14, 4, capColor);
    c.outlineRect(cx - 7, headY - 4, 14, 4, OUTLINE);
    // visor (one-row, slightly wider)
    c.rect(cx - 8, headY, 16, 1, visorColor);
    c.hline(cx - 8, headY + 1, 16, OUTLINE);
    c.px(cx - 8, headY, OUTLINE);
    c.px(cx + 7, headY, OUTLINE);
    // gold insignia (eagle dot)
    c.rect(cx - 1, headY - 3, 2, 2, gold);
  } else if (agent.id === 'ephraim') {
    // Trainer headband — red sweatband across the forehead, just below the
    // hairline and above the brows. A small knotted tail hangs off the left
    // side so the silhouette reads as "tied bandana", not "stripe of paint".
    const band = hex(agent.outfit2);     // red
    const bandD = shade(band, 0.55);
    c.rect(cx - 7, headY + 1, 14, 2, band);
    c.outlineRect(cx - 7, headY + 1, 14, 2, OUTLINE);
    c.hline(cx - 6, headY + 2, 12, bandD);
    // Knot + tail on the left temple
    c.rect(cx - 8, headY + 1, 1, 3, band);
    c.px(cx - 8, headY + 4, bandD);
    // White sweat-pip detail (center of forehead)
    c.px(cx, headY + 1, [255, 255, 255, 200]);
  }

  // ---- Body ----
  const bodyY = headY + 13;
  let bodyX = cx - 7;
  // cape behind body
  if (agent.accessory === 'cape') {
    c.rect(bodyX - 3, bodyY, 4, 17, accent);
    c.outlineRect(bodyX - 3, bodyY, 4, 17, OUTLINE);
  }
  // robe widens for sage
  if (agent.accessory === 'hood') {
    c.rect(bodyX, bodyY, 14, 14, shirt);
    c.rect(bodyX - 1, bodyY + 12, 16, 4, shirt);
    c.outlineRect(bodyX - 1, bodyY + 12, 16, 4, OUTLINE);
    c.outlineRect(bodyX, bodyY, 14, 14, OUTLINE);
  } else {
    c.rect(bodyX, bodyY, 14, 14, shirt);
    c.outlineRect(bodyX, bodyY, 14, 14, OUTLINE);
  }
  // collar/lapel shading
  c.rect(bodyX + 1, bodyY, 12, 1, shirtDark);

  if (agent.accessory === 'tie') {
    c.rect(cx - 1, bodyY + 1, 2, 7, accent);
    c.rect(cx - 2, bodyY + 7, 4, 4, accent);
    c.outlineRect(cx - 2, bodyY + 7, 4, 4, OUTLINE);
  } else if (agent.accessory === 'vest') {
    c.rect(bodyX + 1, bodyY + 1, 3, 12, accent);
    c.rect(bodyX + 10, bodyY + 1, 3, 12, accent);
  } else if (agent.accessory === 'athlete') {
    // Sleeveless compression top: skin showing at shoulders + V-neck.
    // Pecs, abs (6-pack), and obliques shaded directly on the singlet so the
    // physique reads even at 32x48.
    const muscle = shade(skin, 0.78);
    const muscleD = shade(skin, 0.62);
    const armhole = skin;
    // bare shoulders / armholes (carve out top corners of singlet to skin)
    c.rect(bodyX,     bodyY,     2, 4, armhole);
    c.rect(bodyX+12,  bodyY,     2, 4, armhole);
    // V-neck — small inverted triangle of skin at top center
    c.rect(cx - 2, bodyY,     4, 1, skin);
    c.rect(cx - 1, bodyY + 1, 2, 1, skin);
    // singlet straps (thin accent piping running over each shoulder)
    c.vline(bodyX + 2, bodyY,     4, accent);
    c.vline(bodyX + 11, bodyY,     4, accent);
    // pec line (horizontal divide between chest and abs)
    c.hline(bodyX + 3, bodyY + 5, 8, muscleD);
    // chest cleft (vertical line down middle of pecs)
    c.vline(cx, bodyY + 2, 4, muscleD);
    // 6-pack abs — 3 horizontal grooves + 1 vertical groove on the abdominal block
    c.vline(cx, bodyY + 6, 7, muscleD);
    c.hline(bodyX + 3, bodyY + 7,  8, muscleD);
    c.hline(bodyX + 3, bodyY + 9,  8, muscleD);
    c.hline(bodyX + 3, bodyY + 11, 8, muscleD);
    // ab highlights (lighter shade in each ab block to make them pop)
    c.px(bodyX + 4, bodyY + 8,  shade(shirt, 1.2));
    c.px(bodyX + 9, bodyY + 8,  shade(shirt, 1.2));
    c.px(bodyX + 4, bodyY + 10, shade(shirt, 1.2));
    c.px(bodyX + 9, bodyY + 10, shade(shirt, 1.2));
    // champion belt across the waist (gold buckle in middle)
    const beltDark = [40, 28, 18, 255];
    const buckle = [240, 200, 80, 255];
    c.rect(bodyX, bodyY + 12, 14, 2, beltDark);
    c.rect(cx - 2, bodyY + 12, 4, 2, buckle);
    c.outlineRect(cx - 2, bodyY + 12, 4, 2, OUTLINE);
  } else if (agent.id === 'senku') {
    // lab coat lapel
    c.rect(cx - 2, bodyY + 1, 1, 12, shade(shirt, 0.5));
    c.rect(cx + 1, bodyY + 1, 1, 12, shade(shirt, 0.5));
  } else if (agent.id === 'l') {
    // baggy white shirt vertical fold
    c.rect(cx - 1, bodyY + 1, 1, 12, shade(shirt, 0.85));
  }

  // ---- Arms ---- (ephraim's accessory = 'athlete' uses bare arms + bracers)
  if (agent.accessory === 'athlete') {
    const skinDarkLocal = shade(skin, 0.78);
    drawArms(c, bodyX, bodyY, skin, skinDarkLocal, skin, drink, state, frame);
    drawAthleteArmDetail(c, bodyX, bodyY, agent, state, frame);
  } else {
    drawArms(c, bodyX, bodyY, shirt, shirtDark, skin, drink, state, frame);
  }

  // ---- Legs ---- (pinned during away so the body folds over hips, not slides)
  const legY = pinLegs ? (oy + 36) : (bodyY + 14);
  c.rect(bodyX + 1 + legDxL, legY, 5, 8, pants);
  c.rect(bodyX + 8 + legDxR, legY, 5, 8, pants);
  c.outlineRect(bodyX + 1 + legDxL, legY, 5, 8, OUTLINE);
  c.outlineRect(bodyX + 8 + legDxR, legY, 5, 8, OUTLINE);
  c.rect(bodyX + legDxL, legY + 7, 6, 2, shoe);
  c.rect(bodyX + 8 + legDxR, legY + 7, 6, 2, shoe);

  // ---- Sage's permanent tea cup (held in right hand, except while sipping/away) ----
  if (agent.id === 'sage' && state !== 'sip' && state !== 'away') {
    const drinkColor = hex(agent.drink);
    const cupX = bodyX + 14;
    const cupY = bodyY + 9;
    c.rect(cupX, cupY, 5, 4, drinkColor);
    c.outlineRect(cupX, cupY, 5, 4, OUTLINE);
    // saucer rim
    c.hline(cupX - 1, cupY + 3, 7, OUTLINE);
    // wisp of steam
    if (frame % 2 === 0) {
      c.rect(cupX + 1, cupY - 2, 1, 2, [255, 255, 255, 170]);
    } else {
      c.rect(cupX + 3, cupY - 2, 1, 2, [255, 255, 255, 170]);
    }
  }

  // ---- Z's for sleeping (drift up over frames 1..3) ----
  if (state === 'away' && frame >= 1) {
    // Z floats up & shifts right as it ages, fades on the last frame
    const driftY = (frame - 1) * 2; // 0, 2, 4
    const driftX = (frame - 1);     // 0, 1, 2
    const alpha = frame === 3 ? 140 : 220;
    c.rect(cx + 8 + driftX, headY - 5 - driftY, 4, 4, [240, 240, 255, alpha]);
    c.outlineRect(cx + 8 + driftX, headY - 5 - driftY, 4, 4, OUTLINE);
  }

  // ---- Dim overlay for away ----
  if (dim) {
    for (let yy = oy; yy < oy + SPRITE_H; yy++) {
      for (let xx = ox; xx < ox + SPRITE_W; xx++) {
        const i = (yy * c.w + xx) * 4;
        if (c.buf[i + 3] > 0) {
          c.buf[i] = Math.floor(c.buf[i] * 0.55);
          c.buf[i + 1] = Math.floor(c.buf[i + 1] * 0.55);
          c.buf[i + 2] = Math.floor(c.buf[i + 2] * 0.7);
        }
      }
    }
  }
}

// ---------- Back-view renderer (active state) ----------
// Camera is over the chair behind the seated character. We see: back of head
// (full hair coverage, no face), nape, shoulders/upper back, and arms reaching
// FORWARD toward the keyboard (with a 4-frame typing micro-animation). Most of
// the body is hidden by the chair backrest in-scene, but the sprite is fully
// painted so it still reads correctly if rendered without the chair.
function drawSpriteBack(c, ox, oy, agent, frame) {
  const skin = hex(agent.skin);
  const skinDark = shade(skin, 0.78);
  const hair = hex(agent.hair);
  const hairDark = shade(hair, 0.7);
  const shirt = hex(agent.outfit);
  const shirtDark = shade(shirt, 0.78);
  const shirtMid = shade(shirt, 0.9);
  const accent = hex(agent.outfit2);
  const pants = [29, 36, 64, 255];
  const pantsDark = shade(pants, 0.7);
  const shoe = OUTLINE;

  // Forward hunch over keyboard + typing pulse (matches old front-view feel)
  const bob = [2, 1, 2, 1][frame];

  const cx = ox + 16;
  const baseY = oy + bob;
  const headY = baseY + 9;
  const headW = 12;

  // ---- Head base (skin) — most of it gets covered by hair below ----
  c.rect(cx - 6, headY, headW, 12, skin);
  // nape shadow at neck transition
  c.hline(cx - 6, headY + 11, headW, skinDark);
  c.outlineRect(cx - 7, headY - 1, headW + 2, 14, OUTLINE);

  // ---- Hair from behind (covers cranium fully) ----
  drawHairBackView(c, cx, headY, hair, hairDark, agent.hairStyle);

  // ---- Head accessories (back-view variants) ----
  if (agent.accessory === 'headphones') {
    // Band arches over the top; earcups visible on both sides
    c.rect(cx - 6, headY - 3, 12, 2, accent);
    c.outlineRect(cx - 6, headY - 3, 12, 2, OUTLINE);
    c.rect(cx - 9, headY + 1, 2, 7, accent);
    c.outlineRect(cx - 9, headY + 1, 2, 7, OUTLINE);
    c.rect(cx + 7, headY + 1, 2, 7, accent);
    c.outlineRect(cx + 7, headY + 1, 2, 7, OUTLINE);
  } else if (agent.accessory === 'goggles') {
    // Strap wraps around the back of the head (lens hidden — it's on the front)
    c.rect(cx - 6, headY + 4, 12, 2, accent);
    c.outlineRect(cx - 6, headY + 4, 12, 2, OUTLINE);
    c.hline(cx - 6, headY + 4, 12, shade(accent, 0.6));
  } else if (agent.accessory === 'hood') {
    // Hood drape over head + shoulders
    c.rect(cx - 9, headY - 3, 18, 11, accent);
    c.outlineRect(cx - 9, headY - 3, 18, 11, OUTLINE);
    // central fold seam
    c.vline(cx, headY - 2, 9, shade(accent, 0.7));
  }

  // ---- Per-agent extras ----
  if (agent.id === 'main') {
    // Commander cap from behind — crown + back band, no insignia visible
    const capColor = shade(hex(agent.outfit), 0.7);
    const bandColor = shade(hex(agent.outfit), 0.4);
    c.rect(cx - 7, headY - 4, 14, 4, capColor);
    c.outlineRect(cx - 7, headY - 4, 14, 4, OUTLINE);
    // back band where cap meets head
    c.hline(cx - 7, headY, 14, bandColor);
    c.hline(cx - 7, headY + 1, 14, OUTLINE);
  } else if (agent.id === 'ephraim') {
    // Headband wraps all the way around — paint the back side of the band
    // across the nape area of the head box.
    const band = hex(agent.outfit2);
    const bandD = shade(band, 0.55);
    c.rect(cx - 7, headY + 1, 14, 2, band);
    c.outlineRect(cx - 7, headY + 1, 14, 2, OUTLINE);
    c.hline(cx - 6, headY + 2, 12, bandD);
    // Knot dangling on the left side (mirrors the front view)
    c.rect(cx - 8, headY + 1, 1, 3, band);
    c.px(cx - 8, headY + 4, bandD);
  }

  // ---- Body (back of shirt) ----
  const bodyY = headY + 13;
  const bodyX = cx - 7;

  // Legs drawn FIRST so the shirt/coat below paints over their top — gives a
  // proper "shirt hangs over waistband" silhouette instead of legs butting up
  // against a hard body edge. Pants extend 2 rows up into the body region;
  // those rows get covered when we paint the torso next.
  const legY = bodyY + 12;
  c.rect(bodyX + 1, legY, 5, 10, pants);
  c.rect(bodyX + 8, legY, 5, 10, pants);
  c.outlineRect(bodyX + 1, legY, 5, 10, OUTLINE);
  c.outlineRect(bodyX + 8, legY, 5, 10, OUTLINE);
  c.vline(bodyX + 3, legY + 1, 8, pantsDark);
  c.vline(bodyX + 10, legY + 1, 8, pantsDark);
  // Heel-only shoes — sits at the same floor row as before (legY + 9).
  c.rect(bodyX + 1, legY + 9, 5, 1, shoe);
  c.rect(bodyX + 8, legY + 9, 5, 1, shoe);

  if (agent.accessory === 'cape') {
    // Cape draped down the entire back, slightly wider than body
    c.rect(bodyX - 2, bodyY, 18, 17, accent);
    c.outlineRect(bodyX - 2, bodyY, 18, 17, OUTLINE);
    // central fold
    c.vline(cx, bodyY + 1, 15, shade(accent, 0.75));
    // shoulder-line darken
    c.hline(bodyX - 1, bodyY + 1, 16, shade(accent, 0.65));
  } else if (agent.accessory === 'hood') {
    // Robe back
    c.rect(bodyX, bodyY, 14, 14, shirt);
    c.rect(bodyX - 1, bodyY + 12, 16, 4, shirt);
    c.outlineRect(bodyX - 1, bodyY + 12, 16, 4, OUTLINE);
    c.outlineRect(bodyX, bodyY, 14, 14, OUTLINE);
    c.vline(cx, bodyY + 1, 12, shirtDark);
  } else {
    // Plain shirt back: shoulder yoke darker, central back seam
    c.rect(bodyX, bodyY, 14, 14, shirt);
    c.outlineRect(bodyX, bodyY, 14, 14, OUTLINE);
    c.hline(bodyX + 1, bodyY, 12, shirtDark);     // yoke
    c.vline(cx, bodyY + 1, 12, shirtMid);         // back seam
    if (agent.id === 'l') {
      // baggy white shirt — extra slouch fold
      c.vline(cx - 3, bodyY + 2, 10, shade(shirt, 0.85));
      c.vline(cx + 3, bodyY + 2, 10, shade(shirt, 0.85));
    }
  }

  // Shikamaru's vest still shows as straps over shoulders from behind
  if (agent.accessory === 'vest') {
    c.rect(bodyX + 1, bodyY, 3, 14, accent);
    c.rect(bodyX + 10, bodyY, 3, 14, accent);
    c.outlineRect(bodyX + 1, bodyY, 3, 14, OUTLINE);
    c.outlineRect(bodyX + 10, bodyY, 3, 14, OUTLINE);
  } else if (agent.accessory === 'athlete') {
    // Singlet back: skin-tone shoulders/upper back + thin tank straps,
    // trapezius shading running up to the nape, lat V-taper at the waist.
    const traps = shade(skin, 0.78);
    // bare shoulders + nape — overpaint top of the back panel with skin
    c.rect(bodyX, bodyY, 14, 4, skin);
    // tank-top straps (accent) running over each shoulder onto the back
    c.vline(bodyX + 2, bodyY,     4, accent);
    c.vline(bodyX + 11, bodyY,     4, accent);
    // trapezius — darker triangle pinching toward the nape
    c.hline(bodyX + 4, bodyY + 0, 6, traps);
    c.hline(bodyX + 5, bodyY + 1, 4, traps);
    c.hline(bodyX + 6, bodyY + 2, 2, traps);
    c.outlineRect(bodyX, bodyY, 14, 4, OUTLINE);
    // lat taper — vertical shading at the sides of the singlet
    c.vline(bodyX + 1,  bodyY + 5, 7, shade(shirt, 0.7));
    c.vline(bodyX + 12, bodyY + 5, 7, shade(shirt, 0.7));
    // spine groove
    c.vline(cx, bodyY + 4, 9, shade(shirt, 0.6));
    // champion belt across the waist (gold buckle on the back is just dark band)
    const beltDark = [40, 28, 18, 255];
    c.rect(bodyX, bodyY + 12, 14, 2, beltDark);
  }

  // ---- Shoulders only (arms reach FORWARD into the body silhouette and are
  // hidden behind it from this angle — no forearms or hands visible). The
  // shoulder caps still dip alternately to sell the typing motion through
  // the back. ----
  const dyL = [0, -1, 0, 0][frame];
  const dyR = [0,  0, 0, -1][frame];
  // Left shoulder cap (sits at the top-back corner of the torso)
  c.rect(bodyX - 2, bodyY + 1 + dyL, 4, 5, shirt);
  c.outlineRect(bodyX - 2, bodyY + 1 + dyL, 4, 5, OUTLINE);
  c.hline(bodyX - 1, bodyY + 1 + dyL, 2, shirtDark);
  // Right shoulder cap
  c.rect(bodyX + 12, bodyY + 1 + dyR, 4, 5, shirt);
  c.outlineRect(bodyX + 12, bodyY + 1 + dyR, 4, 5, OUTLINE);
  c.hline(bodyX + 13, bodyY + 1 + dyR, 2, shirtDark);

}

// Full back-of-head hair coverage. Differs from drawHairBack (which is just a
// "backing" behind the head silhouette) — this paints the entire cranium.
function drawHairBackView(c, cx, headY, hair, hairDark, style) {
  if (style === 'crewcut') {
    // Tight buzz from behind — stippled scalp coverage, no volume. Alternating
    // darker rows hint at a fresh clipper fade.
    c.rect(cx - 6, headY - 1, 12, 4, hair);
    c.hline(cx - 6, headY,     12, hairDark);
    c.hline(cx - 6, headY + 2, 12, hairDark);
    return;
  }
  // Top crown + most of cranium covered in hair
  c.rect(cx - 7, headY - 2, 14, 4, hair);
  c.rect(cx - 6, headY + 2, 12, 7, hair);
  // central back-of-skull shading
  c.vline(cx - 1, headY + 1, 7, hairDark);
  c.vline(cx,     headY + 1, 7, hairDark);

  if (style === 'spiky') {
    [-7, -4, -1, 2, 5].forEach((x) => c.rect(cx + x, headY - 5, 2, 4, hair));
  } else if (style === 'tallspiky') {
    // Senku — tall white spikes still pop from behind
    [-7, -4, -1, 2, 5].forEach((x) => c.rect(cx + x, headY - 8, 2, 7, hair));
    c.rect(cx - 1, headY - 10, 2, 9, hair);
  } else if (style === 'ponytail') {
    // Shikamaru — ponytail dangles down the back
    c.rect(cx - 1, headY + 9, 2, 8, hair);
    c.outlineRect(cx - 1, headY + 9, 2, 8, OUTLINE);
    c.hline(cx - 2, headY + 9, 4, hairDark); // tie
  } else if (style === 'slicked') {
    // slicked-back hair extends slightly past nape
    c.hline(cx - 5, headY + 9, 10, hair);
  } else if (style === 'messy') {
    // L — irregular tufts at top + sides
    c.rect(cx - 8, headY - 3, 16, 3, hair);
    c.px(cx - 5, headY - 4, hair);
    c.px(cx - 2, headY - 4, hair);
    c.px(cx + 2, headY - 4, hair);
    c.px(cx + 5, headY - 4, hair);
    // side tufts
    c.rect(cx - 8, headY + 2, 2, 4, hair);
    c.rect(cx + 6, headY + 2, 2, 4, hair);
  } else if (style === 'wavy') {
    // D — wavy strands cascade down the sides past the head edge
    c.rect(cx - 8, headY - 1, 2, 9, hair);
    c.rect(cx + 6, headY - 1, 2, 9, hair);
    // wave detail
    c.px(cx - 8, headY + 2, hairDark);
    c.px(cx + 7, headY + 4, hairDark);
  } else if (style === 'crewcut') {
    // Ephraim — military buzz from behind: tight, dotted scalp coverage with
    // a clear hairline at the nape. No volume, no fringe.
    c.rect(cx - 6, headY - 1, 12, 5, hair);
    // shaved fade — alternating darker rows give that "freshly clipped" look
    c.hline(cx - 6, headY,     12, hairDark);
    c.hline(cx - 6, headY + 2, 12, hairDark);
    // sharp temples
    c.px(cx - 7, headY + 1, hair);
    c.px(cx + 6, headY + 1, hair);
  }
  // 'plain' needs nothing extra — base coverage above is enough.
}

function drawFace(c, cx, headY, agent, state, frame) {
  const closed = state === 'away';
  const face = agent.face || 'plain';
  const WHITE = [255, 255, 255, 255];

  // ---- Eyes ----
  if (closed) {
    // sleeping — horizontal slit eyelids; preserve under-circle on L
    c.rect(cx - 4, headY + 5, 3, 1, OUTLINE);
    c.rect(cx + 1, headY + 5, 3, 1, OUTLINE);
    if (face === 'blank') {
      c.rect(cx - 4, headY + 7, 2, 1, [60, 50, 70, 200]);
      c.rect(cx + 2, headY + 7, 2, 1, [60, 50, 70, 200]);
    }
  } else if (face === 'stern') {
    // Eagle: simple eyes — small dark pupils, no brow
    c.rect(cx - 3, headY + 5, 1, 2, OUTLINE);
    c.rect(cx + 3, headY + 5, 1, 2, OUTLINE);
  } else if (face === 'focus') {
    // MarketHunting: sharp focused eyes with brow tilt down to center
    c.rect(cx - 4, headY + 4, 2, 2, OUTLINE);
    c.rect(cx + 2, headY + 4, 2, 2, OUTLINE);
    c.rect(cx - 3, headY + 4, 1, 1, WHITE);
    c.rect(cx + 3, headY + 4, 1, 1, WHITE);
    c.rect(cx - 2, headY + 3, 1, 1, OUTLINE);
    c.rect(cx + 2, headY + 3, 1, 1, OUTLINE);
  } else if (face === 'kind') {
    // Sage: small calm dot eyes
    c.rect(cx - 3, headY + 5, 1, 2, OUTLINE);
    c.rect(cx + 3, headY + 5, 1, 2, OUTLINE);
  } else if (face === 'sharp') {
    // Senku: angular eyes (most will be hidden by goggles, but tail shows)
    c.rect(cx - 4, headY + 4, 1, 1, OUTLINE);
    c.rect(cx - 3, headY + 5, 2, 1, OUTLINE);
    c.rect(cx + 4, headY + 4, 1, 1, OUTLINE);
    c.rect(cx + 2, headY + 5, 2, 1, OUTLINE);
  } else if (face === 'bored') {
    // Shikamaru: half-lidded
    c.rect(cx - 4, headY + 4, 3, 1, OUTLINE);
    c.rect(cx + 1, headY + 4, 3, 1, OUTLINE);
    c.rect(cx - 4, headY + 5, 3, 1, OUTLINE);
    c.rect(cx + 1, headY + 5, 3, 1, OUTLINE);
  } else if (face === 'mismatched') {
    // Tyrion: intact left eye, half-closed scarred right eye, vertical scar through brow & cheek
    c.rect(cx - 4, headY + 4, 2, 3, OUTLINE);
    c.rect(cx - 3, headY + 5, 1, 1, WHITE);
    c.rect(cx + 2, headY + 5, 2, 2, OUTLINE);
    c.rect(cx + 3, headY + 5, 1, 1, WHITE);
    c.rect(cx + 4, headY + 3, 1, 2, [140, 70, 50, 220]);
    c.rect(cx + 4, headY + 7, 1, 2, [140, 70, 50, 220]);
  } else if (face === 'smug') {
    // Harvey: confident narrow eyes + arched brow
    c.rect(cx - 4, headY + 5, 2, 1, OUTLINE);
    c.rect(cx + 2, headY + 5, 2, 1, OUTLINE);
    c.rect(cx - 3, headY + 4, 1, 1, OUTLINE);
    c.rect(cx + 3, headY + 4, 1, 1, OUTLINE);
    c.rect(cx + 2, headY + 3, 2, 1, OUTLINE);
  } else if (face === 'blank') {
    // L: wide hollow eyes + heavy under-circles
    c.rect(cx - 4, headY + 4, 2, 3, OUTLINE);
    c.rect(cx + 2, headY + 4, 2, 3, OUTLINE);
    c.rect(cx - 3, headY + 5, 1, 1, WHITE);
    c.rect(cx + 3, headY + 5, 1, 1, WHITE);
    c.rect(cx - 4, headY + 7, 2, 1, [60, 50, 70, 220]);
    c.rect(cx + 2, headY + 7, 2, 1, [60, 50, 70, 220]);
  } else if (face === 'cheerful') {
    // D: round bright eyes + blush
    c.rect(cx - 4, headY + 4, 2, 3, OUTLINE);
    c.rect(cx + 2, headY + 4, 2, 3, OUTLINE);
    c.rect(cx - 3, headY + 4, 1, 1, WHITE);
    c.rect(cx + 3, headY + 4, 1, 1, WHITE);
    c.rect(cx - 6, headY + 8, 2, 1, [255, 160, 180, 200]);
    c.rect(cx + 4, headY + 8, 2, 1, [255, 160, 180, 200]);
  } else if (face === 'coach') {
    // Ephraim: drill-instructor brows angled inward + narrowed eyes + jaw stubble.
    // Brows angle DOWN toward center for an intense / focused gaze.
    c.rect(cx - 5, headY + 3, 2, 1, OUTLINE);
    c.rect(cx + 3, headY + 3, 2, 1, OUTLINE);
    c.px(cx - 3, headY + 4, OUTLINE);
    c.px(cx + 2, headY + 4, OUTLINE);
    // Narrowed steely eyes — slit pupils
    c.rect(cx - 4, headY + 5, 2, 1, OUTLINE);
    c.rect(cx + 2, headY + 5, 2, 1, OUTLINE);
    c.px(cx - 3, headY + 6, OUTLINE);
    c.px(cx + 2, headY + 6, OUTLINE);
    // Light jaw stubble — translucent shading along the jawline
    const stubble = [40, 28, 24, 130];
    c.px(cx - 5, headY + 9,  stubble);
    c.px(cx - 4, headY + 10, stubble);
    c.px(cx + 4, headY + 9,  stubble);
    c.px(cx + 3, headY + 10, stubble);
    c.px(cx,     headY + 10, stubble);
  } else if (face === 'snark') {
    // House: piercing narrow-eyed sarcasm. SYMMETRIC flat brows with an
    // inner-corner lift (skepticism — "really?"), narrow eye slits, and a
    // 3-day stubble field along the jawline and chin. Distinct from Harvey's
    // single-arch smug so the right and left sides match.
    c.rect(cx - 5, headY + 3, 3, 1, OUTLINE);
    c.rect(cx + 2, headY + 3, 3, 1, OUTLINE);
    c.px(cx - 3, headY + 2, OUTLINE);   // inner-left brow lift
    c.px(cx + 2, headY + 2, OUTLINE);   // inner-right brow lift
    // Narrow horizontal eye slits — symmetric
    c.rect(cx - 4, headY + 5, 2, 1, OUTLINE);
    c.rect(cx + 2, headY + 5, 2, 1, OUTLINE);
    // 3-day stubble — translucent shading along jawline and chin
    const stubble = [60, 48, 44, 130];
    c.px(cx - 5, headY + 9,  stubble);
    c.px(cx - 4, headY + 10, stubble);
    c.px(cx + 4, headY + 9,  stubble);
    c.px(cx + 3, headY + 10, stubble);
    c.px(cx - 1, headY + 10, stubble);
    c.px(cx + 1, headY + 10, stubble);
  } else {
    // plain default
    c.rect(cx - 4, headY + 4, 2, 3, OUTLINE);
    c.rect(cx + 2, headY + 4, 2, 3, OUTLINE);
    c.rect(cx - 3, headY + 5, 1, 1, WHITE);
    c.rect(cx + 3, headY + 5, 1, 1, WHITE);
  }

  // ---- Mouth ----
  // Sip overrides everything (open mouth O for drinking)
  if (state === 'sip') {
    c.rect(cx, headY + 8, 2, 2, OUTLINE);
    return;
  }
  // Away → faint relaxed line
  if (closed) {
    c.rect(cx - 1, headY + 9, 3, 1, OUTLINE);
    return;
  }

  if (face === 'stern') {
    c.rect(cx - 2, headY + 9, 5, 1, OUTLINE);
  } else if (face === 'focus') {
    c.rect(cx - 1, headY + 9, 3, 1, OUTLINE);
    c.rect(cx + 2, headY + 8, 1, 1, OUTLINE);
  } else if (face === 'kind') {
    c.rect(cx - 2, headY + 9, 1, 1, OUTLINE);
    c.rect(cx - 1, headY + 10, 3, 1, OUTLINE);
    c.rect(cx + 2, headY + 9, 1, 1, OUTLINE);
  } else if (face === 'sharp') {
    c.rect(cx - 2, headY + 9, 5, 1, OUTLINE);
    c.rect(cx + 2, headY + 8, 1, 1, OUTLINE);
  } else if (face === 'bored') {
    c.rect(cx - 1, headY + 9, 2, 1, OUTLINE);
  } else if (face === 'mismatched') {
    c.rect(cx - 2, headY + 9, 3, 1, OUTLINE);
    c.rect(cx + 1, headY + 8, 2, 1, OUTLINE);
  } else if (face === 'smug') {
    c.rect(cx - 1, headY + 9, 2, 1, OUTLINE);
    c.rect(cx + 1, headY + 8, 2, 1, OUTLINE);
  } else if (face === 'blank') {
    c.rect(cx, headY + 9, 1, 1, OUTLINE);
    // L's lollipop — stick out of the right side of the mouth + candy ball
    c.rect(cx + 1, headY + 9, 4, 1, [200, 190, 170, 220]);
    c.rect(cx + 5, headY + 7, 3, 3, [240, 90, 130, 255]);
    c.outlineRect(cx + 5, headY + 7, 3, 3, OUTLINE);
    c.px(cx + 6, headY + 7, [255, 200, 220, 255]);
  } else if (face === 'cheerful') {
    c.rect(cx - 2, headY + 10, 1, 1, OUTLINE);
    c.rect(cx - 1, headY + 9, 3, 1, OUTLINE);
    c.rect(cx + 2, headY + 10, 1, 1, OUTLINE);
  } else if (face === 'coach') {
    // Tight, determined line with corner pulls — neutral but resolute.
    c.rect(cx - 1, headY + 9, 3, 1, OUTLINE);
    c.px(cx - 2, headY + 9, OUTLINE);
    c.px(cx + 2, headY + 9, OUTLINE);
  } else if (face === 'snark') {
    // House: tight asymmetric "I-already-know-you're-lying" smirk.
    // Base flat line, right corner pulled up, left corner droops slightly.
    c.rect(cx - 1, headY + 9, 3, 1, OUTLINE);
    c.px(cx + 2, headY + 8, OUTLINE);   // right corner up — smirk
    c.px(cx - 2, headY + 10, OUTLINE);  // left corner droops — sarcasm
  } else {
    c.rect(cx - 1, headY + 9, 3, 1, OUTLINE);
  }
}

function drawHairBack(c, cx, headY, hair, style) {
  // Backing fills behind head at top edges; lets hair "wrap" around skull silhouette.
  if (style === 'spiky') {
    c.rect(cx - 8, headY - 2, 16, 4, hair);
  } else if (style === 'tallspiky') {
    c.rect(cx - 8, headY - 3, 16, 5, hair);
  } else if (style === 'ponytail') {
    c.rect(cx - 7, headY - 2, 14, 4, hair);
    c.rect(cx + 6, headY, 4, 9, hair);
  } else if (style === 'slicked') {
    c.rect(cx - 7, headY - 2, 14, 3, hair);
  } else if (style === 'messy') {
    c.rect(cx - 8, headY - 3, 16, 5, hair);
  } else if (style === 'wavy') {
    c.rect(cx - 7, headY - 2, 14, 4, hair);
    c.rect(cx - 8, headY + 1, 2, 6, hair);
    c.rect(cx + 6, headY + 1, 2, 6, hair);
  } else if (style === 'crewcut') {
    // Buzz cut backing — only 1px above scalp (no fluffy crown). Hairline sits
    // tight to the head silhouette so the head reads bigger / shaved.
    c.rect(cx - 7, headY - 1, 14, 2, hair);
  } else { // plain
    c.rect(cx - 7, headY - 2, 14, 4, hair);
  }
}

function drawHairFront(c, cx, headY, hair, style) {
  if (style === 'spiky') {
    c.rect(cx - 6, headY, 12, 2, hair);
    [-7, -4, -1, 2, 5].forEach((x) => c.rect(cx + x, headY - 5, 2, 4, hair));
  } else if (style === 'tallspiky') {
    c.rect(cx - 6, headY, 12, 2, hair);
    // taller spikes — 7 rows tall instead of 4
    [-7, -4, -1, 2, 5].forEach((x) => c.rect(cx + x, headY - 8, 2, 7, hair));
    // a center spike that's even taller
    c.rect(cx - 1, headY - 10, 2, 9, hair);
  } else if (style === 'ponytail') {
    c.rect(cx - 6, headY, 12, 2, hair);
    c.rect(cx - 7, headY + 1, 2, 5, hair);
  } else if (style === 'slicked') {
    c.rect(cx - 6, headY, 12, 3, hair);
    c.rect(cx + 4, headY + 1, 2, 3, hair);
  } else if (style === 'messy') {
    c.rect(cx - 6, headY, 12, 2, hair);
    c.rect(cx - 5, headY + 1, 2, 1, hair);
    c.rect(cx + 1, headY + 1, 3, 1, hair);
    c.rect(cx + 5, headY + 1, 1, 2, hair);
  } else if (style === 'wavy') {
    c.rect(cx - 6, headY, 12, 2, hair);
    c.rect(cx - 5, headY + 1, 1, 1, hair);
    c.rect(cx - 2, headY + 1, 1, 1, hair);
    c.rect(cx + 2, headY + 1, 1, 1, hair);
    c.rect(cx + 5, headY + 1, 1, 1, hair);
  } else if (style === 'crewcut') {
    // Tight hairline across the top of the forehead — no fringe. Stippled
    // pixels at the corners hint at a buzz fade rather than a hard line.
    c.hline(cx - 5, headY, 10, hair);
    c.px(cx - 6, headY + 1, hair);
    c.px(cx + 5, headY + 1, hair);
  } else { // plain
    c.rect(cx - 6, headY, 12, 2, hair);
    c.rect(cx + 3, headY + 2, 3, 1, hair); // side fringe
  }
}

function drawArms(c, bodyX, bodyY, shirt, shirtDark, skin, drink, state, frame) {
  // Default: arms hang at sides
  const armTop = bodyY + 1;

  if (state === 'active') {
    // Typing cycle: alternating arm strikes.
    // Left dy:  0, -1,  0,  0
    // Right dy: 0,  0,  0, -1
    const dyL = [0, -1, 0, 0][frame];
    const dyR = [0, 0, 0, -1][frame];
    // left (sprite's right, viewer's left)
    c.rect(bodyX - 3, armTop + dyL, 3, 7, shirt);
    c.outlineRect(bodyX - 3, armTop + dyL, 3, 7, OUTLINE);
    c.rect(bodyX - 4, armTop + 7 + dyL, 4, 3, skin);
    c.outlineRect(bodyX - 4, armTop + 7 + dyL, 4, 3, OUTLINE);
    // right
    c.rect(bodyX + 14, armTop + dyR, 3, 7, shirt);
    c.outlineRect(bodyX + 14, armTop + dyR, 3, 7, OUTLINE);
    c.rect(bodyX + 14, armTop + 7 + dyR, 4, 3, skin);
    c.outlineRect(bodyX + 14, armTop + 7 + dyR, 4, 3, OUTLINE);
  } else if (state === 'sip') {
    // Approach / drink / drink / lower — cup height varies smoothly per frame.
    // cupOffset:  0 (low), -2 (raised), -2 (drinking), 0 (lowered back)
    const cupOffset = [0, -2, -2, 0][frame];
    // Left arm hangs
    c.rect(bodyX - 3, armTop, 3, 9, shirt);
    c.outlineRect(bodyX - 3, armTop, 3, 9, OUTLINE);
    c.rect(bodyX - 3, armTop + 9, 3, 3, skin);
    c.outlineRect(bodyX - 3, armTop + 9, 3, 3, OUTLINE);
    // Right arm raised — also lifts a touch when drinking
    const armDy = cupOffset; // arm follows cup
    c.rect(bodyX + 13, armTop - 1 + armDy, 3, 5, shirt);
    c.outlineRect(bodyX + 13, armTop - 1 + armDy, 3, 5, OUTLINE);
    c.rect(bodyX + 12, armTop - 4 + armDy, 4, 3, skin);
    c.outlineRect(bodyX + 12, armTop - 4 + armDy, 4, 3, OUTLINE);
    // Cup
    const cupY = armTop - 8 + cupOffset;
    c.rect(bodyX + 11, cupY, 6, 5, drink);
    c.outlineRect(bodyX + 11, cupY, 6, 5, OUTLINE);
    // Steam — alternates per frame for a wisp effect
    const steamA = [255, 255, 255, 180];
    if (frame === 0) {
      c.rect(bodyX + 12, cupY - 3, 1, 2, steamA);
      c.rect(bodyX + 15, cupY - 4, 1, 2, steamA);
    } else if (frame === 1) {
      c.rect(bodyX + 13, cupY - 4, 1, 2, steamA);
      c.rect(bodyX + 14, cupY - 3, 1, 2, steamA);
    } else if (frame === 2) {
      c.rect(bodyX + 12, cupY - 4, 1, 2, steamA);
      c.rect(bodyX + 15, cupY - 3, 1, 2, steamA);
    } else {
      c.rect(bodyX + 13, cupY - 3, 1, 2, steamA);
      c.rect(bodyX + 14, cupY - 4, 1, 2, steamA);
    }
  } else if (state === 'idle') {
    // Loose sway: 0, +1, 0, -1 lean (gentle pendulum)
    const lean = [0, 1, 0, -1][frame];
    c.rect(bodyX - 3 - lean, armTop, 3, 9, shirt);
    c.outlineRect(bodyX - 3 - lean, armTop, 3, 9, OUTLINE);
    c.rect(bodyX - 3 - lean, armTop + 9, 3, 3, skin);
    c.outlineRect(bodyX - 3 - lean, armTop + 9, 3, 3, OUTLINE);
    c.rect(bodyX + 14 + lean, armTop, 3, 9, shirt);
    c.outlineRect(bodyX + 14 + lean, armTop, 3, 9, OUTLINE);
    c.rect(bodyX + 14 + lean, armTop + 9, 3, 3, skin);
    c.outlineRect(bodyX + 14 + lean, armTop + 9, 3, 3, OUTLINE);
  } else if (state === 'away') {
    // Slumped, arms drape on desk surface — tiny breath shift
    const breath = [0, 0, 1, 0][frame];
    c.rect(bodyX - 3, armTop + 4 + breath, 3, 8, shirt);
    c.outlineRect(bodyX - 3, armTop + 4 + breath, 3, 8, OUTLINE);
    c.rect(bodyX - 3, armTop + 12 + breath, 3, 2, skin);
    c.rect(bodyX + 14, armTop + 4 + breath, 3, 8, shirt);
    c.outlineRect(bodyX + 14, armTop + 4 + breath, 3, 8, OUTLINE);
    c.rect(bodyX + 14, armTop + 12 + breath, 3, 2, skin);
  } else { // walk
    // Arms swing opposite to legs (left arm forward when right leg forward).
    // Frame swings:    0  1  2  3
    // legDxL pattern: -2  0  2  0  → left arm swings opposite: +1, 0, -1, 0
    // legDxR pattern: +2  0 -2  0  → right arm swings opposite: -1, 0, +1, 0
    const swingL = [1, 0, -1, 0][frame];
    const swingR = [-1, 0, 1, 0][frame];
    c.rect(bodyX - 3 + swingL, armTop, 3, 9, shirt);
    c.outlineRect(bodyX - 3 + swingL, armTop, 3, 9, OUTLINE);
    c.rect(bodyX - 3 + swingL, armTop + 9, 3, 3, skin);
    c.outlineRect(bodyX - 3 + swingL, armTop + 9, 3, 3, OUTLINE);
    c.rect(bodyX + 14 + swingR, armTop, 3, 9, shirt);
    c.outlineRect(bodyX + 14 + swingR, armTop, 3, 9, OUTLINE);
    c.rect(bodyX + 14 + swingR, armTop + 9, 3, 3, skin);
    c.outlineRect(bodyX + 14 + swingR, armTop + 9, 3, 3, OUTLINE);
  }
}

// Athlete-specific arm overlay: bicep bulge highlight + leather bracers on the
// forearm (the "armor"). Called AFTER drawArms paints bare-skin arms so the
// bracers sit on top of the wrist segment in every state/frame.
function drawAthleteArmDetail(c, bodyX, bodyY, agent, state, frame) {
  const skin = hex(agent.skin);
  const skinHi = shade(skin, 1.18);
  const bracer = [40, 28, 18, 255];      // dark leather
  const stud = [240, 200, 80, 255];      // gold stud on bracer
  const armTop = bodyY + 1;

  // Helper: paint a bracer (3-row dark band with one gold stud) at a given (x, y).
  const paintBracer = (x, y) => {
    c.rect(x, y, 3, 3, bracer);
    c.outlineRect(x, y, 3, 3, OUTLINE);
    c.px(x + 1, y + 1, stud);
  };
  // Helper: paint a bicep highlight (lighter shade strip on the upper arm) at (x, y).
  // Two pixels wide gives the bicep a clear bulge instead of a thin line, and an
  // extra dot near the elbow reads as a vein/peak detail.
  const paintBicep = (x, y) => {
    c.vline(x + 1, y + 1, 4, skinHi);
    c.px(x + 2, y + 2, skinHi);
    c.px(x + 1, y + 5, shade(skinHi, 0.85));
  };

  if (state === 'active') {
    // Typing — bicep dy mirrors drawArms typing dy
    const dyL = [0, -1, 0, 0][frame];
    const dyR = [0, 0, 0, -1][frame];
    paintBicep(bodyX - 3, armTop + dyL);
    paintBicep(bodyX + 14, armTop + dyR);
    // wrists are the skin block at armTop+7 — paint bracer there
    paintBracer(bodyX - 4, armTop + 7 + dyL);
    paintBracer(bodyX + 14, armTop + 7 + dyR);
  } else if (state === 'sip') {
    // Left arm hangs straight, right is raised holding the cup
    paintBicep(bodyX - 3, armTop);
    paintBracer(bodyX - 3, armTop + 9);
    // raised right arm — bracer on the lifted forearm
    const armDy = [0, -2, -2, 0][frame];
    paintBicep(bodyX + 13, armTop - 1 + armDy);
    paintBracer(bodyX + 12, armTop - 4 + armDy);
  } else if (state === 'idle') {
    const lean = [0, 1, 0, -1][frame];
    paintBicep(bodyX - 3 - lean, armTop);
    paintBicep(bodyX + 14 + lean, armTop);
    paintBracer(bodyX - 3 - lean, armTop + 9);
    paintBracer(bodyX + 14 + lean, armTop + 9);
  } else if (state === 'away') {
    const breath = [0, 0, 1, 0][frame];
    paintBicep(bodyX - 3, armTop + 4 + breath);
    paintBicep(bodyX + 14, armTop + 4 + breath);
    paintBracer(bodyX - 3, armTop + 12 + breath);
    paintBracer(bodyX + 14, armTop + 12 + breath);
  } else { // walk
    const swingL = [1, 0, -1, 0][frame];
    const swingR = [-1, 0, 1, 0][frame];
    paintBicep(bodyX - 3 + swingL, armTop);
    paintBicep(bodyX + 14 + swingR, armTop);
    paintBracer(bodyX - 3 + swingL, armTop + 9);
    paintBracer(bodyX + 14 + swingR, armTop + 9);
  }
}

// ---------- Build ----------

function build() {
  const W = SPRITE_W * STATES.length * FRAMES_PER_STATE;
  const H = SPRITE_H * AGENTS.length;
  const c = new Canvas(W, H);

  AGENTS.forEach((agent, row) => {
    STATES.forEach((state, sIdx) => {
      for (let f = 0; f < FRAMES_PER_STATE; f++) {
        const col = sIdx * FRAMES_PER_STATE + f;
        const ox = col * SPRITE_W;
        const oy = row * SPRITE_H;
        drawSprite(c, ox, oy, agent, state, f);
      }
    });
  });

  return { png: encodePNG(W, H, c.buf), W, H };
}

if (require.main === module) {
  const { png, W, H } = build();
  const outPath = path.join(__dirname, '..', 'public', 'sprites.png');
  fs.writeFileSync(outPath, png);

  const manifest = {
    spriteWidth: SPRITE_W,
    spriteHeight: SPRITE_H,
    states: STATES,
    framesPerState: FRAMES_PER_STATE,
    rows: AGENTS.map((a) => a.id),
    sheetWidth: W,
    sheetHeight: H,
  };
  fs.writeFileSync(
    path.join(__dirname, '..', 'public', 'sprites.json'),
    JSON.stringify(manifest, null, 2),
  );

  console.log(`Wrote ${png.length} bytes -> ${outPath}`);
  console.log(`Sheet: ${W}x${H}, ${AGENTS.length} agents x ${STATES.length * FRAMES_PER_STATE} frames`);
}

module.exports = { Canvas, encodePNG, drawSprite, AGENTS, STATES, FRAMES_PER_STATE, SPRITE_W, SPRITE_H };
