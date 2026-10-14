"use client";
import { useState } from "react";
import { money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { cn } from "@/lib/cn";
import { DataNotes, ExpensesPicker, ExpenseTable, NoExpenses, useExpensesAnalysis } from "./common";

export function ExpensesAccounts() {
  const c = useCompany();
  const s = useExpensesAnalysis();
  const cur = c.settings.currency;
  const [group, setGroup] = useState<string | null>(null);
  if (!s) return <><PageHeader title="Expenses by Account" /><NoExpenses /></>;
  const rows = group ? s.byAccount.filter((r) => r.group === group) : s.byAccount;
  const oneOff = s.byAccount.filter((r) => r.recurring === false && r.amount > 0);
  return (
    <>
      <PageHeader title="Expenses by Account" right={<ExpensesPicker s={s} />} />
      <div className="mb-6 flex flex-wrap gap-2" data-testid="group-filter">
        <button onClick={() => setGroup(null)} className={cn("rounded-full border px-3 py-1 text-[13px]", !group ? "border-ink bg-ink text-white" : "border-line")}>All · {money(s.total, cur)}</button>
        {s.byGroup.map((g) => (
          <button key={g.key} onClick={() => setGroup(g.name)} className={cn("rounded-full border px-3 py-1 text-[13px]", group === g.name ? "border-ink bg-ink text-white" : "border-line")}>
            {g.name} · {pct(g.share, 0)}
          </button>
        ))}
      </div>
      <ExpenseTable rows={rows} cur={cur} nameLabel="Account" group={group ? undefined : "Type"} compareLabel={s.compareLabel} kind="accounts" max={60} testId="account-table" />
      {oneOff.length > 0 && <p className="mt-4 text-[13px] text-mute" data-testid="one-off-note">{oneOff.length} account{oneOff.length > 1 ? "s were" : " was"} used in only some months of the period ({oneOff.slice(0, 3).map((r) => r.name).join(", ")}{oneOff.length > 3 ? "…" : ""}): check whether they repeat.</p>}
      <DataNotes notes={s.notes} />
    </>
  );
}
