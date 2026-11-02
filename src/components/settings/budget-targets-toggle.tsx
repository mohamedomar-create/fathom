"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useCompany } from "@/lib/company/context";
import { setBudgetTargets } from "@/app/company/[id]/settings/actions";
import { useT } from "@/lib/i18n/use-t";
import { Toggle } from "./kpi-config-form";

/** Settings, Targets: take revenue and margin targets from the approved budget. */
export function BudgetTargetsToggle() {
  const c = useCompany();
  const router = useRouter();
  const t = useT().d.bud;
  const [on, setOn] = useState(!!c.budgetTargets);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mb-6 rounded border border-line bg-white p-4" data-testid="budget-targets">
      <div className="flex items-center gap-3">
        <Toggle on={on} disabled={c.readOnly || pending} label={t.useAsTargets} onChange={(v) => {
          setOn(v);
          start(async () => { const r = await setBudgetTargets(c.id, v); if (!r.ok) { setOn(!v); setErr(r.error ?? null); } else router.refresh(); });
        }} />
        <span className="font-medium">{t.useAsTargets}</span>
      </div>
      <p className="mt-1 text-sm text-mute">{t.useAsTargetsHint}</p>
      {on && !c.budget && <p className="mt-1 text-sm text-mute" data-testid="budget-targets-none">{t.noApproved}</p>}
      {err && <p role="alert" className="mt-1 text-sm text-red-d">{err}</p>}
    </div>
  );
}
