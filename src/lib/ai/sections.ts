export const COMMENTARY_SECTIONS = ["summary", "kpis", "profitability", "cashflow", "pl", "bs", "trend", "growth", "goalseek"] as const;
export type CommentarySection = (typeof COMMENTARY_SECTIONS)[number];
