import sample from "../../../reference/sample.json";
import type { AgedItemData, PaymentsData } from "@/lib/engine/payments";

/**
 * Receivables, payables and payments for the demo company, made up but consistent: the ageing reports add up exactly to
 * the demo balance sheet's receivables and payables at its last month, so the tie-out to the books agrees.
 */
const CUSTOMERS = ["Northside Hospital", "Riverside Clinic", "Green Valley Pharmacy", "Central Care Centre", "Lakeside Medical", "Hilltop Hospital", "Sunrise Home Care", "Harbour Clinic"];
const SUPPLIERS = ["Medline Supply", "Breas Medical", "Nebuliser Co", "Cairo Logistics", "Office Mart"];
const BUCKETS = ["At Date", "1-30", "31-60", "61-90", "91-120", "Older"];

let cache: PaymentsData | null = null;

export function demoPayments(): PaymentsData {
  if (cache) return cache;
  const last = sample.months[sample.months.length - 1] as { period: string; bs: Record<string, number> };
  const asOf = `${last.period}-${String(new Date(Date.UTC(+last.period.slice(0, 4), +last.period.slice(5), 0)).getUTCDate()).padStart(2, "0")}`;
  // Each partner's share of the balance and how it is spread over the buckets; the last partner takes the rounding.
  const spread = (total: number, names: string[], prefix: string, shape: number[][]): AgedItemData[] => {
    const weights = names.map((_, i) => names.length - i);
    const sum = weights.reduce((a, b) => a + b, 0);
    let left = Math.round(total * 100);
    return names.map((partner, i) => {
      const cents = i === names.length - 1 ? left : Math.round((total * 100 * weights[i]) / sum);
      left -= cents;
      const s = shape[i % shape.length];
      let rest = cents;
      const amounts = s.map((w, k) => { const v = k === s.length - 1 ? rest : Math.round(cents * w); rest -= v; return v / 100; });
      return { partner, ref: `${prefix}/${last.period.slice(0, 4)}/${String(i + 1).padStart(4, "0")}`, memo: "", day: null, amounts, total: cents / 100 };
    });
  };
  const ar = spread(last.bs.ar ?? 0, CUSTOMERS, "INV", [[0.55, 0.3, 0.1, 0.05, 0, 0], [0.4, 0.3, 0.2, 0.1, 0, 0], [0.2, 0.2, 0.2, 0.1, 0.1, 0.2]]);
  const ap = spread(last.bs.ap ?? 0, SUPPLIERS, "BILL", [[0.6, 0.3, 0.1, 0, 0, 0], [0.5, 0.5, 0, 0, 0, 0]]);
  const tot = (items: AgedItemData[]) => ({ amounts: BUCKETS.map((_, k) => Math.round(items.reduce((s, i) => s + i.amounts[k], 0) * 100) / 100), total: Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100 });
  const payments = sample.months.slice(-6).flatMap((m, j) => {
    const rev = (m as { pl: Record<string, number> }).pl.revenue ?? 0;
    return [
      ...CUSTOMERS.slice(0, 5).map((c, i) => ({ day: `${m.period}-${String(5 + i * 4).padStart(2, "0")}`, number: `BNK/${m.period.replace("-", "")}/${i + 1}`, journal: i === 4 ? "Notes Receivable" : "Bank", method: "Manual", partner: c, amount: Math.round((rev * 0.18) / (i + 1)), currency: "EGP", amountCurrency: Math.round((rev * 0.18) / (i + 1)), state: (i === 4 && j === 5 ? "in_process" : "paid") as "paid" | "in_process" })),
      ...SUPPLIERS.slice(0, 3).map((s, i) => ({ day: `${m.period}-${String(10 + i * 6).padStart(2, "0")}`, number: `PAY/${m.period.replace("-", "")}/${i + 1}`, journal: i === 2 ? "Cash" : "Bank", method: "Manual", partner: s, amount: -Math.round((rev * 0.25) / (i + 1)), currency: "EGP", amountCurrency: -Math.round((rev * 0.25) / (i + 1)), state: "paid" as const })),
    ];
  });
  cache = { aged: { receivable: { asOf, buckets: BUCKETS, total: tot(ar), findings: [], items: ar }, payable: { asOf, buckets: BUCKETS, total: tot(ap), findings: [], items: ap } }, payments };
  return cache;
}
