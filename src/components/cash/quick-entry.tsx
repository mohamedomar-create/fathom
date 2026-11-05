"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as D from "@radix-ui/react-dialog";
import { Delete, X } from "lucide-react";
import { useCash } from "@/lib/cash/context";
import { typedAmount } from "@/lib/cash/input";
import { resolveEntry, suggestFrom, topCategories } from "@/lib/cash/categorise";
import { useSuggestion } from "@/lib/cash/use-suggestion";
import { KIND_LABEL, kindsFor, type Kind } from "@/lib/cash/kinds";
import { entryAdd } from "@/app/cash/[id]/actions";
import { moneyExact } from "@/lib/engine/format";
import { useT } from "@/lib/i18n/use-t";
import { useDict, useLang } from "@/lib/i18n/context";
import { useMsg } from "@/lib/i18n/msg";
import { cn } from "@/lib/cn";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;

/**
 * Adding an entry in three taps: the amount on a number pad, money in or out, Save. The date is today; the category and
 * kind are suggested from what the cash book learned (the person's choice wins); "More details" holds the rest.
 */
export function QuickEntry({ trigger }: { trigger: React.ReactNode }) {
  const { company, entries } = useCash();
  const t = useT().d.cash;
  const d = useDict();
  const lang = useLang();
  const m = useMsg();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"in" | "out" | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const [more, setMore] = useState(false);
  const [party, setParty] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(company.today);
  const [paid, setPaid] = useState<"" | "yes" | "no">("");
  const [kind, setKind] = useState<Kind | "">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const way = direction ?? "in";
  // The learned rule for the name and description, found on the server among every rule the business has.
  const sug = useSuggestion(company.id, { direction: way, party, note }, entries.length);
  const learned = sug.rule;
  const s = useMemo(() => suggestFrom(learned, { direction: way, party, note }), [learned, way, party, note]);
  const chips = useMemo(() => topCategories(entries, way, s.category), [entries, way, s.category]);
  // Until the person picks one, the learned category is the choice.
  const category = picked ?? s.category;
  // The kind "Work it out" will save, from the category as chosen now.
  const autoKind = resolveEntry(s, { category: picked, kind: null }, { direction: way, party, note }).kind;
  const typed = typedAmount(amount);

  const reset = () => { setAmount(""); setDirection(null); setPicked(null); setOther(false); setParty(""); setNote(""); setPaid(""); setKind(""); setDay(company.today); };
  const press = (k: (typeof KEYS)[number]) => {
    setMsg(null);
    if (k === "back") return setAmount((a) => a.slice(0, -1));
    if (k === "." && amount.includes(".")) return;
    if (amount.replace(".", "").length >= 12) return;
    setAmount((a) => (k === "." && !a ? "0." : a + k));
  };
  const save = () => {
    if (!typed || typed <= 0) return setMsg({ ok: false, text: t.quickNoAmount });
    if (!direction) return setMsg({ ok: false, text: t.quickPickWay });
    const ctx = { direction, party, note };
    const choice = { category: picked, kind: kind && kindsFor(direction).includes(kind) ? kind : null };
    start(async () => {
      // Saved before the suggestion caught up with the typing: ask now, so a learned category is never missed. If the
      // server cannot answer, nothing is saved: an entry is never quietly left without the category it should have.
      let now = s;
      if (picked === null && !sug.ready) {
        try { now = suggestFrom(await sug.check(ctx), ctx); } catch { return setMsg({ ok: false, text: t.quickNoCheck }); }
      }
      const chosen = resolveEntry(now, choice, ctx);
      const r = await entryAdd(company.id, {
        day, direction, amount: typed, category: chosen.category, party, note, kind: chosen.kind,
        paid: paid === "yes" ? true : paid === "no" ? false : null, paidOn: paid === "yes" ? day : null,
      });
      if (!r.ok) return setMsg({ ok: false, text: m(r.error) });
      setMsg({ ok: true, text: t.quickSaved(moneyExact(typed, company.currency)) });
      reset();
      router.refresh();
    });
  };

  const field = "w-full rounded border border-line px-2 py-1.5 text-sm";
  return (
    <D.Root onOpenChange={(o) => { if (!o) { reset(); setMsg(null); setMore(false); } }}>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-auto rounded-t-xl bg-white px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-2xl outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-12 sm:w-[420px] sm:-translate-x-1/2 sm:rounded-xl" data-testid="quick-entry">
          <div className="mb-2 flex items-center justify-between">
            <D.Title className="text-base font-semibold">{t.addEntry}</D.Title>
            <D.Description className="sr-only">{t.addEntry}</D.Description>
            <D.Close className="rounded p-2 text-mute hover:bg-band" aria-label={d.dialog.close}><X className="h-5 w-5" /></D.Close>
          </div>

          <label className="block">
            <span className="sr-only">{t.amount}</span>
            <input inputMode="none" autoComplete="off" aria-label={t.amount} value={amount} placeholder="0"
              onChange={(e) => { setMsg(null); setAmount(e.target.value); }}
              className="num w-full rounded-md border border-line px-3 py-2 text-end text-3xl font-semibold" data-testid="quick-amount" />
          </label>
          <div dir="ltr" className="mt-2 grid grid-cols-3 gap-1.5" data-testid="quick-pad">
            {KEYS.map((k) => (
              <button key={k} type="button" onClick={() => press(k)} aria-label={k === "back" ? t.quickBack : k === "." ? t.quickPoint : k}
                className="flex min-h-12 items-center justify-center rounded-md bg-band text-xl hover:bg-line" data-testid={`quick-key-${k === "." ? "dot" : k}`}>
                {k === "back" ? <Delete className="flip-rtl h-5 w-5" /> : k}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={t.direction}>
            {(["in", "out"] as const).map((w) => (
              <button key={w} type="button" aria-pressed={direction === w} onClick={() => { setDirection(w); setPicked(null); setOther(false); setMsg(null); }}
                className={cn("min-h-12 rounded-md border-2 text-base font-semibold", direction === w ? (w === "in" ? "border-green-d bg-green-d text-white" : "border-red bg-red text-white") : w === "in" ? "border-green-d text-green-d" : "border-red text-red")}
                data-testid={`quick-${w}`}>{w === "in" ? t.quickIn : t.quickOut}</button>
            ))}
          </div>

          {direction && <div className="mt-3" data-testid="quick-categories">
            <span className="label mb-1 block">{t.category}</span>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => {
                const on = !other && category.toLowerCase() === c.toLowerCase();
                return (
                  <button key={c} type="button" aria-pressed={on} onClick={() => { setPicked(on ? "" : c); setOther(false); }}
                    className={cn("min-h-9 rounded-full border px-3 text-sm", on ? "border-brand-d bg-brand-d text-white" : "border-line hover:bg-band")} data-testid="quick-chip">
                    {c}{c === s.category && s.from !== "none" && s.from !== "words" && <span className="ms-1 text-[11px] opacity-80">· {t.quickSuggested}</span>}
                  </button>
                );
              })}
              <button type="button" aria-pressed={other} onClick={() => { setOther(true); setPicked(""); }} className={cn("min-h-9 rounded-full border border-dashed px-3 text-sm", other ? "border-brand-d" : "border-line")} data-testid="quick-chip-other">{t.quickOther}</button>
            </div>
            {other && <input autoFocus aria-label={t.quickOther} className={cn(field, "mt-2")} value={picked ?? ""} onChange={(e) => setPicked(e.target.value)} data-testid="quick-category" />}
          </div>}

          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="mt-3 text-sm text-brand-d hover:underline" data-testid="quick-more">{more ? t.quickLess : t.quickMore}</button>
          {more && <div className="mt-2 grid grid-cols-2 gap-2" data-testid="quick-details">
            <label className="col-span-2"><span className="label mb-1 block">{t.party}</span><input className={field} value={party} onChange={(e) => setParty(e.target.value)} data-testid="quick-party" /></label>
            <label className="col-span-2"><span className="label mb-1 block">{t.note}</span><input className={field} value={note} onChange={(e) => setNote(e.target.value)} data-testid="quick-note" /></label>
            <label><span className="label mb-1 block">{t.date}</span><input type="date" className={field} value={day} onChange={(e) => setDay(e.target.value || company.today)} data-testid="quick-day" /></label>
            <label><span className="label mb-1 block">{t.paid}</span>
              <select className={field} value={paid} onChange={(e) => setPaid(e.target.value as typeof paid)} data-testid="quick-paid"><option value="">{t.blank}</option><option value="yes">{t.yes}</option><option value="no">{t.no}</option></select></label>
            <label className="col-span-2"><span className="label mb-1 block">{t.kind}</span>
              <select className={field} value={kind && kindsFor(way).includes(kind) ? kind : ""} onChange={(e) => setKind(e.target.value as Kind | "")} data-testid="quick-kind">
                <option value="">{`${t.kindAuto} (${KIND_LABEL[autoKind][lang]})`}</option>{kindsFor(way).map((k) => <option key={k} value={k}>{KIND_LABEL[k][lang]}</option>)}</select></label>
          </div>}

          {msg && <p role={msg.ok ? "status" : "alert"} className={cn("mt-3 text-sm", msg.ok ? "text-green-d" : "text-red")} data-testid="quick-msg">{msg.text}</p>}
          <button type="button" disabled={pending} onClick={save} className="mt-3 min-h-12 w-full rounded-md bg-brand-d text-base font-semibold text-white disabled:opacity-50" data-testid="quick-save">{t.quickSave}</button>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
