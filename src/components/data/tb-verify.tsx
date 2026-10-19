"use client";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { mlabel, money } from "@/lib/engine";
import { compareTrialBalance } from "@/lib/company/compare";
import { WizardNav, WizardSteps, WizardTitle } from "@/components/upload/wizard-shell";
import { saveTbCheck } from "@/app/company/[id]/data/actions";

type Acct = { code: string; name: string; cls: string; amounts: Record<string, number> };

/**
 * A Trial Balance (or P&L, or balance sheet) uploaded when the books already come from the General Ledger: it is
 * evidence, never a second copy of the figures. Every account in every month the file and the books share is compared;
 * the differences are listed; the books are left as the ledger made them. Keeping the check stores only its result.
 */
export function TbVerify({ companyId, fileName, file, ranges, books, currency, demo, onBack, onDone, onUseAsFigures }: {
  companyId: string; fileName: string; file: Acct[]; ranges: Record<string, number>; books: Acct[]; currency: string; demo: boolean; onBack: () => void; onDone: (what: string) => void;
  /** Replace the books with this file instead (when the ledger itself was wrong): asked for on purpose, never the default. */
  onUseAsFigures?: () => void;
}) {
  const bookMonths = useMemo(() => new Set(books.flatMap((a) => Object.keys(a.amounts))), [books]);
  // Months the books don't hold yet are named, never listed account by account as if every balance differed.
  const r = useMemo(() => {
    const all = compareTrialBalance(file, books, ranges);
    const months = all.months.filter((m) => bookMonths.has(m));
    return { months, missing: all.months.filter((m) => !bookMonths.has(m)), diffs: all.diffs.filter((d) => bookMonths.has(d.period)) };
  }, [file, books, bookMonths, ranges]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const keep = () => start(async () => {
    setErr(null);
    const out = await saveTbCheck(companyId, { file: fileName.slice(0, 200), months: r.months, diffs: r.diffs.slice(0, 2000) });
    if (!out.ok) { setErr(out.error); return; }
    onDone(r.diffs.length ? `Trial Balance checked: ${r.diffs.length} difference${r.diffs.length > 1 ? "s" : ""} with the books, listed on the Data steps. Nothing in the books was changed.` : `Trial Balance checked: it agrees with the books in every account, ${r.months.map(mlabel).join(", ")}. Nothing in the books was changed.`);
  });
  const ok = r.months.length > 0 && r.diffs.length === 0;
  return (
    <div data-testid="tb-verify">
      <WizardSteps at="check" />
      <WizardTitle title="Check against your books" hint="Your books come from the General Ledger. This file is read as a check only: nothing in it is saved as figures." />
      {r.months.length === 0
        ? <p className="mb-4 max-w-3xl rounded-lg border border-amber bg-amber/10 px-4 py-3 text-[14px]" data-testid="tb-no-months">None of the months in this file are in your books yet. Upload the General Ledger for {r.missing.map(mlabel).join(", ")} first, then check this file.</p>
        : ok
          ? <p className="mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-green-d/40 bg-green-d/5 px-4 py-3 text-[15px]" data-testid="tb-agrees"><CheckCircle2 className="h-5 w-5 text-green-d" />Agrees with the books: every account, {r.months.map(mlabel).join(", ")}.</p>
          : <p className="mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-red/40 bg-red-bg px-4 py-3 text-[15px]" data-testid="tb-differs"><AlertTriangle className="h-5 w-5 text-red" />{r.diffs.length} difference{r.diffs.length > 1 ? "s" : ""} with the books. The books are not changed: find each one in Odoo (a late posting, a filter on the export, an account mapped differently).</p>}
      {r.missing.length > 0 && r.months.length > 0 && <p className="mb-4 max-w-3xl text-[13px] text-mute" data-testid="tb-missing">Not in your books yet, so not checked: {r.missing.map(mlabel).join(", ")}.</p>}
      {r.diffs.length > 0 && (
        <div className="max-w-4xl overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-[13px]" data-testid="tb-diffs">
            <thead className="bg-band text-left text-mute"><tr><th className="px-3 py-2">Month</th><th className="px-3 py-2">Account</th><th className="px-3 py-2 text-right">Books</th><th className="px-3 py-2 text-right">This file</th><th className="px-3 py-2 text-right">Difference</th></tr></thead>
            <tbody>
              {r.diffs.slice(0, 200).map((d) => (
                <tr key={`${d.period}|${d.account}`} className="border-t border-line">
                  <td className="px-3 py-1.5">{mlabel(d.period)}</td><td className="px-3 py-1.5">{d.account}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(d.books, currency)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(d.file, currency)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{money(d.diff, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.diffs.length > 200 && <p className="px-3 py-2 text-[12px] text-mute">and {r.diffs.length - 200} more (all kept with the check).</p>}
        </div>
      )}
      {onUseAsFigures && !demo && (
        <details className="mt-6 max-w-3xl text-[13px]" data-testid="use-as-figures-box">
          <summary className="cursor-pointer text-mute">The General Ledger is wrong and this file should replace it?</summary>
          <p className="mt-2">Then this file becomes your figures for its months, in place of the ledger. Sales, expense lines and payments taken from the ledger for those months no longer match and are cleared. Usually the better fix is a corrected General Ledger.</p>
          <button onClick={onUseAsFigures} className="mt-2 rounded border border-red/60 px-3 py-1.5 text-red" data-testid="use-as-figures">Use this file as my figures instead</button>
        </details>
      )}
      {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
      {demo
        ? <WizardNav onBack={onBack} next="Create a free account to save" href="/login?mode=signup" nextTestId="keep-tb-check" />
        : <WizardNav onBack={onBack} next={saving ? "Keeping…" : "Keep this check"} onNext={keep} disabled={saving || r.months.length === 0} nextTestId="keep-tb-check" hint="Only the result is kept. Your books stay as the General Ledger made them." />}
    </div>
  );
}
