"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCash } from "@/lib/cash/context";
import { clearCashBook, saveCashSettings, switchToFull } from "@/app/cash/[id]/actions";
import { deleteCompany } from "@/app/company/[id]/settings/actions";
import { PageHeader } from "@/components/shell/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useT } from "@/lib/i18n/use-t";

/** The business's name, currency and opening cash; the way to the full system; clear or delete. */
export function CashSettings() {
  const { company } = useCash();
  const t = useT().d.cash;
  const router = useRouter();
  const [name, setName] = useState(company.name);
  const [currency, setCurrency] = useState(company.currency);
  const [amount, setAmount] = useState(company.openingCash ? String(company.openingCash.amount) : "");
  const [asOf, setAsOf] = useState(company.openingCash?.asOf ?? company.today);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const field = "w-full rounded border border-line px-3 py-2";
  const save = () => start(async () => {
    const opening = amount.trim() === "" ? null : { amount: Number(amount.replace(/,/g, "")), asOf };
    const r = await saveCashSettings(company.id, { name, currency, opening });
    setMsg(r.ok ? { ok: true, text: t.savedOk } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  });
  const ro = company.readOnly;
  return (
    <div className="max-w-2xl space-y-8" data-testid="cash-settings">
      <PageHeader title={t.settingsTitle} />
      <section className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="label mb-1 block">{t.name}</span><input disabled={ro} className={field} value={name} onChange={(e) => setName(e.target.value)} data-testid="cash-set-name" /></label>
        <label><span className="label mb-1 block">{t.currency}</span><input disabled={ro} className={`${field} uppercase`} maxLength={6} value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="cash-set-currency" /></label>
        <div />
        <label><span className="label mb-1 block">{t.opening}</span><input disabled={ro} inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="cash-set-opening" />
          <span className="mt-1 block text-[12.5px] text-mute">{t.openingText}</span></label>
        <label><span className="label mb-1 block">{t.onDay}</span><input disabled={ro} type="date" className={field} value={asOf} onChange={(e) => setAsOf(e.target.value)} data-testid="cash-set-opening-day" /></label>
        {!ro && <div className="sm:col-span-2 flex items-center gap-3">
          <button type="button" disabled={pending} onClick={save} className="rounded bg-brand-d px-5 py-2 font-medium text-white disabled:opacity-50" data-testid="cash-set-save">{t.saveSettings}</button>
          {msg && <span role="status" className={msg.ok ? "text-green-d" : "text-red"} data-testid="cash-set-msg">{msg.text}</span>}
        </div>}
      </section>
      {!ro && <section className="rounded-md border border-line p-4">
        <h2 className="text-lg font-normal">{t.fullTitle}</h2>
        <p className="mb-3 text-sm text-mute">{t.fullText}</p>
        <ConfirmDialog title={t.toFullConfirm} confirmLabel={t.toFull} testId="cash-to-full-dialog"
          trigger={<button type="button" className="rounded border border-brand-d px-4 py-2 text-sm text-brand-d" data-testid="cash-to-full">{t.toFull}</button>}
          onConfirm={async () => { const r = await switchToFull(company.id); if (!r.ok) return r.error; router.push(`/company/${company.id}`); }}><p>{t.fullText}</p></ConfirmDialog>
      </section>}
      {company.role === "admin" && <section className="space-y-4 rounded-md border border-red/40 p-4">
        <div>
          <h2 className="text-lg font-normal">{t.clearTitle}</h2>
          <p className="mb-2 text-sm text-mute">{t.clearText}</p>
          <ConfirmDialog title={t.clearTitle} confirmLabel={t.clear} typeToConfirm={company.name} testId="cash-clear-dialog"
            trigger={<button type="button" className="rounded border border-red px-4 py-2 text-sm text-red" data-testid="cash-clear">{t.clear}</button>}
            onConfirm={async () => { const r = await clearCashBook(company.id); if (!r.ok) return r.error; router.refresh(); }}><p>{t.clearText}</p></ConfirmDialog>
        </div>
        <div>
          <h2 className="text-lg font-normal">{t.deleteTitle}</h2>
          <p className="mb-2 text-sm text-mute">{t.deleteText}</p>
          <ConfirmDialog title={t.deleteTitle} confirmLabel={t.del} typeToConfirm={company.name} testId="cash-delete-dialog"
            trigger={<button type="button" className="rounded bg-red px-4 py-2 text-sm text-white" data-testid="cash-delete">{t.del}</button>}
            onConfirm={async () => { const r = await deleteCompany(company.id); if (!r.ok) return r.error ?? "Could not delete"; router.push("/companies"); }}><p>{t.deleteText}</p></ConfirmDialog>
        </div>
      </section>}
    </div>
  );
}
