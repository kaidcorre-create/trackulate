/**
 * Trackulate AI Worker
 * Cloudflare Worker — Workers AI edition (no Anthropic key needed)
 * trackulate.co.uk · v1.0 · 2026
 *
 * Uses Cloudflare Workers AI — billed to your Cloudflare account
 * Free tier: 10,000 neurons/day
 * No external API keys required
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Trackulate-Token",
};

// Best available model on Workers AI for text generation
const MODEL = "@cf/meta/llama-3.1-8b-instruct";

export default {
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
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { prompt, feature } = body;
    if (!prompt) return json({ error: "No prompt provided" }, 400);

    const systemPrompt = buildSystemPrompt(feature);

    let result;
    try {
      result = await callWorkersAI(env, systemPrompt, prompt);
    } catch (e) {
      return json({ error: `Workers AI error: ${e.message}` }, 502);
    }

    return json({ result, feature: feature || "general" });
  }
};

// ── FEATURE SYSTEM PROMPTS ────────────────────────────────────
function buildSystemPrompt(feature) {
  const base = "You are a helpful UK personal finance assistant for Trackulate. Always use British English and £ for currency. Be concise and practical.";

  const prompts = {
    monthly_review: `${base} Write warm, honest monthly financial reviews in 4 short paragraphs of natural prose. Be specific about numbers. No bullet points or headers. End with one clear action to take this week.`,
    debt_strategy:  `${base} Give clear personalised debt payoff strategies. Explain recommended payoff order, interest saved with avalanche vs minimum payments, and two practical tips. Natural prose, no markdown.`,
    categorise:     `${base} Categorise bank transactions. Return ONLY a valid JSON array with no other text or markdown.`,
    general:        `${base} Be concise and specific about numbers.`,
  };

  return prompts[feature] || prompts.general;
}

// ── WORKERS AI CALL ───────────────────────────────────────────
async function callWorkersAI(env, systemPrompt, userPrompt) {
  const response = await env.AI.run(MODEL, {
    messages: [
      { role: "system",  content: systemPrompt },
      { role: "user",    content: userPrompt   },
    ],
    max_tokens: 1024,
  });

  return response?.response ?? "No response received.";
}

// ── JSON HELPER ───────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
