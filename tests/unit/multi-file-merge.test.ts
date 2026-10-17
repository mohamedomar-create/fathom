// A history exported one year at a time (six yearly files from Odoo) is one set of books: the files are merged by
// account and month, never refused as "counted twice" (spec R2.3, P1).
import { describe, expect, it } from "vitest";
import { runChecks } from "@/lib/company/checks";
import { ingest, toAccountInputs, type IngestOptions, type IngestResult } from "@/lib/ingest/pipeline";
import type { Grid } from "@/lib/ingest/extract";
import { generalLedger, months, trialBalanceDebitCredit, trialBalanceSigned, trialBalanceWindow } from "../fixtures/odoo";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {} };
const blocking = (res: IngestResult) =>
  runChecks({ accounts: toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) })), controls: res.controls, extra: res.checks }).filter((c) => c.severity === "block");
/** Each class's total per month, as stored. */
const byClass = (res: IngestResult) => {
  const out: Record<string, number> = {};
  for (const a of toAccountInputs(res)) for (const [p, v] of Object.entries(a.amounts)) out[`${a.cls} ${p}`] = Math.round(((out[`${a.cls} ${p}`] ?? 0) + v) * 100) / 100;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => Math.abs(v) > 0.005).sort());
};
const last = months.length - 1;

describe("several financial files in one upload", () => {
  it("files a year apart give the same books as one file of the whole period", () => {
    const one = ingest(trialBalanceDebitCredit(), OPTS);
    const split = ingest([...trialBalanceWindow(1, 5), ...trialBalanceWindow(6, 9), ...trialBalanceWindow(10, last)], OPTS);
    expect(blocking(split)).toEqual([]);
    expect(split.periods).toEqual(one.periods);
    expect(byClass(split)).toEqual(byClass(one));
  });

  it("yearly General Ledgers give the same books, and the same ledger lines, as one ledger", () => {
    const one = ingest(generalLedger(), OPTS);
    const split = ingest([...generalLedger(trialBalanceWindow(1, 6), "GL a"), ...generalLedger(trialBalanceWindow(7, last), "GL b")], OPTS);
    expect(blocking(split)).toEqual([]);
    expect(byClass(split)).toEqual(byClass(one));
    const entries = (r: IngestResult) => r.lines.flatMap((l) => l.entries ?? []).length;
    expect(entries(split)).toBe(entries(one));
  });

  it("a balance is never carried into the months of the next file", () => {
    const split = ingest([...trialBalanceWindow(1, 5), ...trialBalanceWindow(6, last)], OPTS);
    const cash = split.lines.filter((l) => l.cls === "cash" && l.sheet === `TB ${months[1].period}`);
    for (const l of cash) expect(Object.keys(l.values).every((p) => p <= months[5].period)).toBe(true);
  });

  it("a later file whose opening balances disagree with the earlier file's closing is refused, naming the account", () => {
    const a = trialBalanceWindow(1, 5), b = trialBalanceWindow(6, last);
    const row = b[0].rows.find((r) => typeof r[0] === "string" && / Cash|Bank/i.test(r[0] as string) && ((r[1] as number) > 0))!;
    row[1] = (row[1] as number) + 1000;
    const res = ingest([...a, ...b], OPTS);
    const off = blocking(res).find((c) => c.id === "continuity");
    expect(off?.detail).toContain(String(row[0]).replace(/^\d+ /, ""));
    expect(off?.detail).toMatch(/1,000/);
  });

  it("the same account and month with the same amount in two sheets is counted once", () => {
    const g: Grid[] = [...trialBalanceSigned(), { ...trialBalanceSigned()[0], name: "TB copy" }];
    const res = ingest(g, OPTS);
    expect(blocking(res)).toEqual([]);
    expect(byClass(res)).toEqual(byClass(ingest(trialBalanceSigned(), OPTS)));
    expect(res.issues.notes.join(" ")).toMatch(/counted once/);
  });

  it("the same account and month with different amounts is refused, with both amounts", () => {
    const copy = { ...trialBalanceSigned()[0], name: "TB copy" };
    copy.rows = copy.rows.map((r) => [...r]);
    copy.rows[1][2] = (copy.rows[1][2] as number) + 500;
    const dup = blocking(ingest([...trialBalanceSigned(), copy], OPTS)).find((c) => c.id === "duplicate");
    expect(dup?.title).toMatch(/different amounts/);
    expect(dup?.detail).toContain(months[1].period);
    expect(dup?.detail).toContain("'TB copy'");
  });
});
