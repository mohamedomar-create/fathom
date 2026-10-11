import { z } from "zod";
import { REQUEST_TYPES } from "@/lib/engine";

/** What a company may save as its economic assumptions and loan request (kpi_config.economy). */
const Rate = z.number().finite().nullable().optional();
export const AssumptionsSchema = z.object({
  inflation: Rate.refine((v) => v == null || (v > -50 && v < 1000), "Inflation must be a yearly % between -50 and 1000"),
  fxStart: Rate.refine((v) => v == null || (v > 0 && v < 100000), "Exchange rates must be positive"),
  fxEnd: Rate.refine((v) => v == null || (v > 0 && v < 100000), "Exchange rates must be positive"),
  importShare: Rate.refine((v) => v == null || (v >= 0 && v <= 100), "Imported share must be 0 to 100%"),
  assetAge: Rate.refine((v) => v == null || (v >= 0 && v <= 100), "Asset age must be 0 to 100 years"),
  rate: Rate.refine((v) => v == null || (v >= 0 && v < 200), "Borrowing rate must be 0 to 200%"),
  principal12m: Rate.refine((v) => v == null || v >= 0, "Repayments cannot be negative"),
  tenor: Rate.refine((v) => v == null || (v > 0 && v <= 40), "Tenor must be 1 to 40 years"),
  requestAmount: Rate.refine((v) => v == null || (v >= 0 && v < 1e13), "The amount requested must be positive"),
  requestType: z.enum(REQUEST_TYPES).nullable().optional(),
  requestPurpose: z.string().trim().max(300, "Keep the purpose under 300 characters").nullable().optional(),
}).strict();
