import { describe, expect, it } from "vitest";
import type { ClassKey } from "@/lib/engine";
import { checkKey, coverageOf, runChecks } from "@/lib/company/checks";
import { planImport, unresolved, type IncomingAccount, type VersionAccount } from "@/lib/company/import-plan";

const acct = (code: string, name: string, cls: ClassKey, amounts: Record<string, number>, extra: Partial<VersionAccount> = {}): VersionAccount => ({ code, name, cls, amounts, ...extra });
const inc = (code: string, name: string, cls: ClassKey, amounts: Record<string, number>): IncomingAccount => ({ code, name, cls, amounts, ref: { sheet: "Sheet1", row: 3, label: name } });

/** A small balanced company: sales paid in cash, profit closed into retained earnings each month. */
function books(ps: string[], src = "imp-1"): VersionAccount[] {
  const sales: Record<string, number> = {}, rent: Record<string, number> = {}, cash: Record<string, number> = {}, re: Record<string, number> = {}, cap: Record<string, number> = {};
  let c = 1000, r = 0;
  for (const p of ps) {
    sales[p] = 500; rent[p] = 200; c += 300; r += 300;
    cash[p] = c; re[p] = r; cap[p] = 1000;
  }
  const sources = (o: Record<string, number>) => Object.fromEntries(Object.keys(o).map((p) => [p, src]));
  return [
    acct("400000", "Sales", "revenue", sales, { sources: sources(sales) }),
    acct("610000", "Rent", "exp_fixed", rent, { sources: sources(rent) }),
    acct("101000", "Bank", "cash", cash, { sources: sources(cash) }),
    acct("300000", "Share capital", "other_equity", cap, { sources: sources(cap) }),
    acct("999999", "Retained earnings", "retained_earnings", re, { sources: sources(re) }),
  ];
}

describe("accounting checks", () => {
  it("passes balanced books with equity rolling forward", () => {
    const a = books(["2025-01", "2025-02", "2025-03"]);
    const checks = runChecks({ accounts: a.map((x, i) => ({ ...x, id: String(i) })) });
    expect(checks.filter((c) => c.severity !== "info")).toEqual([]);
  });

  it("blocks an unbalanced month and warns about the cash-flow balancing line it causes", () => {
    const a = books(["2025-01", "2025-02", "2025-03"]);
    a[2].amounts["2025-02"] += 50; // cash overstated in Feb only
    const checks = runChecks({ accounts: a });
    const bs = checks.filter((c) => c.id === "bs_balance");
    expect(bs.map((c) => [c.period, c.severity, Math.round(c.diff!)])).toEqual([["2025-02", "block", 50]]);
    expect(checks.filter((c) => c.id === "cash_flow").map((c) => [c.period, Math.round(c.diff!)])).toEqual([["2025-02", 50], ["2025-03", -50]]);
  });

  it("warns when equity moves without matching profit", () => {
    const a = books(["2025-01", "2025-02"]);
    a[3].amounts["2025-02"] += 400; a[2].amounts["2025-02"] += 400; // capital injection
    const rf = runChecks({ accounts: a }).filter((c) => c.id === "re_rollforward");
    expect(rf.map((c) => [c.period, c.severity, Math.round(c.diff!)])).toEqual([["2025-02", "warn", 400]]);
  });

  it("finds gaps per statement and months with only one statement", () => {
    const a = books(["2025-01", "2025-02", "2025-03"]);
    for (const x of a) if (x.cls === "revenue" || x.cls === "exp_fixed") delete x.amounts["2025-02"];
    const checks = runChecks({ accounts: a });
    expect(checks.filter((c) => c.id === "gap").map((c) => [c.period, c.statement])).toEqual([["2025-02", "PL"]]);
    expect(checks.filter((c) => c.id === "statement_mismatch").map((c) => c.period)).toEqual(["2025-02"]);
  });

  it("compares imported totals with the file's own total rows", () => {
    const a = books(["2025-01"]);
    const checks = runChecks({ accounts: a, controls: [
      { metric: "revenue", period: "2025-01", value: 500, source: "Total Income" },
      { metric: "net_income", period: "2025-01", value: 350, source: "Net Profit" },
      { metric: "ta", period: "2025-01", value: 1300, source: "Total Assets" },
    ] });
    const ct = checks.filter((c) => c.id === "control_total");
    expect(ct.map((c) => [c.title, Math.round(c.diff!)])).toEqual([["Net profit does not match the file", -50]]);
    expect(ct[0].severity).toBe("block");
  });

  it("coverage lists the months each statement really has", () => {
    const a = books(["2025-01", "2025-02"]);
    a[0].amounts = { "2025-01": 500 }; a[1].amounts = { "2025-01": 200 };
    const cov = coverageOf(a);
    expect([...cov.pl]).toEqual(["2025-01"]);
    expect([...cov.bs].sort()).toEqual(["2025-01", "2025-02"]);
  });
});

describe("planImport", () => {
  const cur = books(["2025-01", "2025-02", "2025-03"]);

  it("merge keeps months the file does not cover and replaces the ones it does", () => {
    const next = books(["2025-01", "2025-02", "2025-03", "2025-04"], "x").map((a) => ({ ...inc(a.code, a.name, a.cls, { "2025-03": a.amounts["2025-03"], "2025-04": a.amounts["2025-04"] }) }));
    const plan = planImport(cur, next, { mode: "merge", slices: { PL: ["2025-03", "2025-04"], BS: ["2025-03", "2025-04"] } });
    const sales = plan.accounts.find((a) => a.code === "400000")!;
    expect(sales.amounts).toEqual({ "2025-01": 500, "2025-02": 500, "2025-03": 500, "2025-04": 500 });
    // carried months keep their import id, new months have none (filled with the new import id on save)
    expect(sales.sources).toEqual({ "2025-01": "imp-1", "2025-02": "imp-1" });
    expect(sales.refs).toEqual({ new: { sheet: "Sheet1", row: 3, label: "Sales" } });
    expect(plan.timeline.map((t) => [t.period, t.PL, t.BS])).toEqual([
      ["2025-01", "keep", "keep"], ["2025-02", "keep", "keep"], ["2025-03", "overwrite", "overwrite"], ["2025-04", "new", "new"],
    ]);
    expect(plan.checks.filter((c) => c.severity !== "info")).toEqual([]);
  });

  it("a covered month replaces old figures even when the file has no figure for an account", () => {
    const next = [inc("400000", "Sales", "revenue", { "2025-02": 650 }), inc("610000", "Rent", "exp_fixed", { "2025-02": 200 })];
    const plan = planImport(cur, next, { mode: "merge", slices: { PL: ["2025-02"], BS: [] } });
    expect(plan.accounts.find((a) => a.code === "400000")!.amounts["2025-02"]).toBe(650);
    expect(plan.diffs.filter((d) => d.metric === "revenue")).toEqual([{ period: "2025-02", metric: "revenue", before: 500, after: 650 }]);
    // Feb profit rose by 150 but the balance sheet was not re-uploaded: equity no longer rolls forward
    expect(plan.checks.some((c) => c.id === "re_rollforward" && c.period === "2025-02")).toBe(true);
  });

  it("supports the P&L and the balance sheet arriving in separate files", () => {
    const pl = cur.filter((a) => a.cls === "revenue" || a.cls === "exp_fixed").map((a) => inc(a.code, a.name, a.cls, a.amounts));
    const bs = cur.filter((a) => a.cls !== "revenue" && a.cls !== "exp_fixed").map((a) => inc(a.code, a.name, a.cls, a.amounts));
    const p1 = planImport([], pl, { mode: "merge", slices: { PL: ["2025-01", "2025-02", "2025-03"], BS: [] } });
    expect(p1.timeline.every((t) => t.PL === "new" && !t.BS)).toBe(true);
    const asStored = p1.accounts.map((a) => ({ ...a, sources: Object.fromEntries(Object.keys(a.amounts).map((p) => [p, "imp-pl"])) }));
    const p2 = planImport(asStored, bs, { mode: "merge", slices: { PL: [], BS: ["2025-01", "2025-02", "2025-03"] } });
    expect(p2.timeline.every((t) => t.PL === "keep" && t.BS === "new")).toBe(true);
    expect(p2.accounts).toHaveLength(5);
    expect(p2.checks.filter((c) => c.severity !== "info")).toEqual([]);
  });

  it("replace removes months the file does not cover", () => {
    const next = [inc("400000", "Sales", "revenue", { "2025-03": 500 })];
    const plan = planImport(cur, next, { mode: "replace", slices: { PL: ["2025-03"], BS: [] } });
    expect(plan.accounts).toHaveLength(1);
    expect(plan.timeline.find((t) => t.period === "2025-01")).toEqual({ period: "2025-01", PL: "remove", BS: "remove" });
    expect(plan.timeline.find((t) => t.period === "2025-03")).toEqual({ period: "2025-03", PL: "overwrite", BS: "remove" });
  });

  it("matches accounts by code, or by name when there is no code, and keeps a class the user chose", () => {
    const stored = [acct("", "Consulting income", "other_income", { "2025-01": 100 }, { mapped_by: "user", sources: { "2025-01": "a" } })];
    const plan = planImport(stored, [{ ...inc("", "Consulting  Income", "revenue", { "2025-02": 120 }), mapped_by: "auto" }], { mode: "merge", slices: { PL: ["2025-02"], BS: [] } });
    expect(plan.accounts).toHaveLength(1);
    expect(plan.accounts[0].cls).toBe("other_income");
    expect(plan.accounts[0].amounts).toEqual({ "2025-01": 100, "2025-02": 120 });
  });

  it("recasts carried figures when the class changes sign side", () => {
    const stored = [acct("200", "Supplier X", "ap", { "2025-01": 100 }, { sources: { "2025-01": "a" } })];
    const plan = planImport(stored, [{ ...inc("200", "Supplier X", "other_ca", { "2025-02": -80 }) }], { mode: "merge", slices: { PL: [], BS: ["2025-02"] } });
    // AP 100 (credit) is a debit-side balance of -100 as an asset
    expect(plan.accounts[0]).toMatchObject({ cls: "other_ca", amounts: { "2025-01": -100, "2025-02": -80 } });
  });

  it("only failures in months the file touches block a merge", () => {
    const broken = books(["2025-01", "2025-02", "2025-03"]);
    broken[2].amounts["2025-01"] += 10; // existing problem in January
    const next = books(["2025-04"], "x").map((a) => inc(a.code, a.name, a.cls, { "2025-04": a.amounts["2025-04"] + (a.cls === "cash" || a.cls === "retained_earnings" ? 900 : 0) }));
    const plan = planImport(broken, next, { mode: "merge", slices: { PL: ["2025-04"], BS: ["2025-04"] } });
    const jan = plan.checks.find((c) => c.id === "bs_balance" && c.period === "2025-01")!;
    expect(jan.existing).toBe(true);
    expect(unresolved(plan.checks, [])).toEqual([]);
    // the same failure blocks when the import touches January, until accepted
    const plan2 = planImport(broken, [inc("101000", "Bank", "cash", { "2025-01": 1310 })], { mode: "merge", slices: { PL: [], BS: ["2025-01"] } });
    const block = unresolved(plan2.checks, []);
    expect(block.map((c) => c.id)).toEqual(["bs_balance"]);
    expect(unresolved(plan2.checks, block.map(checkKey))).toEqual([]);
  });
});
