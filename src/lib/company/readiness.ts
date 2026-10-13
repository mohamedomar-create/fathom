import { addMonths, bsCalc, cashFlowByMonth, hasBS, hasPL, isAnnualColumn, mlabel, monthIndex, plCalc, type Assumptions, type ForecastDrivers, type MonthData, type SalesData } from "@/lib/engine";
import type { TemplateKind } from "@/lib/templates/spec";
import type { Check } from "./checks";

/**
 * How ready each sector's data is: what is loaded (completion) and how much of it passes the accounting checks
 * (accuracy), item by item, each with exactly what to upload or enter and how.
 */
export type ReadinessSector = "financials" | "sales" | "banking" | "forecast";
export type ItemStatus = "done" | "partial" | "missing";

export interface ReadinessFix {
  /** What to provide, in one line. */
  what: string;
  /** How to get it (the Odoo menu path, or the iReport page). */
  how: string;
  /** The iReport template that holds it. */
  template?: TemplateKind;
  /** Where in iReport to do it, relative to the company's base path. */
  href?: string;
}
export interface ReadinessItem {
  id: string;
  /** Short name for the radar axis. */
  axis: string;
  title: string;
  /** 0–100: how much of what this item needs is loaded or entered. */
  completion: number;
  /** 0–100: how much of what is loaded passes its checks; null when there is nothing to check. */
  accuracy: number | null;
  status: ItemStatus;
  detail: string;
  fix?: ReadinessFix;
}
/** accuracy is null when nothing loaded can be checked yet (or nothing in the sector is checkable). */
export interface SectorReadiness { key: ReadinessSector; label: string; completion: number; accuracy: number | null; items: ReadinessItem[] }

export interface ReadinessInput {
  months: MonthData[];
  checks: Check[];
  fyStart: number;
  sales?: SalesData | null;
  assumptions?: Assumptions;
  forecast?: ForecastDrivers;
  today?: string;
}

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);
const status = (c: number, a: number | null): ItemStatus => (c >= 100 && (a === null || a >= 100) ? "done" : c <= 0 ? "missing" : "partial");
const item = (i: Omit<ReadinessItem, "status">): ReadinessItem => ({ ...i, status: status(i.completion, i.accuracy) });
const isoToday = () => new Date().toISOString().slice(0, 10);

const GL_FIX: ReadinessFix = { what: "Upload the General Ledger from the start of the financial year to the latest month", how: "Odoo: Accounting → Reporting → General Ledger → choose the dates → Export XLSX. Or fill in iReport's monthly financials template.", template: "financials", href: "settings/source-data" };

function summarise(items: ReadinessItem[]): { completion: number; accuracy: number | null } {
  const completion = Math.round(items.reduce((s, i) => s + i.completion, 0) / Math.max(1, items.length));
  const acc = items.filter((i) => i.accuracy !== null && i.completion > 0);
  const accuracy = acc.length ? Math.round(acc.reduce((s, i) => s + i.accuracy!, 0) / acc.length) : null;
  return { completion, accuracy };
}

/** Months holding a P&L, oldest first. */
const plMonths = (ms: MonthData[]) => [...ms].filter(hasPL).sort((a, b) => a.period.localeCompare(b.period));

export function financialsReadiness(x: ReadinessInput): SectorReadiness {
  const pl = plMonths(x.months);
  const by = new Map(x.months.map((m) => [m.period, m]));
  const items: ReadinessItem[] = [];
  const last12 = pl.slice(-12);
  const blockedIn = (p: string, st?: "PL" | "BS") => x.checks.some((c) => c.severity === "block" && c.period === p && (!st || !c.statement || c.statement === st));
  const annual = pl.length > 0 && isAnnualColumn(x.months, pl[pl.length - 1].period, x.fyStart);
  if (!pl.length) {
    items.push(item({ id: "pl", axis: "P&L months", title: "Monthly P&L", completion: 0, accuracy: null, detail: "No P&L is loaded yet.", fix: GL_FIX }));
  } else {
    const n = annual ? 12 : last12.length;
    items.push(item({
      id: "pl", axis: "P&L months", title: "Monthly P&L for the last 12 months",
      completion: pct(n / 12), accuracy: pct(1 - last12.filter((m) => blockedIn(m.period, "PL")).length / Math.max(1, last12.length)),
      detail: annual ? "Loaded as annual figures (audited statements): monthly analysis, trends and the forecast need monthly figures." : `${last12.length} of the last 12 months have a P&L (${mlabel(last12[0].period)} to ${mlabel(last12[last12.length - 1].period)}).`,
      fix: n < 12 || annual ? { ...GL_FIX, what: annual ? "Upload monthly figures (General Ledger) for at least the last 12 months" : `Upload the ${12 - n} earlier month${12 - n === 1 ? "" : "s"} (General Ledger)` } : undefined,
    }));
  }
  const withBS = last12.filter(hasBS);
  const balanced = withBS.filter((m) => { const b = bsCalc(m.bs); return Math.abs(b.imbalance) <= Math.max(1, Math.abs(b.ta) * 1e-4); });
  items.push(item({
    id: "bs", axis: "Balance sheets", title: "A balance sheet at every month end",
    completion: pl.length ? pct(withBS.length / last12.length) : 0, accuracy: withBS.length ? pct(balanced.length / withBS.length) : null,
    detail: !pl.length ? "No months loaded." : `${withBS.length} of ${last12.length} months have a balance sheet; ${balanced.length} of them balance.`,
    fix: withBS.length < last12.length ? { what: "Upload the balance sheet for each month (the General Ledger gives it)", how: GL_FIX.how, template: "financials", href: "settings/source-data" }
      : balanced.length < withBS.length ? { what: "Fix the months whose balance sheet does not balance", how: "Data health lists them with the amount; usually an account is not mapped or this year's profit is missing from retained earnings.", href: "settings/data-health" } : undefined,
  }));
  const first = pl[0]?.period;
  const open = first ? by.get(addMonths(first, -1)) : undefined;
  const openOk = !!open && hasBS(open);
  const openBal = openOk ? Math.abs(bsCalc(open!.bs).imbalance) <= Math.max(1, Math.abs(bsCalc(open!.bs).ta) * 1e-4) : false;
  items.push(item({
    id: "opening", axis: "Opening balance", title: "Opening balance sheet (the month before the first month)",
    completion: openOk ? 100 : 0, accuracy: openOk ? (openBal ? 100 : 0) : null,
    detail: !first ? "No months loaded." : openOk ? `Loaded for ${mlabel(open!.period)}${openBal ? "" : ", but it does not balance"}.` : `Not loaded: ${mlabel(first)} has no cash flow without it.`,
    fix: openOk ? undefined : { what: `Upload a General Ledger that starts in ${first ? mlabel(first) : "the first month"} with its Initial Balance rows, or the balance sheet for ${first ? mlabel(addMonths(first, -1)) : "the month before"}`, how: "In Odoo's General Ledger keep 'Initial Balance' ticked. In the template, the first balance sheet column is the opening balance.", template: "financials", href: "settings/source-data" },
  }));
  if (pl.length) {
    const span = monthIndex(pl[pl.length - 1].period) - monthIndex(pl[0].period) + 1;
    const gaps = annual ? 0 : span - pl.length;
    items.push(item({
      id: "gaps", axis: "No gaps", title: "Every month between the first and the latest",
      completion: pct(1 - gaps / Math.max(1, span)), accuracy: null,
      detail: gaps ? `${gaps} month${gaps === 1 ? " is" : "s are"} missing inside the range loaded.` : "No missing months.",
      fix: gaps ? { ...GL_FIX, what: "Upload the missing months (Data health shows which)", href: "settings/data-health" } : undefined,
    }));
    const today = x.today ?? isoToday();
    const behind = monthIndex(today.slice(0, 7)) - monthIndex(pl[pl.length - 1].period);
    items.push(item({
      id: "fresh", axis: "Up to date", title: "The latest month is loaded",
      completion: behind <= 1 ? 100 : behind === 2 ? 60 : behind === 3 ? 30 : 0, accuracy: null,
      detail: `Latest month: ${mlabel(pl[pl.length - 1].period)}.`,
      fix: behind > 1 ? { ...GL_FIX, what: `Upload the months after ${mlabel(pl[pl.length - 1].period)}` } : undefined,
    }));
    const cf = cashFlowByMonth(x.months, last12.map((m) => m.period));
    const clean = cf.rows.filter((r) => r.unreconciled === 0).length;
    items.push(item({
      id: "cash", axis: "Cash reconciles", title: "Cash flow explains the change in cash every month",
      completion: pct(cf.rows.length / Math.max(1, last12.length)), accuracy: cf.rows.length ? pct(clean / cf.rows.length) : null,
      detail: cf.rows.length ? `${clean} of ${cf.rows.length} months reconcile to the cent.` : "Needs a balance sheet for each month and the month before.",
      fix: cf.rows.length && clean < cf.rows.length ? { what: "Fix the months where the statements do not explain the change in cash", how: "Usually an unbalanced balance sheet or an unmapped account: Data health shows the month and amount.", href: "settings/data-health" } : undefined,
    }));
  }
  return { key: "financials", label: "Financials", ...summarise(items), items };
}

export function salesReadiness(x: ReadinessInput): SectorReadiness {
  const s = x.sales;
  const SALES_FIX: ReadinessFix = { what: "Upload sales lines: the General Ledger gives them, or a sales export", how: "Odoo: Invoicing → Reporting → Invoice Analysis (list view, group by nothing) → Export, with Invoice Date, Number, Partner, Product, Product Category, Salesperson, Quantity, Untaxed Total. Or fill in iReport's sales template.", template: "sales", href: "settings/source-data" };
  const months = s ? [...new Set(s.customers.map((r) => r.p))].sort() : [];
  const items: ReadinessItem[] = [];
  if (!s || !months.length) {
    items.push(item({ id: "loaded", axis: "Sales loaded", title: "Sales lines", completion: 0, accuracy: null, detail: "No sales loaded yet.", fix: SALES_FIX }));
    return { key: "sales", label: "Sales", ...summarise(items), items };
  }
  const pl = plMonths(x.months).slice(-12);
  const plSet = new Set(pl.map((m) => m.period));
  const covered = pl.length ? pl.filter((m) => months.includes(m.period)).length / pl.length : 1;
  items.push(item({ id: "loaded", axis: "Months covered", title: "Sales for every financial month", completion: pct(covered), accuracy: null,
    detail: pl.length ? `${pl.filter((m) => months.includes(m.period)).length} of ${pl.length} financial months have sales lines.` : `${months.length} months of sales.`,
    fix: covered < 1 ? { ...SALES_FIX, what: "Upload sales for the missing months" } : undefined }));
  const byMonth = new Map<string, number>();
  for (const r of s.customers) byMonth.set(r.p, (byMonth.get(r.p) ?? 0) + r.a);
  const both = pl.filter((m) => byMonth.has(m.period) && plSet.has(m.period));
  const tied = both.filter((m) => { const rev = plCalc(m.pl).revenue; return Math.abs((byMonth.get(m.period) ?? 0) - rev) <= Math.max(1, Math.abs(rev) * 0.01); });
  items.push(item({ id: "reconciled", axis: "Ties to P&L", title: "Monthly sales equal P&L revenue (within 1%)", completion: both.length ? 100 : 0, accuracy: both.length ? pct(tied.length / both.length) : null,
    detail: both.length ? `${tied.length} of ${both.length} months tie to revenue.` : "Load the P&L for the same months to check.",
    fix: both.length && tied.length < both.length ? { what: "Make the sales file cover the same invoices as the P&L", how: "Export posted invoices and credit notes for the whole month, amounts before VAT. Revenue booked by journal entry (not invoices) also explains a difference.", template: "sales", href: "sales" } : undefined }));
  const total = s.customers.reduce((t, r) => t + Math.abs(r.a), 0) || 1;
  const named = s.customers.filter((r) => r.c && r.c !== "No customer").reduce((t, r) => t + Math.abs(r.a), 0);
  items.push(item({ id: "customers", axis: "Customers", title: "Every sale has a customer", completion: pct(named / total), accuracy: null, detail: `${pct(named / total)}% of sales name the customer.`,
    fix: named < total ? { what: "Give each invoice line a customer", how: "Revenue posted by journal entry has no customer; post sales through invoices, or fill the Customer column of the sales template.", template: "sales" } : undefined }));
  const ptotal = s.products.reduce((t, r) => t + Math.abs(r.a), 0) || 1;
  const cat = s.products.filter((r) => r.g && r.g !== "No category").reduce((t, r) => t + Math.abs(r.a), 0);
  items.push(item({ id: "categories", axis: "Categories", title: "Products have a category", completion: pct(cat / ptotal), accuracy: null, detail: `${pct(cat / ptotal)}% of sales have a product category.`,
    fix: cat < ptotal ? { what: "Add the product category", how: "Upload Odoo's Invoice Analysis with Product Category, or fill the Product category column of the sales template.", template: "sales" } : undefined }));
  const qty = s.products.filter((r) => r.q !== null).reduce((t, r) => t + Math.abs(r.a), 0);
  items.push(item({ id: "qty", axis: "Quantities", title: "Quantities sold", completion: pct(qty / ptotal), accuracy: null, detail: qty ? `${pct(qty / ptotal)}% of sales have quantities.` : "No quantities: price and volume effects cannot be shown.",
    fix: qty < ptotal ? { what: "Add quantities", how: "The General Ledger has none: upload the Invoice Analysis export or the sales template with Quantity.", template: "sales" } : undefined }));
  const costed = s.products.reduce((t, r) => t + Math.abs(r.ka ?? 0), 0);
  items.push(item({ id: "cost", axis: "Cost & margin", title: "Cost of each sale (for margins)", completion: pct(costed / ptotal), accuracy: null, detail: costed ? `${pct(costed / ptotal)}% of sales have their cost.` : "No cost per sale: product margins cannot be shown.",
    fix: costed < ptotal ? { what: "Add the cost of goods sold per line", how: "Odoo's Invoice Analysis has Margin (or Cost); or fill the Cost column of the sales template.", template: "sales" } : undefined }));
  return { key: "sales", label: "Sales", ...summarise(items), items };
}

export function bankingReadiness(x: ReadinessInput): SectorReadiness {
  const pl = plMonths(x.months);
  const a = x.assumptions ?? {};
  const annualYears = pl.filter((m) => isAnnualColumn(x.months, m.period, x.fyStart)).length;
  const items: ReadinessItem[] = [];
  const hist = annualYears >= 3 ? 1 : Math.max(pl.length / 24, annualYears / 3);
  items.push(item({ id: "history", axis: "History", title: "Two years of months, or three audited years", completion: pct(hist), accuracy: null,
    detail: `${pl.length} months${annualYears ? ` (${annualYears} annual)` : ""} loaded. Banks look at 2–3 years.`,
    fix: hist < 1 ? { what: "Load earlier years: the General Ledger by year, or the audited statements", how: "Upload each year's General Ledger, or the audited financial statements (PDF is read too).", template: "financials", href: "settings/source-data" } : undefined }));
  const last = [...x.months].filter(hasBS).sort((p, q) => p.period.localeCompare(q.period)).pop();
  const debt = last ? bsCalc(last.bs).debt : 0;
  const hasNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  items.push(item({ id: "repay", axis: "Repayments", title: "Loan principal due in the next 12 months", completion: debt <= 0 || hasNum(a.principal12m) ? 100 : 0, accuracy: null,
    detail: debt <= 0 ? "No borrowing on the latest balance sheet." : hasNum(a.principal12m) ? "Entered." : "Not entered: debt service is estimated.",
    fix: debt > 0 && !hasNum(a.principal12m) ? { what: "Enter the loan principal due over the next 12 months", how: "From the bank's repayment schedules, on the Banking page.", href: "banking" } : undefined }));
  items.push(item({ id: "rate", axis: "Borrowing rate", title: "Your borrowing rate", completion: hasNum(a.rate) ? 100 : 0, accuracy: null, detail: hasNum(a.rate) ? `${a.rate}% a year.` : "Not entered.",
    fix: hasNum(a.rate) ? undefined : { what: "Enter the borrowing rate", how: "The rate on your facilities (CBE lending rate plus the bank's margin), on the Banking page.", href: "banking" } }));
  items.push(item({ id: "request", axis: "Request", title: "The loan you want to ask for", completion: hasNum(a.requestAmount) ? 100 : 0, accuracy: null, detail: hasNum(a.requestAmount) ? "Entered." : "Not entered.",
    fix: hasNum(a.requestAmount) ? undefined : { what: "Enter the amount, type and purpose of the facility", how: "On the Banking page.", href: "banking" } }));
  items.push(item({ id: "economy", axis: "Inflation & FX", title: "Inflation and exchange rates", completion: hasNum(a.inflation) ? (hasNum(a.fxStart) && hasNum(a.fxEnd) ? 100 : 60) : 0, accuracy: null,
    detail: hasNum(a.inflation) ? "Entered." : "Not entered: real growth cannot be judged.",
    fix: hasNum(a.inflation) && hasNum(a.fxStart) && hasNum(a.fxEnd) ? undefined : { what: "Enter inflation and the EGP/USD rates", how: "CAPMAS urban inflation and CBE rates, on the Real Profit page.", href: "analysis/real-profit" } }));
  const fin = financialsReadiness(x);
  const bal = fin.items.find((i) => i.id === "bs");
  if (bal) items.push({ ...bal, axis: "Balance sheets" });
  return { key: "banking", label: "Banking", ...summarise(items), items };
}

export function forecastReadiness(x: ReadinessInput): SectorReadiness {
  const pl = plMonths(x.months);
  let run = pl.length ? 1 : 0;
  for (let i = pl.length - 1; i > 0 && monthIndex(pl[i].period) - monthIndex(pl[i - 1].period) === 1; i--) run++;
  const last = pl[pl.length - 1];
  const items: ReadinessItem[] = [
    item({ id: "run", axis: "History", title: "12 or more consecutive months (24 for seasonality)", completion: pct(run / 12), accuracy: null, detail: `${run} consecutive months up to the latest.`,
      fix: run < 12 ? { ...GL_FIX, what: "Upload earlier months so there are 12 in a row" } : undefined }),
    item({ id: "start", axis: "Starting point", title: "The latest month has a balance sheet", completion: last && hasBS(last) ? 100 : 0, accuracy: null,
      detail: last ? (hasBS(last) ? `Starts from ${mlabel(last.period)}.` : `${mlabel(last.period)} has no balance sheet.`) : "No months loaded.",
      fix: last && hasBS(last) ? undefined : { ...GL_FIX, what: "Upload the balance sheet for the latest month (the General Ledger gives it)" } }),
    item({ id: "drivers", axis: "Drivers", title: "Forecast drivers reviewed and saved", completion: x.forecast && Object.keys(x.forecast).length ? 100 : 0, accuracy: null,
      detail: x.forecast && Object.keys(x.forecast).length ? "Saved for this company." : "Using the measured defaults; review growth, margin, days and loans.",
      fix: x.forecast && Object.keys(x.forecast).length ? undefined : { what: "Review the drivers and save them", how: "On the Forecast page: growth, margin, customer/stock/supplier days, loans.", href: "analysis/forecast" } }),
  ];
  return { key: "forecast", label: "Forecast", ...summarise(items), items };
}

export function readiness(x: ReadinessInput): SectorReadiness[] {
  return [financialsReadiness(x), salesReadiness(x), bankingReadiness(x), forecastReadiness(x)];
}
