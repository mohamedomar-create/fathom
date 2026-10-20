"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { mlabel } from "@/lib/engine";
import { removeLineUpload } from "@/app/company/[id]/settings/ledger-actions";
import { removePaymentsUpload } from "@/app/company/[id]/settings/payments-actions";

export interface LineUpload { id: string; kind: "sales" | "expenses" | "payments" | "aged"; file: string | null; periods: string[]; at: string; lines?: number; asOf?: string; side?: "receivable" | "payable"; ledger?: boolean }

const FEEDS: Record<LineUpload["kind"], string> = { sales: "Sales", expenses: "Expenses", payments: "Payments", aged: "Payments (ageing)" };

/** Sales, expenses and payments files uploaded on their own, and ageing reports: when, which months, and a way to take one out again. */
export function LineUploads({ rows, companyId, readOnly }: { rows: LineUpload[]; companyId: string; readOnly: boolean }) {
  const router = useRouter();
  const [, setTick] = useState(0);
  if (!rows.length) return <p className="text-sm text-mute">None yet.</p>;
  const span = (ps: string[]) => (ps.length ? (ps.length === 1 ? mlabel(ps[0]) : `${mlabel(ps[0])} – ${mlabel(ps[ps.length - 1])}`) : "");
  const what = (r: LineUpload) => (r.kind === "aged" ? `the Aged ${r.side === "payable" ? "Payable" : "Receivable"} as of ${r.asOf}` : `"${r.file ?? "this upload"}"`);
  const then = (r: LineUpload) => (r.kind === "aged" ? "Its documents go; an earlier report for the same side, if any, is shown instead." : r.kind === "payments" ? "Its payments go." : `Its ${r.kind} lines go, and the months fall back to your General Ledger or P&L.`);
  const remove = (r: LineUpload) => async () => {
    const out = r.kind === "payments" || r.kind === "aged" ? await removePaymentsUpload(companyId, r.kind, r.id) : await removeLineUpload(companyId, r.kind, r.id);
    if (!out.ok) return out.error ?? "Could not remove the upload.";
    setTick((t) => t + 1);
    router.refresh();
  };
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="tbl text-[13px]" data-testid="line-uploads">
        <thead><tr><th className="text-start">File</th><th className="text-start">Feeds</th><th className="text-start">Months</th><th className="text-start">When</th>{!readOnly && <th />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="row" data-testid="line-upload">
              <td className="max-w-[260px] truncate text-start" title={r.file ?? ""}>{r.file ?? "Upload"}</td>
              <td className="text-start">{r.kind === "payments" && r.ledger ? "Payments (General Ledger)" : FEEDS[r.kind]}</td>
              <td className="text-start">{r.kind === "aged" ? `Aged ${r.side === "payable" ? "Payable" : "Receivable"} as of ${r.asOf}` : span([...r.periods].sort())}</td>
              <td className="text-start text-mute">{new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
              {!readOnly && <td><ConfirmDialog title="Remove this upload?" confirmLabel="Remove" onConfirm={remove(r)} testId="remove-line-upload-dialog"
                trigger={<button className="text-[12px] text-red underline" data-testid="remove-line-upload">Remove</button>}>
                <p>This removes {what(r)}{r.lines ? `: ${r.lines.toLocaleString("en-US")} lines` : ""}{r.periods.length ? ` (${span([...r.periods].sort())})` : ""}.</p>
                <p className="text-mute">{then(r)}</p>
              </ConfirmDialog></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
