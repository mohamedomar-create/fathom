/** "Add only new months": one rule for every kind of line (ledger or sheet), the months whose accounts are new. */
export function keepForMode<T extends { period: string }>(lines: T[], mode: string, addedPL: ReadonlySet<string>): T[] {
  return mode === "add" ? lines.filter((l) => addedPL.has(l.period)) : lines;
}

/**
 * Which months lose the lines an earlier General Ledger left (sales, expense, stock and payment lines) when figures are saved.
 * "Update these months" (merge) keeps the detail unless the file brings its own ledger lines; then only its months are
 * replaced. Months before the books start are no longer in the books, so their lines always go. "Replace all" clears all.
 */
export function ledgerClear(mode: string, o: { fileHasLedger: boolean; touchedPL: string[]; preStart: string[] }): { all: boolean; months: string[] } {
  if (mode === "replace") return { all: true, months: [] };
  const own = mode === "merge" && o.fileHasLedger ? o.touchedPL : [];
  return { all: false, months: [...new Set([...own, ...o.preStart])].sort() };
}
