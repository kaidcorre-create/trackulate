/**
 * Trackulate — Licence management
 * All KV reads/writes for licence keys
 */

export const PRO_FEATURES = [
  "chat", "categorise", "parse_transaction",
  "forecast", "monthly_review", "debt_strategy"
];

// ── KEY GENERATION ───────────────────────────────────────────
export function generateKey() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return "TRACK-" + hex.slice(0, 4) + "-" + hex.slice(4, 8) + "-" + hex.slice(8, 12);
}

// ── KV HELPERS ───────────────────────────────────────────────
export async function getLicence(env, key) {
  if (!env.TRACKULATE_LICENCES || !key) return null;
  const raw = await env.TRACKULATE_LICENCES.get(key.trim().toUpperCase());
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function putLicence(env, key, data) {
  await env.TRACKULATE_LICENCES.put(key.trim().toUpperCase(), JSON.stringify(data));
}

// ── VALIDATE ─────────────────────────────────────────────────
// Returns { valid, tier, status, email, error }
export async function validateLicence(env, key) {
  if (!key) return { valid: false, error: "no_key", tier: "standard", status: "none" };

  const entry = await getLicence(env, key);
  if (!entry)                    return { valid: false, error: "invalid_licence",   tier: "standard", status: "invalid" };
  if (entry.status === "suspended") return { valid: false, error: "licence_suspended", tier: entry.tier, status: "suspended", email: entry.email };

  return {
    valid:  true,
    tier:   entry.tier   || "standard",
    status: entry.status || "active",
    email:  entry.email  || "",
    activated_at: entry.activated_at || null,
  };
}

// ── ACTIVATE ─────────────────────────────────────────────────
export async function activateLicence(env, key, email, sheetId) {
  const entry = await getLicence(env, key);
  if (!entry) return { success: false, error: "invalid_licence", message: "Key not found. Check your purchase email or buy at trackulate.co.uk/pro." };
  if (entry.status === "suspended") return { success: false, error: "suspended", message: "This licence has been suspended. Contact support@trackulate.co.uk." };

  let warning = null;
  if (entry.activated_sheet_id && sheetId && entry.activated_sheet_id !== sheetId) {
    warning = "This key was previously activated on a different sheet. Both will work — contact support if you need help.";
  }

  const updated = Object.assign({}, entry, {
    activated_at:        entry.activated_at || new Date().toISOString(),
    activated_sheet_id:  entry.activated_sheet_id || sheetId || null,
    last_seen:           new Date().toISOString(),
  });
  await putLicence(env, key, updated);

  const res = { success: true, tier: entry.tier, message: "Licence activated. Pro features are now unlocked." };
  if (warning) res.warning = warning;
  return res;
}

// ── CREATE ───────────────────────────────────────────────────
export async function createLicence(env, email, tier) {
  const key   = generateKey();
  const entry = {
    tier:                tier || "pro",
    email:               email,
    status:              "active",
    created_at:          new Date().toISOString(),
    activated_at:        null,
    activated_sheet_id:  null,
  };
  await putLicence(env, key, entry);
  return { key, entry };
}

// ── SUSPEND ──────────────────────────────────────────────────
export async function suspendLicence(env, key) {
  const entry = await getLicence(env, key);
  if (!entry) return { success: false, message: "Key not found." };
  await putLicence(env, key, Object.assign({}, entry, { status: "suspended" }));
  return { success: true };
}

// ── FEATURE CHECK ────────────────────────────────────────────
export function canAccessFeature(tier, feature) {
  if (PRO_FEATURES.includes(feature)) {
    return tier === "pro";
  }
  return true; // non-Pro features always allowed
}

// ── RATE LIMITING ────────────────────────────────────────────
const RATE_MAX = 20;
const RATE_WIN = 86400;

export async function checkRateLimit(env, licenceKey) {
  if (!env.TRACKULATE_KV) return true;
  const key   = "rate:" + licenceKey + ":" + new Date().toISOString().slice(0, 10);
  const count = parseInt(await env.TRACKULATE_KV.get(key) || "0");
  if (count >= RATE_MAX) return false;
  await env.TRACKULATE_KV.put(key, String(count + 1), { expirationTtl: RATE_WIN });
  return true;
}

// ── D1 USAGE LOG ─────────────────────────────────────────────
export async function logUsage(env, licenceKey, feature) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "INSERT INTO usage_log (licence_key, feature, timestamp) VALUES (?, ?, ?)"
    ).bind(licenceKey, feature, new Date().toISOString()).run();
  } catch (_) { /* non-fatal */ }
}
