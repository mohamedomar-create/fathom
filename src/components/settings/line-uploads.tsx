"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { removeLineUpload } from "@/app/company/[id]/settings/ledger-actions";
import { removePaymentsUpload } from "@/app/company/[id]/settings/payments-actions";
import { useT } from "@/lib/i18n/use-t";

export interface LineUpload { id: string; kind: "sales" | "expenses" | "payments" | "aged"; file: string | null; periods: string[]; at: string; lines?: number; asOf?: string; side?: "receivable" | "payable"; ledger?: boolean }

/** Sales, expenses and payments files uploaded on their own, and ageing reports: when, which months, and a way to take one out again. */
export function LineUploads({ rows, companyId, readOnly }: { rows: LineUpload[]; companyId: string; readOnly: boolean }) {
  const router = useRouter();
  const T = useT();
  const l = T.d.setx.lines;
  const [, setTick] = useState(0);
  if (!rows.length) return <p className="text-sm text-mute">{l.none}</p>;
  const span = (ps: string[]) => (ps.length ? (ps.length === 1 ? T.ml(ps[0]) : `${T.ml(ps[0])} – ${T.ml(ps[ps.length - 1])}`) : "");
  const what = (r: LineUpload) => (r.kind === "aged" ? l.whatAged(r.side === "payable", String(r.asOf)) : l.whatFile(r.file));
  const then = (r: LineUpload) => (r.kind === "aged" ? l.thenAged : r.kind === "payments" ? l.thenPayments : l.thenLines(r.kind));
  const remove = (r: LineUpload) => async () => {
    const out = r.kind === "payments" || r.kind === "aged" ? await removePaymentsUpload(companyId, r.kind, r.id) : await removeLineUpload(companyId, r.kind, r.id);
    if (!out.ok) return out.error ?? l.couldNotRemove;
    setTick((t) => t + 1);
    router.refresh();
  };
  return (
    <div tabIndex={0} className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="tbl text-[13px]" data-testid="line-uploads">
        <thead><tr><th className="text-start">{l.file}</th><th className="text-start">{l.feeds}</th><th className="text-start">{l.months}</th><th className="text-start">{l.when}</th>{!readOnly && <th />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="row" data-testid="line-upload">
              <td className="max-w-[260px] truncate text-start" title={r.file ?? ""}>{r.file ?? l.upload}</td>
              <td className="text-start">{r.kind === "payments" && r.ledger ? l.paymentsGl : l.feed[r.kind]}</td>
              <td className="text-start">{r.kind === "aged" ? l.aged(r.side === "payable", String(r.asOf)) : span([...r.periods].sort())}</td>
              <td className="text-start text-mute">{new Date(r.at).toLocaleString(T.lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
              {!readOnly && <td><ConfirmDialog title={l.removeTitle} confirmLabel={l.remove} onConfirm={remove(r)} testId="remove-line-upload-dialog"
                trigger={<button className="text-[12px] text-red underline" data-testid="remove-line-upload">{l.remove}</button>}>
                <p>{l.removes(what(r), r.lines ? r.lines.toLocaleString("en-US") : "", r.periods.length ? span([...r.periods].sort()) : "")}</p>
                <p className="text-mute">{then(r)}</p>
              </ConfirmDialog></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
