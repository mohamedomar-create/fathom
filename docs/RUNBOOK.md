# Runbook

For the site owner and whoever is on call. No secrets or company data belong in this file.

## Releases

- Work happens on a branch; CI (`.github/workflows/ci.yml`) must be green.
- A database change is one numbered file in `supabase/migrations/`. The owner pastes it into the Supabase SQL editor,
  then the app is released. Each migration raises `public.schema_version()`; the app needs the version in
  `src/lib/schema.ts`. If the app runs ahead of the database, its pages show "The database needs an update" and
  `/api/health` answers 503: paste the missing migration.
- Before pasting, pause the background jobs, then turn them back on:
  `select cron.alter_job(jobid, active := false) from cron.job where jobname like 'ireport-%';` (and `active := true`).
- Release: fast-forward the production branch `claude/sharp-pasteur-ms9hn6` to the tested commit. Vercel deploys it;
  `.github/workflows/release.yml` tags it `vYYYY.MM.DD-<sha7>` with notes once CI has passed on it.
- After a release: CI green on the production branch, Vercel shows "Deployment has completed", `/api/health` is 200,
  and the Supabase logs show no new 500s or refusals from normal use.

## Rollback

- App: `git push --force-with-lease origin <previous tag or commit>:claude/sharp-pasteur-ms9hn6`. Vercel redeploys.
- Migrations only add or replace; they are not rolled back. An older app on a newer database still runs, except where a
  release note says otherwise.

## Health and alerts

- `GET /api/health`: `{ok, db, schema, required, commit, time}`; 200 when the database answers at the right version,
  503 otherwise. No sign-in, no data.
- Uptime monitor (e.g. UptimeRobot, free): an HTTP(s) check on `https://<site>/api/health` every 5 minutes, alert on
  anything but 200, to the owner's email.
- Errors: set `SENTRY_DSN` in Vercel to send server errors to Sentry. Reports carry the reference shown to the person,
  never emails, amounts, cookies or query strings (`src/lib/report-error.ts`). In Sentry, alert on new issues.
- Logs: Vercel, Logs (search `outcome=failed` or a reference code); Supabase, Logs (Postgres and API).

## Keys

- **Encryption key rotation** (saved Odoo API keys):
  1. Make a new key: `openssl rand -base64 32`.
  2. In Vercel set `ENCRYPTION_KEYS` to `k2:<new>,k1:<old>` (the first is used for new values; keep `ENCRYPTION_KEY` as it
     is, it is key `k1`). Redeploy.
  3. Each company with a saved key shows "Re-encrypt the key" on Data, Odoo live to its admins; press it once per
     company.
  4. Check none is left (read-only, in the SQL editor; `k2` is the new key's id):
     `select company_id from public.odoo_connections where api_key_enc <> '' and api_key_enc not like 'v3.k2.%';`
     Every company listed still needs an admin to press "Re-encrypt the key" (or to enter its API key again).
  5. When the list is empty, remove the old key from `ENCRYPTION_KEYS` (and `ENCRYPTION_KEY`). Redeploy.
  Key ids are lowercase letters and digits (`k2`, not `K2`).
- **Odoo API key**: made in Odoo by the read-only "iReport Reader" user, with an end date; the Odoo tab warns 14 days
  before it ends. Revoke it in Odoo at once if it may have leaked; then Disconnect in iReport.
- **Anthropic**: set a monthly spend limit in the Anthropic console: it is the cap for the whole site. Inside iReport each
  organisation has an AI allowance (default 20 US$ a month; the owner changes it on Organisation), counted from what
  each reply really used.
- **Supabase and Vercel**: two-step sign-in on, and a second admin with two-step sign-in, so one lost phone cannot lock
  the site.

## Two-step sign-in

- Admins must turn it on within 7 days of joining (Account, Two-step sign-in).
- A member who lost their phone: the organisation's owner resets it (People, Reset two-step sign-in), if the person
  belongs to no other organisation.
- The owner lost their own phone: in the Supabase dashboard, Authentication, Users, open the user and delete their
  factor; they set it up again at the next sign-in.

## Deleting and bringing back

- A deleted company or organisation is hidden at once and listed under Organisation, Recently deleted for 14 days;
  `private.purge_deleted()` removes it for good after that (cron `ireport-purge-deleted`, daily). Uploaded files are
  removed at deletion.
- A deleted account is removed at once (it cannot be brought back).

## Branch protection (set in GitHub by the owner)

Settings, Branches, add a rule for `claude/sharp-pasteur-ms9hn6`: require the CI checks to pass, block force pushes
except for the owner (who uses them only to roll back).

## Incident checklist

1. What is broken, for whom, since when: `/api/health`, Vercel and Supabase logs, Sentry.
2. If a release caused it: roll back the app (above).
3. If data looks wrong: do not change it by hand; take a backup first, then find the cause.
4. If a secret may have leaked: rotate it (above) and revoke the old one where it was issued.
5. Write down what happened, the cause and the fix.
