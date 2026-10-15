import sample from "../../../reference/sample.json";
import { isExpenseClass, summariseExpenses, type ClassKey, type ExpensesData, type MonthData } from "@/lib/engine";
import { COGS_SUPPLIER, DEPRECIATION_SUPPLIER, NO_SUPPLIER, type ExpenseLine } from "@/lib/ingest/expenses";
import { LENDER_TAG } from "@/lib/engine/expenses";
import { spreadAccounts } from "./demo";
import { demoStockFlows } from "./demo-inventory";

/**
 * Expense lines for the demo company, made up but consistent: each month's lines for an account add up exactly to that
 * account's amount in the demo P&L, so the Expenses pages reconcile like a real company's. The year's audit bill and one bill
 * paid twice are planted in the latest month, so the checks have something to show.
 */
const SUPPLIERS: Record<string, { who: string[]; per: number; series: string }> = {
  // Cost of goods sold is posted by stock deliveries (automated valuation): no supplier. The suppliers' bills are stock purchases (below).
  "500100": { who: [COGS_SUPPLIER], per: 9, series: "STJ" },
  "500200": { who: ["Aramex Freight", "Egyptian Customs", "DHL Global Forwarding"], per: 4, series: "BILL" },
  "500900": { who: [DEPRECIATION_SUPPLIER], per: 1, series: "ASSTE" },
  "610100": { who: [NO_SUPPLIER], per: 1, series: "SLIP" },
  "610200": { who: ["Bosta Delivery", "Aramex Freight", "Cairo Packaging Co."], per: 6, series: "BILL" },
  "610300": { who: [`${LENDER_TAG}CIB`, "Paymob"], per: 3, series: "CIB" },
  "620100": { who: [NO_SUPPLIER], per: 1, series: "SLIP" },
  "620200": { who: ["Nasr City Properties"], per: 1, series: "BILL" },
  "620300": { who: ["Meta Ads", "Google Ads", "Print House Cairo"], per: 3, series: "BILL" },
  "620400": { who: ["Hassan & Partners (Auditors)", "Cairo Legal Advisors"], per: 6, series: "BILL" },
  "620500": { who: ["North Cairo Electricity", "Telecom Egypt", "Cairo Water"], per: 3, series: "BILL" },
  "620600": { who: ["Misr Insurance"], per: 1, series: "BILL" },
  "620700": { who: ["Odoo SA", "Microsoft Egypt", "TE Data"], per: 3, series: "BILL" },
  "720100": { who: ["Journal entries"], per: 1, series: "MISC" },
  "720200": { who: ["Journal entries"], per: 1, series: "MISC" },
  "740100": { who: [`${LENDER_TAG}CIB`], per: 1, series: "CIB" },
  "750100": { who: ["Egyptian Tax Authority"], per: 1, series: "MISC" },
};

let cache: { data: ExpensesData; lines: ExpenseLine[] } | null = null;

export function demoExpenseLines(): ExpenseLine[] {
  return build().lines;
}
export function demoExpenses(): ExpensesData {
  return build().data;
}

function build() {
  if (cache) return cache;
  let seed = 20261014;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const months = sample.months as MonthData[];
  const latest = [...months].reverse().find((m) => Object.keys(m.pl).length)?.period ?? "";
  const lines: ExpenseLine[] = [];
  const count: Record<string, number> = {};
  const docOf = (series: string, p: string) => `${series}/${p.slice(0, 4)}/${String((count[series] = (count[series] ?? 0) + 1)).padStart(4, "0")}`;
  for (const a of spreadAccounts(months)) {
    if (!isExpenseClass(a.cls)) continue;
    const spec = SUPPLIERS[a.code] ?? { who: [NO_SUPPLIER], per: 1, series: "MISC" };
    for (const [p, total] of Object.entries(a.amounts).sort()) {
      if (!total) continue;
      const n = spec.per;
      const ws = Array.from({ length: n }, () => 0.6 + rnd() * 0.8);
      const sw = ws.reduce((s, w) => s + w, 0);
      const month: ExpenseLine[] = [];
      let used = 0;
      for (let i = 0; i < n; i++) {
        const amount = i === n - 1 ? Math.round((total - used) * 100) / 100 : Math.round(((total * ws[i]) / sw) * 100) / 100;
        used += amount;
        const day = `${p}-${String(1 + Math.floor(rnd() * 27)).padStart(2, "0")}`;
        month.push({ day, period: p, doc: docOf(spec.series, p), series: spec.series, supplier: spec.who[Math.floor(Math.pow(rnd(), 1.5) * spec.who.length)], account: `${a.code} ${a.name}`, cls: a.cls as ClassKey, category: a.name, label: "", amount });
      }
      // Delivery: the same bill entered twice in the latest month (the second line takes the first's amount; the last absorbs it).
      if (a.code === "610200" && p === latest && month.length >= 3) {
        const [x, y] = month;
        const shift = y.amount - x.amount;
        Object.assign(y, { supplier: x.supplier, amount: x.amount, day: `${p}-${String(Math.min(28, Number(x.day!.slice(8)) + 2)).padStart(2, "0")}` });
        month[month.length - 1].amount = Math.round((month[month.length - 1].amount + shift) * 100) / 100;
      }
      // Professional fees: the year's audit bill in the latest month, against the accrual booked through the year.
      if (a.code === "620400" && p === latest) {
        month.push({ day: `${p}-20`, period: p, doc: docOf("BILL", p), series: "BILL", supplier: "Hassan & Partners (Auditors)", account: `${a.code} ${a.name}`, cls: a.cls as ClassKey, category: a.name, label: "Annual audit fee", amount: 48000 });
        month.push({ day: `${p}-30`, period: p, doc: docOf("MISC", p), series: "MISC", supplier: "Journal entries", account: `${a.code} ${a.name}`, cls: a.cls as ClassKey, category: a.name, label: "Audit accrual released", amount: -48000 });
      }
      lines.push(...month);
    }
  }
  // Goods bought for stock: each month's receipts and landed costs (the demo's stock, see demo-inventory), billed by the suppliers
  // to the stock interim account. They show under suppliers, never in costs: they reach costs as cost of goods sold when sold.
  let seed2 = 20261015;
  const rnd2 = () => ((seed2 = (seed2 * 1103515245 + 12345) % 2147483648) / 2147483648);
  const STOCK_SUPPLIERS = ["Medline Supply", "Philips Healthcare Egypt", "Fisher & Paykel Distributor", "Drive Medical MEA", "Nile Medical Imports"];
  for (const f of demoStockFlows()) {
    const bills: [string, number][] = [];
    const ws = STOCK_SUPPLIERS.map(() => 0.6 + rnd2() * 0.8), sw = ws.reduce((s, w) => s + w, 0);
    let used = 0;
    STOCK_SUPPLIERS.forEach((who, i) => {
      const amount = i === STOCK_SUPPLIERS.length - 1 ? Math.round((f.receipts - used) * 100) / 100 : Math.round(((f.receipts * ws[i]) / sw) * 100) / 100;
      used = Math.round((used + amount) * 100) / 100;
      bills.push([who, amount]);
    });
    if (f.landed) bills.push(["DHL Global Forwarding", f.landed]);
    for (const [who, amount] of bills) lines.push({ day: `${f.p}-${String(1 + Math.floor(rnd2() * 27)).padStart(2, "0")}`, period: f.p, doc: docOf("BILL", f.p), series: "BILL", supplier: who, account: "210500 Stock Interim (Received)", cls: "other_cl", category: "Stock Interim (Received)", label: "", amount });
  }
  cache = { data: summariseExpenses(lines, "ledger"), lines };
  return cache;
}
