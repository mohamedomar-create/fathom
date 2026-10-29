/**
 * One rule for every "does it agree?" in the app (the owner's ruling): money agrees to 1 EGP, quantities exactly.
 * Checks, readiness, data status, the ledger tie, tie-outs, cash flow and the reports all use these.
 */
export const TIE_EGP = 1;

export type Measure = "money" | "qty";

export const tied = (a: number, b: number, m: Measure = "money") => Math.abs((a || 0) - (b || 0)) <= (m === "qty" ? 0 : TIE_EGP);
export const differs = (a: number, b: number, m: Measure = "money") => !tied(a, b, m);
/** A balance-sheet or cash-flow difference small enough to be rounding. */
export const balanced = (diff: number) => Math.abs(diff || 0) <= TIE_EGP;
