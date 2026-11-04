import "server-only";
import { runChecks } from "@/lib/company/checks";
import type { CompanyBundle } from "@/lib/company/types";
import type { ExpenseFlag } from "@/lib/engine/expenses";
import { doctorFindings, findingKey, healthScore, type Decision, type Finding } from "./findings";

export interface DoctorData {
  findings: Finding[];
  score: { score: number; open: number; atStake: number };
  currency: string;
  /** The expense lines could not be read: possible double payments are not in the list. */
  expensesUnread: boolean;
  /** Accepting needs the latest database update (0056). */
  decisionsUnavailable: boolean;
}

/**
 * The doctor's page data, from figures the company's pages already load. A check accepted with a reason when its file
 * was uploaded counts as accepted here too, with that reason.
 */
export function doctorData(bundle: CompanyBundle, opts: { flags: ExpenseFlag[] | null; decisions: Decision[] | null }): DoctorData {
  const checks = runChecks({ accounts: bundle.accounts, months: bundle.months, unit: bundle.unit });
  const fromUpload: Decision[] = checks.flatMap((c) => {
    const a = (bundle.accepted ?? []).find((x) => x.title === c.title && (x.period ?? "") === (c.period ?? ""));
    return a ? [{ key: findingKey(c), reason: a.reason, at: "", by: "upload" }] : [];
  });
  const findings = doctorFindings({ checks, expenseFlags: opts.flags ?? [], months: bundle.months, basePath: bundle.basePath, decisions: [...fromUpload, ...(opts.decisions ?? [])] });
  return { findings, score: healthScore(findings, bundle.months), currency: bundle.settings.currency, expensesUnread: opts.flags === null, decisionsUnavailable: opts.decisions === null };
}

/** The open decisions as stored, with whether each can still be undone (30 days, the database's own limit). */
export function decisionsFrom(rows: { id: string; finding_key: string; reason: string; created_at: string; amount: number | string | null }[], now = Date.now()): Decision[] {
  return rows.map((r) => ({ id: r.id, key: r.finding_key, reason: r.reason, at: r.created_at, amount: r.amount === null ? null : Number(r.amount), undoable: now - Date.parse(r.created_at) < 30 * 86_400_000 }));
}
