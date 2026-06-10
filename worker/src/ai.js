/**
 * Trackulate — AI feature handlers
 * Workers AI calls, system prompts, KV memory
 */

const MODEL   = "@cf/meta/llama-3.1-8b-instruct";
const MAX_TOK = 4096;

// ── MAIN HANDLER ─────────────────────────────────────────────
export async function handleAI(body, env) {
  const { prompt, feature, userId, financialData, system, history } = body;
  if (!prompt) return { error: "No prompt provided" };

  const enriched    = await buildEnrichedPrompt(env, feature, prompt, userId, financialData);
  const systemPrompt = system || buildSystemPrompt(feature);

  const result = await callWorkersAI(env, systemPrompt, enriched, history || null);

  if (env.TRACKULATE_KV && userId && financialData && feature === "monthly_review") {
    await saveMonthlyContext(env.TRACKULATE_KV, userId, financialData, result);
  }

  return { result, feature: feature || "general" };
}

// ── WORKERS AI ───────────────────────────────────────────────
export async function callWorkersAI(env, systemPrompt, userPrompt, history) {
  const messages = [{ role: "system", content: systemPrompt }];

  if (history && history.length) {
    history.slice(-16).forEach(m => {
      if (m.role === "user" || m.role === "assistant") {
        messages.push({ role: m.role, content: String(m.content) });
      }
    });
  } else {
    messages.push({ role: "user", content: userPrompt });
  }

  const response = await env.AI.run(MODEL, { messages, max_tokens: MAX_TOK });
  return response?.response ?? "No response received.";
}

// ── SYSTEM PROMPTS ───────────────────────────────────────────
export function buildSystemPrompt(feature) {
  const base = "You are a warm, expert UK personal finance coach for Trackulate. Always use British English and £ for currency. Be specific about numbers.";
  const prompts = {
    chat:             base + " Be concise and specific. No markdown. End every response with one specific next step in the sheet.",
    monthly_review:   base + " Write a personalised monthly financial review in 4 short paragraphs of natural prose. No bullet points or markdown. End with one clear action to take this week.",
    debt_strategy:    base + " Give a clear personalised debt payoff strategy. Natural prose, no markdown.",
    categorise:       base + " Categorise bank transactions. Return ONLY a valid JSON array — no other text, no markdown, no code fences.",
    parse_transaction:base + " Parse a natural language transaction into structured data. Return ONLY valid JSON — no other text.",
    forecast:         base + " Forecast end-of-month finances based on current pace. Write 2 short sentences. No markdown.",
    general:          base + " Be concise and specific. No markdown.",
  };
  return prompts[feature] || prompts.general;
}

// ── KV MEMORY ────────────────────────────────────────────────
async function saveMonthlyContext(kv, userId, financialData, aiReview) {
  const month = new Date().toISOString().slice(0, 7);
  await kv.put(
    "memory:" + userId + ":" + month,
    JSON.stringify({ month, savedAt: new Date().toISOString(), financials: financialData, aiReview: aiReview.slice(0, 500) }),
    { expirationTtl: 60 * 60 * 24 * 365 }
  );
}

export async function getMemoryContext(kv, userId) {
  if (!kv || !userId) return null;
  const months = [];
  const now    = new Date();
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = await kv.get("memory:" + userId + ":" + d.toISOString().slice(0, 7));
    if (v) { try { months.push(JSON.parse(v)); } catch {} }
  }
  return months.length ? months : null;
}

async function buildEnrichedPrompt(env, feature, prompt, userId, financialData) {
  if (!env.TRACKULATE_KV || !userId) return prompt;
  if (!["monthly_review", "debt_strategy"].includes(feature)) return prompt;

  const history = await getMemoryContext(env.TRACKULATE_KV, userId);
  if (!history || !history.length) return prompt;

  const histText = history.map(h =>
    h.month + ": Net worth £" + (h.financials?.netWorth?.toLocaleString() || "?") +
    ", Debt £" + (h.financials?.totalDebt?.toLocaleString() || "?") +
    ", Spent £" + (h.financials?.spent?.toLocaleString() || "?") +
    " of £" + (h.financials?.budgeted?.toLocaleString() || "?") + " budget. " +
    "Summary: " + (h.aiReview || "No summary.")
  ).join("\n");

  return prompt + "\n\nHISTORICAL CONTEXT (last " + history.length + " months):\n" + histText +
    "\n\nUse this history to show trends and make advice feel continuous.";
}
