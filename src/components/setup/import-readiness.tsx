"use client";
import Link from "next/link";
import { useCompany } from "@/lib/company/context";
import { SectorPanel, useReadiness } from "./readiness-view";
import { useT } from "@/lib/i18n/use-t";

/** Shown right after an import: how complete and accurate the financial data now is, and what to do next. */
export function ImportReadiness() {
  const c = useCompany();
  const t = useT().d.dat.ready;
  const fin = useReadiness(null).find((r) => r.key === "financials")!;
  return (
    <div className="mb-8" data-testid="import-readiness">
      <h2 className="mb-1 text-xl font-light">{t.importTitle}</h2>
      <p className="mb-3 text-sm text-mute">{t.importSub} <Link href={`${c.basePath}/data`} className="text-brand-d underline">{t.allSectors}</Link></p>
      <SectorPanel r={fin} basePath={c.basePath} />
    </div>
  );
}
