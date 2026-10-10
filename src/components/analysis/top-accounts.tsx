"use client";
import { money, type ClassKey } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

/** "Top ten … accounts" drill-down for the selected period window. */
export function TopAccounts({ title, classes, periods, total }: { title: string; classes: ClassKey[]; periods: string[]; total: number }) {
  const c = useCompany();
  const rows = c.accounts
    .filter((x) => classes.includes(x.cls))
    .map((x) => ({ ...x, v: periods.reduce((s, p) => s + (x.amounts[p] ?? 0), 0) }))
    .filter((x) => x.v !== 0)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 10);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => Math.abs(r.v)));
  return (
    <Dialog>
      <DialogTrigger className="text-xs text-mute underline decoration-dashed underline-offset-4 hover:text-ink">{title}</DialogTrigger>
      <DialogContent title={title} className="w-[min(640px,calc(100vw-24px))] p-6">
        <h2 className="mb-4 text-xl font-normal">{title}</h2>
        <table className="tbl">
          <thead><tr><th>Account</th><th>Amount</th><th>% of total</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="text-xs text-mute">{r.code}</div>{r.name}
                  <div className="mt-1 h-1.5 rounded bg-band"><div className="h-1.5 rounded bg-brand" style={{ width: `${(Math.abs(r.v) / max) * 100}%` }} /></div>
                </td>
                <td>{money(r.v, c.settings.currency)}</td>
                <td>{total ? `${((r.v / total) * 100).toFixed(1)}%` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
