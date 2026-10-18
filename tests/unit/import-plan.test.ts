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

  it("warns when retained earnings move without matching profit, but not for owners' capital", () => {
    const a = books(["2025-01", "2025-02"]);
    a[3].amounts["2025-02"] += 400; a[2].amounts["2025-02"] += 400; // capital injection: normal, no warning
    expect(runChecks({ accounts: a }).filter((c) => c.id === "re_rollforward")).toEqual([]);
    const b = books(["2025-01", "2025-02"]);
    b[4].amounts["2025-02"] += 400; b[2].amounts["2025-02"] += 400; // retained earnings jump with no profit behind it
    const rf = runChecks({ accounts: b }).filter((c) => c.id === "re_rollforward");
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

describe("uploading months that are already loaded", () => {
  const asIncoming = (vs: VersionAccount[]) => vs.map((a) => inc(a.code, a.name, a.cls, { ...a.amounts }));
  const slices = (ps: string[]) => ({ PL: ps, BS: ps });

  it("names each month already loaded, and says when the file has the same figures", () => {
    const current = books(["2025-01", "2025-02", "2025-03"]);
    const file = asIncoming(books(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05"]));
    file[0].amounts["2025-03"] = 600; // March sales differ
    const plan = planImport(current, file, { mode: "merge", slices: slices(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05"]) });
    const pl = plan.overlap.filter((o) => o.statement === "PL").map((o) => [o.period, o.same]);
    expect(pl).toEqual([["2025-01", true], ["2025-02", true], ["2025-03", false]]);
  });

  it("'add only new months' keeps the loaded months exactly and adds the rest", () => {
    const current = books(["2025-01", "2025-02", "2025-03"]);
    const file = asIncoming(books(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05"]));
    file[0].amounts["2025-03"] = 600;
    const plan = planImport(current, file, { mode: "add", slices: slices(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05"]) });
    const sales = plan.accounts.find((a) => a.name === "Sales")!;
    expect(sales.amounts["2025-03"]).toBe(500); // kept, not the file's 600
    expect(sales.amounts["2025-05"]).toBe(500); // added
    expect(sales.sources?.["2025-03"]).toBe("imp-1");
    expect(plan.timeline.map((t) => [t.period, t.PL])).toEqual([["2025-01", "keep"], ["2025-02", "keep"], ["2025-03", "keep"], ["2025-04", "new"], ["2025-05", "new"]]);
    expect(plan.overlap.length).toBeGreaterThan(0);
    // "Replace those months" uses the file's figures instead.
    const merged = planImport(current, file, { mode: "merge", slices: slices(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05"]) });
    expect(merged.accounts.find((a) => a.name === "Sales")!.amounts["2025-03"]).toBe(600);
  });

  it("a file with only loaded months adds nothing in 'add' mode", () => {
    const current = books(["2025-01", "2025-02"]);
    const plan = planImport(current, asIncoming(books(["2025-01", "2025-02"])), { mode: "add", slices: slices(["2025-01", "2025-02"]) });
    expect(plan.timeline.every((t) => t.PL === "keep" && t.BS === "keep")).toBe(true);
    expect(plan.overlap.every((o) => o.same)).toBe(true);
  });
});

describe("an account that changes statement", () => {
  it("does not carry its old balance-sheet months into the P&L when a new file classes it as an expense", () => {
    const cur = [acct("130500", "Advances", "other_ca", { "2025-01": 100, "2025-02": 150, "2025-03": 200 }, { sources: { "2025-01": "i", "2025-02": "i", "2025-03": "i" } })];
    const plan = planImport(cur, [inc("130500", "Advances", "exp_fixed", { "2025-04": 40 })], { mode: "merge", slices: { PL: ["2025-04"], BS: ["2025-04"] } });
    const a = plan.accounts.find((x) => x.code === "130500")!;
    expect(a.cls).toBe("exp_fixed");
    expect(a.amounts).toEqual({ "2025-04": 40 });
  });
});

describe("changing an account's class in the chart of accounts", () => {
  it("lists the changes that would move an account between the P&L and the balance sheet", async () => {
    const { statementMoves } = await import("@/lib/company/import-plan");
    const cur = [{ id: "a", class: "other_ca" }, { id: "b", class: "exp_fixed" }, { id: "c", class: "revenue" }];
    expect(statementMoves(cur, { a: "exp_fixed", b: "exp_variable", c: "other_income" })).toEqual(["a"]);
    expect(statementMoves(cur, { b: "cash" })).toEqual(["b"]);
    expect(statementMoves(cur, {})).toEqual([]);
  });
});

describe("continuity with the months already loaded", () => {
  const cur = books(["2025-01", "2025-02", "2025-03"]);
  /** April from a ledger that brings its own opening balances (the March balance sheet). */
  const april = (bankOpening: number) => {
    const next = books(["2025-01", "2025-02", "2025-03", "2025-04"], "x");
    return next.map((a) => {
      const amounts: Record<string, number> = { "2025-04": a.amounts["2025-04"] };
      if (a.cls !== "revenue" && a.cls !== "exp_fixed") amounts["2025-03"] = a.code === "101000" ? bankOpening : a.amounts["2025-03"];
      return inc(a.code, a.name, a.cls, amounts);
    });
  };

  it("openings equal to the stored closing balances pass", () => {
    const plan = planImport(cur, april(1900), { mode: "merge", slices: { PL: ["2025-04"], BS: ["2025-03", "2025-04"] } });
    expect(plan.checks.filter((c) => c.id === "continuity")).toEqual([]);
  });

  it("an opening that differs from the stored closing stops the import and names the account", () => {
    const plan = planImport(cur, april(6900), { mode: "merge", slices: { PL: ["2025-04"], BS: ["2025-03", "2025-04"] } });
    const c = plan.checks.find((x) => x.id === "continuity")!;
    expect(c).toMatchObject({ severity: "block", period: "2025-03", statement: "BS" });
    expect(c.detail).toMatch(/101000 Bank: loaded 1,900, this file 6,900/);
    expect(unresolved(plan.checks, [])).toContainEqual(c);
  });

  it("replacing everything does not compare with what it replaces", () => {
    const plan = planImport(cur, april(6900), { mode: "replace", slices: { PL: ["2025-04"], BS: ["2025-03", "2025-04"] } });
    expect(plan.checks.filter((c) => c.id === "continuity")).toEqual([]);
  });
});

describe("books start (the main company went live on 1 Jul 2021)", () => {
  it("a merge drops stored months before the books start: P&L before it, balance sheets before the month before it", () => {
    const cur = books(["2021-01", "2021-02", "2021-06", "2021-07"]);
    const next = books(["2021-06", "2021-07", "2021-08"], "x").map((a) => inc(a.code, a.name, a.cls, Object.fromEntries(Object.entries(a.amounts).filter(([p]) => p >= (a.cls === "revenue" || a.cls === "exp_fixed" ? "2021-07" : "2021-06")))));
    const plan = planImport(cur, next, { mode: "merge", slices: { PL: ["2021-07", "2021-08"], BS: ["2021-06", "2021-07", "2021-08"] }, booksStart: "2021-07-01" });
    const months = new Set(plan.accounts.flatMap((a) => Object.keys(a.amounts)));
    expect([...months].sort()).toEqual(["2021-06", "2021-07", "2021-08"]);
    expect(plan.accounts.find((a) => a.code === "400000")!.amounts["2021-06"]).toBeUndefined();
    expect(plan.timeline.find((t) => t.period === "2021-01")).toMatchObject({ PL: "remove", BS: "remove" });
    expect(plan.timeline.find((t) => t.period === "2021-06")).toMatchObject({ PL: "remove" });
  });
});

describe("opening balances uploaded on their own", () => {
  // A ledger loaded with no opening balances: every balance was built from zero.
  const zero = (src = "imp-zero"): VersionAccount[] => {
    const s = (o: Record<string, number>) => ({ sources: Object.fromEntries(Object.keys(o).map((p) => [p, src])) });
    const sales = { "2021-07": 500, "2021-08": 500 }, rent = { "2021-07": 200, "2021-08": 200 }, cash = { "2021-07": 300, "2021-08": 600 }, re = { "2021-07": 300, "2021-08": 600 };
    return [acct("400000", "Sales", "revenue", sales, s(sales)), acct("610000", "Rent", "exp_fixed", rent, s(rent)), acct("101000", "Bank", "cash", cash, s(cash)), acct("999999", "Retained earnings", "retained_earnings", re, s(re))];
  };
  const opening = [inc("101000", "Bank", "cash", { "2021-06": 50_000 }), inc("122200", "Receivables", "ar", { "2021-06": 20_000 }), inc("211100", "Suppliers", "ap", { "2021-06": 5_000 }), inc("300000", "Opening equity", "other_equity", { "2021-06": 65_000 })];
  const opts = { mode: "merge" as const, slices: { PL: [], BS: ["2021-06"] }, booksStart: "2021-07-01", opening: { asAt: "2021-06-30" } };

  it("loaded after a ledger built from zero, every later balance moves by the opening, account by account", () => {
    const plan = planImport(zero(), opening, { ...opts, zeroMonths: ["2021-07", "2021-08"] });
    const at = (code: string) => plan.accounts.find((a) => a.code === code)!.amounts;
    expect(at("101000")).toEqual({ "2021-06": 50_000, "2021-07": 50_300, "2021-08": 50_600 });
    expect(at("122200")).toEqual({ "2021-06": 20_000, "2021-07": 20_000, "2021-08": 20_000 });
    expect(at("300000")).toEqual({ "2021-06": 65_000, "2021-07": 65_000, "2021-08": 65_000 });
    expect(at("400000")).toEqual({ "2021-07": 500, "2021-08": 500 });
    expect(plan.timeline.find((t) => t.period === "2021-07")).toMatchObject({ BS: "overwrite", PL: "keep" });
    expect(plan.checks.filter((c) => c.severity === "block")).toEqual([]);
  });

  it("months built on a file's own opening balances are not moved", () => {
    const plan = planImport(zero("imp-file"), opening, { ...opts, zeroMonths: [] });
    expect(plan.accounts.find((a) => a.code === "101000")!.amounts["2021-07"]).toBe(300);
  });

  it("an opening different from the one a loaded ledger already brought for that day is stopped, naming the accounts", () => {
    const cur = [...zero("imp-file"), acct("101000", "Bank", "cash", { "2021-06": 49_000 }, { sources: { "2021-06": "imp-file" } })];
    const plan = planImport(cur, opening, { ...opts, zeroMonths: [] });
    const c = plan.checks.find((x) => x.severity === "block" && x.id === "continuity");
    expect(c?.detail).toMatch(/Bank/);
  });
});

describe("opening balances against books loaded under other names (the main company, 18 Oct)", () => {
  const opts = { mode: "merge" as const, slices: { PL: [], BS: ["2021-06"] }, booksStart: "2021-07-01", opening: { asAt: "2021-06-30" }, zeroMonths: [] };
  const s = (o: Record<string, number>) => ({ sources: Object.fromEntries(Object.keys(o).map((p) => [p, "imp-old"])) });
  const stored = [
    acct("121211", "Bank Misr", "cash", { "2021-06": 50_000, "2021-07": 51_000 }, s({ "2021-06": 1, "2021-07": 1 })),
    acct("xy", "opining balance", "other_equity", { "2021-06": 49_400, "2021-07": 49_400 }, s({ "2021-06": 1, "2021-07": 1 })),
    acct("", "Retained earnings incl. profit to date", "retained_earnings", { "2021-06": 600, "2021-07": 1_600 }, s({ "2021-06": 1, "2021-07": 1 })),
  ];
  it("the same balances under another code split or another computed-earnings name are not a difference", () => {
    const opening = [inc("121211", "Bank Misr", "cash", { "2021-06": 50_000 }), inc("", "xy opining balance", "other_equity", { "2021-06": 49_400 }), inc("", "Earnings to date (computed from P&L accounts)", "retained_earnings", { "2021-06": 600 })];
    expect(planImport(stored, opening, opts).checks.filter((c) => c.severity === "block")).toEqual([]);
  });
  it("an account classed differently on each side (w.2 as a current asset or a liability) is the same debit balance, not a difference", () => {
    const withW2 = [...stored, acct("w.2", "Stock Interim (Received)", "other_ca", { "2021-06": 10_000, "2021-07": 10_000 }, s({ "2021-06": 1, "2021-07": 1 }))];
    const opening = [inc("121211", "Bank Misr", "cash", { "2021-06": 50_000 }), inc("", "xy opining balance", "other_equity", { "2021-06": 49_400 }), inc("", "Earnings to date (computed from P&L accounts)", "retained_earnings", { "2021-06": 600 }), inc("w.2", "Stock Interim (Received)", "other_cl", { "2021-06": -10_000 })];
    expect(planImport(withW2, opening, opts).checks.filter((c) => c.severity === "block" && c.id === "continuity")).toEqual([]);
  });

  it("a real difference still stops the save, naming the account", () => {
    const opening = [inc("121211", "Bank Misr", "cash", { "2021-06": 40_000 }), inc("", "xy opining balance", "other_equity", { "2021-06": 39_400 }), inc("", "Earnings to date (computed from P&L accounts)", "retained_earnings", { "2021-06": 600 })];
    const c = planImport(stored, opening, opts).checks.find((x) => x.severity === "block" && x.id === "continuity");
    expect(c?.detail).toMatch(/Bank Misr: 40,000 Dr here, 50,000 Dr loaded/);
    expect(c?.detail).not.toMatch(/Retained|Earnings to date/);
  });
});
