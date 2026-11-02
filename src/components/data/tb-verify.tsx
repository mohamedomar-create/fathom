"use client";
import type React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { mlabel, money } from "@/lib/engine";
import { compareTrialBalance } from "@/lib/company/compare";
import { WizardNav, WizardSteps, WizardTitle } from "@/components/upload/wizard-shell";
import { saveTbCheck } from "@/app/company/[id]/data/actions";
import { useT } from "@/lib/i18n/use-t";

type Acct = { code: string; name: string; cls: string; amounts: Record<string, number> };

/**
 * A Trial Balance (or P&L, or balance sheet) uploaded when the books already come from the General Ledger: it is
 * evidence, never a second copy of the figures. Every account in every month the file and the books share is compared;
 * the differences are listed; the books are left as the ledger made them. Keeping the check stores only its result.
 */
export function TbVerify({ companyId, fileName, file, ranges, books, currency, demo, onBack, onDone, onUseAsFigures, readAs }: {
  companyId: string; fileName: string; file: Acct[]; ranges: Record<string, number>; books: Acct[]; currency: string; demo: boolean; onBack: () => void; onDone: (what: string) => void;
  /** Replace the books with this file instead (when the ledger itself was wrong): asked for on purpose, never the default. */
  onUseAsFigures?: () => void;
  /** "Read as: …" for each sheet, with the person's choice (a look-alike file is said, never read quietly as a balance). */
  readAs?: React.ReactNode;
}) {
  const T = useT();
  const t = T.d.dat.tb;
  const ml = T.lang === "ar" ? T.ml : mlabel;
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
    onDone(r.diffs.length ? t.done(r.diffs.length) : t.doneOk(r.months.map(ml).join(t.sep)));
  });
  const ok = r.months.length > 0 && r.diffs.length === 0;
  return (
    <div data-testid="tb-verify">
      <WizardSteps at="check" />
      <WizardTitle title={t.title} hint={t.hint} />
      {readAs}
      {r.months.length === 0
        ? <p className="mb-4 max-w-3xl rounded-lg border border-amber bg-amber/10 px-4 py-3 text-[14px]" data-testid="tb-no-months">{t.noMonths(r.missing.map(ml).join(t.sep))}</p>
        : ok
          ? <p className="mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-green-d/40 bg-green-d/5 px-4 py-3 text-[15px]" data-testid="tb-agrees"><CheckCircle2 className="h-5 w-5 text-green-d" />{t.agrees(r.months.map(ml).join(t.sep))}</p>
          : <p className="mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-red/40 bg-red-bg px-4 py-3 text-[15px]" data-testid="tb-differs"><AlertTriangle className="h-5 w-5 text-red" />{t.differs(r.diffs.length)}</p>}
      {r.missing.length > 0 && r.months.length > 0 && <p className="mb-4 max-w-3xl text-[13px] text-mute" data-testid="tb-missing">{t.missing(r.missing.map(ml).join(t.sep))}</p>}
      {r.diffs.length > 0 && (
        <div tabIndex={0} className="max-w-4xl overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-[13px]" data-testid="tb-diffs">
            <thead className="bg-band text-left text-mute"><tr><th className="px-3 py-2">{t.month}</th><th className="px-3 py-2">{t.account}</th><th className="px-3 py-2 text-right">{t.books}</th><th className="px-3 py-2 text-right">{t.file}</th><th className="px-3 py-2 text-right">{t.difference}</th></tr></thead>
            <tbody>
              {r.diffs.slice(0, 200).map((d) => (
                <tr key={`${d.period}|${d.account}`} className="border-t border-line">
                  <td className="px-3 py-1.5">{ml(d.period)}</td><td className="px-3 py-1.5">{d.account}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(d.books, currency)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(d.file, currency)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{money(d.diff, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.diffs.length > 200 && <p className="px-3 py-2 text-[12px] text-mute">{t.more(r.diffs.length - 200)}</p>}
        </div>
      )}
      {onUseAsFigures && !demo && (
        <details className="mt-6 max-w-3xl text-[13px]" data-testid="use-as-figures-box">
          <summary className="cursor-pointer text-mute">{t.wrongQ}</summary>
          <p className="mt-2">{t.wrongText}</p>
          <button onClick={onUseAsFigures} className="mt-2 rounded border border-red/60 px-3 py-1.5 text-red" data-testid="use-as-figures">{t.useAs}</button>
        </details>
      )}
      {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
      {demo
        ? <WizardNav onBack={onBack} next={t.signup} href="/login?mode=signup" nextTestId="keep-tb-check" />
        : <WizardNav onBack={onBack} next={saving ? t.keeping : t.keep} onNext={keep} disabled={saving || r.months.length === 0} nextTestId="keep-tb-check" hint={t.keepHint} />}
    </div>
  );
}
