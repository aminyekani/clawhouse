# Customising Pixel Office

This guide walks through the three layers you touch to add or modify an agent.

---

## Adding a new agent

### 1. Add the sprite definition (`scripts/build-sprites.js`)

Find the `AGENTS` array near the top of the file and append your agent:

```js
const AGENTS = [
  // ... existing agents ...
  {
    id: 'nova',           // must match the id in OpenClaw's openclaw.json
    skin:      '#f3c89c', // hex — skin tone
    hair:      '#1a1f3a', // hex — hair colour
    hairStyle: 'plain',   // plain | slicked | messy | ponytail | wavy | crewcut | tallspiky
    outfit:    '#3a4a8c', // hex — primary outfit colour
    outfit2:   '#7f93ff', // hex — secondary/trim colour
    accessory: 'tie',     // tie | hood | goggles | cape | vest | headphones | goblet | athlete | none
    drink:     '#3a4a8c', // hex — mug / cup colour
    face:      'stern',   // stern | focus | kind | sharp | bored | mismatched | smug | blank | cheerful | coach | snark
  },
];
```

Then rebuild:

```bash
npm run build:sprites
```

The new agent occupies the **next row** in `public/sprites.png` (rows are zero-indexed, matching AGENTS array order).

---

### 2. Add the wall prop (`scripts/build-props.js`)

The wall prop is the decorative item mounted behind the desk. Add a `case` for your agent id:

```js
// In the main render switch inside build-props.js:
case 'nova': paintMyCustomProp(c, ox, oy); break;
```

Write a paint function above it:

```js
function paintMyCustomProp(c, ox, oy) {
  // c is a Canvas(32, 32). ox/oy are the tile origin (top-left of the 32×32 cell).
  // Use c.px(x, y, [r, g, b, a]) and c.rect(x, y, w, h, color).
  // Example: a simple framed picture
  c.rect(ox + 8,  oy + 4,  16, 20, [180, 140, 90, 255]); // frame
  c.rect(ox + 10, oy + 6,  12, 16, [200, 220, 255, 255]); // picture content
}
```

Also add your agent id to the top-level AGENTS list in `build-props.js`, at the same index position as in `build-sprites.js`:

```js
const AGENTS = ['main', 'markethunting', ..., 'nova'];
```

Rebuild:

```bash
npm run build:props
```

---

### 3. Add the monitor screen (`scripts/build-monitors.js`)

The monitor shows a mini graphic on the desk screen. Add to the `SCREENS` map:

```js
const SCREENS = {
  // ... existing entries ...
  nova: paintMyMonitorScreen,
};
```

Write a paint function:

```js
function paintMyMonitorScreen(c, ox, oy) {
  // Same 32×32 canvas. Example: simple terminal prompt lines.
  const green = [80, 220, 100, 255];
  const dim   = [40, 110, 50, 255];
  c.rect(ox + 4, oy + 8,  18, 1, green);
  c.rect(ox + 4, oy + 11, 14, 1, dim);
  c.rect(ox + 4, oy + 14, 16, 1, dim);
  c.rect(ox + 4, oy + 17,  4, 1, green); // cursor
}
```

Add to the AGENTS list in `build-monitors.js` at the matching position.

Rebuild:

```bash
npm run build:monitors
```

---

### 4. Add the room config (`public/index.html`)

Find `const AGENT_CONFIG` in `index.html` and add your agent's room theme:

```js
nova: {
  theme: {
    wall1:  '#2a3a5e',  // upper wall colour
    wall2:  '#1a2540',  // lower wall colour
    floor1: '#806447',  // front floor stripe
    floor2: '#5a4330',  // back floor stripe
    accent: '#7ed1ff',  // highlight / glow colour
    accent2:'#e4f8ff',  // lighter highlight
    shirt:  '#7f93ff',  // sprite shirt colour (matches outfit in sprite def)
    hair:   '#1a1f3a',  // sprite hair colour
    prop:   'plant',    // unused legacy field — keep any string
    mood:   'deep space control', // shown in the stats panel
    glow:   '#77f1cc',  // ambient glow particle colour
  },
  spriteRow:  11,       // index in AGENTS array from build-sprites.js
  propPos:   'wall',    // 'wall' | 'desk' | 'floor'
  desk:      'walnut',  // 'oak' | 'steel' | 'walnut' | 'white'
  cup:       'crimson', // cup colour token (see CSS .cup.<token>)
  floor:     'oak',     // 'oak' | 'graphite' | 'ash' | 'cherry'
  deskPieces: [],       // optional desk decorations — see DESK_KIT in index.html
  decor:     'window-nova', // CSS class name for the window scene
  personalityLines: ['on it.', 'scanning.', 'all clear.'],
},
```

Then add a window CSS block (still in `index.html`, in the `<style>` section, near the other `.decor.window-*` rules):

```css
.decor.window-nova {
  background:
    /* sky gradient */
    linear-gradient(180deg, #0d1a3a 0%, #1a3060 40%, #2a4a8a 100%);
}
.decor.window-nova::before {
  /* optional foreground layer — stars, mountains, cityscape, etc. */
  content: '';
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 70% 30%, rgba(255,255,255,0.9) 1px, transparent 2px),
    radial-gradient(circle at 20% 15%, rgba(255,255,255,0.7) 1px, transparent 2px);
}
```

Also add `window-nova` to the shared CSS selector lists near the top of the window rules (look for the block that lists all `.decor.window-*` selectors for shared `position`, `border-radius`, and `overflow` properties).

---

## Changing an existing agent's appearance

Edit the relevant entry in `build-sprites.js` and rebuild:

```bash
npm run build:sprites
```

The browser caches sprites by a hash that updates automatically on each rebuild, so no hard-refresh is needed.

---

## Available face types

| Name | Description |
|---|---|
| `stern` | flat brow, neutral mouth — command / authority |
| `focus` | slightly furrowed, intense eyes |
| `kind` | soft eyes, gentle smile |
| `sharp` | alert, high-contrast pupils |
| `bored` | half-lidded, flat expression |
| `mismatched` | one brow up, one down — chaotic/playful |
| `smug` | raised brow, confident smirk |
| `blank` | wide eyes, no expression — mysterious |
| `cheerful` | bright eyes, wide smile |
| `coach` | intense squint, set jaw |
| `snark` | symmetric skeptical brows, stubble, asymmetric smirk |

## Available hair styles

`plain` · `slicked` · `messy` · `ponytail` · `wavy` · `crewcut` · `tallspiky`

## Available accessories

`tie` · `hood` · `goggles` · `cape` · `vest` · `headphones` · `goblet` · `athlete` · `none`
