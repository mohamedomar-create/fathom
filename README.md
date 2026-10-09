# Ledgerlens

Advisory-grade financial analytics for companies running **Odoo**. Upload an Odoo export or connect Odoo directly and get:

- **Executive Summary** with rule-based findings (risks, watch items, wins) and optional AI commentary (Claude)
- **KPIs** against targets (25 standard + library KPIs), alerts, KPI detail with 12-month history
- **KPI Explorer**, **Profitability / breakeven**, **Cash-flow waterfall**, **Growth quadrant**, **Trend explorer**, **Goalseek**, **Financials** (P&L, Balance Sheet, indirect Cash Flow Statement) — by month, quarter or financial year
- **Insights Dashboard** across all client companies
- **Branded reports**: A4 PDF (sandboxed headless Chromium, embedded Arabic font) or a private share link
- Multi-tenant: organisations → companies, roles (admin / editor / viewer), invitations, Supabase row-level security

The product name is one constant in `src/lib/brand.ts`.

## Try it without an account
- `/demo/summary` — a fully loaded demo company (all analysis pages, settings in read-only mode, report builder with PDF export)
- `/demo/settings/source-data` — test the Odoo importer with your own file; it is read in the browser and nothing is uploaded

## Getting data in
| Route | Best for | Notes |
|---|---|---|
| **Trial Balance** export (monthly comparison, Debit/Credit per month + Initial Balance) | Most accurate upload | Opening balances included |
| **Profit and Loss + Balance Sheet** exports with monthly columns | Quick start | Subtotals, budget/variance columns and YTD columns handled automatically |
| **Journal Items** export (Account, Date, Debit, Credit) | Full history | Balance sheet built from movements |
| **Live Odoo connection** (JSON-RPC, API key) | Ongoing monthly sync | Odoo 15–18 via `read_group`, Odoo 19 via `search_read` fallback; read-only, posted entries only |

Odoo never closes P&L accounts into equity, so earnings to date are carried into retained earnings automatically. Every judgement (sign flips, YTD conversion, closing earnings, plugs) is disclosed on the report's Basis of Preparation page.

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind v4 · Supabase (Auth, Postgres + RLS) · custom SVG charts · SheetJS (`@e965/xlsx`) · Claude API (`claude-opus-5-5`, structured output, server-side refusal fallback) · `puppeteer-core` + `@sparticuz/chromium` for PDF.

```
src/lib/engine     calculation engine (ported 1:1 from reference/build_report.py, parity-tested)
src/lib/ingest     Odoo export parsing, account classification (EN/AR), sign/YTD/earnings handling
src/lib/odoo       JSON-RPC client, sync, SSRF guard
src/lib/company    account storage ↔ monthly statements, loaders, persistence
src/lib/ai         commentary context + Claude call
src/components     shell, charts, analysis pages, settings, report
supabase/          SQL migrations (applied to project iszcsjgwbsulwmnyokpd)
tests/             unit (engine parity, ingest fixtures, Odoo mocks), e2e (Playwright), SQL (RLS isolation)
```

## Local development
```bash
npm install
cp .env.example .env.local
npm run dev
```
| Command | What it does |
|---|---|
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm test` | Unit tests: engine parity with the Python reference on every sample month, blueprint acceptance numbers, ingest of every Odoo export format, Odoo v15/17/18/19 mocks |
| `npm run build && npm run e2e` | Playwright end-to-end tests (desktop + mobile) against the demo |
| `node scripts/embed-fonts.mjs` | Regenerate the embedded report fonts |

## Deploying to Vercel
1. Vercel → **Add New → Project → Import** `mohamedomar-create/fathom`.
2. Environment variables (Production and Preview):
   | Name | Value | Required |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://iszcsjgwbsulwmnyokpd.supabase.co` | yes (defaults built in) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key in `.env.example` | yes (defaults built in) |
   | `ENCRYPTION_KEY` | `openssl rand -base64 32` | for Odoo live sync |
   | `ANTHROPIC_API_KEY` | your Claude API key | for "Write with AI" |
3. Supabase → Authentication → URL Configuration: Site URL = your Vercel domain; add `https://<domain>/auth/callback` to Redirect URLs.
4. Supabase → Authentication → Emails: configure custom SMTP, or turn off "Confirm email" — the built-in mailer only sends a few emails per hour.
5. Smoke checks after deploy: `/api/pdf-smoke` downloads a PDF; `/demo/reports` → Download PDF works; sign up → Add company → Demo company.

## Security notes
- Row-level security on every table; membership helpers live in a non-exposed `private` schema. `tests/sql/rls_isolation.sql` proves cross-organisation isolation (runs in a rolled-back transaction).
- Public reports are served only through the `get_published_report(token)` RPC (192-bit random tokens).
- Odoo API keys are AES-256-GCM encrypted; Odoo URLs resolving to private networks are refused.
- PDF rendering runs with JavaScript disabled and all network requests blocked.
