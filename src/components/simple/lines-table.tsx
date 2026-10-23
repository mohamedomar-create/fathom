"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import type { SimpleLines, StoredExpense, StoredSale } from "@/lib/company/simple-load";
import { addLine, deleteLine, updateLine } from "@/app/company/[id]/data/line-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";

type Kind = "sales" | "expenses";
/** A line as the form holds it: every field as typed. */
type Draft = Record<string, string>;
const SHOW = 200;

const blankDraft = (kind: Kind): Draft => (kind === "sales"
  ? { day: "", customer: "", product: "", amount: "", cost: "", channel: "", paid: "", paidOn: "" }
  : { day: "", category: "", supplier: "", cls: "", amount: "", paid: "", paidOn: "" });
const draftOf = (kind: Kind, l: StoredSale | StoredExpense): Draft => {
  const paid = l.paid === true ? "yes" : l.paid === false ? "no" : "";
  if (kind === "sales") { const s = l as StoredSale; return { day: s.day ?? "", customer: s.customer, product: s.product, amount: String(s.amount), cost: s.cost === null ? "" : String(s.cost), channel: s.channel ?? "", paid, paidOn: s.paidOn ?? "" }; }
  const e = l as StoredExpense;
  return { day: e.day ?? "", category: e.category || e.account, supplier: e.supplier, cls: e.cls === "exp_fixed" || e.cls === "exp_variable" ? e.cls : "", amount: String(e.amount), paid, paidOn: e.paidOn ?? "" };
};
/** The form's text as the line the server checks: numbers as numbers, blanks left out or cleared. */
function lineOf(kind: Kind, d: Draft): Record<string, unknown> {
  const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
  const out: Record<string, unknown> = { day: d.day || undefined, amount: n(d.amount) ?? undefined, paid: d.paid === "yes" ? true : d.paid === "no" ? false : null, paidOn: d.paidOn || null };
  if (kind === "sales") Object.assign(out, { customer: d.customer, product: d.product, cost: n(d.cost), channel: d.channel });
  else Object.assign(out, { category: d.category, supplier: d.supplier, ...(d.cls ? { cls: d.cls } : {}) });
  return out;
}

export function LinesTable({ lines }: { lines: SimpleLines }) {
  const c = useCompany();
  const T = useT();
  const t = T.d.simple;
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("sales");
  const list: (StoredSale | StoredExpense)[] = kind === "sales" ? lines.sales : lines.expenses;
  const months = useMemo(() => [...new Set(list.map((l) => l.period))].sort().reverse(), [list]);
  const [month, setMonth] = useState<string>("");
  const shownMonth = month && months.includes(month) ? month : months[0] ?? "";
  const rows = list.filter((l) => !shownMonth || shownMonth === "all" || l.period === shownMonth);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft(kind));
  const [adding, setAdding] = useState<Draft>(blankDraft(kind));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cur = c.settings.currency;
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) => start(async () => {
    setError(null);
    const r = await fn();
    if (!r.ok) setError(r.error); else { done?.(); router.refresh(); }
  });
  const switchKind = (k: Kind) => { setKind(k); setEditing(null); setMonth(""); setAdding(blankDraft(k)); setError(null); };
  const cols = kind === "sales"
    ? [["day", t.date, "date"], ["customer", t.customer, "text"], ["product", t.product, "text"], ["amount", t.amount, "num"], ["cost", t.cost, "num"], ["channel", t.channel, "text"], ["paid", t.paid, "paid"], ["paidOn", t.paidOn, "date"]] as const
    : [["day", t.date, "date"], ["category", t.category, "text"], ["supplier", t.supplier, "text"], ["cls", t.kind, "cls"], ["amount", t.amount, "num"], ["paid", t.paid, "paid"], ["paidOn", t.paidOn, "date"]] as const;
  const field = (d: Draft, set: (d: Draft) => void, key: string, type: string, testId: string) => {
    const base = "w-full min-w-[90px] rounded border border-line px-1.5 py-1 text-sm";
    if (type === "paid") return <select className={base} value={d[key]} onChange={(e) => set({ ...d, [key]: e.target.value })} data-testid={testId}><option value="">{t.blank}</option><option value="yes">{t.yes}</option><option value="no">{t.no}</option></select>;
    if (type === "cls") return <select className={base} value={d[key]} onChange={(e) => set({ ...d, [key]: e.target.value })} data-testid={testId}><option value="">{t.blank}</option><option value="exp_fixed">{t.fixed}</option><option value="exp_variable">{t.variable}</option></select>;
    return <input className={base} type={type === "date" ? "date" : "text"} inputMode={type === "num" ? "decimal" : undefined} value={d[key]} onChange={(e) => set({ ...d, [key]: e.target.value })} data-testid={testId} />;
  };
  const cell = (l: StoredSale | StoredExpense, key: string) => {
    const v = draftOf(kind, l)[key];
    if (key === "amount" || key === "cost") return v === "" ? "–" : money(Number(v), cur);
    if (key === "paid") return v === "yes" ? t.yes : v === "no" ? t.no : "–";
    if (key === "cls") return v === "exp_fixed" ? t.fixed : v === "exp_variable" ? t.variable : "–";
    return v || "–";
  };
  return (
    <div data-testid="simple-lines">
      <p className="mb-4 text-mute">{t.linesSub}</p>
      {c.readOnly && <p className="mb-4 rounded bg-band px-4 py-2 text-sm" data-testid="lines-view-only">{t.viewOnly}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded border border-line">
          {(["sales", "expenses"] as const).map((k) => (
            <button key={k} type="button" onClick={() => switchKind(k)} className={cn("px-4 py-1.5 text-sm", kind === k ? "bg-brand-d text-white" : "hover:bg-band")} data-testid={`lines-tab-${k}`}>{k === "sales" ? t.salesTab : t.expensesTab}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">{t.month}
          <select className="rounded border border-line px-2 py-1" value={shownMonth} onChange={(e) => setMonth(e.target.value)} data-testid="lines-month">
            <option value="all">{t.allMonths}</option>
            {months.map((m) => <option key={m} value={m}>{T.ml(m)}</option>)}
          </select>
        </label>
        <span className="text-xs text-mute">{t.shown(Math.min(rows.length, SHOW), rows.length)}</span>
      </div>
      {error && <p role="alert" className="mb-3 rounded bg-red-bg px-4 py-2 text-sm text-red" data-testid="lines-error">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-xs text-mute">{cols.map(([k, label]) => <th key={k} className="px-1.5 py-2 text-start font-normal">{label}</th>)}<th /></tr></thead>
          <tbody>
            {!c.readOnly && (
              <tr className="border-b border-line bg-band/50" data-testid="lines-add-row">
                {cols.map(([k, , type]) => <td key={k} className="px-1.5 py-1.5">{field(adding, setAdding, k, type, `lines-add-${k}`)}</td>)}
                <td className="px-1.5 py-1.5 text-end"><button type="button" disabled={pending} onClick={() => run(() => addLine(c.id, { kind, line: lineOf(kind, adding) as never }), () => setAdding(blankDraft(kind)))}
                  className="whitespace-nowrap rounded bg-brand-d px-3 py-1 text-white disabled:opacity-50" data-testid="lines-add">{kind === "sales" ? t.addSale : t.addExpense}</button></td>
              </tr>
            )}
            {!rows.length && <tr><td colSpan={cols.length + 1} className="py-6 text-center text-mute">{t.noLinesHere}</td></tr>}
            {rows.slice(0, SHOW).map((l) => editing === l.id ? (
              <tr key={l.id} className="border-b border-line" data-testid="lines-edit-row">
                {cols.map(([k, , type]) => <td key={k} className="px-1.5 py-1.5">{field(draft, setDraft, k, type, `lines-edit-${k}`)}</td>)}
                <td className="whitespace-nowrap px-1.5 py-1.5 text-end">
                  <button type="button" disabled={pending} onClick={() => run(() => updateLine(c.id, { kind, id: l.id, line: lineOf(kind, draft) as never }), () => setEditing(null))} className="rounded bg-brand-d px-3 py-1 text-white disabled:opacity-50" data-testid="lines-save">{t.save}</button>
                  <button type="button" onClick={() => setEditing(null)} className="ms-2 text-mute hover:text-ink">{t.cancel}</button>
                </td>
              </tr>
            ) : (
              <tr key={l.id} className="border-b border-line/60" data-testid="lines-row" data-id={l.id}>
                {cols.map(([k]) => <td key={k} className={cn("px-1.5 py-1.5", (k === "amount" || k === "cost") && "num text-end")}>{cell(l, k)}</td>)}
                <td className="whitespace-nowrap px-1.5 py-1.5 text-end">
                  {!l.fromFile ? <span className="text-xs text-mute">{t.fromAccounts}</span> : !c.readOnly && <>
                    <button type="button" onClick={() => { setEditing(l.id); setDraft(draftOf(kind, l)); setError(null); }} className="text-brand-d hover:underline" data-testid="lines-edit">{t.edit}</button>
                    <ConfirmDialog title={t.removeTitle} confirmLabel={t.remove} testId="lines-remove-dialog"
                      trigger={<button type="button" className="ms-3 text-red hover:underline" data-testid="lines-remove">{t.remove}</button>}
                      onConfirm={async () => { const r = await deleteLine(c.id, kind, l.id); if (!r.ok) return r.error; router.refresh(); }}>
                      <p>{t.removeText(`${l.day ?? T.ml(l.period)} · ${money(l.amount, cur)}`)}</p>
                    </ConfirmDialog>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
