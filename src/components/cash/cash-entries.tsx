"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/engine/format";
import { typedAmount } from "@/lib/cash/input";
import { useCash } from "@/lib/cash/context";
import type { StoredEntry } from "@/lib/cash/load";
import { entryAdd, entryDelete, entryUpdate, type EntryInput } from "@/app/cash/[id]/actions";
import { PageHeader } from "@/components/shell/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/i18n/context";
import { detectKind, KIND_LABEL, kindsFor, type Kind } from "@/lib/cash/kinds";

type Draft = { day: string; direction: "in" | "out"; amount: string; category: string; party: string; note: string; paid: "" | "yes" | "no"; paidOn: string; kind: "" | Kind };
const blank = (): Draft => ({ day: "", direction: "in", amount: "", category: "", party: "", note: "", paid: "", paidOn: "", kind: "" });
const draftOf = (e: StoredEntry): Draft => ({ day: e.day, direction: e.direction, amount: String(e.amount), category: e.category, party: e.party, note: e.note, paid: e.paid === true ? "yes" : e.paid === false ? "no" : "", paidOn: e.paidOn ?? "", kind: e.kind });
const inputOf = (d: Draft): EntryInput => ({
  day: d.day, direction: d.direction, amount: typedAmount(d.amount) ?? 0, category: d.category, party: d.party, note: d.note,
  paid: d.paid === "yes" ? true : d.paid === "no" ? false : null, paidOn: d.paid === "yes" ? d.paidOn || null : null,
  // A kind that does not fit the direction (changed after picking it) is worked out again from the words.
  kind: d.kind && kindsFor(d.direction).includes(d.kind) ? d.kind : detectKind(d.direction, [d.category, d.note, d.party].join(" ")),
});
const SHOW = 300;

/** Every entry, newest first: add one, change one, remove one (editors). */
export function CashEntries() {
  const { company, entries } = useCash();
  const T = useT();
  const t = T.d.cash;
  const router = useRouter();
  const lang = useLang();
  const months = useMemo(() => [...new Set(entries.map((e) => e.day.slice(0, 7)))].sort().reverse(), [entries]);
  const [month, setMonth] = useState("");
  const [page, setPage] = useState(0);
  const shown = month && (month === "all" || months.includes(month)) ? month : months[0] ?? "all";
  const rows = entries.filter((e) => shown === "all" || e.day.startsWith(shown)).sort((a, b) => b.day.localeCompare(a.day) || b.id - a.id);
  const pageNo = Math.min(page, Math.max(0, Math.ceil(rows.length / SHOW) - 1));
  const from = pageNo * SHOW;
  const [adding, setAdding] = useState<Draft>(blank());
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(blank());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cur = company.currency;
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) => start(async () => {
    setError(null);
    const r = await fn();
    if (!r.ok) setError(r.error); else { done?.(); router.refresh(); }
  });
  const fieldCls = "w-full min-w-[84px] rounded border border-line px-1.5 py-1 text-sm";
  const fields = (d: Draft, set: (d: Draft) => void, p: string) => (
    <>
      <td className="px-1.5 py-1.5"><input type="date" className={fieldCls} value={d.day} onChange={(e) => set({ ...d, day: e.target.value })} data-testid={`${p}-day`} /></td>
      <td className="px-1.5 py-1.5"><select className={fieldCls} value={d.direction} onChange={(e) => set({ ...d, direction: e.target.value as "in" | "out" })} data-testid={`${p}-direction`}><option value="in">{t.inWord}</option><option value="out">{t.outWord}</option></select></td>
      <td className="px-1.5 py-1.5"><select className={fieldCls} value={d.kind && kindsFor(d.direction).includes(d.kind) ? d.kind : ""} onChange={(e) => set({ ...d, kind: e.target.value as Draft["kind"] })} data-testid={`${p}-kind`}>
        <option value="">{t.kindAuto}</option>{kindsFor(d.direction).map((k) => <option key={k} value={k}>{KIND_LABEL[k][lang]}</option>)}</select></td>
      <td className="px-1.5 py-1.5"><input inputMode="decimal" className={fieldCls} value={d.amount} onChange={(e) => set({ ...d, amount: e.target.value })} data-testid={`${p}-amount`} /></td>
      <td className="px-1.5 py-1.5"><input className={fieldCls} value={d.category} onChange={(e) => set({ ...d, category: e.target.value })} data-testid={`${p}-category`} /></td>
      <td className="px-1.5 py-1.5"><input className={fieldCls} value={d.party} onChange={(e) => set({ ...d, party: e.target.value })} data-testid={`${p}-party`} /></td>
      <td className="px-1.5 py-1.5"><input className={fieldCls} value={d.note} onChange={(e) => set({ ...d, note: e.target.value })} data-testid={`${p}-note`} /></td>
      <td className="px-1.5 py-1.5"><select className={fieldCls} value={d.paid} data-testid={`${p}-paid`}
        onChange={(e) => { const paid = e.target.value as Draft["paid"]; set({ ...d, paid, paidOn: paid === "yes" ? d.paidOn || company.today : "" }); }}>
        <option value="">{t.blank}</option><option value="yes">{t.yes}</option><option value="no">{t.no}</option></select></td>
      <td className="px-1.5 py-1.5"><input type="date" className={fieldCls} value={d.paidOn} disabled={d.paid !== "yes"} onChange={(e) => set({ ...d, paidOn: e.target.value })} data-testid={`${p}-paid-on`} /></td>
    </>
  );
  return (
    <div data-testid="cash-entries">
      <PageHeader title={t.nav.entries} />
      <p className="mb-4 text-mute">{t.entriesText}</p>
      {company.readOnly && <p className="mb-4 rounded bg-band px-4 py-2 text-sm" data-testid="entries-view-only">{t.viewOnly}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">{t.month}
          <select className="rounded border border-line px-2 py-1" value={shown} onChange={(e) => { setMonth(e.target.value); setPage(0); }} data-testid="entries-month">
            <option value="all">{t.allMonths}</option>
            {months.map((m) => <option key={m} value={m}>{T.ml(m)}</option>)}
          </select>
        </label>
        <span className="text-xs text-mute" data-testid="entries-shown">{t.shown(Math.min(rows.length - from, SHOW), rows.length)}</span>
        {rows.length > SHOW && <span className="flex gap-3 text-sm">
          <button type="button" disabled={from === 0} onClick={() => setPage(pageNo - 1)} className="text-brand-d disabled:text-mute" data-testid="entries-newer">{t.newer}</button>
          <button type="button" disabled={from + SHOW >= rows.length} onClick={() => setPage(pageNo + 1)} className="text-brand-d disabled:text-mute" data-testid="entries-older">{t.older}</button>
        </span>}
      </div>
      {error && <p role="alert" className="mb-3 rounded bg-red-bg px-4 py-2 text-sm text-red" data-testid="entries-error">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-xs text-mute">{[t.date, t.direction, t.kind, t.amount, t.category, t.party, t.note, t.paid, t.paidOn].map((h) => <th key={h} className="px-1.5 py-2 text-start font-normal">{h}</th>)}<th /></tr></thead>
          <tbody>
            {!company.readOnly && <tr className="border-b border-line bg-band/50" data-testid="entries-add-row">
              {fields(adding, setAdding, "add")}
              <td className="px-1.5 py-1.5 text-end"><button type="button" disabled={pending} onClick={() => run(() => entryAdd(company.id, inputOf(adding)), () => setAdding(blank()))} className="whitespace-nowrap rounded bg-brand-d px-3 py-1 text-white disabled:opacity-50" data-testid="entries-add">{t.add}</button></td>
            </tr>}
            {rows.slice(from, from + SHOW).map((e) => editing === e.id ? (
              <tr key={e.id} className="border-b border-line" data-testid="entries-edit-row">
                {fields(draft, setDraft, "edit")}
                <td className="whitespace-nowrap px-1.5 py-1.5 text-end">
                  <button type="button" disabled={pending} onClick={() => run(() => entryUpdate(company.id, e.id, inputOf(draft)), () => setEditing(null))} className="rounded bg-brand-d px-3 py-1 text-white disabled:opacity-50" data-testid="entries-save">{t.saveRow}</button>
                  <button type="button" onClick={() => setEditing(null)} className="ms-2 text-mute hover:text-ink">{t.cancel}</button>
                </td>
              </tr>
            ) : (
              <tr key={e.id} className="border-b border-line/60" data-testid="entries-row">
                <td className="px-1.5 py-1.5">{e.day}</td>
                <td className={cn("px-1.5 py-1.5", e.direction === "in" ? "text-green-d" : "text-red")}>{e.direction === "in" ? t.inWord : t.outWord}</td>
                <td className="px-1.5 py-1.5" data-testid="entries-kind">{KIND_LABEL[e.kind][lang]}{e.edited && <span className="ms-1.5 rounded bg-band px-1 text-[11px] text-mute" data-testid="entries-edited">{t.edited}</span>}</td>
                <td className="num px-1.5 py-1.5 text-end">{money(e.amount, cur)}</td>
                <td className="px-1.5 py-1.5">{e.category || "–"}</td>
                <td className="px-1.5 py-1.5">{e.party || "–"}</td>
                <td className="px-1.5 py-1.5">{e.note || "–"}</td>
                <td className="px-1.5 py-1.5">{e.paid === true ? t.yes : e.paid === false ? t.no : "–"}</td>
                <td className="px-1.5 py-1.5">{e.paid ? e.paidOn ?? e.day : "–"}</td>
                <td className="whitespace-nowrap px-1.5 py-1.5 text-end">{!company.readOnly && <>
                  <button type="button" onClick={() => { setEditing(e.id); setDraft(draftOf(e)); setError(null); }} className="text-brand-d hover:underline" data-testid="entries-edit">{t.edit}</button>
                  <ConfirmDialog title={t.removeTitle} confirmLabel={t.remove} testId="entries-remove-dialog"
                    trigger={<button type="button" className="ms-3 text-red hover:underline" data-testid="entries-remove">{t.remove}</button>}
                    onConfirm={async () => { const r = await entryDelete(company.id, e.id); if (!r.ok) return r.error; router.refresh(); }}>
                    <p>{t.removeText(`${e.day} · ${money(e.amount, cur)}`)}</p>
                  </ConfirmDialog>
                </>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
