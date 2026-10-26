# Backups and restore

No company data is kept in this repository. Everything a company uploads lives in the Supabase project (database rows,
and source files in the private `imports` storage bucket).

## What is backed up

| What | Where | How often | Kept |
|---|---|---|---|
| Database (all tables, functions, policies) | Supabase daily backups | Daily | 7 days on Pro (see the Supabase dashboard, Database, Backups) |
| Database, to the minute | Point-in-time recovery (PITR), paid add-on | Continuous | As configured; **not on until the owner turns it on** |
| Uploaded source files (`imports` bucket) | Supabase Storage | Not in the database backups | Re-uploadable from the company's own Odoo exports |
| Code | GitHub, one tag per production push (`vYYYY.MM.DD-<sha7>`) | Every release | Permanent |
| Secrets (`ENCRYPTION_KEY(S)`, Supabase keys, `ANTHROPIC_API_KEY`, `SENTRY_DSN`) | Vercel environment variables, and the owner's password manager | When changed | Owner's copy is the backup |

Losing `ENCRYPTION_KEY` (or the key ids in `ENCRYPTION_KEYS`) only loses the saved Odoo API keys: each company's admin
enters its key again. All figures are unaffected.

## Restore the database to a new project

1. Supabase dashboard, Database, Backups: restore the chosen daily backup (or PITR time) **into a new project**, never over
   the live one, unless the live one is lost.
2. Check the new project read-only:
   - `select public.schema_version();` equals the version in `src/lib/schema.ts` (`REQUIRED_SCHEMA`);
   - row counts of `organizations`, `companies`, `account_balances`, `sales_lines`, `expense_lines` look right;
   - the cron jobs exist and are active: `select jobname, active from cron.job;`.
3. Point Vercel at it: change `NEXT_PUBLIC_SUPABASE_URL` and the publishable key, redeploy.
4. Open `/api/health`: it must answer `200` with `"ok": true`.
5. Uploaded files are not in the database backup. Companies whose files are needed again re-upload them.

## Restore drill (local, recorded)

Run on the local stack (`bash scripts/local-supabase/start.sh`), against the test database filled by every database
test (`supabase/tests`):

```
pg_dump -Fc -d postgres://postgres@127.0.0.1:54322/one_t -f drill.dump
createdb drill && pg_restore -d postgres://postgres@127.0.0.1:54322/drill --no-owner drill.dump
```

Result on 26 Oct 2026 (schema 40): dump 3.7 MB; restore with 0 errors; all 51 tables in `public` and `private` have the
same row counts as the source; 164 functions and 125 row-security policies, the same as the source;
`schema_version()` = 40.

Repeat the drill after each migration that adds tables, and at least every quarter.
