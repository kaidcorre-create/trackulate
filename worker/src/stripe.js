/**
 * Trackulate — Stripe webhook handler
 * Handles checkout.session.completed events
 */

import { createLicence } from "./licence.js";
import { sendDeliveryEmail } from "./delivery.js";

export async function handleStripeWebhook(request, env) {
  const sig    = request.headers.get("stripe-signature");
  const body   = await request.text();

  // Verify Stripe signature
  if (env.STRIPE_WEBHOOK_SECRET) {
    const valid = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) {
      return { error: "Invalid signature", status: 400 };
    }
  }

  let event;
  try { event = JSON.parse(body); }
  catch { return { error: "Invalid JSON", status: 400 }; }

  if (event.type !== "checkout.session.completed") {
    return { received: true, ignored: true };
  }

  const session    = event.data.object;
  const sessionId  = session.id;
  const email      = session.customer_details?.email || session.customer_email || "";
  const name       = session.customer_details?.name  || "";

  if (!email) return { error: "No email in session", status: 400 };

  // Idempotency — check D1 if already fulfilled
  if (env.DB) {
    try {
      const existing = await env.DB.prepare(
        "SELECT licence_key FROM stripe_fulfilled WHERE session_id = ?"
      ).bind(sessionId).first();
      if (existing) return { received: true, duplicate: true, licence_key: existing.licence_key };
    } catch (_) {}
  }

  // Generate licence key
  const { key } = await createLicence(env, email, "pro");

  // Store in D1
  if (env.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO stripe_fulfilled (session_id, licence_key, email, fulfilled_at) VALUES (?, ?, ?, ?)"
      ).bind(sessionId, key, email, new Date().toISOString()).run();
    } catch (_) {}
  }

  // Send delivery email
  await sendDeliveryEmail(env, email, name, key);

  return { received: true, licence_key: key };
}

// ── STRIPE SIGNATURE VERIFICATION ───────────────────────────
async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;

  // Parse timestamp and signatures from header
  const parts     = sigHeader.split(",");
  const tsPart    = parts.find(p => p.startsWith("t="));
  const v1Parts   = parts.filter(p => p.startsWith("v1="));
  if (!tsPart || !v1Parts.length) return false;

  const timestamp = tsPart.slice(2);
  const signed    = timestamp + "." + payload;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  return v1Parts.some(p => p.slice(3) === hex);
}
