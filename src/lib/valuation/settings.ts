import { z } from "zod";
import { SECTORS, type ValuationSettings } from "@/lib/engine/valuation";

const pct = (lo: number, hi: number) => z.number().finite().min(lo).max(hi);
const money = z.number().finite().min(0).max(1e13);

/** What an editor may save; every figure bounded so a typo can't produce a nonsense value. */
export const ValuationSettingsSchema = z.object({
  purpose: z.enum(["owner", "sale", "bank", "partners"]),
  sector: z.enum(SECTORS),
  riskFree: pct(0, 0.6).optional(),
  longRiskFree: pct(0, 0.6).optional(),
  equityPremium: pct(0, 0.25).optional(),
  beta: pct(0.2, 3).optional(),
  sizePremium: pct(0, 0.2).optional(),
  longGrowth: pct(-0.05, 0.3).optional(),
  growth: pct(-0.5, 1).optional(),
  targetMargin: pct(-0.5, 0.9).optional(),
  privateDiscount: pct(0, 0.6).optional(),
  debtWeight: pct(0, 0.9).optional(),
  costOfDebt: pct(0, 0.8).optional(),
  multEbitda: z.number().finite().min(0.5).max(60).optional(),
  multSales: z.number().finite().min(0.05).max(20).optional(),
  multPe: z.number().finite().min(1).max(100).optional(),
  ownerPay: money.optional(),
  arOver180: money.optional(),
  slowStock: money.optional(),
  fx: z.number().finite().min(0.01).max(10000).optional(),
  adjustments: z.array(z.object({
    key: z.enum(["oneoff", "owner", "disposal", "fx", "related", "other"]),
    label: z.string().trim().min(1).max(120),
    amount: z.number().finite().min(-1e12).max(1e12),
  })).max(40).optional(),
}).strict();

export const DEFAULT_VALUATION: ValuationSettings = { purpose: "owner", sector: "other" };

/**
 * The saved choices (kpi_config.profile.valuation). Each one is checked on its own, so one figure that no longer reads
 * falls back to its default without throwing away every other saved choice.
 */
export function valuationSettingsOf(kpiConfig: unknown): ValuationSettings {
  const raw = (kpiConfig as { profile?: { valuation?: unknown } } | null)?.profile?.valuation;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_VALUATION };
  const shape = ValuationSettingsSchema.shape as Record<string, z.ZodTypeAny>;
  const out: Record<string, unknown> = { ...DEFAULT_VALUATION };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = shape[k];
    if (!f) continue;
    const p = f.safeParse(v);
    if (p.success && p.data !== undefined) out[k] = p.data;
  }
  return out as unknown as ValuationSettings;
}
