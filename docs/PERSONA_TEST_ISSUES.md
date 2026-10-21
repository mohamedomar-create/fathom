# Persona test run: issues to address

Run on 2026-10-21 18:58 UTC against a disposable local stack (fresh database, production build, the live database's time limits). Made-up companies and files only; nothing touched production.

- **Personas:** 50 · **steps:** 243 (4 failed or skipped) · **page loads timed:** 272 · **run time:** 12 min
- **Distinct issues (browser):** 62: 0 critical, 6 high, 46 medium, 10 low
- **Server log:** 6 problem lines in 5 kinds · **database log:** 3 errors/warnings in 1 kinds
- **Page load times:** median 2.27 s, p95 4.94 s, slowest 8.6 s

Severity: **critical** = wrong figures, data leak or data loss; **high** = crash, server error, security gap or a broken journey; **medium** = confusing, slow or partly broken; **low** = polish.

Each issue is a lead, not a verdict: some are expected behaviour or test-harness assumptions. Check each before fixing it.

## 1. Issues found by the personas

| # | Severity | Kind | Issue | Personas | Hits |
|---|---|---|---|---|---|
| B1 | high | journey crashed | journey still running after N s | 5 | 5 |
| B2 | high | HTTP 500 | GET /company/not-a-uuid/summary | 1 | 1 |
| B3 | high | expectation | Tampered URL /company/not-a-uuid/summary gave a server error N | 1 | 1 |
| B4 | high | expectation | Commentary API returned N | 1 | 1 |
| B5 | high | very slow page | /company/:id/summary took N s | 1 | 1 |
| B6 | high | step failed | create company: expect(page).toHaveURL(expected) failed \| Expected pattern: /\/company\/[0-9a-f-]{N}\/data/ \| Received string:  "http://localhost:N/companies" | 1 | 1 |
| B7 | medium | slow page | /company/:id/summary took N s | 9 | 11 |
| B8 | medium | slow page | /company/:id/analysis/kpis took N s | 5 | 5 |
| B9 | medium | slow page | /company/:id/analysis/explorer took N s | 4 | 4 |
| B10 | medium | slow page | /company/:id/analysis/profitability took N s | 4 | 4 |
| B11 | medium | slow page | /company/:id/analysis/financials took N s | 4 | 4 |
| B12 | medium | slow page | /company/:id/sales took N s | 4 | 4 |
| B13 | medium | slow page | /company/:id/analysis/cashflow took N s | 3 | 3 |
| B14 | medium | slow page | /company/:id/analysis/growth took N s | 3 | 3 |
| B15 | medium | slow page | /company/:id/analysis/trend took N s | 3 | 3 |
| B16 | medium | slow page | /company/:id/analysis/goalseek took N s | 3 | 3 |
| B17 | medium | slow page | /company/:id/analysis/forecast took N s | 3 | 3 |
| B18 | medium | slow page | /company/:id/analysis/real-profit took N s | 3 | 3 |
| B19 | medium | slow page | /company/:id/data/checks took N s | 3 | 3 |
| B20 | medium | console error | Failed to load resource: the server responded with a status of N (Not Found) | 2 | 6 |
| B21 | medium | slow page | /demo/summary took N s | 2 | 2 |
| B22 | medium | slow page | /company/:id/expenses/trend took N s | 2 | 2 |
| B23 | medium | slow page | /company/:id/sales/customers took N s | 2 | 2 |
| B24 | medium | slow page | /company/:id/data took N s | 2 | 2 |
| B25 | medium | slow page | /company/:id/analysis/cashflow | 1 | 4 |
| B26 | medium | slow page | /company/:id/analysis/kpis | 1 | 3 |
| B27 | medium | slow page | /company/:id/analysis/profitability | 1 | 3 |
| B28 | medium | console error | Error: Minified React error #N; visit https://react.dev/errors/N for the full message or use the non-minified dev environment for full errors and additional helpful warnings. | 1 | 2 |
| B29 | medium | slow page | /company/:id/summary | 1 | 2 |
| B30 | medium | slow page | / took N s | 1 | 1 |
| B31 | medium | console error | Failed to load resource: the server responded with a status of N (Internal Server Error) | 1 | 1 |
| B32 | medium | HTTP 404 | GET /company/:id/nope | 1 | 1 |
| B33 | medium | HTTP 404 | GET /r/not-a-token | 1 | 1 |
| B34 | medium | slow page | /company/:id/sales/products took N s | 1 | 1 |
| B35 | medium | slow page | /company/:id/sales/trend took N s | 1 | 1 |
| B36 | medium | slow page | /company/:id/sales/end-users took N s | 1 | 1 |
| B37 | medium | slow page | /company/:id/expenses/suppliers took N s | 1 | 1 |
| B38 | medium | slow page | /company/:id/inventory/products took N s | 1 | 1 |
| B39 | medium | slow page | /company/:id/payments/flows took N s | 1 | 1 |
| B40 | medium | slow page | /company/:id/data/upload took N s | 1 | 1 |
| B41 | medium | slow page | /company/:id/data/readiness took N s | 1 | 1 |
| B42 | medium | slow page | /company/:id/data/end-users took N s | 1 | 1 |
| B43 | medium | expectation | Double-clicking Create report made 2 reports | 1 | 1 |
| B44 | medium | HTTP 404 | GET /company/:id/summary | 1 | 1 |
| B45 | medium | HTTP 404 | GET /company/:id/sales | 1 | 1 |
| B46 | medium | HTTP 404 | GET /company/:id/data | 1 | 1 |
| B47 | medium | HTTP 404 | GET /company/:id/reports | 1 | 1 |
| B48 | medium | slow page | /company/:id/settings/source-data took N s | 1 | 1 |
| B49 | medium | console error | Error: An unexpected response was received from the server.     at w (http://localhost:N/_next/static/chunks/1gef-u_vq4uxk.js:2:N) | 1 | 1 |
| B50 | medium | console error | {"kind":"section-error"} | 1 | 1 |
| B51 | medium | expectation | Saving after the session expired gives no 'sign in again' message | 1 | 1 |
| B52 | medium | console error | Failed to fetch RSC payload for http://localhost:N/company/:id/analysis/kpis. Falling back to browser navigation. TypeError: Failed to fetch     at n (http://localhost:N/_next/static/chunks/1gef-u_vq4uxk.js:2:N)     at M | 1 | 1 |
| B53 | low | page content | page wider than screen: 1454px > 1440px (span.num absolute whitespace-nowrap text-[12px] text-ink to 1454px) | 2 | 2 |
| B54 | low | page content | page wider than screen: 1458px > 1440px (span.num absolute whitespace-nowrap text-[12px] text-ink to 1458px) | 1 | 2 |
| B55 | low | page content | page wider than screen: 350px > 320px (span.num absolute whitespace-nowrap text-[12px] text-ink to 350px) | 1 | 2 |
| B56 | low | expectation | Arabic mode: page heading still English on /demo/data/upload: "Data" | 1 | 1 |
| B57 | low | expectation | Arabic mode: page heading still English on /demo/settings/profile: "Company Profile" | 1 | 1 |
| B58 | low | expectation | Keyboard: the focused element shows no focus ring | 1 | 1 |
| B59 | low | expectation | No personal data export button on /account | 1 | 1 |
| B60 | low | expectation | Dark mode /summary: 1 text elements below 3:1 contrast (e.g. Data readiness) | 1 | 1 |
| B61 | low | expectation | Dark mode /data: 5 text elements below 3:1 contrast (e.g. Trial Balance \| Sales detail \| Stock) | 1 | 1 |
| B62 | low | expectation | Dark mode /settings/profile: 2 text elements below 3:1 contrast (e.g. Company Profile Currency, year \| Company Profile) | 1 | 1 |

### Details

**B1. [high] journey crashed: journey still running after N s**

- Personas: P20 Double uploader; P25 Settings tinkerer; P27 Report maker; P30 Portfolio manager; P37 Viewer
- P20, step "same accounts file again": journey still running after 240 s
- P25, step "targets, KPIs, alerts": journey still running after 240 s
- P27, step "delete the report": journey still running after 240 s

**B2. [high] HTTP 500: GET /company/not-a-uuid/summary**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/:id/data/upload`: GET /company/not-a-uuid/summary

**B3. [high] expectation: Tampered URL /company/not-a-uuid/summary gave a server error N**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/not-a-uuid/summary`: Tampered URL /company/not-a-uuid/summary gave a server error 500

**B4. [high] expectation: Commentary API returned N**

- Personas: P34 AI commentary requester
- P34, step "commentary API directly": Commentary API returned 502

**B5. [high] very slow page: /company/:id/summary took N s**

- Personas: P48 Rapid navigator
- P48, step "ten tab switches without waiting", page `/company/:id/summary`: /company/:id/summary took 8.6 s

**B6. [high] step failed: create company: expect(page).toHaveURL(expected) failed \| Expected pattern: /\/company\/[0-9a-f-]{N}\/data/ \| Received string:  "http://localhost:N/companies"**

- Personas: P50 Opening-balances newcomer
- P50, step "create company", page `/companies`, screenshot `test-results/personas/shots/P50-create-company.png`: create company: expect(page).toHaveURL(expected) failed \| Expected pattern: /\/company\/[0-9a-f-]{36}\/data/ \| Received string:  "http://localhost:3100/companies"

**B7. [medium] slow page: /company/:id/summary took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner; P14 Trial-balance-only owner; P20 Double uploader; P34 AI commentary requester; P37 Viewer; P40 Removed member; P42 Offline user
- P11, step "every page of an empty company", page `/company/:id/summary`: /company/:id/summary took 5.7 s
- P12, step "financial pages", page `/company/:id/summary`: /company/:id/summary took 5.0 s
- P13, step "headline figure", page `/company/:id/summary`: /company/:id/summary took 5.2 s

**B8. [medium] slow page: /company/:id/analysis/kpis took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner; P14 Trial-balance-only owner; P37 Viewer
- P11, step "every page of an empty company", page `/company/:id/analysis/kpis`: /company/:id/analysis/kpis took 4.3 s
- P12, step "financial pages", page `/company/:id/analysis/kpis`: /company/:id/analysis/kpis took 4.1 s
- P13, step "financial pages", page `/company/:id/analysis/kpis`: /company/:id/analysis/kpis took 5.2 s

**B9. [medium] slow page: /company/:id/analysis/explorer took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner; P37 Viewer
- P11, step "every page of an empty company", page `/company/:id/analysis/explorer`: /company/:id/analysis/explorer took 4.8 s
- P12, step "financial pages", page `/company/:id/analysis/explorer`: /company/:id/analysis/explorer took 4.3 s
- P13, step "financial pages", page `/company/:id/analysis/explorer`: /company/:id/analysis/explorer took 5.0 s

**B10. [medium] slow page: /company/:id/analysis/profitability took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner; P37 Viewer
- P11, step "every page of an empty company", page `/company/:id/analysis/profitability`: /company/:id/analysis/profitability took 3.6 s
- P12, step "financial pages", page `/company/:id/analysis/profitability`: /company/:id/analysis/profitability took 5.2 s
- P13, step "financial pages", page `/company/:id/analysis/profitability`: /company/:id/analysis/profitability took 4.5 s

**B11. [medium] slow page: /company/:id/analysis/financials took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner; P14 Trial-balance-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/financials`: /company/:id/analysis/financials took 4.3 s
- P12, step "financial pages", page `/company/:id/analysis/financials`: /company/:id/analysis/financials took 4.8 s
- P13, step "financial pages", page `/company/:id/analysis/financials`: /company/:id/analysis/financials took 4.1 s

**B12. [medium] slow page: /company/:id/sales took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P15 Sales manager; P37 Viewer
- P11, step "every page of an empty company", page `/company/:id/sales`: /company/:id/sales took 4.6 s
- P12, step "sales and expenses derived from the ledger", page `/company/:id/sales`: /company/:id/sales took 3.2 s
- P15, step "sales pages", page `/company/:id/sales`: /company/:id/sales took 3.3 s

**B13. [medium] slow page: /company/:id/analysis/cashflow took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/cashflow`: /company/:id/analysis/cashflow took 3.9 s
- P12, step "financial pages", page `/company/:id/analysis/cashflow`: /company/:id/analysis/cashflow took 4.8 s
- P13, step "financial pages", page `/company/:id/analysis/cashflow`: /company/:id/analysis/cashflow took 5.3 s

**B14. [medium] slow page: /company/:id/analysis/growth took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/growth`: /company/:id/analysis/growth took 4.6 s
- P12, step "financial pages", page `/company/:id/analysis/growth`: /company/:id/analysis/growth took 5.4 s
- P13, step "financial pages", page `/company/:id/analysis/growth`: /company/:id/analysis/growth took 4.7 s

**B15. [medium] slow page: /company/:id/analysis/trend took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/trend`: /company/:id/analysis/trend took 5.3 s
- P12, step "financial pages", page `/company/:id/analysis/trend`: /company/:id/analysis/trend took 4.9 s
- P13, step "financial pages", page `/company/:id/analysis/trend`: /company/:id/analysis/trend took 4.0 s

**B16. [medium] slow page: /company/:id/analysis/goalseek took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/goalseek`: /company/:id/analysis/goalseek took 4.5 s
- P12, step "financial pages", page `/company/:id/analysis/goalseek`: /company/:id/analysis/goalseek took 4.6 s
- P13, step "financial pages", page `/company/:id/analysis/goalseek`: /company/:id/analysis/goalseek took 3.9 s

**B17. [medium] slow page: /company/:id/analysis/forecast took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/forecast`: /company/:id/analysis/forecast took 5.8 s
- P12, step "financial pages", page `/company/:id/analysis/forecast`: /company/:id/analysis/forecast took 5.2 s
- P13, step "financial pages", page `/company/:id/analysis/forecast`: /company/:id/analysis/forecast took 4.4 s

**B18. [medium] slow page: /company/:id/analysis/real-profit took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P13 Statements-only owner
- P11, step "every page of an empty company", page `/company/:id/analysis/real-profit`: /company/:id/analysis/real-profit took 4.1 s
- P12, step "financial pages", page `/company/:id/analysis/real-profit`: /company/:id/analysis/real-profit took 4.6 s
- P13, step "financial pages", page `/company/:id/analysis/real-profit`: /company/:id/analysis/real-profit took 4.2 s

**B19. [medium] slow page: /company/:id/data/checks took N s**

- Personas: P11 Brand-new owner with no data; P12 Odoo GL accountant; P14 Trial-balance-only owner
- P11, step "every page of an empty company", page `/company/:id/data/checks`: /company/:id/data/checks took 3.0 s
- P12, step "data section", page `/company/:id/data/checks`: /company/:id/data/checks took 3.5 s
- P14, step "pages after a TB", page `/company/:id/data/checks`: /company/:id/data/checks took 3.1 s

**B20. [medium] console error: Failed to load resource: the server responded with a status of N (Not Found)**

- Personas: P07 URL tamperer; P29 Company deleter
- P07, step "malformed ids and paths", page `/company/:id/nope`: Failed to load resource: the server responded with a status of 404 (Not Found)
- P07, step "malformed ids and paths", page `/r/not-a-token`: Failed to load resource: the server responded with a status of 404 (Not Found)
- P29, step "old links are 404", page `/company/:id/summary`: Failed to load resource: the server responded with a status of 404 (Not Found)

**B21. [medium] slow page: /demo/summary took N s**

- Personas: P02 Demo explorer (desktop); P04 Arabic-speaking visitor
- P02, step "every demo page", page `/demo/summary`: /demo/summary took 3.2 s
- P04, step "open demo", page `/demo/summary`: /demo/summary took 3.5 s

**B22. [medium] slow page: /company/:id/expenses/trend took N s**

- Personas: P11 Brand-new owner with no data; P16 Cost controller
- P11, step "every page of an empty company", page `/company/:id/expenses/trend`: /company/:id/expenses/trend took 3.1 s
- P16, step "expense pages", page `/company/:id/expenses/trend`: /company/:id/expenses/trend took 3.0 s

**B23. [medium] slow page: /company/:id/sales/customers took N s**

- Personas: P12 Odoo GL accountant; P15 Sales manager
- P12, step "sales and expenses derived from the ledger", page `/company/:id/sales/customers`: /company/:id/sales/customers took 3.2 s
- P15, step "product and customer tables show figures", page `/company/:id/sales/customers`: /company/:id/sales/customers took 3.0 s

**B24. [medium] slow page: /company/:id/data took N s**

- Personas: P14 Trial-balance-only owner; P32 Data reviewer
- P14, step "pages after a TB", page `/company/:id/data`: /company/:id/data took 3.9 s
- P32, step "data pages", page `/company/:id/data`: /company/:id/data took 3.1 s

**B25. [medium] slow page: /company/:id/analysis/cashflow**

- Personas: P31 Period explorer
- P31, step "every period view", page `/company/:id/analysis/cashflow?cmp=prior`: /company/:id/analysis/cashflow?cmp=prior took 3.0 s
- P31, step "every period view", page `/company/:id/analysis/cashflow?cmp=ly`: /company/:id/analysis/cashflow?cmp=ly took 4.8 s
- P31, step "every period view", page `/company/:id/analysis/cashflow?type=quarter&cmp=ly`: /company/:id/analysis/cashflow?type=quarter&cmp=ly took 3.5 s

**B26. [medium] slow page: /company/:id/analysis/kpis**

- Personas: P31 Period explorer
- P31, step "every period view", page `/company/:id/analysis/kpis?cmp=ly`: /company/:id/analysis/kpis?cmp=ly took 3.2 s
- P31, step "every period view", page `/company/:id/analysis/kpis?type=quarter&cmp=ly`: /company/:id/analysis/kpis?type=quarter&cmp=ly took 3.7 s
- P31, step "every period view", page `/company/:id/analysis/kpis?type=year&cmp=prior`: /company/:id/analysis/kpis?type=year&cmp=prior took 4.2 s

**B27. [medium] slow page: /company/:id/analysis/profitability**

- Personas: P31 Period explorer
- P31, step "every period view", page `/company/:id/analysis/profitability?cmp=ly`: /company/:id/analysis/profitability?cmp=ly took 4.1 s
- P31, step "every period view", page `/company/:id/analysis/profitability?type=quarter&cmp=ly`: /company/:id/analysis/profitability?type=quarter&cmp=ly took 3.4 s
- P31, step "every period view", page `/company/:id/analysis/profitability?type=year&cmp=prior`: /company/:id/analysis/profitability?type=year&cmp=prior took 4.0 s

**B28. [medium] console error: Error: Minified React error #N; visit https://react.dev/errors/N for the full message or use the non-minified dev environment for full errors and additional helpful warnings.**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/not-a-uuid/summary`: Error: Minified React error #441; visit https://react.dev/errors/441 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.
- P07, step "malformed ids and paths", page `/company/not-a-uuid/summary`: Error: Minified React error #441; visit https://react.dev/errors/441 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.

**B29. [medium] slow page: /company/:id/summary**

- Personas: P31 Period explorer
- P31, step "every period view", page `/company/:id/summary?type=quarter&cmp=ly`: /company/:id/summary?type=quarter&cmp=ly took 3.6 s
- P31, step "every period view", page `/company/:id/summary?type=year&cmp=prior`: /company/:id/summary?type=year&cmp=prior took 3.8 s

**B30. [medium] slow page: / took N s**

- Personas: P01 First-time visitor
- P01, step "landing, privacy, terms", page `/`: / took 3.0 s

**B31. [medium] console error: Failed to load resource: the server responded with a status of N (Internal Server Error)**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/not-a-uuid/summary`: Failed to load resource: the server responded with a status of 500 (Internal Server Error)

**B32. [medium] HTTP 404: GET /company/:id/nope**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/not-a-uuid/summary`: GET /company/c178df56-8e38-4cf3-beb7-0f4257e5f549/nope

**B33. [medium] HTTP 404: GET /r/not-a-token**

- Personas: P07 URL tamperer
- P07, step "malformed ids and paths", page `/company/:id/reports/:id`: GET /r/not-a-token

**B34. [medium] slow page: /company/:id/sales/products took N s**

- Personas: P11 Brand-new owner with no data
- P11, step "every page of an empty company", page `/company/:id/sales/products`: /company/:id/sales/products took 3.5 s

**B35. [medium] slow page: /company/:id/sales/trend took N s**

- Personas: P11 Brand-new owner with no data
- P11, step "every page of an empty company", page `/company/:id/sales/trend`: /company/:id/sales/trend took 4.2 s

**B36. [medium] slow page: /company/:id/sales/end-users took N s**

- Personas: P11 Brand-new owner with no data
- P11, step "every page of an empty company", page `/company/:id/sales/end-users`: /company/:id/sales/end-users took 3.9 s

**B37. [medium] slow page: /company/:id/expenses/suppliers took N s**

- Personas: P11 Brand-new owner with no data
- P11, step "every page of an empty company", page `/company/:id/expenses/suppliers`: /company/:id/expenses/suppliers took 3.2 s

**B38. [medium] slow page: /company/:id/inventory/products took N s**

- Personas: P11 Brand-new owner with no data
- P11, step "every page of an empty company", page `/company/:id/inventory/products`: /company/:id/inventory/products took 3.4 s

**B39. [medium] slow page: /company/:id/payments/flows took N s**

- Personas: P11 Brand-new owner with no data
- P11, step "every page of an empty company", page `/company/:id/payments/flows`: /company/:id/payments/flows took 3.1 s

**B40. [medium] slow page: /company/:id/data/upload took N s**

- Personas: P11 Brand-new owner with no data
- P11, step "every page of an empty company", page `/company/:id/data/upload`: /company/:id/data/upload took 3.7 s

**B41. [medium] slow page: /company/:id/data/readiness took N s**

- Personas: P12 Odoo GL accountant
- P12, step "data section", page `/company/:id/data/readiness`: /company/:id/data/readiness took 3.1 s

**B42. [medium] slow page: /company/:id/data/end-users took N s**

- Personas: P12 Odoo GL accountant
- P12, step "data section", page `/company/:id/data/end-users`: /company/:id/data/end-users took 3.2 s

**B43. [medium] expectation: Double-clicking Create report made 2 reports**

- Personas: P23 Double-clicker
- P23, step "double-click Create report": Double-clicking Create report made 2 reports

**B44. [medium] HTTP 404: GET /company/:id/summary**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/companies`: GET /company/1c8c55b3-4c99-4511-9948-9f6a0b5e94f0/summary

**B45. [medium] HTTP 404: GET /company/:id/sales**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/company/:id/summary`: GET /company/1c8c55b3-4c99-4511-9948-9f6a0b5e94f0/sales

**B46. [medium] HTTP 404: GET /company/:id/data**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/company/:id/sales`: GET /company/1c8c55b3-4c99-4511-9948-9f6a0b5e94f0/data

**B47. [medium] HTTP 404: GET /company/:id/reports**

- Personas: P29 Company deleter
- P29, step "old links are 404", page `/company/:id/data`: GET /company/1c8c55b3-4c99-4511-9948-9f6a0b5e94f0/reports

**B48. [medium] slow page: /company/:id/settings/source-data took N s**

- Personas: P32 Data reviewer
- P32, step "old settings URLs redirect", page `/company/:id/settings/source-data`: /company/:id/settings/source-data took 3.8 s

**B49. [medium] console error: Error: An unexpected response was received from the server.     at w (http://localhost:N/_next/static/chunks/1gef-u_vq4uxk.js:2:N)**

- Personas: P41 Session expirer
- P41, step "cookies cleared mid-session", page `/company/:id/settings/profile`: Error: An unexpected response was received from the server.     at w (http://localhost:3100/_next/static/chunks/1gef-u_vq4uxk.js:2:655)

**B50. [medium] console error: {"kind":"section-error"}**

- Personas: P41 Session expirer
- P41, step "cookies cleared mid-session", page `/company/:id/settings/profile`: {"kind":"section-error"}

**B51. [medium] expectation: Saving after the session expired gives no 'sign in again' message**

- Personas: P41 Session expirer
- P41, step "cookies cleared mid-session": Saving after the session expired gives no 'sign in again' message

**B52. [medium] console error: Failed to fetch RSC payload for http://localhost:N/company/:id/analysis/kpis. Falling back to browser navigation. TypeError: Failed to fetch     at n (http://localhost:N/_next/static/chunks/1gef-u_vq4**

- Personas: P42 Offline user
- P42, step "go offline and click a link", page `/company/:id/summary`: Failed to fetch RSC payload for http://localhost:3100/company/68d1ff21-e21d-4e57-8ae9-bfbe6a608244/analysis/kpis. Falling back to browser navigation. TypeError: Failed to fetch     at n (http://localhost:3100/_next/static/chunks/1gef-u_vq4uxk.js:2:36290)     at M (http://localhost:3100/_next/static/

**B53. [low] page content: page wider than screen: 1454px > 1440px (span.num absolute whitespace-nowrap text-[12px] text-ink to 1454px)**

- Personas: P15 Sales manager; P37 Viewer
- P15, step "sales pages", page `/company/:id/sales`: page wider than screen: 1454px > 1440px (span.num absolute whitespace-nowrap text-[12px] text-ink to 1454px)
- P37, step "viewer reads pages", page `/company/:id/sales`: page wider than screen: 1454px > 1440px (span.num absolute whitespace-nowrap text-[12px] text-ink to 1454px)

**B54. [low] page content: page wider than screen: 1458px > 1440px (span.num absolute whitespace-nowrap text-[12px] text-ink to 1458px)**

- Personas: P15 Sales manager
- P15, step "sales pages", page `/company/:id/sales/customers`: page wider than screen: 1458px > 1440px (span.num absolute whitespace-nowrap text-[12px] text-ink to 1458px)
- P15, step "product and customer tables show figures", page `/company/:id/sales/customers`: page wider than screen: 1458px > 1440px (span.num absolute whitespace-nowrap text-[12px] text-ink to 1458px)

**B55. [low] page content: page wider than screen: 350px > 320px (span.num absolute whitespace-nowrap text-[12px] text-ink to 350px)**

- Personas: P46 Tiny-screen user
- P46, step "pages at 320 px", page `/company/:id/sales`: page wider than screen: 350px > 320px (span.num absolute whitespace-nowrap text-[12px] text-ink to 350px)
- P46, step "pages at 320 px", page `/company/:id/sales/products`: page wider than screen: 350px > 320px (span.num absolute whitespace-nowrap text-[12px] text-ink to 350px)

**B56. [low] expectation: Arabic mode: page heading still English on /demo/data/upload: "Data"**

- Personas: P04 Arabic-speaking visitor
- P04, step "Arabic pages read without English leftovers in headings", page `/demo/data/upload`: Arabic mode: page heading still English on /demo/data/upload: "Data"

**B57. [low] expectation: Arabic mode: page heading still English on /demo/settings/profile: "Company Profile"**

- Personas: P04 Arabic-speaking visitor
- P04, step "Arabic pages read without English leftovers in headings", page `/demo/settings/profile`: Arabic mode: page heading still English on /demo/settings/profile: "Company Profile"

**B58. [low] expectation: Keyboard: the focused element shows no focus ring**

- Personas: P05 Keyboard-only user
- P05, step "tab through the sign-in form": Keyboard: the focused element shows no focus ring

**B59. [low] expectation: No personal data export button on /account**

- Personas: P35 Privacy-minded user
- P35, step "personal data export": No personal data export button on /account

**B60. [low] expectation: Dark mode /summary: 1 text elements below 3:1 contrast (e.g. Data readiness)**

- Personas: P47 Dark-mode, reduced-motion user
- P47, step "text is readable in dark mode", page `/company/:id/summary`: Dark mode /summary: 1 text elements below 3:1 contrast (e.g. Data readiness)

**B61. [low] expectation: Dark mode /data: 5 text elements below 3:1 contrast (e.g. Trial Balance \| Sales detail \| Stock)**

- Personas: P47 Dark-mode, reduced-motion user
- P47, step "text is readable in dark mode", page `/company/:id/data`: Dark mode /data: 5 text elements below 3:1 contrast (e.g. Trial Balance \| Sales detail \| Stock)

**B62. [low] expectation: Dark mode /settings/profile: 2 text elements below 3:1 contrast (e.g. Company Profile Currency, year \| Company Profile)**

- Personas: P47 Dark-mode, reduced-motion user
- P47, step "text is readable in dark mode", page `/company/:id/settings/profile`: Dark mode /settings/profile: 2 text elements below 3:1 contrast (e.g. Company Profile Currency, year \| Company Profile)

## 2. Server log (Next.js)

| # | Severity | Line (normalised) | Count |
|---|---|---|---|
| S1 | high | digest: 'N' | 2 |
| S2 | high | ⨯ Error: The membership could not be checked | 1 |
| S3 | high | {"level":"error","digest":"N","message":"The membership could not be checked","stack":"Error: The membership could not be checked\n    at /home/user/fathom/.next/server/chunks/ssr/src_lib_company_load_ts_0uwvyu7aovr2q._.js:1:N\n | 1 |
| S4 | high | ⨯ TypeError: Cannot read properties of null (reading 'org_id') | 1 |
| S5 | high | {"level":"error","digest":"N","message":"Cannot read properties of null (reading 'org_id')","stack":"TypeError: Cannot read properties of null (reading 'org_id')\n    at f (/home/user/fathom/.next/server/chunks/ssr/[root-of-the-ser | 1 |

## 3. Database log (Postgres)

| # | Severity | Level | Message (normalised) | Count |
|---|---|---|---|---|
| D1 | medium | ERROR | invalid input syntax for type uuid: "not-a-uuid" | 3 |

## 4. Slowest pages (p95)

| Page | Loads | p50 | p95 | Max |
|---|---|---|---|---|
| `/company/:id/analysis/forecast` | 3 | 5.21 s | 5.81 s | 5.81 s |
| `/company/:id/summary` | 25 | 3.64 s | 5.67 s | 8.57 s |
| `/company/:id/analysis/growth` | 3 | 4.70 s | 5.36 s | 5.36 s |
| `/company/:id/analysis/trend` | 3 | 4.94 s | 5.28 s | 5.28 s |
| `/company/:id/analysis/cashflow` | 10 | 3.93 s | 5.28 s | 5.28 s |
| `/company/:id/analysis/kpis` | 12 | 3.83 s | 5.24 s | 5.24 s |
| `/company/:id/analysis/profitability` | 12 | 3.59 s | 5.16 s | 5.16 s |
| `/company/:id/analysis/explorer` | 4 | 4.77 s | 4.96 s | 4.96 s |
| `/company/:id/analysis/financials` | 7 | 4.07 s | 4.84 s | 4.84 s |
| `/company/:id/analysis/goalseek` | 3 | 4.45 s | 4.60 s | 4.60 s |
| `/company/:id/analysis/real-profit` | 3 | 4.24 s | 4.58 s | 4.58 s |
| `/company/:id/sales` | 8 | 3.20 s | 4.55 s | 4.55 s |
| `/company/:id/sales/trend` | 4 | 2.12 s | 4.16 s | 4.16 s |
| `/company/:id/data` | 9 | 2.49 s | 3.92 s | 3.92 s |
| `/company/:id/sales/end-users` | 4 | 2.51 s | 3.90 s | 3.90 s |
| `/company/:id/settings/source-data` | 1 | 3.81 s | 3.81 s | 3.81 s |
| `/company/:id/data/upload` | 5 | 1.94 s | 3.65 s | 3.65 s |
| `/company/:id/sales/products` | 7 | 2.03 s | 3.54 s | 3.54 s |
| `/demo/summary` | 5 | 2.63 s | 3.47 s | 3.47 s |
| `/company/:id/data/checks` | 5 | 3.03 s | 3.46 s | 3.46 s |
| `/company/:id/inventory/products` | 2 | 3.45 s | 3.45 s | 3.45 s |
| `/company/:id/sales/customers` | 5 | 2.73 s | 3.21 s | 3.21 s |
| `/company/:id/expenses/suppliers` | 4 | 2.53 s | 3.19 s | 3.19 s |
| `/company/:id/data/end-users` | 3 | 2.55 s | 3.18 s | 3.18 s |
| `/company/:id/payments/flows` | 2 | 3.13 s | 3.13 s | 3.13 s |

Load burst (10 tabs × 4 heavy pages at once): median 7.3 s, p95 9.8 s, slowest 9.9 s.

Throttled connection (400 ms latency, 200 KB/s): summary 0.8 s, sales 1.1 s, sales/products 1.5 s, data 0.8 s, reports 0.6 s.

## 5. Personas and their journeys

| Persona | Goal | Steps ok | Issues (crit/high/med/low) |
|---|---|---|---|
| P01 First-time visitor | Reads the landing page, legal pages, then tries the demo | 2/2 | 0/0/1/0 |
| P02 Demo explorer (desktop) | Clicks through every demo page | 1/1 | 0/0/1/0 |
| P03 Demo explorer on a phone | Browses the demo on a Pixel 7 | 2/2 | 0/0/0/0 |
| P04 Arabic-speaking visitor | Switches the site to Arabic and reads the demo right to left | 3/3 | 0/0/1/2 |
| P05 Keyboard-only user | Signs in using only the keyboard | 1/1 | 0/0/0/1 |
| P06 Deep-linker without an account | Opens bookmarked company and admin URLs while signed out | 2/2 | 0/0/0/0 |
| P07 URL tamperer | Edits the URL by hand: bad ids, long strings, path tricks | 4/4 | 0/2/7/0 |
| P08 Sign-up form tester | Tries to sign up with empty, invalid and weak details | 3/3 | 0/0/0/0 |
| P09 Forgetful user | Types the wrong password repeatedly, then asks for a reset | 4/4 | 0/0/0/0 |
| P10 Shared-report reader | Opens a published report link without an account, then after it is withdrawn | 6/6 | 0/0/0/0 |
| P11 Brand-new owner with no data | Signs up, creates a company and opens every page before uploading anything | 3/3 | 0/0/21/0 |
| P12 Odoo GL accountant | Uploads GL + TB + P&L together and reads every financial page | 6/6 | 0/0/16/0 |
| P13 Statements-only owner | Uploads a P&L + balance sheet export and checks the headline | 5/5 | 0/0/12/0 |
| P14 Trial-balance-only owner | Uploads only a trial balance | 4/4 | 0/0/5/0 |
| P15 Sales manager | Uploads Invoice Analysis and studies customers and products | 5/5 | 0/0/2/3 |
| P16 Cost controller | Uploads vendor bills and studies suppliers | 5/5 | 0/0/1/0 |
| P17 Credit controller | Uploads ageing reports and payments and checks receivables | 5/5 | 0/0/0/0 |
| P18 Wrong-file uploader | Drops each file in the wrong upload step | 6/6 | 0/0/0/0 |
| P19 Corrupt-file uploader | Uploads random bytes, an empty CSV and a renamed text file | 10/10 | 0/0/0/0 |
| P20 Double uploader | Uploads the same files twice and expects nothing doubled | 5/5 | 0/1/1/0 |
| P21 Messy-spreadsheet owner | Uploads a hand-made sales CSV with header on row 3, totals and blanks | 3/3 | 0/0/0/0 |
| P22 Upload abandoner | Starts an upload, leaves mid-review, comes back | 5/5 | 0/0/0/0 |
| P23 Double-clicker | Clicks every save button twice, fast | 5/5 | 0/0/1/0 |
| P24 Back-button user | Uses the browser Back button inside the upload wizard | 4/4 | 0/0/0/0 |
| P25 Settings tinkerer | Changes profile, financial year, targets, KPIs and alerts | 5/5 | 0/1/0/0 |
| P26 Chart-of-accounts fixer | Reclassifies accounts and checks the analysis follows | 5/5 | 0/0/0/0 |
| P27 Report maker | Creates, edits, downloads and deletes a report | 6/6 | 0/1/0/0 |
| P28 Data clearer | Clears one module, then checks the pages say 'no data' rather than zero | 6/6 | 0/0/0/0 |
| P29 Company deleter | Deletes a company and tries its old links | 6/6 | 0/0/8/0 |
| P30 Portfolio manager | Runs three companies and compares them | 3/3 | 0/1/0/0 |
| P31 Period explorer | Switches month, quarter, year and comparisons on every financial page | 5/5 | 0/0/12/0 |
| P32 Data reviewer | Walks the Data steps, checks and readiness after a full upload | 7/7 | 0/0/2/0 |
| P33 Stock manager without stock files | Opens inventory pages before any stock upload | 5/5 | 0/0/0/0 |
| P34 AI commentary requester | Asks for AI commentary on the summary | 5/5 | 0/1/1/0 |
| P35 Privacy-minded user | Exports their data, renames themselves, reads the account page | 6/6 | 0/0/0/1 |
| P36 Organisation admin | Invites an editor and a viewer, then changes a role | 7/7 | 0/0/0/0 |
| P37 Viewer | Has view-only access and tries to change things anyway | 7/7 | 0/1/5/1 |
| P38 Editor | Can upload, but should not delete the company or manage people | 7/7 | 0/0/0/0 |
| P39 Outsider | A user from another firm tries to reach a company that isn't theirs | 6/6 | 0/0/0/0 |
| P40 Removed member | Loses access while signed in, then keeps clicking | 7/7 | 0/0/1/0 |
| P41 Session expirer | Leaves the tab open, the session expires, then acts | 5/5 | 0/0/3/0 |
| P42 Offline user | Loses the connection and keeps clicking | 5/5 | 0/0/3/0 |
| P43 Slow-connection user | Uses the site over a throttled 3G-like connection | 5/5 | 0/0/0/0 |
| P44 Two-tab worker | Uploads in one tab while another tab shows the old figures | 5/5 | 0/0/0/0 |
| P45 Busy Monday (load burst) | Ten colleagues open the same company's heavy pages at once | 7/7 | 0/0/0/0 |
| P46 Tiny-screen user | Uses a 320-pixel-wide phone | 6/6 | 0/0/0/2 |
| P47 Dark-mode, reduced-motion user | Prefers dark colours and no animation | 4/4 | 0/0/0/3 |
| P48 Rapid navigator | Clicks through tabs faster than pages load | 5/5 | 0/1/0/0 |
| P49 Odoo live connector tester | Tries to connect Odoo with bad addresses | 4/4 | 0/0/0/0 |
| P50 Opening-balances newcomer | Loads opening balances first, then the ledger | 1/5 | 0/1/0/0 |

### Failed or skipped steps

- **P50** create company: expect(page).toHaveURL(expected) failed \| Expected pattern: /\/company\/[0-9a-f-]{36}\/data/ \| Received string:  "http://localhost:3100/companies"
- **P50** opening card accepts a trial balance: skipped (an earlier critical step failed)
- **P50** then the ledger: skipped (an earlier critical step failed)
- **P50** pages after opening + ledger: skipped (an earlier critical step failed)

## How to re-run

```bash
bash scripts/personas/run.sh            # fresh stack, build, 50 personas, this report
SKIP_STACK=1 SKIP_BUILD=1 bash scripts/personas/run.sh -g P37   # one persona against what is running
```

Raw results: `test-results/personas/` (one JSON per persona, screenshots, server, database and import logs). They are not committed.
