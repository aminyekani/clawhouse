const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const usage = require('./lib/usage');

const PRICES_PATH = path.join(__dirname, 'prices.json');

// Models the in-app model-switcher will offer. Edit to taste; the endpoint
// validates against this allowlist so only known-good ids reach `openclaw
// config set`. Override at startup with PIXEL_OFFICE_MODELS=json-array.
const DEFAULT_MODEL_OPTIONS = [
  { id: 'claude-cli/claude-opus-4-7',    label: 'Opus 4.7' },
  { id: 'claude-cli/claude-opus-4-6',    label: 'Opus 4.6' },
  { id: 'claude-cli/claude-sonnet-4-6',  label: 'Sonnet 4.6' },
  { id: 'claude-cli/claude-haiku-4-5',   label: 'Haiku 4.5' },
  { id: 'openai-codex/gpt-5.4',          label: 'GPT-5.4' },
  { id: 'openai-codex/gpt-5.4-mini',     label: 'GPT-5.4 mini' },
];
function parseModelsEnv() {
  const raw = process.env.PIXEL_OFFICE_MODELS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(m => m && typeof m.id === 'string');
  } catch { return null; }
}
const MODEL_OPTIONS = parseModelsEnv() || DEFAULT_MODEL_OPTIONS;
const MODEL_OPTION_IDS = new Set(MODEL_OPTIONS.map(m => m.id));

const PORT = Number(process.env.PIXEL_OFFICE_PORT || 18890);
const HOST = process.env.PIXEL_OFFICE_HOST || '0.0.0.0';
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), '.openclaw');
const PUBLIC_DIR = path.join(__dirname, 'public');
const OPENCLAW_URL = process.env.OPENCLAW_URL || 'http://127.0.0.1:18789/';
const DEMO_MODE = process.env.PIXEL_OFFICE_DEMO === '1' || !fs.existsSync(STATE_DIR);

// In demo mode the server has no `~/.openclaw/` state to read, so we ship
// a fixture cast that matches the agent ids the index.html AGENT_CONFIG knows
// how to render. Each demo entry's `demo` block synthesises plausible session
// state — varied ages, token counts, and signals — so the bubble/glow features
// are visible out of the box without anyone needing to install OpenClaw.
const DEMO_FLEET = {
  agents: {
    list: [
      { id: 'main',          identity: { name: 'Commander',  emoji: '🦅' }, demo: { ageS: 12,    totalTokens: 92_400,  contextWindow: 200_000, sessionStatus: 'running', sessionCost: 0.05, dayCost: 0.12, subagents: 2 } },
      { id: 'markethunting', identity: { name: 'Analyst',    emoji: '📈' }, demo: { ageS: 320,   totalTokens: 188_000, contextWindow: 200_000, sessionStatus: 'done', abortedLastRun: true, sessionCost: 1.20, dayCost: 1.30 } },
      { id: 'sage',          identity: { name: 'Mentor',     emoji: '🍵' }, demo: { ageS: 1100,  totalTokens: 41_200,  contextWindow: 200_000, sessionStatus: 'done', sessionCost: 0.03, dayCost: 0.18 } },
      { id: 'senku',         identity: { name: 'Scientist',  emoji: '🧪' }, demo: { ageS: 4,     totalTokens: 156_800, contextWindow: 200_000, sessionStatus: 'running', sessionCost: 0.30, dayCost: 0.32, subagents: 3 } },
      { id: 'shikamaru',     identity: { name: 'Strategist', emoji: '♟️' }, demo: { ageS: 240,   totalTokens: 64_300,  contextWindow: 200_000, sessionStatus: 'running', sessionCost: 0.08, dayCost: 0.25 } },
      { id: 'tyrion',        identity: { name: 'Financier',  emoji: '🍷' }, demo: { ageS: 3600,  totalTokens: 12_900,  contextWindow: 200_000, sessionStatus: 'done', consecutiveFailures: 2, sessionCost: 0.01, dayCost: 0.15 } },
      { id: 'harvey',        identity: { name: 'Counsel',    emoji: '⚖️' }, demo: { ageS: 18,    totalTokens: 88_400,  contextWindow: 200_000, sessionStatus: 'running', sessionCost: 0.40, dayCost: 0.50, subagents: 1 } },
      { id: 'l',             identity: { name: 'Auditor',    emoji: '🍬' }, demo: { ageS: 600,   totalTokens: 33_500,  contextWindow: 200_000, sessionStatus: 'done', sessionCost: 0.02, dayCost: 0.09 } },
      { id: 'd',             identity: { name: 'Producer',   emoji: '🎤' }, demo: { ageS: 7400,  totalTokens: 22_100,  contextWindow: 200_000, sessionStatus: 'done', sessionCost: 0.01, dayCost: 0.07 } },
      { id: 'ephraim',       identity: { name: 'Coach',      emoji: '🏋️' }, demo: { ageS: 90,    totalTokens: 71_200,  contextWindow: 200_000, sessionStatus: 'running', sessionCost: 0.12, dayCost: 0.28 } },
      { id: 'house',         identity: { name: 'Doctor',     emoji: '🩺' }, demo: { ageS: 32_400, totalTokens: 8_800,  contextWindow: 200_000, sessionStatus: 'done', sessionCost: 0.00, dayCost: 0.04 } },
    ],
  },
};

function loadFleetConfig() {
  if (DEMO_MODE) return DEMO_FLEET;
  return readJson(path.join(STATE_DIR, 'openclaw.json'), { agents: { list: [] } });
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}
function readText(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}
function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function extractField(markdown, field) {
  const re = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`);
  const match = markdown.match(re);
  return match ? match[1].trim() : null;
}

function shortenVibe(vibe) {
  if (!vibe) return null;
  return vibe.replace(/\([^)]*\)/g, '').replace(/[—–]/g, '-').trim().slice(0, 90);
}

function deriveHint(sessionKey, channel, chatType) {
  if (channel === 'telegram' && chatType === 'direct') return 'on telegram, direct';
  if (channel === 'telegram') return 'on telegram, group';
  if (sessionKey && sessionKey.includes(':cron:')) return 'scheduled run';
  if (sessionKey && sessionKey.includes(':subagent:')) return 'background worker';
  return 'standby';
}

function formatRelative(msAgo) {
  const sec = Math.max(0, Math.floor(msAgo / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function deriveStatus(updatedAt) {
  if (!updatedAt) return { key: 'away', label: 'away', age: Infinity };
  const age = Date.now() - updatedAt;
  if (age < 60_000) return { key: 'active', label: 'active', age };
  if (age < 10 * 60_000) return { key: 'idle', label: 'idle', age };
  return { key: 'away', label: 'away', age };
}

function modelShortName(modelId) {
  if (!modelId) return null;
  return modelId.replace(/^claude-cli\//, '').replace(/^openai-codex\//, '').replace(/^openai\//, '').replace(/^ollama\//, '');
}

// Reads ~/.openclaw/tasks/runs.sqlite and returns per-agent task signals:
//   tracked/active/issues/succeeded  — lifetime counts (matches gateway)
//   recentIssues                     — failed/timed_out/lost/cancelled in last 6h
//   consecutiveFailures              — count of recurring sources whose LATEST 2
//                                      runs both failed (the "actually broken" signal)
// Cached by sqlite mtime; opens the DB only when the file changes.
const TASKS_CACHE = { mtimeMs: 0, byAgent: {} };
const ACTIVE_STATUSES = new Set(['queued', 'running']);
const ISSUE_STATUSES  = new Set(['failed', 'timed_out', 'lost', 'cancelled']);
const RECENT_ISSUE_WINDOW_MS = 6 * 60 * 60 * 1000;
function tasksByAgent() {
  const filePath = path.join(STATE_DIR, 'tasks', 'runs.sqlite');
  let stat;
  try { stat = fs.statSync(filePath); } catch { return {}; }
  if (stat.mtimeMs === TASKS_CACHE.mtimeMs) return TASKS_CACHE.byAgent;
  const byAgent = {};
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(filePath, { readOnly: true });
    const cutoff = Date.now() - RECENT_ISSUE_WINDOW_MS;

    // Lifetime counts.
    const rows = db.prepare("SELECT agent_id, status, COUNT(*) c FROM task_runs GROUP BY agent_id, status").all();
    for (const r of rows) {
      const id = r.agent_id; if (!id) continue;
      const b = byAgent[id] || (byAgent[id] = {
        tracked: 0, active: 0, issues: 0, succeeded: 0,
        recentIssues: 0, consecutiveFailures: 0,
      });
      b.tracked += r.c;
      if (ACTIVE_STATUSES.has(r.status)) b.active += r.c;
      else if (ISSUE_STATUSES.has(r.status)) b.issues += r.c;
      else if (r.status === 'succeeded') b.succeeded += r.c;
    }

    // Recent issues (last 6h).
    const recent = db.prepare(`
      SELECT agent_id, COUNT(*) c FROM task_runs
      WHERE status IN ('failed','timed_out','lost','cancelled')
        AND COALESCE(ended_at, last_event_at, started_at) > ?
      GROUP BY agent_id
    `).all(cutoff);
    for (const r of recent) {
      const id = r.agent_id; if (!id) continue;
      const b = byAgent[id] || (byAgent[id] = { tracked: 0, active: 0, issues: 0, succeeded: 0, recentIssues: 0, consecutiveFailures: 0 });
      b.recentIssues = r.c;
    }

    // Consecutive failures: per source_id, look at last 2 ENDED runs; if both
    // are failures, count that source as a consecutive-failure case.
    const streak = db.prepare(`
      WITH ranked AS (
        SELECT agent_id, source_id, status,
               ROW_NUMBER() OVER (PARTITION BY source_id
                                  ORDER BY COALESCE(ended_at, last_event_at, started_at) DESC) AS rn
        FROM task_runs
        WHERE source_id IS NOT NULL
          AND status NOT IN ('queued','running')
      )
      SELECT agent_id, source_id
      FROM ranked WHERE rn <= 2
      GROUP BY agent_id, source_id
      HAVING COUNT(*) = 2
         AND SUM(CASE WHEN status IN ('failed','timed_out','lost','cancelled') THEN 1 ELSE 0 END) = 2
    `).all();
    for (const r of streak) {
      const id = r.agent_id; if (!id) continue;
      const b = byAgent[id] || (byAgent[id] = { tracked: 0, active: 0, issues: 0, succeeded: 0, recentIssues: 0, consecutiveFailures: 0 });
      b.consecutiveFailures = (b.consecutiveFailures || 0) + 1;
    }

    db.close();
  } catch {}
  TASKS_CACHE.mtimeMs = stat.mtimeMs;
  TASKS_CACHE.byAgent = byAgent;
  return byAgent;
}

// Reads ~/.openclaw/cron/jobs.json (definitions) merged with jobs-state.json
// (live runtime state — nextRunAtMs, lastRunStatus, etc.). Returns:
//   { agentId -> { count, jobs: [{name, expr, tz, nextRunAtMs, lastStatus}] } }
// Cached by combined mtime so unchanged polls cost zero.
const CRON_CACHE = { mtimeKey: '', byAgent: {} };
function cronJobsByAgent() {
  const defsPath  = path.join(STATE_DIR, 'cron', 'jobs.json');
  const statePath = path.join(STATE_DIR, 'cron', 'jobs-state.json');
  let defsStat, stateStat;
  try { defsStat  = fs.statSync(defsPath);  } catch { return {}; }
  try { stateStat = fs.statSync(statePath); } catch {}
  const mtimeKey = `${defsStat.mtimeMs}|${stateStat?.mtimeMs || 0}`;
  if (mtimeKey === CRON_CACHE.mtimeKey) return CRON_CACHE.byAgent;

  const defsJson  = readJson(defsPath, null);
  const stateJson = readJson(statePath, null);
  const defs = Array.isArray(defsJson) ? defsJson : (defsJson?.jobs || (defsJson ? Object.values(defsJson) : []));
  const stateById = stateJson?.jobs || {};

  const byAgent = {};
  for (const job of defs) {
    if (!job || job.enabled === false) continue;
    const id = job.agentId;
    if (!id) continue;
    const live = stateById[job.id]?.state || {};
    const slot = byAgent[id] || (byAgent[id] = { count: 0, jobs: [] });
    slot.count += 1;
    slot.jobs.push({
      name: job.name || job.id,
      expr: job.schedule?.expr || (job.schedule?.kind === 'at' ? 'one-shot' : ''),
      tz: job.schedule?.tz || null,
      nextRunAtMs: live.nextRunAtMs || null,
      lastRunAtMs: live.lastRunAtMs || null,
      lastStatus: live.lastStatus || live.lastRunStatus || null,
    });
  }
  for (const slot of Object.values(byAgent)) {
    slot.jobs.sort((a, b) => (a.nextRunAtMs ?? Infinity) - (b.nextRunAtMs ?? Infinity));
  }
  CRON_CACHE.mtimeKey = mtimeKey;
  CRON_CACHE.byAgent = byAgent;
  return byAgent;
}

function summarizeSessions(sessions) {
  const byChannel = {};
  let latest = null;
  let latestMeta = null;
  let directCount = 0;
  let groupCount = 0;
  let cronCount = 0;
  let subagentCount = 0;
  for (const [sessionKey, meta] of Object.entries(sessions || {})) {
    const updatedAt = Number(meta?.updatedAt || 0);
    const channel = meta?.lastChannel || (sessionKey.split(':')[2] || 'unknown');
    byChannel[channel] = (byChannel[channel] || 0) + 1;
    if (sessionKey.includes(':direct:')) directCount++;
    else if (sessionKey.includes(':group:')) groupCount++;
    if (sessionKey.includes(':cron:')) cronCount++;
    if (sessionKey.includes(':subagent:')) subagentCount++;
    if (!latest || updatedAt > latest.updatedAt) {
      latest = {
        sessionKey,
        updatedAt,
        sessionId: meta?.sessionId || null,
        chatType: meta?.chatType || null,
        lastChannel: meta?.lastChannel || null,
      };
      latestMeta = meta;
    }
  }
  return { latest, latestMeta, byChannel, directCount, groupCount, cronCount, subagentCount };
}

// Pulls the same per-session token fields the gateway shows in
// `openclaw sessions` — totalTokens, contextTokens (model context window),
// cacheRead — straight from sessions.json. Mirrors the gateway's
// `formatTokensCell(total, contextTokens)` math so display values match.
function tokenSummaryFromSession(meta) {
  const empty = {
    totalTokens: 0, contextWindow: 0, contextPct: 0, cachePct: 0, sessionModel: null,
    inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
  };
  if (!meta) return empty;
  const total = Number(meta.totalTokens || 0);
  const ctxWindow = Number(meta.contextTokens || 0);
  const cacheRead = Number(meta.cacheRead || 0);
  const cacheWrite = Number(meta.cacheWrite || 0);
  const inputTokens = Number(meta.inputTokens || 0);
  const outputTokens = Number(meta.outputTokens || 0);
  const contextPct = ctxWindow ? Math.min(999, Math.round((total / ctxWindow) * 100)) : 0;
  const cachePct = total > 0 ? Math.round((cacheRead / total) * 100) : 0;
  const sessionModel = modelShortName(meta.modelOverride || meta.model || null);
  return {
    totalTokens: total, contextWindow: ctxWindow, contextPct, cachePct, sessionModel,
    inputTokens, outputTokens, cacheRead, cacheWrite,
  };
}

function summarizeMemory(memDir) {
  const files = safeReaddir(memDir).filter(f => f.endsWith('.md'));
  const datedLogs = files.filter(f => /^\d{4}-\d{2}-\d{2}/.test(f));
  let latestLog = null;
  let latestMtime = 0;
  for (const f of datedLogs) {
    try {
      const stat = fs.statSync(path.join(memDir, f));
      if (stat.mtimeMs > latestMtime) { latestMtime = stat.mtimeMs; latestLog = f; }
    } catch {}
  }
  return {
    totalNotes: files.length,
    datedLogs: datedLogs.length,
    latestLog,
    latestLogAt: latestMtime || null,
  };
}

// Optional `products.json` lets each agent declare apps/dashboards the office
// can launch. Same shape across consumers, so the side panel builds matching
// "Local" and "LAN" launch buttons (host:port + optional path).
// Returns this host's non-loopback IPv4 addresses, used by the front-end as
// the LAN target for product launch buttons when the page itself was loaded
// over loopback (so window.location.hostname can't be trusted as the LAN IP).
function detectLanHosts() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

const PRODUCTS_PATH = path.join(__dirname, 'products.json');
function loadProducts() {
  const json = readJson(PRODUCTS_PATH, null);
  const list = Array.isArray(json?.products) ? json.products : [];
  const byAgent = {};
  for (const p of list) {
    if (!p?.agentId) continue;
    (byAgent[p.agentId] ||= []).push(p);
  }
  return byAgent;
}

// Note: reachability is probed client-side (see probeUrl in index.html) so we
// test from the browser's network perspective. The server can't reliably
// probe Windows-host services from WSL2 due to mirrored-networking namespace
// separation, so a server probe produces false negatives.

// Spawns a product's declared start command in detached mode. The launched
// process keeps running after this server restarts (setsid + unref). stdout
// and stderr go to /tmp/pixel-office-launch-<id>.log so the user can debug
// why a launch failed without watching the pixel-office log.
//
// Security: cmd + args go directly to spawn() with shell:false, so there is
// no shell interpretation of args. The `cwd` and `cmd` come from the static
// products.json file on disk — they are NOT taken from the request body.
// The endpoint only takes a product id and looks the rest up server-side.
function launchProduct(product) {
  const start = product.start;
  if (!start || !start.cmd) return { ok: false, error: 'no start command declared' };
  if (!start.cwd) return { ok: false, error: 'no cwd declared' };
  try { fs.accessSync(start.cwd, fs.constants.R_OK); }
  catch { return { ok: false, error: `cwd not accessible: ${start.cwd}` }; }
  const logPath = `/tmp/pixel-office-launch-${product.id}.log`;
  let logFd;
  try { logFd = fs.openSync(logPath, 'a'); }
  catch (e) { return { ok: false, error: `cannot open log: ${e.message}` }; }
  fs.writeSync(logFd, `\n=== launch at ${new Date().toISOString()} ===\n`);
  try {
    const child = spawn(start.cmd, start.args || [], {
      cwd: start.cwd,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, ...(start.env || {}) },
    });
    child.unref();
    fs.closeSync(logFd);
    return { ok: true, pid: child.pid, logPath };
  } catch (e) {
    try { fs.closeSync(logFd); } catch {}
    return { ok: false, error: e.message };
  }
}

function findProductById(productId) {
  const json = readJson(PRODUCTS_PATH, null);
  const list = Array.isArray(json?.products) ? json.products : [];
  return list.find(p => p?.id === productId) || null;
}

// Builds a synthetic session map for a demo agent so loadAgents can run its
// usual code path without needing real `~/.openclaw/agents/<id>/sessions/`
// files on disk. Returns an object keyed by a fake session id, with the
// session-status fields that summarizeSessions/tokenSummaryFromSession read.
function synthDemoSessions(demo) {
  if (!demo) return {};
  const updatedAt = Date.now() - (Number(demo.ageS) || 0) * 1000;
  const sessions = {
    [`agent:demo:telegram:direct:demo`]: {
      sessionId: 'demo-session',
      updatedAt,
      lastChannel: 'telegram',
      chatType: 'direct',
      status: demo.sessionStatus || 'done',
      abortedLastRun: !!demo.abortedLastRun,
      totalTokens: demo.totalTokens || 0,
      contextTokens: demo.contextWindow || 0,
      cacheRead: Math.round((demo.totalTokens || 0) * 0.62),
      cacheWrite: Math.round((demo.totalTokens || 0) * 0.04),
      inputTokens: Math.round((demo.totalTokens || 0) * 0.93),
      outputTokens: Math.round((demo.totalTokens || 0) * 0.07),
      model: demo.model || 'claude-cli/claude-sonnet-4-6',
    },
  };
  for (let i = 0; i < (demo.subagents || 0); i++) {
    sessions[`agent:demo:subagent:demo-${i}`] = {
      sessionId: `demo-subagent-${i}`,
      updatedAt: updatedAt - i * 30_000,
      status: 'running',
      lastChannel: 'subagent',
    };
  }
  return sessions;
}

// Builds synthetic usage windows for a demo agent so the burn-signal and
// cost-panel features are visible out-of-the-box. Mirrors the shape that
// lib/usage.js#fleetUsage returns in perAgent[id].
function synthDemoUsage(demo) {
  if (!demo) return null;
  const mkWindow = (billed, count) => ({ billed, count, byProvider: { 'claude-cli': billed } });
  return {
    session: mkWindow(demo.sessionCost || 0, 1),
    day:     mkWindow(demo.dayCost    || 0, Math.max(1, Math.round((demo.dayCost || 0) / Math.max(demo.sessionCost || 0.01, 0.001)))),
    month:   mkWindow((demo.dayCost || 0) * 20, 0),
    year:    mkWindow((demo.dayCost || 0) * 200, 0),
  };
}

// Compares the current session's cost to the 24h total to detect a "hot"
// burn rate. Returns 'critical' when the session consumed ≥75% of the day's
// budget, 'hot' when ≥40%, otherwise null. Visible as an orange/red glow
// on the agent's room — the only cost feature visible at a glance without
// opening the stats panel.
function deriveBurnSignal(usageData) {
  if (!usageData) return null;
  const sessionBilled = usageData.session?.billed || 0;
  const dayBilled     = usageData.day?.billed     || 0;
  if (!dayBilled || !sessionBilled) return null;
  const ratio = sessionBilled / dayBilled;
  if (ratio >= 0.75) return 'critical';
  if (ratio >= 0.40) return 'hot';
  return null;
}

// Picks the right speech bubble for an agent given its signals + session
// state. Severity ladder: alert (something is broken and needs a human) >
// warn (recent issue) > busy (currently working) > null (fall back to the
// in-character personality quip rendered client-side). Text is short — the
// bubble has a 32-char visible budget before clamping.
function deriveBubble(signals, signalDetail, statusKey, sessionStatus) {
  if (signals.aborted)              return { kind: 'alert', text: 'crashed — needs a restart' };
  if (signals.streak)               return { kind: 'alert', text: `failing ${signalDetail.streak || 0}× in a row` };
  if (signals.recentFail)           return { kind: 'warn',  text: `${signalDetail.recentFail || 0} task issue${signalDetail.recentFail === 1 ? '' : 's'} recently` };
  if (signals.ctxHot)               return { kind: 'warn',  text: `context ${signalDetail.ctxPct}% — compact soon` };
  if (statusKey === 'active' && sessionStatus === 'running') return { kind: 'busy', text: 'working…' };
  if (statusKey === 'idle'   && sessionStatus === 'running') return { kind: 'busy', text: 'thinking…' };
  return null;
}

function loadAgents(cfg) {
  const agents = [];
  const cronByAgent = cronJobsByAgent();
  const taskByAgent = tasksByAgent();
  const productsByAgent = loadProducts();
  for (const agent of cfg.agents?.list || []) {
    const id = agent.id;
    const workspace = agent.workspace || path.join(STATE_DIR, 'agents', id, 'workspace');
    const identityMd = readText(path.join(workspace, 'IDENTITY.md'));
    const displayName = extractField(identityMd, 'Name') || agent.identity?.name || id;
    const emoji = extractField(identityMd, 'Emoji') || agent.identity?.emoji || '🤖';
    const role = shortenVibe(extractField(identityMd, 'Role') || extractField(identityMd, 'Creature') || '');
    const vibe = shortenVibe(extractField(identityMd, 'Vibe') || '');

    const sessionsPath = path.join(STATE_DIR, 'agents', id, 'sessions', 'sessions.json');
    const sessions = agent.demo
      ? synthDemoSessions(agent.demo)
      : (readJson(sessionsPath, {}) || {});
    const sumS = summarizeSessions(sessions);
    const updatedAt = sumS.latest?.updatedAt || 0;
    const status = deriveStatus(updatedAt);

    const memDir = path.join(workspace, 'memory');
    const sumM = summarizeMemory(memDir);

    const modelPrimary = modelShortName(agent.model?.primary);
    const modelFallback = modelShortName((agent.model?.fallbacks || [])[0]);

    const tok = tokenSummaryFromSession(sumS.latestMeta);
    // Prefer the model the latest session is actually using; fall back to
    // the agent's configured primary so the statsboard MODEL row is never blank.
    const modelDisplay = tok.sessionModel || modelPrimary;

    // Per-agent signal flags. Each one renders as its own icon in the room
    // header — keeping them split lets us watch real data and decide later
    // which ones actually deserve a red alarm vs a yellow heads-up.
    const tasksAgg = taskByAgent[id] || {
      tracked: 0, active: 0, issues: 0, succeeded: 0,
      recentIssues: 0, consecutiveFailures: 0,
    };
    if (agent.demo?.consecutiveFailures) tasksAgg.consecutiveFailures = agent.demo.consecutiveFailures;
    if (agent.demo?.recentIssues)        tasksAgg.recentIssues        = agent.demo.recentIssues;
    const fallbackList = (agent.model?.fallbacks || []).map(modelShortName).filter(Boolean);
    const signals = {
      aborted:    !!sumS.latestMeta?.abortedLastRun,
      streak:     (tasksAgg.consecutiveFailures || 0) > 0,
      recentFail: (tasksAgg.recentIssues || 0) > 0,
      ctxHot:     (tok.contextPct || 0) >= 95,
      fallback:   !!modelDisplay && !!modelPrimary && modelDisplay !== modelPrimary && fallbackList.includes(modelDisplay),
    };
    const signalDetail = {
      streak: tasksAgg.consecutiveFailures || 0,
      recentFail: tasksAgg.recentIssues || 0,
      ctxPct: tok.contextPct || 0,
      modelPrimary, modelDisplay,
    };
    const sessionStatus = sumS.latestMeta?.status || null;
    const bubble = deriveBubble(signals, signalDetail, status.key, sessionStatus);

    agents.push({
      id,
      displayName,
      emoji,
      role: role || 'specialist',
      vibe: vibe || '',
      status: status.key,
      statusLabel: status.label,
      updatedAt,
      lastSeen: updatedAt ? formatRelative(Date.now() - updatedAt) : 'never',
      sessionCount: Object.keys(sessions).length,
      directCount: sumS.directCount,
      groupCount: sumS.groupCount,
      cronCount: sumS.cronCount,
      cronJobs: cronByAgent[id]?.count || 0,
      cronSchedule: cronByAgent[id]?.jobs || [],
      products: productsByAgent[id] || [],
      tasks: tasksAgg,
      signals,
      signalDetail,
      sessionStatus,
      bubble,
      _demo: agent.demo || null,
      subagentCount: sumS.subagentCount,
      sessionKey: sumS.latest?.sessionKey || null,
      sessionId: sumS.latest?.sessionId || null,
      chatType: sumS.latest?.chatType || null,
      channel: sumS.latest?.lastChannel || null,
      currentTask: deriveHint(sumS.latest?.sessionKey || null, sumS.latest?.lastChannel || null, sumS.latest?.chatType || null),
      modelPrimary,
      modelFallback,
      modelDisplay,
      totalTokens: tok.totalTokens,
      contextTokens: tok.totalTokens,
      contextWindow: tok.contextWindow,
      contextPct: tok.contextPct,
      cachePct: tok.cachePct,
      inputTokens: tok.inputTokens,
      outputTokens: tok.outputTokens,
      cacheRead: tok.cacheRead,
      cacheWrite: tok.cacheWrite,
      memoryNotes: sumM.totalNotes,
      memoryLogs: sumM.datedLogs,
      latestLog: sumM.latestLog,
      latestLogAt: sumM.latestLogAt,
      openclawUrl: OPENCLAW_URL,
    });
  }
  return agents;
}

function fleetStats(agents) {
  const stats = { total: agents.length, active: 0, idle: 0, away: 0, totalSessions: 0, totalNotes: 0 };
  for (const a of agents) {
    stats[a.status] = (stats[a.status] || 0) + 1;
    stats.totalSessions += a.sessionCount;
    stats.totalNotes += a.memoryNotes || 0;
  }
  return stats;
}

function agentIndexById(cfg, agentId) {
  const list = cfg?.agents?.list || [];
  return list.findIndex(a => a?.id === agentId);
}

function readBody(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function setAgentModel(agentIdx, modelId) {
  return new Promise((resolve, reject) => {
    execFile(
      'openclaw',
      ['config', 'set', `agents.list.${agentIdx}.model.primary`, modelId],
      { timeout: 15_000 },
      (err, stdout, stderr) => {
        if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
        resolve({ stdout, stderr });
      }
    );
  });
}

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

// Tiny single-pass markdown renderer. Covers what Harvey's strategy docs and
// most agent-authored markdown actually use: headings, paragraphs, bullet/
// numbered lists, GitHub-style tables, fenced code, inline code, bold/italic,
// links, and horizontal rules. Not CommonMark — just enough to look right on a
// phone without pulling in a dependency.
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function renderInline(s) {
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return s;
}
function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(escapeHtml(lines[i])); i++; }
      i++;
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      out.push(`<h${m[1].length}>${renderInline(m[2])}</h${m[1].length}>`);
      i++; continue;
    }
    if (/^---+$/.test(line)) { out.push('<hr/>'); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i+1])) {
      const split = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = split(line); i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(split(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map(h => `<th>${renderInline(h)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${renderInline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^\s*[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
      out.push('<ul>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ul>');
      continue;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push('<ol>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ol>');
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^[#>\-*+\d`|]/.test(lines[i].trim()[0] || '')) {
      buf.push(lines[i]); i++;
    }
    if (buf.length) out.push(`<p>${renderInline(buf.join(' '))}</p>`);
    else { out.push(`<p>${renderInline(line)}</p>`); i++; }
  }
  return out.join('\n');
}
const DOCS_CSS = `
  body{margin:0;font:14px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#ecf2ff;background:#151525;padding:18px;max-width:900px;margin:0 auto;}
  a{color:#7df9d0;}
  h1,h2,h3,h4{color:#cdb7ff;border-bottom:2px solid #2e3560;padding-bottom:4px;margin-top:1.6em;}
  h1{font-size:22px;} h2{font-size:18px;} h3{font-size:15px;}
  code{background:#2e3560;padding:1px 5px;border-radius:3px;font-size:0.92em;}
  pre{background:#0d1020;padding:12px;overflow-x:auto;border-left:3px solid #5ea2ff;}
  pre code{background:transparent;padding:0;}
  table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px;}
  th,td{border:1px solid #2e3560;padding:6px 9px;text-align:left;vertical-align:top;}
  th{background:#1f234a;color:#cdb7ff;}
  hr{border:0;border-top:2px dashed #2e3560;margin:18px 0;}
  ul,ol{padding-left:22px;}
  .crumbs{font-size:12px;color:#a8b0cc;margin-bottom:14px;}
  .crumbs a{color:#7df9d0;text-decoration:none;}
  .crumbs a:hover{text-decoration:underline;}
  .listing li{margin:4px 0;}
  .listing a.dir::after{content:"/";color:#a8b0cc;}
`;
function docsCrumbs(productId, subPath) {
  const parts = subPath ? subPath.split('/').filter(Boolean) : [];
  const links = [`<a href="/docs/${productId}/">${productId}</a>`];
  let acc = '';
  for (const p of parts) {
    acc += '/' + p;
    links.push(`<a href="/docs/${productId}${acc}">${escapeHtml(p)}</a>`);
  }
  return `<div class="crumbs">${links.join(' / ')}</div>`;
}
function docsPage(productId, subPath, title, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title><style>${DOCS_CSS}</style></head><body>${docsCrumbs(productId, subPath)}${bodyHtml}</body></html>`;
}
const DOCS_MIME = {
  '.md': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
};
function serveDocs(product, subPath, res) {
  const root = path.resolve(product.repoPath);
  const target = path.normalize(path.join(root, subPath));
  if (!target.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  let stat;
  try { stat = fs.statSync(target); } catch { res.writeHead(404); res.end('not found'); return; }
  if (stat.isDirectory()) {
    const entries = safeReaddir(target).sort();
    const items = entries.map(name => {
      const full = path.join(target, name);
      let isDir = false;
      try { isDir = fs.statSync(full).isDirectory(); } catch {}
      const href = `/docs/${product.id}/${path.posix.join(subPath, name)}`;
      return `<li><a class="${isDir ? 'dir' : 'file'}" href="${href}">${escapeHtml(name)}</a></li>`;
    }).join('');
    const indexFile = entries.find(n => /^(index|readme|.*_index)\.md$/i.test(n));
    let preview = '';
    if (indexFile) {
      try {
        const md = fs.readFileSync(path.join(target, indexFile), 'utf8');
        preview = `<hr/><h2>${escapeHtml(indexFile)}</h2>` + renderMarkdown(md);
      } catch {}
    }
    const body = `<h1>${escapeHtml(product.name || product.id)}</h1><ul class="listing">${items}</ul>${preview}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(docsPage(product.id, subPath, product.name || product.id, body));
  }
  const ext = path.extname(target).toLowerCase();
  if (ext === '.md') {
    const md = fs.readFileSync(target, 'utf8');
    const body = renderMarkdown(md);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(docsPage(product.id, subPath, path.basename(target), body));
  }
  const type = DOCS_MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(target));
}

// Pixel sheets get regenerated when an agent is added. Long-cache them and a
// browser holds a stale layout (e.g. row 9 lands past the bottom of the
// cached image -> blank sprite). Short-cache + revalidate keeps them fresh
// without burning bandwidth on every request.
const REGENERABLE_PNGS = new Set(['/sprites.png', '/monitors.png', '/furniture.png', '/props.png']);

// Cache-bust version derived from PNG mtimes. The HTML is no-store so we can
// recompute on every page load; the version flips whenever any sheet rebuilds,
// guaranteeing a fresh fetch even if a user's disk cache held the old layout.
function pixelSheetVersion() {
  let v = 0;
  for (const p of REGENERABLE_PNGS) {
    try { v = Math.max(v, Math.floor(fs.statSync(path.join(PUBLIC_DIR, p)).mtimeMs)); } catch {}
  }
  return v || Date.now();
}

function injectAssetVersion(html, v) {
  const tagged = `?v=${v}`;
  return html.replace(/url\('(sprites|monitors|furniture|props)\.png'\)/g, (_m, name) => `url('${name}.png${tagged}')`);
}

function serveStatic(req, res) {
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath);
    const TEXT = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.svg':'image/svg+xml',
                   '.json':'application/json', '.webmanifest':'application/manifest+json' };
    const BIN = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.ico':'image/x-icon' };
    if (BIN[ext]) {
      const cacheCtl = REGENERABLE_PNGS.has(requested)
        ? 'no-cache, must-revalidate'
        : 'public, max-age=86400';
      res.writeHead(200, { 'Content-Type': BIN[ext], 'Cache-Control': cacheCtl });
      res.end(data);
    } else {
      const type = TEXT[ext] || 'text/plain';
      let body = data;
      if (requested === '/index.html') {
        body = Buffer.from(injectAssetVersion(data.toString('utf8'), pixelSheetVersion()), 'utf8');
      }
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(body);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/pixel-office/state') {
    const cfg = loadFleetConfig();
    const agents = loadAgents(cfg);
    // Kick off a non-blocking refresh of the trajectory cache. First poll after
    // server start returns zeros while the initial scan finishes; subsequent
    // polls reuse the in-memory cache (mtime-keyed) and only re-parse files
    // that grew since the last scan. Errors are swallowed so a single broken
    // trajectory file can't take the API down.
    const agentIds = agents.map(a => a.id);
    usage.refresh(agentIds).catch(() => {});
    const priceCfg = usage.loadPrices(PRICES_PATH);
    const usageData = usage.fleetUsage(agentIds, priceCfg);
    for (const a of agents) {
      // In demo mode each agent has a `demo` block; inject synthetic usage so
      // the cost panel and burn-signal glow both render without real data.
      a.usage = DEMO_MODE && a._demo
        ? synthDemoUsage(a._demo)
        : (usageData.perAgent[a.id] || null);
      a.burnSignal = deriveBurnSignal(a.usage);
    }
    // Probe each product's port so the UI can downgrade "live" → "offline"
    // when the process isn't actually serving. Cached for 30s so the 5s state
    // poll doesn't open a new socket every tick.
    return respondJson(res, 200, {
      now: Date.now(),
      openclawUrl: OPENCLAW_URL,
      lanHosts: detectLanHosts(),
      availableModels: MODEL_OPTIONS,
      subscriptionProviders: Object.keys(priceCfg.subscriptions || {}),
      billingModes: priceCfg.billingModes || {},
      fleet: { ...fleetStats(agents), usage: usageData.fleet },
      agents,
    });
  }
  // POST /api/pixel-office/agent/:id/model  body: {"model":"<id>"}
  // Shells out to `openclaw config set agents.list.<idx>.model.primary <model>`.
  // Both id and model are checked against known values so they can never be a
  // crafted argv injection — execFile already avoids shell parsing, but the
  // allowlists keep the UI honest about what it can set.
  const modelMatch = url.pathname.match(/^\/api\/pixel-office\/agent\/([^/]+)\/model$/);
  if (modelMatch && req.method === 'POST') {
    try {
      const agentId = decodeURIComponent(modelMatch[1]);
      const raw = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return respondJson(res, 400, { error: 'invalid json' }); }
      const modelId = String(parsed?.model || '');
      if (!MODEL_OPTION_IDS.has(modelId)) return respondJson(res, 400, { error: 'unknown model', model: modelId });
      const cfg = loadFleetConfig();
      const idx = agentIndexById(cfg, agentId);
      if (idx < 0) return respondJson(res, 404, { error: 'unknown agent', agentId });
      await setAgentModel(idx, modelId);
      return respondJson(res, 200, { ok: true, agentId, model: modelId });
    } catch (err) {
      const stderr = (err && err.stderr) ? String(err.stderr).slice(0, 500) : '';
      return respondJson(res, 500, { error: err?.message || 'set failed', stderr });
    }
  }
  // POST /api/pixel-office/product/:id/start
  // Spawns the product's declared start command (from products.json) detached.
  // The id is the only client-supplied input; everything else (cwd/cmd/args)
  // is loaded from the static products.json so the body can't be used to run
  // arbitrary commands.
  const startMatch = url.pathname.match(/^\/api\/pixel-office\/product\/([^/]+)\/start$/);
  if (startMatch && req.method === 'POST') {
    const productId = decodeURIComponent(startMatch[1]);
    const product = findProductById(productId);
    if (!product) return respondJson(res, 404, { error: 'unknown product', productId });
    const result = launchProduct(product);
    if (!result.ok) return respondJson(res, 400, { error: result.error || 'launch failed' });
    return respondJson(res, 200, { ok: true, productId, pid: result.pid, logPath: result.logPath });
  }
  // GET /docs/<productId>/<...path>
  // Browses files under a documents-only product's repoPath. Markdown files
  // render to HTML; everything else is served raw with a guessed mime type.
  // The route only ever resolves under product.repoPath so requests can't
  // escape into the rest of the filesystem.
  const docsMatch = url.pathname.match(/^\/docs\/([^/]+)(?:\/(.*))?$/);
  if (docsMatch && req.method === 'GET') {
    const productId = decodeURIComponent(docsMatch[1]);
    const subPath = docsMatch[2] ? decodeURIComponent(docsMatch[2]) : '';
    const product = findProductById(productId);
    if (!product || !product.repoPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not a documents-only product');
    }
    return serveDocs(product, subPath, res);
  }
  if (url.pathname === '/healthz') return respondJson(res, 200, { ok: true });
  return serveStatic({ url: url.pathname }, res);
});

// Kick off the initial trajectory scan in the background as soon as we know
// which agents exist. The first /state poll might land before this finishes —
// it'll just return zero costs and self-correct on the next 5s tick.
function bootstrapUsageScan() {
  try {
    const cfg = loadFleetConfig();
    const agentIds = (cfg.agents?.list || []).map(a => a.id).filter(Boolean);
    const t0 = Date.now();
    usage.refresh(agentIds)
      .then(() => console.log(`Initial usage scan: ${agentIds.length} agents in ${Date.now() - t0}ms`))
      .catch(err => console.error('Initial usage scan failed:', err.message));
  } catch (err) {
    console.error('bootstrapUsageScan failed:', err.message);
  }
}

server.listen(PORT, HOST, () => {
  console.log(`Pixel office listening on http://${HOST}:${PORT}`);
  bootstrapUsageScan();
});
