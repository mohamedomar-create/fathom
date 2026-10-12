import { z } from "zod";
import { FORECAST_HORIZONS } from "@/lib/engine";

/** What a company may save as its forecast drivers (kpi_config.forecast). */
const N = z.number().finite().nullable().optional();
export const ForecastSchema = z.object({
  horizon: z.number().refine((v) => (FORECAST_HORIZONS as readonly number[]).includes(v), "Forecast 12, 18 or 24 months").nullable().optional(),
  revenueGrowth: N.refine((v) => v == null || (v > -100 && v <= 1000), "Growth must be a yearly % above -100"),
  grossMargin: N.refine((v) => v == null || (v > -100 && v < 100), "Gross margin must be below 100%"),
  costInflation: N.refine((v) => v == null || (v > -50 && v <= 500), "Cost rise must be a yearly % between -50 and 500"),
  dso: N.refine((v) => v == null || (v >= 0 && v <= 730), "Days must be 0 to 730"),
  dio: N.refine((v) => v == null || (v >= 0 && v <= 730), "Days must be 0 to 730"),
  dpo: N.refine((v) => v == null || (v >= 0 && v <= 730), "Days must be 0 to 730"),
  capex: N.refine((v) => v == null || (v >= 0 && v < 1e13), "Investment cannot be negative"),
  loanAmount: N.refine((v) => v == null || (v >= 0 && v < 1e13), "The loan cannot be negative"),
  loanMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the month the loan is drawn").nullable().optional(),
  repayment: N.refine((v) => v == null || (v >= 0 && v < 1e13), "Repayments cannot be negative"),
  dividends: N.refine((v) => v == null || (v >= 0 && v < 1e13), "Dividends cannot be negative"),
  rate: N.refine((v) => v == null || (v >= 0 && v < 200), "Borrowing rate must be 0 to 200%"),
}).strict();
