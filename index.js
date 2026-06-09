/**
 * Trackulate AI Worker
 * Cloudflare Worker — Claude API bridge for Google Sheets
 * trackulate.co.uk · v1.0 · 2026
 *
 * SETUP:
 *   1. npx wrangler deploy
 *   2. npx wrangler secret put ANTHROPIC_KEY
 *      (paste your key from console.anthropic.com)
 *   3. Copy your worker URL into the Apps Script CONFIG.WORKER_URL
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Trackulate-Token",
};

const MODEL   = "claude-sonnet-4-20250514";
const MAX_TOK = 1024;

// Optional: simple token auth so only your sheet can call the worker
// Set TRACKULATE_TOKEN as a secret (npx wrangler secret put TRACKULATE_TOKEN)
// and add the same value to your Apps Script CONFIG.WORKER_TOKEN
// Leave blank to skip auth (fine for personal use)

export default {
  async fetch(request, env) {

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405);
    }

    // Optional token check
    if (env.TRACKULATE_TOKEN) {
      const token = request.headers.get("X-Trackulate-Token");
      if (token !== env.TRACKULATE_TOKEN) {
        return json({ error: "Unauthorised" }, 401);
      }
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { prompt, feature } = body;
    if (!prompt) return json({ error: "No prompt provided" }, 400);
    if (!env.ANTHROPIC_KEY) return json({ error: "ANTHROPIC_KEY not set — run: npx wrangler secret put ANTHROPIC_KEY" }, 500);

    // Build system prompt based on feature type
    const systemPrompt = buildSystemPrompt(feature);

    // Call Claude
    let result;
    try {
      result = await callClaude(env.ANTHROPIC_KEY, systemPrompt, prompt);
    } catch (e) {
      return json({ error: `Claude API error: ${e.message}` }, 502);
    }

    return json({ result, feature: feature || "general" });
  }
};

// ── FEATURE-SPECIFIC SYSTEM PROMPTS ──────────────────────────
function buildSystemPrompt(feature) {
  const base = "You are a helpful UK personal finance assistant for Trackulate, a financial planning tool. Always use British English, British date formats, and £ for currency.";

  const prompts = {
    monthly_review: `${base} Your role is to write warm, honest, actionable monthly financial reviews. Write in natural flowing prose (4-5 short paragraphs). Be specific about numbers. No markdown headers, no bullet points. End with one clear action to take this week.`,
    debt_strategy:  `${base} Your role is to give clear, personalised debt payoff strategies. Explain the recommended payoff order, how much interest the avalanche method saves vs minimum payments, and two practical tips. Write in natural prose. Be encouraging but honest. No markdown.`,
    categorise:     `${base} Your role is to categorise bank transactions. Return ONLY valid JSON arrays with no other text, preamble or markdown code fences.`,
    general:        `${base} Be concise, practical, and specific about numbers. No markdown formatting.`,
  };

  return prompts[feature] || prompts.general;
}

// ── CLAUDE API CALL ───────────────────────────────────────────
async function callClaude(apiKey, systemPrompt, userPrompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOK,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? "No response from Claude.";
}

// ── JSON HELPER ───────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
