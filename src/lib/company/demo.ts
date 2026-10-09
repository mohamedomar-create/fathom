import sample from "../../../reference/sample.json";
import type { ClassKey, MonthData } from "@/lib/engine";
import type { AccountLine, CompanyBundle } from "./types";

/** Chart of accounts used to spread the demo company's class totals into realistic GL accounts. */
const DEMO_COA: Partial<Record<ClassKey, [string, string, number][]>> = {
  revenue: [["400100", "Product Sales", 72], ["400200", "Service Revenue", 21], ["400300", "Installation & Maintenance", 7]],
  cos_variable: [["500100", "Cost of Goods Sold", 88], ["500200", "Freight In & Customs", 12]],
  cos_depreciation: [["500900", "Depreciation – Warehouse Equipment", 100]],
  exp_variable: [["610100", "Sales Commissions", 55], ["610200", "Delivery & Packaging", 30], ["610300", "Bank Charges & Card Fees", 15]],
  exp_fixed: [["620100", "Salaries & Wages", 58], ["620200", "Office Rent", 16], ["620300", "Marketing", 9], ["620400", "Professional Fees", 6], ["620500", "Utilities", 5], ["620600", "Insurance", 3], ["620700", "IT & Software", 3]],
  other_income: [["710100", "Rental Income", 100]],
  other_expenses: [["720100", "Foreign Exchange Losses", 60], ["720200", "Bad Debts Written Off", 40]],
  interest_income: [["730100", "Bank Interest Received", 100]],
  interest_expenses: [["740100", "Loan Interest", 100]],
  tax_expenses: [["750100", "Income Tax Expense", 100]],
  cash: [["101100", "Bank – Current Account (EGP)", 70], ["101200", "Bank – USD Account", 25], ["101300", "Petty Cash", 5]],
  ar: [["121000", "Trade Receivables", 100]],
  inventory: [["131000", "Inventory – Finished Goods", 80], ["131100", "Inventory – Goods in Transit", 20]],
  fixed_assets: [["151000", "Equipment & Vehicles (net)", 100]],
  std: [["211000", "Bank Overdraft", 100]],
  ap: [["221000", "Trade Payables", 100]],
  tax_liab: [["231000", "VAT Payable", 60], ["231100", "Income Tax Payable", 40]],
  retained_earnings: [["310000", "Retained Earnings", 100]],
  other_equity: [["300000", "Share Capital", 60], ["301000", "Partners' Current Account", 40]],
};

function wobble(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return 1 + ((x - Math.floor(x)) - 0.5) * 0.08;
}

export function spreadAccounts(months: MonthData[]): AccountLine[] {
  const lines: AccountLine[] = [];
  for (const [cls, accts] of Object.entries(DEMO_COA) as [ClassKey, [string, string, number][]][]) {
    const rows = accts.map(([code, name]) => ({ id: `demo-${code}`, code, name, cls, amounts: {} as Record<string, number> }));
    months.forEach((m, mi) => {
      const total = Number((m.pl as Record<string, number>)[cls] ?? (m.bs as Record<string, number>)[cls] ?? 0);
      const ws = accts.map(([, , w], i) => w * (accts.length > 1 ? wobble(mi * 7 + i * 3 + cls.length) : 1));
      const sw = ws.reduce((a, b) => a + b, 0);
      let used = 0;
      rows.forEach((r, i) => {
        const v = i === rows.length - 1 ? total - used : Math.round((total * ws[i]) / sw);
        used += v;
        r.amounts[m.period] = v;
      });
    });
    lines.push(...rows);
  }
  return lines;
}

export function demoCompany(): CompanyBundle {
  const months = sample.months as MonthData[];
  return {
    id: "demo",
    name: sample.company,
    basePath: "/demo",
    source: "demo",
    months,
    settings: { currency: sample.currency, fyStartMonth: sample.fy_start_month, taxRate: sample.tax_rate, targets: sample.targets },
    alerts: { ar_days: { active: true, threshold: 50 }, gpm: { active: true, threshold: 46 } },
    accounts: spreadAccounts(months),
    commentary: {},
    readOnly: true,
    lastUpdated: "2026-10-02T09:00:00Z",
    orgName: "Demo Advisory",
    notes: ["Demo company built from synthetic numbers that follow the app's own formulas."],
  };
}
