import type { CashSheet, CashSkipCode } from "./read";

/**
 * What the person should do about a sheet, from what the reader found: things to fix in the sheet before it can be
 * read ("fix"), things to look at before saving ("check"), and things done for them ("info"). Each item names the
 * cells it is about. The screen words each code (English and Arabic).
 */
export type AdviceCode =
  | "noDate" | "noAmount" | "needMonth" | "needYear" | "needKind" | "badDates" | "badTypes" | "badAmounts" | "noDates" | "farDates"
  | "debitCredit" | "signed" | "qtyPrice" | "negOut" | "refunds" | "dayNumbers" | "monthly" | "dateOrder" | "duplicates" | "noAmounts"
  | "dateByContent" | "amountByContent" | "categoryByContent" | "balance" | "unused" | "titleRows" | "sections" | "totals";
export interface Advice { level: "fix" | "check" | "info"; code: AdviceCode; args: Record<string, string | number> }

const RANK = { fix: 0, check: 1, info: 2 } as const;
const cellsOf = (s: CashSheet, code: CashSkipCode) => s.skipped.filter((k) => k.code === code);
const list = (xs: string[], n = 5) => xs.slice(0, n).join(", ") + (xs.length > n ? ", …" : "");

export function cashAdvice(s: CashSheet): Advice[] {
  const out: Advice[] = s.notes.map((n) => ({ level: n.level, code: n.code as AdviceCode, args: n.args ?? {} }));
  if (s.needsKind) out.push({ level: "fix", code: "needKind", args: {} });
  const group = (code: CashSkipCode, as: AdviceCode, level: Advice["level"], withValue: boolean) => {
    const ks = cellsOf(s, code);
    if (ks.length) out.push({ level, code: as, args: { n: ks.length, cells: list(ks.map((k) => (withValue && k.value !== undefined ? `${k.cell ?? `row ${k.row}`} "${k.value}"` : k.cell ?? `row ${k.row}`))) } });
  };
  group("badDate", "badDates", "fix", true);
  group("badType", "badTypes", "fix", true);
  group("noDate", "noDates", "fix", false);
  const amounts = [...cellsOf(s, "tooSmall"), ...cellsOf(s, "tooLarge")];
  if (amounts.length) out.push({ level: "fix", code: "badAmounts", args: { n: amounts.length, cells: list(amounts.map((k) => `${k.cell ?? `row ${k.row}`} "${k.value ?? ""}"`)) } });
  const noAmount = cellsOf(s, "noAmount");
  if (noAmount.length) out.push({ level: "check", code: "noAmounts", args: { n: noAmount.length, rows: list(noAmount.map((k) => String(k.row)), 8) } });
  const totals = cellsOf(s, "total");
  if (totals.length) out.push({ level: "info", code: "totals", args: { n: totals.length, rows: list(totals.map((k) => String(k.row)), 8) } });
  if (s.sections) out.push({ level: "info", code: "sections", args: { n: s.sections } });
  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/** The rows that could not be read, with every cell as it was and why: to fix in the spreadsheet and upload again. */
export function unreadRows(s: CashSheet, rows: unknown[][], origin = { r: 0 }): { row: number; why: string; cells: unknown[] }[] {
  return s.skipped.filter((k) => k.code !== "total").map((k) => ({ row: k.row, why: k.reason, cells: rows[k.row - origin.r - 1] ?? [] }));
}
