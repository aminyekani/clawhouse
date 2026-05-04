# Clawhouse

**Live cost + model control for your [OpenClaw](https://openclaw.dev) fleet — in a pixel-art office your agents actually live in.**

> Part of **Clawvision** — the visualization family for OpenClaw. Clawhouse is the office; sibling apps will follow.

Other pixel-office projects show your agents walking around. This one is the only one that also tracks **what each session costs**, **which model is burning your budget**, and **lets you swap models without editing JSON**. The pixels are the hook; the cost panel is the reason to keep it open.

> _Demo GIF goes here — record with `npm run demo` and any screen recorder._

---

## Why this one

| | Clawhouse | [pixel-agents](https://github.com/pablodelucca/pixel-agents) | [Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI) | [agent-office](https://github.com/harishkotra/agent-office) |
|---|---|---|---|---|
| OpenClaw native (sessions, cron, sub-agents) | ✅ | ❌ Claude Code only | ✅ | ❌ Ollama |
| Live USD cost per agent / per window | ✅ | ❌ | ❌ | ❌ |
| Cost-aware room glow (red when burning hot) | ✅ | ❌ | ❌ | ❌ |
| Model switcher in-UI | ✅ | ❌ | ❌ | ❌ |
| Sub-agent visualisation | ✅ | ✅ | ❌ | ✅ |
| Speech bubbles for "needs attention" | ✅ | ✅ | ❌ | ❌ |
| Task-completion sound chime | ✅ | ✅ | ❌ | ❌ |
| Zero npm dependencies | ✅ | ❌ build chain | ❌ Python+pip | ❌ TS monorepo |
| One-command demo (no install) | ✅ `npm run demo` | ❌ | ❌ | ❌ |

## Features at a glance

- **Live cost panel** — per-agent USD spend rolled up by current session / 24h / 30d / 365d, with provider breakdown (Anthropic / OpenAI). Subscription-aware: prorates a flat monthly fee instead of pretending sub usage is per-token billed.
- **Cost-aware room glow** — agent's room flashes amber when this session is burning ≥40% of its 24h budget, red-pulsing when ≥75%. The "is this expensive?" gut check, visible at a glance.
- **Speech bubbles** — agents call out when they crash, fail consecutively, run hot on context, or are actively thinking. Severity-coloured (red / amber / blue) so a glance tells you which room to click.
- **Sub-agent minions** — small sprites cluster next to the parent when an agent has spawned background workers. `+N` badge appears past 3.
- **Sound chime** — opt-in (🔔 button in the topbar) WebAudio ding when an agent transitions from `running` to `done`. State persists in `localStorage`.
- **Model switcher** — drop-down in the side panel calls `openclaw config set` so you can demote Opus → Sonnet → Haiku without touching `~/.openclaw/openclaw.json`.
- **Products rail** — optional launcher strip above the office grid for apps and dashboards your agents build (`products.json`).
- **Stats panel** — token usage, context %, cache hit rate, model in use, recent sessions, scheduled cron jobs, queued tasks — all the data that's already in `~/.openclaw/` rendered without the JSON.

## Quick start

```bash
# Run instantly with no install (demo mode)
npx clawhouse --demo

# Or clone for local dev:
git clone https://github.com/aminyekani/clawhouse.git
cd clawhouse
npm run demo            # synthetic full-cast demo, no OpenClaw needed
node server.js          # live mode if OpenClaw is running on this machine
```

Open **http://localhost:18890**. Demo mode is auto-enabled when `~/.openclaw` doesn't exist, or force it with `PIXEL_OFFICE_DEMO=1`.

## Requirements

| | |
|---|---|
| Node.js ≥ 22 | Uses built-in `node:sqlite` |
| OpenClaw | Optional — only needed for live fleet data |

## Configuration

All configuration via environment variables — no config file:

| Variable | Default | Description |
|---|---|---|
| `PIXEL_OFFICE_PORT` | `18890` | HTTP listen port |
| `PIXEL_OFFICE_HOST` | `0.0.0.0` | Bind address (`127.0.0.1` for local-only) |
| `OPENCLAW_URL` | `http://127.0.0.1:18789/` | OpenClaw gateway URL (for model-switch actions) |
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | Path to your OpenClaw state directory |
| `PIXEL_OFFICE_DEMO` | _(unset)_ | Set `1` to force demo mode |
| `PIXEL_OFFICE_MODELS` | _(built-in list)_ | JSON array of `{id, label}` to offer in the model switcher |

## Customising your fleet

See **[docs/CUSTOMIZE.md](docs/CUSTOMIZE.md)** for step-by-step instructions on:

- Adding a new agent room (sprite, props, monitor, room theme)
- Changing an agent's appearance (skin, hair, outfit, face type, accessories)
- Writing a custom wall prop or monitor screen in the build scripts
- Adding products to the launcher rail

## Building sprite atlases

The PNG sprite sheets are pre-built and committed, so you only need to rebuild after changing visual definitions:

```bash
npm run build           # rebuild all atlases (sprites, props, monitors, furniture, icons)
npm run build:sprites   # character sprites only
npm run build:profiles  # export 768×768 profile pics (Telegram-ready)
```

## Running as a service (systemd)

```ini
# ~/.config/systemd/user/clawhouse.service
[Unit]
Description=Clawhouse fleet board
After=network.target

[Service]
WorkingDirectory=/path/to/clawhouse
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PIXEL_OFFICE_PORT=18890

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now clawhouse
```

## Optional: products.json

Drop a `products.json` next to `server.js` to add a launch strip above the office grid. See `products.example.json` for the full schema. Each product declares:

```jsonc
{
  "products": [
    {
      "id":          "my-dashboard",
      "agentId":     "analyst",
      "name":        "My Dashboard",
      "description": "Short blurb shown in the card.",
      "status":      "live",
      "port":        8787,
      "path":        "/dashboard/",
      "start": {
        "cwd":  "/path/to/project",
        "cmd":  "node",
        "args": ["start.mjs"]
      }
    }
  ]
}
```

## Status rules

| Age of last session activity | Status |
|---|---|
| < 1 minute | 🟢 active |
| 1–10 minutes | 🟡 idle |
| ≥ 10 minutes | ⚪ away |

## Burn-rate rules

The room glow compares the current session's billed cost to the trailing 24h:

| `session.billed / day.billed` | Visual |
|---|---|
| < 40% | normal room glow |
| 40 – 75% | 🟠 amber static glow ("hot") |
| ≥ 75% | 🔴 red pulse glow ("critical") |

## Speech-bubble rules

| Trigger | Variant |
|---|---|
| Last session ended mid-run (`abortedLastRun`) | 🔴 alert (pulse) |
| Same task failed ≥ 2× in a row | 🔴 alert (pulse) |
| Task issue in last 6h | 🟠 warn |
| Context window ≥ 95% full | 🟠 warn |
| Session running, agent active | 🔵 busy |
| Otherwise | personality quip (rotates each minute) |

## License

MIT — see [LICENSE](LICENSE).
