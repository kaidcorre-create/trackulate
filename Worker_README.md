# Trackulate AI Worker

Cloudflare Worker that bridges Google Sheets Apps Script with the Claude API.
Part of the [Trackulate](https://trackulate.co.uk) Complete Finance Bundle.

---

## Deploy in 5 minutes

### 1. Install Wrangler

```bash
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Deploy the Worker

```bash
npx wrangler deploy
```

Copy the Worker URL from the output — it looks like:
`https://trackulate-ai-worker.YOUR-SUBDOMAIN.workers.dev`

### 4. Set your Anthropic API key

```bash
npx wrangler secret put ANTHROPIC_KEY
```

Paste your key from [console.anthropic.com](https://console.anthropic.com).

### 5. (Optional) Set a security token

```bash
npx wrangler secret put TRACKULATE_TOKEN
```

Use any random string. Add the same value to `CONFIG.WORKER_TOKEN` in the Apps Script.

### 6. Paste the Worker URL into your Apps Script

In `Trackulate_Finance_Bundle_Automation.gs`, update line 9:

```js
const WORKER_URL = "https://trackulate-ai-worker.YOUR-SUBDOMAIN.workers.dev";
```

---

## API

**POST** `https://your-worker.workers.dev`

```json
{
  "prompt":  "Analyse my finances...",
  "feature": "monthly_review"
}
```

| `feature` value  | Used for                          |
|------------------|-----------------------------------|
| `monthly_review` | AI monthly financial review       |
| `debt_strategy`  | AI debt payoff strategy           |
| `categorise`     | Transaction categoriser           |
| `general`        | Any other prompt                  |

**Response:**

```json
{
  "result":  "Your financial review text...",
  "feature": "monthly_review"
}
```

---

## Security

- The Worker accepts POST requests from any origin (required for Apps Script)
- Set `TRACKULATE_TOKEN` as a secret to restrict access to your sheet only
- Never commit your `ANTHROPIC_KEY` — always use `wrangler secret put`

---

## Local development

```bash
# Create a .dev.vars file (gitignored)
echo 'ANTHROPIC_KEY=your-key-here' > .dev.vars

# Run locally
npx wrangler dev
```

---

## File structure

```
trackulate/
├── src/
│   └── index.js          # Worker entry point
├── wrangler.toml         # Cloudflare config
├── package.json
├── .gitignore
└── README.md
```

---

*Trackulate · trackulate.co.uk · Track. Calculate. Automate.*
