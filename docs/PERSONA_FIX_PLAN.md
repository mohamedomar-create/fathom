# Fix plan: issues found by the 50-persona test run

Source: `docs/PERSONA_TEST_ISSUES.md`, from a run on 21 Oct of 50 personas and 243 steps. The run used a disposable local stack: a fresh database, the production build, the live time limits and made-up companies.

**Triage.** The run reported 62 browser issues, 14 kinds of server-log line and 1 kind of database error. Each was checked against the code, the screenshots and a re-run of the personas concerned:

- **Real problems:** 12, numbered F1–F12 below.
- **Not problems:** the rest. Each is listed at the end with the reason, so nothing is dropped silently.
- **Critical:** none. No wrong figures, no data shown across companies, no data lost:
  - the outsider, viewer, removed-member, deleted-company and double-upload personas all behaved correctly;
  - no rows were half-saved after an abandoned upload;
  - a re-upload of the same file changed nothing.

All fixes are app-only. **No database migration is needed.**

## Order of work

| # | Priority | Problem | Seen by |
|---|---|---|---|
| F1 | P1 | A malformed company address gives a server error (500) instead of "not found" | P07 |
| F2 | P1 | People and Organisation pages crash (500) for a user who isn't an organisation admin | P38 |
| F3 | P1 | Saving after the session expired shows "unexpected response" and an error screen, not "sign in again" | P41 |
| F4 | P2 | Double-clicking **Create report** makes two reports | P23 |
| F5 | P2 | Reports cannot be deleted: the server action exists, but no button calls it | P27 |
| F6 | P3 | The accounts upload summary says "Rows checked: 0 to import · 0 skipped" for a file full of data | P20, P30 |
| F7 | P3 | Bar labels run off the page when a list has negative values (refunds) | P15, P37, P46 |
| F8 | P3 | AI commentary that isn't configured returns 502 (bad gateway) instead of 503 (not available) | P34 |
| F9 | P4 | Financial pages are slow: 1.3–2.3 s for one user on small data, 3.6–5.8 s (p95) with four at once, up to 8.6 s during rapid clicking | 25 personas |
| F10 | P5 | Muted text below the 3:1 contrast minimum (Data steps, Readiness, Profile headings) | P47 |
| F11 | P5 | Arabic mode: the Data and Company profile headings stay in English | P04 |
| F12 | P5 | The sign-in form shows no visible focus ring for keyboard users | P05 |

## The fixes

Every fix starts with a test that fails first, as in the rest of the project.

### F1. Malformed company address → 404, not 500

- **What happens:** `/company/not-a-uuid/summary` returns HTTP 500. The server log says "The membership could not be checked", and the database logs `invalid input syntax for type uuid`.
- **Cause:** since access became fail-closed, the membership query is sent with the raw path segment. Postgres rejects it with 22P02, and `accessFrom` treats every query error as "could not check" and throws.
- **Fix:** check the id is a UUID before any query, in `loadCompanyMeta` and `loadCompanyBundle` (`src/lib/company/meta.ts`, `load.ts`), and call `notFound()` when it isn't. Use the same `Uuid` zod schema the server actions already use (`src/app/company/[id]/reports/actions.ts`). Apply the same check to `reports/[rid]` and `/r/[token]`.
- **Tests:**
  - **unit:** the guard returns "not found" for `not-a-uuid`, `""` and an over-long string, and passes a real UUID through;
  - **e2e:** `/company/not-a-uuid/summary` and `/company/:id/reports/not-a-uuid` both return 404.

### F2. Admin pages for non-admins

- **What happens:** an invited editor who opens `/admin/people` gets HTTP 500, "Cannot read properties of null (reading 'org_id')".
- **Cause:** `src/app/admin/people/page.tsx:7-8` and `src/app/admin/organisation/page.tsx:8-12` look for the user's admin membership and dereference it with `m!`. A user who is admin of no organisation has none.
- **Fix:** when there is no admin membership, render a short page instead of crashing: "Only an organisation admin can manage people. Ask {admin} to invite or change roles." Hide the People and Organisation links in the user menu for such users.
- **Test (e2e):** an invited editor opens `/admin/people` and `/admin/organisation` and gets 200 with that message. The links are not in their menu.

### F3. Expired session while saving

- **What happens:** with the session gone, **Save profile** logs "An unexpected response was received from the server" and the section error screen appears. Nothing tells the user to sign in again.
- **Cause:** `src/proxy.ts:24-28` redirects every signed-out request to `/login`, server-action POSTs included. The action client then receives an HTML page instead of an action result.
- **Fix:**
  - **in the proxy:** requests that carry the `Next-Action` header, and `/api/*` requests, are let through instead of redirected;
  - **in the actions:** each action's "no user" branch returns one shared result, `{ error: "Your session has ended. Sign in again.", signIn: true }`, from a helper in `src/lib/auth`;
  - **on the client:** a shared hook shows that error with a **Sign in** link to `/login?next=<current page>`.
  - Page navigations still redirect, as now.
- **Tests:**
  - **unit:** the proxy's decision function returns "pass" for an action POST or `/api`, and "redirect" for a page GET;
  - **e2e:** clear the cookies, press **Save profile**, and the "Sign in again" message appears with a working link that returns to the same page.

### F4. Create report twice

- **What happens:** a double-click on **Create report** made 2 reports.
- **Fix:** the button disables itself while the action runs (`useTransition`, the pattern used by `save-kpis`).
- **Test (e2e):** double-click, and there is exactly one report row.

### F5. Deleting a report

- **What happens:** there is no way to delete a report. `deleteReport` in `src/app/company/[id]/reports/actions.ts:72` has no caller.
- **Fix:** add a **Delete report** button on the report editor (editors and admins only), using the existing `ConfirmDialog`, which names the report. After deleting, go back to the Reports list. A published report's public link stops working.
- **Tests (e2e):**
  - an editor deletes a report: it is gone from the list and its `/r/` link returns 404;
  - a viewer sees no Delete button.

### F6. "0 to import" on accounts uploads

- **What happens:** the **Before you confirm** box on an accounts upload says "Rows checked: 0 to import · 0 skipped", even when the file holds 14 months of accounts.
- **Cause:** `src/components/preflight/summary.tsx:27` shows preflight row counts. The accounts path never fills them, because accounts files are read by the statement readers, not preflight.
- **Fix:** for accounts uploads, show "N accounts × M months" from the plan instead. Hide the rows line when there are no preflight counts.
- **Test:** a unit test for the summary's text in both cases. The e2e check on the existing import flow reads the new line.

### F7. Bar labels off the page

- **What happens:** the page is wider than the screen by 14–30 px on Sales and Customers (desktop) and at 320 px wide.
- **Cause:** `src/components/charts/bar-list.tsx:39` keeps the value label inside the box for positive-only lists (`min(... , 100% - 70px)`). The branch for lists with negatives (refunds) has no such limit.
- **Fix:** clamp both sides the same way. When a bar is long, put the label inside it.
- **Tests:**
  - **unit:** the render helper's label position for a −100% and a +100% bar stays within 0–100%;
  - **e2e:** the crawl's page-width check on `/sales` with a refund, at 1440 px and 320 px.

### F8. AI not configured → 503

- **What happens:** with no API key, the commentary API answers 502 (bad gateway).
- **Fix:** add a `CommentaryError` kind "not configured". The route maps it to 503, while real upstream failures stay 502. Text unchanged.
- **Test:** a unit test on the route's status mapping.

### F9. Page speed

- **What was measured:**

  | Situation | Time |
  |---|---|
  | One user, small data | 1.3–2.3 s per financial page, including about 0.5 s waiting for the network to go quiet |
  | Four users at once | p95 3.6–5.8 s |
  | Rapid clicking | up to 8.6 s |
  | Create company, under the same load | once more than 10 s |

  The local server is one Node process on 4 CPUs. Vercel runs pages on more instances, so the absolute numbers here overstate production. The relative cost is real all the same.
- **Plan:**
  1. **Measure first.** Add server timing to the company layout and to one financial page, on the existing `logOp`: meta, bundle, balances, engine and render, each in ms. Then run P12 alone and P45 (the burst) to see where the time goes.
  2. **Likely causes, to confirm before changing anything:**
     - the bundle is loaded by the layout and again by pages that need the same data (check the `cache()` wrappers in `load.ts`);
     - the engine rebuilds every month's statements on each page, where only one period is shown;
     - client-side recomputation after hydration (`useMemo` on the whole `months` array).
  3. **Fix only what the measurement shows:**
     - one per-request load;
     - an in-memory computed bundle keyed by company + data version, the pattern of `summary-cache.ts`;
     - lighter client props.
- **Targets:**
  - one user: under 1 s server time per financial page;
  - four at once: p95 under 2.5 s;
  - creating a company: under 2 s.
- **Proof:** `speed.spec.ts` before and after, plus P12 and P45 re-run.
- **Production:** live timings must be checked on aql360.com itself, which this session cannot reach.

### F10. Contrast

- **What happens:** muted labels in the light theme fall below 3:1:
  - Data steps (Trial Balance, Sales detail, Stock);
  - "Data readiness" on the summary page;
  - headings on the Profile page.

  The app has no dark theme, so the dark-mode persona measured the light one; there is nothing to fix for dark mode itself.
- **Fix:** darken the `text-mute` token so it reaches 4.5:1 on white and on `bg-band`, and check the locked-step style.
- **Test:** the P47 contrast check becomes a regular e2e check on these four pages.

### F11. Arabic headings

- **What happens:** in Arabic, the Data page and Company profile still show English headings ("Data", "Company Profile").
- **Fix:** move those page headers and their subtitles into the `src/lib/i18n` areas. This is part of the pending Arabic step R12-4.
- **Test:** P04 re-run shows no English headings on these pages.

### F12. Focus ring

- **What happens:** on the sign-in form, the focused element has no visible outline.
- **Fix:** add one `:focus-visible` outline rule in `src/app/globals.css` for links, buttons and inputs, in the brand colour with a 2 px offset.
- **Test:** P05 re-run, and a unit-free e2e check that the focused input's outline style isn't `none`.

## Not problems (with the reason)

| Report items | Why it is not a problem |
|---|---|
| B1: five journeys "still running after 240 s" | Test-script fault: it waited for buttons that are correctly absent or disabled. The same file twice shows "Nothing new to add"; a 10-month trial balance needs **Save anyway** with a reason; Targets has nothing to save until something changes. P37 and P50 passed when re-run alone, so their timeouts were load. The script now gives up on an action after 15 s. |
| B6: P50 "create company" took over 10 s | Under the 4-person load; folded into F9 |
| B7–B42: slow pages | One root cause: F9 |
| B20, B32, B33, B44–B47: 404s | Deliberate: tampered addresses and a deleted company's links. 404 is correct. |
| B52: "Failed to fetch RSC payload" | The offline persona; expected while offline, and the app recovered when back online |
| B59: "No personal data export button" | It exists, as a link (`export-me` on `/account`); the script looked for a button |
| S6–S14: `summary_state` "empty" / "pending" | Designed states: empty means nothing uploaded yet; pending computes live once. The report script no longer lists them. |
| B4 (part) | No API key on the local stack, so commentary can't run here; the status code is F8 |

## How the work is done and proven

1. **Branch:** one branch, `claude/persona-fixes`, cut from the current production branch. Commit order is F1 → F12, each fix with its failing test first.
2. **Each fix:**
   - typecheck, lint and unit tests;
   - the signed-in e2e tests it touches.
3. **After all twelve:**
   - the full suites: unit, database, public e2e (desktop and mobile), signed-in e2e and speed;
   - the guard scan.
4. **Re-run all 50 personas** (`bash scripts/personas/run.sh`). Expected:
   - F1–F8 and F10–F12 gone from the report;
   - F9's p95 within target;
   - no new issues.

   The new report replaces `docs/PERSONA_TEST_ISSUES.md`, and the before/after numbers go into this file.
5. **Release:** app only, no migrations. With your approval, fast-forward the production branch after CI is green, and confirm the Vercel deployment.

**Test script fixes made during triage, already done:**

- a 15 s per-action limit;
- personas run in parallel;
- expected 4xx lines are ignored for personas that tamper on purpose;
- designed summary states are not reported.

**Still to do for the script:** let a step say which 404s it expects, and tell a disabled button apart from a missing one.

## Results (21 Oct, branch `claude/persona-fixes`)

All 50 personas were run again after the fixes, on the same disposable local stack and the same machine.

| | First run | After F1–F8, F11, F12 | After F9 too |
|---|---|---|---|
| Browser issues: critical / high | 0 / 6 | 0 / 2 | **0 / 0** |
| Server-log problem lines | 251 (2 crashes) | 0 | **0** |
| Database-log errors | 1 | 0 | **0** |
| Page load: median / p95 | 2.27 s / 4.94 s | 2.88 s / 6.22 s | **1.34 s / 2.60 s** |
| Company loads (`company_bundle`) for the run | not logged | 2,549 | **766** |
| Run time for 50 personas | 12 min | 9 min | **5 min** |

| # | Status | Fix | Proof |
|---|---|---|---|
| F1 | Fixed | `src/lib/ids.ts`. The proxy (`malformedId`) answers 404 before any query, and the loaders check the id too. | e2e F1; unit `ids`, `proxy` |
| F2 | Fixed | The admin layout explains to non-admins; pages no longer assume an admin membership. EN and AR. | e2e F2 |
| F3 | Fixed | The proxy never redirects server actions or `/api` (`keepsOwnAnswer`). `SessionWatch` shows "Your session has ended … Sign in again", linking back to the same page. | e2e F3; unit `proxy` (session cookie) |
| F4 | Fixed | `SubmitOnce` ignores a second press, and the server opens the report just made if pressed again within 10 s. | e2e F4 |
| F5 | Fixed | A **Delete** button on the report editor, editors only. A confirm dialog, then the share link stops working. | e2e F5 (the link returns 404 afterwards) |
| F6 | Fixed | The accounts summary reads "N accounts × M months". | e2e F6; unit `preflight-summary` |
| F7 | Fixed | Bar labels are clamped on both sides (`labelStyle`). | e2e F7 at 1440 and 320 px; unit `bar-list` |
| F8 | Fixed | AI that isn't set up returns 503; a failure of the AI service stays 502. | unit `commentary-status` |
| F9 | Fixed | Cause: every visible link in the section rail and Data tabs prefetched, and each prefetch re-ran the whole company load. That was 7–11 loads per page view; now 1–3. The page title also reuses the same load. | Measured: one user, server answer about 0.35 s and page ready about 0.5 s; persona numbers above |
| F10 | Not an app fault | The app is light-only (`color-scheme: light`), and the flagged text is #222 on white. The test misread modern CSS colours; it now converts them through a canvas. P47 re-run: no issues. | P47 |
| F11 | Fixed | The Data section header and tabs, plus the settings headings, now come from the dictionaries, in company and demo pages. | e2e F11; P04 re-run: no issues |
| F12 | Fixed | One `:focus-visible` ring for every control. Inputs previously had only a 1 px border change. | e2e F12; P05 re-run: no issues |

**Still in the report, and expected:**

- the deliberate 404s (tampered and deleted addresses);
- the offline persona's failed fetch;
- three test-script steps that expect a button the app correctly withholds:
  - the same file again gives "Nothing new to add";
  - a 10-month trial balance needs **Save anyway**;
  - Targets has nothing to save until something changes.

**Test script hardening done during the work:**

- a 15 s per-action limit;
- personas run in parallel;
- colours read through a canvas;
- the focus check stops at the page's end;
- the run refuses a build that points at the live project.

**Not tested from here:** aql360.com itself (not reachable from this session). Production timings should be checked after release.
