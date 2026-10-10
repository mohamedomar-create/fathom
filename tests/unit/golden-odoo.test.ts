import { describe, expect, it } from "vitest";
import { isPL, toNatural } from "@/lib/company/build";
import { runChecks } from "@/lib/company/checks";
import { plCalc } from "@/lib/engine";
import { buildMonths } from "@/lib/company/build";
import type { Grid } from "@/lib/ingest/extract";
import { ingest, toAccountInputs, type IngestOptions, type IngestResult } from "@/lib/ingest/pipeline";
import { detectDateOrder, parsePeriod } from "@/lib/ingest/parse";
import { ACCOUNTS, expected, generalLedger, MONTHS, PNL_NET_PROFIT, profitAndLoss, trialBalance } from "../fixtures/odoo-exports";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-10" };
const files = (...fs: [string, Grid[]][]) => fs.flatMap(([n, gs]) => gs.map((g) => ({ ...g, name: `${n} › ${g.name}` })));
const c2 = (x: number) => Math.round(x * 100) / 100 || 0;
const lineOf = (res: IngestResult, a: (typeof ACCOUNTS)[number]) => res.lines.find((l) => !l.system && (a.code ? l.code === a.code : l.name === a.name));
const checksOf = (res: IngestResult) => runChecks({ accounts: toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) })), controls: res.controls, extra: res.checks });

/** Every account, every month, to the cent: P&L = the month's movement, balance sheet = opening + movements to date. */
function expectExact(res: IngestResult, months: string[], placed: Record<string, string> = {}) {
  const { opening, mov } = expected();
  for (const a0 of ACCOUNTS) {
    const a = { ...a0, cls: (placed[a0.name] ?? a0.cls) as typeof a0.cls };
    const l = lineOf(res, a);
    expect(l?.cls ?? null, `${a.code} ${a.name}`).toBe(a.cls);
    if (!a.cls || !l) continue;
    const k = a.code || a.name;
    let run = opening[k] ?? 0;
    for (const p of MONTHS) {
      run += mov[k]?.[p] ?? 0;
      if (!months.includes(p)) continue;
      const want = isPL(a.cls) ? toNatural(a.cls, mov[k]?.[p] ?? 0) : toNatural(a.cls, run);
      expect(c2(l.values[p] ?? 0), `${k} ${a.name} ${p}`).toBe(c2(want));
    }
  }
}

describe("Odoo exports of an Egyptian company (General Ledger, Trial Balance, P&L)", () => {
  it("reads month-first dates for the whole ledger, so ambiguous dates land in the right month", () => {
    expect(detectDateOrder(["10/03/2026", "01/31/2026"])).toEqual({ order: "mdy", sample: "01/31/2026" });
    expect(detectDateOrder(["03/04/2026", "31/01/2026"])).toEqual({ order: "dmy", sample: "31/01/2026" });
    expect(detectDateOrder(["03/04/2026", "05/06/2026"]).order).toBeNull();
    expect(parsePeriod("03/04/2026", "mdy")).toBe("2026-03");
    expect(parsePeriod("03/04/2026", "dmy")).toBe("2026-04");
    expect(parsePeriod("03/04/2026")).toBe("2026-04"); // day first by default, as in Egypt
  });

  it("General Ledger alone gives every account, every month, exactly", () => {
    const res = ingest(generalLedger(), OPTS);
    expect(res.layouts[0]).toMatchObject({ kind: "ledger", source: "Odoo General Ledger", dates: { order: "mdy" } });
    expect(res.layouts[1]).toMatchObject({ kind: "skipped", source: "Report filters (no figures)" });
    expect(res.issues.warnings.some((w) => /Filters/.test(w))).toBe(false);
    expect(res.periods).toEqual(MONTHS);
    expectExact(res, MONTHS);
  });

  it("leaves out an entry dated in the future and says so; marks October as a part month", () => {
    const res = ingest(generalLedger(), OPTS);
    const fut = res.checks.find((c) => c.id === "future_dated")!;
    expect(fut.severity).toBe("warn");
    expect(fut.detail).toMatch(/31 Dec 2026/);
    expect(res.periods).not.toContain("2026-12");
    expect(res.asOf).toBe("2026-10-10");
    expect(res.checks.find((c) => c.id === "partial_month")).toMatchObject({ period: "2026-10", severity: "warn" });
  });

  it("asks about a vaguely named account instead of guessing, and balances once it is placed", () => {
    const res = ingest(generalLedger(), OPTS);
    const z = res.lines.find((l) => l.name === "z Adjustment")!;
    expect(z.cls).toBeNull();
    expect(Object.values(res.imbalance).map((v) => c2(Math.abs(v)))).toEqual(MONTHS.map(() => 175000.4));
    const fixed = ingest(generalLedger(), { ...OPTS, mapping: { "z adjustment": "other_ca" } });
    expect(Object.values(fixed.imbalance).every((v) => Math.abs(v) < 0.01)).toBe(true);
    expect(checksOf(fixed).filter((c) => c.severity === "block")).toEqual([]);
  });

  it("with the Trial Balance and P&L in the same upload, they check the ledger and are not imported", () => {
    const res = ingest(files(["general_ledger", generalLedger()], ["trial_balance", trialBalance()], ["profit_and_loss", profitAndLoss()]), { ...OPTS, mapping: { "z adjustment": "other_ca" } });
    const role = (s: string) => res.layouts.find((l) => l.sheet === s)?.role;
    expect(role("general_ledger › General Ledger")).toBe("data");
    expect(role("trial_balance › Trial Balance")).toBe("check");
    expect(role("profit_and_loss › Profit and Loss")).toBe("check");
    expect(res.issues.notes.filter((n) => /all \d+ account figures agree/.test(n))).toHaveLength(2);
    expectExact(res, MONTHS, { "z Adjustment": "other_ca" });
    // Odoo's net profit for 1 Jan – 10 Oct is the sum of the ten months.
    const ni = res.controls.find((c) => c.metric === "net_income")!;
    expect(ni).toMatchObject({ period: "2026-10", months: 10, value: PNL_NET_PROFIT() });
    const months = buildMonths(toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) })));
    expect(c2(months.reduce((s, m) => s + plCalc(m.pl).net_income, 0))).toBe(c2(PNL_NET_PROFIT()));
    // Gross profit is compared as we map it: the exchange gain Odoo prints under Revenue is explained, not a failure.
    expect(res.controls.find((c) => c.metric === "gross_profit")!.source).toMatch(/less Foreign Exchange Gain/);
    const checks = checksOf(res);
    expect(checks.filter((c) => c.severity === "block")).toEqual([]);
    expect(checks.filter((c) => c.id === "control_total")).toEqual([]);
  });

  it("a ledger that disagrees with the Trial Balance is stopped", () => {
    const gl = generalLedger();
    const row = gl[0].rows.find((r) => r[2] === "05/03/2026" && r[7])!; // a sales credit
    row[7] = (row[7] as number) + 1000;
    const res = ingest(files(["gl", gl], ["tb", trialBalance()]), OPTS);
    expect(res.checks.find((c) => c.id === "cross_check")?.severity).toBe("block");
    expect(res.checks.find((c) => c.id === "account_rollforward")?.severity).toBe("block");
  });

  it("Trial Balance alone: groups become sections, never lines; closing balances exact; the 10-month P&L stays a range", () => {
    const res = ingest(trialBalance(), OPTS);
    expect(res.layouts[0]).toMatchObject({ kind: "trial-balance", source: "Odoo Trial Balance", asOf: "2026-10-10" });
    expect(res.lines.some((l) => /^\d+ (Assets|Liabilities)|\(No Group\)/.test(l.name))).toBe(false);
    expect(res.lines.find((l) => l.code === "121103")!.section).toBe("1 Assets / 12 Current Assets / 121 Cash & Cash Equivalent / 1211 Cash IN Safe");
    expect(res.lines.find((l) => l.name === "xy opining balance")!.cls).toBe("other_equity");
    expect(res.ranges).toEqual({ "2026-10": 10 });
    const { opening, mov } = expected();
    for (const a of ACCOUNTS.filter((x) => x.cls && !isPL(x.cls))) {
      const k = a.code || a.name;
      const want = toNatural(a.cls!, (opening[k] ?? 0) + Object.values(mov[k] ?? {}).reduce((s, v) => s + v, 0));
      expect(c2(lineOf(res, a)?.values["2026-10"] ?? 0), k).toBe(c2(want));
    }
  });

  it("the user can correct the date order", () => {
    const res = ingest(generalLedger(), OPTS, { "General Ledger": { dateOrder: "dmy" } });
    expect(res.layouts[0].dates).toEqual({ order: "dmy", sample: null });
  });
});
