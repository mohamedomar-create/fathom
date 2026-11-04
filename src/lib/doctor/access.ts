import type { Scope } from "@/lib/rate-limit";

/** Explain and Ask spend the organisation's AI allowance: editors, admins and owners only (as AI commentary). */
export const mayUseDoctorAi = (role: string | null | undefined) => role === "editor" || role === "admin" || role === "owner";

/** The limits an AI answer counts against: the person's hourly limit for this kind, their daily AI limit, the company's. */
export const doctorAiLimits = (mode: "explain" | "ask", userId: string, companyId: string): [Scope, string][] =>
  [[mode === "ask" ? "ask" : "doctor", userId], ["ai_user", userId], ["ai_company", companyId]];
