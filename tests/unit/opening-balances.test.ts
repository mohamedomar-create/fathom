// Opening balances as their own upload, for any company: the balance sheet the day before the books start. Without one,
// balances start from zero, and loading it later moves every balance built from zero by the same amount.
import { describe, expect, it } from "vitest";
import { buildMonths } from "@/lib/company/build";
import { bsCalc } from "@/lib/engine";
import { ingestOpening, toAccountInputs, type IngestOptions } from "@/lib/ingest/pipeline";
import type { Grid } from "@/lib/ingest/extract";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: { "#xy": "other_equity" }, today: "2026-10-18" };
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
const OJE = "Opening Journal Entry";
/** Odoo's General Ledger for the opening day, as a company exports it: the opening entry and depreciation posted before it. */
function openingLedger(unbalanced = 0): Grid[] {
  const rows = [
    [null, null, "From 06/30/2021\nto 06/30/2021"], [], H,
    ...acc("111202", "Acc. Depreciation - Lap Tops", [["ASSTE/2021/0185", "06/30/2021", -600]]),
    ...acc("121211", "Bank Misr", [[OJE, "06/30/2021", 50_000 + unbalanced, "Opening Balance - Bank Misr"]]),
    ...acc("122200", "Trade Receivables (Gross)", [[OJE, "06/30/2021", 20_000, "Opening Balance"]]),
    ...acc("211100", "Suppliers", [[OJE, "06/30/2021", -5_000, "Opening Balance"]]),
    ...acc("", "xy opining balance", [[OJE, "06/30/2021", -65_000, "Opening Balance - None"]]),
    ...acc("541000", "Lap Tops Depreciation Exp.", [["ASSTE/2021/0185", "06/30/2021", 600]]),
  ];
  return [{ name: "General Ledger", rows }];
}
const bsAt = (r: ReturnType<typeof ingestOpening>, p: string) => {
  const m = buildMonths(toAccountInputs(r).map((a, i) => ({ ...a, id: String(i) }))).find((x) => x.period === p)!;
  return { m, b: bsCalc(m.bs) };
};

describe("the opening balances upload", () => {
  it("Odoo's opening-day ledger becomes the balance sheet of 30 Jun 2021 only, with pre-go-live P&L in retained earnings", () => {
    const r = ingestOpening(openingLedger(), { ...OPTS, asAt: "2021-06-30" });
    expect(r.slices).toEqual({ PL: [], BS: ["2021-06"] });
    const { m, b } = bsAt(r, "2021-06");
    expect(Object.keys(m.pl ?? {})).toEqual([]);
    expect(b.cash).toBe(50_000);
    expect(b.ar).toBe(20_000);
    expect(Math.round(b.ta - b.tle)).toBe(0);
    expect(r.issues.notes.join(" ")).toMatch(/600.*retained earnings/);
    expect(r.booksStart.applied).toBe("2021-07-01");
  });

  it("a template sheet (code, account, debit, credit) as at a day gives the same balance sheet", () => {
    const tpl: Grid[] = [{ name: "Opening balances", rows: [
      ["Code", "Account", "Debit", "Credit"],
      ["111202", "Acc. Depreciation - Lap Tops", null, 600],
      ["121211", "Bank Misr", 50_000, null],
      ["122200", "Trade Receivables (Gross)", 20_000, null],
      ["211100", "Suppliers", null, 5_000],
      ["xy", "opining balance", null, 65_000],
      ["541000", "Lap Tops Depreciation Exp.", 600, null],
    ] }];
    const r = ingestOpening(tpl, { ...OPTS, asAt: "2021-06-30" });
    expect(r.slices).toEqual({ PL: [], BS: ["2021-06"] });
    const { b } = bsAt(r, "2021-06");
    expect([b.cash, b.ar, Math.round(b.ta - b.tle)]).toEqual([50_000, 20_000, 0]);
  });

  it("an opening that does not balance is stopped, naming the difference", () => {
    const r = ingestOpening(openingLedger(1_000), { ...OPTS, asAt: "2021-06-30" });
    expect(r.checks.some((c) => c.severity === "block" && /1,000/.test(`${c.title} ${c.detail}`))).toBe(true);
  });

  it("the as-at day must be a month end", () => {
    expect(() => ingestOpening(openingLedger(), { ...OPTS, asAt: "2021-06-15" })).toThrow(/month end/i);
  });
});

describe("the opening balances template", () => {
  it("filled in and uploaded, it reads back as the balance sheet at the day given", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { buildTemplate } = await import("@/lib/templates/build");
    const { readWorkbook } = await import("@/lib/ingest/read");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTemplate("opening", { year: 2021, fyStart: 1, currency: "EGP" }) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Opening balances")!;
    const head = ws.getRow(4).values as unknown[];
    expect(head.slice(1, 5)).toEqual(["Code", "Account", "Debit", "Credit"]);
    [["121211", "Bank Misr", 50_000, null], ["211100", "Suppliers", null, 5_000], ["310000", "Capital", null, 45_000]].forEach((r, i) => { ws.getRow(5 + i).values = r; });
    const buf = await wb.xlsx.writeBuffer();
    const grids = await readWorkbook(buf as ArrayBuffer, "opening.xlsx");
    const r = ingestOpening(grids, { ...OPTS, mapping: { "#310000": "other_equity" }, asAt: "2021-06-30" });
    const { b } = bsAt(r, "2021-06");
    expect([b.cash, Math.round(b.ta - b.tle)]).toEqual([50_000, 0]);
  });
});
