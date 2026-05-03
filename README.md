# Pixel Office

A pixel-art status board for your [OpenClaw](https://openclaw.dev) agent fleet. Each agent gets their own room, sprite, and desk — the office updates live as your agents work.

## Features

- **One room per agent** — unique pixel-art sprite, desk style, wall colour, window scene, and ambient particles
- **Live status** — active / idle / away derived from session activity, polls every 5 seconds
- **Stats panel** — click any room to inspect token usage, cost, model, recent sessions, cron jobs, and queued tasks
- **Model switcher** — swap an agent's primary model in-UI without touching config files
- **Products rail** — optional launcher strip for agent-built apps and dashboards (`products.json`)
- **Demo mode** — works out of the box with no OpenClaw install; ships a full demo cast
- **Zero npm dependencies** — plain Node.js HTTP server; built-in SQLite for task stats (Node ≥ 22)

## Quick start

```bash
git clone https://github.com/aminyekani/Pixel-Office.git
cd Pixel-Office

# If you have OpenClaw running on this machine:
node server.js

# No OpenClaw? Demo mode shows the full cast:
npm run demo
```

Open **http://localhost:18890**.

## Requirements

| | |
|---|---|
| Node.js ≥ 22 | Uses built-in `node:sqlite` |
| OpenClaw | Optional — required only for live fleet data |

## Configuration

All configuration via environment variables:

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
# ~/.config/systemd/user/pixel-office.service
[Unit]
Description=Pixel Office fleet board
After=network.target

[Service]
WorkingDirectory=/path/to/Pixel-Office
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PIXEL_OFFICE_PORT=18890

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now pixel-office
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

## License

MIT — see [LICENSE](LICENSE).
