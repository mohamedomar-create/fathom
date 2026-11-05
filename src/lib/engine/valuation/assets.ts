export interface AssetInputs {
  equity: number; cash: number; ar: number; arOver180: number; inventory: number; slowStock: number;
  fixedAssets: number; intangibles: number; investments: number; otherCA: number;
  /** Every liability on the balance sheet. */
  liabilities: number;
  /** End-of-service and lease amounts not already in the liabilities (0 when they are). */
  endOfService: number; lease: number;
}

/** What a buyer could recover on a forced sale, per pound of book value. */
export const RECOVERY = { cash: 1, ar: 0.7, inventory: 0.5, fixedAssets: 0.4, investments: 0.8, otherCA: 0.3, intangibles: 0 } as const;

/**
 * Book equity; adjusted (receivables over 180 days, slow stock and intangibles taken off); and liquidation (each asset at
 * what a forced sale recovers, less every liability).
 */
export function assetValues(a: AssetInputs) {
  const extra = a.endOfService + a.lease;
  const book = a.equity;
  const adjusted = a.equity - a.arOver180 - a.slowStock - a.intangibles - extra;
  const liquidation = a.cash * RECOVERY.cash + (a.ar - a.arOver180) * RECOVERY.ar + (a.inventory - a.slowStock) * RECOVERY.inventory
    + a.fixedAssets * RECOVERY.fixedAssets + a.investments * RECOVERY.investments + a.otherCA * RECOVERY.otherCA - a.liabilities - extra;
  return { book, adjusted, liquidation };
}
