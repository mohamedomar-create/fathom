"use client";
import { useRouter } from "next/navigation";
import { switchToCash } from "@/app/cash/[id]/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDict } from "@/lib/i18n/context";

/** For a full-system company that only deals in money in and out: move it to the small-business cash book. */
export function ToCashBook({ companyId }: { companyId: string }) {
  const router = useRouter();
  const t = useDict().cash;
  return (
    <section className="rounded-md border border-line p-4" data-testid="to-cash-book">
      <h2 className="text-lg font-light">{t.toCashTitle}</h2>
      <p className="mb-3 text-sm text-mute">{t.toCashText}</p>
      <ConfirmDialog title={t.toCashTitle} confirmLabel={t.toCash} testId="to-cash-dialog"
        trigger={<button type="button" className="rounded border border-brand-d px-4 py-2 text-sm text-brand-d" data-testid="to-cash">{t.toCash}</button>}
        onConfirm={async () => { const r = await switchToCash(companyId); if (!r.ok) return r.error; router.push(`/cash/${companyId}`); }}><p>{t.toCashText}</p></ConfirmDialog>
    </section>
  );
}
