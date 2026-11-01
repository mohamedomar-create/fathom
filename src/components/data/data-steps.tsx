"use client";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDashed, Lock, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { hasPL, mlabel } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { runChecks } from "@/lib/company/checks";
import { dataStatusOf, type DataStatus, type StepStatus } from "@/lib/company/data-steps";
import { openChecks } from "@/lib/company/status";
import type { SubLedgers } from "@/lib/company/data-status";
import type { TbCheck } from "@/lib/company/time-zone";
import { cn } from "@/lib/cn";

/** What only the server knows: where the books came from, the opening balances, the last Trial Balance check. */
export interface DataFacts {
  /** A General Ledger was loaded (lines from it exist) or the books come from the Odoo connection. */
  ledger: boolean;
  odoo: boolean;
  /** The books were built from the cash book when the company moved to the full system. */
  cashBasis?: boolean;
  openingInLedger: boolean;
  booksStart: string | null;
  openingAsAt: string | null;
  tbCheck: TbCheck | null;
  /** Checks accepted with a reason on the current data (they no longer count as open). */
  accepted: string[];
  /** The accepted checks couldn't be read, so the open ones can't be counted. */
  acceptedUnread?: boolean;
}

const ICON: Record<StepStatus, React.ReactNode> = {
  verified: <ShieldCheck className="h-5 w-5 text-green-d" />, done: <CheckCircle2 className="h-5 w-5 text-green-d" />,
  issues: <AlertTriangle className="h-5 w-5 text-[#7d5600]" />, todo: <CircleDashed className="h-5 w-5 text-mute" />, locked: <Lock className="h-5 w-5 text-mute" />,
  unchecked: <AlertTriangle className="h-5 w-5 text-mute" />, pending: <CircleDashed className="h-5 w-5 animate-pulse text-mute" />,
};
/** Steps whose status comes from the sub-ledger checks, which arrive a moment after the page. */
const CHECKING = new Set(["sales", "stock", "ageing"]);
const WORD: Record<StepStatus, string> = { verified: "Verified", done: "Done", issues: "Differences", todo: "To do", locked: "Locked", unchecked: "Couldn't be checked", pending: "Adding up" };

/**
 * The one sequence, in the order an accountant closes the books. The General Ledger is the book of record; the Trial
 * Balance proves it; the sub-ledgers add detail and reconcile to their control accounts; the review signs it off.
 */
/** sub: the sub-ledger checks, or null while they are still being worked out (those steps say so). */
export function DataSteps({ facts, sub }: { facts: DataFacts; sub: SubLedgers | null }) {
  const c = useCompany();
  const { steps, next } = useMemo(() => {
    const pl = c.months.filter(hasPL).map((m) => m.period).sort();
    // The one open-check count (the health banner counts the same way).
    const open = openChecks(runChecks({ accounts: c.accounts, months: c.months, unit: c.unit }), facts.accepted);
    const s: DataStatus = {
      basePath: c.basePath, booksStart: facts.booksStart, opening: facts.openingAsAt ? { asAt: facts.openingAsAt } : null, booksFromZero: !!c.booksFromZero,
      openingInLedger: facts.openingInLedger,
      ledger: facts.ledger && pl.length ? { from: pl[0], to: pl[pl.length - 1], odoo: facts.odoo, issues: facts.acceptedUnread ? 0 : open.blocking } : null,
      // Books with no General Ledger behind them are still books: monthly statements, or a cash book moved to the full system.
      books: !facts.ledger && pl.length ? { from: pl[0], to: pl[pl.length - 1], basis: facts.cashBasis ? "cash" : "statements" } : null,
      tb: facts.tbCheck ? { at: facts.tbCheck.at, file: facts.tbCheck.file, months: facts.tbCheck.months, diffs: facts.tbCheck.diffs.length } : null,
      ...(sub ?? { sales: null, stock: null, ageing: [] }), openChecks: facts.acceptedUnread ? null : open.blocking, warnings: open.warnings,
    };
    return dataStatusOf(s);
  }, [c, facts, sub]);
  const tb = facts.tbCheck;
  // While the sub-ledgers stream in, this list is the placeholder: its test ids carry "pending-" so the finished list
  // that replaces it is the only one with the real ids.
  const id = (x: string) => (sub ? x : `pending-${x}`);
  return (
    <div data-testid={id("data-steps")} data-checking={sub ? undefined : "true"}>
      {/* The next thing to do, from the same status as the steps below (the wizard's "back to the data steps" lands here). */}
      {sub && <p className="mb-4 rounded-md bg-band px-4 py-3 text-sm" data-testid="data-next">{next ? <>Next: <strong>{next.n}. {next.title}</strong>: {next.detail}</> : "Setup is complete. Optional steps below add detail."}</p>}
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.id} className={cn("rounded-lg border p-4", s.status === "locked" ? "border-line bg-band/40" : s.status === "issues" ? "border-amber" : "border-line")} data-testid={id(`step-${s.id}`)} data-status={s.status}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e8e8e4] text-xs font-semibold text-mute">{s.n}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{s.title}</h2>{!sub && CHECKING.has(s.id) ? <span className="text-xs text-mute" data-testid={id(`step-${s.id}-checking`)}>Checking…</span> : <>{ICON[s.status]}<span className="text-xs text-mute">{WORD[s.status]}</span></>}
                  <span className="rounded bg-band px-2 py-0.5 text-[11px] text-mute">{s.role}</span>
                </div>
                <p className="mt-0.5 text-[15px] text-mute" data-testid={id(`step-${s.id}-detail`)}>{s.detail}</p>
                {s.id === "tb" && tb && tb.diffs.length > 0 && (
                  <details className="mt-2 text-[13px]" data-testid={id("tb-check-diffs")}>
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
                {s.action && !c.readOnly && <div className="mt-3"><Link prefetch={false} href={s.action.href} className={cn("rounded px-4 py-2 text-sm", s.status === "todo" ? "bg-brand-d text-white" : "border border-brand-d text-brand-d")} data-testid={id(`step-${s.id}-go`)}>{s.action.label}</Link></div>}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 max-w-3xl text-[13px] text-mute">One source of record for every figure: the General Ledger. Other reports (Trial Balance, P&amp;L, balance sheet, payments list) are read as checks against it and never saved as a second copy. Sales detail, stock and ageing add detail and must agree with their accounts.</p>
    </div>
  );
}
