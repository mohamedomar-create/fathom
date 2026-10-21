# Persona test run: issues to address

Run on 2026-10-21 20:12 UTC against a disposable local stack (fresh database, production build, the live database's time limits). Made-up companies and files only; nothing touched production.

- **Personas:** 50 · **steps:** 254 (4 failed or skipped) · **page loads timed:** 281 · **run time:** 9 min
- **Distinct issues (browser):** 54: 0 critical, 2 high, 49 medium, 3 low
- **Server log:** 0 problem lines in 0 kinds · **database log:** 0 errors/warnings in 0 kinds
- **Page load times:** median 2.88 s, p95 6.22 s, slowest 15.0 s

Severity: **critical** = wrong figures, data leak or data loss; **high** = crash, server error, security gap or a broken journey; **medium** = confusing, slow or partly broken; **low** = polish.

Each issue is a lead, not a verdict: some are expected behaviour or test-harness assumptions. Check each before fixing it.

## 1. Issues found by the personas

| # | Severity | Kind | Issue | Personas | Hits |
|---|---|---|---|---|---|
| B1 | high | very slow page | /company/:id/summary took N s | 1 | 1 |
| B2 | high | very slow page | /company/:id/data/odoo took N s | 1 | 1 |
| B3 | medium | slow page | /company/:id/summary took N s | 14 | 16 |
| B4 | medium | slow page | /company/:id/sales took N s | 7 | 7 |
| B5 | medium | slow page | /company/:id/analysis/financials took N s | 6 | 6 |
| B6 | medium | slow page | /company/:id/analysis/kpis took N s | 5 | 5 |
| B7 | medium | slow page | /company/:id/analysis/profitability took N s | 5 | 5 |
| B8 | medium | slow page | /company/:id/analysis/explorer took N s | 4 | 4 |
| B9 | medium | slow page | /company/:id/data took N s | 3 | 4 |
| B10 | medium | slow page | /demo/summary took N s | 3 | 3 |
| B11 | medium | slow page | /company/:id/analysis/cashflow took N s | 3 | 3 |
| B12 | medium | slow page | /company/:id/analysis/growth took N s | 3 | 3 |
| B13 | medium | slow page | /company/:id/analysis/trend took N s | 3 | 3 |
| B14 | medium | slow page | /company/:id/analysis/goalseek took N s | 3 | 3 |
| B15 | medium | slow page | /company/:id/analysis/forecast took N s | 3 | 3 |
| B16 | medium | slow page | /company/:id/analysis/real-profit took N s | 3 | 3 |
| B17 | medium | slow page | /company/:id/sales/trend took N s | 3 | 3 |
| B18 | medium | slow page | /company/:id/sales/end-users took N s | 3 | 3 |
| B19 | medium | slow page | /company/:id/data/readiness took N s | 3 | 3 |
| B20 | medium | slow page | /company/:id/data/odoo took N s | 3 | 3 |
| B21 | medium | slow page | /company/:id/data/upload took N s | 3 | 3 |
| B22 | medium | console error | Failed to load resource: the server responded with a status of N (Not Found) | 2 | 7 |
| B23 | medium | slow page | /company/:id/inventory/products took N s | 2 | 2 |
| B24 | medium | slow page | /company/:id/data/end-users took N s | 2 | 2 |
| B25 | medium | slow page | /company/:id/data/checks took N s | 2 | 2 |
| B26 | medium | slow page | /company/:id/summary | 1 | 7 |
| B27 | medium | slow page | /company/:id/analysis/kpis | 1 | 7 |
| B28 | medium | slow page | /company/:id/analysis/profitability | 1 | 7 |
| B29 | medium | slow page | /company/:id/analysis/cashflow | 1 | 7 |
| B30 | medium | slow page | /company/:id/inventory took N s | 1 | 2 |
| B31 | medium | slow page | / took N s | 1 | 1 |
| B32 | medium | HTTP 404 | GET /company/not-a-uuid/summary | 1 | 1 |
| B33 | medium | HTTP 404 | GET /company/:id/nope | 1 | 1 |
| B34 | medium | HTTP 404 | GET /r/not-a-token | 1 | 1 |
| B35 | medium | slow page | /company/:id/sales/products took N s | 1 | 1 |
| B36 | medium | slow page | /company/:id/expenses/accounts took N s | 1 | 1 |
| B37 | medium | slow page | /company/:id/expenses/suppliers took N s | 1 | 1 |
| B38 | medium | slow page | /company/:id/expenses took N s | 1 | 1 |
| B39 | medium | step failed | same accounts file again: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import') | 1 | 1 |
| B40 | medium | step failed | targets, KPIs, alerts: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('save-kpis') | 1 | 1 |
| B41 | medium | HTTP 404 | GET /company/:id/summary | 1 | 1 |
| B42 | medium | HTTP 404 | GET /company/:id/sales | 1 | 1 |
| B43 | medium | HTTP 404 | GET /company/:id/data | 1 | 1 |
| B44 | medium | HTTP 404 | GET /company/:id/reports | 1 | 1 |
| B45 | medium | step failed | two more companies: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import') | 1 | 1 |
| B46 | medium | slow page | /companies took N s | 1 | 1 |
| B47 | medium | slow page | /company/:id/settings/data-health took N s | 1 | 1 |
| B48 | medium | slow page | /company/:id/settings/source-data took N s | 1 | 1 |
| B49 | medium | slow page | /company/:id/inventory/movements took N s | 1 | 1 |
| B50 | medium | console error | Failed to fetch RSC payload for http://localhost:N/company/:id/analysis/kpis. Falling back to browser navigation. TypeError: Failed to fetch     at n (http://localhost:N/_next/static/chunks/1gef-u_vq4uxk.js:2:N)     at M | 1 | 1 |
| B51 | medium | step failed | ten tab switches without waiting: expect(locator).toBeVisible() failed \| Locator: locator('h1').first() \| Expected: visible | 1 | 1 |
| B52 | low | expectation | Arabic mode: page heading still English on /demo/settings/profile: "Company Profile" | 1 | 1 |
| B53 | low | expectation | Keyboard: the focused element shows no focus ring | 1 | 1 |
| B54 | low | expectation | No personal data export button on /account | 1 | 1 |

### Details

**B1. [high] very slow page: /company/:id/summary took N s**

- Personas: P48 Rapid navigator
- P48, step "ten tab switches without waiting", page `/company/:id/summary`: /company/:id/summary took 8.3 s

**B2. [high] very slow page: /company/:id/data/odoo took N s**

- Personas: P49 Odoo live connector tester
- P49, step "Odoo page opens", page `/company/:id/data/odoo`: /company/:id/data/odoo took 15.0 s

**B3. [medium] slow page: /company/:id/summary took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner; P14 Trial-balance-only owner; P20 Double uploader; P22 Upload abandoner; P25 Settings tinkerer; P26 Chart-of-accounts fixer; P31 Period explorer; P34 AI commentary requester; P37 Viewer; P40 Removed member; P42 Offline user; P47 Dark-mode, reduced-motion user
- P11, step "every page of an empty company", page `/company/:id/summary`: /company/:id/summary took 6.9 s
- P12, step "financial pages", page `/company/:id/summary`: /company/:id/summary took 5.4 s
- P13, step "headline figure", page `/company/:id/summary`: /company/:id/summary took 5.5 s

**B4. [medium] slow page: /company/:id/sales took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P15 Sales manager; P28 Data clearer; P37 Viewer; P44 Two-tab worker; P46 Tiny-screen user
- P11, step "every page of an empty company", page `/company/:id/sales`: /company/:id/sales took 3.7 s
- P12, step "sales and expenses derived from the ledger", page `/company/:id/sales`: /company/:id/sales took 3.2 s
- P15, step "sales pages", page `/company/:id/sales`: /company/:id/sales took 3.7 s

**B5. [medium] slow page: /company/:id/analysis/financials took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner; P14 Trial-balance-only owner; P26 Chart-of-accounts fixer; P47 Dark-mode, reduced-motion user
- P11, step "every page of an empty company", page `/company/:id/analysis/financials`: /company/:id/analysis/financials took 4.5 s
- P12, step "financial pages", page `/company/:id/analysis/financials`: /company/:id/analysis/financials took 3.7 s
- P13, step "financial pages", page `/company/:id/analysis/financials`: /company/:id/analysis/financials took 4.1 s

**B6. [medium] slow page: /company/:id/analysis/kpis took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner; P14 Trial-balance-only owner; P37 Viewer
- P11, step "every page of an empty company", page `/company/:id/analysis/kpis`: /company/:id/analysis/kpis took 4.3 s
- P12, step "financial pages", page `/company/:id/analysis/kpis`: /company/:id/analysis/kpis took 3.9 s
- P13, step "financial pages", page `/company/:id/analysis/kpis`: /company/:id/analysis/kpis took 4.8 s

**B7. [medium] slow page: /company/:id/analysis/profitability took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner; P26 Chart-of-accounts fixer; P37 Viewer
- P11, step "every page of an empty company", page `/company/:id/analysis/profitability`: /company/:id/analysis/profitability took 3.5 s
- P12, step "financial pages", page `/company/:id/analysis/profitability`: /company/:id/analysis/profitability took 4.9 s
- P13, step "financial pages", page `/company/:id/analysis/profitability`: /company/:id/analysis/profitability took 3.9 s

**B8. [medium] slow page: /company/:id/analysis/explorer took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner; P37 Viewer
- P11, step "every page of an empty company", page `/company/:id/analysis/explorer`: /company/:id/analysis/explorer took 4.1 s
- P12, step "financial pages", page `/company/:id/analysis/explorer`: /company/:id/analysis/explorer took 5.2 s
- P13, step "financial pages", page `/company/:id/analysis/explorer`: /company/:id/analysis/explorer took 4.5 s

**B9. [medium] slow page: /company/:id/data took N s**

- Personas: P14 Trial-balance-only owner; P32 Data reviewer; P37 Viewer
- P14, step "pages after a TB", page `/company/:id/data`: /company/:id/data took 3.8 s
- P32, step "data pages", page `/company/:id/data`: /company/:id/data took 3.7 s
- P32, step "Data steps show a status for every step", page `/company/:id/data`: /company/:id/data took 4.2 s

**B10. [medium] slow page: /demo/summary took N s**

- Personas: P02 Demo explorer (desktop); P03 Demo explorer on a phone; P04 Arabic-speaking visitor
- P02, step "every demo page", page `/demo/summary`: /demo/summary took 3.9 s
- P03, step "demo pages on a phone", page `/demo/summary`: /demo/summary took 3.5 s
- P04, step "open demo", page `/demo/summary`: /demo/summary took 3.9 s

**B11. [medium] slow page: /company/:id/analysis/cashflow took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/cashflow`: /company/:id/analysis/cashflow took 4.7 s
- P12, step "financial pages", page `/company/:id/analysis/cashflow`: /company/:id/analysis/cashflow took 4.3 s
- P13, step "financial pages", page `/company/:id/analysis/cashflow`: /company/:id/analysis/cashflow took 5.1 s

**B12. [medium] slow page: /company/:id/analysis/growth took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/growth`: /company/:id/analysis/growth took 5.1 s
- P12, step "financial pages", page `/company/:id/analysis/growth`: /company/:id/analysis/growth took 4.9 s
- P13, step "financial pages", page `/company/:id/analysis/growth`: /company/:id/analysis/growth took 4.7 s

**B13. [medium] slow page: /company/:id/analysis/trend took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/trend`: /company/:id/analysis/trend took 4.3 s
- P12, step "financial pages", page `/company/:id/analysis/trend`: /company/:id/analysis/trend took 5.0 s
- P13, step "financial pages", page `/company/:id/analysis/trend`: /company/:id/analysis/trend took 3.9 s

**B14. [medium] slow page: /company/:id/analysis/goalseek took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/goalseek`: /company/:id/analysis/goalseek took 5.5 s
- P12, step "financial pages", page `/company/:id/analysis/goalseek`: /company/:id/analysis/goalseek took 4.9 s
- P13, step "financial pages", page `/company/:id/analysis/goalseek`: /company/:id/analysis/goalseek took 4.0 s

**B15. [medium] slow page: /company/:id/analysis/forecast took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/forecast`: /company/:id/analysis/forecast took 5.2 s
- P12, step "financial pages", page `/company/:id/analysis/forecast`: /company/:id/analysis/forecast took 5.3 s
- P13, step "financial pages", page `/company/:id/analysis/forecast`: /company/:id/analysis/forecast took 4.7 s

**B16. [medium] slow page: /company/:id/analysis/real-profit took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/real-profit`: /company/:id/analysis/real-profit took 4.8 s
- P12, step "financial pages", page `/company/:id/analysis/real-profit`: /company/:id/analysis/real-profit took 3.7 s
- P13, step "financial pages", page `/company/:id/analysis/real-profit`: /company/:id/analysis/real-profit took 4.3 s

**B17. [medium] slow page: /company/:id/sales/trend took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P28 Data clearer
- P11, step "every page of an empty company", page `/company/:id/sales/trend`: /company/:id/sales/trend took 4.1 s
- P12, step "sales and expenses derived from the ledger", page `/company/:id/sales/trend`: /company/:id/sales/trend took 3.5 s
- P28, step "pages after clearing", page `/company/:id/sales/trend`: /company/:id/sales/trend took 3.1 s

**B18. [medium] slow page: /company/:id/sales/end-users took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P28 Data clearer
- P11, step "every page of an empty company", page `/company/:id/sales/end-users`: /company/:id/sales/end-users took 3.3 s
- P12, step "sales and expenses derived from the ledger", page `/company/:id/sales/end-users`: /company/:id/sales/end-users took 3.0 s
- P28, step "pages after clearing", page `/company/:id/sales/end-users`: /company/:id/sales/end-users took 3.2 s

**B19. [medium] slow page: /company/:id/data/readiness took N s**

- Personas: P11 Brand-new owner with no data; P28 Data clearer; P32 Data reviewer
- P11, step "every page of an empty company", page `/company/:id/data/readiness`: /company/:id/data/readiness took 3.4 s
- P28, step "pages after clearing", page `/company/:id/data/readiness`: /company/:id/data/readiness took 4.1 s
- P32, step "data pages", page `/company/:id/data/readiness`: /company/:id/data/readiness took 3.7 s

**B20. [medium] slow page: /company/:id/data/odoo took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P32 Data reviewer
- P11, step "every page of an empty company", page `/company/:id/data/odoo`: /company/:id/data/odoo took 3.3 s
- P12, step "data section", page `/company/:id/data/odoo`: /company/:id/data/odoo took 3.6 s
- P32, step "data pages", page `/company/:id/data/odoo`: /company/:id/data/odoo took 3.1 s

**B21. [medium] slow page: /company/:id/data/upload took N s**

- Personas: P32 Data reviewer; P37 Viewer; P46 Tiny-screen user
- P32, step "data pages", page `/company/:id/data/upload`: /company/:id/data/upload took 3.0 s
- P37, step "no edit controls", page `/company/:id/data/upload`: /company/:id/data/upload took 4.3 s
- P46, step "pages at 320 px", page `/company/:id/data/upload`: /company/:id/data/upload took 4.2 s

**B22. [medium] console error: Failed to load resource: the server responded with a status of N (Not Found)**

- Personas: P07 URL tamperer; P29 Company deleter
- P07, step "malformed ids and paths", page `/company/not-a-uuid/summary`: Failed to load resource: the server responded with a status of 404 (Not Found)
- P07, step "malformed ids and paths", page `/company/:id/nope`: Failed to load resource: the server responded with a status of 404 (Not Found)
- P07, step "malformed ids and paths", page `/r/not-a-token`: Failed to load resource: the server responded with a status of 404 (Not Found)

**B23. [medium] slow page: /company/:id/inventory/products took N s**

- Personas: P11 Brand-new owner with no data; P33 Stock manager without stock files
- P11, step "every page of an empty company", page `/company/:id/inventory/products`: /company/:id/inventory/products took 3.6 s
- P33, step "inventory pages", page `/company/:id/inventory/products`: /company/:id/inventory/products took 3.1 s

**B24. [medium] slow page: /company/:id/data/end-users took N s**

- Personas: P11 Brand-new owner with no data; P32 Data reviewer
- P11, step "every page of an empty company", page `/company/:id/data/end-users`: /company/:id/data/end-users took 3.4 s
- P32, step "data pages", page `/company/:id/data/end-users`: /company/:id/data/end-users took 3.5 s

**B25. [medium] slow page: /company/:id/data/checks took N s**

- Personas: P14 Trial-balance-only owner; P32 Data reviewer
- P14, step "pages after a TB", page `/company/:id/data/checks`: /company/:id/data/checks took 3.3 s
- P32, step "data pages", page `/company/:id/data/checks`: /company/:id/data/checks took 3.2 s

**B26. [medium] slow page: /company/:id/summary**

- Personas: P31 Period explorer
- P31, step "every period view", page `/company/:id/summary?type=quarter`: /company/:id/summary?type=quarter took 4.1 s
- P31, step "every period view", page `/company/:id/summary?type=year`: /company/:id/summary?type=year took 5.7 s
- P31, step "every period view", page `/company/:id/summary?type=ytd`: /company/:id/summary?type=ytd took 5.1 s

**B27. [medium] slow page: /company/:id/analysis/kpis**

- Personas: P31 Period explorer
- P31, step "every period view", page `/company/:id/analysis/kpis?type=quarter`: /company/:id/analysis/kpis?type=quarter took 4.6 s
- P31, step "every period view", page `/company/:id/analysis/kpis?type=year`: /company/:id/analysis/kpis?type=year took 4.7 s
- P31, step "every period view", page `/company/:id/analysis/kpis?type=ytd`: /company/:id/analysis/kpis?type=ytd took 3.3 s

**B28. [medium] slow page: /company/:id/analysis/profitability**

- Personas: P31 Period explorer
- P31, step "every period view", page `/company/:id/analysis/profitability?type=quarter`: /company/:id/analysis/profitability?type=quarter took 5.2 s
- P31, step "every period view", page `/company/:id/analysis/profitability?type=year`: /company/:id/analysis/profitability?type=year took 4.4 s
- P31, step "every period view", page `/company/:id/analysis/profitability?type=ytd`: /company/:id/analysis/profitability?type=ytd took 5.3 s

**B29. [medium] slow page: /company/:id/analysis/cashflow**

- Personas: P31 Period explorer
- P31, step "every period view", page `/company/:id/analysis/cashflow?type=quarter`: /company/:id/analysis/cashflow?type=quarter took 6.5 s
- P31, step "every period view", page `/company/:id/analysis/cashflow?type=year`: /company/:id/analysis/cashflow?type=year took 6.4 s
- P31, step "every period view", page `/company/:id/analysis/cashflow?type=ytd`: /company/:id/analysis/cashflow?type=ytd took 7.0 s

**B30. [medium] slow page: /company/:id/inventory took N s**

- Personas: P33 Stock manager without stock files
- P33, step "inventory pages", page `/company/:id/inventory`: /company/:id/inventory took 3.4 s
- P33, step "inventory explains what's missing", page `/company/:id/inventory`: /company/:id/inventory took 3.2 s

**B31. [medium] slow page: / took N s**

- Personas: P01 First-time visitor
- P01, step "landing, privacy, terms", page `/`: / took 3.6 s

**B32. [medium] HTTP 404: GET /company/not-a-uuid/summary**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/:id/data/upload`: GET /company/not-a-uuid/summary

**B33. [medium] HTTP 404: GET /company/:id/nope**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/not-a-uuid/summary`: GET /company/0a48a5a1-8868-410a-8178-0f2ce20a08a6/nope

**B34. [medium] HTTP 404: GET /r/not-a-token**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/:id/reports/:id`: GET /r/not-a-token

**B35. [medium] slow page: /company/:id/sales/products took N s**

- Personas: P11 Brand-new owner with no data
- P11, step "every page of an empty company", page `/company/:id/sales/products`: /company/:id/sales/products took 3.8 s

**B36. [medium] slow page: /company/:id/expenses/accounts took N s**

- Personas: P11 Brand-new owner with no data
- P11, step "every page of an empty company", page `/company/:id/expenses/accounts`: /company/:id/expenses/accounts took 3.1 s

**B37. [medium] slow page: /company/:id/expenses/suppliers took N s**

- Personas: P11 Brand-new owner with no data
- P11, step "every page of an empty company", page `/company/:id/expenses/suppliers`: /company/:id/expenses/suppliers took 3.2 s

**B38. [medium] slow page: /company/:id/expenses took N s**

- Personas: P16 Cost controller
- P16, step "expense pages", page `/company/:id/expenses`: /company/:id/expenses took 3.2 s

**B39. [medium] step failed: same accounts file again: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')**

- Personas: P20 Double uploader
- P20, step "same accounts file again", page `/company/:id/data/upload`, screenshot `test-results/personas/shots/P20-same-accounts-file-again.png`: same accounts file again: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')

**B40. [medium] step failed: targets, KPIs, alerts: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('save-kpis')**

- Personas: P25 Settings tinkerer
- P25, step "targets, KPIs, alerts", page `/company/:id/settings/targets`, screenshot `test-results/personas/shots/P25-targets-KPIs-alerts.png`: targets, KPIs, alerts: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('save-kpis')

**B41. [medium] HTTP 404: GET /company/:id/summary**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/companies`: GET /company/73c8fc55-c7db-4899-a69c-264828edfdb9/summary

**B42. [medium] HTTP 404: GET /company/:id/sales**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/company/:id/summary`: GET /company/73c8fc55-c7db-4899-a69c-264828edfdb9/sales

**B43. [medium] HTTP 404: GET /company/:id/data**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/company/:id/sales`: GET /company/73c8fc55-c7db-4899-a69c-264828edfdb9/data

**B44. [medium] HTTP 404: GET /company/:id/reports**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/company/:id/data`: GET /company/73c8fc55-c7db-4899-a69c-264828edfdb9/reports

**B45. [medium] step failed: two more companies: locator.click: Timeout N ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')**

- Personas: P30 Portfolio manager
- P30, step "two more companies", page `/company/:id/data/upload`, screenshot `test-results/personas/shots/P30-two-more-companies.png`: two more companies: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')

**B46. [medium] slow page: /companies took N s**

- Personas: P30 Portfolio manager
- P30, step "companies list and dashboard", page `/companies`: /companies took 5.3 s

**B47. [medium] slow page: /company/:id/settings/data-health took N s**

- Personas: P32 Data reviewer
- P32, step "old settings URLs redirect", page `/company/:id/settings/data-health`: /company/:id/settings/data-health took 3.6 s

**B48. [medium] slow page: /company/:id/settings/source-data took N s**

- Personas: P32 Data reviewer
- P32, step "old settings URLs redirect", page `/company/:id/settings/source-data`: /company/:id/settings/source-data took 3.3 s

**B49. [medium] slow page: /company/:id/inventory/movements took N s**

- Personas: P33 Stock manager without stock files
- P33, step "inventory pages", page `/company/:id/inventory/movements`: /company/:id/inventory/movements took 3.3 s

**B50. [medium] console error: Failed to fetch RSC payload for http://localhost:N/company/:id/analysis/kpis. Falling back to browser navigation. TypeError: Failed to fetch     at n (http://localhost:N/_next/static/chunks/1gef-u_vq4**

- Personas: P42 Offline user
- P42, step "go offline and click a link", page `/company/:id/summary`: Failed to fetch RSC payload for http://localhost:3100/company/a12b5183-e078-4e22-9db6-9a38ed0b8630/analysis/kpis. Falling back to browser navigation. TypeError: Failed to fetch     at n (http://localhost:3100/_next/static/chunks/1gef-u_vq4uxk.js:2:36290)     at M (http://localhost:3100/_next/static/

**B51. [medium] step failed: ten tab switches without waiting: expect(locator).toBeVisible() failed \| Locator: locator('h1').first() \| Expected: visible**

- Personas: P48 Rapid navigator
- P48, step "ten tab switches without waiting", page `/company/:id/banking`, screenshot `test-results/personas/shots/P48-ten-tab-switches-without-waiting.png`: ten tab switches without waiting: expect(locator).toBeVisible() failed \| Locator: locator('h1').first() \| Expected: visible

**B52. [low] expectation: Arabic mode: page heading still English on /demo/settings/profile: "Company Profile"**

- Personas: P04 Arabic-speaking visitor
- P04, step "Arabic pages read without English leftovers in headings", page `/demo/settings/profile`: Arabic mode: page heading still English on /demo/settings/profile: "Company Profile"

**B53. [low] expectation: Keyboard: the focused element shows no focus ring**

- Personas: P05 Keyboard-only user
- P05, step "tab through the sign-in form": Keyboard: the focused element shows no focus ring

**B54. [low] expectation: No personal data export button on /account**

- Personas: P35 Privacy-minded user
- P35, step "personal data export": No personal data export button on /account

## 2. Server log (Next.js)

No failed operations or errors.

## 3. Database log (Postgres)

No errors or warnings.

## 4. Slowest pages (p95)

| Page | Loads | p50 | p95 | Max |
|---|---|---|---|---|
| `/company/:id/data/odoo` | 4 | 3.61 s | 14.98 s | 14.98 s |
| `/company/:id/analysis/cashflow` | 10 | 6.26 s | 7.00 s | 7.00 s |
| `/company/:id/analysis/explorer` | 4 | 5.20 s | 6.95 s | 6.95 s |
| `/company/:id/summary` | 28 | 5.06 s | 6.89 s | 8.29 s |
| `/company/:id/analysis/kpis` | 12 | 4.68 s | 6.75 s | 6.75 s |
| `/company/:id/analysis/profitability` | 12 | 4.91 s | 6.70 s | 6.70 s |
| `/company/:id/analysis/goalseek` | 3 | 4.90 s | 5.48 s | 5.48 s |
| `/company/:id/sales` | 8 | 3.71 s | 5.48 s | 5.48 s |
| `/company/:id/analysis/forecast` | 3 | 5.19 s | 5.29 s | 5.29 s |
| `/companies` | 1 | 5.28 s | 5.28 s | 5.28 s |
| `/company/:id/analysis/financials` | 8 | 4.14 s | 5.17 s | 5.17 s |
| `/company/:id/analysis/growth` | 3 | 4.90 s | 5.10 s | 5.10 s |
| `/company/:id/analysis/trend` | 3 | 4.26 s | 5.03 s | 5.03 s |
| `/company/:id/analysis/real-profit` | 3 | 4.26 s | 4.75 s | 4.75 s |
| `/company/:id/data` | 10 | 2.93 s | 4.36 s | 4.36 s |
| `/company/:id/data/upload` | 5 | 3.04 s | 4.27 s | 4.27 s |
| `/company/:id/data/readiness` | 5 | 3.42 s | 4.14 s | 4.14 s |
| `/company/:id/sales/trend` | 4 | 3.55 s | 4.07 s | 4.07 s |
| `/demo/summary` | 5 | 3.53 s | 3.88 s | 3.88 s |
| `/company/:id/sales/products` | 7 | 2.27 s | 3.80 s | 3.80 s |
| `/company/:id/settings/data-health` | 1 | 3.64 s | 3.64 s | 3.64 s |
| `/` | 2 | 3.62 s | 3.62 s | 3.62 s |
| `/company/:id/inventory/products` | 2 | 3.59 s | 3.59 s | 3.59 s |
| `/company/:id/data/end-users` | 3 | 3.37 s | 3.46 s | 3.46 s |
| `/company/:id/inventory` | 3 | 3.21 s | 3.44 s | 3.44 s |

Load burst (10 tabs × 4 heavy pages at once): median 8.0 s, p95 13.8 s, slowest 14.0 s.

Throttled connection (400 ms latency, 200 KB/s): summary 1.0 s, sales 0.8 s, sales/products 1.3 s, data 1.2 s, reports 1.3 s.

## 5. Personas and their journeys

| Persona | Goal | Steps ok | Issues (crit/high/med/low) |
|---|---|---|---|
| P01 First-time visitor | Reads the landing page, legal pages, then tries the demo | 2/2 | 0/0/1/0 |
| P02 Demo explorer (desktop) | Clicks through every demo page | 1/1 | 0/0/1/0 |
| P03 Demo explorer on a phone | Browses the demo on a Pixel 7 | 2/2 | 0/0/1/0 |
| P04 Arabic-speaking visitor | Switches the site to Arabic and reads the demo right to left | 3/3 | 0/0/1/1 |
| P05 Keyboard-only user | Signs in using only the keyboard | 1/1 | 0/0/0/1 |
| P06 Deep-linker without an account | Opens bookmarked company and admin URLs while signed out | 2/2 | 0/0/0/0 |
| P07 URL tamperer | Edits the URL by hand: bad ids, long strings, path tricks | 4/4 | 0/0/6/0 |
| P08 Sign-up form tester | Tries to sign up with empty, invalid and weak details | 3/3 | 0/0/0/0 |
| P09 Forgetful user | Types the wrong password repeatedly, then asks for a reset | 4/4 | 0/0/0/0 |
| P10 Shared-report reader | Opens a published report link without an account, then after it is withdrawn | 6/6 | 0/0/0/0 |
| P11 Brand-new owner with no data | Signs up, creates a company and opens every page before uploading anything | 3/3 | 0/0/21/0 |
| P12 Odoo GL accountant | Uploads GL + TB + P&L together and reads every financial page | 6/6 | 0/0/15/0 |
| P13 Statements-only owner | Uploads a P&L + balance sheet export and checks the headline | 5/5 | 0/0/12/0 |
| P14 Trial-balance-only owner | Uploads only a trial balance | 4/4 | 0/0/5/0 |
| P15 Sales manager | Uploads Invoice Analysis and studies customers and products | 5/5 | 0/0/1/0 |
| P16 Cost controller | Uploads vendor bills and studies suppliers | 5/5 | 0/0/1/0 |
| P17 Credit controller | Uploads ageing reports and payments and checks receivables | 5/5 | 0/0/0/0 |
| P18 Wrong-file uploader | Drops each file in the wrong upload step | 6/6 | 0/0/0/0 |
| P19 Corrupt-file uploader | Uploads random bytes, an empty CSV and a renamed text file | 10/10 | 0/0/0/0 |
| P20 Double uploader | Uploads the same files twice and expects nothing doubled | 7/8 | 0/0/2/0 |
| P21 Messy-spreadsheet owner | Uploads a hand-made sales CSV with header on row 3, totals and blanks | 3/3 | 0/0/0/0 |
| P22 Upload abandoner | Starts an upload, leaves mid-review, comes back | 5/5 | 0/0/1/0 |
| P23 Double-clicker | Clicks every save button twice, fast | 5/5 | 0/0/0/0 |
| P24 Back-button user | Uses the browser Back button inside the upload wizard | 4/4 | 0/0/0/0 |
| P25 Settings tinkerer | Changes profile, financial year, targets, KPIs and alerts | 6/7 | 0/0/2/0 |
| P26 Chart-of-accounts fixer | Reclassifies accounts and checks the analysis follows | 5/5 | 0/0/3/0 |
| P27 Report maker | Creates, edits, downloads and deletes a report | 7/7 | 0/0/0/0 |
| P28 Data clearer | Clears one module, then checks the pages say 'no data' rather than zero | 6/6 | 0/0/4/0 |
| P29 Company deleter | Deletes a company and tries its old links | 6/6 | 0/0/8/0 |
| P30 Portfolio manager | Runs three companies and compares them | 5/6 | 0/0/2/0 |
| P31 Period explorer | Switches month, quarter, year and comparisons on every financial page | 5/5 | 0/0/29/0 |
| P32 Data reviewer | Walks the Data steps, checks and readiness after a full upload | 7/7 | 0/0/9/0 |
| P33 Stock manager without stock files | Opens inventory pages before any stock upload | 5/5 | 0/0/4/0 |
| P34 AI commentary requester | Asks for AI commentary on the summary | 5/5 | 0/0/1/0 |
| P35 Privacy-minded user | Exports their data, renames themselves, reads the account page | 6/6 | 0/0/0/1 |
| P36 Organisation admin | Invites an editor and a viewer, then changes a role | 7/7 | 0/0/0/0 |
| P37 Viewer | Has view-only access and tries to change things anyway | 9/9 | 0/0/7/0 |
| P38 Editor | Can upload, but should not delete the company or manage people | 7/7 | 0/0/0/0 |
| P39 Outsider | A user from another firm tries to reach a company that isn't theirs | 6/6 | 0/0/0/0 |
| P40 Removed member | Loses access while signed in, then keeps clicking | 7/7 | 0/0/1/0 |
| P41 Session expirer | Leaves the tab open, the session expires, then acts | 5/5 | 0/0/0/0 |
| P42 Offline user | Loses the connection and keeps clicking | 5/5 | 0/0/3/0 |
| P43 Slow-connection user | Uses the site over a throttled 3G-like connection | 5/5 | 0/0/0/0 |
| P44 Two-tab worker | Uploads in one tab while another tab shows the old figures | 5/5 | 0/0/1/0 |
| P45 Busy Monday (load burst) | Ten colleagues open the same company's heavy pages at once | 7/7 | 0/0/0/0 |
| P46 Tiny-screen user | Uses a 320-pixel-wide phone | 6/6 | 0/0/2/0 |
| P47 Dark-mode, reduced-motion user | Prefers dark colours and no animation | 4/4 | 0/0/2/0 |
| P48 Rapid navigator | Clicks through tabs faster than pages load | 4/5 | 0/1/1/0 |
| P49 Odoo live connector tester | Tries to connect Odoo with bad addresses | 4/4 | 0/1/0/0 |
| P50 Opening-balances newcomer | Loads opening balances first, then the ledger | 5/5 | 0/0/0/0 |

### Failed or skipped steps

- **P20** same accounts file again: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')
- **P25** targets, KPIs, alerts: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('save-kpis')
- **P30** two more companies: locator.click: Timeout 15000ms exceeded. \| Call log: \|   - waiting for getByTestId('commit-import')
- **P48** ten tab switches without waiting: expect(locator).toBeVisible() failed \| Locator: locator('h1').first() \| Expected: visible

## How to re-run

```bash
bash scripts/personas/run.sh            # fresh stack, build, 50 personas, this report
SKIP_STACK=1 SKIP_BUILD=1 bash scripts/personas/run.sh -g P37   # one persona against what is running
```

Raw results: `test-results/personas/` (one JSON per persona, screenshots, server, database and import logs). They are not committed.
