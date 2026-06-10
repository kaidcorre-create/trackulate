/**
 * Trackulate AI Worker — Pro Licence Edition
 * Cloudflare Worker · Workers AI + KV + D1 Licence System
 * trackulate.co.uk · v3.0 · 2026
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Trackulate-Token",
};

const MODEL    = "@cf/meta/llama-3.1-8b-instruct";
const MAX_TOK  = 4096;
const RATE_MAX = 50;
const RATE_WIN = 86400;

// Features that require a Pro licence
const PRO_FEATURES = new Set([
  "chat", "categorise", "parse_transaction",
  "forecast", "monthly_review", "debt_strategy"
]);

// ── D1 SCHEMA (run once via `wrangler d1 execute trackulate_db`) ──
// CREATE TABLE IF NOT EXISTS usage_log (
//   id          INTEGER PRIMARY KEY AUTOINCREMENT,
//   licence_key TEXT NOT NULL,
//   feature     TEXT NOT NULL,
//   sheet_id    TEXT,
//   timestamp   TEXT NOT NULL
// );

export default {

  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON body" }, 400); }

    const url  = new URL(request.url);
    const path = url.pathname;

    // ── LICENCE ENDPOINTS (no token auth required) ──────────────
    if (path === "/validate") {
      return handleValidate(body, env);
    }
    if (path === "/activate") {
      return handleActivate(body, env);
    }
    if (path === "/admin/create-licence") {
      return handleCreateLicence(body, env, request);
    }

    // ── MAIN AI ENDPOINT ─────────────────────────────────────────
    // Optional shared token guard (legacy — kept for backwards compat)
    if (env.TRACKULATE_TOKEN) {
      const token = request.headers.get("X-Trackulate-Token");
      if (token !== env.TRACKULATE_TOKEN) {
        return json({ error: "Unauthorised" }, 401);
      }
    }

    return handleAI(body, env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event.cron, env));
  }
};

// ════════════════════════════════════════════════════════════
// LICENCE HANDLERS
// ════════════════════════════════════════════════════════════

async function handleValidate(body, env) {
  const { licence_key } = body;
  if (!licence_key) {
    return json({ tier: "standard", status: "no_key", isPro: false }, 200);
  }
  const entry = await getLicence(env, licence_key);
  if (!entry) {
    return json({ tier: "standard", status: "invalid", isPro: false }, 200);
  }
  if (entry.status === "suspended") {
    return json({ tier: entry.tier, status: "suspended", isPro: false, email: entry.email }, 200);
  }
  return json({
    tier:   entry.tier,
    status: entry.status,
    isPro:  entry.tier === "pro" && entry.status === "active",
    email:  entry.email,
  }, 200);
}

async function handleActivate(body, env) {
  const { licence_key, email, sheet_id } = body;
  if (!licence_key || !email) {
    return json({ error: "licence_key and email are required" }, 400);
  }

  const entry = await getLicence(env, licence_key);
  if (!entry) {
    return json({ error: "licence_required", message: "Licence key not found. Check your purchase email or buy at trackulate.co.uk/pro." }, 403);
  }
  if (entry.status === "suspended") {
    return json({ error: "suspended", message: "This licence has been suspended. Contact support@trackulate.co.uk." }, 403);
  }

  // Log sheet_id — warn but do NOT block if different sheet activates
  const activatedSheetId = entry.activated_sheet_id;
  let warning = null;
  if (activatedSheetId && sheet_id && activatedSheetId !== sheet_id) {
    warning = "This key was previously activated on a different sheet. Both will work — contact support if you need help.";
  }

  // Save activation info (only update sheet_id if not already set)
  const updated = Object.assign({}, entry, {
    activated_at:       entry.activated_at || new Date().toISOString(),
    activated_sheet_id: activatedSheetId || sheet_id || null,
  });
  await env.TRACKULATE_LICENCES.put(licence_key, JSON.stringify(updated));

  const response = {
    success: true,
    tier:    entry.tier,
    email:   entry.email,
    message: "Licence activated! Pro features are now unlocked.",
  };
  if (warning) response.warning = warning;
  return json(response, 200);
}

async function handleCreateLicence(body, env, request) {
  // Admin secret check
  const authHeader = request.headers.get("Authorization") || "";
  const secret     = authHeader.replace("Bearer ", "").trim();
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  const { email, tier } = body;
  if (!email || !tier) return json({ error: "email and tier required" }, 400);
  if (!["standard", "pro"].includes(tier)) return json({ error: "tier must be standard or pro" }, 400);

  const licence_key = generateLicenceKey();
  const entry = {
    tier,
    email,
    status:       "active",
    created_at:   new Date().toISOString(),
    activated_at: null,
    activated_sheet_id: null,
  };
  await env.TRACKULATE_LICENCES.put(licence_key, JSON.stringify(entry));

  return json({ success: true, licence_key, tier, email }, 200);
}

// ════════════════════════════════════════════════════════════
// MAIN AI HANDLER
// ════════════════════════════════════════════════════════════
async function handleAI(body, env) {
  const { prompt, feature, userId, financialData, licence_key, sheet_id } = body;
  if (!prompt) return json({ error: "No prompt provided" }, 400);

  // Licence check for Pro features
  if (PRO_FEATURES.has(feature)) {
    if (!licence_key) {
      return json({ error: "licence_required", message: "This feature requires a Pro licence. Upgrade at trackulate.co.uk/pro." }, 403);
    }
    const entry = await getLicence(env, licence_key);
    if (!entry || entry.status !== "active") {
      return json({ error: "licence_required", message: "Invalid or suspended licence. Contact support@trackulate.co.uk." }, 403);
    }
    if (entry.tier !== "pro") {
      return json({ error: "upgrade_required", message: "This feature requires a Pro licence. Upgrade at trackulate.co.uk/pro." }, 402);
    }

    // Log usage to D1
    if (env.DB) {
      try {
        await env.DB.prepare(
          "INSERT INTO usage_log (licence_key, feature, sheet_id, timestamp) VALUES (?, ?, ?, ?)"
        ).bind(licence_key, feature || "unknown", sheet_id || null, new Date().toISOString()).run();
      } catch (_) { /* non-fatal */ }
    }
  }

  // Rate limiting via KV
  if (env.TRACKULATE_KV && userId) {
    const allowed = await checkRateLimit(env.TRACKULATE_KV, userId);
    if (!allowed) {
      return json({ error: "Rate limit reached. Please try again tomorrow." }, 429);
    }
  }

  const enrichedPrompt = await buildEnrichedPrompt(env, feature, prompt, userId, financialData);
  const systemPrompt   = body.system || buildSystemPrompt(feature);
  const history        = body.history || null;

  let result;
  try {
    result = await callWorkersAI(env, systemPrompt, enrichedPrompt, history);
  } catch (e) {
    return json({ error: "Workers AI error: " + e.message }, 502);
  }

  if (env.TRACKULATE_KV && userId && financialData && feature === "monthly_review") {
    await saveMonthlyContext(env.TRACKULATE_KV, userId, financialData, result);
  }

  return json({ result, feature: feature || "general" });
}

// ════════════════════════════════════════════════════════════
// LICENCE HELPERS
// ════════════════════════════════════════════════════════════
async function getLicence(env, key) {
  if (!env.TRACKULATE_LICENCES || !key) return null;
  const raw = await env.TRACKULATE_LICENCES.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function generateLicenceKey() {
  // TRACK-XXXX-XXXX-XXXX using crypto random bytes
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return "TRACK-" + hex.slice(0, 4) + "-" + hex.slice(4, 8) + "-" + hex.slice(8, 12);
}

// ════════════════════════════════════════════════════════════
// RATE LIMITING
// ════════════════════════════════════════════════════════════
async function checkRateLimit(kv, userId) {
  const key   = "rate:" + userId + ":" + todayKey();
  const count = parseInt(await kv.get(key) || "0");
  if (count >= RATE_MAX) return false;
  await kv.put(key, String(count + 1), { expirationTtl: RATE_WIN });
  return true;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ════════════════════════════════════════════════════════════
// KV MEMORY
// ════════════════════════════════════════════════════════════
async function saveMonthlyContext(kv, userId, financialData, aiReview) {
  const month   = new Date().toISOString().slice(0, 7);
  const key     = "memory:" + userId + ":" + month;
  const context = {
    month,
    savedAt:    new Date().toISOString(),
    financials: financialData,
    aiReview:   aiReview.slice(0, 500),
  };
  await kv.put(key, JSON.stringify(context), { expirationTtl: 60 * 60 * 24 * 365 });
}

async function getMemoryContext(kv, userId) {
  if (!kv || !userId) return null;
  const months = [];
  const now    = new Date();
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.toISOString().slice(0, 7);
    const v = await kv.get("memory:" + userId + ":" + m);
    if (v) { try { months.push(JSON.parse(v)); } catch {} }
  }
  return months.length ? months : null;
}

// ════════════════════════════════════════════════════════════
// ENRICHED PROMPT
// ════════════════════════════════════════════════════════════
async function buildEnrichedPrompt(env, feature, prompt, userId, financialData) {
  if (!env.TRACKULATE_KV || !userId) return prompt;
  if (!["monthly_review", "debt_strategy"].includes(feature)) return prompt;

  const history = await getMemoryContext(env.TRACKULATE_KV, userId);
  if (!history || !history.length) return prompt;

  const historyText = history.map(h =>
    h.month + ": Net worth £" + (h.financials && h.financials.netWorth ? h.financials.netWorth.toLocaleString() : "unknown") + ", " +
    "Debt £" + (h.financials && h.financials.totalDebt ? h.financials.totalDebt.toLocaleString() : "unknown") + ", " +
    "Spent £" + (h.financials && h.financials.spent ? h.financials.spent.toLocaleString() : "unknown") +
    " of £" + (h.financials && h.financials.budgeted ? h.financials.budgeted.toLocaleString() : "unknown") + " budget. " +
    "Summary: " + (h.aiReview || "No summary.")
  ).join("\n");

  return prompt + "\n\nHISTORICAL CONTEXT (last " + history.length + " months for personalised advice):\n" +
    historyText + "\n\nUse this history to show trends, acknowledge improvements, and make the advice feel continuous rather than one-off.";
}

// ════════════════════════════════════════════════════════════
// SYSTEM PROMPTS
// ════════════════════════════════════════════════════════════
function buildSystemPrompt(feature) {
  const base = "You are a warm, expert UK personal finance coach for Trackulate. Always use British English and £ for currency. Be specific about numbers.";
  const prompts = {
    monthly_review:   base + " Write a personalised monthly financial review in 4 short paragraphs of natural prose. Reference historical trends where available. No bullet points or markdown headers. End with one clear action to take this week.",
    debt_strategy:    base + " Give a clear personalised debt payoff strategy. Explain recommended payoff order, interest saved with avalanche vs minimum payments, and two practical tips. Natural prose, no markdown.",
    categorise:       base + " Categorise bank transactions. Return ONLY a valid JSON array — no other text, no markdown, no code fences.",
    parse_transaction:base + " Parse a natural language transaction description into structured data. Return ONLY valid JSON — no other text.",
    explain:          base + " Explain a single financial figure in one clear sentence. Be specific, practical, and reference context if given. No markdown.",
    anomaly:          base + " Analyse a transaction against spending history. Return ONLY valid JSON — no other text.",
    forecast:         base + " Forecast end-of-month finances based on current pace. Write 2 short sentences. Be specific about numbers. No markdown.",
    general:          base + " Be concise and specific about numbers. No markdown.",
    chat:             base + " Be concise and specific about numbers. No markdown.",
  };
  return prompts[feature] || prompts.general;
}

// ════════════════════════════════════════════════════════════
// WORKERS AI
// ════════════════════════════════════════════════════════════
async function callWorkersAI(env, systemPrompt, userPrompt, history) {
  const messages = [{ role: "system", content: systemPrompt }];
  if (history && history.length) {
    const trimmed = history.slice(-16);
    trimmed.forEach(m => {
      if (m.role === "user" || m.role === "assistant") {
        messages.push({ role: m.role, content: String(m.content) });
      }
    });
  } else {
    messages.push({ role: "user", content: userPrompt });
  }
  const response = await env.AI.run(MODEL, { messages, max_tokens: MAX_TOK });
  return response && response.response ? response.response : "No response received.";
}

// ════════════════════════════════════════════════════════════
// SCHEDULED
// ════════════════════════════════════════════════════════════
async function runScheduled(cron, env) {
  if (!env.TRACKULATE_KV) return;
  const userList = await env.TRACKULATE_KV.get("registered_users");
  if (!userList) return;
  let users;
  try { users = JSON.parse(userList); } catch { return; }
  for (const user of users) {
    try { await sendScheduledMonthlyEmail(env, user); }
    catch (e) { console.error("Failed scheduled email for " + user.userId + ": " + e.message); }
  }
}

async function sendScheduledMonthlyEmail(env, user) {
  const { userId, email, name } = user;
  if (!email || !name) return;
  const month = new Date().toISOString().slice(0, 7);
  const key   = "memory:" + userId + ":" + month;
  const raw   = await env.TRACKULATE_KV.get(key);
  if (!raw) return;
  const context = JSON.parse(raw);
  const history = await getMemoryContext(env.TRACKULATE_KV, userId);
  const f       = context.financials || {};
  const histText = history ? history.map(h =>
    h.month + ": debt £" + (h.financials && h.financials.totalDebt ? h.financials.totalDebt.toLocaleString() : "?") +
    ", spent £" + (h.financials && h.financials.spent ? h.financials.spent.toLocaleString() : "?")
  ).join("; ") : "No prior history.";
  const prompt = "Write a monthly financial summary email for " + name + ". Their figures this month: income £" + f.income +
    ", total debt £" + (f.totalDebt ? f.totalDebt.toLocaleString() : 0) +
    ", budget £" + (f.budgeted ? f.budgeted.toLocaleString() : 0) +
    " / spent £" + (f.spent ? f.spent.toLocaleString() : 0) +
    ", net worth £" + (f.netWorth ? f.netWorth.toLocaleString() : 0) +
    ". Historical context: " + histText +
    ". Write 3 short paragraphs of warm, specific, actionable prose. End with one action for this month.";
  const system = buildSystemPrompt("monthly_review");
  const review = await callWorkersAI(env, system, prompt);
  const emailKey = "pending_email:" + userId + ":" + month;
  await env.TRACKULATE_KV.put(emailKey, JSON.stringify({
    to:      email,
    name:    name,
    subject: "Your Monthly Finance Summary — " + new Date().toLocaleString("en-GB", { month: "long", year: "numeric" }),
    body:    review,
  }), { expirationTtl: 60 * 60 * 24 * 7 });
}

// ════════════════════════════════════════════════════════════
// JSON HELPER
// ════════════════════════════════════════════════════════════
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
  });
}
