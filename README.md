# Trackulate

Personal finance Google Sheets tool with AI features. Sold on Etsy as a one-time £20 purchase (Standard tier). Pro tier (£15 upgrade) unlocks AI chat, PDF import, and email automations.

---

## Repo Structure

```
trackulate/
├── worker/              Cloudflare Worker (AI, licence, webhooks)
│   ├── src/
│   │   ├── index.js     Main router
│   │   ├── licence.js   KV licence operations + rate limiting
│   │   ├── ai.js        Workers AI handlers
│   │   ├── delivery.js  Resend transactional email
│   │   └── stripe.js    Stripe webhook handler
│   ├── wrangler.toml
│   └── package.json
├── sidebar/             Static HTML served via Cloudflare Pages
│   ├── ControlCentre.html
│   ├── SetupWizard.html
│   ├── TransactionInput.html
│   ├── UpgradePrompt.html
│   └── LicenceInfo.html
├── apps-script/         Google Apps Script (thin shell)
│   ├── Code.gs          Main entry, UI triggers, AI calls
│   ├── Loader.gs        loadSidebar() + VERSION constant
│   ├── EtsyFulfillment.gs  Daily Etsy order fulfilment
│   └── .clasp.json
├── admin/
│   └── create-licence.js  CLI to create keys manually
└── .github/workflows/
    ├── deploy-worker.yml  Auto-deploys Worker on push to main
    └── deploy-pages.yml   Auto-deploys Pages on push to main
```

---

## Tiers

| Feature | Standard (£20) | Pro (£35 total) |
|---|---|---|
| Full spreadsheet + all tabs | ✓ | ✓ |
| Formulas + navigation | ✓ | ✓ |
| Setup wizard | ✓ | ✓ |
| AI chat (Trackulate AI) | — | ✓ |
| PDF bank statement import | — | ✓ |
| Transaction parser | — | ✓ |
| Weekly budget alert emails | — | ✓ |
| Monthly summary emails | — | ✓ |
| Subscription renewal alerts | — | ✓ |
| Debt cleared alerts | — | ✓ |
| Sinking fund goal alerts | — | ✓ |

---

## First-time Setup

### 1. Cloudflare resources

```bash
cd worker

# KV namespaces
npx wrangler kv namespace create TRACKULATE_KV
npx wrangler kv namespace create TRACKULATE_LICENCES

# D1 database
npx wrangler d1 create trackulate_db

# Apply schema
npx wrangler d1 execute trackulate_db --file=schema.sql
```

Paste the generated IDs into `worker/wrangler.toml`.

### 2. D1 schema

```sql
CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  licence_key TEXT NOT NULL,
  feature TEXT NOT NULL,
  used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_fulfilled (
  session_id TEXT PRIMARY KEY,
  licence_key TEXT NOT NULL,
  email TEXT NOT NULL,
  fulfilled_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS etsy_fulfilled (
  receipt_id TEXT PRIMARY KEY,
  licence_key TEXT NOT NULL,
  email TEXT NOT NULL,
  fulfilled_at TEXT NOT NULL
);
```

### 3. Worker secrets

```bash
cd worker
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRO_PRODUCT_ID
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ETSY_API_KEY
npx wrangler secret put ETSY_SHOP_ID
npx wrangler secret put ETSY_PRO_LISTING_ID
```

### 4. Cloudflare Pages

Create a Pages project named `trackulate-sidebar` pointing to the `sidebar/` directory. Set the custom domain `sidebar.trackulate.co.uk`.

### 5. GitHub Actions secrets

In GitHub → Settings → Secrets, add:
- `CLOUDFLARE_API_TOKEN` — API token with Workers and Pages deploy permissions
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID

### 6. Apps Script

```bash
npm install -g @google/clasp
clasp login
```

Edit `apps-script/.clasp.json` and replace `PASTE_APPS_SCRIPT_ID_HERE` with your Apps Script project ID (found in Apps Script → Project Settings → Script ID).

```bash
clasp push
```

Set the `admin_secret` ScriptProperty in Apps Script → Project Settings → Script properties (must match the `ADMIN_SECRET` Worker secret if using `EtsyFulfillment.gs`).

Set up the daily Etsy trigger: Apps Script → Triggers → Add trigger → `checkNewEtsyOrders` → Time-driven → Day timer.

---

## Deploying Updates

**Worker changes:** Push to `main` — GitHub Actions auto-deploys.

**Sidebar HTML changes:** Push to `main` — GitHub Actions auto-deploys to Pages. All users get the new UI on next open (no sheet update needed).

**Apps Script changes:** Run `clasp push` locally, then publish a new version from the Apps Script editor.

---

## Creating Licence Keys

### Via CLI (manual)

```bash
cp .env.example .env  # fill in ADMIN_SECRET and WORKER_URL
node admin/create-licence.js --email user@example.com --tier pro
node admin/create-licence.js --email user@example.com --tier pro --name "Jane Smith" --no-email
```

### Via Worker admin endpoint

```bash
curl -X POST https://trackulate.kai-d-corre-ea2.workers.dev/admin/create-licence \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","tier":"pro","name":"Jane"}'
```

### Lookup a key

```bash
curl https://trackulate.kai-d-corre-ea2.workers.dev/admin/licence/TRACK-XXXX-XXXX-XXXX \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### Suspend a key

```bash
curl -X POST https://trackulate.kai-d-corre-ea2.workers.dev/admin/suspend-licence \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"licence_key":"TRACK-XXXX-XXXX-XXXX"}'
```

---

## Licence Key Format

`TRACK-XXXX-XXXX-XXXX` — prefix + 3 groups of 4 uppercase hex characters generated via `crypto.getRandomValues`.

Keys are stored in `TRACKULATE_LICENCES` KV with the following shape:

```json
{
  "email": "user@example.com",
  "tier": "pro",
  "status": "active",
  "created_at": "2026-01-01T00:00:00.000Z",
  "activated_at": "2026-01-02T00:00:00.000Z",
  "sheet_id": "1BxiMVs0...",
  "source": "etsy"
}
```

---

## Environment Variables (`.env` for admin CLI)

```
WORKER_URL=https://trackulate.kai-d-corre-ea2.workers.dev
ADMIN_SECRET=your-admin-secret-here
```

---

## Sidebar Update Process

1. Edit any file in `sidebar/`
2. Commit and push to `main`
3. GitHub Actions runs `deploy-pages.yml`
4. Cloudflare Pages deploys in ~30 seconds
5. All users see the new sidebar the next time they open it — no sheet update required
