"use client";
// "Checked against": each of a module's cross-checks in one line. A difference names its month and amount; a check whose
// other side isn't loaded says so in grey. Nothing here is ever adjusted.
import { CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { money } from "@/lib/engine/format";
import { useCompany } from "@/lib/company/context";
import { crossChecks, type CrossInput } from "@/lib/crosscheck";
import { useT } from "@/lib/i18n/use-t";

export function AgreesStrip({ input }: { input: Omit<CrossInput, "accounts"> }) {
  const c = useCompany();
  const { d, lang, ml } = useT();
  const t = d.ink.page;
  const checks = useMemo(() => crossChecks({ ...input, accounts: c.accounts }), [input, c.accounts]);
  if (!checks.length) return null;
  return (
    <ul className="mb-5 space-y-1 rounded-lg border border-line bg-white px-4 py-2 text-[13.5px]" data-testid="agrees-strip">
      {checks.map((x) => (
        <li key={x.key} className="flex items-center gap-2" data-testid={`agree-${x.key}`} data-status={x.status}>
          {x.status === "agrees" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-d" /> : x.status === "differs" ? <TriangleAlert className="h-4 w-4 shrink-0 text-red" /> : <CircleDashed className="h-4 w-4 shrink-0 text-mute" />}
          <span className="text-mute">{t.agrees}:</span>
          <span>{lang === "ar" ? x.label.ar : x.label.en}</span>
          <span className={x.status === "differs" ? "text-red" : "text-mute"}>
            — {x.status === "agrees" ? t.agreeOk(x.months.length) : x.status === "differs" && x.worst ? t.agreeOff(money(x.worst.diff ?? 0, c.settings.currency), ml(x.worst.period)) : x.reason === "no_overlap" ? t.noOverlap : t.notChecked}
          </span>
        </li>
      ))}
    </ul>
  );
}
