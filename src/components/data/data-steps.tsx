"use client";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDashed, Lock, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { hasPL, mlabel } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { checkKey, runChecks } from "@/lib/company/checks";
import { dataSteps, type DataStatus, type StepStatus } from "@/lib/company/data-steps";
import type { SubLedgers } from "@/lib/company/data-status";
import type { TbCheck } from "@/lib/company/time-zone";
import { cn } from "@/lib/cn";

/** What only the server knows: where the books came from, the opening balances, the last Trial Balance check. */
export interface DataFacts {
  /** A General Ledger was loaded (lines from it exist) or the books come from the Odoo connection. */
  ledger: boolean;
  odoo: boolean;
  openingInLedger: boolean;
  booksStart: string | null;
  openingAsAt: string | null;
  tbCheck: TbCheck | null;
  /** Checks accepted with a reason on the current data (they no longer count as open). */
  accepted: string[];
}

const ICON: Record<StepStatus, React.ReactNode> = {
  verified: <ShieldCheck className="h-5 w-5 text-green-d" />, done: <CheckCircle2 className="h-5 w-5 text-green-d" />,
  issues: <AlertTriangle className="h-5 w-5 text-[#9a6b00]" />, todo: <CircleDashed className="h-5 w-5 text-mute" />, locked: <Lock className="h-5 w-5 text-mute" />,
};
const WORD: Record<StepStatus, string> = { verified: "Verified", done: "Done", issues: "Differences", todo: "To do", locked: "Locked" };

/**
 * The one sequence, in the order an accountant closes the books. The General Ledger is the book of record; the Trial
 * Balance proves it; the sub-ledgers add detail and reconcile to their control accounts; the review signs it off.
 */
export function DataSteps({ facts, sub }: { facts: DataFacts; sub: SubLedgers }) {
  const c = useCompany();
  const steps = useMemo(() => {
    const pl = c.months.filter(hasPL).map((m) => m.period).sort();
    const accepted = new Set(facts.accepted);
    const open = runChecks({ accounts: c.accounts, months: c.months }).filter((k) => k.severity !== "info" && !accepted.has(checkKey(k))).length;
    const s: DataStatus = {
      basePath: c.basePath, booksStart: facts.booksStart, opening: facts.openingAsAt ? { asAt: facts.openingAsAt } : null, booksFromZero: !!c.booksFromZero,
      openingInLedger: facts.openingInLedger,
      ledger: facts.ledger && pl.length ? { from: pl[0], to: pl[pl.length - 1], odoo: facts.odoo, issues: open } : null,
      tb: facts.tbCheck ? { at: facts.tbCheck.at, file: facts.tbCheck.file, months: facts.tbCheck.months, diffs: facts.tbCheck.diffs.length } : null,
      ...sub, openChecks: open,
    };
    return dataSteps(s);
  }, [c, facts, sub]);
  const tb = facts.tbCheck;
  return (
    <div data-testid="data-steps">
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.id} className={cn("rounded-lg border p-4", s.status === "locked" ? "border-line bg-band/40" : s.status === "issues" ? "border-amber" : "border-line")} data-testid={`step-${s.id}`} data-status={s.status}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e8e8e4] text-xs font-semibold text-mute">{s.n}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{s.title}</h2>{ICON[s.status]}<span className="text-xs text-mute">{WORD[s.status]}</span>
                  <span className="rounded bg-band px-2 py-0.5 text-[11px] text-mute">{s.role}</span>
                </div>
                <p className="mt-0.5 text-[15px] text-mute" data-testid={`step-${s.id}-detail`}>{s.detail}</p>
                {s.id === "tb" && tb && tb.diffs.length > 0 && (
                  <details className="mt-2 text-[13px]" data-testid="tb-check-diffs">
                    <summary className="cursor-pointer text-brand-d">See the differences ({tb.file}, {new Date(tb.at).toISOString().slice(0, 10)})</summary>
                    <ul className="mt-1 space-y-0.5">{tb.diffs.slice(0, 50).map((d) => <li key={`${d.period}|${d.account}`}>{mlabel(d.period)} · {d.account}: books {d.books.toLocaleString("en-US")}, file {d.file.toLocaleString("en-US")} (difference {d.diff.toLocaleString("en-US")})</li>)}</ul>
                  </details>
                )}
                {(s.file || s.verifies) && s.status !== "locked" && (
                  <details className="mt-1 text-sm"><summary className="cursor-pointer text-brand-d">Which Odoo report?</summary>
                    {s.file && <p className="mt-1">From Odoo: {s.file}.</p>}
                    {s.verifies && <p className="mt-1 text-mute">Checked against: {s.verifies}</p>}
                  </details>
                )}
                {s.action && !c.readOnly && <div className="mt-3"><Link prefetch={false} href={s.action.href} className={cn("rounded px-4 py-2 text-sm", s.status === "todo" ? "bg-brand-d text-white" : "border border-brand-d text-brand-d")} data-testid={`step-${s.id}-go`}>{s.action.label}</Link></div>}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 max-w-3xl text-[13px] text-mute">One source of record for every figure: the General Ledger. Other reports (Trial Balance, P&amp;L, balance sheet, payments list) are read as checks against it and never saved as a second copy. Sales detail, stock and ageing add detail and must agree with their accounts.</p>
    </div>
  );
}
