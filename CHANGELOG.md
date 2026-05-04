# Changelog

All notable changes to clawhouse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-03

### Added
- Initial public release.
- Pixel-art fleet status board for OpenClaw agents — each agent gets a unique
  room with sprite, desk, wall colour, window scene, and ambient particles.
- Live USD cost panel per agent (session / 24h / 30d / 365d) with provider
  breakdown. Subscription-aware billing: prorates Claude Max / ChatGPT Plus
  flat fees instead of pretending subscription usage is per-token.
- Cost-aware room glow — amber when the current session is burning ≥40% of
  the agent's 24h spend, red-pulse at ≥75%.
- Speech bubbles (severity-coded) for crashed agents, failing streaks,
  hot-context warnings, and active-thinking states.
- Sub-agent visualisation — child sprites cluster next to the parent agent,
  with a `+N` badge past 3.
- Opt-in WebAudio chime when an agent transitions running → done. Toggle
  state persists in `localStorage`.
- Model switcher in the side panel — calls `openclaw config set` to change
  models without editing JSON.
- Products rail — optional launcher strip for apps your agents build
  (configured via `products.json`).
- Stats panel — token usage, context %, cache hit rate, recent sessions,
  scheduled cron jobs, queued tasks.
- Demo mode (`npm run demo` or `npx clawhouse --demo`) ships a synthetic
  full-cast fleet so every feature is visible without an OpenClaw install.
- npx entrypoint (`bin/clawhouse.js`) with `--demo`, `--port`, `--host`,
  `--state-dir`, `--openclaw` flags.
- Zero npm dependencies — plain Node.js with built-in `node:sqlite`.
  Requires Node ≥ 22.
- MIT licensed.

[Unreleased]: https://github.com/aminyekani/clawhouse/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aminyekani/clawhouse/releases/tag/v0.1.0
