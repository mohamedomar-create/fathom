// A cash-basis set of books from a cash book (Phase 3a), built when a business moves to the full system so Financials
// and the dashboard work at once. Money counts in the month it moves: an entry marked unpaid stays out until it is paid,
// and one paid later counts in the month it was paid. The balance sheet balances by construction:
//   cash      = opening cash + every paid entry in, less every paid entry out (transfers between its own cash left out)
//   equipment = assets bought;   loans = loans in less repaid;   owner's money = opening cash + capital less drawings
//   profit kept in the business = the P&L to date.
import type { ClassKey } from "@/lib/engine";
import type { Entry } from "./figures";

export interface CashBookAccount { code: string; name: string; cls: ClassKey; amounts: Record<string, number>; mapped_by: "system" }
export interface CashBooks { accounts: CashBookAccount[]; months: string[]; heldOut: { unpaidIn: number; unpaidOut: number } }

const r2 = (x: number) => Math.round(x * 100) / 100;
const monthOf = (d: string) => d.slice(0, 7);

export function cashBooks(entries: Entry[], o: { opening: { amount: number; asOf: string } | null; today: string }): CashBooks {
  const last = monthOf(o.today);
  const heldOut = { unpaidIn: 0, unpaidOut: 0 };
  // Each entry's cash month: when it was paid (or its own day when the paid date isn't known); none when unpaid.
  const moved: { p: string; d: string; e: Entry }[] = [];
  for (const e of entries) {
    if (e.paid === false) { if (e.direction === "in") heldOut.unpaidIn = r2(heldOut.unpaidIn + e.amount); else heldOut.unpaidOut = r2(heldOut.unpaidOut + e.amount); continue; }
    const d = e.paid && e.paidOn ? e.paidOn : e.day;
    const p = monthOf(d);
    if (p > last || e.kind === "transfer") continue;
    moved.push({ p, d, e });
  }
  if (!moved.length) return { accounts: [], months: [], heldOut };
  const first = [moved.reduce((a, x) => (x.p < a ? x.p : a), moved[0].p), ...(o.opening ? [monthOf(o.opening.asOf)] : [])].reduce((a, b) => (b < a ? b : a));
  const openAt = o.opening ? monthOf(o.opening.asOf) : null;
  const end = [moved.reduce((a, x) => (x.p > a ? x.p : a), first), ...(openAt && openAt <= last ? [openAt] : [])].reduce((a, b) => (b > a ? b : a));
  const months: string[] = [];
  for (let [y, m] = first.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= end; m === 12 ? (y++, m = 1) : m++) months.push(`${y}-${String(m).padStart(2, "0")}`);

  const pl = new Map<string, { cls: ClassKey; amounts: Record<string, number> }>();
  const addPl = (name: string, cls: ClassKey, p: string, x: number) => {
    const a = pl.get(name) ?? { cls, amounts: {} };
    a.amounts[p] = r2((a.amounts[p] ?? 0) + x);
    pl.set(name, a);
  };
  // Movements per month for the balance sheet.
  const mv = new Map<string, { cash: number; assets: number; loans: number; owner: number; profit: number }>(months.map((p) => [p, { cash: 0, assets: 0, loans: 0, owner: 0, profit: 0 }]));
  for (const { p, d, e } of moved) {
    // The opening cash is the balance on its day: what moved before it is already in it (the cash book counts the same
    // way), so it stays out of the balance sheet; the P&L still shows it.
    const m = o.opening && d < o.opening.asOf ? { cash: 0, assets: 0, loans: 0, owner: 0, profit: 0 } : mv.get(p)!;
    const signed = e.direction === "in" ? e.amount : -e.amount;
    m.cash += signed;
    switch (e.kind) {
      case "capital": case "drawings": m.owner += signed; break;
      case "loan": case "loan_repayment": m.loans += signed; break;
      case "asset": m.assets += e.amount; break;
      case "other_income": addPl("Other income (cash book)", "other_income", p, e.amount); m.profit += e.amount; break;
      case "purchase": addPl("Purchases (cash book)", "cos_variable", p, e.amount); m.profit -= e.amount; break;
      default:
        if (e.direction === "in") { addPl("Sales (cash book)", "revenue", p, e.amount); m.profit += e.amount; }
        else { addPl(e.category.trim() || "Expenses (cash book)", "exp_variable", p, e.amount); m.profit -= e.amount; }
    }
  }
  const bs: Record<"cash" | "assets" | "loans" | "owner" | "profit", Record<string, number>> = { cash: {}, assets: {}, loans: {}, owner: {}, profit: {} };
  const run = { cash: 0, assets: 0, loans: 0, owner: 0, profit: 0 };
  for (const p of months) {
    const m = mv.get(p)!;
    if (openAt === p) { run.cash += o.opening!.amount; run.owner += o.opening!.amount; }
    for (const k of Object.keys(run) as (keyof typeof run)[]) { run[k] = r2(run[k] + m[k]); if (!openAt || p >= openAt) bs[k][p] = run[k]; }
  }
  const BS: [keyof typeof bs, string, ClassKey][] = [
    ["cash", "Cash (cash book)", "cash"], ["assets", "Equipment and assets (cash book)", "fixed_assets"], ["loans", "Loans (cash book)", "ltd"],
    ["owner", "Owner's money (cash book)", "other_equity"], ["profit", "Profit kept in the business (cash book)", "retained_earnings"],
  ];
  const accounts: CashBookAccount[] = [
    ...[...pl].map(([name, a]) => ({ code: "", name: name.slice(0, 300), cls: a.cls, amounts: a.amounts, mapped_by: "system" as const })),
    ...BS.map(([k, name, cls]) => ({ code: "", name, cls, amounts: bs[k], mapped_by: "system" as const })),
  ];
  return { accounts, months, heldOut };
}

/** Moving to the full system copies entries into every month; months already closed can't change (0043), so refuse first. */
export function fullSwitchRefusal(closedThrough: string | null): string | null {
  if (!closedThrough) return null;
  const [y, m] = closedThrough.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  return `The books are closed through ${label}, so the cash book can't be copied into those months. Reopen them in Month close first, then switch.`;
}
