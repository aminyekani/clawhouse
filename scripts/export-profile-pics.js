#!/usr/bin/env node
// Render each agent's idle pose as a square Telegram-friendly profile pic.
// Reuses the deterministic sprite painter from build-sprites.js.
//
// Output: pixel-office/public/profile-pics/<id>.png  (768x768 PNG)
// Usage:   node scripts/export-profile-pics.js [agentId] [agentId...]
//          (no args = all agents)

const fs = require('fs');
const path = require('path');
const {
  Canvas,
  encodePNG,
  drawSprite,
  AGENTS,
  SPRITE_W,
  SPRITE_H,
} = require('./build-sprites');

// Per-agent backdrop colors — pulled from each room's wall theme so the avatar
// reads as "the agent in their office," not "the agent against a flat color."
// 4 stops produce a soft top→bottom gradient: sky → wall1 → wall2 → floor.
const BACKDROPS = {
  main:           { sky: '#5a6cb0', top: '#344075', bot: '#252f5d', floor: '#65462f' },
  markethunting:  { sky: '#3a7a64', top: '#24483e', bot: '#18332d', floor: '#5a4330' },
  sage:           { sky: '#5a7a72', top: '#39514a', bot: '#263831', floor: '#685240' },
  senku:          { sky: '#56758a', top: '#37505d', bot: '#223740', floor: '#5a4839' },
  shikamaru:      { sky: '#605d8c', top: '#3f3d67', bot: '#292745', floor: '#5f4d3f' },
  tyrion:         { sky: '#7a6358', top: '#58473b', bot: '#3c3028', floor: '#5e452f' },
  harvey:         { sky: '#6e5666', top: '#4c3945', bot: '#32242c', floor: '#654b3d' },
  l:              { sky: '#4a4f6c', top: '#2f334d', bot: '#202334', floor: '#564a41' },
  d:              { sky: '#6e526f', top: '#4a364f', bot: '#2f2234', floor: '#593f32' },
  ephraim:        { sky: '#586374', top: '#3a4452', bot: '#252c38', floor: '#3e4146' },
  house:          { sky: '#5a6c7a', top: '#3e4f5a', bot: '#293841', floor: '#52575e' },
};

const SCALE = 16;                                // 32x48 → 512x768
const SPRITE_PX_W = SPRITE_W * SCALE;            // 512
const SPRITE_PX_H = SPRITE_H * SCALE;            // 768
const CANVAS_SIZE = SPRITE_PX_H;                 // 768x768 — square for Telegram
const SPRITE_X_OFFSET = (CANVAS_SIZE - SPRITE_PX_W) >> 1;  // 128

// Idle, frame 0 — calm forward-facing pose, eyes open, no animation phase.
const STATE_IDX_IDLE = 1;
const FRAME_IDLE = 0;

function hexToRgb(hex) {
  const s = hex.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function lerpRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

function paintBackdrop(out, backdrop) {
  const sky   = hexToRgb(backdrop.sky);
  const top   = hexToRgb(backdrop.top);
  const bot   = hexToRgb(backdrop.bot);
  const floor = hexToRgb(backdrop.floor);
  // 4-stop vertical gradient: sky (0..0.18), wall (0.18..0.78), floor (0.78..1.0)
  for (let y = 0; y < CANVAS_SIZE; y++) {
    const v = y / (CANVAS_SIZE - 1);
    let rgb;
    if (v < 0.18)      rgb = lerpRgb(sky, top, v / 0.18);
    else if (v < 0.78) rgb = lerpRgb(top, bot, (v - 0.18) / 0.60);
    else               rgb = lerpRgb(bot, floor, (v - 0.78) / 0.22);
    for (let x = 0; x < CANVAS_SIZE; x++) {
      const i = (y * CANVAS_SIZE + x) * 4;
      out[i]     = rgb[0];
      out[i + 1] = rgb[1];
      out[i + 2] = rgb[2];
      out[i + 3] = 255;
    }
  }
}

// Draw a faint floor "platform" disc behind the sprite's feet — a soft oval
// shadow that grounds the character so it doesn't look like it's floating.
function paintGroundShadow(out) {
  const cx = CANVAS_SIZE >> 1;
  const cy = Math.round(CANVAS_SIZE * 0.82);
  const rx = SPRITE_PX_W * 0.42;
  const ry = SPRITE_PX_W * 0.10;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const v = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (v > 1) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) continue;
      const fall = 1 - v;
      const alpha = fall * 0.45;          // soft, peaks at ~45% darken
      const i = (y * CANVAS_SIZE + x) * 4;
      out[i]     = Math.round(out[i]     * (1 - alpha));
      out[i + 1] = Math.round(out[i + 1] * (1 - alpha));
      out[i + 2] = Math.round(out[i + 2] * (1 - alpha));
    }
  }
}

// Nearest-neighbor scale a 32x48 RGBA buffer into the larger canvas at the
// given top-left position, honoring source alpha (skip transparent pixels so
// the backdrop shows through around the sprite silhouette).
function blitScaled(spriteBuf, out, dstX, dstY) {
  for (let sy = 0; sy < SPRITE_H; sy++) {
    for (let sx = 0; sx < SPRITE_W; sx++) {
      const si = (sy * SPRITE_W + sx) * 4;
      const a = spriteBuf[si + 3];
      if (a === 0) continue;
      const r = spriteBuf[si], g = spriteBuf[si + 1], b = spriteBuf[si + 2];
      // Paint a SCALE x SCALE block
      for (let py = 0; py < SCALE; py++) {
        for (let px = 0; px < SCALE; px++) {
          const dx = dstX + sx * SCALE + px;
          const dy = dstY + sy * SCALE + py;
          if (dx < 0 || dx >= CANVAS_SIZE || dy < 0 || dy >= CANVAS_SIZE) continue;
          const di = (dy * CANVAS_SIZE + dx) * 4;
          if (a === 255) {
            out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = 255;
          } else {
            // Premultiplied-style blend onto opaque backdrop
            const t = a / 255;
            out[di]     = Math.round(r * t + out[di]     * (1 - t));
            out[di + 1] = Math.round(g * t + out[di + 1] * (1 - t));
            out[di + 2] = Math.round(b * t + out[di + 2] * (1 - t));
            out[di + 3] = 255;
          }
        }
      }
    }
  }
}

function exportAgent(agent) {
  const backdrop = BACKDROPS[agent.id];
  if (!backdrop) {
    console.warn(`No backdrop for ${agent.id}, skipping`);
    return;
  }

  // 1) Paint the sprite onto a fresh 32x48 canvas at (0, 0)
  const spriteCanvas = new Canvas(SPRITE_W, SPRITE_H);
  drawSprite(spriteCanvas, 0, 0, agent, 'idle', FRAME_IDLE);

  // 2) Paint backdrop into the output canvas
  const out = Buffer.alloc(CANVAS_SIZE * CANVAS_SIZE * 4);
  paintBackdrop(out, backdrop);
  paintGroundShadow(out);

  // 3) Center the sprite horizontally; place it so its feet land near 86% down
  const dstX = SPRITE_X_OFFSET;
  const dstY = Math.round(CANVAS_SIZE * 0.86) - SPRITE_PX_H;
  blitScaled(spriteCanvas.buf, out, dstX, dstY);

  // 4) Encode and write
  const png = encodePNG(CANVAS_SIZE, CANVAS_SIZE, out);
  const outDir = path.join(__dirname, '..', 'public', 'profile-pics');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${agent.id}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Wrote ${png.length} bytes -> ${outPath}`);
}

// ---- Run ----
const requested = process.argv.slice(2);
const targets = requested.length
  ? AGENTS.filter((a) => requested.includes(a.id))
  : AGENTS;

if (requested.length && targets.length === 0) {
  console.error(`No matching agents. Known: ${AGENTS.map((a) => a.id).join(', ')}`);
  process.exit(1);
}

for (const agent of targets) exportAgent(agent);
console.log(`Done. ${targets.length} profile pic(s) generated.`);
