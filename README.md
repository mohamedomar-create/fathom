# Ledgerlens

Advisory-grade financial analytics for companies running **Odoo**: KPIs against targets, KPI Explorer, breakeven,
cash-flow waterfall, growth quadrant, trends, goalseek, full financial statements, an executive summary with
rule-based and AI commentary, a portfolio dashboard and branded PDF reports.

> The product name lives in `src/lib/brand.ts` (`APP_NAME`).

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind v4 · Supabase (Auth, Postgres + RLS, Storage) · custom SVG charts ·
SheetJS (`@e965/xlsx`) · Claude API · headless Chromium (`@sparticuz/chromium`) for PDF.

## Local development
```bash
npm install
cp .env.example .env.local   # fill in ANTHROPIC_API_KEY / ENCRYPTION_KEY if you want AI + Odoo live sync
npm run dev
```

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (engine parity with the Python reference, ingest fixtures, Odoo mocks) |
| `npm run build` | Production build |
| `npm run e2e` | Playwright end-to-end tests against `npm run start` |

## Deploying to Vercel
1. Vercel → **Add New → Project → Import** `mohamedomar-create/fathom`. Framework is detected automatically.
2. Environment variables:
   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://iszcsjgwbsulwmnyokpd.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key (see `.env.example`) |
   | `ANTHROPIC_API_KEY` | your Claude API key (optional, enables "Write with AI") |
   | `ENCRYPTION_KEY` | output of `openssl rand -base64 32` (required for Odoo live sync) |
3. Supabase → Authentication → URL Configuration: set **Site URL** to your Vercel domain and add
   `https://<your-domain>/auth/callback` to Redirect URLs. Configure custom SMTP (or turn off "Confirm email")
   because Supabase's built-in mailer is limited to a few emails per hour.
4. After deploying, open `/api/pdf-smoke` — it should download a one-page PDF. That proves the PDF engine runs.

## Reference material
`reference/` holds the specification and the Python engine this app was ported from. They are used by the
parity tests and are not part of the build.
