import type { LoadStatus } from "@/lib/company/loaded";

/**
 * Commentary must never describe figures that couldn't be read, or that are still being added up with nothing to show
 * (it would describe zeros). A previous copy shown while the latest is rebuilt is fine.
 */
export function commentaryRefusal(states: { status: LoadStatus; empty: boolean; ref?: string }[]): string | null {
  const failed = states.find((s) => s.status === "failed");
  if (failed) return `Sales or expense figures couldn't be read just now (ref ${failed.ref ?? "unknown"}). Please try again in a moment.`;
  if (states.some((s) => s.status === "pending" && s.empty)) return "Sales or expense figures are still being added up after your latest upload. Please try again in a minute.";
  return null;
}
