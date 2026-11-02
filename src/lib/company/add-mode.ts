/** "Add only new months": one rule for every kind of line (ledger or sheet), the months whose accounts are new. */
export function keepForMode<T extends { period: string }>(lines: T[], mode: string, addedPL: ReadonlySet<string>): T[] {
  return mode === "add" ? lines.filter((l) => addedPL.has(l.period)) : lines;
}

/**
 * Which months lose the lines an earlier General Ledger left (sales, expense, stock and payment lines) when figures are saved.
 * "Update these months" (merge) keeps the detail unless the file brings its own ledger lines; then only its months are
 * replaced. Months before the books start are no longer in the books, so their lines always go. "Replace all" clears all.
 */
export function ledgerClear(mode: string, o: { ledgerMonths: string[]; touchedPL: string[]; preStart: string[] }): { all: boolean; months: string[] } {
  if (mode === "replace") return { all: true, months: [] };
  // Only the months the ledger itself covers: a balances file uploaded with it never clears the others.
  const gl = new Set(o.ledgerMonths);
  const own = mode === "merge" ? o.touchedPL.filter((p) => gl.has(p)) : [];
  return { all: false, months: [...new Set([...own, ...o.preStart])].sort() };
}

/**
 * Whether a balances file (Trial Balance, P&L, balance sheet) is only checked against the books: by default when the books
 * come from a General Ledger, or when the Trial Balance step asked for a check. Chosen "as my figures", it is saved, with
 * "Update these months" keeping the detail. A file with its own entries (a ledger, journal items) is never only a check.
 */
export function balancesCheckOnly(o: { kind: string | null; read: boolean; ledgerFile: boolean; asFigures: boolean; setupStep: string | null; ledgerLoaded: boolean }): boolean {
  return o.kind === "accounts" && o.read && !o.ledgerFile && !o.asFigures && (o.setupStep === "tb" || o.ledgerLoaded);
}
