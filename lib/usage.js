// Per-agent USD cost tracker. Walks each agent's session jsonl files,
// extracts per-call usage events, applies prices.json, and rolls up by
// window (current session / today / this month / this year), provider,
// and model.
//
// Three file formats are scanned per agent:
//
//   A. OpenClaw-managed runs under ~/.openclaw/agents/<id>/sessions/
//      — see formats 1 and 2 below.
//
//   B. Claude Code direct sessions under
//      ~/.claude/projects/-home-<user>--openclaw-agents-<id>-workspace/<uuid>.jsonl
//      — Anthropic-native field names. Each line `{type:"assistant", timestamp,
//      message:{model, usage:{input_tokens, output_tokens, cache_read_input_tokens,
//      cache_creation_input_tokens}}}`. These are Claude turns invoked via the
//      claude-cli runtime (or fast-mode subagents) within an agent's workspace
//      and DO NOT appear in OpenClaw's sessions/ directory. Skipping these
//      under-counts Claude usage by an order of magnitude — the very issue
//      that made early "fleet cost" numbers look mostly OpenAI.
//
// Two file formats coexist in `agents/<id>/sessions/`:
//   1. <uuid>.jsonl              — Claude Code "message" format. Each line
//                                   `{type:"message", timestamp, message:{provider,
//                                   model, usage:{input,output,cacheRead,cacheWrite,...}}}`.
//                                   This is the canonical billing record for both
//                                   Claude AND Codex sessions (one event per
//                                   API call, including tool-use round-trips).
//   2. <uuid>.trajectory.jsonl   — OpenAI Codex runtime metadata. Each line
//                                   `{type:"model.completed", ts, provider, modelId,
//                                   data:{usage:{...}}}`. One event per overall
//                                   completion (under-counts tool-use loops vs the
//                                   message format).
//
// Per session UUID we prefer the message jsonl when present, falling back to
// trajectory only when no message jsonl exists. This avoids double-counting
// and keeps Claude-only agents (which never write trajectory files) included.
//
// Caching strategy:
//   - parsed events kept in-memory keyed by (filePath, mtimeMs)
//   - on refresh(), we stat every candidate file; if mtime matches the cached
//     entry we reuse it, otherwise we reparse just that file
//   - prices.json is mtime-cached the same way
//
// First scan is the only slow one. Subsequent polls re-stat O(files) and
// reparse only the active session's growing log.

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const STATE_DIR = path.join(os.homedir(), '.openclaw');
const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
// Skip files older than a year — they can't contribute to any displayed window.
const STALE_FILE_MS = 366 * 24 * 60 * 60 * 1000;

// filePath -> { mtimeMs, events: Array<{ts, sessionId, modelKey, input, output, cacheRead, cacheWrite}> }
const fileCache = new Map();

let priceCache = { mtimeMs: 0, prices: {}, subscriptions: {}, billingModes: {} };
function loadPrices(pricesPath) {
  const billingModes = detectBillingModes();
  try {
    const stat = fs.statSync(pricesPath);
    if (stat.mtimeMs === priceCache.mtimeMs &&
        sameModes(billingModes, priceCache.billingModes)) {
      return priceCache;
    }
    const json = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
    // Only treat a provider as a subscription if (a) the user declared a
    // monthlyUSD AND (b) the detected auth mode is actually oauth/subscription.
    // Switching to an API key (env var or profile) auto-flips it back to
    // per-token billing without any prices.json edit.
    const declared = json.subscriptions || {};
    const effective = {};
    for (const [provider, cfg] of Object.entries(declared)) {
      if (billingModes[provider] === 'subscription') effective[provider] = cfg;
    }
    priceCache = {
      mtimeMs: stat.mtimeMs,
      prices: json.prices || {},
      subscriptions: effective,
      declaredSubscriptions: declared,
      billingModes,
    };
    return priceCache;
  } catch {
    return priceCache;
  }
}

function sameModes(a, b) {
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

// Detects which billing mode each provider is on:
//   'subscription' — OAuth login (Claude Max, ChatGPT Plus/Pro, etc.) → flat fee
//   'api'          — API key (env var or auth profile) → per-token
//
// Sources, in priority order:
//   1. Env vars ANTHROPIC_API_KEY / OPENAI_API_KEY → forces 'api'
//   2. ~/.claude/.credentials.json with claudeAiOauth.subscriptionType → 'subscription'
//   3. ~/.openclaw/openclaw.json auth.profiles[*].mode (oauth → subscription, api_key → api)
//
// If nothing matches, the provider is omitted from the map and the caller
// treats it as per-token (safe default — we'd rather over-report cost than
// hide it).
let billingCache = { key: '', modes: {} };
function detectBillingModes() {
  const claudeCredPath = path.join(os.homedir(), '.claude', '.credentials.json');
  const openclawCfgPath = path.join(STATE_DIR, 'openclaw.json');
  let claudeMtime = 0, openclawMtime = 0;
  try { claudeMtime = fs.statSync(claudeCredPath).mtimeMs; } catch {}
  try { openclawMtime = fs.statSync(openclawCfgPath).mtimeMs; } catch {}
  const envKey = `${process.env.ANTHROPIC_API_KEY ? 'A' : ''}|${process.env.OPENAI_API_KEY ? 'O' : ''}`;
  const cacheKey = `${claudeMtime}|${openclawMtime}|${envKey}`;
  if (cacheKey === billingCache.key) return billingCache.modes;

  const modes = {};

  if (process.env.ANTHROPIC_API_KEY) {
    modes['claude-cli'] = 'api';
  } else {
    try {
      const cred = JSON.parse(fs.readFileSync(claudeCredPath, 'utf8'));
      if (cred?.claudeAiOauth?.subscriptionType) modes['claude-cli'] = 'subscription';
    } catch {}
  }

  if (process.env.OPENAI_API_KEY) {
    modes['openai-codex'] = 'api';
    modes['openai'] = 'api';
  }

  try {
    const cfg = JSON.parse(fs.readFileSync(openclawCfgPath, 'utf8'));
    for (const profile of Object.values(cfg.auth?.profiles || {})) {
      const provider = profile?.provider;
      if (!provider || modes[provider]) continue;  // env/credential signal wins
      if (profile.mode === 'oauth')   modes[provider] = 'subscription';
      else if (profile.mode === 'api_key') modes[provider] = 'api';
    }
  } catch {}

  billingCache = { key: cacheKey, modes };
  return modes;
}

// Window length in days (must match the rolling windows below).
const WINDOW_DAYS = { session: 1, day: 1, month: 30, year: 365 };

// Sum subscription flat fees for a given window, prorated as monthlyUSD × (windowDays / 30).
function subscriptionFeeForWindow(subscriptions, windowKey) {
  const days = WINDOW_DAYS[windowKey] || 0;
  if (!days) return 0;
  let total = 0;
  for (const cfg of Object.values(subscriptions || {})) {
    const m = Number(cfg && cfg.monthlyUSD) || 0;
    total += m * (days / 30);
  }
  return total;
}

// Sum subscription flat fees per provider (for the per-provider chip).
function subscriptionFeesByProvider(subscriptions, windowKey) {
  const days = WINDOW_DAYS[windowKey] || 0;
  const out = {};
  if (!days) return out;
  for (const [provider, cfg] of Object.entries(subscriptions || {})) {
    const m = Number(cfg && cfg.monthlyUSD) || 0;
    if (m > 0) out[provider] = m * (days / 30);
  }
  return out;
}

function priceTurn(prices, modelKey, ev) {
  const p = prices[modelKey];
  if (!p) return { cost: 0, unpriced: true };
  const cost =
    ((ev.input      || 0) * (p.input      || 0) +
     (ev.output     || 0) * (p.output     || 0) +
     (ev.cacheRead  || 0) * (p.cacheRead  || 0) +
     (ev.cacheWrite || 0) * (p.cacheWrite || 0)) / 1_000_000;
  return { cost, unpriced: false };
}

// Claude Code "message" jsonl: {type:"message", timestamp, message:{provider, model, usage:{...}}}.
// Used by Claude sessions AND by Codex sessions (with provider="openai-codex").
// sessionId is taken from the filename (the leading UUID).
async function parseMessageFile(filePath, sessionId) {
  return new Promise((resolve) => {
    const events = [];
    let stream;
    try { stream = fs.createReadStream(filePath, { encoding: 'utf8' }); }
    catch { return resolve(events); }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line) return;
      let e;
      try { e = JSON.parse(line); } catch { return; }
      if (e.type !== 'message') return;
      const m = e.message;
      if (!m || !m.usage) return;
      const u = m.usage;
      const provider = m.provider || '';
      const modelId  = m.model    || '';
      const ts = Date.parse(e.timestamp || m.timestamp || '');
      if (!Number.isFinite(ts)) return;
      events.push({
        ts,
        sessionId,
        modelKey: `${provider}/${modelId}`,
        input:      u.input      || 0,
        output:     u.output     || 0,
        cacheRead:  u.cacheRead  || 0,
        cacheWrite: u.cacheWrite || 0,
      });
    });
    rl.on('close', () => resolve(events));
    rl.on('error', () => resolve(events));
  });
}

// Claude Code transcript: {type:"assistant", timestamp, message:{model, usage:{...native...}}}.
// Lives under ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl. Field names follow
// Anthropic's API (input_tokens / cache_read_input_tokens / cache_creation_input_tokens)
// rather than OpenClaw's normalized form, so we map them on parse. Synthetic
// model entries (e.g. "<synthetic>" used for harness-generated turns) are skipped
// since they aren't real billed turns.
async function parseClaudeTranscript(filePath, sessionId) {
  return new Promise((resolve) => {
    const events = [];
    let stream;
    try { stream = fs.createReadStream(filePath, { encoding: 'utf8' }); }
    catch { return resolve(events); }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line) return;
      let e;
      try { e = JSON.parse(line); } catch { return; }
      if (e.type !== 'assistant') return;
      const m = e.message;
      if (!m || !m.usage) return;
      const u = m.usage;
      const modelId = m.model || '';
      if (!modelId || modelId === '<synthetic>') return;
      const ts = Date.parse(e.timestamp || '');
      if (!Number.isFinite(ts)) return;
      events.push({
        ts,
        sessionId,
        modelKey: `claude-cli/${modelId}`,
        input:      u.input_tokens                || 0,
        output:     u.output_tokens               || 0,
        cacheRead:  u.cache_read_input_tokens     || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
      });
    });
    rl.on('close', () => resolve(events));
    rl.on('error', () => resolve(events));
  });
}

// OpenClaw runtime trajectory: {type:"model.completed", ts, provider, modelId, data:{usage:{...}}}.
// Fallback for sessions where the message jsonl is absent (older Codex runs).
async function parseTrajectoryFile(filePath, sessionId) {
  return new Promise((resolve) => {
    const events = [];
    let stream;
    try { stream = fs.createReadStream(filePath, { encoding: 'utf8' }); }
    catch { return resolve(events); }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line) return;
      let e;
      try { e = JSON.parse(line); } catch { return; }
      if (e.type !== 'model.completed') return;
      const u = e.data && e.data.usage;
      if (!u) return;
      const provider = e.provider || '';
      const modelId  = e.modelId  || '';
      const ts = Date.parse(e.ts);
      if (!Number.isFinite(ts)) return;
      events.push({
        ts,
        sessionId: e.sessionId || sessionId,
        modelKey: `${provider}/${modelId}`,
        input:      u.input      || 0,
        output:     u.output     || 0,
        cacheRead:  u.cacheRead  || 0,
        cacheWrite: u.cacheWrite || 0,
      });
    });
    rl.on('close', () => resolve(events));
    rl.on('error', () => resolve(events));
  });
}

// Group session files by UUID; for each UUID prefer the message jsonl,
// fall back to trajectory if message is missing. Skip *.reset, *.deleted,
// *.checkpoint and similar derived files — only the canonical "<uuid>.jsonl"
// (no further suffix) and "<uuid>.trajectory.jsonl" are billing-relevant.
function groupSessionFiles(dir) {
  let files;
  try { files = fs.readdirSync(dir); } catch { return []; }
  const groups = new Map(); // sessionId -> {message?, trajectory?}
  for (const f of files) {
    const m = f.match(UUID_RE);
    if (!m) continue;
    const sessionId = m[1];
    const rest = f.slice(sessionId.length);
    let kind = null;
    if (rest === '.jsonl') kind = 'message';
    else if (rest === '.trajectory.jsonl') kind = 'trajectory';
    if (!kind) continue;
    if (!groups.has(sessionId)) groups.set(sessionId, {});
    groups.get(sessionId)[kind] = path.join(dir, f);
  }
  const out = [];
  for (const [sessionId, paths] of groups) {
    if (paths.message)         out.push({ sessionId, kind: 'message',    filePath: paths.message });
    else if (paths.trajectory) out.push({ sessionId, kind: 'trajectory', filePath: paths.trajectory });
  }
  return out;
}

// Map an agent ID to its Claude Code project transcript directory. Claude Code
// encodes the cwd as a directory name by replacing "/" and "." with "-". The
// agent's cwd is its workspace path, so we apply the same mangling.
function claudeProjectDir(agentId) {
  const ws = path.join(STATE_DIR, 'agents', agentId, 'workspace');
  const encoded = ws.replace(/[\/.]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

async function refreshAgent(agentId) {
  const cutoff = Date.now() - STALE_FILE_MS;
  const all = [];

  // Source A: OpenClaw-managed sessions (message + trajectory formats)
  const dir = path.join(STATE_DIR, 'agents', agentId, 'sessions');
  const sessions = groupSessionFiles(dir);
  for (const { sessionId, kind, filePath } of sessions) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    if (stat.mtimeMs < cutoff) continue;
    const cacheKey = `${kind}:${filePath}`;
    const cached = fileCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      all.push(...cached.events);
      continue;
    }
    const events = kind === 'message'
      ? await parseMessageFile(filePath, sessionId)
      : await parseTrajectoryFile(filePath, sessionId);
    fileCache.set(cacheKey, { mtimeMs: stat.mtimeMs, events });
    all.push(...events);
  }

  // Source B: Claude Code direct sessions (e.g. /fast on main, claude-cli runs)
  const claudeDir = claudeProjectDir(agentId);
  let claudeFiles;
  try { claudeFiles = fs.readdirSync(claudeDir); } catch { claudeFiles = []; }
  for (const f of claudeFiles) {
    const m = f.match(UUID_RE);
    if (!m) continue;
    if (f.slice(m[1].length) !== '.jsonl') continue;  // skip .bloated, .reset, etc.
    const filePath = path.join(claudeDir, f);
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    if (stat.mtimeMs < cutoff) continue;
    const cacheKey = `claude-transcript:${filePath}`;
    const cached = fileCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      all.push(...cached.events);
      continue;
    }
    const events = await parseClaudeTranscript(filePath, m[1]);
    fileCache.set(cacheKey, { mtimeMs: stat.mtimeMs, events });
    all.push(...events);
  }

  return all;
}

const lastEvents = new Map(); // agentId -> events[]
async function refresh(agentIds) {
  for (const id of agentIds) {
    lastEvents.set(id, await refreshAgent(id));
  }
}

function rollup(events, prices, subscriptions, windowKey) {
  // Per-provider per-token cost (estimate). For subscription providers this is
  // an "if-billed-via-API" estimate, NOT what the user pays. Flat-fee accounting
  // is added on top below.
  let perTokenTotal = 0;
  let unpriced = 0;
  const byProvider = {};
  const byModel = {};
  for (const e of events) {
    const provider = (e.modelKey.split('/')[0] || 'unknown');
    const r = priceTurn(prices, e.modelKey, e);
    if (r.unpriced) unpriced++;
    perTokenTotal += r.cost;
    byProvider[provider] = (byProvider[provider] || 0) + r.cost;
    byModel[e.modelKey] = (byModel[e.modelKey] || 0) + r.cost;
  }

  // Subscription flat fees prorated to this window. The user pays these whether
  // or not they use the model, so they're added to billed.
  const subSet = new Set(Object.keys(subscriptions || {}));
  const subFees = subscriptionFeesByProvider(subscriptions, windowKey);
  const subTotal = subscriptionFeeForWindow(subscriptions, windowKey);

  // Pertoken cost from non-subscription providers = actual per-token spend.
  let perTokenBilled = 0;
  for (const [p, v] of Object.entries(byProvider)) {
    if (!subSet.has(p)) perTokenBilled += v;
  }

  // Replace the per-token Claude estimate in byProvider with the flat-fee share
  // so the per-provider chips reflect what the user actually pays.
  const provOutEstimate = {}; // unmodified per-token estimate (for "if API")
  const provOut = {};         // billed view (per-token for billed providers, flat-fee for subscriptions)
  for (const [k, v] of Object.entries(byProvider)) {
    provOutEstimate[k] = v;
    provOut[k] = subSet.has(k) ? (subFees[k] || 0) : v;
  }
  for (const [p, v] of Object.entries(subFees)) {
    if (!(p in provOut)) provOut[p] = v;            // subscription provider with no usage in window still owes the fee
    if (!(p in provOutEstimate)) provOutEstimate[p] = 0;
  }

  const round = (v) => Math.round(v * 100) / 100;
  const roundMap = (m) => { const o = {}; for (const [k, v] of Object.entries(m)) o[k] = round(v); return o; };

  const billed = perTokenBilled + subTotal;
  const estimate = perTokenTotal + subTotal;  // "what would this cost on the API" + sub fees

  return {
    billed:        round(billed),
    estimate:      round(estimate),
    perTokenTotal: round(perTokenTotal),    // per-token cost across all providers (info)
    subscription:  round(subTotal),         // sum of flat-fee subscription charges in window
    byProvider:    roundMap(provOut),
    byProviderEstimate: roundMap(provOutEstimate),
    byModel:       roundMap(byModel),
    unpriced,
    count: events.length,
  };
}

// Rolling windows (relative to "now") rather than calendar-aligned. Calendar
// windows produce confusing equalities — on the 1st of a month, "Month" would
// equal "Day" exactly. Rolling 24h / 30d / 365d always nest meaningfully.
function startOfDay()   { return Date.now() - 24  * 60 * 60 * 1000; }
function startOfMonth() { return Date.now() - 30  * 24 * 60 * 60 * 1000; }
function startOfYear()  { return Date.now() - 365 * 24 * 60 * 60 * 1000; }

function latestSessionId(events) {
  let latest = null;
  for (const e of events) {
    if (!e.sessionId) continue;
    if (!latest || e.ts > latest.ts) latest = e;
  }
  return latest ? latest.sessionId : null;
}

function usageForAgent(agentId, priceCfg) {
  const events = lastEvents.get(agentId) || [];
  const prices = priceCfg.prices || {};
  // Per-agent: keep the SET of subscription providers (so Claude per-token is
  // excluded from billed) but zero out monthlyUSD (the flat fee only applies
  // once at the fleet level — adding it per-agent would multiply by N).
  const perAgentSubs = {};
  for (const p of Object.keys(priceCfg.subscriptions || {})) perAgentSubs[p] = { monthlyUSD: 0 };
  const dayT   = startOfDay();
  const monthT = startOfMonth();
  const yearT  = startOfYear();
  // "Session" = today's portion of the most recent session. Without the
  // ts >= dayT clamp, a long-running session ID (Claude sessions can run for
  // days; main's 706f15b9 has been live since 2026-04-27) would make Session
  // larger than Today, breaking the obvious nesting Session ⊆ Day ⊆ Month ⊆ Year.
  const sid = latestSessionId(events);
  return {
    session: rollup(events.filter(e => e.sessionId === sid && e.ts >= dayT), prices, perAgentSubs, 'session'),
    day:     rollup(events.filter(e => e.ts >= dayT),                        prices, perAgentSubs, 'day'),
    month:   rollup(events.filter(e => e.ts >= monthT),                      prices, perAgentSubs, 'month'),
    year:    rollup(events.filter(e => e.ts >= yearT),                       prices, perAgentSubs, 'year'),
  };
}

function fleetUsage(agentIds, priceCfg) {
  const result = {};
  const empty = () => ({
    billed: 0, estimate: 0, perTokenTotal: 0, subscription: 0,
    byProvider: {}, byProviderEstimate: {}, byModel: {},
    unpriced: 0, count: 0,
  });
  const fleet = { session: empty(), day: empty(), month: empty(), year: empty() };
  for (const id of agentIds) {
    const u = usageForAgent(id, priceCfg);
    result[id] = u;
    for (const w of ['session','day','month','year']) {
      fleet[w].billed        += u[w].billed;
      fleet[w].estimate      += u[w].estimate;
      fleet[w].perTokenTotal += u[w].perTokenTotal;
      fleet[w].unpriced      += u[w].unpriced;
      fleet[w].count         += u[w].count;
      for (const [p, v] of Object.entries(u[w].byProvider)) {
        fleet[w].byProvider[p] = (fleet[w].byProvider[p] || 0) + v;
      }
      for (const [p, v] of Object.entries(u[w].byProviderEstimate || {})) {
        fleet[w].byProviderEstimate[p] = (fleet[w].byProviderEstimate[p] || 0) + v;
      }
      for (const [m, v] of Object.entries(u[w].byModel || {})) {
        fleet[w].byModel[m] = (fleet[w].byModel[m] || 0) + v;
      }
    }
  }
  // Apply subscription fees once at the fleet level.
  const subs = priceCfg.subscriptions || {};
  const subSet = new Set(Object.keys(subs));
  for (const w of ['session','day','month','year']) {
    const subTotal = subscriptionFeeForWindow(subs, w);
    const subFees = subscriptionFeesByProvider(subs, w);
    fleet[w].subscription = subTotal;
    fleet[w].billed       += subTotal;
    fleet[w].estimate     += subTotal;
    // Replace per-token estimate of subscription providers with their flat fees in byProvider.
    for (const [p, fee] of Object.entries(subFees)) {
      fleet[w].byProvider[p] = fee;  // flat fee replaces the per-token tally
      if (!(p in fleet[w].byProviderEstimate)) fleet[w].byProviderEstimate[p] = 0;
    }
    // Subscription providers that had per-token tallies (estimate) need their
    // billed-side entry overridden — already done above. For non-subscription
    // providers, leave as-is.
    for (const p of Object.keys(fleet[w].byProvider)) {
      if (subSet.has(p)) continue;
      // already correct (per-token billed total)
    }
  }

  // Round fleet totals.
  const round = (v) => Math.round(v * 100) / 100;
  for (const w of ['session','day','month','year']) {
    fleet[w].billed        = round(fleet[w].billed);
    fleet[w].estimate      = round(fleet[w].estimate);
    fleet[w].perTokenTotal = round(fleet[w].perTokenTotal);
    fleet[w].subscription  = round(fleet[w].subscription);
    for (const k of Object.keys(fleet[w].byProvider)) {
      fleet[w].byProvider[k] = round(fleet[w].byProvider[k]);
    }
    for (const k of Object.keys(fleet[w].byProviderEstimate)) {
      fleet[w].byProviderEstimate[k] = round(fleet[w].byProviderEstimate[k]);
    }
    for (const k of Object.keys(fleet[w].byModel)) {
      fleet[w].byModel[k] = round(fleet[w].byModel[k]);
    }
  }
  return { perAgent: result, fleet };
}

module.exports = { loadPrices, refresh, fleetUsage };
