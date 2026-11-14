# Anderson on Allowance

A private, end-to-end-encrypted spending, budget and investing tracker that installs on the iPhone Home Screen.

- Your passphrase never leaves the device: PBKDF2 (600k) → AES-GCM vault key + server auth token.
- The server (Vercel + Upstash Redis) stores only ciphertext.
- Apple Pay, bank-alert emails and Wise events are sealed with the vault's RSA public key on arrival.

## Run locally

```bash
npm install
npm run dev
```

Data goes to `.data/store.json` in development.

## Deploy (Vercel + Upstash)

1. Push this repo to a **private** GitHub repo and import it in Vercel.
2. Vercel → Storage → Marketplace → **Upstash Redis** → connect it to the project (adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`).
3. Vercel → Settings → Environment Variables → add `SETUP_CODE` (any secret phrase, needed once to create the vault).
4. Redeploy, open the URL on your iPhone in **Safari**, and create the vault.
5. **Share → Add to Home Screen.** It opens full-screen as “Allowance”.

## Syncing purchases

Settings → **Create sync key**, then follow the in-app steps:

- **Apple Pay**: Shortcuts → Automation → Transaction → Get Contents of URL (`/api/ingest/applepay`).
- **Bank alerts**: paste the generated Apps Script (template in `scripts/gmail-alerts.gs`) into script.google.com and run `install`.
- **Wise** (optional): webhook to `/api/ingest/wise?key=…` for deposits.
- **CSV**: Activity → Import (Wise, Scotiabank, Coast Capital). Re-importing the same file is safe.

## Status

Phase 1 (done): vault, PWA, Home (spent / left to spend / daily net / weekly allowance / areas to watch / trend),
Activity, Budget (limits, bills, recurring), CSV import, Apple Pay + email + Wise sync, Settings, backup & export.

Next: trips, Invest (holdings, prices, 15% plan, goals), Net worth, monthly review, streaks & challenges,
push notifications (daily cron).
