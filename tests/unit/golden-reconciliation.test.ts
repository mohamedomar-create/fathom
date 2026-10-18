// The 15 Oct 2026 reconciliation of a company's books against Odoo, run on the real exports (never committed: this
// repository is public). Point RECON_DIR at a folder holding the General Ledger to 15 Oct, the three stock exports and
// fixture.json (the Odoo column of the register's Reconciliation sheet) to run it locally. CI runs the same rules on
// made-up files (reconciliation-synthetic.test.ts).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMonths } from "@/lib/company/build";
import { ingest, toAccountInputs, type IngestOptions } from "@/lib/ingest/pipeline";
import { readWorkbook } from "@/lib/ingest/read";
import type { MonthData } from "@/lib/engine";

const dir = process.env.RECON_DIR ?? "";
type Fixture = { cutoff: string; fileAdjustment: { expensesOct: number; cash: number }; odoo: Record<string, Record<string, number>> };
const buf = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const sum = (o: Record<string, number | undefined>, ks: string[]) => ks.reduce((s, k) => s + (o[k] ?? 0), 0);
const COS = ["cos_variable", "cos_fixed", "cos_depreciation"], EXP = ["exp_variable", "exp_fixed", "exp_depreciation"];
const NI = (pl: Record<string, number>) => (pl.revenue ?? 0) + (pl.other_income ?? 0) + (pl.interest_income ?? 0) - sum(pl, [...COS, ...EXP, "other_expenses", "interest_expenses", "tax_expenses", "adjustments"]);

describe.skipIf(!dir)("A company at its cut-off against Odoo (local only)", async () => {
  if (!dir) { it.skip("needs RECON_DIR", () => {}); return; }
  const fx: Fixture = JSON.parse(fs.readFileSync(path.join(dir, "fixture.json"), "utf8"));
  const gl = fs.readdirSync(dir).find((f) => /general_ledger/i.test(f))!;
  const grids = await readWorkbook(buf(path.join(dir, gl)), gl);
  const opts: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-18", cutoff: fx.cutoff };
  const first = ingest(grids, opts);
  // The company's own classes (its Chart of accounts in iReport), by account code.
  const classes: Record<string, string> = JSON.parse(fs.readFileSync(path.join(dir, "classes.json"), "utf8")).classes;
  const mapping = Object.fromEntries(first.lines.filter((l) => l.code && classes[l.code]).map((l) => [l.key, classes[l.code] as never]));
  const res = ingest(grids, { ...opts, mapping });
  const months = buildMonths(toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) })));
  const at = (p: string) => months.find((m) => m.period === p) as MonthData;
  const pl = (ps: string[]) => { const o: Record<string, number> = {}; for (const p of ps) for (const [k, v] of Object.entries(at(p)?.pl ?? {})) o[k] = (o[k] ?? 0) + (v ?? 0); return o; };
  const ytd = Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  const O = fx.odoo, adj = fx.fileAdjustment;
  const off: string[] = [];
  const near = (got: number, want: number, label: string) => { if (!(Math.abs(got - want) <= 1)) off.push(`${label}: ${Math.round(got).toLocaleString("en-US")} vs ${Math.round(want).toLocaleString("en-US")} (${Math.round(got - want).toLocaleString("en-US")})`); };
  const settle = () => { const o = off.splice(0); expect(o).toEqual([]); };

  it("P&L for 1–15 October", () => {
    const p = pl(["2026-10"]), o = O["P&L – October 1–15"];
    near(p.revenue, o["Revenue"], "revenue");
    near(sum(p, COS), o["Cost of sales"], "cost of sales");
    near(sum(p, EXP), o["Expenses (fixed + variable + depreciation)"] + adj.expensesOct, "expenses");
    near(p.interest_income ?? 0, o["Interest income"], "interest income");
    near(p.interest_expenses ?? 0, o["Interest expenses"], "interest expenses");
    near(NI(p), o["Net income"] - adj.expensesOct, "net income");
    settle();
  });

  it("P&L for September and January to 15 October", () => {
    for (const [block, ps, a] of [["P&L – September", ["2026-09"], 0], ["P&L – YTD Jan–15 Oct", ytd, adj.expensesOct]] as const) {
      const p = pl([...ps]), o = O[block];
      near(p.revenue, o["Revenue"], `${block} revenue`);
      near(sum(p, COS), o["Cost of sales"], `${block} cost of sales`);
      near(sum(p, EXP), o["Expenses"] + a, `${block} expenses`);
      near(p.other_income ?? 0, o["Other income"], `${block} other income`);
      near(p.other_expenses ?? 0, o["Other expenses"], `${block} other expenses`);
      near(p.interest_income ?? 0, o["Interest income"], `${block} interest income`);
      near(p.interest_expenses ?? 0, o["Interest expenses"], `${block} interest expenses`);
      near(NI(p), o["Net income"] - a, `${block} net income`);
    }
    settle();
  });

  it("balance sheet at 15 October and cash at every month end", () => {
    const b = at("2026-10").bs as Record<string, number>, o = O["Balance sheet – 15 Oct"];
    near(b.cash, o["Cash & equivalents"] + adj.cash, "cash");
    near(b.ar, o["Accounts receivable"], "receivables");
    near(b.inventory, o["Inventory (GL 123000)"], "inventory");
    near(b.fixed_assets, o["Fixed assets"], "fixed assets");
    near(b.std, o["Short-term debt"], "short-term debt");
    near(b.ap, o["Accounts payable"], "payables");
    near(b.tax_liab, o["Tax liabilities"], "tax liabilities");
    near(b.other_cl, o["Other current liabilities"], "other current liabilities");
    near(b.retained_earnings, o["Retained earnings"] + adj.cash, "retained earnings");
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (const [label, v] of Object.entries(O["Cash at month end"])) {
      const [m, y] = label.split(" ");
      near(at(`${y}-${String(MON.indexOf(m) + 1).padStart(2, "0")}`).bs.cash ?? 0, v, `cash ${label}`);
    }
    settle();
  });

  it("the last month is labelled to the cut-off date, never the day of the upload", () => {
    expect(res.asOf).toBe(fx.cutoff);
  });
});
