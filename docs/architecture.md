# Architecture (as deployed)

- **App:** Next.js 16 (App Router, React Server Components, server actions) on Vercel. Production branch
  `claude/sharp-pasteur-ms9hn6`; every push runs CI (`.github/workflows/ci.yml`) and a release tag on production.
- **Data:** Supabase Postgres with row-level security on every table, security-definer functions with an empty
  `search_path`, pg_cron background jobs, a private storage bucket for import files. Migrations in `supabase/migrations`
  are pasted by the owner and checked read-only afterwards; `public.schema_version()` must match `REQUIRED_SCHEMA`
  (`src/lib/schema.ts`).
- **Flow of a file** (reference §6.1):
  1. Upload in the browser: parsed in a web worker (`src/lib/imports/import.worker.ts`), large files sent resumably to
     storage; nothing heavy on the page's thread.
  2. Profiling and preflight (`src/lib/preflight`): sheets, header rows, merged cells, formulas, totals, mixed columns;
     each issue is info, fix or block.
  3. Recognition and mapping: readers per source (`src/lib/ingest/*`), remembered layouts (`input_profiles`, 0018) and the
     company's account map (`account_map`, 0017).
  4. Checks (`src/lib/company/checks.ts`, review rules): debits = credits, balance sheet balances, roll-forward, the
     file's own totals; blocking checks stop the save unless accepted with a reason.
  5. Saving: versioned balances (`save_company_version`), staged line batches (0035), background stock jobs (0014).
  6. Engine (`src/lib/engine`): statements, KPIs, cash flow, forecast, inventory, sales, expenses, payments, bank,
     plan, valuation; pure functions over stored classes.
  7. Pages and reports; AI only explains, and every figure it writes is checked against the facts given
     (`src/lib/ai/verify.ts`).
- **Live connector:** Odoo JSON-RPC, read-only (`src/lib/odoo`), keys encrypted, nightly sync (0046/0047).
- **Access:** organisation roles plus a role per company (`private.company_can`, 0057/0058); two-step sign-in for
  admins; month close locks (0043); audit tables.
