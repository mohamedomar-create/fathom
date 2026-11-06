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
import { hl } from "./areas/hl";
import { bud } from "./areas/bud";
import { doc } from "./areas/doc";
import { ink } from "./areas/ink";
import { mods } from "./areas/mods";
import { val } from "./areas/val";
import { bp } from "./areas/bp";
import { viz } from "./areas/viz";
import { bank } from "./areas/bank";
import { rp } from "./areas/rp";
import { plan } from "./areas/plan";
import { state } from "./areas/state";
import { access } from "./areas/access";
import { setx } from "./areas/setx";
import { wiz } from "./areas/wiz";
import { dat } from "./areas/dat";
import { rep } from "./areas/rep";
import { pay } from "./areas/pay";
import { msg } from "./areas/msg";
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
  navGroups: { overview: "Overview", performance: "Performance", cash: "Cash & statements", plan: "Plan" },
  bottom: { home: "Home", pages: "Pages", more: "More", sectionPages: "Pages in this section", everything: "All sections" },
  sectors: { financials: "Financials", sales: "Sales", expenses: "Expenses", inventory: "Inventory", payments: "Payments", banking: "Banking", planning: "Planning", doctor: "Doctor", valuation: "Valuation", modules: "Modules" },
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
    "analysis/budget": ["Budget", "Budget"],
    planning: ["Business plan", "Business Plan"],
    "planning/budget": ["Budget", "Budget"],
    doctor: ["System doctor", "AI System Doctor"],
    valuation: ["Valuation", "Valuation"],
    "valuation/methods": ["Methods", "Valuation methods"],
    "valuation/assumptions": ["Assumptions", "Valuation assumptions"],
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
    "modules/purchasing": ["Purchasing", "Purchasing"],
    "modules/hr": ["HR", "HR"],
    "modules/payroll": ["Payroll", "Payroll"],
    "modules/crm": ["CRM", "CRM"],
    "modules/manufacturing": ["Manufacturing", "Manufacturing"],
    "modules/projects": ["Projects", "Projects"],
    "modules/pos": ["Point of sale", "Point of sale"],
    "modules/assets": ["Fixed assets", "Fixed assets"],
    "modules/fleet": ["Fleet", "Fleet"],
    "modules/service": ["Service", "Service"],
    inventory: ["Overview", "Inventory Overview"],
    "inventory/products": ["Products", "Stock by Product"],
    "inventory/movements": ["Movements", "Stock Movements"],
    "inventory/valuation": ["Stock valuation", "Stock valuation and checks"],
    payments: ["Overview", "Payments Overview"],
    "payments/receivables": ["Receivables", "Receivables"],
    "payments/payables": ["Payables", "Payables"],
    "payments/flows": ["Payments", "Payments In and Out"],
    banking: ["Bank Readiness", "Bank Readiness"],
  } as Record<string, readonly [string, string]>,
  dataNav: {
    title: "Data",
    sub: "The General Ledger is your book of record. Everything else adds detail or checks it, in this order.",
    tabs: { steps: "Steps", checks: "Checks & history", connections: "Connections" },
    sub2: { steps: "Steps", intake: "Smart upload", readiness: "Readiness by sector", upload: "Upload a file", odoo: "Odoo live", endUsers: "End users" },
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
      close: ["Month close", "Close and reopen months"],
      modules: ["Modules", "Which areas you bring, who sees each"],
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
    bodyOther: (name: string) => `Upload your General Ledger or Trial Balance (Excel or CSV) to see KPIs, breakeven, cash flow and more for ${name}.`,
    add: "Add financial data",
    home: "Your modules",
    homeBody: (name: string) => `What ${name} has loaded so far. Each module works on its own; add the books to see profit, cash and KPIs too.`,
    homeNone: "No module holds data yet. Start with any file: sales, expenses, stock, payments, or the books.",
    seeModules: "See your modules",
    latest: (m: string) => `Latest month ${m}`,
    monthsLoaded: (n: number) => `${n} month${n === 1 ? "" : "s"} loaded`,
    open: "Open",
    /** What each page will show once the books are in. */
    pages: { summary: "The executive summary: profit, cash and what needs attention, in one page.", kpis: "Your KPIs scored against your targets.", banking: "How a bank reads your company: repayment cover, leverage and room to borrow.", valuation: "What your company is worth, from the quick-sale floor to what an investor could pay.", doctor: "The AI system doctor: what is wrong in the books, ranked by money at stake.", planning: "Your budget and business plan, built from your own figures.", analysis: "Statements, profitability, growth, trends and forecast." } as Record<string, string>,
  },
  healthUnknown: "This company's accounting checks couldn't be read just now, so we can't say whether its figures pass them. Reload the page to try again.",
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
  hl: hl.en,
  bud: bud.en,
  doc: doc.en,
  ink: ink.en,
  mods: mods.en,
  val: val.en,
  bp: bp.en,
  viz: viz.en,
  bank: bank.en,
  state: state.en,
  access: access.en,
  rp: rp.en,
  plan: plan.en,
  setx: setx.en,
  wiz: wiz.en,
  dat: dat.en,
  rep: rep.en,
  pay: pay.en,
  msg: msg.en,
};

export type Dict = Widen<typeof en>;
