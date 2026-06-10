/**
 * Trackulate AI Worker — Infrastructure Edition
 * Cloudflare Worker · Workers AI + KV + D1 + Licence System
 * trackulate.co.uk · v4.0 · 2026
 */

import { validateLicence, activateLicence, createLicence, getLicence, suspendLicence, canAccessFeature, checkRateLimit, logUsage } from "./licence.js";
import { handleAI } from "./ai.js";
import { handleStripeWebhook } from "./stripe.js";
import { sendDeliveryEmail } from "./delivery.js";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
};

// Cloudflare Pages URL — sidebar HTML is served from here
const PAGES_URL = "https://trackulate.pages.dev/sidebar";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    // ── PUBLIC ENDPOINTS ──────────────────────────────────────
    if (path === "/validate" && request.method === "POST") {
      return handleValidate(request, env);
    }
    if (path === "/activate" && request.method === "POST") {
      return handleActivate(request, env);
    }
    if (path === "/sidebar" && request.method === "POST") {
      return handleSidebar(request, env);
    }

    // ── WEBHOOK ENDPOINTS ─────────────────────────────────────
    if (path === "/webhooks/stripe" && request.method === "POST") {
      const result = await handleStripeWebhook(request, env);
      return json(result, result.status || 200);
    }
    if (path === "/webhooks/etsy" && request.method === "POST") {
      return handleEtsyWebhook(request, env);
    }

    // ── ADMIN ENDPOINTS ───────────────────────────────────────
    if (path === "/admin/create-licence" && request.method === "POST") {
      return handleAdminCreateLicence(request, env);
    }
    if (path.startsWith("/admin/licence/") && request.method === "GET") {
      return handleAdminGetLicence(request, env, path);
    }
    if (path === "/admin/suspend-licence" && request.method === "POST") {
      return handleAdminSuspendLicence(request, env);
    }

    // ── MAIN AI ENDPOINT ──────────────────────────────────────
    if (path === "/ai" || path === "/") {
      return handleAIRequest(request, env);
    }

    return json({ error: "Not found" }, 404);
  },
};

// ════════════════════════════════════════════════════════════
// VALIDATE — silent licence check on sheet open
// ════════════════════════════════════════════════════════════
async function handleValidate(request, env) {
  const body = await safeJson(request);
  const { licence_key } = body;

  if (!licence_key) {
    return json({ valid: false, tier: "standard", status: "no_key" });
  }

  const result = await validateLicence(env, licence_key);
  return json({
    valid:        result.valid,
    tier:         result.tier,
    status:       result.status,
    email:        result.email || "",
    activated_at: result.activated_at || null,
    isPro:        result.valid && result.tier === "pro",
  });
}

// ════════════════════════════════════════════════════════════
// ACTIVATE — user enters key, marks activated
// ════════════════════════════════════════════════════════════
async function handleActivate(request, env) {
  const body = await safeJson(request);
  const { licence_key, email, sheet_id } = body;

  if (!licence_key || !email) {
    return json({ error: "licence_key and email are required" }, 400);
  }

  const result = await activateLicence(env, licence_key, email, sheet_id || null);
  if (!result.success) {
    return json({ error: result.error, message: result.message }, 403);
  }
  return json(result);
}

// ════════════════════════════════════════════════════════════
// SIDEBAR — fetch HTML from Cloudflare Pages, return to sheet
// ════════════════════════════════════════════════════════════
async function handleSidebar(request, env) {
  const body = await safeJson(request);
  const { file } = body;

  // Whitelist valid sidebar files
  const allowed = ["ControlCentre", "SetupWizard", "TransactionInput", "UpgradePrompt", "LicenceInfo"];
  if (!file || !allowed.includes(file)) {
    return json({ error: "Invalid file name" }, 400);
  }

  const pageUrl = PAGES_URL + "/" + file + ".html";

  try {
    const res = await fetch(pageUrl, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return json({ error: "Sidebar unavailable" }, 502);
    const html = await res.text();
    return new Response(JSON.stringify({ html }), {
      headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
    });
  } catch (e) {
    return json({ error: "Fetch failed: " + e.message }, 502);
  }
}

// ════════════════════════════════════════════════════════════
// ETSY WEBHOOK — called by Apps Script daily job
// ════════════════════════════════════════════════════════════
async function handleEtsyWebhook(request, env) {
  // Protect with admin secret
  const secret = request.headers.get("X-Admin-Secret") || "";
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  const body = await safeJson(request);
  const { receipt_id, email, buyer_name } = body;

  if (!receipt_id || !email) {
    return json({ error: "receipt_id and email required" }, 400);
  }

  // Idempotency check
  if (env.DB) {
    try {
      const existing = await env.DB.prepare(
        "SELECT licence_key FROM etsy_fulfilled WHERE receipt_id = ?"
      ).bind(String(receipt_id)).first();
      if (existing) return json({ received: true, duplicate: true, licence_key: existing.licence_key });
    } catch (_) {}
  }

  const { key } = await createLicence(env, email, "pro");

  if (env.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO etsy_fulfilled (receipt_id, licence_key, email, fulfilled_at) VALUES (?, ?, ?, ?)"
      ).bind(String(receipt_id), key, email, new Date().toISOString()).run();
    } catch (_) {}
  }

  await sendDeliveryEmail(env, email, buyer_name || "there", key);
  return json({ received: true, licence_key: key });
}

// ════════════════════════════════════════════════════════════
// MAIN AI ENDPOINT
// ════════════════════════════════════════════════════════════
async function handleAIRequest(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const { prompt, feature, licence_key } = body;
  if (!prompt) return json({ error: "No prompt provided" }, 400);

  // Validate licence
  const licResult = await validateLicence(env, licence_key);
  if (!licResult.valid) {
    return json({ error: licResult.error || "invalid_licence", message: "A valid Pro licence is required. Upgrade at trackulate.co.uk/pro." }, 403);
  }

  // Feature gating
  if (!canAccessFeature(licResult.tier, feature)) {
    return json({ error: "upgrade_required", tier_required: "pro", message: "This feature requires a Pro licence." }, 402);
  }

  // Rate limiting
  const allowed = await checkRateLimit(env, licence_key);
  if (!allowed) {
    return json({ error: "Rate limit reached. Resets at midnight." }, 429);
  }

  // Run AI
  let result;
  try {
    const aiResult = await handleAI(body, env);
    result = aiResult.result || aiResult.error || "No response.";
  } catch (e) {
    return json({ error: "AI error: " + e.message }, 502);
  }

  // Log usage
  await logUsage(env, licence_key, feature || "general");

  return json({ result, feature: feature || "general" });
}

// ════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ════════════════════════════════════════════════════════════
async function handleAdminCreateLicence(request, env) {
  if (!checkAdminAuth(request, env)) return json({ error: "Forbidden" }, 403);

  const body = await safeJson(request);
  const { email, tier } = body;
  if (!email) return json({ error: "email required" }, 400);

  const validTiers = ["standard", "pro"];
  const useTier    = validTiers.includes(tier) ? tier : "pro";

  const { key, entry } = await createLicence(env, email, useTier);

  // Optionally send delivery email
  if (body.send_email !== false) {
    await sendDeliveryEmail(env, email, body.name || "there", key);
  }

  return json({ success: true, licence_key: key, tier: useTier, email, entry });
}

async function handleAdminGetLicence(request, env, path) {
  if (!checkAdminAuth(request, env)) return json({ error: "Forbidden" }, 403);

  const key   = path.replace("/admin/licence/", "").trim();
  const entry = await getLicence(env, key);
  if (!entry) return json({ error: "Not found" }, 404);
  return json({ key, entry });
}

async function handleAdminSuspendLicence(request, env) {
  if (!checkAdminAuth(request, env)) return json({ error: "Forbidden" }, 403);

  const body   = await safeJson(request);
  const { licence_key } = body;
  if (!licence_key) return json({ error: "licence_key required" }, 400);

  const result = await suspendLicence(env, licence_key);
  return json(result);
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function checkAdminAuth(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const secret     = authHeader.replace("Bearer ", "").trim() ||
                     request.headers.get("X-Admin-Secret") || "";
  return env.ADMIN_SECRET && secret === env.ADMIN_SECRET;
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
  });
}
# Wed Jun 10 20:24:24 UTC 2026
