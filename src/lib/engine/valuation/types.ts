/** A value range: a low, a central and a high figure, in the company's currency. */
export interface Range { low: number; mid: number; high: number }

export type MethodKey = "dcf" | "ebitda" | "sales" | "pe" | "capitalised" | "sde" | "adjustedAssets" | "bookAssets" | "liquidation";
export type Purpose = "owner" | "sale" | "bank" | "partners";

/** One method's answer: a range of equity value, or why it does not apply. */
export interface MethodResult { key: MethodKey; value: Range | null; reason?: string; ev?: Range | null }
