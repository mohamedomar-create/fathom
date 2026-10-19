// The sub-ledger steps' status from the books: sales detail (file months) tied to revenue, stock tie-outs counted,
// each ageing report against its control account. Each figure comes from the same checks the sector pages use.
import { describe, expect, it } from "vitest";
import { buildMonths } from "@/lib/company/build";
import { subLedgerStatus } from "@/lib/company/data-status";
import type { AccountLine } from "@/lib/company/types";
import type { SalesData } from "@/lib/engine";

const B = ["At Date", "1-30", "31-60", "61-90", "91-120", "Older"];
const aged = (total: number) => ({ asOf: "2026-09-30", buckets: B, findings: [], total: { amounts: [total, 0, 0, 0, 0, 0], total }, items: [{ partner: "Delta", ref: "INV/1", memo: "", day: null, amounts: [total, 0, 0, 0, 0, 0], total }] });
const accounts: AccountLine[] = [
  { id: "1", code: "122200", name: "Trade Receivables", cls: "ar", amounts: { "2026-08": 2000, "2026-09": 2500 } },
  { id: "2", code: "211100", name: "Suppliers", cls: "ap", amounts: { "2026-08": 300, "2026-09": 300 } },
  { id: "3", code: "410000", name: "Revenues", cls: "revenue", amounts: { "2026-08": 1000, "2026-09": 2000 } },
];
const base = { months: buildMonths(accounts), checks: [], fyStart: 1, accounts };
const row = (p: string, a: number) => ({ p, c: "Delta", s: "", sp: "", a, k: null, ka: null, q: null, d: 1, n: 1 });

describe("sub-ledger status for the Data steps", () => {
  it("sales detail: only months from a file count, and a month off revenue by more than 1% is named", () => {
    const sales = { customers: [row("2026-08", 1000), row("2026-09", 1900)], products: [], sources: { "2026-08": "file", "2026-09": "file" } } as unknown as SalesData;
    expect(subLedgerStatus({ ...base, sales }).sales).toEqual({ months: ["2026-08", "2026-09"], untied: ["2026-09"] });
    const ledgerOnly = { ...sales, sources: { "2026-08": "ledger", "2026-09": "ledger" } } as unknown as SalesData;
    expect(subLedgerStatus({ ...base, sales: ledgerOnly }).sales).toBeNull();
  });

  it("ageing: each report with its date and whether it agrees with its control account", () => {
    const s = subLedgerStatus({ ...base, payments: { data: { aged: { receivable: aged(2500), payable: aged(250) }, payments: [] } } });
    expect(s.ageing).toEqual([{ side: "receivable", asOf: "2026-09-30", status: "ok" }, { side: "payable", asOf: "2026-09-30", status: "off" }]);
  });

  it("nothing loaded: no sales detail, no stock checks, no ageing", () => {
    expect(subLedgerStatus(base)).toEqual({ sales: null, stock: null, ageing: [] });
  });
});
