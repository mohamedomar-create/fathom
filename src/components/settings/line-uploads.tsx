"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { mlabel } from "@/lib/engine";
import { removeLineUpload } from "@/app/company/[id]/settings/ledger-actions";

export interface LineUpload { id: string; kind: "sales" | "expenses"; file: string | null; periods: string[]; at: string; lines?: number }

/** Sales and expenses files uploaded on their own: when, which months, and a way to take one out again. */
export function LineUploads({ rows, companyId, readOnly }: { rows: LineUpload[]; companyId: string; readOnly: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  if (!rows.length) return <p className="text-sm text-mute">None yet.</p>;
  const remove = (r: LineUpload) => {
    if (!confirm(`Remove "${r.file ?? "this upload"}"? Its ${r.kind} lines go, and the months fall back to your General Ledger or P&L.`)) return;
    start(async () => {
      const out = await removeLineUpload(companyId, r.kind, r.id);
      if (!out.ok) { alert(out.error); return; }
      router.refresh();
    });
  };
  const span = (ps: string[]) => (ps.length ? (ps.length === 1 ? mlabel(ps[0]) : `${mlabel(ps[0])} – ${mlabel(ps[ps.length - 1])}`) : "");
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="tbl text-[13px]" data-testid="line-uploads">
        <thead><tr><th className="text-left">File</th><th className="text-left">Feeds</th><th className="text-left">Months</th><th className="text-left">When</th>{!readOnly && <th />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="row" data-testid="line-upload">
              <td className="max-w-[260px] truncate text-left" title={r.file ?? ""}>{r.file ?? "Upload"}</td>
              <td className="text-left">{r.kind === "sales" ? "Sales" : "Expenses"}</td>
              <td className="text-left">{span([...r.periods].sort())}</td>
              <td className="text-left text-mute">{new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
              {!readOnly && <td><button onClick={() => remove(r)} disabled={busy} className="text-[12px] text-red underline" data-testid="remove-line-upload">Remove</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
