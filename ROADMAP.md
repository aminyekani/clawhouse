# Roadmap

Where clawhouse is headed. Items aren't promises — they're tracked
priorities, roughly ordered by what's most likely to land next.

## Next up

### Claude Code adapter
Read agent state from `~/.claude/projects/<project-id>/<session-id>.jsonl`
in addition to `~/.openclaw/sessions.json`. Required to honestly claim
"agent fleet board" beyond OpenClaw users.

The adapter surface is small — `getAgents()`, `getSessions()`,
`getUsage()`. OpenClaw becomes one implementation; Claude Code becomes
the second. The cost-tracking machinery already maps cleanly onto
Claude Code's per-session token logs.

### Demo GIF in README
Record a 15-20 second loop of `npm run demo` showing the rooms ticking,
burn-glow pulse, sub-agent minions, and speech bubbles. Replace the
placeholder block in the README. Highest-ROI marketing move —
README readers don't read, they look.

## Considering

- Cursor adapter (reads `~/.cursor/...` agent state).
- Codex CLI adapter.
- VS Code extension wrapper that embeds the office in a sidebar panel.
- MCP server exposing fleet state to other agents (so Claude can ask
  "what's my fleet doing?" mid-conversation).
- Telegram / Slack notifications when an agent crashes or hits a budget
  alarm.
- Configurable burn thresholds per agent (currently fixed at 40% / 75%
  of 24h spend).
- Historical cost trend charts in the side panel.

## Not planned

- Built-in remote access. Use Tailscale, Cloudflare Tunnel, or
  `ssh -L 18890:localhost:18890` — each is more flexible than anything
  baked-in.
- Agent runtime inside clawhouse. This is a board, not an orchestrator.
  Pair it with OpenClaw / Claude Code / your stack of choice.
- Per-room customization UI. Use `docs/CUSTOMIZE.md` and the build
  scripts — the system is intentionally generative, not a config blob.

## How to suggest

Open an issue at https://github.com/aminyekani/clawhouse/issues. The
"Considering" list shifts based on what people actually use.
