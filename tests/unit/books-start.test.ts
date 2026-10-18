// The day a company's books start in Odoo (its go-live): everything posted before it, Odoo's opening journal entry
// included, is the opening balance, never trading months. the main company went live on 1 Jul 2021 with its opening entry
// dated 30 Jun 2021 and six months of depreciation posted before it.
import { describe, expect, it } from "vitest";
import { buildMonths } from "@/lib/company/build";
import { runChecks } from "@/lib/company/checks";
import { bsCalc } from "@/lib/engine";
import { ingest, toAccountInputs, type IngestOptions } from "@/lib/ingest/pipeline";
import type { Grid } from "@/lib/ingest/extract";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-18" };
const H = ["Code", "Account Name", "Date", "Communication", "Partner", "Currency", "Debit", "Credit", "Balance"];
type Row = [ref: string, day: string, amount: number, label?: string];
const acc = (code: string, name: string, rows: Row[]) => {
  const bal = rows.reduce((s, r) => s + r[2], 0);
  return [
    [code || null, name, null, null, null, null, bal > 0 ? bal : null, bal < 0 ? -bal : null, bal],
    ...rows.map(([ref, d, a, label]) => [null, ref, d, label ?? "x", null, null, a > 0 ? a : null, a < 0 ? -a : null, null]),
    [null, `Total ${code} ${name}`.replace("  ", " "), null, null, null, null, null, null, bal],
  ];
};
const dep = (sign: number): Row[] => ["01/31", "02/28", "03/31", "04/30", "05/31", "06/30", "07/31", "08/31"].map((d) => ["ASSTE/2021/01", `${d}/2021`, 100 * sign]);
const OJE = "Opening Journal Entry";
function gl(): Grid[] {
  const rows = [
    [null, null, "From 01/01/2021\nto 08/31/2021"], [], H,
    ...acc("111202", "Acc. Depreciation - Lap Tops", dep(-1)),
    ...acc("121211", "Bank Misr", [[OJE, "06/30/2021", 50_000, "Opening Balance - Bank Misr"], ["INV/2021/0001", "07/10/2021", 10_000], ["MISC/2021/0066", "07/01/2021", -1_000]]),
    ...acc("122200", "Trade Receivables (Gross)", [[OJE, "06/30/2021", 20_000, "Opening Balance"]]),
    ...acc("211100", "Suppliers", [[OJE, "06/30/2021", -5_000, "Opening Balance"]]),
    ...acc("", "xy opining balance", [[OJE, "06/30/2021", -65_000, "Opening Balance - None"], ["MISC/2021/0066", "07/01/2021", 1_000, "In opening balance by mistake"]]),
    ...acc("410000", "Revenues", [["INV/2021/0001", "07/10/2021", -10_000]]),
    ...acc("541000", "Lap Tops Depreciation Exp.", dep(1)),
    [null, "Total", null, null, null, null, null, null, null],
  ];
  return [{ name: "General Ledger", rows }];
}
const OPEN = { ...OPTS, mapping: { "#xy": "other_equity" as const } };
const inputs = (r: ReturnType<typeof ingest>) => toAccountInputs(r);
const months = (r: ReturnType<typeof ingest>) => buildMonths(inputs(r).map((a, i) => ({ ...a, id: String(i) })));

describe("books start", () => {
  it("without it, the opening entry and the months before go-live read as trading months (the fault)", () => {
    const r = ingest(gl(), OPEN);
    expect(r.slices.PL[0]).toBe("2021-01");
  });

  it("Odoo's opening journal entry on 30 Jun suggests books starting on 1 Jul", () => {
    const r = ingest(gl(), OPEN);
    expect(r.booksStart).toMatchObject({ suggested: "2021-07-01", day: "2021-06-30", applied: null });
  });

  it("from 1 Jul: June holds the opening balance sheet only, and trading starts in July", () => {
    const r = ingest(gl(), { ...OPEN, booksStart: "2021-07-01" });
    expect(r.slices.PL).toEqual(["2021-07", "2021-08"]);
    expect(r.slices.BS[0]).toBe("2021-06");
    expect(r.booksStart).toMatchObject({ applied: "2021-07-01", entries: 16 });
    const all = inputs(r).flatMap((a) => Object.keys(a.amounts));
    expect(all.filter((p) => p < "2021-06")).toEqual([]);
    const jun = months(r).find((m) => m.period === "2021-06")!;
    expect(Object.keys(jun.pl ?? {})).toEqual([]);
    const b = bsCalc(jun.bs);
    expect(b.cash).toBe(50_000);
    expect(b.ar).toBe(20_000);
    expect(Math.round(b.ta - b.tle)).toBe(0);
  });

  it("depreciation before go-live sits in opening retained earnings, never in a month's P&L or the expense lines", () => {
    const r = ingest(gl(), { ...OPEN, booksStart: "2021-07-01" });
    const exp = inputs(r).find((a) => /Depreciation Exp/.test(a.name))!;
    expect(exp.amounts).toEqual({ "2021-07": 100, "2021-08": 100 });
    expect(r.lines.flatMap((l) => l.entries ?? []).filter((e) => e.day < "2021-07-01")).toEqual([]);
    const blocks = runChecks({ accounts: inputs(r).map((a, i) => ({ ...a, id: String(i) })), controls: r.controls, extra: r.checks }).filter((c) => c.severity === "block");
    expect(blocks).toEqual([]);
  });

  it("a posting to the opening-balance account after go-live is listed for the accountant", () => {
    const r = ingest(gl(), { ...OPEN, booksStart: "2021-07-01" });
    const c = r.checks.find((x) => x.id === "opening_account_postings");
    expect(c?.severity).toBe("warn");
    expect(c?.detail).toContain("MISC/2021/0066");
  });
});
