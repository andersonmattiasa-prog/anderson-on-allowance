# Anderson Ahead — project document

_Personal finance app rebuilt with Claude Code, 14–15 November 2026. Formerly "Anderson on Allowance"._

**Status (15 Nov 2026): live and in daily use.**

| What | Where |
|---|---|
| App | https://anderson-on-allowance.vercel.app (installed on the iPhone Home Screen as "Anderson Ahead") |
| Code | https://github.com/andersonmattiasa-prog/anderson-on-allowance (`main` branch) |
| Hosting | Vercel project `anderson-on-allowance` (account `andersonmattiasa-7304`), functions in **Frankfurt (fra1)** |
| Database | Upstash Redis `allowance-db` via the Vercel Marketplace, Frankfurt |
| Claude Code cloud environment | `anderson-on-allowance` (has the repo, a saved Vercel token, and network access to Vercel, Yahoo Finance and frankfurter.dev) |

To continue work: start a Claude Code session on the `anderson-on-allowance` environment with this repo, and point it at this file.

---

## 1. Why it exists

Mattias is a Canadian on a paid internship in Belgium (paid in euros via **Wise**) who also uses Canadian credit cards and has Canadian investments. Goals, in his words:

- Know how much I spend each month and where it goes
- Find what to cut back on and follow my budget
- Invest part of every paycheck (15%)
- Stay in the green every day
- Save for a home down payment

He wants it on his phone, private (no bank aggregator, no AI reading transactions), and low-effort: Apple Pay feeds it automatically, and one **monthly check-in** is the only manual step.

## 2. How data gets in

1. **Apple Pay (main source):** an iPhone Shortcuts automation ("When Mastercard and 2 more is tapped", Run Immediately) → *Get Contents of URL*, POST to `/api/ingest/applepay`, header `Authorization: Bearer <sync key>`, JSON body `merchant` = Merchant, `amount` = Amount, `card` = Card or Pass (Shortcut Input with Type = Transaction). Set up and verified on 14 Nov.
2. **CSV import** (Activity → Import): Wise, Scotiabank, Coast Capital. Duplicates and already-synced purchases are matched, not doubled.
3. **+ Add** for cash or one-offs, with a Trip field ("New trip…").
4. Optional: Gmail Apps Script for Scotiabank alert emails (Settings shows a ready script). Coast alerts go to a Shaw address that can't be changed, so they aren't forwarded; Apple Pay covers them.
5. Optional: Wise webhook for deposits.

## 3. What the app shows (current)

- **Home:** My goals (written goals + home down-payment progress) → **Your daily net** (free to spend today − spent today, green/red, encouraging message, week bars, green days, month total, expandable breakdown) → monthly check-in countdown → everyday spending this month (rent & bills and trips on their own lines), left to spend, per day → weekly allowance → streaks & challenges → insight, areas to watch, top places, 6-month everyday trend, recent.
- **Activity:** purchases shown as plain amounts (money in is +green), "€X spent" per day, search, filters, ↻ refresh, import, add/edit (category with learned rules, trip, note).
- **Budget:** monthly plan (pay − invest − fixed = everyday budget, weekly allowance — the owner likes this card), category rows "Spent · Monthly limit · € left" with a month-pace marker, fixed costs, bills auto-posted on their day, recurring payments found, ↻ refresh.
- **Insights:** where money went vs. usual by this date, ideas to cut back, trips (auto-detected; dates optional), category trends, top places, biggest purchases, weekday spending, achievements, monthly check-in history.
- **Invest (CAD):** net worth, performance 1D–5Y chart (Yahoo prices, tickers only), 15% plan with "+ Log", My goals editor, savings targets (home down payment CA$138,000 from all investments), projection, holdings.
- **Monthly check-in:** opens on the last day of each month (open until the 5th): over/under budget, invested vs target, what changed, "did last month's change stick?", reflection + one change, and **Update investment values**. Notification on the day; reminder on the 1st–3rd.
- **Notifications (Web Push, daily 07:00 UTC cron):** card due (skips autopay), allowance 80%/100% right after an Apple Pay purchase, Monday allowance, Sunday recap, monthly check-in, challenges.

## 4. Key rules and numbers

- Pay €1,468/month; invest 15% (€220.20); rent €790 to Cohabs (bill auto-posted on the 1st); subscriptions €20 and phone €15 are placeholder budgets.
- **Daily net:** free to spend per day = (pay − investing − fixed costs) ÷ days in month ≈ €48.93 − €7.34 − €27.50 = **€14.09**; minus that day's everyday spending. The original app didn't subtract investing (€21.43/day); the owner hasn't decided whether to switch back.
- **Trips** count in the month's total and "left to spend" but **not** in daily net, weekly allowance or everyday spending. Prague (CA$600, booked Nov 2026) is to be entered by the owner via + Add with Trip = New trip "Prague".
- Paris trip (from the original app): €1,562 / CA$2,454.
- Accounts: Wise (EUR), Scotiabank Passport Visa (CAD, due 12th), Coast Capital Mastercard (CAD, due 3rd, autopay), Coast chequing, Cash, Wealthsimple TFSA, Odlum Brown.
- Investments ≈ CA$77k: Odlum Brown (BEPC.TO, BMO.TO, CVE.TO, CVX, FLNC, FTS.TO, NTR.TO, GM, RBF554 fund, cash) and a managed Wealthsimple TFSA — **share counts and values still to be entered** at the first check-in.

## 5. Privacy and security

- Passphrase → PBKDF2-SHA256 (600k) → AES-GCM vault key + auth token (server stores only its hash). No recovery.
- Server stores only ciphertext. Incoming purchases are sealed with the vault's RSA-OAEP public key on arrival.
- Plaintext kept for reminders only: weekly allowance and this week's total, card due days, active challenge name, which month needs a check-in. Apple Pay amounts are read at arrival only for the allowance warning.
- "Keep me unlocked for 30 days" stores a non-extractable key on the device.
- Production env vars on Vercel: `KV_REST_API_*` (Upstash), `SETUP_CODE` (used once), `VAPID_*`, `CRON_SECRET`.

## 6. Deploying changes

Vercel's GitHub app isn't installed, so pushes don't auto-deploy. From a Claude Code session on the `anderson-on-allowance` environment:

```bash
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt vercel deploy --prod --yes --token proxyinjected --scope team_hCNGaMvhY6wo9u67F1zzFrQG
```

The real token is injected by the environment's network proxy. If the token was revoked, create a new one at vercel.com/account/tokens and save it as the environment's credential for `api.vercel.com`. Alternatively install https://github.com/apps/vercel and run `vercel git connect` for auto-deploys.

## 7. History and fixes

- 14 Nov: rebuilt from the original project document (phase 1: vault, PWA, sync, budget; phase 2: trips, invest, net worth, insights, review, streaks, push). Deployed; vault created; Apple Pay automation set up.
- 14 Nov: rebranded to the blue dollar-and-arrow logo; renamed **Anderson Ahead**; lighter blues.
- 15 Nov: Apple Pay "network connection was lost" — server ran in Washington while the database is in Frankfurt; moved functions to fra1 and made the sync reply immediately.
- 15 Nov: everyday spending separated from rent/bills; no minus signs on purchases; clearer budget rows; refresh buttons; written goals (Next trip and Emergency fund removed); daily net card under the goals with breakdown; monthly check-in; trips from + Add, kept out of daily net.

## 8. Ideas not built yet

Cash-flow forecast to payday, dividend tracker, year in review, passphrase change + recovery kit, automatic encrypted backups, "new version available" banner, needs/wants split, second address `anderson-ahead.vercel.app`, shorter Home Screen label ("Ahead") if the name gets cut off.
