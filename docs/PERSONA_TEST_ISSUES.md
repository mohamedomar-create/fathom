# Persona test run: issues to address

Run on 2026-10-21 20:24 UTC against a disposable local stack (fresh database, production build, the live database's time limits). Made-up companies and files only; nothing touched production.

- **Personas:** 50 · **steps:** 254 (3 failed or skipped) · **page loads timed:** 281 · **run time:** 5 min
- **Distinct issues (browser):** 18: 0 critical, 0 high, 15 medium, 3 low
- **Server log:** 0 problem lines in 0 kinds · **database log:** 0 errors/warnings in 0 kinds
- **Page load times:** median 1.34 s, p95 2.60 s, slowest 3.5 s

Severity: **critical** = wrong figures, data leak or data loss; **high** = crash, server error, security gap or a broken journey; **medium** = confusing, slow or partly broken; **low** = polish.

Each issue is a lead, not a verdict: some are expected behaviour or test-harness assumptions. Check each before fixing it.

## 1. Issues found by the personas

| # | Severity | Kind | Issue | Personas | Hits |
|---|---|---|---|---|---|
| B1 | medium | slow page | /company/:id/summary took N s | 3 | 3 |
| B2 | medium | console error | Failed to load resource: the server responded with a status of N (Not Found) | 2 | 7 |
| B3 | medium | slow page | /demo/summary took N s | 1 | 1 |
| B4 | medium | HTTP 404 | GET /company/not-a-uuid/summary | 1 | 1 |
| B5 | medium | HTTP 404 | GET /company/:id/nope | 1 | 1 |
| B6 | medium | HTTP 404 | GET /r/not-a-token | 1 | 1 |
| B7 | medium | step failed | same accounts file again: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import') | 1 | 1 |
| B8 | medium | step failed | targets, KPIs, alerts: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('save-kpis') | 1 | 1 |
| B9 | medium | HTTP 404 | GET /company/:id/summary | 1 | 1 |
| B10 | medium | HTTP 404 | GET /company/:id/sales | 1 | 1 |
| B11 | medium | HTTP 404 | GET /company/:id/data | 1 | 1 |
| B12 | medium | HTTP 404 | GET /company/:id/reports | 1 | 1 |
| B13 | medium | step failed | two more companies: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import') | 1 | 1 |
| B14 | medium | slow page | /company/:id/sales took N s | 1 | 1 |
| B15 | medium | console error | Failed to fetch RSC payload for http://localhost:N/company/:id/analysis/kpis. Falling back to browser navigation. TypeError: Failed to fetch     at n (http://localhost:N/_next/static/chunks/1gef-u_vq4uxk.js:2:N)     at M | 1 | 1 |
| B16 | low | expectation | Arabic mode: page heading still English on /demo/settings/profile: "Company Profile" | 1 | 1 |
| B17 | low | expectation | Keyboard: the focused element shows no focus ring | 1 | 1 |
| B18 | low | expectation | No personal data export button on /account | 1 | 1 |

### Details

**B1. [medium] slow page: /company/:id/summary took N s**

- Personas: P13 Statements-only owner; P37 Viewer; P47 Dark-mode, reduced-motion user
- P13, step "headline figure", page `/company/:id/summary`: /company/:id/summary took 3.5 s
- P37, step "viewer reads pages", page `/company/:id/summary`: /company/:id/summary took 3.5 s
- P47, step "text is readable in dark mode", page `/company/:id/summary`: /company/:id/summary took 3.3 s

**B2. [medium] console error: Failed to load resource: the server responded with a status of N (Not Found)**

- Personas: P07 URL tamperer; P29 Company deleter
- P07, step "malformed ids and paths", page `/company/not-a-uuid/summary`: Failed to load resource: the server responded with a status of 404 (Not Found)
- P07, step "malformed ids and paths", page `/company/:id/nope`: Failed to load resource: the server responded with a status of 404 (Not Found)
- P07, step "malformed ids and paths", page `/r/not-a-token`: Failed to load resource: the server responded with a status of 404 (Not Found)

**B3. [medium] slow page: /demo/summary took N s**

- Personas: P02 Demo explorer (desktop)
- P02, step "every demo page", page `/demo/summary`: /demo/summary took 3.1 s

**B4. [medium] HTTP 404: GET /company/not-a-uuid/summary**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/:id/data/upload`: GET /company/not-a-uuid/summary

**B5. [medium] HTTP 404: GET /company/:id/nope**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/not-a-uuid/summary`: GET /company/3606be7d-008d-446d-9ba8-c71951e8d311/nope

**B6. [medium] HTTP 404: GET /r/not-a-token**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/:id/reports/:id`: GET /r/not-a-token

**B7. [medium] step failed: same accounts file again: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')**

- Personas: P20 Double uploader
- P20, step "same accounts file again", page `/company/:id/data/upload`, screenshot `test-results/personas/shots/P20-same-accounts-file-again.png`: same accounts file again: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')

**B8. [medium] step failed: targets, KPIs, alerts: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('save-kpis')**

- Personas: P25 Settings tinkerer
- P25, step "targets, KPIs, alerts", page `/company/:id/settings/targets`, screenshot `test-results/personas/shots/P25-targets-KPIs-alerts.png`: targets, KPIs, alerts: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('save-kpis')

**B9. [medium] HTTP 404: GET /company/:id/summary**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/companies`: GET /company/0fa4b669-b171-4129-8ce9-228c7f5baa7b/summary

**B10. [medium] HTTP 404: GET /company/:id/sales**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/company/:id/summary`: GET /company/0fa4b669-b171-4129-8ce9-228c7f5baa7b/sales

**B11. [medium] HTTP 404: GET /company/:id/data**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/company/:id/sales`: GET /company/0fa4b669-b171-4129-8ce9-228c7f5baa7b/data

**B12. [medium] HTTP 404: GET /company/:id/reports**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/company/:id/data`: GET /company/0fa4b669-b171-4129-8ce9-228c7f5baa7b/reports

**B13. [medium] step failed: two more companies: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')**

- Personas: P30 Portfolio manager
- P30, step "two more companies", page `/company/:id/data/upload`, screenshot `test-results/personas/shots/P30-two-more-companies.png`: two more companies: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')

**B14. [medium] slow page: /company/:id/sales took N s**

- Personas: P37 Viewer
- P37, step "viewer reads pages", page `/company/:id/sales`: /company/:id/sales took 3.1 s

**B15. [medium] console error: Failed to fetch RSC payload for http://localhost:N/company/:id/analysis/kpis. Falling back to browser navigation. TypeError: Failed to fetch     at n (http://localhost:N/_next/static/chunks/1gef-u_vq4**

- Personas: P42 Offline user
- P42, step "go offline and click a link", page `/company/:id/summary`: Failed to fetch RSC payload for http://localhost:3100/company/fdade1ef-4772-4921-b08c-bcab13720792/analysis/kpis. Falling back to browser navigation. TypeError: Failed to fetch     at n (http://localhost:3100/_next/static/chunks/1gef-u_vq4uxk.js:2:36290)     at M (http://localhost:3100/_next/static/

**B16. [low] expectation: Arabic mode: page heading still English on /demo/settings/profile: "Company Profile"**

- Personas: P04 Arabic-speaking visitor
- P04, step "Arabic pages read without English leftovers in headings", page `/demo/settings/profile`: Arabic mode: page heading still English on /demo/settings/profile: "Company Profile"

**B17. [low] expectation: Keyboard: the focused element shows no focus ring**

- Personas: P05 Keyboard-only user
- P05, step "tab through the sign-in form": Keyboard: the focused element shows no focus ring

**B18. [low] expectation: No personal data export button on /account**

- Personas: P35 Privacy-minded user
- P35, step "personal data export": No personal data export button on /account

## 2. Server log (Next.js)

No failed operations or errors.

## 3. Database log (Postgres)

No errors or warnings.

## 4. Slowest pages (p95)

| Page | Loads | p50 | p95 | Max |
|---|---|---|---|---|
| `/company/:id/summary` | 28 | 2.28 s | 3.45 s | 3.48 s |
| `/company/:id/sales` | 8 | 2.21 s | 3.14 s | 3.14 s |
| `/demo/summary` | 5 | 2.90 s | 3.06 s | 3.06 s |
| `/company/:id/analysis/forecast` | 3 | 2.18 s | 2.94 s | 2.94 s |
| `/` | 2 | 2.90 s | 2.90 s | 2.90 s |
| `/companies` | 1 | 2.89 s | 2.89 s | 2.89 s |
| `/company/:id/expenses/suppliers` | 4 | 1.48 s | 2.60 s | 2.60 s |
| `/company/:id/data/readiness` | 5 | 1.99 s | 2.54 s | 2.54 s |
| `/company/:id/analysis/goalseek` | 3 | 1.37 s | 2.50 s | 2.50 s |
| `/company/:id/sales/products` | 7 | 1.42 s | 2.39 s | 2.39 s |
| `/company/:id/analysis/real-profit` | 3 | 1.25 s | 2.32 s | 2.32 s |
| `/company/:id/analysis/kpis` | 12 | 1.19 s | 2.31 s | 2.31 s |
| `/company/:id/inventory/movements` | 2 | 2.30 s | 2.30 s | 2.30 s |
| `/account` | 2 | 2.23 s | 2.23 s | 2.23 s |
| `/company/:id/settings/profile` | 11 | 1.34 s | 2.21 s | 2.21 s |
| `/company/:id/sales/end-users` | 4 | 1.74 s | 2.19 s | 2.19 s |
| `/company/:id/banking` | 4 | 2.02 s | 2.15 s | 2.15 s |
| `/company/:id/analysis/explorer` | 4 | 1.44 s | 2.14 s | 2.14 s |
| `/company/:id/expenses` | 3 | 1.92 s | 2.12 s | 2.12 s |
| `/company/:id/sales/trend` | 4 | 1.67 s | 2.11 s | 2.11 s |
| `/company/:id/settings/data-health` | 1 | 2.11 s | 2.11 s | 2.11 s |
| `/company/:id/data` | 10 | 1.14 s | 2.07 s | 2.07 s |
| `/company/:id/reports` | 7 | 1.18 s | 2.05 s | 2.05 s |
| `/company/:id/settings/data-setup` | 1 | 2.04 s | 2.04 s | 2.04 s |
| `/company/:id/settings/source-data` | 1 | 2.04 s | 2.04 s | 2.04 s |

Load burst (10 tabs × 4 heavy pages at once): median 3.5 s, p95 8.2 s, slowest 9.3 s.

Throttled connection (400 ms latency, 200 KB/s): summary 0.5 s, sales 0.9 s, sales/products 0.6 s, data 0.7 s, reports 0.7 s.

## 5. Personas and their journeys

| Persona | Goal | Steps ok | Issues (crit/high/med/low) |
|---|---|---|---|
| P01 First-time visitor | Reads the landing page, legal pages, then tries the demo | 2/2 | 0/0/0/0 |
| P02 Demo explorer (desktop) | Clicks through every demo page | 1/1 | 0/0/1/0 |
| P03 Demo explorer on a phone | Browses the demo on a Pixel 7 | 2/2 | 0/0/0/0 |
| P04 Arabic-speaking visitor | Switches the site to Arabic and reads the demo right to left | 3/3 | 0/0/0/1 |
| P05 Keyboard-only user | Signs in using only the keyboard | 1/1 | 0/0/0/1 |
| P06 Deep-linker without an account | Opens bookmarked company and admin URLs while signed out | 2/2 | 0/0/0/0 |
| P07 URL tamperer | Edits the URL by hand: bad ids, long strings, path tricks | 4/4 | 0/0/6/0 |
| P08 Sign-up form tester | Tries to sign up with empty, invalid and weak details | 3/3 | 0/0/0/0 |
| P09 Forgetful user | Types the wrong password repeatedly, then asks for a reset | 4/4 | 0/0/0/0 |
| P10 Shared-report reader | Opens a published report link without an account, then after it is withdrawn | 6/6 | 0/0/0/0 |
| P11 Brand-new owner with no data | Signs up, creates a company and opens every page before uploading anything | 3/3 | 0/0/0/0 |
| P12 Odoo GL accountant | Uploads GL + TB + P&L together and reads every financial page | 6/6 | 0/0/0/0 |
| P13 Statements-only owner | Uploads a P&L + balance sheet export and checks the headline | 5/5 | 0/0/1/0 |
| P14 Trial-balance-only owner | Uploads only a trial balance | 4/4 | 0/0/0/0 |
| P15 Sales manager | Uploads Invoice Analysis and studies customers and products | 5/5 | 0/0/0/0 |
| P16 Cost controller | Uploads vendor bills and studies suppliers | 5/5 | 0/0/0/0 |
| P17 Credit controller | Uploads ageing reports and payments and checks receivables | 5/5 | 0/0/0/0 |
| P18 Wrong-file uploader | Drops each file in the wrong upload step | 6/6 | 0/0/0/0 |
| P19 Corrupt-file uploader | Uploads random bytes, an empty CSV and a renamed text file | 10/10 | 0/0/0/0 |
| P20 Double uploader | Uploads the same files twice and expects nothing doubled | 7/8 | 0/0/1/0 |
| P21 Messy-spreadsheet owner | Uploads a hand-made sales CSV with header on row 3, totals and blanks | 3/3 | 0/0/0/0 |
| P22 Upload abandoner | Starts an upload, leaves mid-review, comes back | 5/5 | 0/0/0/0 |
| P23 Double-clicker | Clicks every save button twice, fast | 5/5 | 0/0/0/0 |
| P24 Back-button user | Uses the browser Back button inside the upload wizard | 4/4 | 0/0/0/0 |
| P25 Settings tinkerer | Changes profile, financial year, targets, KPIs and alerts | 6/7 | 0/0/1/0 |
| P26 Chart-of-accounts fixer | Reclassifies accounts and checks the analysis follows | 5/5 | 0/0/0/0 |
| P27 Report maker | Creates, edits, downloads and deletes a report | 7/7 | 0/0/0/0 |
| P28 Data clearer | Clears one module, then checks the pages say 'no data' rather than zero | 6/6 | 0/0/0/0 |
| P29 Company deleter | Deletes a company and tries its old links | 6/6 | 0/0/8/0 |
| P30 Portfolio manager | Runs three companies and compares them | 5/6 | 0/0/1/0 |
| P31 Period explorer | Switches month, quarter, year and comparisons on every financial page | 5/5 | 0/0/0/0 |
| P32 Data reviewer | Walks the Data steps, checks and readiness after a full upload | 7/7 | 0/0/0/0 |
| P33 Stock manager without stock files | Opens inventory pages before any stock upload | 5/5 | 0/0/0/0 |
| P34 AI commentary requester | Asks for AI commentary on the summary | 5/5 | 0/0/0/0 |
| P35 Privacy-minded user | Exports their data, renames themselves, reads the account page | 6/6 | 0/0/0/1 |
| P36 Organisation admin | Invites an editor and a viewer, then changes a role | 7/7 | 0/0/0/0 |
| P37 Viewer | Has view-only access and tries to change things anyway | 9/9 | 0/0/2/0 |
| P38 Editor | Can upload, but should not delete the company or manage people | 7/7 | 0/0/0/0 |
| P39 Outsider | A user from another firm tries to reach a company that isn't theirs | 6/6 | 0/0/0/0 |
| P40 Removed member | Loses access while signed in, then keeps clicking | 7/7 | 0/0/0/0 |
| P41 Session expirer | Leaves the tab open, the session expires, then acts | 5/5 | 0/0/0/0 |
| P42 Offline user | Loses the connection and keeps clicking | 5/5 | 0/0/1/0 |
| P43 Slow-connection user | Uses the site over a throttled 3G-like connection | 5/5 | 0/0/0/0 |
| P44 Two-tab worker | Uploads in one tab while another tab shows the old figures | 5/5 | 0/0/0/0 |
| P45 Busy Monday (load burst) | Ten colleagues open the same company's heavy pages at once | 7/7 | 0/0/0/0 |
| P46 Tiny-screen user | Uses a 320-pixel-wide phone | 6/6 | 0/0/0/0 |
| P47 Dark-mode, reduced-motion user | Prefers dark colours and no animation | 4/4 | 0/0/1/0 |
| P48 Rapid navigator | Clicks through tabs faster than pages load | 5/5 | 0/0/0/0 |
| P49 Odoo live connector tester | Tries to connect Odoo with bad addresses | 4/4 | 0/0/0/0 |
| P50 Opening-balances newcomer | Loads opening balances first, then the ledger | 5/5 | 0/0/0/0 |

### Failed or skipped steps

- **P20** same accounts file again: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')
- **P25** targets, KPIs, alerts: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('save-kpis')
- **P30** two more companies: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')

## How to re-run

```bash
bash scripts/personas/run.sh            # fresh stack, build, 50 personas, this report
SKIP_STACK=1 SKIP_BUILD=1 bash scripts/personas/run.sh -g P37   # one persona against what is running
```

Raw results: `test-results/personas/` (one JSON per persona, screenshots, server, database and import logs). They are not committed.
