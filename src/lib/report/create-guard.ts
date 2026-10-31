// Creating a report (O21): the server checks the role and the input, and the page says why it refused.
export type ReportRefusal = "view-only" | "invalid" | "save";
export const REPORT_REFUSAL: Record<ReportRefusal, string> = {
  "view-only": "View-only access: an editor or admin of this company creates reports.",
  invalid: "That report couldn't be created: the company or month wasn't valid. Reload the page and try again.",
  save: "The report couldn't be saved just now. Please try again in a moment.",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function reportRefusal(role: string, companyId: string, periodEnd: string): ReportRefusal | null {
  if (!UUID.test(companyId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodEnd)) return "invalid";
  if (role !== "editor" && role !== "admin" && role !== "owner") return "view-only";
  return null;
}
export const isRefusal = (x: unknown): x is ReportRefusal => typeof x === "string" && x in REPORT_REFUSAL;
