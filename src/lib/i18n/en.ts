import type { Widen } from "./types";
import { auth } from "./areas/auth";
import { account } from "./areas/account";
import { home } from "./areas/home";
import { fin } from "./areas/fin";
import { ana } from "./areas/ana";
import { sales } from "./areas/sales";
import { eu } from "./areas/eu";
import { exp } from "./areas/exp";
import { inv } from "./areas/inv";
import { cash } from "./areas/cash";
import { bank } from "./areas/bank";
import { rp } from "./areas/rp";
import { plan } from "./areas/plan";
import { state } from "./areas/state";
/**
 * The app's words in English. The Arabic dictionary must have every key (TypeScript checks it), so nothing is ever
 * left untranslated. Counts are worded so one phrase fits any number ("Checks failing: 3"), which Arabic needs.
 */
export const en = {
  lang: { name: "English", switchTo: "العربية", switchLabel: "Language" },
  shell: {
    backToCompanies: "Back to companies",
    companies: "Companies",
    allCompanies: "All companies →",
    demoCompany: "Demo company",
    reports: "Reports",
    data: "Data",
    settings: "Settings",
    sections: "Sections",
    reportsTip: "Create a report / download PDF",
    reportsAria: "Reports and PDF",
    accountMenu: "Account menu",
    myCompanies: "My companies",
    insights: "Insights Dashboard",
    account: "Account",
    orgSettings: "Organisation settings",
    people: "User management",
    logout: "Logout",
  },
  sectors: { financials: "Financials", sales: "Sales", expenses: "Expenses", inventory: "Inventory", payments: "Payments", banking: "Banking" },
  /** Side menu, by page address: the short label and the page title. */
  nav: {
    summary: ["Summary", "Executive Summary"],
    "analysis/kpis": ["KPIs", "KPIs"],
    "analysis/explorer": ["KPI Explorer", "KPI Explorer"],
    "analysis/profitability": ["Profitability", "Profitability"],
    "analysis/cashflow": ["Cash Flow", "Cash Flow"],
    "analysis/growth": ["Growth", "Growth"],
    "analysis/trend": ["Trend", "Trend"],
    "analysis/goalseek": ["Goalseek", "Goalseek"],
    "analysis/forecast": ["Forecast", "Forecast"],
    "analysis/financials": ["Financials", "Financials"],
    "analysis/real-profit": ["Real Profit", "Real Profit"],
    sales: ["Overview", "Sales Overview"],
    "sales/products": ["Products", "Products and Categories"],
    "sales/customers": ["Customers", "Customers"],
    "sales/trend": ["Trend", "Sales Trend"],
    "sales/end-users": ["End users", "End Users (agency sales)"],
    expenses: ["Overview", "Expenses Overview"],
    "expenses/accounts": ["Accounts", "Expenses by Account"],
    "expenses/suppliers": ["Suppliers", "Suppliers"],
    "expenses/trend": ["Trend", "Expenses Trend"],
    inventory: ["Overview", "Inventory Overview"],
    "inventory/products": ["Products", "Stock by Product"],
    "inventory/movements": ["Movements", "Stock Movements"],
    "inventory/valuation": ["Valuation", "Valuation and Checks"],
    payments: ["Overview", "Payments Overview"],
    "payments/receivables": ["Receivables", "Receivables"],
    "payments/payables": ["Payables", "Payables"],
    "payments/flows": ["Payments", "Payments In and Out"],
    banking: ["Bank Readiness", "Bank Readiness"],
  } as Record<string, readonly [string, string]>,
  dataNav: {
    title: "Data",
    sub: "The General Ledger is your book of record. Everything else adds detail or checks it, in this order.",
    tabs: { "": "Steps", "/upload": "Upload", "/checks": "Checks & history", "/readiness": "Readiness", "/end-users": "End users", "/odoo": "Odoo live" } as Record<string, string>,
  },
  settingsNav: {
    monthsLoaded: (n: number) => `${n} months loaded`,
    noData: "No data yet",
    items: {
      "data-setup": ["Data Setup", "Step by step, templates, readiness"],
      "source-data": ["Source Data", "Upload or connect Odoo"],
      "data-health": ["Data Health", "Months, checks, history & undo"],
      profile: ["Company Profile", "Currency, year, tax, AI context"],
      "chart-of-accounts": ["Chart of Accounts", "Mapping & behaviour"],
      kpis: ["KPIs", "Choose & rank KPIs"],
      targets: ["Targets", "Monthly targets"],
      alerts: ["Alerts", "Thresholds"],
    } as Record<string, readonly [string, string]>,
  },
  period: {
    for: "For the ",
    upto: "Up to the ",
    of: "of",
    month: "Month",
    quarter: "Quarter",
    year: "Year",
    selectMonth: "Select a month",
    prevYear: "Previous year",
    nextYear: "Next year",
    noMonth: "No data loaded for this month",
    partTitle: "The latest month's figures stop on this day, so it covers only part of the month.",
    part: (day: number, month: string) => `part month, to ${day} ${month}`,
  },
  noData: {
    title: "No financial data yet",
    body: (name: string) => `Upload an Odoo export or connect your Odoo database to see KPIs, breakeven, cash flow and more for ${name}.`,
    add: "Add financial data",
  },
  health: (n: number) => `${n} accounting check${n > 1 ? "s fail" : " fails"} in this company's data (for example the balance sheet does not balance). Figures may be wrong: review them in Data health.`,
  footer: { operatedBy: (entity: string) => `operated by ${entity}`, privacy: "Privacy", terms: "Terms", contact: "Contact", legal: "Legal", effective: "Effective" },
  dialog: { close: "Close" },
  auth: auth.en,
  account: account.en,
  home: home.en,
  fin: fin.en,
  ana: ana.en,
  sales: sales.en,
  eu: eu.en,
  exp: exp.en,
  inv: inv.en,
  cash: cash.en,
  bank: bank.en,
  state: state.en,
  rp: rp.en,
  plan: plan.en,
};

export type Dict = Widen<typeof en>;
