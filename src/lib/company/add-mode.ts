/** "Add only new months": one rule for every kind of line (ledger or sheet), the months whose accounts are new. */
export function keepForMode<T extends { period: string }>(lines: T[], mode: string, addedPL: ReadonlySet<string>): T[] {
  return mode === "add" ? lines.filter((l) => addedPL.has(l.period)) : lines;
}
