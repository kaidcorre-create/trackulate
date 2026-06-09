/**
 * Trackulate AI Worker — Full Stack Edition
 * Cloudflare Worker · Workers AI + KV Memory + Cron
 * trackulate.co.uk · v2.0 · 2026
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Trackulate-Token",
};

const MODEL     = "@cf/meta/llama-3.1-8b-instruct";
const MAX_TOK   = 1024;
const RATE_MAX  = 50;   // max AI calls per user per day
const RATE_WIN  = 86400; // 24 hours in seconds

export default {

  // ── HTTP REQUESTS ───────────────────────────────────────────
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405);
    }

    // Optional token auth
    if (env.TRACKULATE_TOKEN) {
      const token = request.headers.get("X-Trackulate-Token");
      if (token !== env.TRACKULATE_TOKEN) {
        return json({ error: "Unauthorised" }, 401);
      }
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON body" }, 400); }

    const { prompt, feature, userId, financialData } = body;
    if (!prompt) return json({ error: "No prompt provided" }, 400);

    // Rate limiting via KV
    if (env.TRACKULATE_KV && userId) {
      const allowed = await checkRateLimit(env.TRACKULATE_KV, userId);
      if (!allowed) {
        return json({ error: "Rate limit reached. Please try again tomorrow." }, 429);
      }
    }

    // Build enriched prompt with KV memory if available
    const enrichedPrompt = await buildEnrichedPrompt(
      env, feature, prompt, userId, financialData
    );

    const systemPrompt = buildSystemPrompt(feature);

    let result;
    try {
      result = await callWorkersAI(env, systemPrompt, enrichedPrompt);
    } catch (e) {
      return json({ error: `Workers AI error: ${e.message}` }, 502);
    }

    // Save context to KV memory after successful AI call
    if (env.TRACKULATE_KV && userId && financialData && feature === "monthly_review") {
      await saveMonthlyContext(env.TRACKULATE_KV, userId, financialData, result);
    }

    return json({ result, feature: feature || "general" });
  },

  // ── SCHEDULED CRON JOBS ─────────────────────────────────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event.cron, env));
  }
};

// ════════════════════════════════════════════════════════════
// RATE LIMITING
// ════════════════════════════════════════════════════════════
async function checkRateLimit(kv, userId) {
  const key   = `rate:${userId}:${todayKey()}`;
  const count = parseInt(await kv.get(key) || "0");
  if (count >= RATE_MAX) return false;
  await kv.put(key, String(count + 1), { expirationTtl: RATE_WIN });
  return true;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ════════════════════════════════════════════════════════════
// KV MEMORY — save & retrieve monthly context
// ════════════════════════════════════════════════════════════
async function saveMonthlyContext(kv, userId, financialData, aiReview) {
  const month   = new Date().toISOString().slice(0, 7); // "2026-06"
  const key     = `memory:${userId}:${month}`;
  const context = {
    month,
    savedAt:     new Date().toISOString(),
    financials:  financialData,
    aiReview:    aiReview.slice(0, 500), // store first 500 chars of review
  };
  // Keep 12 months of history
  await kv.put(key, JSON.stringify(context), { expirationTtl: 60 * 60 * 24 * 365 });
}

async function getMemoryContext(kv, userId) {
  if (!kv || !userId) return null;

  // Fetch last 3 months of context
  const months = [];
  const now    = new Date();
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.toISOString().slice(0, 7);
    const v = await kv.get(`memory:${userId}:${m}`);
    if (v) { try { months.push(JSON.parse(v)); } catch {} }
  }
  return months.length ? months : null;
}

// ════════════════════════════════════════════════════════════
// ENRICHED PROMPT — inject memory context
// ════════════════════════════════════════════════════════════
async function buildEnrichedPrompt(env, feature, prompt, userId, financialData) {
  if (!env.TRACKULATE_KV || !userId) return prompt;
  if (!["monthly_review", "debt_strategy"].includes(feature)) return prompt;

  const history = await getMemoryContext(env.TRACKULATE_KV, userId);
  if (!history || !history.length) return prompt;

  const historyText = history.map(h =>
    `${h.month}: Net worth £${h.financials?.netWorth?.toLocaleString() || "unknown"}, ` +
    `Debt £${h.financials?.totalDebt?.toLocaleString() || "unknown"}, ` +
    `Spent £${h.financials?.spent?.toLocaleString() || "unknown"} of £${h.financials?.budgeted?.toLocaleString() || "unknown"} budget. ` +
    `Summary: ${h.aiReview || "No summary."}`
  ).join("\n");

  return `${prompt}

HISTORICAL CONTEXT (last ${history.length} months for personalised advice):
${historyText}

Use this history to show trends, acknowledge improvements, and make the advice feel continuous rather than one-off.`;
}

// ════════════════════════════════════════════════════════════
// SYSTEM PROMPTS
// ════════════════════════════════════════════════════════════
function buildSystemPrompt(feature) {
  const base = "You are a warm, expert UK personal finance coach for Trackulate. Always use British English and £ for currency. Be specific about numbers.";

  const prompts = {
    monthly_review:  `${base} Write a personalised monthly financial review in 4 short paragraphs of natural prose. Reference historical trends where available. No bullet points or markdown headers. End with one clear action to take this week.`,
    debt_strategy:   `${base} Give a clear personalised debt payoff strategy. Explain recommended payoff order, interest saved with avalanche vs minimum payments, and two practical tips. Natural prose, no markdown.`,
    categorise:      `${base} Categorise bank transactions. Return ONLY a valid JSON array — no other text, no markdown, no code fences.`,
    parse_transaction:`${base} Parse a natural language transaction description into structured data. Return ONLY valid JSON — no other text.`,
    explain:         `${base} Explain a single financial figure in one clear sentence. Be specific, practical, and reference context if given. No markdown.`,
    anomaly:         `${base} Analyse a transaction against spending history. Return ONLY valid JSON — no other text.`,
    forecast:        `${base} Forecast end-of-month finances based on current pace. Write 2 short sentences. Be specific about numbers. No markdown.`,
    general:         `${base} Be concise and specific about numbers. No markdown.`,
  };

  return prompts[feature] || prompts.general;
}

// ════════════════════════════════════════════════════════════
// WORKERS AI CALL
// ════════════════════════════════════════════════════════════
async function callWorkersAI(env, systemPrompt, userPrompt) {
  const response = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
    max_tokens: MAX_TOK,
  });
  return response?.response ?? "No response received.";
}

// ════════════════════════════════════════════════════════════
// SCHEDULED — cron-based monthly email
// Fires on: 0 8 1 * *  (8am on 1st of every month)
// ════════════════════════════════════════════════════════════
async function runScheduled(cron, env) {
  if (!env.TRACKULATE_KV) return;

  // Get all registered users from KV
  const userList = await env.TRACKULATE_KV.get("registered_users");
  if (!userList) return;

  let users;
  try { users = JSON.parse(userList); } catch { return; }

  for (const user of users) {
    try {
      await sendScheduledMonthlyEmail(env, user);
    } catch (e) {
      console.error(`Failed scheduled email for ${user.userId}: ${e.message}`);
    }
  }
}

async function sendScheduledMonthlyEmail(env, user) {
  const { userId, email, name } = user;
  if (!email || !name) return;

  // Get latest financial context from KV
  const month = new Date().toISOString().slice(0, 7);
  const key   = `memory:${userId}:${month}`;
  const raw   = await env.TRACKULATE_KV.get(key);
  if (!raw) return;

  const context = JSON.parse(raw);
  const history = await getMemoryContext(env.TRACKULATE_KV, userId);
  const f       = context.financials || {};

  const histText = history?.map(h =>
    `${h.month}: debt £${h.financials?.totalDebt?.toLocaleString()}, spent £${h.financials?.spent?.toLocaleString()}`
  ).join("; ") || "No prior history.";

  const prompt = `Write a monthly financial summary email for ${name}. Their figures this month: income £${f.income}, total debt £${f.totalDebt?.toLocaleString()}, budget £${f.budgeted?.toLocaleString()} / spent £${f.spent?.toLocaleString()}, net worth £${f.netWorth?.toLocaleString()}, sinking funds £${f.saved?.toLocaleString()} of £${f.target?.toLocaleString()} target, monthly subscriptions £${f.subCost?.toLocaleString()}. Historical context: ${histText}. Write 3 short paragraphs of warm, specific, actionable prose. End with one action for this month.`;

  const system = buildSystemPrompt("monthly_review");
  const review = await callWorkersAI(env, system, prompt);

  // Send via email — requires Email Routing to be set up in Cloudflare
  // or use a transactional email service like Resend / Mailgun
  // For now we store the email in KV for Apps Script to collect
  const emailKey = `pending_email:${userId}:${month}`;
  await env.TRACKULATE_KV.put(emailKey, JSON.stringify({
    to:      email,
    name:    name,
    subject: `Your Monthly Finance Summary — ${new Date().toLocaleString("en-GB", {month:"long", year:"numeric"})}`,
    body:    review,
  }), { expirationTtl: 60 * 60 * 24 * 7 }); // keep for 7 days
}

// ════════════════════════════════════════════════════════════
// JSON HELPER
// ════════════════════════════════════════════════════════════
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
