#!/usr/bin/env node
/**
 * Trackulate Admin CLI — create a licence key
 *
 * Usage:
 *   node admin/create-licence.js --email user@example.com --tier pro
 *   node admin/create-licence.js --email user@example.com --tier pro --no-email
 *   node admin/create-licence.js --email user@example.com --name "Jane Smith"
 *
 * Required env vars (or .env in repo root):
 *   ADMIN_SECRET   — matches the Worker's ADMIN_SECRET secret
 *   WORKER_URL     — e.g. https://trackulate.kai-d-corre-ea2.workers.dev
 */

const https  = require("https");
const http   = require("http");
const url    = require("url");
const path   = require("path");
const fs     = require("fs");

// Load .env from repo root if present
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

// ── Parse CLI args ────────────────────────────────────────────
const args  = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    if (key === "no-email") {
      flags["no_email"] = true;
    } else {
      flags[key] = args[i + 1] || "";
      i++;
    }
  }
}

const email      = flags.email;
const tier       = flags.tier || "pro";
const name       = flags.name || "";
const sendEmail  = !flags.no_email;

if (!email) {
  console.error("Usage: node admin/create-licence.js --email user@example.com [--tier pro] [--name \"Name\"] [--no-email]");
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────
const WORKER_URL   = process.env.WORKER_URL   || "https://trackulate.kai-d-corre-ea2.workers.dev";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

if (!ADMIN_SECRET) {
  console.error("Error: ADMIN_SECRET env var is required.");
  process.exit(1);
}

// ── POST helper ───────────────────────────────────────────────
function post(targetUrl, body, token) {
  return new Promise((resolve, reject) => {
    const parsed  = new url.URL(targetUrl);
    const isHttps = parsed.protocol === "https:";
    const lib     = isHttps ? https : http;

    const data = JSON.stringify(body);

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(data),
        "Authorization":  "Bearer " + token,
      },
    };

    const req = lib.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  console.log("Creating licence...");
  console.log("  Email: " + email);
  console.log("  Tier:  " + tier);
  if (name) console.log("  Name:  " + name);
  console.log("  Send delivery email: " + (sendEmail ? "yes" : "no"));
  console.log("");

  const payload = { email, tier, name, send_email: sendEmail };

  let result;
  try {
    result = await post(WORKER_URL + "/admin/create-licence", payload, ADMIN_SECRET);
  } catch (e) {
    console.error("Network error: " + e.message);
    process.exit(1);
  }

  if (result.status !== 200) {
    console.error("Error " + result.status + ":", result.body);
    process.exit(1);
  }

  const { licence_key, tier: createdTier } = result.body;

  console.log("Licence created successfully.");
  console.log("  Key:  " + licence_key);
  console.log("  Tier: " + createdTier);
  if (sendEmail) {
    console.log("  Delivery email queued to: " + email);
  }
})();
