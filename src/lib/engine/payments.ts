import { tied } from "@/lib/tolerance";
// The Payments module: what customers owe and how late (Odoo's Aged Receivable), what the company owes (Aged Payable),
// the money received and paid (Odoo's payments list), and the ageing tied to its control account in the books.
import { addMonths, mlabel } from "./format";
import { windowFor, type PeriodSel } from "./period";
import { monthLabel } from "@/lib/i18n";

export type Side = "receivable" | "payable";
export interface AgedItemData { partner: string; ref: string; memo: string; day: string | null; amounts: number[]; total: number }
export interface AgedData { asOf: string; buckets: string[]; total: { amounts: number[]; total: number }; findings: { id: string; message: string }[]; items: AgedItemData[]; filename?: string | null }
export type PaymentKind = "customers" | "suppliers" | "transfer" | "other";
/** A payment from Odoo's payments list (source "file") or a bank or cash entry of the General Ledger (source "ledger",
 *  with the kind of payment and the class on the other side of its journal entry). */
export interface PaymentData { day: string; number: string; journal: string; method: string; partner: string; amount: number; currency: string; amountCurrency: number; state: "paid" | "in_process"; kind?: PaymentKind | ""; counter?: string; source?: "file" | "ledger" }
export interface PaymentsData { aged: Partial<Record<Side, AgedData>>; payments: PaymentData[] }
export const EMPTY_PAYMENTS: PaymentsData = { aged: {}, payments: [] };

export interface PartnerAge { name: string; amounts: number[]; total: number; overdue: number; over90: number; items: number }
export interface SideView {
  side: Side; asOf: string; buckets: string[];
  /** Net balance, as Odoo's total; what partners with a debit balance owe; the credits of partners in credit. */
  total: number; owed: number; credits: number;
  /** Of what is owed, partner by partner (a partner's own credits first offset its debts): not yet due, overdue, over 90 days. */
  notDue: number; overdue: number; over90: number;
  partners: PartnerAge[]; credit: PartnerAge[];
  /** Largest partner's share of what is owed (positive balances only). */
  top: { name: string; share: number } | null;
  /** Days of sales (receivable) or of cost (payable) the balance stands for; null without the figures. */
  days: number | null;
  findings: { id: string; message: string }[];
}
export interface Flows {
  /** "ledger": every bank and cash entry of the General Ledger (transfers between own accounts left out); "file": a payments list. */
  basis: "ledger" | "file";
  received: number; paid: number; net: number; inProcess: number;
  /** Moved between the company's own bank and cash accounts (ledger only): not money in or out. */
  transfers: number;
  byKind: { kind: PaymentKind; counter: string; received: number; paid: number; count: number }[];
  byMonth: { p: string; received: number; paid: number }[];
  byJournal: { journal: string; amount: number; count: number }[];
  byPartner: { partner: string; amount: number; count: number }[];
}
export interface Tieout { side: Side; asOf: string; ageing: number; books: number | null; diff: number | null; status: "ok" | "off" | "no_books"; account: string; notInAgeing: { account: string; amount: number }[] }
export interface PaymentsFinding { kind: "risk" | "watch" | "win"; title: string; text: string }
export interface PaymentsAnalysis { receivable: SideView | null; payable: SideView | null; flows: Flows; tieouts: Tieout[]; findings: PaymentsFinding[]; label: string }

type Account = { code: string; name: string; cls: string; amounts: Record<string, number> };
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const NO_PARTNER = /^(unknown|unknown partner|no partner|غير معروف|بدون شريك)?$/i;
const NOT_DUE = /^(at date|not due|current|غير مستحق|حتى تاريخه)$/i;
const OVER_90 = (b: string) => /older|اقدم|أقدم/i.test(b) || Number(b.match(/(\d+)\s*[-+]/)?.[1] ?? 0) >= 91 || Number(b.match(/(\d+)\s*\+/)?.[1] ?? 0) >= 90;
const CONTROL_NAME: Record<Side, RegExp> = { receivable: /trade receivable|customers?|clients?|debtors? control|عملاء|العملاء/i, payable: /trade payable|suppliers?|vendors?|creditors? control|موردين|الموردين/i };
const CLASS: Record<Side, string> = { receivable: "ar", payable: "ap" };
const label = (a: Account) => `${a.code} ${a.name}`.trim();

/** The account(s) an ageing is kept on: the one whose balance equals its total, else the one named for it, else all of the class. */
export function suggestControl(side: Side, total: number, period: string, accounts: Account[]): string[] {
  const own = accounts.filter((a) => a.cls === CLASS[side]);
  const exact = own.filter((a) => Math.abs((a.amounts[period] ?? 0) - total) <= 1);
  if (exact.length === 1) return [exact[0].code];
  const named = own.filter((a) => CONTROL_NAME[side].test(a.name));
  if (named.length) return named.map((a) => a.code);
  return own.map((a) => a.code);
}

function sideView(side: Side, d: AgedData, perDay: number | null): SideView {
  const notDueIx = d.buckets.findIndex((b) => NOT_DUE.test(b.trim()));
  const over90Ix = d.buckets.map((b, i) => (OVER_90(b) ? i : -1)).filter((i) => i >= 0);
  const by = new Map<string, PartnerAge>();
  for (const it of d.items) {
    const p = by.get(it.partner) ?? { name: it.partner, amounts: d.buckets.map(() => 0), total: 0, overdue: 0, over90: 0, items: 0 };
    it.amounts.forEach((v, i) => { p.amounts[i] = r2(p.amounts[i] + v); });
    p.total = r2(p.total + it.total); p.items++;
    by.set(it.partner, p);
  }
  for (const p of by.values()) {
    p.overdue = r2(p.total - (notDueIx >= 0 ? p.amounts[notDueIx] : 0));
    p.over90 = r2(over90Ix.reduce((s, i) => s + p.amounts[i], 0));
  }
  const all = [...by.values()];
  const owed = all.filter((p) => p.total > 0.005);
  const owedSum = owed.reduce((s, p) => s + p.total, 0);
  const biggest = owed.sort((a, b) => b.total - a.total)[0];
  const total = r2(d.total.total);
  const clamp = (v: number, hi: number) => Math.min(Math.max(v, 0), hi);
  const debtors = all.filter((p) => p.total > 0.005);
  const overdue = r2(debtors.reduce((s, p) => s + clamp(p.overdue, p.total), 0));
  return {
    side, asOf: d.asOf, buckets: d.buckets, total, owed: r2(owedSum), credits: r2(all.filter((p) => p.total < -0.005).reduce((s, p) => s + p.total, 0)),
    notDue: r2(owedSum - overdue), overdue, over90: r2(debtors.reduce((s, p) => s + clamp(p.over90, clamp(p.overdue, p.total)), 0)),
    partners: all.filter((p) => Math.abs(p.total) > 0.005 || p.amounts.some((v) => Math.abs(v) > 0.005)).sort((a, b) => b.overdue - a.overdue || b.total - a.total),
    credit: all.filter((p) => p.total < -0.005 && !NO_PARTNER.test(p.name.trim())).sort((a, b) => a.total - b.total),
    top: biggest && owedSum > 0 ? { name: biggest.name, share: biggest.total / owedSum } : null,
    days: perDay && perDay > 0 ? Math.round(total / perDay) : null,
    findings: d.findings,
  };
}

export function paymentsAnalysis(d: PaymentsData, sel: PeriodSel, fyStart: number, opts: { accounts?: Account[]; control?: Partial<Record<Side, string[]>>; revenue?: Record<string, number>; cost?: Record<string, number>; lang?: "en" | "ar"; cur?: string } = {}): PaymentsAnalysis {
  const ar = opts.lang === "ar";
  const L = (en: string, a: string) => (ar ? a : en);
  const cur = opts.cur ?? "EGP";
  const fmt = (v: number) => `${cur} ${Math.round(v).toLocaleString("en-US")}`;
  const win = windowFor(sel, fyStart);
  // Days a balance stands for: the last three months' figures to the ageing's month, over the days they cover.
  const perDay = (asOf: string, flows?: Record<string, number>) => {
    if (!flows) return null;
    const ps = [0, 1, 2].map((i) => addMonths(asOf.slice(0, 7), -i));
    if (!ps.every((p) => p in flows)) return null;
    const days = ps.reduce((s, p) => s + new Date(Date.UTC(+p.slice(0, 4), +p.slice(5), 0)).getUTCDate(), 0);
    return ps.reduce((s, p) => s + flows[p], 0) / days;
  };
  const receivable = d.aged.receivable ? sideView("receivable", d.aged.receivable, perDay(d.aged.receivable.asOf, opts.revenue)) : null;
  const payable = d.aged.payable ? sideView("payable", d.aged.payable, perDay(d.aged.payable.asOf, opts.cost)) : null;

  // The General Ledger's payments, when loaded, are the record (every bank entry, tied to the books); a payments file
  // then only adds what the ledger can't say: cheques still in process.
  const fromLedger = d.payments.some((p) => p.source === "ledger");
  const base = fromLedger ? d.payments.filter((p) => p.source === "ledger") : d.payments;
  const files = d.payments.filter((p) => p.source !== "ledger");
  const real = base.filter((p) => p.kind !== "transfer");
  const inWinAll = base.filter((p) => win.periods.includes(p.day.slice(0, 7)));
  const inWin = inWinAll.filter((p) => p.kind !== "transfer");
  const groupOf = <K extends string>(rows: PaymentData[], key: (p: PaymentData) => string, name: K) => {
    const m = new Map<string, { amount: number; count: number }>();
    for (const p of rows) { const k = key(p); const e = m.get(k) ?? { amount: 0, count: 0 }; e.amount = r2(e.amount + p.amount); e.count++; m.set(k, e); }
    return [...m].map(([k, v]) => ({ [name]: k, ...v }) as { [P in K]: string } & { amount: number; count: number }).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  };
  const group = <K extends string>(key: (p: PaymentData) => string, name: K) => groupOf(inWin, key, name);
  const months = [...new Set(base.map((p) => p.day.slice(0, 7)))].sort();
  const kinds = new Map<string, Flows["byKind"][number]>();
  for (const p of inWinAll) {
    const kind = (p.kind || (p.amount >= 0 ? "customers" : "suppliers")) as PaymentKind;
    const k = `${kind}|${p.counter ?? ""}`;
    const e = kinds.get(k) ?? { kind, counter: p.counter ?? "", received: 0, paid: 0, count: 0 };
    if (p.amount >= 0) e.received = r2(e.received + p.amount); else e.paid = r2(e.paid - p.amount);
    e.count++; kinds.set(k, e);
  }
  const order: PaymentKind[] = ["customers", "suppliers", "transfer", "other"];
  const flows: Flows = {
    basis: fromLedger ? "ledger" : "file",
    received: r2(inWin.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0)),
    paid: r2(-inWin.filter((p) => p.amount < 0).reduce((s, p) => s + p.amount, 0)),
    net: r2(inWin.reduce((s, p) => s + p.amount, 0)),
    inProcess: r2(files.filter((p) => win.periods.includes(p.day.slice(0, 7)) && p.state === "in_process").reduce((s, p) => s + p.amount, 0)),
    transfers: r2(inWinAll.filter((p) => p.kind === "transfer" && p.amount > 0).reduce((s, p) => s + p.amount, 0)),
    byKind: [...kinds.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.received + b.paid - (a.received + a.paid)),
    byMonth: months.map((p) => ({ p, received: r2(real.filter((x) => x.day.startsWith(p) && x.amount > 0).reduce((s, x) => s + x.amount, 0)), paid: r2(-real.filter((x) => x.day.startsWith(p) && x.amount < 0).reduce((s, x) => s + x.amount, 0)) })),
    byJournal: groupOf(inWinAll, (p) => p.journal || "—", "journal"),
    byPartner: group((p) => p.partner || "—", "partner"),
  };

  const tieouts: Tieout[] = [];
  for (const v of [receivable, payable]) {
    if (!v) continue;
    const accounts = opts.accounts ?? [];
    const p = v.asOf.slice(0, 7);
    const codes = opts.control?.[v.side]?.length ? opts.control[v.side]! : suggestControl(v.side, v.total, p, accounts);
    const used = accounts.filter((a) => codes.includes(a.code) && (a.cls === CLASS[v.side] || opts.control?.[v.side]?.length));
    const has = used.some((a) => p in a.amounts);
    const books = has ? r2(used.reduce((s, a) => s + (a.amounts[p] ?? 0), 0)) : null;
    const diff = books === null ? null : r2(v.total - books);
    tieouts.push({
      side: v.side, asOf: v.asOf, ageing: v.total, books, diff, status: books === null ? "no_books" : tied(diff!, 0) ? "ok" : "off", account: used.map(label).join(" + "),
      notInAgeing: accounts.filter((a) => a.cls === CLASS[v.side] && !codes.includes(a.code) && Math.abs(a.amounts[p] ?? 0) > 0.005).map((a) => ({ account: label(a), amount: r2(a.amounts[p]) })),
    });
  }

  const findings: PaymentsFinding[] = [];
  const word = (s: Side) => (s === "receivable" ? L("receivables", "المستحقات من العملاء") : L("payables", "المستحقات للموردين"));
  for (const t of tieouts.filter((x) => x.status === "off")) findings.push({
    kind: "risk",
    title: L(`The ageing of ${t.side === "receivable" ? "receivables" : "payables"} does not agree with the books`, `أعمار ${word(t.side)} لا تطابق الدفاتر`),
    text: L(`${fmt(t.ageing)} in Odoo's ageing at ${t.asOf}, ${fmt(t.books!)} on ${t.account || "the control account"}: a difference of ${fmt(t.diff!)}. Export both for the same date, or check the account chosen.`,
      `${fmt(t.ageing)} في تقرير الأعمار في ${t.asOf} مقابل ${fmt(t.books!)} في ${t.account || "حساب المراقبة"}: فرق ${fmt(t.diff!)}.`),
  });
  if (receivable && receivable.owed > 0 && receivable.over90 / receivable.owed > 0.2) findings.push({
    kind: "watch",
    title: L(`${Math.round((receivable.over90 / receivable.owed) * 100)}% of what customers owe is more than 90 days old`, `${Math.round((receivable.over90 / receivable.owed) * 100)}% من مستحقات العملاء تجاوزت 90 يومًا`),
    text: L(`${fmt(receivable.over90)} owed for over 90 days. Chase the largest first: ${receivable.partners.filter((p) => p.over90 > 0).slice(0, 3).map((p) => `${p.name} ${fmt(p.over90)}`).join(", ")}.`,
      `${fmt(receivable.over90)} مستحقة منذ أكثر من 90 يومًا. ابدأ بالأكبر: ${receivable.partners.filter((p) => p.over90 > 0).slice(0, 3).map((p) => `${p.name} ${fmt(p.over90)}`).join("، ")}.`),
  });
  if (receivable?.top && receivable.top.share > 0.3) findings.push({
    kind: "watch",
    title: L(`One customer holds ${Math.round(receivable.top.share * 100)}% of what is owed`, `عميل واحد عليه ${Math.round(receivable.top.share * 100)}% من المستحقات`),
    text: L(`${receivable.top.name}: if it pays late, cash is hit hard.`, `${receivable.top.name}: أي تأخير في سداده يؤثر بقوة على السيولة.`),
  });
  for (const v of [receivable, payable]) if (v?.credit.length) findings.push({
    kind: "watch",
    title: v.side === "receivable" ? L(`${v.credit.length} customers are in credit`, `${v.credit.length} عملاء أرصدتهم دائنة`) : L(`${v.credit.length} suppliers owe the company`, `${v.credit.length} موردين أرصدتهم مدينة`),
    text: L(`${fmt(-v.credit.reduce((s, p) => s + p.total, 0))}: advances or payments not matched to ${v.side === "receivable" ? "invoices" : "bills"} (${v.credit.slice(0, 3).map((p) => p.name).join(", ")}). Match them in Odoo.`,
      `${fmt(-v.credit.reduce((s, p) => s + p.total, 0))}: دفعات مقدمة أو مدفوعات غير مطابقة (${v.credit.slice(0, 3).map((p) => p.name).join("، ")}). طابقها في Odoo.`),
  });
  if (flows.inProcess > 0) findings.push({
    kind: "watch",
    title: L(`${fmt(flows.inProcess)} of collections are still in process`, `${fmt(flows.inProcess)} من التحصيلات ما زالت قيد التنفيذ`),
    text: L("Cheques and notes received but not yet cleared by the bank: counted as collected, not cash yet.", "شيكات وأوراق قبض لم تُحصَّل من البنك بعد: محسوبة تحصيلًا وليست نقدية بعد."),
  });
  const ml = (p: string) => (ar ? monthLabel(p, "ar") : mlabel(p));
  return { receivable, payable, flows, tieouts, findings, label: win.periods.length === 1 ? ml(win.periods[0]) : `${ml(win.periods[0])} – ${ml(win.periods[win.periods.length - 1])}` };
}
