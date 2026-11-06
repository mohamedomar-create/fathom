/**
 * The months a module's period picker offers. With the books loaded, every page follows the accounting months, so the
 * same period means the same thing everywhere. Without them, a module that holds data uses its own months: it never
 * waits for another module before its filters work.
 */
export function ownMonths(accountingMonths: number, moduleMonths: string[]): string[] | undefined {
  if (accountingMonths > 0 || !moduleMonths.length) return undefined;
  return [...new Set(moduleMonths)].sort();
}
