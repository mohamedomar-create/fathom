export interface BridgeItems { cash: number; investments: number; debt: number; lease: number; endOfService: number; provisions: number; dividendsPayable: number }
export type BridgeKey = "ev" | keyof BridgeItems | "equity";
export interface BridgeRow { key: BridgeKey; value: number }

/** Enterprise value to equity value: less loans and debt-like items, plus cash and investments the business doesn't need to run. */
export function equityBridge(ev: number, b: BridgeItems): { equity: number; rows: BridgeRow[] } {
  const minus: (keyof BridgeItems)[] = ["debt", "lease", "endOfService", "provisions", "dividendsPayable"];
  const plus: (keyof BridgeItems)[] = ["cash", "investments"];
  const rows: BridgeRow[] = [{ key: "ev", value: ev }];
  let equity = ev;
  for (const k of minus) { equity -= b[k]; rows.push({ key: k, value: -b[k] }); }
  for (const k of plus) { equity += b[k]; rows.push({ key: k, value: b[k] }); }
  rows.push({ key: "equity", value: equity });
  return { equity, rows };
}
