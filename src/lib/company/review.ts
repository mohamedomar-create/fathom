import { mlabel, plCalc, bsCalc, type ClassKey, type MonthData } from "@/lib/engine";
import type { AccountLine } from "./types";
import { buildMonths, CREDIT_CLASSES, isPL } from "./build";
import type { Check } from "./checks";

/**
 * The questions an experienced accountant asks of books that already balance: balances left where nothing should stay,
 * a margin far from the company's own usual level, a month with no depreciation. Each is a warning with a question for
 * management, never a block; the person can accept it with a reason.
 */
type Acc = Pick<AccountLine, "cls" | "amounts"> & { name?: string };
const SUSPENSE = /suspense|clearing|adjust|undistributed|difference|معلق|وسيط|تسوي|فروق|تحت التسوية/i;
// Odoo's stock interim accounts legitimately hold goods received but not yet billed, or delivered but not yet invoiced.
const INTERIM_IN = /interim.*(received|receipt|input)|goods received not (yet )?(billed|invoiced)|بضاعة (واردة|مستلمة)/i;
const INTERIM_OUT = /interim.*(delivered|delivery|output)|goods delivered not (yet )?invoiced|بضاعة (منصرفة|مسلمة)/i;
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

export function reviewChecks({ accounts, months = buildMonths(accounts as AccountLine[]) }: { accounts: Acc[]; months?: MonthData[] }): Check[] {
  const out: Check[] = [];
  const sorted = [...months].sort((a, b) => a.period.localeCompare(b.period));
  const bsMonths = sorted.filter((m) => Object.keys(m.bs).length);
  const plMonths = sorted.filter((m) => Object.keys(m.pl).length);

  // 1. Suspense, clearing and adjustment accounts should be empty at month end (the latest balance sheet).
  const last = bsMonths[bsMonths.length - 1];
  if (last) {
    const ta = Math.abs(bsCalc(last.bs).ta);
    const material = Math.max(1, ta * 0.0005);
    for (const a of accounts) {
      if (isPL(a.cls) || a.cls === "retained_earnings" || !a.name) continue;
      const v = a.amounts[last.period] ?? 0;
      if (Math.abs(v) <= material) continue;
      if (INTERIM_IN.test(a.name) || INTERIM_OUT.test(a.name)) {
        const inbound = INTERIM_IN.test(a.name);
        out.push({ id: "review", severity: "warn", period: last.period, statement: "BS", title: inbound ? "Goods received, not yet billed" : "Goods delivered, not yet invoiced",
          detail: `"${a.name}" holds ${fmt(Math.abs(v))} at ${mlabel(last.period)}: ${inbound ? "goods received from suppliers whose bills are not yet posted" : "goods delivered to customers who are not yet invoiced"}. A normal balance in Odoo's stock accounting; check that old receipts${inbound ? "" : " or deliveries"} are not left open and that the balance matches the open ${inbound ? "purchase orders" : "deliveries"}.`, actual: v });
        continue;
      }
      if (!SUSPENSE.test(a.name)) continue;
      const credit = CREDIT_CLASSES.has(a.cls as ClassKey) ? v > 0 : v < 0;
      out.push({ id: "review", severity: "warn", period: last.period, statement: "BS", title: `Balance left in "${a.name}"`,
        detail: `"${a.name}" holds ${fmt(Math.abs(v))} (${credit ? "credit" : "debit"}) at ${mlabel(last.period)}. Suspense, clearing and adjustment accounts should be empty at month end: ask what it is and clear it in Odoo.`, actual: v });
    }
  }

  // 2. Gross margin far from the company's usual level (the median of the other months with revenue), last 12 months.
  const margin = (m: MonthData) => { const P = plCalc(m.pl); return P.revenue > 0 ? P.gross_profit / P.revenue : NaN; };
  const withRev = plMonths.filter((m) => Number.isFinite(margin(m)));
  for (const m of withRev.slice(-12)) {
    const others = withRev.filter((o) => o !== m).map(margin);
    if (others.length < 3) continue;
    const usual = median(others), now = margin(m);
    if (Math.abs(now - usual) <= 0.15) continue;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    out.push({ id: "review", severity: "warn", period: m.period, statement: "PL", title: `Gross margin ${pct(now)} against a usual ${pct(usual)}`,
      detail: `Gross margin in ${mlabel(m.period)} is ${pct(now)}, far from the company's usual ${pct(usual)}. The usual cause: cost of sales is posted when goods are delivered but revenue when the invoice is issued, in another month (in Odoo, Anglo-Saxon accounting with the "Stock Interim (Delivered)" output account matches them). Otherwise check stock count adjustments, or costs posted to the wrong month or account. Read margins over a quarter until then.`, actual: now, expected: usual });
  }

  // 3. A month with no depreciation while the months on both sides have it (and fixed assets are held).
  const dep = (m: MonthData) => (m.pl.cos_depreciation ?? 0) + (m.pl.exp_depreciation ?? 0);
  plMonths.forEach((m, i) => {
    if (i === 0 || i === plMonths.length - 1 || dep(m)) return;
    const before = plMonths.slice(Math.max(0, i - 3), i), after = plMonths.slice(i + 1, i + 4);
    if (!before.some(dep) || !after.some(dep)) return;
    if (!(bsCalc(m.bs).fixed_assets > 0) && !accounts.some((a) => a.cls === "fixed_assets" && (a.amounts[m.period] ?? 0) > 0)) return;
    if (plMonths.slice(-12).every((x) => x !== m)) return;
    out.push({ id: "review", severity: "warn", period: m.period, statement: "PL", title: "No depreciation booked",
      detail: `${mlabel(m.period)} has no depreciation while the months around it do. Check that the month's depreciation entry was posted in Odoo.` });
  });
  return out;
}
