// What a shared report link can show (O9, O18). Pure, so every case is unit-tested.
export type LinkState = { kind: "unavailable" } | { kind: "not_found" } | { kind: "ok"; unread: ("sales" | "expenses")[]; periodGone: boolean };

export function linkState(x: { mainError: boolean; found: boolean; salesError: boolean; expensesError: boolean; frozen: boolean; end: string; ends: { end: string }[] }): LinkState {
  // A read that failed is not a link that doesn't exist: say it couldn't be loaded, so the reader tries again.
  if (x.mainError) return { kind: "unavailable" };
  if (!x.found) return { kind: "not_found" };
  return {
    kind: "ok",
    unread: [...(x.salesError ? ["sales" as const] : []), ...(x.expensesError ? ["expenses" as const] : [])],
    // A link read live follows the books; once its period has left them, its figures would be for another period.
    periodGone: !x.frozen && !x.ends.some((e) => e.end === x.end),
  };
}
