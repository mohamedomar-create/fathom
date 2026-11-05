# Universal ERP & Excel Analytics Layer — Master Functional Catalog and Claude Code Project Reference

> **Purpose:** A durable project-reference document for a vendor-agnostic analytics SaaS that can ingest exports from ERP platforms and manual Excel/CSV sheets, normalize them, and generate trustworthy dashboards, KPIs, controls, and insights.
>
> **Primary audience:** Claude Code and engineers building the analytics layer.
>
> **Repository copy:** anonymised (the pilot company is not named). The owner keeps the original privately.
>
> **Status:** Requirements/reference, **not** a statement that every listed module exists natively in every ERP or that connectors have already been implemented.
>
> **Project context:** Existing stack: Claude Code + GitHub + Vercel + Supabase. Initial use cases include Odoo exports and messy Excel workbooks, with eventual support for SAP, Microsoft Dynamics, Oracle, ERPNext, Zoho, and other systems. Prior known engineering pain points include slow uploads, UI freezes, inconsistent validation, and fragile Excel transformations. Design for a multi-tenant SaaS and for auditable financial/business outputs.

---

## 1. Executive product vision and non-negotiable principles

**Product:** An ERP-independent business analytics layer. Users connect an ERP, upload ERP exports, or upload manually prepared spreadsheets; the platform identifies the data, maps it to universal business entities, validates it, calculates metrics consistently, and presents management-ready insights.

**Three ingestion scenarios:**
1. **ERP-connected:** API/database/feed integration (where authorized and technically supported).
2. **ERP-exported:** XLSX/CSV/other downloadable reports from ERP applications.
3. **Manual:** Excel workbooks built by accountants, salespeople, warehouse managers, and business owners without an ERP.

**Design requirements:**
- **ERP-agnostic:** Never hard-code application names or Odoo-only schemas into universal KPI definitions.
- **Module-aware:** Recognize which business modules are present in each upload; do not require all modules.
- **Progressive onboarding:** First deliver value from one file; enrich analysis as more linked tables are uploaded.
- **Evidence-first:** Every KPI traces to input files, source rows, mapping rules, filters, and calculation versions.
- **Correctness over impressive charts:** Distinguish booked sales, invoices, payments, cash collections, credit notes, orders, stock movements, and balances.
- **Country-aware:** Currency, tax, calendars, accounting conventions, and date formats are configurable. Egypt is a first market, not an assumption in core schemas.
- **Multi-tenant isolation:** Strict authorization/RLS and data isolation. Uploaded records may be commercially sensitive or contain personal data.
- **Fast and resilient:** Large files must not lock the browser or block the request thread; imports should be asynchronous with progress, resumability or safe retry, and clear failure diagnostics.
- **Explainable AI:** AI may suggest mappings, anomalies, descriptions, and narratives, but calculations must be deterministic and inspectable.
- **Licensing caution:** ERP-specific features and module names vary by vendor, edition, country, version, package, and installed extensions. A coverage label is not proof of an enabled feature.

---

## 2. Platforms in scope

| Platform | Positioning | Examples of product families / distinctions | Integration planning note |
|---|---|---|---|
| **Odoo** | Modular integrated ERP and business apps | Community vs Enterprise, version- and localization-dependent | Start with exports; design separate API adapter |
| **SAP S/4HANA** | Enterprise ERP | SAP Cloud ERP/S/4HANA, plus complementary SAP products | SAP Ariba, SuccessFactors, Concur, IBP, SAC are separate apps/products, not necessarily S/4HANA modules |
| **SAP Business One** | Small/mid-market ERP | Different architecture and modules from S/4HANA | Distinct connector/schema adapter |
| **Microsoft Dynamics 365** | Suite of ERP and CRM applications | Business Central, Finance, Supply Chain Management, Sales, Customer Service, Field Service, etc. | Business Central and Finance/Supply Chain are distinct products; Power Platform is adjacent |
| **Oracle Fusion Cloud Applications** | Enterprise application suite | ERP, SCM, HCM, CX, EPM | These are cloud application families, not a single monolithic module list |
| **Oracle NetSuite** | Cloud ERP | Accounting, supply chain, CRM, commerce, analytics, etc. | Separate adapter from Oracle Fusion |
| **ERPNext / Frappe** | Open-source ERP ecosystem | ERPNext and separately packaged Frappe HR | Map independent doctypes/exports into universal entities |
| **Zoho One** | Broad business application suite | Books, Inventory, CRM, People, Analytics, Creator, etc. | Integrated suite, not equivalent to one unified ERP database |
| **Other ERP/manual systems** | Extensible | Sage, Infor, Acumatica, Epicor, QuickBooks, Xero, industry-specific ERPs, custom systems, spreadsheets | Plug-in adapter approach; never assume naming conventions |

**Vendor sources for future periodic verification:**
- Odoo: https://www.odoo.com/page/all-apps
- SAP Business One: https://help.sap.com/docs/SAP_BUSINESS_ONE
- SAP S/4HANA: https://learning.sap.com/products/s4hana-cloud
- Microsoft Dynamics 365: https://www.microsoft.com/en-us/dynamics-365/what-is-dynamics-365
- Oracle Fusion Cloud: https://docs.oracle.com/en/cloud/saas/
- Oracle NetSuite: https://www.netsuite.com/portal/products.shtml
- ERPNext: https://docs.erpnext.com/
- Zoho One: https://www.zoho.com/one/applications/web.html

These links are vendor reference entry points; verify exact modules and availability before implementing vendor-specific claims or integrations.

---

## 3. Universal master module catalog (22 functional domains)

> **Critical:** These are **functional domains and sub-capabilities**, not 22 guaranteed native modules in every ERP. Use them as the application taxonomy for the analytics system.

| Domain ID | Department / functional domain | Functional modules and submodules | Analytics candidates |
|---|---|---|---|
| FIN | **1. Finance & Accounting** | General Ledger; Accounts Receivable; Accounts Payable; Bank & Cash Management; Bank Reconciliation; Fixed Assets; Cost Accounting; Tax Management; Budget Management; Financial Statements; Multi-Currency; Multi-Company Accounting; Intercompany Transactions; Financial Consolidation; Closing & Reconciliation; Deferred Revenue; Revenue Recognition; Expense Management; Financial Audit | Revenue, gross margin, AR/AP aging, DSO, DPO, cash balances, budget variance, expense mix, intercompany eliminations |
| TRE | **2. Treasury & Financial Control** | Cash Flow Forecasting; Working Capital Management; Debt & Loan Management; Credit Management; Collection Management; Payment Scheduling; Liquidity Management; Treasury Operations; Financial Risk Management; Profitability Analysis; Financial Planning & Analysis (FP&A) | 13-week cash forecast, working-capital trend, collections forecast, payment commitments, liquidity coverage, forecast accuracy |
| SAL | **3. Sales & Distribution** | Quotations; Sales Orders; Pricing & Discounts; Sales Contracts; Customer Management; Sales Targets; Commissions & Incentives; Territory Management; Sales Forecasting; Sales Returns; Distribution Management; Dealer & Distributor Management; Key Account Management | Orders, bookings, conversion, revenue, discounts, margin by territory, sales rep attainment, returns |
| CRM | **4. Customer Relationship Management** | Leads; Opportunities; Sales Pipeline; Customer Segmentation; Activity Tracking; Customer Visits; Account Planning; Sales Team Performance; Customer History; Sales Automation; Customer Portals; Customer Analytics | Pipeline velocity, stage conversion, win rate, account coverage, lead source ROI, sales cycle |
| PUR | **5. Procurement & Supplier Management** | Purchase Requisitions; RFQs; Purchase Orders; Purchase Agreements; Supplier Evaluation; Supplier Performance; Supplier Contracts; Strategic Sourcing; Procurement Planning; Purchase Approvals; Supplier Portals; Vendor Payment Tracking | Spend by supplier, price variance, lead times, on-time delivery, outstanding PO commitments, supplier concentration |
| INV | **6. Inventory & Warehousing** | Stock Management; Multi-Warehouse; Stock Transfers; Lot & Batch Tracking; Serial Number Tracking; Barcode Operations; Expiry Date Tracking; Reordering Rules; Safety Stock; Inventory Valuation; Cycle Counting; WMS; Stock Forecasting; Consignment Stock | Inventory turnover, stockouts, aged stock, days on hand, expiry exposure, stock accuracy, serial/batch traceability |
| SCM | **7. Supply Chain & Logistics** | Demand Planning; Supply Planning; Distribution Planning; Import Management; Export Management; Freight Management; Shipment Tracking; Transportation Management; Delivery Scheduling; Landed Cost; Customs & Trade Compliance; Returns Logistics; 3PL | OTIF, forecast accuracy, freight cost/unit, import lead time, landed cost variance, fulfillment cycle time |
| MFG | **8. Manufacturing & Production** | BOM; Manufacturing Orders; MRP; Production Scheduling; Work Centers; Shop Floor Control; Production Costing; Capacity Planning; Routing; Subcontracting; MES; Production Quality Control | Yield, scrap, OEE where measurable, schedule adherence, variance to standard cost, capacity utilization |
| QMS | **9. Quality Management** | Quality Inspections; Incoming Goods Inspection; Quality Control Plans; Nonconformity Management; CAPA; Supplier Quality; Quality Audits; Document Control; Product Traceability; Complaints Management | Defect rates, CAPA aging, audit findings, supplier defects, complaint recurrence |
| MNT | **10. Maintenance & Asset Management** | Preventive Maintenance; Corrective Maintenance; Equipment Registry; Asset Lifecycle; Maintenance Requests; Work Orders; Spare Parts Management; Calibration Scheduling; Equipment Downtime; Maintenance Contracts; Maintenance Costs; Asset Performance | MTTR, MTBF when data supports it, PM completion, uptime, service costs, calibration overdue, warranty recovery |
| HRM | **11. Human Resources** | Employee Database; Organization Structure; Recruitment/ATS; Onboarding; Attendance; Leave Management; Payroll; Employee Benefits; Performance Appraisals; Training & Development; Talent Management; Succession Planning; Employee Self-Service; Disciplinary Procedures; Offboarding | Headcount, attrition, time-to-hire, absence, overtime, payroll ratio, training compliance |
| PRJ | **12. Project & Task Management** | Project Planning; Task Management; Milestones; Resource Allocation; Timesheets; Project Budgeting; Project Costing; Project Profitability; PPM; Gantt Scheduling; Project Billing; Internal Projects | Milestone delivery, planned vs actual cost/hours, utilization, project profitability, overdue tasks |
| SVC | **13. Service & After-Sales** | Customer Support; Helpdesk; Ticketing; Field Service; Technician Dispatch; Installation Management; Service Contracts; Warranty Management; Repairs; Spare Parts Consumption; SLAs; Customer Service History | SLA compliance, response time, first-time fix, technician productivity, service margin, installed-base coverage |
| RNT | **14. Rental & Subscription** | Equipment Rental; Rental Contracts; Asset Check-in/Check-out; Rental Invoicing; Subscription Billing; Recurring Contracts; Renewal Management; Rental Availability; Asset Utilization; Contract Expiration Alerts | Rental fleet utilization, recurring revenue, churn, downtime, overdue returns, renewal rate |
| MKT | **15. Marketing** | Campaign Management; Email Marketing; SMS Marketing; Social Media; Lead Generation; Marketing Automation; Events; Customer Segmentation; Marketing ROI; Surveys; Loyalty Programs; Digital Campaign Analytics | Campaign attribution, CAC where defensible, qualified leads, event ROI, funnel conversion |
| RET | **16. Retail & E-Commerce** | POS; E-Commerce; Online Catalog; Online Payments; Product Promotions; Store Management; Customer Loyalty; Multi-Channel Sales; Returns; Customer Web Portal | Conversion, average order value, basket size, gross margin, return rate, channel mix |
| DOC | **17. Document & Workflow Management** | DMS; Digital Signatures; Approval Workflows; Contract Management; Document Version Control; Knowledge Management; Internal Policies; SOP Management; Digital Forms; Business Process Automation | Approval lead time, overdue contracts, document compliance, process cycle time, exception count |
| BI | **18. Business Intelligence & Analytics** | Dashboards; KPI Management; Financial Analytics; Sales Analytics; Inventory Analytics; HR Analytics; Forecasting; Budget vs Actual; Management Reports; Executive Scorecards; Data Warehousing; Self-Service BI | Cross-functional metric catalog, drilldown, segment comparisons, scenario and variance analysis |
| GRC | **19. Governance, Risk & Compliance** | Access Control; Approval Authority Matrix; Audit Trails; Segregation of Duties; Risk Register; Compliance Management; Internal Audit; Regulatory Reporting; Fraud Monitoring; Policy Management; Business Continuity | Control exceptions, audit trail completeness, policy noncompliance, high-risk transactions |
| IT | **20. IT, Integrations & Automation** | API Management; Data Integration; Workflow Automation; Low-Code Development; AI Agents; Data Import/Export; System Administration; User Permissions; Integration Monitoring; Mobile Applications; IoT Connectivity | Import reliability, connector latency, mapping quality, refresh success, integration errors |
| HCD | **21. Healthcare & Medical Devices** | Medical Device Installed Base; Device Serial History; Calibration Records; Regulatory Documentation; Complaint & Vigilance Tracking; Equipment Installation; Homecare Patient Management; Consumable Utilization; Device Rentals; Preventive Maintenance; Recall & Field Safety Management; Patient/Device Monitoring | Device uptime, utilization, consumables/device, contract service coverage, traceability, regulatory deadlines |
| STR | **22. Strategic & Corporate Management** | Corporate Budgeting; Strategic Planning; OKRs; Departmental KPIs; Performance Scorecards; Investment Evaluation; Branch Performance; Business Unit Profitability; EPM; Scenario Planning | Strategic scorecard, strategic goal variance, growth and profitability drivers, cash-conversion cycle |

### 3.1 Distinguish primary domains from cross-cutting capabilities

- **Finance, Sales, Purchasing, Inventory, HR, and Service** may contain transactional source records.
- **BI, GRC, Document Workflow, IT, and Strategic Management** are often cross-cutting capabilities spanning several transactional domains.
- **Healthcare** is an industry overlay that enriches assets, customers, service, rentals, quality, and regulatory data.
- **Treasury** may be provided as separate applications in some ecosystems and subfeatures of finance in others.
- **CRM, marketing, service, and financial data** may live in different software even within the same organization; integrate by business identifiers, not vendor names.

---

## 4. ERP platform-specific application catalogs

> Snapshot/reference list; verify against vendor editions, localizations, and versions. Product catalog names may change. These lists describe major application areas; they are not exhaustive SKU/license inventories.

### 4.1 Odoo — major applications

- **Finance:** Accounting; Invoicing; Expenses; Documents; Spreadsheets; Sign; ESG (availability dependent).
- **Sales:** CRM; Sales; Point of Sale; Subscriptions; Rental.
- **Supply chain / operations:** Inventory; Manufacturing; PLM; Purchase; Maintenance; Quality.
- **HR:** Employees; Recruitment; Time Off; Appraisals; Payroll; Referrals; Fleet.
- **Marketing:** Email Marketing; SMS Marketing; Marketing Automation; Social Marketing; Events; Surveys.
- **Services / productivity:** Project; Timesheets; Field Service; Helpdesk; Planning; Appointments; Discuss; Approvals; Knowledge.
- **Web:** Website; eCommerce; Blog; Forum; eLearning; Live Chat.
- **Technical:** IoT; VoIP; Studio; AI-related capabilities (version/edition dependent).

**Adapter note:** Odoo model names, fields, and export shapes vary with version, localization, and custom modules. Do not embed Odoo column names in canonical KPI logic.

### 4.2 SAP S/4HANA and SAP ecosystem

- **S/4HANA functional areas:** Finance; Treasury; Financial Risk; Sourcing & Procurement; Sales; Service; Supply Chain; Manufacturing; Product Engineering; Asset Management; Warehouse Management; Transportation Management; Project and Professional Services; Industry capabilities.
- **Separate/complementary SAP products (not assumed native S/4HANA modules):** SAP Ariba (procurement); SAP SuccessFactors (HCM); SAP Concur (travel/expense); SAP Integrated Business Planning (supply planning); SAP Analytics Cloud (analytics/planning).

### 4.3 SAP Business One

- Administration; Financials; Sales Opportunities; Sales – A/R; Purchasing – A/P; Business Partners; Banking; Inventory; Resources; Production; Material Requirements Planning; Service; Human Resources; Reporting.
- Additional versions/add-ons support projects, fixed assets, approvals, and vertical-specific capabilities.

### 4.4 Microsoft Dynamics 365 ecosystem

- **Dynamics 365 applications:** Business Central; Finance; Supply Chain Management; Sales; Customer Service; Contact Center; Customer Insights; Field Service; Project Operations; Human Resources; Commerce.
- **Complementary Power Platform / analytics:** Power BI; Power Apps; Power Automate; Power Pages; Copilot Studio.
- **Critical distinction:** Business Central and Finance/Supply Chain Management have different domain models and connector approaches. CRM applications may be separate data sources.

### 4.5 Oracle Fusion Cloud Applications

- **ERP/EPM:** Financials; Accounting Hub; Procurement; Project Management; Risk Management; ERP Analytics; Enterprise Performance Management.
- **SCM:** Supply Chain Planning; Inventory; Manufacturing; Maintenance; Logistics; Order Management; Product Lifecycle Management.
- **HCM:** Core HR; Payroll; Talent Management; Workforce Management.
- **CX:** Sales Automation; Customer Data Management; Marketing; Commerce; Service; Field Service; CPQ; Subscription Management.

### 4.6 Oracle NetSuite

- Financial Management; Accounting; Global Business Management; Enterprise Performance Management; Inventory Management; Order Management; Procurement; Supply Chain Management; Warehouse & Fulfillment; Manufacturing; CRM; Professional Services Automation; Commerce; SuiteAnalytics; SuiteCloud.

### 4.7 ERPNext / Frappe

- Accounting; Selling; Buying; Stock; Manufacturing; CRM; Projects; Assets; Quality; Support; Website; POS; Order Management; Reporting; Setup; Contacts.
- HR and payroll capabilities are typically provided by the associated **Frappe HR** application.

### 4.8 Zoho One ecosystem

- CRM; Bigin; Books; Invoice; Billing; Expense; Inventory; Payroll; Recruit; People; Projects; Sprints; Desk; Assist; Lens; Campaigns; Marketing Automation; Social; SalesIQ; Sites; Commerce; Analytics; DataPrep; Creator; Flow; RPA; Contracts; Sign; Forms; Survey; WorkDrive; Mail; Cliq; Meeting; Vault.
- **Critical distinction:** Zoho One is an application suite; integration and shared identifiers between applications require explicit mapping.

---

## 5. Qualitative functional coverage comparison

**Legend:** **Strong** = established product/ecosystem offering; **Conditional** = narrower, separate app, configuration, partner, or customization often needed; **Not core** = not generally a first-party native core feature. This is an indicative architecture-planning map, **not** a procurement or licensing assessment.

| Capability | Odoo | SAP S/4HANA ecosystem | Dynamics 365 ecosystem | Oracle Fusion | ERPNext | Zoho One |
|---|---|---|---|---|---|---|
| Accounting & finance | Strong | Strong | Strong | Strong | Strong | Strong |
| Treasury / cash flow | Conditional | Strong | Strong | Strong | Conditional | Conditional |
| Sales & CRM | Strong | Strong | Strong | Strong | Strong | Strong |
| Purchasing | Strong | Strong | Strong | Strong | Strong | Conditional |
| Inventory | Strong | Strong | Strong | Strong | Strong | Strong |
| Advanced warehousing | Conditional | Strong | Strong | Strong | Conditional | Conditional |
| Manufacturing / MRP | Strong | Strong | Strong | Strong | Strong | Not core |
| Human resources | Strong | Strong | Strong | Strong | Strong | Strong |
| Recruitment | Strong | Strong | Strong | Strong | Conditional | Strong |
| Field service | Strong | Strong | Strong | Strong | Conditional | Conditional |
| Equipment rental | Strong | Conditional | Conditional | Conditional | Conditional | Conditional |
| Quality management | Strong | Strong | Strong | Strong | Strong | Conditional |
| Maintenance management | Strong | Strong | Strong | Strong | Strong | Conditional |
| Marketing automation | Strong | Strong | Strong | Strong | Conditional | Strong |
| Project management | Strong | Strong | Strong | Strong | Strong | Strong |
| Advanced BI / analytics | Conditional | Strong | Strong | Strong | Conditional | Strong |
| Low-code customization | Strong | Strong | Strong | Strong | Strong | Strong |
| Medical-device / healthcare workflows | Conditional | Conditional | Conditional | Conditional | Conditional | Conditional |

**Use in product design:** The analytics product should not decide its domain coverage from platform marketing matrices. It must determine what data the individual customer actually provides and can legitimately access.

---

## 6. Translate the catalog into the Universal Analytics architecture

### 6.1 Conceptual data flow

```text
ERP API / ERP export / Manual Excel or CSV
                |
                v
       File/Source Registration
                |
                v
  Secure File Storage + Import Job Queue
                |
                v
   File Parsing / Sheet Profiling / Detection
                |
                v
 Mapping Suggestions + User Confirmation
                |
                v
  Validation / Quality Score / Quarantine
                |
                v
  Canonical Data Model + Lineage Metadata
                |
                v
 Metric / Semantic Layer (version-controlled)
                |
                v
 Dashboards + AI Narratives + Drilldowns
                |
                v
       Scheduled Refresh / Alerts
```

### 6.2 Recommended modular application architecture

1. **Source registry:** Tenant, company, source system, source version, format, module domain, file/connection provenance.
2. **Intake & profiling:** File size, sheets, table boundaries, headers, inferred types, currencies, date conventions, duplicate headers, formulas, merged cells, cross-tab layouts.
3. **Smart mapping:** Map source columns to canonical fields, score confidence, request user approval; retain per-source mapping templates.
4. **Transformation engine:** Normalize dates, decimal separators, signs, currencies, units, identifiers, and document states. Preserve raw values.
5. **Validation & reconciliation:** File- and row-level checks with blocking vs warning severities and proposed fixes.
6. **Canonical storage:** Standardized business entities with source keys, dimensions, and provenance.
7. **Metric/semantic layer:** Explicit definitions and grain for KPI computation; source requirements and quality caveats.
8. **Insight layer:** Dashboard templates, filters, benchmarks, anomaly alerts, narrative explanations.
9. **Connector layer:** Source-specific ingestion plugins; export-only support first, APIs later.
10. **Governance:** Tenant RBAC, RLS, masking, audit logging, deletion/retention, import history, lineage and access rules.

### 6.3 Canonical business entities (initial reference)

| Canonical entity | Typical fields / relationships | Key caveat |
|---|---|---|
| `organization`, `company`, `business_unit`, `branch` | `tenant_id`, `company_id`, hierarchy | One account may have multiple companies/currencies |
| `customer` / `supplier` | Source ID, name, tax ID (if lawful), classification, territory | Deduplication is separate from transaction ingestion |
| `product` / `service_item` | SKU, category, unit of measure, brand | SKU may collide across companies |
| `employee` / `salesperson` | Source employee ID, team, region | HR data needs stricter access |
| `account` / `journal_entry` / `journal_line` | Posting date, account, debit, credit, currency | GL is not interchangeable with invoices or receipts |
| `invoice` / `invoice_line` | Customer, document state, dates, net/tax/gross, currency | Credit notes and cancellations must be modeled explicitly |
| `payment` / `payment_allocation` | Date, amount, counterparty, applied invoice(s) | Payments can be partial/unapplied/many-to-many |
| `purchase_order` / `po_line` | Supplier, order date, expected receipt, commitment | PO is not an AP invoice or paid cash |
| `sales_order` / `so_line` | Customer, order status, booked amount | Orders are not necessarily recognized revenue |
| `inventory_movement` | Product, location, quantity, value, event date, movement type | Do not aggregate movements as on-hand stock without stock logic |
| `inventory_snapshot` | Date, location, SKU, lot/serial, quantity, value | Snapshot and movement grains differ |
| `stock_lot` / `serial_asset` | Lot number, serial, expiry, product | Sensitive device/customer associations may be access restricted |
| `service_ticket` / `work_order` | Customer, asset, assigned tech, SLA, completion | Separate response time from resolution time |
| `rental_contract` / `rental_event` | Asset, start/end, renewal, rate, return status | Fleet utilization needs availability/calendar conventions |
| `crm_lead` / `opportunity` / `activity` | Stage, close date, value, assigned rep | Probabilities and definitions vary by organization |
| `employee_event` / `payroll_summary` | Headcount/time/payroll rollups | Prefer anonymized/aggregated HR where possible |
| `budget_line` / `forecast_version` | Period, cost center, account, scenario, currency | Avoid mixing actuals and forecasts without labeling |
| `project` / `task` / `timesheet` | Owners, milestones, hours, cost | Cost/hours often unavailable in manual sheets |
| `import_job`, `source_file`, `source_row_lineage` | File fingerprint, batch ID, mapping version, source sheet/row | Essential for auditability and support |
| `metric_definition`, `metric_result` | Formula version, grain, filters, date logic | Version formulas and invalidate results on mapping changes |

**Minimum mandatory columns for canonical transactional rows:** `tenant_id`, `company_id`, `source_system`, `source_file_id` or source record reference, `source_record_id` (or deterministic fingerprint), `import_job_id`, `effective_date`, appropriate business keys, `ingested_at`, `mapping_version`, and source lineage. Add identifiers where data privacy and legal requirements permit.

---

## 7. KPI packs by function (analytics product roadmap)

| Dashboard pack | Core metrics | Minimum required source data | Primary pitfalls |
|---|---|---|---|
| **CEO / Executive** | Revenue growth, gross profit/margin, working capital, AR aging, inventory exposure, EBITDA when fully supported | Invoices and costs or GL; AR/stock optional | Never display EBITDA if expense data or mapping is insufficient |
| **Finance / AR** | Open receivables, aging buckets, DSO, collections, overdue %, customer concentration | Open invoices, due dates, allocations/receipts, as-of date | DSO denominator and credit notes; partial allocations |
| **Treasury** | 13-week liquidity forecast, projected receipts, AP due, planned purchases | Cash balances, AR due, AP due, assumptions | Forecasts must label assumptions and uncertainty |
| **AP / Purchasing** | Overdue AP, supplier exposure, purchase price variance, outstanding PO | AP invoices, PO lines, receipts, suppliers | Purchase order ≠ invoice ≠ paid expense |
| **Sales** | Invoice sales, order bookings, discounts, gross margin, salesperson performance | SO/invoice lines, cost basis, sales rep mapping | Returns, taxes, rebates, canceled orders |
| **CRM** | Win rate, pipeline, stage aging, follow-up compliance | Opportunities, stage histories or timestamps, activities | Stage snapshots vs histories; inconsistent probability fields |
| **Inventory** | Stock value, aging, inventory turns, DIO, expiry-risk, stockouts | On-hand snapshots, cost, movements, expiry dates where available | FIFO/AVCO/standard cost differences, snapshots vs events |
| **Operations / Service** | SLA, response time, first-time fix, installed-base coverage, PM compliance | Work orders, SLAs, equipment register | Missing event timestamps and reopened tickets |
| **Rental / Homecare** | Fleet utilization, contract renewal, rental revenue, asset downtime | Contracts, rental events, asset availability | Utilization denominator and overlapping rentals |
| **HR** | Headcount, attrition, absence, time-to-hire | Employee and HR events | Confidentiality, role-based views |
| **Manufacturing / Quality** | Yield, defects, PM status, downtime, CAPA age | Orders, inspections, maintenance events | Do not infer OEE without availability/performance/quality inputs |
| **Marketing** | Leads, conversion, attributable revenue, campaign ROI | Campaign spend, leads, attribution bridge | Attribution can be weak or absent |
| **Healthcare device overlay** | Serial-level installed base, warranty exposure, PM due, consumables/device, device utilization | Device registry, installs, service, consumables, rental events | Avoid medical claims or clinical interpretation without validated data |

### 7.1 Core KPI contracts (illustrative)

- **AR balance as of date:** Sum open invoice receivables net of valid credit notes and allocations as of cutoff. Clearly exclude or separately classify unapplied receipts.
- **AR aging:** Assign outstanding amount as of cutoff to `not_due`, `1–30`, `31–60`, `61–90`, `91–180`, `181–365`, `365+` days using due date and date-localization rules. Aging from uploaded *current open invoice list* cannot reliably reconstruct historical AR as-of earlier dates.
- **DSO:** Define method explicitly (e.g. ending AR / trailing credit sales × days); allow alternative weighted/invoice-based approach only when clearly identified.
- **Gross margin:** `(net_sales - cost_of_goods_sold) / net_sales`, provided both revenue and matching COGS are available, with stated cutoff and allocation assumptions.
- **Inventory days on hand:** Average inventory at compatible valuation / COGS × period days, where sufficient data exists.
- **Cash conversion cycle:** DIO + DSO − DPO, but show only when inputs use compatible time windows and definitions.
- **Sales target attainment:** Actual eligible sales / approved target; show period, eligible document states, rep/territory attribution, returns handling.

Each metric definition should declare: `metric_id`, description, formula, units, dimensions, time basis, source entities/fields, inclusion/exclusion rules, currency policy, freshness requirements, quality checks, calculation version, and exact caveats.

---

## 8. Excel / CSV ingestion: implementation requirements

### 8.1 What the pre-upload analyzer must detect

- File type, extension vs actual content, encoding, delimiter, date serials, locale, workbook size and all worksheets.
- Header row candidates; multiple tables on the same sheet; multi-line titles; merged cells; hidden rows/columns; formulas and cached values; pivot-like/cross-tab exports.
- Empty, duplicate, misspelled, or non-unique column names; inconsistent column types; invalid dates; numbers stored as text; decimal/thousands separator ambiguity.
- Data grain: invoice header, invoice line, payment, journal line, stock snapshot, stock movement, purchase order, etc.
- Duplicate document rows versus valid multiple line items; overlapping export periods; conflicting identifiers.
- Missing core fields, suspicious negative sign patterns, currency ambiguity, unknown units, subtotals/grand totals embedded as ordinary rows.
- Sensitive information requiring masking or restricted access.

### 8.2 Proposed user experience

1. Upload/drop one or many XLSX/CSV files.
2. Show import job with upload and parsing progress, not a frozen page.
3. Preview detected worksheets and candidate tables, each with row counts and confidence.
4. Ask the user to select or confirm the intended business dataset (AR / invoice lines / stock snapshot / etc.).
5. Suggest source-to-canonical column mappings; display confidence and flag mandatory unmapped fields.
6. Present a **data-quality report**: blockers, warnings, affected rows, sample values, and remedy.
7. Offer a **transformation plan** and a downloadable cleaned template/sample, without silently modifying the original.
8. Preview KPI eligibility: “Finance/AR available; gross margin unavailable because COGS is missing.”
9. Confirm import; run validation + staged transformation asynchronously.
10. Display resulting dashboards and permit drilldown into reconciled source rows.

### 8.3 Import correctness and performance

- Upload files to secure object storage via bounded upload paths rather than loading full workbooks into browser memory.
- Parse/transform in an appropriate background worker or queue; don't rely on serverless request timeouts for heavy workbook jobs.
- Use chunked/streaming or staged parsing when practical; enforce file, sheet, row, and job limits by plan.
- Emit progress stages: `uploaded → queued → profiling → mapping_required → validating → importing → reconciled → completed`, plus `failed/cancelled`.
- Persist stable import IDs, hashes, deduplication keys, mapping versions and checkpoints; safe retry must not double-count data.
- Quarantine invalid records and provide row-level errors; never quietly drop material financial rows.
- Separate preview sampling from full-file validation.
- Validate batch/company/user ownership at each request, worker job, storage object, and database query.
- Offer replace/append/upsert policies with explicit user selection and collision previews.
- Avoid creating several different versions of the same transaction during repeated uploads.
- Support rollback/reversal of an import batch while preserving logs and dependencies.

---

## 9. Cross-ERP mapping examples

> These are **conceptual mappings only**, not verified connector-specific field names.

| Universal concept | Odoo-like export | SAP-like export | Dynamics-like export | Manual Excel equivalent |
|---|---|---|---|---|
| AR invoice | Customer invoice / journal item export | Billing/accounting document | Customer invoice | `Invoice No`, `Customer`, `Date`, `Due Date`, `Amount` |
| Receipt / allocation | Payment and reconciliation lines | Incoming payment / clearing entries | Customer payments / settlement | `Receipt No`, `Invoice No`, `Amount Paid`, `Date` |
| Sales order | Sales order line export | Sales document line | Sales order line | `Order No`, `SKU`, `Qty`, `Price`, `Status` |
| Procurement | PO / purchase line | Purchasing document | Purchase order | `PO No`, `Vendor`, `Item`, `Qty`, `Cost` |
| Stock snapshot | On-hand report | Stock balance report | On-hand inventory | `Warehouse`, `SKU`, `Qty`, `Value`, `As Of` |
| Inventory movement | Stock move / valuation | Material movement | Inventory transaction | `Date`, `SKU`, `Movement Type`, `Qty` |
| Service history | Repair/field service ticket | Service order / maintenance notification | Field Service work order | `Asset Serial`, `Visit Date`, `Problem`, `Resolution` |
| GL transaction | Journal item | Accounting line item | GL entry | `Date`, `Account`, `Debit`, `Credit`, `Cost Center` |

**Rule:** Identify dataset grain before matching labels. Two columns called `Amount` may represent gross invoices, untaxed sales, allocated payments, or inventory value.

---

## 10. Medical-devices distributor pilot (optional starter templates, not core assumptions)

### 10.1 Prioritize these modules for the pilot

| Priority | Domain | Real business decisions enabled |
|---|---|---|
| P1 | Finance & collections | AR/AP aging, buying-agency balances, expected cash receipts, supplier payment commitments, profitability |
| P1 | Sales & CRM | Hospital vs homecare sales, tenders, product lines, targets, customer/territory ownership |
| P1 | Inventory & procurement | Expiry, serialized medical devices, warehouse stock, landed cost, reorder/stockout risk |
| P1 | Technical service | Installed base, preventive maintenance, calibration, warranty, engineer visits |
| P1 | Rental / homecare | Device rental fleet, billing, returns, consumables, contract renewal |
| P2 | HR and accountability | Recruitment, attendance, targets, performance and responsibility tracking |
| P2 | Regulatory and quality | Registrations, traceability, complaints, CAPA and device recall readiness |
| P2 | CEO dashboard | Cash conversion, gross margin, aging, service utilization, exception alerts |
| P3 | Marketing/support | Physician engagement, campaigns, event ROI, tickets and customer experience |
| P3 | AI/automation | Rule-based alerts, refresh schedules, anomaly explanations and workflow triggers |

### 10.2 Medical-device installed-base analytical relationships

```text
Supplier → Purchase Order → Inbound/Cost → Serialized Device
          → Warehouse / Customer Installation → Warranty
          → Maintenance / Calibration → Spare Parts
          → Consumable Demand → Service / Rental Contract
          → Customer Invoice → Cash Collection
```

Analytics should correlate these events **only where IDs and data permissions permit**. Do not equate equipment installed in a hospital with equipment sold or invoiced. Patient-level data, if ever introduced, requires a separate privacy/security design, lawful basis and clinical governance.

---

## 11. Recommended delivery roadmap for Claude Code

### Phase 0 — Stabilize the existing app (release gate)

- Reproduce slow Excel uploads and page freezes on known test files of increasing size.
- Instrument frontend and backend timing, memory use, job duration, exceptions and failed validations.
- Test Vercel request limits, Supabase storage/database policies, queue/worker architecture and connection behavior.
- Fix data duplication and import idempotency.
- Establish Playwright end-to-end tests, upload stress benchmarks, test fixtures, CI checks and rollback procedures.
- **Exit:** Repeated imports do not freeze the UI, duplicate records, expose cross-tenant data, or produce unreconciled totals.

### Phase 1 — High-value universal MVP

- CSV/XLSX ingestion, workbook profiler, mapping UI and explicit data-quality checks.
- Canonical entities: companies, customers, suppliers, products, invoices, payments/allocations, purchase orders, inventory snapshots, sales orders.
- Dashboard packs: revenue, AR aging, collections, AP aging, sales performance, basic stock.
- Universal metric catalog with formulas, source traces, downloadable reconciliation.
- Odoo export templates + generic manual Excel templates. Require no live ERP connection.
- **Exit:** Same KPI can be produced and reconciled from equivalent Odoo and generic Excel datasets.

### Phase 2 — Wider operations and vendor adapters

- Odoo API adapter where appropriate; SAP Business One, Dynamics Business Central and ERPNext export adapters prioritized by customer demand.
- CRM, field service, equipment rental, supplier and inventory movement models.
- Mapping template marketplace/library, reusable transformations, role-specific dashboards.
- Scheduled refresh, alerting and comparison by business unit.

### Phase 3 — Advanced analytics and automation

- Finance forecasting, inventory demand planning, anomaly rules, scenario analysis.
- AI-assisted mapping, anomaly narratives with explicit evidence, suggested action plans.
- More API connectors, advanced warehouse and manufacturing modules, consolidation.
- Vertical analytics packs: healthcare distributors, retail, manufacturing, professional services.

**Avoid:** Building all 22 domains or every ERP API connector before proving the financial/sales/stock MVP.

---

## 12. Requirements for security, reliability and auditability

- **Authentication/authorization:** Tenant-scoped access, organization membership, role checks, row-level security, secure service role usage.
- **Least-privilege connectors:** Read-only by default; scoped tokens; encrypted secret storage; token rotation, revocation and connector disconnect.
- **Files:** Private buckets, signed access, file type/content validation, malware scanning where feasible, encryption at rest/in transit, tenant-owned retention and secure deletion.
- **Data lineage:** Source file, worksheet, row, source record ID, importer/mapping version, import timestamp, user/connector, transformed canonical record.
- **Controls:** Double-entry reconciliation where applicable; document totals; invoice line vs header totals; duplicate detection; currency and exchange-rate provenance.
- **Privacy:** Restrict payroll, employee, patient, and sensitive commercial records; avoid unrestricted use of uploaded data in external AI services; disclose AI processing paths.
- **Resilience:** Queue retries with backoff, idempotent writes, progress persisted, dead-letter/error queue, monitoring and alerts, cancellation behavior.
- **Observability:** Structured logs without sensitive row data, error taxonomy, performance timings, per-job metrics, release/version correlation.
- **Product UX:** Clear data freshness, missing modules, confidence, filter context and warnings; export source reconciliation for important calculations.

---

## 13. Acceptance tests / objective success criteria

1. **Equivalence:** Equivalent invoice and payment data from Odoo-style files and manual Excel yield identical AR, aging and collection KPIs after normalized mapping.
2. **Duplicate safety:** Re-uploading an identical file with the same import policy does not double-count any record.
3. **Balance checks:** Source totals reconcile to canonical totals; unresolved differences are visible and block material reporting.
4. **Partial data:** Uploading invoice lines without cost data displays revenue but **not fabricated gross margin**.
5. **Aging logic:** Overdue buckets correctly use selected as-of date and partial payments; dates and credit notes tested.
6. **Currency:** Same transaction in two currencies never gets blindly summed without a stated exchange-rate rule.
7. **Large files:** Browser remains interactive and import progress is visible for the supported upper-bound file size; record p95 throughput and peak memory in the test environment before setting a product SLA.
8. **Bad workbooks:** Mixed headers, formula cells, merged cells, hidden rows, thousands separators and totals rows receive correct parsing or actionable quarantine.
9. **Cross-tenant isolation:** Tenant A cannot view, download, infer, or query Tenant B's imports, mappings or metrics.
10. **Traceability:** Clicking a KPI exposes its formula, filters, source files, mapping and contributing records (subject to permissions).
11. **Rollback:** Reversing a batch restores results or explicitly recalculates dependencies without leaving phantom transactions.
12. **User clarity:** UI distinguishes unavailable metric, invalid data, stale data and zero as genuinely different states.

---

## 14. Claude Code working instructions — paste into project context

```markdown
You are implementing a universal ERP + Excel analytics SaaS, not an Odoo-only reporting tool.

Before changing code:
1. Inspect the repository, deployment architecture, schemas, security rules, current imports, and tests. Do not assume any feature exists merely because it appears in this reference document.
2. Map current implementation against the 22 functional domains. Mark each as implemented, partial, planned, or out of scope with code/file evidence.
3. Trace one complete XLSX import path: browser upload → storage → parser → mapping → validation → canonical tables → KPIs → dashboard. Identify performance and correctness failures.
4. Treat data grain and metric definitions as first-class contracts. Financial metrics must be reconcilable to source rows; never infer missing values.
5. Keep vendor-specific import adapters separate from the canonical entities and KPI engine.
6. Build for Odoo exports and arbitrary manual Excel first. Generalize to other ERPs via source adapters.
7. Protect tenant isolation, imports and commercially sensitive data throughout the pipeline.
8. Implement changes in tested, reversible increments. Prefer measured improvements over wholesale rewrites.
9. Present implementation plans with: current-state evidence, changed components, schema migration, test cases, risks, rollback and measurable acceptance criteria.
10. If a module or field is unavailable, surface the missing data requirements instead of silently fabricating analytics.

Immediate engineering mission:
- Fix Excel upload slowdown, page freezes and unreliable validation.
- Implement a pre-upload workbook analyzer and guided mapping/cleaning workflow.
- Prove correctness for finance, sales, purchasing and inventory dashboards using a test suite of Odoo and manual Excel fixtures.
- Prepare a connector architecture without promising unbuilt SAP/Dynamics/Oracle integrations.
```

---

## 15. Suggested repository documentation structure

```text
/docs/
  erp-universal-analytics-reference.md  # this document
  architecture.md                       # actual deployed architecture
  canonical-data-model.md               # entities, grain, relationships
  metric-catalog.md                     # formulas, definitions, exclusions
  source-adapters.md                     # file types, ERP mapping templates
  data-quality-rules.md                 # blocking errors and warnings
  security-and-tenancy.md               # RBAC, RLS, retention, audit
  import-performance.md                 # benchmarks and bottlenecks
  roadmap.md                             # implementation status and scope
/tests/fixtures/
  odoo/
  generic-excel/
  edge-cases/
```

---

## 16. Guardrails: what not to misunderstand

- A module name listed here is not evidence that a given customer has activated it.
- SAP S/4HANA and SAP Business One must not be treated as interchangeable schemas.
- Dynamics 365 Business Central and Dynamics 365 Finance/Supply Chain are different applications.
- Oracle NetSuite and Oracle Fusion are different product families.
- Zoho One apps are not one database with one uniform transaction schema.
- Excel invoices, order bookings, GL revenue and cash receipts are distinct measures.
- An invoice-level export cannot support trustworthy line-level product margins without suitable matched cost data.
- Without source event history, a current stock or AR snapshot cannot reliably reconstruct all prior periods.
- AI mapping confidence is not accounting evidence. User confirmation and deterministic validation are required.
- Healthcare analytics must not imply clinical efficacy or patient safety based only on sales/service data.

---

## 17. Immediate project decisions and next actions

**Product decisions:**
1. Define MVP as **file-first, ERP-neutral analytics** with Odoo and manual Excel fixtures.
2. Select canonical grains and signed monetary amount conventions for invoices, receipts, GL, orders and stock.
3. Standardize an auditable metric dictionary and cutoffs for every dashboard.
4. Make the workbook analyzer + validation workflow a core differentiator.
5. Delay complex ERP API integrations and non-core modules until source-independent KPI correctness is proven.

**Engineering next actions:**
1. Audit current import route and Supabase data model.
2. Profile sample XLSX files and reproduce upload freezes.
3. Draft canonical schema and transform/mapping specification.
4. Add golden datasets with exact expected KPI totals.
5. Build one end-to-end business scenario across sales → invoice → collection and purchase → inventory → payment.
6. Ship dashboards only after source reconciliation and tenant security tests pass.

**Product success thesis:** Deliver meaningful, credible management decisions from imperfect business data without asking SMEs to replace their ERP or rebuild their manual Excel processes first.
